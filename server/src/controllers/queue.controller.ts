import { Request as ExpressRequest, Response } from 'express';
// Route params are always single strings in these routes (no wildcards).
type Request = ExpressRequest<Record<string, string>>;
import prisma from '../lib/prisma';

const SERVICE_POINTS = ['REGISTRY', 'VITALS', 'CONSULTATION', 'PHARMACY', 'LAB', 'BILLING'] as const;

export async function getQueueCounts(_req: Request, res: Response): Promise<void> {
  const counts = await prisma.queue.groupBy({
    by: ['servicePoint'],
    where: { status: { in: ['WAITING', 'CALLED', 'IN_PROGRESS'] } },
    _count: { id: true },
  });

  const result: Record<string, number> = {};
  SERVICE_POINTS.forEach((sp) => { result[sp] = 0; });
  counts.forEach((c) => { result[c.servicePoint] = c._count.id; });
  res.json(result);
}

export async function getQueue(req: Request, res: Response): Promise<void> {
  const { servicePoint } = req.params;
  const queue = await prisma.queue.findMany({
    where: { servicePoint: servicePoint as any, status: { in: ['WAITING', 'CALLED', 'IN_PROGRESS'] } },
    include: { patient: { select: { id: true, firstName: true, lastName: true, nationalId: true } } },
    orderBy: [{ priority: 'desc' }, { addedAt: 'asc' }],
  });
  res.json(queue);
}

export async function addToQueue(req: Request, res: Response): Promise<void> {
  const { patientId, servicePoint, priority, notes } = req.body as {
    patientId: string; servicePoint: string; priority?: number; notes?: string;
  };

  // Prevent duplicate active entries for same patient + service point
  const existing = await prisma.queue.findFirst({
    where: { patientId, servicePoint: servicePoint as any, status: { in: ['WAITING', 'CALLED', 'IN_PROGRESS'] } },
  });
  if (existing) { res.status(409).json({ error: 'Patient already in this queue' }); return; }

  const entry = await prisma.queue.create({
    data: { patientId, servicePoint: servicePoint as any, priority: priority ?? 0, notes },
    include: { patient: { select: { id: true, firstName: true, lastName: true, nationalId: true } } },
  });
  res.status(201).json(entry);
}

export async function updateQueueStatus(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { status } = req.body as { status: string };

  const data: Record<string, any> = { status };
  if (status === 'CALLED' || status === 'IN_PROGRESS') data['calledAt'] = new Date();
  if (status === 'COMPLETED' || status === 'CANCELLED') data['completedAt'] = new Date();

  const entry = await prisma.queue.update({ where: { id }, data });
  res.json(entry);
}

export async function removeFromQueue(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  await prisma.queue.update({ where: { id }, data: { status: 'CANCELLED', completedAt: new Date() } });
  res.json({ ok: true });
}

export async function getPatientQueue(req: Request, res: Response): Promise<void> {
  const { patientId } = req.params;
  const entries = await prisma.queue.findMany({
    where: { patientId, status: { in: ['WAITING', 'CALLED', 'IN_PROGRESS'] } },
    orderBy: { addedAt: 'asc' },
  });
  res.json(entries);
}
