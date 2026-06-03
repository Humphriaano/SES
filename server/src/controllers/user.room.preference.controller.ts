import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';

function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// POST /queue/user-room-preference — increment pick count for a user+room pair
export async function recordPreference(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.userId!;
  const { roomId } = req.body as { roomId: string };
  if (!roomId) { res.status(400).json({ error: 'roomId is required' }); return; }
  await prisma.userRoomPreference.upsert({
    where: { userId_roomId: { userId, roomId } },
    update: { pickCount: { increment: 1 } },
    create: { userId, roomId, pickCount: 1 },
  });
  res.json({ ok: true });
}

// GET /queue/user-room-preferences — top 3 rooms for the requesting user with live counts
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
    take: 3,
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
