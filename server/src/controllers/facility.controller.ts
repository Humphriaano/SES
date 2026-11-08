import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { FacilityError, getFacility, updateFacility } from '../lib/facility';

// GET /facility-settings: the facility's name, district and reporting policy. Anyone signed in may read it; nothing in it is about a patient.
export async function readFacility(_req: AuthRequest, res: Response): Promise<void> {
  res.json(await getFacility());
}

// PATCH /facility-settings: admin only (checked on the route). Changes are audited.
export async function changeFacility(req: AuthRequest, res: Response): Promise<void> {
  try {
    res.json(await updateFacility((req.body ?? {}) as Record<string, unknown>, req.userId));
  } catch (e) {
    if (e instanceof FacilityError) { res.status(400).json({ error: e.message }); return; }
    console.error('[facility] could not save the facility settings:', e);
    res.status(500).json({ error: 'Could not save the facility settings. Try again.' });
  }
}
