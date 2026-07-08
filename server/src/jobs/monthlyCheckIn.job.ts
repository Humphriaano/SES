import prisma from '../lib/prisma';
import { sendEmail } from '../lib/email';
import { checkInEmailTemplate } from '../lib/checkInEmailTemplate';
import { sendPushToPatient } from '../lib/push';
import { buildCheckInEmailData } from '../services/checkInEmail.service';

const PORTAL_URL = process.env['PORTAL_URL'] ?? 'http://localhost:5174';

/**
 * Sends the monthly check-in email to every opted-in patient with an email
 * on file, logging a snapshot of the data used to render it (so the portal's
 * "My check-ins" screen can re-render past months). Portal-enabled patients
 * also get a deep-linking push notice alongside the email.
 */
export async function runMonthlyCheckIn(): Promise<void> {
  const patients = await prisma.patient.findMany({
    where: { email: { not: null }, emailOptedIn: true },
    select: { id: true },
  });

  for (const { id: patientId } of patients) {
    const data = await buildCheckInEmailData(patientId);
    if (!data) continue;

    const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { email: true, portalEnabled: true } });
    if (!patient?.email) continue;

    const { subject, html } = checkInEmailTemplate(data, PORTAL_URL);
    await sendEmail({ to: patient.email, subject, html }).catch((err) => {
      console.error(`Failed to send monthly check-in to patient ${patientId}:`, err.message);
    });

    await prisma.patientCheckInEmail.create({
      data: { patientId, subject, dataSnapshot: data as any },
    });

    if (patient.portalEnabled) {
      await sendPushToPatient(patientId, {
        title: 'Your monthly check-in is ready',
        body: data.focus,
        url: '/',
      }).catch(() => {});
    }
  }
}
