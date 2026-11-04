import { Request as ExpressRequest, Response } from 'express';
// Route params are always single strings in these routes (no wildcards).
type Request = ExpressRequest<Record<string, string>>;
import prisma from '../lib/prisma';

export async function getBillingItems(req: Request, res: Response): Promise<void> {
  const { patientId } = req.params;
  const items = await prisma.billingItem.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    include: { encounter: { select: { id: true, createdAt: true } } },
  });
  res.json(items);
}

export async function createBillingItem(req: Request, res: Response): Promise<void> {
  const { patientId } = req.params;
  const data = req.body as { encounterId?: string; description: string; amount: number };
  const item = await prisma.billingItem.create({ data: { patientId, ...data } });
  res.status(201).json(item);
}

export async function updateBillingStatus(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { status } = req.body as { status: 'PAID' | 'WAIVED' | 'PENDING' };
  const item = await prisma.billingItem.update({
    where: { id },
    data: { status, paidAt: status === 'PAID' ? new Date() : undefined },
  });
  res.json(item);
}

export async function getPatientBalance(req: Request, res: Response): Promise<void> {
  const { patientId } = req.params;
  const items = await prisma.billingItem.findMany({ where: { patientId } });
  const total = items.reduce((sum, i) => sum + i.amount, 0);
  const paid = items.filter(i => i.status === 'PAID').reduce((sum, i) => sum + i.amount, 0);
  res.json({ total, paid, balance: total - paid });
}
