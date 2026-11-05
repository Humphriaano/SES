import { Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { chargeProcedure } from '../lib/billing';
import { audit, isAdmin, lockInvoice, recalcInvoice } from '../lib/billingOps';

// Procedures recorded during an encounter. Each one picked from the price list gets a PROCEDURE charge line at once
// (the price is copied onto the line, as for investigations); one typed in by hand is recorded without a charge.
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const fail = (res: Response, status: number, error: string) => { res.status(status).json({ error }); };

async function view(id: string) {
  const row = await prisma.encounterProcedure.findUniqueOrThrow({ where: { id } });
  const line = await prisma.chargeLine.findUnique({ where: { sourceType_sourceId: { sourceType: 'PROCEDURE', sourceId: id } } });
  return {
    id: row.id, name: row.name, catalogueRef: row.catalogueRef, site: row.site, note: row.note, status: row.status, performedAt: row.performedAt,
    charged: !!line && line.status === 'ACTIVE', price: line && line.status === 'ACTIVE' && line.unitPrice !== null ? Number(line.unitPrice) : null,
  };
}

// POST /encounters/:encounterId/procedures { clientId, catalogueRef?, name?, site?, note? }
// Safe to repeat: the same clientId returns the procedure already recorded and never charges twice.
export async function recordProcedure(req: AuthRequest, res: Response): Promise<void> {
  const encounterId = String(req.params['encounterId']);
  const b = req.body ?? {};
  const clientId = text(b.clientId, 80);
  if (!clientId) return fail(res, 400, 'This entry has no identifier. Reload the page and try again.');
  const catalogueRef = text(b.catalogueRef, 80);
  const site = text(b.site, 120), note = text(b.note, 300);

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
  try {
    const created = await prisma.encounterProcedure.create({ data: { encounterId, patientId: encounter.patientId, clientId, catalogueRef, name, site, note, performedById: req.userId! } });
    id = created.id;
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
    const existing = await prisma.encounterProcedure.findUniqueOrThrow({ where: { encounterId_clientId: { encounterId, clientId } } });
    id = existing.id; replayed = true;
  }
  if (catalogueRef) await chargeProcedure(id, req.userId);
  res.status(replayed ? 200 : 201).json({ ...(await view(id)), replayed });
}

// DELETE /encounters/:encounterId/procedures/:id { reason? }
// The person who recorded it (or an admin) can take it back while its charge is still on an open invoice.
// After that the charge belongs to the billing desk, which voids it with a reason and an audit entry.
export async function removeProcedure(req: AuthRequest, res: Response): Promise<void> {
  const encounterId = String(req.params['encounterId']), id = String(req.params['id']);
  const row = await prisma.encounterProcedure.findUnique({ where: { id } });
  if (!row || row.encounterId !== encounterId) return fail(res, 404, 'That procedure was not found.');
  if (row.status === 'REMOVED') { res.json({ ok: true, alreadyRemoved: true }); return; }
  if (row.performedById !== req.userId && !isAdmin(req.userRole)) return fail(res, 403, 'Only the person who recorded this procedure can remove it. Ask them, or the billing desk.');
  const encounter = await prisma.encounter.findUnique({ where: { id: encounterId }, select: { status: true } });
  if (encounter?.status !== 'OPEN') return fail(res, 409, 'This encounter is closed, so its procedures can no longer be changed.');
  const reason = text(req.body?.reason, 300) ?? 'Removed from the note';
  try {
    await prisma.$transaction(async tx => {
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
