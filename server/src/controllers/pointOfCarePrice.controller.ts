import { Response } from 'express';
import { Prisma, PriceItemType } from '@prisma/client';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { audit, lockInvoice, recalcInvoice } from '../lib/billingOps';

const error = (status: number, message: string) => Object.assign(new Error(message), { status });

export async function savePointOfCarePrice(req: AuthRequest, res: Response): Promise<void> {
  const { itemType, catalogueRef, unitPrice, patientId, expectedPrice = null } = req.body ?? {};
  const roles = (req.userRole ?? '').split(',').map(r => r.trim());
  const broad = roles.some(r => ['admin', 'billing', 'clinician'].includes(r));
  const allowed = broad || (roles.includes('pharmacist') && itemType === 'DRUG');
  if (!allowed) { res.status(403).json({ error: 'You do not have permission to add this price.' }); return; }
  if (!['DRUG', 'INVESTIGATION', 'PROCEDURE'].includes(itemType) || typeof catalogueRef !== 'string' || !catalogueRef || catalogueRef.length > 80) {
    res.status(400).json({ error: 'Choose an item from the catalogue.' }); return;
  }
  const metadataOnly = unitPrice === null && req.body?.unit !== undefined;
  if (!metadataOnly && (!['string', 'number'].includes(typeof unitPrice) || String(unitPrice).trim() === '')) {
    res.status(400).json({ error: 'Enter a price in ZMW.' }); return;
  }
  const amount = Number(unitPrice);
  if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) {
    res.status(400).json({ error: 'Enter a price between 0 and 10,000,000 ZMW.' }); return;
  }
  if (patientId !== undefined && (typeof patientId !== 'string' || !patientId || patientId.length > 100)) {
    res.status(400).json({ error: 'Invalid patient.' }); return;
  }
  const price = metadataOnly ? null : new Prisma.Decimal(String(unitPrice)).toDecimalPlaces(2).toNumber();
  const { unit, bottleSizeMl, expectedUnit, expectedBottleSizeMl = null } = req.body ?? {};
  const metadata = unit !== undefined;
  const bottle = bottleSizeMl == null ? null : Number(bottleSizeMl);
  if (metadata && (itemType !== 'DRUG' || typeof unit !== 'string' || !/^per (?:tablet|capsule|bottle|course|mL|unit|inhaler|sachet|vial|ampoule|tube|patch|suppository|pessary)$/.test(unit) || typeof expectedUnit !== 'string' || (bottle !== null && (!Number.isFinite(bottle) || bottle < 0.01 || bottle > 1000000)) || (expectedBottleSizeMl !== null && (typeof expectedBottleSizeMl !== 'number' || !Number.isFinite(expectedBottleSizeMl))))) {
    res.status(400).json({ error: 'Choose a valid drug pricing unit and bottle size.' }); return;
  }
  if (expectedPrice !== null && (typeof expectedPrice !== 'number' || !Number.isFinite(expectedPrice) || expectedPrice < 0 || expectedPrice > 10_000_000)) {
    res.status(400).json({ error: 'Refresh the current price and try again.' }); return;
  }
  try {
    const result = await prisma.$transaction(async tx => {
      const item = await tx.priceListItem.findUnique({ where: { itemType_catalogueRef: { itemType: itemType as PriceItemType, catalogueRef } } });
      if (!item) throw error(404, 'This item is not on the price list yet. Refresh the catalogue and try again.');
      if (!item.active) throw error(409, 'This price-list item is inactive.');
      const before = item.unitPrice === null ? null : Number(item.unitPrice);
      if (before !== expectedPrice) throw error(409, 'The price changed while you were editing. The current price has been refreshed.');
      if (metadata && (item.unit !== expectedUnit || (item.bottleSizeMl == null ? null : Number(item.bottleSizeMl)) !== expectedBottleSizeMl)) throw error(409, 'The pricing unit or bottle size changed. Refresh before saving.');
      const changed = await tx.priceListItem.updateMany({
        where: { id: item.id, active: true, unitPrice: expectedPrice, ...(metadata ? { unit: expectedUnit, bottleSizeMl: expectedBottleSizeMl } : {}) },
        data: { unitPrice: price, effectiveFrom: new Date(), updatedById: req.userId, ...(metadata ? { unit, bottleSizeMl: bottle } : {}) },
      });
      if (changed.count !== 1) throw error(409, 'Another user has changed this price. The current price has been refreshed.');
      if (before !== price) await tx.priceListChange.create({ data: { itemId: item.id, field: 'price', oldValue: before === null ? null : String(before), newValue: price === null ? null : String(price), changedById: req.userId } });
      if (metadata && unit !== item.unit) await tx.priceListChange.create({ data: { itemId: item.id, field: 'unit', oldValue: item.unit, newValue: unit, changedById: req.userId } });
      if (metadata && bottle !== (item.bottleSizeMl == null ? null : Number(item.bottleSizeMl))) await tx.priceListChange.create({ data: { itemId: item.id, field: 'bottleSizeMl', oldValue: item.bottleSizeMl == null ? null : String(item.bottleSizeMl), newValue: bottle == null ? null : String(bottle), changedById: req.userId } });
      let repriced = 0;
      if (patientId && !metadata && price !== null) repriced = await fillUnpricedCharges(tx, patientId, item.id, itemType, catalogueRef, price, req.userId, item.unit);
      return { id: item.id, itemType: item.itemType, catalogueRef: item.catalogueRef, unit: metadata ? unit : item.unit, bottleSizeMl: metadata ? bottle : item.bottleSizeMl, unitPrice: price, repriced };
    });
    res.json(result);
  } catch (err: any) {
    if (err.status) { res.status(err.status).json({ error: err.message }); return; }
    console.error('[price] point-of-care price failed:', err?.message ?? err);
    res.status(500).json({ error: 'Could not add the price. Try again.' });
  }
}

