import { Response } from 'express';
import { PortalRequest } from '../../middleware/portalAuth';
import { buildCheckInEmailData } from '../../services/checkInEmail.service';

export async function getDashboard(req: PortalRequest, res: Response): Promise<void> {
  const data = await buildCheckInEmailData(req.patientId as string);
  if (!data) { res.status(404).json({ error: 'Patient not found' }); return; }
  res.json(data);
}
