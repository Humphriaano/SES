import { saveDispensing, DispensingError } from '../lib/dispensing';
import { chargePrescription } from '../lib/billing';
import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { parseMedicationDraft } from '../lib/medicationDraft';
import { pricingUnit } from '../lib/prescriptionSupply';
import { StockError } from '../lib/stock';
import { dispensingStockInclude } from '../lib/stockDispensing';
import { validateStockPreference, preferredStockInclude } from '../lib/prescribingStock';

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
  const parsed = parseMedicationDraft(req.body);
  if ('error' in parsed) { res.status(400).json(parsed); return; }
  if (parsed.data.catalogueCode && parsed.data.priceBasis) {
    const price = await prisma.priceListItem.findUnique({ where: { itemType_catalogueRef: { itemType: 'DRUG', catalogueRef: parsed.data.catalogueCode } } });
    if (!price?.active || price.unit !== pricingUnit(parsed.data.priceBasis, parsed.data.doseUnit || 'unit') || (parsed.data.priceBasis === 'BOTTLE' && parsed.data.bottleSizeMl != null && Number(price.bottleSizeMl) !== parsed.data.bottleSizeMl)) { res.status(409).json({ error: 'The drug pricing unit or bottle size changed. Refresh before prescribing.' }); return; }
    if (price.unitPrice != null) parsed.data.unitPrice = Number(price.unitPrice);
  }
  const medication = await prisma.medication.create({ data: { patientId: String(req.params['patientId']), ...parsed.data } });
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
    include: { medication: true, substituteMedication: true, preferredStockProduct: preferredStockInclude },
  });
  res.json(prescriptions);
}

export async function createPrescription(req: Request, res: Response): Promise<void> {
  const encounterId = String(req.params['encounterId']);
  const { medicationId } = req.body as { medicationId: string };
  if (!medicationId) { res.status(400).json({ error: 'Medication is required.' }); return; }
  let prescription;
  try {
    prescription = await prisma.$transaction(async tx => {
      const [encounter, medication] = await Promise.all([
        tx.encounter.findUnique({ where: { id: encounterId }, select: { patientId: true } }),
        tx.medication.findUnique({ where: { id: medicationId }, select: { patientId: true, catalogueCode: true, quantityUnit: true } }),
      ]);
      if (!encounter || !medication || encounter.patientId !== medication.patientId) throw new StockError(404, 'Medication not found for this encounter.');
      const preferredStockProductId = await validateStockPreference(tx, req.body.preferredStockProductId, medication);
      return tx.prescription.create({ data: { encounterId, medicationId, preferredStockProductId }, include: { medication: true, substituteMedication: true, preferredStockProduct: preferredStockInclude } });
    });
  } catch (error) { if (error instanceof StockError) { res.status(error.status).json({ error: error.message }); return; } throw error; }
  await chargePrescription(prescription.id, (req as any).userId);   // clinical save survives a billing failure
  const current = await prisma.prescription.findUnique({ where: { id: prescription.id }, include: { medication: true, substituteMedication: true, preferredStockProduct: preferredStockInclude } });
  res.status(201).json(current ?? prescription);
}

export async function dispensePrescription(req: AuthRequest, res: Response): Promise<void> {
  const rx = await prisma.prescription.findUnique({ where: { id: String(req.params['id']) }, include: { medication: true, encounter: true } });
  if (!rx) { res.status(404).json({ error: 'Prescription not found.' }); return; }
  req.body = { ...req.body, prescriptionId: rx.id, patientId: rx.encounter.patientId, type: 'prescription', dispensedDrug: rx.medication.name };
  return createDispensing(req, res);
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
      medication: true, substituteMedication: true, preferredStockProduct: preferredStockInclude,
      encounter: {
        include: {
          patient: {
            select: { id: true, firstName: true, lastName: true, nationalId: true, dateOfBirth: true, gender: true },
          },
          clinician: { select: { id: true, name: true, designation: true } },
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
  try {
    const saved = await saveDispensing(req.body, { userId: req.userId, role: req.userRole }, req.header('Idempotency-Key'));
    if (saved.replayed) res.setHeader('Idempotent-Replay', 'true');
    res.status(saved.replayed ? 200 : 201).json(saved.result);
  }
  catch (error) { if (error instanceof DispensingError || error instanceof StockError) { res.status(error.status).json({ error: error.message }); return; } throw error; }
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
      stockAllocations: { include: dispensingStockInclude },
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
      stockAllocations: { include: dispensingStockInclude },
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
      stockAllocations: { include: dispensingStockInclude },
    },
  });
  res.json(updated);
}
