import webpush from 'web-push';
import prisma from './prisma';

const VAPID_PUBLIC_KEY = process.env['VAPID_PUBLIC_KEY'] ?? '';
const VAPID_PRIVATE_KEY = process.env['VAPID_PRIVATE_KEY'] ?? '';
const VAPID_SUBJECT = process.env['VAPID_SUBJECT'] ?? 'mailto:admin@ses.local';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

export interface PushPayload {
  title: string;
  body: string;
  url: string; // deep link opened on notification click
}

/**
 * Sends a push notification to every device registered for a patient.
 * Best-effort: push is a convenience channel, never the only delivery path
 * for something time-critical (email remains authoritative). Subscriptions
 * that report gone/expired (410/404) are pruned automatically.
 */
export async function sendPushToPatient(patientId: string, payload: PushPayload): Promise<void> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  const subs = await prisma.pushSubscription.findMany({ where: { patientId } });
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      );
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
      }
    }
  }));
}
