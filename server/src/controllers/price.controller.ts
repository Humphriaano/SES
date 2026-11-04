import { Response } from 'express';
import { Prisma, PriceItemType } from '@prisma/client';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';

const TYPES: PriceItemType[] = ['DRUG', 'INVESTIGATION', 'PROCEDURE', 'CONSULTATION', 'OTHER'];
const MANUAL_TYPES: PriceItemType[] = ['PROCEDURE', 'CONSULTATION', 'OTHER'];   // not backed by a catalogue
const MAX_PRICE = 10_000_000;

const CONSULTATION_FEE = { itemType: 'CONSULTATION' as const, catalogueRef: 'consultation_fee', name: 'Consultation fee', detail: 'Per visit', unit: 'per visit' };

interface ItemRow {
  id: string; itemType: PriceItemType; catalogueRef: string; name: string; detail: string | null;
  unit: string; unitPrice: Prisma.Decimal | null; active: boolean; effectiveFrom: Date | null; updatedAt: Date;
  updatedBy?: { id: string; name: string } | null;
}

// Money leaves the server as a plain number in ZMW (two decimals), never as a Decimal object.
const toDto = (i: ItemRow) => ({ ...i, unitPrice: i.unitPrice === null ? null : Number(i.unitPrice) });

const round2 = (n: number) => Math.round(n * 100) / 100;

function parsePrice(v: unknown): { ok: true; value: number | null } | { ok: false; error: string } {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[, ]/g, ''));
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'Price must be a number of 0 or more.' };
  if (n > MAX_PRICE) return { ok: false, error: `Price can’t be more than ${MAX_PRICE.toLocaleString('en-US')}.` };
  return { ok: true, value: round2(n) };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// GET /price-list?type=&q=&priced=yes|no&active=yes|no&take=&skip=
export async function listPrices(req: AuthRequest, res: Response): Promise<void> {
  const { type, q, priced, active } = req.query as Record<string, string | undefined>;
  const take = Math.min(Math.max(Number(req.query.take) || 50, 1), 200);
  const skip = Math.max(Number(req.query.skip) || 0, 0);

  const where: Prisma.PriceListItemWhereInput = {};
  if (type && TYPES.includes(type as PriceItemType)) where.itemType = type as PriceItemType;
  if (priced === 'yes') where.unitPrice = { not: null };
  if (priced === 'no') where.unitPrice = null;
  if (active === 'yes') where.active = true;
  if (active === 'no') where.active = false;
  const words = (q ?? '').replace(/\b(?:helicobacter|h)\.?\s*pylori\b/ig, 'pylori').trim().split(/\s+/).filter(Boolean);
  if (words.length) {
    where.AND = words.map((w) => ({
      OR: [
        { name: { contains: w, mode: 'insensitive' as const } },
        { detail: { contains: w, mode: 'insensitive' as const } },
        { catalogueRef: { contains: w, mode: 'insensitive' as const } },
      ],
    }));
  }

  const [items, total, byType, unpriced] = await Promise.all([
    prisma.priceListItem.findMany({
      where, take, skip,
      orderBy: [{ name: 'asc' }, { detail: 'asc' }],
      include: { updatedBy: { select: { id: true, name: true, designation: true } } },
    }),
    prisma.priceListItem.count({ where }),
    prisma.priceListItem.groupBy({ by: ['itemType'], _count: { _all: true } }),
    prisma.priceListItem.groupBy({ by: ['itemType'], where: { unitPrice: null, active: true }, _count: { _all: true } }),
  ]);

  res.json({
    items: items.map(toDto),
    total,
    counts: Object.fromEntries(byType.map((r) => [r.itemType, r._count._all])),
    unpriced: Object.fromEntries(unpriced.map((r) => [r.itemType, r._count._all])),
  });
}

// GET /price-list/lookup?refs=a,b,c — current price for each catalogue reference, so the ordering screens can show cost.
// A reference that isn't on the list (or is switched off) is simply absent; one with no price yet comes back null.
export async function lookupPrices(req: AuthRequest, res: Response): Promise<void> {
  const refs = String(req.query['refs'] ?? '').split(',').map((r) => r.trim()).filter(Boolean).slice(0, 100);
  if (refs.length === 0) { res.json({}); return; }
  const rows = await prisma.priceListItem.findMany({
    where: { catalogueRef: { in: refs }, itemType: { in: ['DRUG', 'INVESTIGATION'] }, active: true },
    select: { id: true, catalogueRef: true, unitPrice: true, unit: true, bottleSizeMl: true },
  });
  if (req.query['details'] === '1') {
    res.json(Object.fromEntries(rows.map(r => [r.catalogueRef, { ...r, unitPrice: r.unitPrice == null ? null : Number(r.unitPrice), bottleSizeMl: r.bottleSizeMl == null ? null : Number(r.bottleSizeMl) }]))); return;
  }
  res.json(Object.fromEntries(rows.map((r) => [r.catalogueRef, r.unitPrice === null ? null : Number(r.unitPrice)])));
}

