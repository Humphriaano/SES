import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';

const MODIFIER_ROLES = ['admin', 'clinician', 'nurse', 'receptionist'];

function canModify(role: string | undefined): boolean {
  if (!role) return false;
  return role.split(',').map(r => r.trim()).some(r => MODIFIER_ROLES.includes(r));
}

function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const PATIENT_SELECT = {
  id: true, firstName: true, lastName: true, dateOfBirth: true,
  gender: true, phone: true, address: true, nationalId: true,
  hivStatus: true, createdAt: true, updatedAt: true,
};

// GET /queue — today's entries, optional ?roomId=
export async function getEntries(req: AuthRequest, res: Response): Promise<void> {
  const roomId = req.query.roomId ? String(req.query.roomId) : undefined;
  const entries = await prisma.queueEntry.findMany({
    where: {
      checkedInAt: { gte: todayStart() },
      ...(roomId ? { roomId } : {}),
    },
    include: { room: true, patient: { select: PATIENT_SELECT } },
    orderBy: { checkedInAt: 'asc' },
  });
  res.json(entries);
}

// POST /queue/checkin
export async function checkin(req: AuthRequest, res: Response): Promise<void> {
  if (!canModify(req.userRole)) { res.status(403).json({ error: 'Not authorized' }); return; }
  const { patientId, roomId, priority } = req.body as {
    patientId: string; roomId: string; priority?: string;
  };
  if (!patientId || !roomId) { res.status(400).json({ error: 'patientId and roomId are required' }); return; }

  const [patient, room] = await Promise.all([
    prisma.patient.findUnique({ where: { id: patientId } }),
    prisma.facilityRoom.findUnique({ where: { id: roomId } }),
  ]);
  if (!patient) { res.status(404).json({ error: 'Patient not found' }); return; }
  if (!room) { res.status(404).json({ error: 'Room not found' }); return; }
  if (!room.active) { res.status(400).json({ error: 'Room is not active' }); return; }

  const count = await prisma.queueEntry.count({ where: { checkedInAt: { gte: todayStart() } } });

  const entry = await prisma.queueEntry.create({
    data: {
      queueNumber: count + 1,
      patientId,
      patientName: `${patient.firstName} ${patient.lastName}`,
      roomId,
      priority: priority || 'Normal',
      status: 'Waiting',
    },
    include: { room: true, patient: { select: PATIENT_SELECT } },
  });
  res.status(201).json(entry);
}

// PATCH /queue/:entryId/status
export async function updateStatus(req: AuthRequest, res: Response): Promise<void> {
  if (!canModify(req.userRole)) { res.status(403).json({ error: 'Not authorized' }); return; }
  const { entryId } = req.params as { entryId: string };
  const { status } = req.body as { status: string };
  const entry = await prisma.queueEntry.update({
    where: { id: entryId },
    data: { status },
    include: { room: true },
  });
  res.json(entry);
}

// PATCH /queue/:entryId/reroute — move to different room, reset to Waiting
export async function rerouteEntry(req: AuthRequest, res: Response): Promise<void> {
  if (!canModify(req.userRole)) { res.status(403).json({ error: 'Not authorized' }); return; }
  const { entryId } = req.params as { entryId: string };
  const { roomId } = req.body as { roomId: string };
  if (!roomId) { res.status(400).json({ error: 'roomId is required' }); return; }
  const room = await prisma.facilityRoom.findUnique({ where: { id: roomId } });
  if (!room) { res.status(404).json({ error: 'Room not found' }); return; }
  const entry = await prisma.queueEntry.update({
    where: { id: entryId },
    data: { roomId, status: 'Waiting' },
    include: { room: true },
  });
  res.json(entry);
}

// PATCH /queue/:entryId/start — set In Progress and return full patient for active session
export async function startEntry(req: AuthRequest, res: Response): Promise<void> {
  if (!canModify(req.userRole)) { res.status(403).json({ error: 'Not authorized' }); return; }
  const { entryId } = req.params as { entryId: string };
  const entry = await prisma.queueEntry.update({
    where: { id: entryId },
    data: { status: 'In Progress' },
    include: { room: true, patient: { select: PATIENT_SELECT } },
  });
  res.json(entry);
}