async function fillUnpricedCharges(tx: Prisma.TransactionClient, patientId: string, itemId: string, itemType: string, ref: string, price: number, userId?: string, priceUnit?: string) {
  const candidates = await tx.chargeLine.findMany({
    where: {
      patientId, status: 'ACTIVE', unitPrice: null, invoice: { status: 'OPEN', lockedAt: null },
      OR: [{ priceItemId: itemId }, { priceItemId: null, sourceType: itemType === 'DRUG' ? 'PRESCRIPTION' : 'INVESTIGATION' }],
    },
  });
  const matching = new Set(candidates.filter(line => line.priceItemId === itemId).map(line => line.id));
  // Legacy dose counts are not bottle/course counts. Pharmacy must first confirm
  // a structured course before those unpriced lines can be priced automatically.
  if (itemType === 'DRUG' && /bottle|course|mL/.test(priceUnit ?? '')) return 0;
  const unlinked = candidates.filter(line => !line.priceItemId && line.sourceId);
  if (unlinked.length && itemType === 'DRUG') {
    const rx = await tx.prescription.findMany({ where: { id: { in: unlinked.map(l => l.sourceId!) } }, select: { id: true, medication: { select: { catalogueCode: true } } } });
    const sources = new Set(rx.filter(r => r.medication.catalogueCode === ref).map(r => r.id));
    unlinked.filter(l => sources.has(l.sourceId!)).forEach(l => matching.add(l.id));
  } else if (unlinked.length && itemType === 'INVESTIGATION') {
    const tests = await tx.investigationOrderItem.findMany({ where: { id: { in: unlinked.map(l => l.sourceId!) } }, select: { id: true, type: true, catalogueId: true } });
    const sources = new Set(tests.filter(t => `${t.type === 'panel' ? 'panel' : 'single'}_${t.catalogueId}` === ref).map(t => t.id));
    unlinked.filter(l => sources.has(l.sourceId!)).forEach(l => matching.add(l.id));
  }
  let count = 0;
  const invoices = [...new Set(candidates.filter(l => matching.has(l.id)).map(l => l.invoiceId))].sort();
  for (const invoiceId of invoices) {
    await lockInvoice(tx, invoiceId);
    for (const line of candidates.filter(l => l.invoiceId === invoiceId && matching.has(l.id))) {
      const changed = await tx.chargeLine.updateMany({
        where: { id: line.id, patientId, status: 'ACTIVE', unitPrice: null, invoice: { status: 'OPEN', lockedAt: null } },
        data: { unitPrice: price, priceItemId: itemId, needsReview: line.quantityUnsure || (!line.auto && line.needsReview) },
      });
      if (!changed.count) continue;
      count++;
      await audit(tx, { userId, action: 'PRICE_FILLED', entity: 'ChargeLine', entityId: line.id, invoiceId, patientId,
        before: { unitPrice: null }, after: { unitPrice: price, priceItemId: itemId } });
    }
    await recalcInvoice(tx, invoiceId, userId);
  }
  return count;
}

// Compatibility with the initial add-price endpoint. An omitted expectedPrice means unpriced only.
export const setMissingPrice = savePointOfCarePrice;