// GET /price-list/export — every item, for editing prices in a spreadsheet and importing them back
export async function exportPrices(_req: AuthRequest, res: Response): Promise<void> {
  const items = await prisma.priceListItem.findMany({ orderBy: [{ itemType: 'asc' }, { name: 'asc' }, { detail: 'asc' }] });
  res.json(items.map((i) => ({ type: i.itemType, code: i.catalogueRef, name: i.name, detail: i.detail ?? '', unit: i.unit, price: i.unitPrice === null ? '' : Number(i.unitPrice), active: i.active })));
}

async function record(itemId: string, userId: string | undefined, field: string, oldValue: unknown, newValue: unknown) {
  await prisma.priceListChange.create({
    data: { itemId, field, oldValue: oldValue == null ? null : String(oldValue), newValue: newValue == null ? null : String(newValue), changedById: userId },
  });
}

// POST /price-list — add an item that isn't in a catalogue (a procedure, the consultation fee, anything else)
export async function createPrice(req: AuthRequest, res: Response): Promise<void> {
  const { itemType, name, detail, unit, unitPrice } = req.body as Record<string, unknown>;
  if (!MANUAL_TYPES.includes(itemType as PriceItemType)) { res.status(400).json({ error: 'Choose Procedure, Consultation or Other.' }); return; }
  const title = typeof name === 'string' ? name.trim() : '';
  if (title.length < 2 || title.length > 120) { res.status(400).json({ error: 'Enter a name (2–120 characters).' }); return; }
  const price = parsePrice(unitPrice);
  if (!price.ok) { res.status(400).json({ error: price.error }); return; }

  const slug = norm(title).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
  try {
    const item = await prisma.priceListItem.create({
      data: {
        itemType: itemType as PriceItemType,
        catalogueRef: `${String(itemType).toLowerCase()}_${slug}`,
        name: title,
        detail: typeof detail === 'string' && detail.trim() ? detail.trim().slice(0, 120) : null,
        unit: typeof unit === 'string' && unit.trim() ? unit.trim().slice(0, 40) : 'each',
        unitPrice: price.value,
        effectiveFrom: price.value === null ? null : new Date(),
        updatedById: req.userId,
      },
      include: { updatedBy: { select: { id: true, name: true, designation: true } } },
    });
    if (price.value !== null) await record(item.id, req.userId, 'price', null, price.value);
    res.status(201).json(toDto(item));
  } catch (err: any) {
    if (err?.code === 'P2002') { res.status(409).json({ error: `“${title}” is already on the price list.` }); return; }
    console.error('[price] create failed:', err?.message ?? err);
    res.status(500).json({ error: 'Could not save the item. Please try again.' });
  }
}

// PATCH /price-list/:id — change the price, switch it on/off, or edit a manual item's wording
export async function updatePrice(req: AuthRequest, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const body = req.body as { unitPrice?: unknown; active?: unknown; unit?: unknown; name?: unknown; detail?: unknown };
  const existing = await prisma.priceListItem.findUnique({ where: { id } });
  if (!existing) { res.status(404).json({ error: 'This item no longer exists. The list has been refreshed.' }); return; }

  const data: Prisma.PriceListItemUncheckedUpdateInput = { updatedById: req.userId };
  const changes: [string, unknown, unknown][] = [];

  if ('unitPrice' in body) {
    const price = parsePrice(body.unitPrice);
    if (!price.ok) { res.status(400).json({ error: price.error }); return; }
    const before = existing.unitPrice === null ? null : Number(existing.unitPrice);
    if (before !== price.value) {
      data.unitPrice = price.value;
      data.effectiveFrom = price.value === null ? null : new Date();
      changes.push(['price', before, price.value]);
    }
  }
  if (typeof body.active === 'boolean' && body.active !== existing.active) {
    data.active = body.active;
    changes.push(['active', existing.active, body.active]);
  }
  if (typeof body.unit === 'string' && body.unit.trim() && body.unit.trim() !== existing.unit) {
    data.unit = body.unit.trim().slice(0, 40);
    changes.push(['unit', existing.unit, data.unit]);
  }
  // Catalogue-backed names come from the catalogue; only manual items can be renamed.
  if (MANUAL_TYPES.includes(existing.itemType)) {
    if (typeof body.name === 'string' && body.name.trim().length >= 2 && body.name.trim() !== existing.name) {
      data.name = body.name.trim().slice(0, 120);
      changes.push(['name', existing.name, data.name]);
    }
    if (typeof body.detail === 'string') data.detail = body.detail.trim().slice(0, 120) || null;
  }

  if (changes.length === 0 && !('detail' in body)) { res.json(toDto({ ...existing, updatedBy: null })); return; }
  try {
    const item = await prisma.priceListItem.update({ where: { id }, data, include: { updatedBy: { select: { id: true, name: true, designation: true } } } });
    for (const [field, a, b] of changes) await record(id, req.userId, field, a, b);
    res.json(toDto(item));
  } catch (err: any) {
    if (err?.code === 'P2002') { res.status(409).json({ error: 'Another item already has that name.' }); return; }
    console.error('[price] update failed:', err?.message ?? err);
    res.status(500).json({ error: 'Could not save the change. Please try again.' });
  }
}

