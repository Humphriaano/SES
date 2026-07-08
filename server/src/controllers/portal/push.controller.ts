import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { PortalRequest } from '../../middleware/portalAuth';

export function getVapidPublicKey(_req: Request, res: Response): void {
  res.json({ publicKey: process.env['VAPID_PUBLIC_KEY'] ?? null });
}

export async function subscribe(req: PortalRequest, res: Response): Promise<void> {
  const { endpoint, keys } = req.body as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!endpoint || !keys?.p256dh || !keys?.auth) { res.status(400).json({ error: 'Invalid subscription' }); return; }

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { patientId: req.patientId as string, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: req.headers['user-agent'] },
    update: { patientId: req.patientId as string, p256dh: keys.p256dh, auth: keys.auth },
  });
  res.status(201).json({ ok: true });
}

export async function unsubscribe(req: PortalRequest, res: Response): Promise<void> {
  const { endpoint } = req.body as { endpoint?: string };
  if (!endpoint) { res.status(400).json({ error: 'endpoint is required' }); return; }
  await prisma.pushSubscription.deleteMany({ where: { endpoint, patientId: req.patientId } });
  res.json({ ok: true });
}
