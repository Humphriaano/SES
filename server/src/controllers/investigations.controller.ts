import { Request as ExpressRequest, Response } from 'express';
// Route params are always single strings in these routes (no wildcards).
type Request = ExpressRequest<Record<string, string>>;
import prisma from '../lib/prisma';

export async function getLabOrders(req: Request, res: Response): Promise<void> {
  const { encounterId } = req.params;
  const orders = await prisma.labOrder.findMany({
    where: { encounterId },
    include: { results: true },
    orderBy: { orderedAt: 'desc' },
  });
  res.json(orders);
}

export async function createLabOrder(req: Request, res: Response): Promise<void> {
  const { encounterId } = req.params;
  const { testName, notes } = req.body as { testName: string; notes?: string };
  const order = await prisma.labOrder.create({ data: { encounterId, testName, notes } });
  res.status(201).json(order);
}

export async function getLabResults(req: Request, res: Response): Promise<void> {
  const { patientId } = req.params;
  const results = await prisma.labResult.findMany({
    where: { patientId },
    orderBy: { recordedAt: 'desc' },
    take: 50,
  });
  res.json(results);
}

export async function createLabResult(req: Request, res: Response): Promise<void> {
  const { patientId } = req.params;
  const data = req.body as {
    labOrderId?: string; testName: string; result: string;
    unit?: string; referenceRange?: string; isAbnormal?: boolean;
  };
  // Mark order as completed if linked
  if (data.labOrderId) {
    await prisma.labOrder.update({ where: { id: data.labOrderId }, data: { status: 'completed' } });
  }
  const result = await prisma.labResult.create({ data: { patientId, ...data } });
  res.status(201).json(result);
}
