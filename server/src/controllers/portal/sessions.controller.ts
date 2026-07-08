import crypto from 'crypto';
import { Response } from 'express';
import prisma from '../../lib/prisma';
import { PortalRequest, PORTAL_SESSION_COOKIE } from '../../middleware/portalAuth';

export async function listSessions(req: PortalRequest, res: Response): Promise<void> {
  const sessions = await prisma.portalSession.findMany({
    where: { patientId: req.patientId, revokedAt: null, expiresAt: { gte: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, tokenHash: true, userAgent: true, createdAt: true, lastSeenAt: true },
  });
  const currentToken = req.cookies?.[PORTAL_SESSION_COOKIE];
  const currentHash = currentToken ? crypto.createHash('sha256').update(currentToken).digest('hex') : null;
  res.json(sessions.map(({ tokenHash, ...s }) => ({ ...s, isCurrent: tokenHash === currentHash })));
}
