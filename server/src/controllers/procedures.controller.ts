import { Response } from 'express';
import { EncounterProcedure, Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { chargeProcedure } from '../lib/billing';
import { audit, isAdmin, lockInvoice, recalcInvoice, userNames } from '../lib/billingOps';

// Procedures on a patient's note. A clinician either did one and records it (charged at once if it came from the price
// list), or orders it for the treatment room: it waits there, uncharged, until a nurse records it as done (charged then)
// or returns it with a reason. A procedure typed in by hand is recorded without a charge.
export const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
export const fail = (res: Response, status: number, error: string) => { res.status(status).json({ error }); };

// What the screens need to know about procedures: who ordered and who did it, and the price (the charge once it is made,
// the price list's current price while it is only ordered).
export async function presentProcedures(rows: EncounterProcedure[]) {
  if (!rows.length) return [];
  const lines = await prisma.chargeLine.findMany({ where: { sourceType: 'PROCEDURE', sourceId: { in: rows.map(r => r.id) } } });
  const refs = [...new Set(rows.map(r => r.catalogueRef).filter((r): r is string => !!r))];
  const listed = refs.length ? await prisma.priceListItem.findMany({ where: { itemType: 'PROCEDURE', catalogueRef: { in: refs } }, select: { catalogueRef: true, unitPrice: true } }) : [];
  const names = await userNames(rows.flatMap(r => [r.orderedById, r.performedById]));
  return rows.map(r => {
    const line = lines.find(l => l.sourceId === r.id), charged = !!line && line.status === 'ACTIVE';
    const current = listed.find(p => p.catalogueRef === r.catalogueRef)?.unitPrice;
    return {
      id: r.id, name: r.name, catalogueRef: r.catalogueRef, site: r.site, note: r.note, instructions: r.instructions, priority: r.priority, status: r.status,
      orderedAt: r.orderedAt, orderedBy: r.orderedById ? names[r.orderedById] ?? null : null, performedAt: r.performedAt, performedBy: r.performedById ? names[r.performedById] ?? null : null,
      returnReason: r.status === 'RETURNED' ? r.removeReason : null,
      charged, price: charged && line!.unitPrice !== null ? Number(line!.unitPrice) : null, expectedPrice: !charged && current != null ? Number(current) : null,
    };
  });
}
async function view(id: string) {
  return (await presentProcedures([await prisma.encounterProcedure.findUniqueOrThrow({ where: { id } })]))[0];
}

// GET /encounters/:encounterId/procedures: the live state of each procedure on this encounter (waiting, done, returned),
// so the note can show what the treatment room has done.
export async function listProcedures(req: AuthRequest, res: Response): Promise<void> {
  const rows = await prisma.encounterProcedure.findMany({ where: { encounterId: String(req.params['encounterId']), status: { in: ['ORDERED', 'ACTIVE', 'RETURNED'] } }, orderBy: { createdAt: 'asc' } });
  res.json(await presentProcedures(rows));
}

// POST /encounters/:encounterId/procedures { clientId, mode?: 'DONE' | 'ORDER', catalogueRef?, name?, site?, note?, instructions?, priority? }
// mode DONE (the default) records a procedure the clinician did; ORDER sends it to the treatment room with no charge yet.
// Safe to repeat: the same clientId returns the procedure already recorded and never charges twice.
export async function recordProcedure(req: AuthRequest, res: Response): Promise<void> {
  const encounterId = String(req.params['encounterId']);
  const b = req.body ?? {};
  const clientId = text(b.clientId, 80);
  if (!clientId) return fail(res, 400, 'This entry has no identifier. Reload the page and try again.');
  const order = b.mode === 'ORDER';
  const catalogueRef = text(b.catalogueRef, 80);
  const site = text(b.site, 120), note = text(b.note, 300), instructions = text(b.instructions, 300);

  const encounter = await prisma.encounter.findUnique({ where: { id: encounterId }, select: { id: true, patientId: true, status: true } });
  if (!encounter) return fail(res, 404, 'That encounter was not found.');
  if (encounter.status !== 'OPEN') return fail(res, 409, 'This encounter is closed, so a procedure cannot be added to it.');

  let name = text(b.name, 120);
  if (catalogueRef) {
    const item = await prisma.priceListItem.findUnique({ where: { itemType_catalogueRef: { itemType: 'PROCEDURE', catalogueRef } } });
    if (!item || !item.active) return fail(res, 400, 'Choose a procedure from the list.');
    name = item.name;                 // the price list's wording is the one billed
  }
  if (!name || name.length < 2) return fail(res, 400, 'Enter the name of the procedure.');

  let id: string, replayed = false;
  const now = new Date();
  try {
    const created = await prisma.encounterProcedure.create({ data: {
      encounterId, patientId: encounter.patientId, clientId, catalogueRef, name, site, note,
      ...(order
        ? { status: 'ORDERED', orderedById: req.userId!, orderedAt: now, instructions, priority: b.priority === 'URGENT' ? 'URGENT' : 'ROUTINE' }
        : { status: 'ACTIVE', performedById: req.userId!, performedAt: now }),
    } });
    id = created.id;
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
    const existing = await prisma.encounterProcedure.findUniqueOrThrow({ where: { encounterId_clientId: { encounterId, clientId } } });
    id = existing.id; replayed = true;
  }
  if (catalogueRef && !order) await chargeProcedure(id, req.userId);   // does nothing unless the procedure is recorded as done
  res.status(replayed ? 200 : 201).json({ ...(await view(id)), replayed });
}

// DELETE /encounters/:encounterId/procedures/:id { reason? }
// - ordered, not yet done: the doctor who ordered it (or an admin) withdraws it. Nothing was charged.
// - done: the person who recorded it (or an admin) can take it back while its charge is on an open invoice with no payments.
//   After that the charge belongs to the billing desk, which voids it with a reason and an audit entry.
// - returned by the nurse: nothing to undo; the doctor just drops it from the note.
export async function removeProcedure(req: AuthRequest, res: Response): Promise<void> {
  const encounterId = String(req.params['encounterId']), id = String(req.params['id']);
  const row = await prisma.encounterProcedure.findUnique({ where: { id } });
  if (!row || row.encounterId !== encounterId) return fail(res, 404, 'That procedure was not found.');
  if (row.status === 'REMOVED' || row.status === 'CANCELLED') { res.json({ ok: true, alreadyRemoved: true }); return; }
  if (row.status === 'RETURNED') { res.json({ ok: true, dismissed: true }); return; }
  const owner = row.status === 'ORDERED' ? row.orderedById : row.performedById;
  if (owner !== req.userId && !isAdmin(req.userRole)) {
    return fail(res, 403, row.status === 'ORDERED' ? 'Only the doctor who sent this procedure can withdraw it.' : 'Only the person who recorded this procedure can remove it. Ask them, or the billing desk.');
  }
  const encounter = await prisma.encounter.findUnique({ where: { id: encounterId }, select: { status: true } });
  if (encounter?.status !== 'OPEN') return fail(res, 409, 'This encounter is closed, so its procedures can no longer be changed.');
  const reason = text(req.body?.reason, 300) ?? (row.status === 'ORDERED' ? 'Withdrawn by the doctor' : 'Removed from the note');
  try {
    await prisma.$transaction(async tx => {
      if (row.status === 'ORDERED') {
        // A nurse may have recorded it a moment ago; only a still-waiting order can be withdrawn.
        const done = await tx.encounterProcedure.updateMany({ where: { id, status: 'ORDERED' }, data: { status: 'CANCELLED', removedAt: new Date(), removedById: req.userId, removeReason: reason } });
        if (done.count !== 1) throw Object.assign(new Error('The treatment room has already dealt with this procedure. Refresh to see its result.'), { status: 409 });
        return;
      }
      const line = await tx.chargeLine.findUnique({ where: { sourceType_sourceId: { sourceType: 'PROCEDURE', sourceId: id } }, include: { invoice: true } });
      if (line && line.status === 'ACTIVE') {
        await lockInvoice(tx, line.invoiceId);
        const current = await tx.invoice.findUniqueOrThrow({ where: { id: line.invoiceId } });
        if (current.status !== 'OPEN') throw Object.assign(new Error('This charge is already on an invoice that has payments or is closed. Ask the billing desk to remove it.'), { status: 409 });
        await tx.chargeLine.update({ where: { id: line.id }, data: { status: 'VOIDED', voidedAt: new Date(), voidReason: reason } });
        await audit(tx, { userId: req.userId, action: 'LINE_VOIDED', entity: 'ChargeLine', entityId: line.id, invoiceId: line.invoiceId, patientId: line.patientId,
          before: { description: line.description, quantity: Number(line.quantity), unitPrice: line.unitPrice === null ? null : Number(line.unitPrice) }, after: { status: 'VOIDED' }, reason });
        await recalcInvoice(tx, line.invoiceId, req.userId);
      }
      await tx.encounterProcedure.update({ where: { id }, data: { status: 'REMOVED', removedAt: new Date(), removedById: req.userId, removeReason: reason } });
    });
    res.json({ ok: true });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status) return fail(res, status, (err as Error).message);
    throw err;
  }
}
