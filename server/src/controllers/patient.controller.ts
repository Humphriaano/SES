import { Request as ExpressRequest, Response } from 'express';
// Route params are always single strings in these routes (no wildcards).
type Request = ExpressRequest<Record<string, string>>;
import prisma from '../lib/prisma';
import { requestMagicLink } from '../services/portalAuth.service';
import { AuthRequest } from '../middleware/auth';
import { canReadClinical, PATIENT_IDENTITY_SELECT } from '../lib/clinicalAccess';

const PORTAL_URL = process.env['PORTAL_URL'] ?? 'http://localhost:5175';

export async function listPatients(req: AuthRequest, res: Response): Promise<void> {
  const { search, limit } = req.query as { search?: string; limit?: string };
  const term = search?.trim();
  const digits = term?.replace(/\D/g, '').replace(/^0+/, '');
  // "Mandy Kuma" → every word must match the first name, surname or NRC.
  const words = term ? term.split(/\s+/).filter(Boolean) : [];
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const query = {
    where: term
      ? {
          OR: [
            {
              AND: words.map((w) => ({
                OR: [
                  { firstName: { contains: w, mode: 'insensitive' as const } },
                  { lastName: { contains: w, mode: 'insensitive' as const } },
                  { nationalId: { contains: w, mode: 'insensitive' as const } },
                ],
              })),
            },
            // Phone is stored as +260971234567; match "0971 234 567" too.
            ...(digits && digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
          ],
        }
      : undefined,
    take: term ? 200 : take, // wider net for ranking below, then trimmed
    orderBy: { createdAt: 'desc' as const },
  };
  const patients = canReadClinical(req.userRole)
    ? await prisma.patient.findMany({ ...query, include: { diagnoses: { include: { icd11: true } } } })
    : await prisma.patient.findMany({ ...query, select: PATIENT_IDENTITY_SELECT });

  // Best matches first: a name that starts with the search beats one that merely contains it.
  if (term) {
    const t = term.toLowerCase();
    const rank = (p: { firstName: string; lastName: string; nationalId: string | null }) => {
      const full = `${p.firstName} ${p.lastName}`.toLowerCase();
      if (full === t || p.nationalId === term) return 0;
      if (p.firstName.toLowerCase().startsWith(t) || p.lastName.toLowerCase().startsWith(t) || full.startsWith(t)) return 1;
      return 2;
    };
    patients.sort((a, b) => rank(a) - rank(b));
  }
  // Cap the payload: search results never need the whole register.
  res.json(patients.slice(0, take));
}

export async function getPatient(req: AuthRequest, res: Response): Promise<void> {
  const { id } = req.params;
  if (!canReadClinical(req.userRole)) {
    const patient = await prisma.patient.findUnique({ where: { id: String(id) }, select: PATIENT_IDENTITY_SELECT });
    if (!patient) { res.status(404).json({ error: 'Patient not found' }); return; }
    res.json(patient);
    return;
  }
  const patient = await prisma.patient.findUnique({
    where: { id },
    include: {
      diagnoses: { include: { icd11: true } },
      medications: true,
      vitals: { orderBy: { recordedAt: 'desc' }, take: 10 },
      labResults: { orderBy: { recordedAt: 'desc' }, take: 20 },
      encounters: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { clinician: { select: { id: true, name: true, designation: true } }, diagnoses: { include: { icd11: true } } },
      },
      billingItems: { orderBy: { createdAt: 'desc' } },
      appointments: { orderBy: { scheduledAt: 'desc' } },
    },
  });
  if (!patient) { res.status(404).json({ error: 'Patient not found' }); return; }
  res.json(patient);
}

const NRC_RE = /^\d{6}\/\d{2}\/\d$/;
const PHONE_RE = /^\+\d{8,15}$/; // E.164

function validateContact(d: { nationalId?: string | null; phone?: string | null; nextOfKinPhone?: string | null }): string | null {
  if (d.nationalId && !NRC_RE.test(d.nationalId)) return 'NRC must be in the format 123456/78/9';
  if (d.phone && !PHONE_RE.test(d.phone)) return 'Phone must be in international format, e.g. +260971234567';
  if (d.nextOfKinPhone && !PHONE_RE.test(d.nextOfKinPhone)) return 'Next of kin phone must be in international format, e.g. +260971234567';
  return null;
}

