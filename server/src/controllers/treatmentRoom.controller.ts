import { Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { chargeProcedure } from '../lib/billing';
import { fail, presentProcedures, text } from './procedures.controller';

// The treatment room worklist: procedures a doctor sent for a nurse to do. Doing one records it and creates its charge
// (a procedure the patient never has is never billed); returning one sends it back to the doctor with a reason.
const DAY_MS = 24 * 3600 * 1000;

// GET /treatment-room/procedures?view=waiting|done|count
// count returns only the numbers waiting (for the badge in the navigation bar).
// waiting: every ordered procedure not yet done, urgent first then oldest first. done: ordered procedures done in the last 24 hours.
export async function listTreatmentProcedures(req: AuthRequest, res: Response): Promise<void> {
  if (req.query['view'] === 'count') {
    const [waiting, urgent] = await Promise.all([prisma.encounterProcedure.count({ where: { status: 'ORDERED' } }), prisma.encounterProcedure.count({ where: { status: 'ORDERED', priority: 'URGENT' } })]);
    res.json({ counts: { waiting, urgent } }); return;
  }
  const view = req.query['view'] === 'done' ? 'done' : 'waiting';
  const query: Prisma.EncounterProcedureFindManyArgs = view === 'waiting'
    ? { where: { status: 'ORDERED' }, orderBy: [{ priority: 'desc' }, { orderedAt: 'asc' }], take: 200 }
    : { where: { status: 'ACTIVE', orderedById: { not: null }, performedAt: { gte: new Date(Date.now() - DAY_MS) } }, orderBy: { performedAt: 'desc' }, take: 200 };
  const [rows, waiting, urgent] = await Promise.all([
    prisma.encounterProcedure.findMany(query),
    prisma.encounterProcedure.count({ where: { status: 'ORDERED' } }),
    prisma.encounterProcedure.count({ where: { status: 'ORDERED', priority: 'URGENT' } }),
  ]);
  const patients = await prisma.patient.findMany({ where: { id: { in: [...new Set(rows.map(r => r.patientId))] } }, select: { id: true, firstName: true, lastName: true, dateOfBirth: true, gender: true } });
  const shown = await presentProcedures(rows);
  res.json({
    view, counts: { waiting, urgent },
    items: shown.map((p, i) => {
      const patient = patients.find(x => x.id === rows[i].patientId);
      return { ...p, encounterId: rows[i].encounterId, patientId: rows[i].patientId,
        patient: patient ? { name: `${patient.firstName} ${patient.lastName}`.trim(), dateOfBirth: patient.dateOfBirth, gender: patient.gender } : null };
    }),
  });
}

// POST /treatment-room/procedures/:id/complete { site?, note? }
// Safe to repeat and safe if two nurses press it at once: the first records it, the other is told it is done.
export async function completeTreatmentProcedure(req: AuthRequest, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const row = await prisma.encounterProcedure.findUnique({ where: { id } });
  if (!row) return fail(res, 404, 'That procedure was not found.');
  if (row.status === 'ACTIVE') { res.json({ ...(await presentProcedures([row]))[0], replayed: true }); return; }
  if (row.status !== 'ORDERED') return fail(res, 409, 'This procedure is no longer waiting. It was withdrawn or sent back to the doctor.');
  const site = text(req.body?.site, 120) ?? row.site, note = text(req.body?.note, 300) ?? row.note;
  const done = await prisma.encounterProcedure.updateMany({ where: { id, status: 'ORDERED' }, data: { status: 'ACTIVE', performedById: req.userId!, performedAt: new Date(), site, note } });
  if (done.count !== 1) {
    const now = await prisma.encounterProcedure.findUniqueOrThrow({ where: { id } });
    if (now.status === 'ACTIVE') { res.json({ ...(await presentProcedures([now]))[0], replayed: true }); return; }
    return fail(res, 409, 'This procedure is no longer waiting. It was withdrawn or sent back to the doctor.');
  }
  if (row.catalogueRef) await chargeProcedure(id, req.userId);
  res.json({ ...(await presentProcedures([await prisma.encounterProcedure.findUniqueOrThrow({ where: { id } })]))[0], replayed: false });
}

// POST /treatment-room/procedures/:id/return { reason }
export async function returnTreatmentProcedure(req: AuthRequest, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const reason = text(req.body?.reason, 300);
  if (!reason || reason.length < 3) return fail(res, 400, 'Say why it is being sent back, so the doctor knows what to do.');
  const row = await prisma.encounterProcedure.findUnique({ where: { id } });
  if (!row) return fail(res, 404, 'That procedure was not found.');
  if (row.status === 'RETURNED') { res.json({ ...(await presentProcedures([row]))[0], replayed: true }); return; }
  const returned = await prisma.encounterProcedure.updateMany({ where: { id, status: 'ORDERED' }, data: { status: 'RETURNED', removedAt: new Date(), removedById: req.userId, removeReason: reason } });
  if (returned.count !== 1) return fail(res, 409, 'This procedure is no longer waiting. It may already have been done or withdrawn.');
  res.json({ ...(await presentProcedures([await prisma.encounterProcedure.findUniqueOrThrow({ where: { id } })]))[0], replayed: false });
}
