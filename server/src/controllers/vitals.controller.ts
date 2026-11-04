import { chargeConsultationFee } from '../lib/billing';
import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';

function calcBmi(weight?: number | null, height?: number | null): number | null {
  if (!weight || !height || height <= 0) return null;
  return parseFloat((weight / ((height / 100) ** 2)).toFixed(1));
}

// Physiologically possible bounds — rejects typos (e.g. 1200 for 120), not abnormal values.
const LIMITS = {
  bloodPressureSystolic:  { min: 50,  max: 280, int: true,  label: 'Systolic BP' },
  bloodPressureDiastolic: { min: 20,  max: 180, int: true,  label: 'Diastolic BP' },
  heartRate:              { min: 20,  max: 260, int: true,  label: 'Heart rate' },
  temperature:            { min: 30,  max: 45,  int: false, label: 'Temperature' },
  oxygenSat:              { min: 50,  max: 100, int: false, label: 'SpO₂' },
  glucose:                { min: 1,   max: 45,  int: false, label: 'Glucose' },
  weight:                 { min: 0.5, max: 400, int: false, label: 'Weight' },
  height:                 { min: 30,  max: 250, int: false, label: 'Height' },
} as const;
type VitalField = keyof typeof LIMITS;

const RECORDED_BY = { select: { id: true, name: true, designation: true } };

export async function getVitals(req: Request, res: Response): Promise<void> {
  const { patientId } = req.params as { patientId: string };
  // Latest 50, returned oldest-first for charting.
  const vitals = await prisma.vital.findMany({
    where: { patientId },
    orderBy: { recordedAt: 'desc' },
    take: 50,
    include: { recordedBy: RECORDED_BY },
  });
  res.json(vitals.reverse().map((v) => ({ ...v, bmi: calcBmi(v.weight, v.height) })));
}

export async function createVital(req: AuthRequest, res: Response): Promise<void> {
  const { patientId } = req.params as { patientId: string };
  const body = req.body as Partial<Record<VitalField, unknown>> & { encounterId?: string; recordedAt?: string };

  const data: Partial<Record<VitalField, number>> = {};
  for (const [field, lim] of Object.entries(LIMITS) as [VitalField, (typeof LIMITS)[VitalField]][]) {
    const raw = body[field];
    if (raw === undefined || raw === null || raw === '') continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < lim.min || n > lim.max || (lim.int && !Number.isInteger(n))) {
      res.status(400).json({ error: `${lim.label} must be ${lim.int ? 'a whole number ' : ''}between ${lim.min} and ${lim.max}` });
      return;
    }
    data[field] = n;
  }
  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: 'Enter at least one vital sign' });
    return;
  }
  if ((data.bloodPressureSystolic === undefined) !== (data.bloodPressureDiastolic === undefined)) {
    res.status(400).json({ error: 'Enter both systolic and diastolic blood pressure' });
    return;
  }
  if (data.bloodPressureSystolic !== undefined && data.bloodPressureSystolic <= data.bloodPressureDiastolic!) {
    res.status(400).json({ error: 'Systolic must be higher than diastolic' });
    return;
  }

  const vital = await prisma.vital.create({
    data: {
      patientId,
      ...data,
      encounterId: body.encounterId || undefined,
      recordedById: req.userId,
      recordedAt: body.recordedAt ? new Date(body.recordedAt) : undefined,
    },
    include: { recordedBy: RECORDED_BY },
  });
  void chargeConsultationFee(patientId, vital.encounterId, req.userId);   // visit started: consultation fee
  res.status(201).json({ ...vital, bmi: calcBmi(vital.weight, vital.height) });
}
