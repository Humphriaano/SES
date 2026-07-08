import crypto from 'crypto';
import prisma from '../lib/prisma';
import { sendEmail } from '../lib/email';
import { magicLinkEmail } from '../lib/emailTemplates';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, sliding
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes, single-use

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function randomToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

async function logAuthEvent(event: string, opts: { patientId?: string; email?: string; ip?: string; userAgent?: string }): Promise<void> {
  await prisma.authAuditLog.create({
    data: {
      event,
      patientId: opts.patientId,
      email: opts.email,
      ip: opts.ip,
      userAgent: opts.userAgent,
    },
  });
}

/**
 * Identifies the patient by email and, if portal access is enabled, emails a
 * single-use magic link. Always resolves the same way regardless of whether
 * the email matched — callers must show a neutral message either way so the
 * response can't be used to enumerate registered patients.
 */
export async function requestMagicLink(
  email: string, purpose: 'login' | 'invitation',
  ctx: { ip?: string; userAgent?: string; portalUrl: string },
): Promise<void> {
  await logAuthEvent('LINK_REQUESTED', { email, ip: ctx.ip, userAgent: ctx.userAgent });

  const patient = await prisma.patient.findFirst({ where: { email, portalEnabled: true } });
  if (!patient) return; // neutral: caller shows the same message regardless

  const raw = randomToken();
  await prisma.magicLinkToken.create({
    data: {
      patientId: patient.id,
      tokenHash: hashToken(raw),
      purpose,
      expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
    },
  });

  const url = `${ctx.portalUrl}/auth/callback?token=${raw}`;
  const { subject, html } = magicLinkEmail({ firstName: patient.preferredName || patient.firstName, url, purpose });
  await sendEmail({ to: email, subject, html });
  await logAuthEvent('LINK_SENT', { patientId: patient.id, email, ip: ctx.ip, userAgent: ctx.userAgent });
}

export interface ExchangeResult {
  sessionToken: string;
  patientId: string;
  expiresAt: Date;
}

/**
 * Exchanges a single-use magic-link token for a portal session. The token is
 * marked used on the very first lookup (not after success) so a token can
 * never be replayed even if the rest of the exchange fails.
 */
export async function exchangeMagicLink(
  rawToken: string, ctx: { ip?: string; userAgent?: string },
): Promise<ExchangeResult | null> {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.magicLinkToken.findUnique({ where: { tokenHash } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    await logAuthEvent('LOGIN_FAILED', { ip: ctx.ip, userAgent: ctx.userAgent });
    return null;
  }
  await prisma.magicLinkToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });

  const session = await createSession(record.patientId, ctx.userAgent);
  await prisma.patient.update({ where: { id: record.patientId }, data: { portalLastSeenAt: new Date() } });
  await logAuthEvent('LOGIN_SUCCESS', { patientId: record.patientId, ip: ctx.ip, userAgent: ctx.userAgent });
  return session;
}

export async function createSession(patientId: string, userAgent?: string): Promise<ExchangeResult> {
  const raw = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.portalSession.create({
    data: { patientId, tokenHash: hashToken(raw), expiresAt, userAgent },
  });
  return { sessionToken: raw, patientId, expiresAt };
}

export interface VerifiedSession {
  patientId: string;
  sessionId: string;
}

/**
 * Verifies a session token and, if valid, slides its expiry forward from now
 * so patients who open the app between monthly visits stay signed in.
 */
export async function verifySession(rawToken: string): Promise<VerifiedSession | null> {
  const tokenHash = hashToken(rawToken);
  const session = await prisma.portalSession.findUnique({ where: { tokenHash } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;

  const newExpiry = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.portalSession.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date(), expiresAt: newExpiry },
  });
  return { patientId: session.patientId, sessionId: session.id };
}

export async function revokeSession(rawToken: string, ctx: { ip?: string; userAgent?: string }): Promise<void> {
  const tokenHash = hashToken(rawToken);
  const session = await prisma.portalSession.findUnique({ where: { tokenHash } });
  if (!session) return;
  await prisma.portalSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  await logAuthEvent('LOGOUT', { patientId: session.patientId, ip: ctx.ip, userAgent: ctx.userAgent });
}

export { MAGIC_LINK_TTL_MS, SESSION_TTL_MS };
