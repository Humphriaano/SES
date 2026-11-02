import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';

function isAdmin(role: string | undefined): boolean {
  return !!(role && role.split(',').map(r => r.trim()).includes('admin'));
}

function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// GET /queue/rooms — active rooms with today's waiting/in-progress count
export async function getActiveRooms(_req: AuthRequest, res: Response): Promise<void> {
  const rooms = await prisma.facilityRoom.findMany({
    where: { active: true },
    include: {
      _count: {
        select: {
          entries: {
            where: {
              status: { in: ['Waiting', 'In Progress'] },
              checkedInAt: { gte: todayStart() },
            },
          },
        },
      },
    },
    orderBy: [{ tag: 'asc' }, { name: 'asc' }],
  });
  res.json(rooms.map(r => ({
    id: r.id, name: r.name, tag: r.tag, active: r.active,
    waitingCount: r._count.entries,
  })));
}

// GET /queue/admin/rooms — all rooms (including inactive) for admin
export async function getAllRooms(_req: AuthRequest, res: Response): Promise<void> {
  const rooms = await prisma.facilityRoom.findMany({
    include: {
      _count: {
        select: {
          entries: {
            where: {
              status: { in: ['Waiting', 'In Progress'] },
              checkedInAt: { gte: todayStart() },
            },
          },
        },
      },
    },
    orderBy: [{ tag: 'asc' }, { name: 'asc' }],
  });
  res.json(rooms.map(r => ({
    id: r.id, name: r.name, tag: r.tag, active: r.active,
    waitingCount: r._count.entries,
  })));
}

// POST /queue/admin/rooms
export async function createRoom(req: AuthRequest, res: Response): Promise<void> {
  if (!isAdmin(req.userRole)) { res.status(403).json({ error: 'Admin only' }); return; }
  const { name, tag } = req.body as { name: string; tag: string };
  if (!name?.trim() || !tag?.trim()) { res.status(400).json({ error: 'name and tag are required' }); return; }
  try {
    const room = await prisma.facilityRoom.create({ data: { name: name.trim(), tag: tag.trim() } });
    res.status(201).json({ ...room, waitingCount: 0 });
  } catch (err: any) {
    if (err?.code === 'P2002') { res.status(409).json({ error: `A room named “${name.trim()}” already exists.` }); return; }
    console.error('[rooms] create failed:', err?.message ?? err);
    res.status(500).json({ error: 'Could not save the room. Please try again.' });
  }
}

// PATCH /queue/admin/rooms/:id
export async function updateRoom(req: AuthRequest, res: Response): Promise<void> {
  if (!isAdmin(req.userRole)) { res.status(403).json({ error: 'Admin only' }); return; }
  const { id } = req.params as { id: string };
  const { name, tag, active } = req.body as { name?: string; tag?: string; active?: boolean };
  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name.trim();
  if (tag !== undefined) data.tag = tag.trim();
  if (active !== undefined) data.active = active;
  try {
    const room = await prisma.facilityRoom.update({ where: { id }, data });
    res.json(room);
  } catch (err: any) {
    // Prisma codes: P2002 = duplicate name, P2025 = the room is gone (e.g. deleted by someone else meanwhile)
    if (err?.code === 'P2002') { res.status(409).json({ error: `A room named “${String(data.name ?? '')}” already exists.` }); return; }
    if (err?.code === 'P2025') { res.status(404).json({ error: 'This room no longer exists — it was deleted. The list has been refreshed.' }); return; }
    console.error('[rooms] update failed:', err?.message ?? err);
    res.status(500).json({ error: 'Could not save the room. Please try again.' });
  }
}

// DELETE /queue/admin/rooms/:id
export async function deleteRoom(req: AuthRequest, res: Response): Promise<void> {
  if (!isAdmin(req.userRole)) { res.status(403).json({ error: 'Admin only' }); return; }
  const { id } = req.params as { id: string };
  const activeCount = await prisma.queueEntry.count({
    where: { roomId: id, status: { in: ['Waiting', 'In Progress'] }, checkedInAt: { gte: todayStart() } },
  });
  if (activeCount > 0) { res.status(409).json({ error: 'Room has active patients in queue' }); return; }
  // Past queue entries reference the room; deleting would break that history.
  const historyCount = await prisma.queueEntry.count({ where: { roomId: id } });
  if (historyCount > 0) {
    res.status(409).json({ error: 'This room has queue history, so it can’t be deleted. Switch it off instead.' });
    return;
  }
  await prisma.facilityRoom.delete({ where: { id } });
  res.json({ ok: true });
}