export async function createPatient(req: Request, res: Response): Promise<void> {
  const data = req.body as {
    firstName: string; lastName: string; dateOfBirth: string; gender: string;
    phone?: string; address?: string; nationalId?: string; hivStatus?: string; hivTestDate?: string;
    email?: string; religion?: string;
    nextOfKinName?: string; nextOfKinRelationship?: string; nextOfKinPhone?: string;
  };
  const invalid = validateContact(data);
  if (invalid) { res.status(400).json({ error: invalid }); return; }
  const patient = await prisma.patient.create({
    data: {
      firstName: data.firstName,
      lastName: data.lastName,
      dateOfBirth: new Date(data.dateOfBirth),
      gender: data.gender as any,
      phone: data.phone || undefined,
      address: data.address || undefined,
      // Blank NRC must be null, not "", or the unique index rejects the second patient without one.
      nationalId: data.nationalId || undefined,
      religion: data.religion || undefined,
      nextOfKinName: data.nextOfKinName || undefined,
      nextOfKinRelationship: data.nextOfKinRelationship || undefined,
      nextOfKinPhone: data.nextOfKinPhone || undefined,
      hivStatus: (data.hivStatus as any) ?? 'UNKNOWN',
      hivTestDate: data.hivTestDate ? new Date(data.hivTestDate) : undefined,
      email: data.email || undefined,
    },
  });
  res.status(201).json(patient);
}

// POST /patients/:patientId/diagnoses — record a past or ongoing condition directly (Past Medical History)
export async function addPatientDiagnosis(req: Request, res: Response): Promise<void> {
  const { patientId } = req.params as { patientId: string };
  const { icd11Id, diagnosedYear, resolved } = req.body as { icd11Id?: unknown; diagnosedYear?: unknown; resolved?: unknown };

  if (typeof icd11Id !== 'string' || !icd11Id) { res.status(400).json({ error: 'Choose a condition from the list' }); return; }
  let year: number | null = null;
  if (diagnosedYear !== undefined && diagnosedYear !== null && diagnosedYear !== '') {
    year = Number(diagnosedYear);
    if (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear()) {
      res.status(400).json({ error: `Year diagnosed must be between 1900 and ${new Date().getFullYear()}` }); return;
    }
  }

  const [patient, code, existing] = await Promise.all([
    prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } }),
    prisma.iCD11Code.findUnique({ where: { id: icd11Id } }),
    prisma.patientDiagnosis.findFirst({ where: { patientId, icd11Id } }),
  ]);
  if (!patient) { res.status(404).json({ error: 'Patient not found' }); return; }
  if (!code) { res.status(404).json({ error: 'That condition is no longer in the list' }); return; }

  const diagnosedAt = year ? new Date(Date.UTC(year, 0, 1, 12)) : undefined;
  const isResolved = resolved === true;

  // Same condition again: update the existing entry instead of listing it twice.
  if (existing) {
    const updated = await prisma.patientDiagnosis.update({
      where: { id: existing.id },
      data: { diagnosedAt: diagnosedAt ?? existing.diagnosedAt, resolvedAt: isResolved ? (existing.resolvedAt ?? new Date()) : null },
      include: { icd11: true },
    });
    res.json({ ...updated, alreadyExisted: true });
    return;
  }

  const created = await prisma.patientDiagnosis.create({
    data: { patientId, icd11Id, diagnosedAt, resolvedAt: isResolved ? new Date() : null },
    include: { icd11: true },
  });
  res.status(201).json({ ...created, alreadyExisted: false });
}

export async function resolveDiagnosis(req: Request, res: Response): Promise<void> {
  const { patientId, diagnosisId } = req.params;
  const diagnosis = await prisma.patientDiagnosis.findFirst({
    where: { id: diagnosisId, patientId },
  });
  if (!diagnosis) { res.status(404).json({ error: 'Diagnosis not found' }); return; }
  const updated = await prisma.patientDiagnosis.update({
    where: { id: diagnosisId },
    data: { resolvedAt: new Date() },
    include: { icd11: true },
  });
  res.json(updated);
}

export async function updatePatient(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const data = req.body as Partial<{
    firstName: string; lastName: string; dateOfBirth: string; gender: string;
    nationalId: string; phone: string; address: string;
    hivStatus: string; hivTestDate: string;
    email: string; preferredName: string; portalEnabled: boolean;
  }>;
  const invalid = validateContact(req.body);
  if (invalid) { res.status(400).json({ error: invalid }); return; }
  const patient = await prisma.patient.update({
    where: { id },
    data: {
      ...data,
      dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : undefined,
      gender: data.gender as any,
      hivStatus: data.hivStatus as any,
      hivTestDate: data.hivTestDate ? new Date(data.hivTestDate) : undefined,
    },
  });
  res.json(patient);
}

// Requires an email on file; enables portal access if it wasn't already, then
// sends the same branded magic-link email the portal login screen uses.
export async function sendPortalInvitation(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const patient = await prisma.patient.findUnique({ where: { id } });
  if (!patient) { res.status(404).json({ error: 'Patient not found' }); return; }
  if (!patient.email) { res.status(400).json({ error: 'This patient has no email on file' }); return; }

  if (!patient.portalEnabled) {
    await prisma.patient.update({ where: { id }, data: { portalEnabled: true } });
  }
  await requestMagicLink(patient.email, 'invitation', { portalUrl: PORTAL_URL });
  res.json({ message: 'Invitation sent', portalEnabled: true });
}
