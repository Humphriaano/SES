import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { bumpPreference } from './user.room.preference.controller';

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

// Stored as 'Normal' (shown to staff as "Standard"). Lower rank = served first.
const PRIORITY_RANK: Record<string, number> = { Emergency: 0, Urgent: 1, Normal: 2 };
// 'Removed' = taken off the queue without being seen (wrong room, left, duplicate); hidden everywhere.
const STATUS_RANK: Record<string, number> = { Waiting: 0, 'In Progress': 1, Done: 2, Removed: 3 };
const ACTIVE = ['Waiting', 'In Progress'];

const PATIENT_SELECT = {
  id: true, firstName: true, lastName: true, dateOfBirth: true,
  gender: true, phone: true, address: true, nationalId: true,
  hivStatus: true, createdAt: true, updatedAt: true,
};
const STARTED_BY = { select: { id: true, name: true } };
const WITH_ROOM_PATIENT = { room: true, patient: { select: PATIENT_SELECT }, startedBy: STARTED_BY };

interface Sortable { status: string; priority: string; queueNumber: number }

// Waiting patients by priority (emergency first) then arrival; being-seen after; done last.
function compareEntries(a: Sortable, b: Sortable): number {
  return (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9)
    || (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
    || a.queueNumber - b.queueNumber;
}

// Where an entry stands among those still waiting in its room: position 1 = next up.
async function withPosition<T extends { id: string; roomId: string; status: string; priority: string; queueNumber: number }>(entry: T) {
  if (entry.status !== 'Waiting') return { ...entry, position: null as number | null, ahead: 0 };
  const waiting = await prisma.queueEntry.findMany({
    where: { roomId: entry.roomId, status: 'Waiting', checkedInAt: { gte: todayStart() } },
    select: { id: true, status: true, priority: true, queueNumber: true },
  });
  const sorted = waiting.sort(compareEntries);
  const idx = sorted.findIndex((e) => e.id === entry.id);
  return { ...entry, position: idx + 1, ahead: Math.max(idx, 0) };
}

function validPriority(p: unknown): p is string {
  return typeof p === 'string' && p in PRIORITY_RANK;
}

// GET /queue — today's entries in service order.
//   ?roomId=  one service point        ?status=active|done|all (default all)     ?limit= (default 300, max 1000)
export async function getEntries(req: AuthRequest, res: Response): Promise<void> {
  const roomId = req.query.roomId ? String(req.query.roomId) : undefined;
  const mode = String(req.query.status ?? 'all');
  const limit = Math.min(Math.max(Number(req.query.limit) || 300, 1), 1000);
  const status = mode === 'active' ? { in: ACTIVE } : mode === 'done' ? { equals: 'Done' } : { not: 'Removed' };
  const entries = await prisma.queueEntry.findMany({
    where: { checkedInAt: { gte: todayStart() }, status, ...(roomId ? { roomId } : {}) },
    include: WITH_ROOM_PATIENT,
    // Done lists show the most recently seen first; live queues are ordered in memory below.
    ...(mode === 'done' ? { orderBy: { updatedAt: 'desc' as const }, take: limit } : {}),
  });
  res.json(entries.sort(compareEntries).slice(0, limit));
}

// GET /queue/summary?roomId= — counts for the tab badges without loading every row
export async function getQueueSummary(req: AuthRequest, res: Response): Promise<void> {
  const roomId = req.query.roomId ? String(req.query.roomId) : undefined;
  const rows = await prisma.queueEntry.groupBy({
    by: ['status', 'priority'],
    where: { checkedInAt: { gte: todayStart() }, status: { not: 'Removed' }, ...(roomId ? { roomId } : {}) },
    _count: { _all: true },
  });
  const out = { waiting: 0, inProgress: 0, done: 0, urgent: 0, emergency: 0 };
  for (const r of rows) {
    const n = r._count._all;
    if (r.status === 'Waiting') {
      out.waiting += n;
      if (r.priority === 'Urgent') out.urgent += n;
      if (r.priority === 'Emergency') out.emergency += n;
    } else if (r.status === 'In Progress') out.inProgress += n;
    else if (r.status === 'Done') out.done += n;
  }
  res.json(out);
}

// GET /queue/patient/:patientId — the patient's active entry today (or null), with position
export async function getPatientEntry(req: AuthRequest, res: Response): Promise<void> {
  const { patientId } = req.params as { patientId: string };
  const entry = await prisma.queueEntry.findFirst({
    where: { patientId, status: { in: ACTIVE }, checkedInAt: { gte: todayStart() } },
    include: { room: true, startedBy: STARTED_BY },
    orderBy: { checkedInAt: 'desc' },
  });
  res.json(entry ? await withPosition(entry) : null);
}

// POST /queue/checkin — assign a patient to a room with a priority
export async function checkin(req: AuthRequest, res: Response): Promise<void> {
  if (!canModify(req.userRole)) { res.status(403).json({ error: 'Not authorized' }); return; }
  const { patientId, roomId, priority } = req.body as {
    patientId: string; roomId: string; priority?: string;
  };
  if (typeof patientId !== 'string' || typeof roomId !== 'string' || !patientId || !roomId) { res.status(400).json({ error: 'patientId and roomId are required' }); return; }
  const level = priority ?? 'Normal';
  if (!validPriority(level)) { res.status(400).json({ error: 'Priority must be Standard, Urgent or Emergency' }); return; }

  const [patient, room, existing] = await Promise.all([
    prisma.patient.findUnique({ where: { id: patientId } }),
    prisma.facilityRoom.findUnique({ where: { id: roomId } }),
    prisma.queueEntry.findFirst({
      where: { patientId, status: { in: ACTIVE }, checkedInAt: { gte: todayStart() } },
      include: { room: true },
    }),
  ]);
  if (!patient) { res.status(404).json({ error: 'Patient not found' }); return; }
  if (!room) { res.status(404).json({ error: 'Room not found' }); return; }
  if (!room.active) { res.status(400).json({ error: 'Room is not active' }); return; }

  // One place in the queue per patient: the client offers to move them instead.
  if (existing) {
    res.status(409).json({
      error: `${patient.firstName} ${patient.lastName} is already in ${existing.room.name} (${existing.status.toLowerCase()}).`,
      entry: await withPosition(existing),
    });
    return;
  }

  const count = await prisma.queueEntry.count({ where: { checkedInAt: { gte: todayStart() } } });
  const entry = await prisma.queueEntry.create({
    data: {
      queueNumber: count + 1,
      patientId,
      patientName: `${patient.firstName} ${patient.lastName}`,
      roomId,
      priority: level,
      status: 'Waiting',
    },
    include: WITH_ROOM_PATIENT,
  });
  void bumpPreference(req.userId, roomId);
  res.status(201).json(await withPosition(entry));
}

// PATCH /queue/:entryId/status
export async function updateStatus(req: AuthRequest, res: Response): Promise<void> {
  if (!canModify(req.userRole)) { res.status(403).json({ error: 'Not authorized' }); return; }
  const { entryId } = req.params as { entryId: string };
  const { status } = req.body as { status: string };
  if (!(status in STATUS_RANK)) { res.status(400).json({ error: 'Invalid status' }); return; }
  const current = await prisma.queueEntry.findUnique({ where: { id: entryId }, select: { startedAt: true } });
  if (!current) { res.status(404).json({ error: 'Queue entry not found' }); return; }
  // Waiting time stops the moment the patient is first seen (even if marked done in one step).
  const startedAt = status === 'In Progress' || status === 'Done' ? (current.startedAt ?? new Date()) : current.startedAt;
  const entry = await prisma.queueEntry.update({
    where: { id: entryId },
    data: { status, startedAt },
    include: { room: true },
  });
  res.json(entry);
}

// PATCH /queue/:entryId/reroute — move to a different room and/or change priority, back to Waiting
export async function rerouteEntry(req: AuthRequest, res: Response): Promise<void> {
  if (!canModify(req.userRole)) { res.status(403).json({ error: 'Not authorized' }); return; }
  const { entryId } = req.params as { entryId: string };
  const { roomId, priority } = req.body as { roomId: string; priority?: string };
  if (typeof roomId !== 'string' || !roomId) { res.status(400).json({ error: 'roomId is required' }); return; }
  if (priority !== undefined && !validPriority(priority)) {
    res.status(400).json({ error: 'Priority must be Standard, Urgent or Emergency' }); return;
  }
  const room = await prisma.facilityRoom.findUnique({ where: { id: roomId } });
  if (!room) { res.status(404).json({ error: 'Room not found' }); return; }
  if (!room.active) { res.status(400).json({ error: 'Room is not active' }); return; }
  const entry = await prisma.queueEntry.update({
    where: { id: entryId },
    data: { roomId, status: 'Waiting', startedAt: null, startedById: null, ...(priority ? { priority } : {}) },
    include: WITH_ROOM_PATIENT,
  });
  void bumpPreference(req.userId, roomId);
  res.json(await withPosition(entry));
}

// Claims a waiting entry for this user in one atomic step, so two staff can never both take the same patient.
// Optionally moves them into `moveToRoomId` in the same step — a patient sent to one room who walks into another.
// Their queue number and arrival time are kept, so the waiting time stays honest.
async function claim(entryId: string, userId: string | undefined, moveToRoomId?: string) {
  const { count } = await prisma.queueEntry.updateMany({
    where: { id: entryId, status: 'Waiting' },
    data: { status: 'In Progress', startedAt: new Date(), startedById: userId ?? null, ...(moveToRoomId ? { roomId: moveToRoomId } : {}) },
  });
  return count === 1;
}

// PATCH /queue/:entryId/start — claim the patient (In Progress) and return the full patient
export async function startEntry(req: AuthRequest, res: Response): Promise<void> {
  if (!canModify(req.userRole)) { res.status(403).json({ error: 'Not authorized' }); return; }
  const { entryId } = req.params as { entryId: string };
  const { roomId } = (req.body ?? {}) as { roomId?: string };
  if (roomId) {
    const target = await prisma.facilityRoom.findUnique({ where: { id: roomId } });
    if (!target) { res.status(404).json({ error: 'Room not found' }); return; }
    if (!target.active) { res.status(400).json({ error: `${target.name} is not active` }); return; }
  }
  const won = await claim(entryId, req.userId, roomId);
  const entry = await prisma.queueEntry.findUnique({ where: { id: entryId }, include: WITH_ROOM_PATIENT });
  if (!entry) { res.status(404).json({ error: 'Queue entry not found' }); return; }
  if (!won && entry.status === 'In Progress' && entry.startedById && entry.startedById !== req.userId) {
    res.status(409).json({ error: `${entry.startedBy?.name ?? 'Another staff member'} is already seeing ${entry.patientName}.` });
    return;
  }
  if (!won && entry.status !== 'In Progress') {
    res.status(409).json({ error: `${entry.patientName} is no longer waiting (${entry.status.toLowerCase()}).` });
    return;
  }
  res.json(entry);   // reopening your own in-progress patient is fine
}

// POST /queue/rooms/:roomId/next — take whoever is first in line in this service point
export async function callNext(req: AuthRequest, res: Response): Promise<void> {
  if (!canModify(req.userRole)) { res.status(403).json({ error: 'Not authorized' }); return; }
  const { roomId } = req.params as { roomId: string };
  const room = await prisma.facilityRoom.findUnique({ where: { id: roomId } });
  if (!room) { res.status(404).json({ error: 'Room not found' }); return; }

  for (let attempt = 0; attempt < 4; attempt++) {
    const waiting = await prisma.queueEntry.findMany({
      where: { roomId, status: 'Waiting', checkedInAt: { gte: todayStart() } },
      select: { id: true, status: true, priority: true, queueNumber: true },
    });
    if (waiting.length === 0) { res.status(404).json({ error: `No one is waiting in ${room.name}.` }); return; }
    const next = waiting.sort(compareEntries)[0];
    if (await claim(next.id, req.userId)) {
      const entry = await prisma.queueEntry.findUnique({ where: { id: next.id }, include: WITH_ROOM_PATIENT });
      res.json(entry);
      return;
    }
    // someone else took them a moment ago — try the next one
  }
  res.status(409).json({ error: 'The queue is changing quickly — try again.' });
}
