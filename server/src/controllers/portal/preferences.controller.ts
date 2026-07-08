import { Response } from 'express';
import prisma from '../../lib/prisma';
import { PortalRequest } from '../../middleware/portalAuth';

export async function getPreferences(req: PortalRequest, res: Response): Promise<void> {
  const patient = await prisma.patient.findUnique({
    where: { id: req.patientId },
    select: { emailOptedIn: true },
  });
  if (!patient) { res.status(404).json({ error: 'Patient not found' }); return; }
  res.json(patient);
}

export async function updatePreferences(req: PortalRequest, res: Response): Promise<void> {
  const { emailOptedIn } = req.body as { emailOptedIn?: boolean };
  if (typeof emailOptedIn !== 'boolean') { res.status(400).json({ error: 'emailOptedIn must be a boolean' }); return; }
  const patient = await prisma.patient.update({
    where: { id: req.patientId },
    data: { emailOptedIn },
    select: { emailOptedIn: true },
  });
  res.json(patient);
}
