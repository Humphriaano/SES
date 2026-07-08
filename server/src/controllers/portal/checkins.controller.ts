import { Response } from 'express';
import prisma from '../../lib/prisma';
import { PortalRequest } from '../../middleware/portalAuth';

export async function listCheckIns(req: PortalRequest, res: Response): Promise<void> {
  const emails = await prisma.patientCheckInEmail.findMany({
    where: { patientId: req.patientId },
    orderBy: { sentAt: 'desc' },
    select: { id: true, subject: true, sentAt: true },
  });
  res.json(emails);
}

export async function getCheckIn(req: PortalRequest, res: Response): Promise<void> {
  const { id } = req.params;
  const email = await prisma.patientCheckInEmail.findFirst({ where: { id, patientId: req.patientId } });
  if (!email) { res.status(404).json({ error: 'Check-in not found' }); return; }
  res.json(email);
}
