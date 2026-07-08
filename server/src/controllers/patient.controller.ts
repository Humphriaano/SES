import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { requestMagicLink } from '../services/portalAuth.service';

const PORTAL_URL = process.env['PORTAL_URL'] ?? 'http://localhost:5174';

export async function listPatients(req: Request, res: Response): Promise<void> {
  const { search } = req.query as { search?: string };
  const patients = await prisma.patient.findMany({
    where: search
      ? {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { nationalId: { contains: search, mode: 'insensitive' } },
          ],
        }
      : undefined,
    orderBy: { createdAt: 'desc' },
    include: { diagnoses: { include: { icd11: true } } },
  });
  res.json(patients);
}

export async function getPatient(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
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
        include: { clinician: { select: { id: true, name: true } }, diagnoses: { include: { icd11: true } } },
      },
      billingItems: { orderBy: { createdAt: 'desc' } },
      appointments: { orderBy: { scheduledAt: 'desc' } },
    },
  });
  if (!patient) { res.status(404).json({ error: 'Patient not found' }); return; }
  res.json(patient);
}

export async function createPatient(req: Request, res: Response): Promise<void> {
  const data = req.body as {
    firstName: string; lastName: string; dateOfBirth: string; gender: string;
    phone?: string; address?: string; nationalId?: string; hivStatus?: string; hivTestDate?: string;
    email?: string;
  };
  const patient = await prisma.patient.create({
    data: {
      firstName: data.firstName,
      lastName: data.lastName,
      dateOfBirth: new Date(data.dateOfBirth),
      gender: data.gender as any,
      phone: data.phone,
      address: data.address,
      nationalId: data.nationalId,
      hivStatus: (data.hivStatus as any) ?? 'UNKNOWN',
      hivTestDate: data.hivTestDate ? new Date(data.hivTestDate) : undefined,
      email: data.email || undefined,
    },
  });
  res.status(201).json(patient);
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
    firstName: string; lastName: string; phone: string; address: string;
    hivStatus: string; hivTestDate: string;
    email: string; preferredName: string; portalEnabled: boolean;
  }>;
  const patient = await prisma.patient.update({
    where: { id },
    data: {
      ...data,
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
