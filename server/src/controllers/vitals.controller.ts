import { Request, Response } from 'express';
import prisma from '../lib/prisma';

function calcBmi(weight?: number | null, height?: number | null): number | null {
  if (!weight || !height || height <= 0) return null;
  return parseFloat((weight / ((height / 100) ** 2)).toFixed(1));
}

export async function getVitals(req: Request, res: Response): Promise<void> {
  const { patientId } = req.params;
  const vitals = await prisma.vital.findMany({
    where: { patientId },
    orderBy: { recordedAt: 'asc' },
    take: 50,
  });
  const withBmi = vitals.map(v => ({
    ...v,
    bmi: calcBmi(v.weight, v.height),
  }));
  res.json(withBmi);
}

export async function createVital(req: Request, res: Response): Promise<void> {
  const { patientId } = req.params;
  const body = req.body as {
    encounterId?: string;
    bloodPressureSystolic?: number; bloodPressureDiastolic?: number;
    heartRate?: number; temperature?: number; weight?: number;
    height?: number; oxygenSat?: number; glucose?: number;
  };
  const vital = await prisma.vital.create({ data: { patientId, ...body } });
  res.status(201).json({
    ...vital,
    bmi: calcBmi(vital.weight, vital.height),
  });
}
