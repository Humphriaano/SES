import cron from 'node-cron';
import { runAppointmentReminders } from './appointmentReminders.job';
import { runMonthlyCheckIn } from './monthlyCheckIn.job';

/**
 * Registers the two scheduled jobs described in the portal brief:
 * - Appointment reminders: daily, for appointments 48h out and unconfirmed.
 * - Monthly check-in: first of the month, alongside the existing email flow.
 */
export function startScheduledJobs(): void {
  cron.schedule('0 8 * * *', () => {
    runAppointmentReminders().catch((err) => console.error('Appointment reminder job failed:', err));
  });

  cron.schedule('0 7 1 * *', () => {
    runMonthlyCheckIn().catch((err) => console.error('Monthly check-in job failed:', err));
  });
}
