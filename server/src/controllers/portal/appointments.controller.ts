import { Response } from 'express';
import prisma from '../../lib/prisma';
import { PortalRequest } from '../../middleware/portalAuth';

export async function listAppointments(req: PortalRequest, res: Response): Promise<void> {
  const appointments = await prisma.appointment.findMany({
    where: { patientId: req.patientId },
    orderBy: { scheduledAt: 'desc' },
  });
  const now = new Date();
  res.json({
    upcoming: appointments.filter((a) => a.scheduledAt >= now && a.status !== 'CANCELLED').reverse(),
    past: appointments.filter((a) => a.scheduledAt < now || a.status === 'COMPLETED'),
  });
}

// Idempotent: confirming an already-confirmed appointment just returns it as-is.
export async function confirmAppointment(req: PortalRequest, res: Response): Promise<void> {
  const { id } = req.params;
  const appointment = await prisma.appointment.findFirst({ where: { id, patientId: req.patientId } });
  if (!appointment) { res.status(404).json({ error: 'Appointment not found' }); return; }

  if (appointment.status === 'CONFIRMED') { res.json(appointment); return; }
  if (appointment.status !== 'SCHEDULED') { res.status(409).json({ error: 'This appointment can no longer be confirmed' }); return; }

  const updated = await prisma.appointment.update({
    where: { id },
    data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedVia: 'PORTAL' },
  });
  res.json(updated);
}
