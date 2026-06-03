import { Request, Response } from 'express';
import prisma from '../lib/prisma';

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
    },
  });
  if (!patient) { res.status(404).json({ error: 'Patient not found' }); return; }
  res.json(patient);
}

export async function createPatient(req: Request, res: Response): Promise<void> {
  const data = req.body as {
    firstName: string; lastName: string; dateOfBirth: string; gender: string;
    phone?: string; address?: string; nationalId?: string; hivStatus?: string; hivTestDate?: string;
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
