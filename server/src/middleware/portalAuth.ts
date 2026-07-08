import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { verifySession } from '../services/portalAuth.service';

export const PORTAL_SESSION_COOKIE = 'ses_portal_session';

export interface PortalRequest extends Request {
  patientId?: string;
}

/**
 * Resolves the authenticated patient strictly from the session cookie. No
 * portal data-fetching route may accept a patientId from the client — this
 * is the only place identity enters the request.
 */
export async function requirePortalSession(req: PortalRequest, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[PORTAL_SESSION_COOKIE];
  if (!token) { res.status(401).json({ error: 'Not signed in' }); return; }

  const session = await verifySession(token);
  if (!session) { res.status(401).json({ error: 'Session expired — please sign in again' }); return; }

  req.patientId = session.patientId;
  next();
}

/**
 * Endpoint-level access audit: records which patient fetched what and when.
 * Attach after requirePortalSession so req.patientId is set.
 */
export function auditPortalAccess(req: PortalRequest, res: Response, next: NextFunction): void {
  if (req.patientId) {
    prisma.portalAccessLog.create({
      data: { patientId: req.patientId, method: req.method, endpoint: req.baseUrl + req.path },
    }).catch(() => {});
  }
  next();
}
