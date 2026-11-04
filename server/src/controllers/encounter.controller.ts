import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';

export async function listEncounters(req: Request, res: Response): Promise<void> {
  const { patientId } = req.params;
  const encounters = await prisma.encounter.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    include: {
      clinician: { select: { id: true, name: true, designation: true } },
      diagnoses: { include: { icd11: true } },
      vitals: true,
    },
  });
  res.json(encounters);
}

export async function getEncounter(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const encounter = await prisma.encounter.findUnique({
    where: { id },
    include: {
      clinician: { select: { id: true, name: true, designation: true } },
      diagnoses: { include: { icd11: true } },
      vitals: true,
      labOrders: { include: { results: true } },
      prescriptions: { include: { medication: true, substituteMedication: true } },
      billingItems: true,
    },
  });
  if (!encounter) { res.status(404).json({ error: 'Encounter not found' }); return; }
  res.json(encounter);
}

export async function createEncounter(req: AuthRequest, res: Response): Promise<void> {
  const { patientId } = req.params;
  const encounter = await prisma.encounter.create({
    data: { patientId, clinicianId: req.userId! },
    include: { clinician: { select: { id: true, name: true, designation: true } } },
  });
  res.status(201).json(encounter);
}

export async function updateEncounter(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const data = req.body as Partial<{
    chiefComplaint: string; hpi: string; examination: string;
    treatmentPlan: string; investigations: string; notes: string; status: string;
  }>;
  const encounter = await prisma.encounter.update({ where: { id }, data: data as any });
  res.json(encounter);
}

export async function addDiagnosis(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { icd11Id, isPrimary, notes } = req.body as { icd11Id: string; isPrimary?: boolean; notes?: string };
  const diagnosis = await prisma.encounterDiagnosis.create({
    data: { encounterId: id, icd11Id, isPrimary: isPrimary ?? false, notes },
    include: { icd11: true },
  });
  // Also upsert into patient's chronic diagnosis list if not already there
  const encounter = await prisma.encounter.findUnique({ where: { id }, select: { patientId: true } });
  if (encounter) {
    const existing = await prisma.patientDiagnosis.findFirst({
      where: { patientId: encounter.patientId, icd11Id },
    });
    if (!existing) {
      await prisma.patientDiagnosis.create({ data: { patientId: encounter.patientId, icd11Id } });
    }
  }
  res.status(201).json(diagnosis);
}

export async function closeEncounter(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const encounter = await prisma.encounter.update({ where: { id }, data: { status: 'CLOSED' } });
  res.json(encounter);
}
