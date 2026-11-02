import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';

function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Counts one more use of this room by this user, so their most-used rooms float to the top of the assign list.
export async function bumpPreference(userId: string | undefined, roomId: string): Promise<void> {
  if (!userId) return;
  try {
    await prisma.userRoomPreference.upsert({
      where: { userId_roomId: { userId, roomId } },
      update: { pickCount: { increment: 1 } },
      create: { userId, roomId, pickCount: 1 },
    });
  } catch { /* a missed count must never block assigning a patient */ }
}

// POST /queue/user-room-preference — increment pick count for a user+room pair
export async function recordPreference(req: AuthRequest, res: Response): Promise<void> {
  const { roomId } = req.body as { roomId: string };
  if (!roomId) { res.status(400).json({ error: 'roomId is required' }); return; }
  await bumpPreference(req.userId, roomId);
  res.json({ ok: true });
}

// GET /queue/user-room-preferences?limit= — most-used rooms for the requesting user (default 3) with live counts
export async function getPreferences(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.userId!;
  const prefs = await prisma.userRoomPreference.findMany({
    where: { userId, room: { active: true } },
    include: {
      room: {
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
      },
    },
    orderBy: { pickCount: 'desc' },
    take: Math.min(Math.max(Number(req.query.limit) || 3, 1), 10),
  });
  res.json(prefs.map(p => ({
    id: p.room.id,
    name: p.room.name,
    tag: p.room.tag,
    active: p.room.active,
    waitingCount: p.room._count.entries,
    pickCount: p.pickCount,
  })));
}