// POST /price-list/sync — add every catalogue drug / test that isn't on the list yet (prices stay blank).
// The app sends its own catalogues, so there is one source and nothing is duplicated on the server.
export async function syncCatalogue(req: AuthRequest, res: Response): Promise<void> {
  const { items } = req.body as { items?: { itemType: string; catalogueRef: string; name: string; detail?: string; unit?: string }[] };
  if (!Array.isArray(items) || items.length === 0) { res.status(400).json({ error: 'No catalogue items were sent.' }); return; }
  if (items.length > 2000) { res.status(400).json({ error: 'Too many items in one request (limit 2,000).' }); return; }

  const clean = items
    .filter((i) => (i.itemType === 'DRUG' || i.itemType === 'INVESTIGATION') && typeof i.catalogueRef === 'string' && i.catalogueRef && typeof i.name === 'string' && i.name.trim())
    .map((i) => ({
      itemType: i.itemType as PriceItemType,
      catalogueRef: i.catalogueRef.slice(0, 80),
      name: i.name.trim().slice(0, 160),
      detail: i.detail ? String(i.detail).slice(0, 160) : null,
      unit: i.unit ? String(i.unit).slice(0, 40) : i.itemType === 'DRUG' ? 'per unit' : 'per test',
      updatedById: req.userId,
    }));

  const result = await prisma.priceListItem.createMany({ data: clean, skipDuplicates: true });
  // The consultation fee is part of the model, so make sure the row exists.
  const fee = await prisma.priceListItem.createMany({ data: [{ ...CONSULTATION_FEE, updatedById: req.userId }], skipDuplicates: true });
  res.json({ received: clean.length, created: result.count + fee.count, alreadyListed: clean.length - result.count });
}

// POST /price-list/import — set prices from spreadsheet rows { code?, type?, name, detail?, price }
export async function importPrices(req: AuthRequest, res: Response): Promise<void> {
  const { rows } = req.body as { rows?: { code?: string; type?: string; name?: string; detail?: string; price?: unknown }[] };
  if (!Array.isArray(rows) || rows.length === 0) { res.status(400).json({ error: 'The file has no rows to import.' }); return; }
  if (rows.length > 5000) { res.status(400).json({ error: 'Too many rows in one import (limit 5,000).' }); return; }

  const all = await prisma.priceListItem.findMany();
  const byCode = new Map(all.map((i) => [`${i.itemType}|${i.catalogueRef.toLowerCase()}`, i]));
  const byName = new Map<string, typeof all>();
  for (const i of all) {
    const k = `${norm(i.name)}|${norm(i.detail ?? '')}`;
    byName.set(k, [...(byName.get(k) ?? []), i]);
  }

  let updated = 0, unchanged = 0, ambiguous = 0, blank = 0;
  const unmatched: string[] = [];
  const invalid: string[] = [];

  for (const [n, r] of rows.entries()) {
    const label = r.name || r.code || `row ${n + 2}`;
    if (r.price === undefined || r.price === null || String(r.price).trim() === '') { blank++; continue; }
    const price = parsePrice(r.price);
    if (!price.ok || price.value === null) { invalid.push(`${label}: ${price.ok ? 'blank price' : price.error}`); continue; }

    let item = r.code && r.type ? byCode.get(`${String(r.type).toUpperCase()}|${r.code.toLowerCase()}`) : undefined;
    if (!item && r.name) {
      const matches = byName.get(`${norm(r.name)}|${norm(r.detail ?? '')}`) ?? [];
      const typed = r.type ? matches.filter((m) => m.itemType === String(r.type).toUpperCase()) : matches;
      if (typed.length > 1) { ambiguous++; continue; }
      item = typed[0];
    }
    if (!item) { unmatched.push(label); continue; }

    const before = item.unitPrice === null ? null : Number(item.unitPrice);
    if (before === price.value) { unchanged++; continue; }
    await prisma.priceListItem.update({ where: { id: item.id }, data: { unitPrice: price.value, effectiveFrom: new Date(), updatedById: req.userId } });
    await record(item.id, req.userId, 'price', before, price.value);
    updated++;
  }

  res.json({ updated, unchanged, blank, ambiguous, unmatched: unmatched.slice(0, 30), unmatchedCount: unmatched.length, invalid: invalid.slice(0, 30), invalidCount: invalid.length });
}

// GET /price-list/:id/history — who changed what, newest first
export async function priceHistory(req: AuthRequest, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const rows = await prisma.priceListChange.findMany({
    where: { itemId: id }, orderBy: { changedAt: 'desc' }, take: 50,
    include: { changedBy: { select: { id: true, name: true, designation: true } } },
  });
  res.json(rows);
}
