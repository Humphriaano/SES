import prisma from '../lib/prisma';
import { sendEmail } from '../lib/email';
import { appointmentReminderEmail } from '../lib/emailTemplates';
import { sendPushToPatient } from '../lib/push';

const PORTAL_URL = process.env['PORTAL_URL'] ?? 'http://localhost:5174';

/**
 * Sends a reminder for appointments 48 hours out that are still unconfirmed.
 * Idempotent per appointment via reminderSentAt, so re-running the job (e.g.
 * after a restart) never double-sends. Push is best-effort; email is the
 * reliable channel and always attempted regardless of portal enrolment.
 */
export async function runAppointmentReminders(now = new Date()): Promise<void> {
  const windowStart = new Date(now.getTime() + 47 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 49 * 60 * 60 * 1000);

  const appointments = await prisma.appointment.findMany({
    where: {
      status: 'SCHEDULED',
      reminderSentAt: null,
      scheduledAt: { gte: windowStart, lte: windowEnd },
    },
    include: { patient: true },
  });

  for (const appt of appointments) {
    const dateLabel = appt.scheduledAt.toLocaleString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false,
    });

    if (appt.patient.email && appt.patient.emailOptedIn) {
      const { subject, html } = appointmentReminderEmail({
        firstName: appt.patient.preferredName || appt.patient.firstName,
        dateLabel, clinicName: appt.clinicName,
        url: `${PORTAL_URL}/appointments`,
      });
      await sendEmail({ to: appt.patient.email, subject, html }).catch((err) => {
        console.error(`Failed to send appointment reminder to patient ${appt.patientId}:`, err.message);
      });
    }

    if (appt.patient.portalEnabled) {
      await sendPushToPatient(appt.patientId, {
        title: 'Upcoming appointment',
        body: `${dateLabel} at ${appt.clinicName} — tap to confirm`,
        url: '/appointments',
      }).catch(() => {});
    }

    await prisma.appointment.update({ where: { id: appt.id }, data: { reminderSentAt: now } });
  }
}
