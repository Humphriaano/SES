import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';

// ── Existing medication / prescription handlers ───────────────────────────────

export async function getMedications(req: Request, res: Response): Promise<void> {
  const { patientId } = req.params;
  const medications = await prisma.medication.findMany({
    where: { patientId },
    orderBy: { startDate: 'desc' },
  });
  res.json(medications);
}

export async function createMedication(req: Request, res: Response): Promise<void> {
  const { patientId } = req.params;
  const data = req.body as {
    name: string; dosage?: string; frequency?: string; route?: string;
    startDate: string; endDate?: string; notes?: string;
  };
  const medication = await prisma.medication.create({
    data: {
      patientId,
      name: data.name,
      dosage: data.dosage,
      frequency: data.frequency,
      route: data.route,
      startDate: new Date(data.startDate),
      endDate: data.endDate ? new Date(data.endDate) : undefined,
      notes: data.notes,
    },
  });
  res.status(201).json(medication);
}

export async function updateMedication(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const data = req.body as Partial<{ dosage: string; frequency: string; endDate: string; notes: string }>;
  const medication = await prisma.medication.update({
    where: { id },
    data: { ...data, endDate: data.endDate ? new Date(data.endDate) : undefined },
  });
  res.json(medication);
}

export async function getPrescriptions(req: Request, res: Response): Promise<void> {
  const { encounterId } = req.params;
  const prescriptions = await prisma.prescription.findMany({
    where: { encounterId },
    include: { medication: true },
  });
  res.json(prescriptions);
}

export async function createPrescription(req: Request, res: Response): Promise<void> {
  const { encounterId } = req.params;
  const { medicationId } = req.body as { medicationId: string };
  const prescription = await prisma.prescription.create({
    data: { encounterId, medicationId },
    include: { medication: true },
  });
  res.status(201).json(prescription);
}

export async function dispensePrescription(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const prescription = await prisma.prescription.update({
    where: { id },
    data: { dispensed: true, dispensedAt: new Date() },
    include: { medication: true },
  });
  res.json(prescription);
}

// ── New pharmacy module handlers ──────────────────────────────────────────────

/** GET /prescriptions?status=pending&patientId=:id — global queue */
export async function listGlobalPrescriptions(req: Request, res: Response): Promise<void> {
  const { status, patientId } = req.query as { status?: string; patientId?: string };
  const where: any = {};
  if (status === 'pending') where.dispensed = false;
  if (patientId) where.encounter = { patientId };

  const prescriptions = await prisma.prescription.findMany({
    where,
    include: {
      medication: true,
      encounter: {
        include: {
          patient: {
            select: { id: true, firstName: true, lastName: true, nationalId: true, dateOfBirth: true, gender: true },
          },
          clinician: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  res.json(prescriptions);
}

/** GET /inventory?drug=:drugName */
export async function getInventory(req: Request, res: Response): Promise<void> {
  const { drug } = req.query as { drug?: string };
  if (!drug) { res.json({ quantity: 0, unit: 'units' }); return; }
  const item = await prisma.drugInventory.findFirst({
    where: { drugName: { contains: drug, mode: 'insensitive' } },
  });
  res.json({ quantity: item?.quantity ?? 0, unit: item?.unit ?? 'units' });
}

/** GET /drugs?search=:query — drug name autocomplete */
export async function searchDrugs(req: Request, res: Response): Promise<void> {
  const { search } = req.query as { search?: string };
  if (!search || search.length < 2) { res.json([]); return; }

  const [meds, invItems] = await Promise.all([
    prisma.medication.findMany({
      where: { name: { contains: search, mode: 'insensitive' } },
      select: { name: true },
      distinct: ['name'],
      take: 10,
    }),
    prisma.drugInventory.findMany({
      where: { drugName: { contains: search, mode: 'insensitive' } },
      select: { drugName: true },
      take: 10,
    }),
  ]);

  const names = [...new Set([...meds.map(m => m.name), ...invItems.map(i => i.drugName)])];
  res.json(names.map(name => ({ name })));
}

/** POST /dispensing */
export async function createDispensing(req: AuthRequest, res: Response): Promise<void> {
  const body = req.body as {
    prescriptionId?: string;
    patientId: string;
    type?: string;
    dispensedDrug: string;
    dispensedDose?: string;
    dispensedFrequency?: string;
    dispensedDuration?: string;
    dispensedBy: string;
    substitution?: object;
    modifications?: object;
  };

  const dispensing = await prisma.dispensing.create({
    data: {
      prescriptionId: body.prescriptionId ?? null,
      patientId: body.patientId,
      type: body.type ?? 'direct',
      dispensedDrug: body.dispensedDrug,
      dispensedDose: body.dispensedDose ?? null,
      dispensedFrequency: body.dispensedFrequency ?? null,
      dispensedDuration: body.dispensedDuration ?? null,
      dispensedBy: body.dispensedBy,
      substitution: body.substitution ?? undefined,
      modifications: body.modifications ?? undefined,
    },
    include: {
      patient: { select: { firstName: true, lastName: true, nationalId: true } },
    },
  });

  // Mark prescription as dispensed
  if (body.prescriptionId) {
    await prisma.prescription.update({
      where: { id: body.prescriptionId },
      data: { dispensed: true, dispensedAt: new Date() },
    });
  }

  // Decrement inventory (ignore if no matching row)
  await prisma.drugInventory.updateMany({
    where: { drugName: { equals: body.dispensedDrug, mode: 'insensitive' } },
    data: { quantity: { decrement: 1 } },
  });

  res.status(201).json(dispensing);
}

/** GET /dispensing?date=today  or  GET /dispensing?patientId=:id */
export async function getDispensing(req: Request, res: Response): Promise<void> {
  const { date, patientId } = req.query as { date?: string; patientId?: string };
  const where: any = {};

  if (date === 'today') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    where.dispensedAt = { gte: today };
  }
  if (patientId) where.patientId = patientId;

  const records = await prisma.dispensing.findMany({
    where,
    include: {
      patient: { select: { firstName: true, lastName: true, nationalId: true } },
    },
    orderBy: { dispensedAt: 'desc' },
  });
  res.json(records);
}

/** GET /patients/:patientId/dispensing */
export async function getPatientDispensing(req: Request, res: Response): Promise<void> {
  const { patientId } = req.params;
  const records = await prisma.dispensing.findMany({
    where: { patientId },
    include: {
      patient: { select: { firstName: true, lastName: true, nationalId: true } },
    },
    orderBy: { dispensedAt: 'desc' },
  });
  res.json(records);
}

/** PATCH /dispensing/:id — mark collected */
export async function updateDispensing(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { collectedBy } = req.body as { collectedBy?: string };
  const updated = await prisma.dispensing.update({
    where: { id },
    data: { collectedAt: new Date(), collectedBy: collectedBy ?? null },
    include: {
      patient: { select: { firstName: true, lastName: true, nationalId: true } },
    },
  });
  res.json(updated);
}
