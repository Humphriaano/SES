import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { requestMagicLink, exchangeMagicLink, revokeSession } from '../../services/portalAuth.service';
import { PORTAL_SESSION_COOKIE, PortalRequest } from '../../middleware/portalAuth';
import { isTrustedOrigin } from '../../lib/trustedOrigins';

const PORTAL_URL = process.env['PORTAL_URL'] ?? 'http://localhost:5175';
const isProd = process.env['NODE_ENV'] === 'production';

const NEUTRAL_MESSAGE = { message: "If this email is registered for portal access, we've sent a sign-in link." };

function cookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    expires: expiresAt,
    path: '/',
  };
}

// The patient may be on the configured PORTAL_URL, a LAN IP, or a Cloudflare
// quick tunnel — build the magic link against whichever one they're actually
// browsing from (via the request's own Origin header) rather than always the
// static env var, so a link requested from a phone on the tunnel doesn't
// point back at this machine's localhost.
function resolvePortalUrl(req: Request): string {
  const origin = req.headers.origin;
  return isTrustedOrigin(origin, [PORTAL_URL]) ? origin! : PORTAL_URL;
}

export async function requestLink(req: Request, res: Response): Promise<void> {
  const { email } = req.body as { email?: string };
  if (!email || typeof email !== 'string') { res.status(400).json({ error: 'Email is required' }); return; }

  await requestMagicLink(email.trim().toLowerCase(), 'login', {
    ip: req.ip, userAgent: req.headers['user-agent'], portalUrl: resolvePortalUrl(req),
  });
  // Same response whether or not the email matched a registered patient.
  res.json(NEUTRAL_MESSAGE);
}

export async function exchangeLink(req: Request, res: Response): Promise<void> {
  const { token } = req.body as { token?: string };
  if (!token) { res.status(400).json({ error: 'Token is required' }); return; }

  const result = await exchangeMagicLink(token, { ip: req.ip, userAgent: req.headers['user-agent'] });
  if (!result) { res.status(401).json({ error: 'This link is invalid or has expired. Please request a new one.' }); return; }

  res.cookie(PORTAL_SESSION_COOKIE, result.sessionToken, cookieOptions(result.expiresAt));
  res.json({ ok: true });
}

export async function logout(req: PortalRequest, res: Response): Promise<void> {
  const token = req.cookies?.[PORTAL_SESSION_COOKIE];
  if (token) await revokeSession(token, { ip: req.ip, userAgent: req.headers['user-agent'] });
  res.clearCookie(PORTAL_SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
}

export async function me(req: PortalRequest, res: Response): Promise<void> {
  const patient = await prisma.patient.findUnique({
    where: { id: req.patientId },
    select: { id: true, firstName: true, preferredName: true, email: true },
  });
  if (!patient) { res.status(404).json({ error: 'Patient not found' }); return; }
  res.json({ id: patient.id, name: patient.preferredName || patient.firstName, email: patient.email });
}
