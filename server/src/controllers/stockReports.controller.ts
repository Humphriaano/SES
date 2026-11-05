import { Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { userNames } from '../lib/billingOps';
import { StockError } from '../lib/stock';
import { batchTotals } from '../lib/stockViews';
import { ADJUSTMENT_REASONS } from '../lib/stockAdjustments';
import { todayInput, validCourseDate } from '../lib/prescriptionCourse';
import { Report, toWorkbook } from './billingReports.controller';

// Same Report shape as the billing reports, so the screens and Excel export share one layout.
// Quantities come from the stock ledger through the same CTE the stock views use.
type Query = Record<string, unknown>;
const num = (v: Prisma.Decimal | null | undefined) => Number(v ?? 0);
const dayText = (d: Date) => d.toISOString().slice(0, 10);
const niceDay = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const TYPE_LABEL: Record<string, string> = { RECEIVED: 'Received', ISSUED: 'Issued', LOSS: 'Loss', ADJUSTMENT: 'Adjustment', REVERSAL: 'Reversal' };
const STATE_LABEL: Record<string, string> = { USABLE: 'Usable', EXPIRED: 'Expired', QUARANTINED: 'Quarantined', INACTIVE: 'Inactive' };
const STATUS_LABEL: Record<string, string> = { PENDING: 'Awaiting approval', POSTED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };

function choice(v: unknown, values: string[], fallback: string): string {
  if (v === undefined || v === '') return fallback;
  if (typeof v !== 'string' || !values.includes(v)) throw new StockError(400, 'Choose a valid report filter.');
  return v;
}
function search(v: unknown): string {
  if (v === undefined || v === '') return '';
  if (typeof v !== 'string' || v.length > 160) throw new StockError(400, 'Enter a shorter search.');
  return v.trim();
}
function likeAll(text: string, fields: Prisma.Sql[]) {
  const words = text.split(/\s+/).filter(Boolean).slice(0, 8);
  if (!words.length) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.join(words.map(w => {
    const pattern = '%' + w.replace(/[\\%_]/g, '\\$&') + '%';
    return Prisma.sql`(${Prisma.join(fields.map(f => Prisma.sql`${f} ILIKE ${pattern}`), ' OR ')})`;
  }), ' AND ')}`;
}
// Facility days run on Lusaka time. Prisma stores UTC without a zone, so bind explicit UTC clock strings.
function range(q: Query): { start: string; end: string; label: string } {
  const read = (v: unknown, fallback: string) => {
    if (v === undefined || v === '') return fallback;
    if (typeof v !== 'string' || !validCourseDate(v)) throw new StockError(400, 'Enter a valid date.');
    return v;
  };
  const from = read(q['from'], todayInput()), to = read(q['to'], from);
  if (to < from) throw new StockError(400, 'The end date is before the start date.');
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) throw new StockError(400, 'Choose a range of one year or less.');
  const start = new Date(from + 'T00:00:00+02:00').toISOString().replace('Z', '');
  const end = new Date(new Date(to + 'T00:00:00+02:00').getTime() + 86_400_000).toISOString().replace('Z', '');
  return { start, end, label: from === to ? niceDay(from) : `${niceDay(from)} to ${niceDay(to)}` };
}
const item = (name: string, detail: string | null) => (detail ? `${name} ${detail}` : name);

async function onHand(q: Query): Promise<Report> {
  const level = choice(q['level'], ['ALL', 'AVAILABLE', 'OUT_OF_STOCK', 'HAS_EXPIRED'], 'ALL');
  const text = search(q['q']);
  const rows = await prisma.$queryRaw<{ name: string; detail: string | null; brand: string; manufacturer: string | null; baseUnit: string; batchCount: number; physical: Prisma.Decimal; available: Prisma.Decimal; expired: Prisma.Decimal; quarantined: Prisma.Decimal; inactive: Prisma.Decimal }[]>(Prisma.sql`
    WITH ${batchTotals()} SELECT * FROM product_totals WHERE TRUE ${likeAll(text, [Prisma.sql`"name"`, Prisma.sql`"detail"`, Prisma.sql`"brand"`, Prisma.sql`"manufacturer"`])}
    ${level === 'AVAILABLE' ? Prisma.sql`AND "available" > 0` : level === 'OUT_OF_STOCK' ? Prisma.sql`AND "available" <= 0` : level === 'HAS_EXPIRED' ? Prisma.sql`AND "expired" > 0` : Prisma.empty}
    ORDER BY "name", "detail", "brand", "baseUnit"`);
  const data = rows.map(r => ({ item: item(r.name, r.detail), brand: r.brand, manufacturer: r.manufacturer ?? '', unit: r.baseUnit, batches: r.batchCount, available: num(r.available), expired: num(r.expired), quarantined: num(r.quarantined), inactive: num(r.inactive), physical: num(r.physical) }));
  return {
    name: 'stock-on-hand', title: 'Stock on hand', period: `As at ${new Date().toLocaleString('en-GB', { timeZone: 'Africa/Lusaka' })}`,
    columns: [
      { key: 'item', header: 'Item', type: 'text', width: 34 }, { key: 'brand', header: 'Brand', type: 'text', width: 20 },
      { key: 'manufacturer', header: 'Manufacturer', type: 'text', width: 20 }, { key: 'unit', header: 'Unit', type: 'text', width: 11 },
      { key: 'batches', header: 'Batches', type: 'int', width: 9 }, { key: 'available', header: 'Available', type: 'number', width: 12 },
      { key: 'expired', header: 'Expired', type: 'number', width: 11 }, { key: 'quarantined', header: 'Quarantined', type: 'number', width: 13 },
      { key: 'inactive', header: 'Inactive', type: 'number', width: 11 }, { key: 'physical', header: 'Physical total', type: 'number', width: 14 },
    ],
    rows: data, totals: null, // units differ across rows, so a column total would be meaningless
    summary: [
      { label: 'Products listed', value: data.length },
      { label: 'Out of stock (nothing usable)', value: data.filter(r => r.available <= 0).length },
      { label: 'Products holding expired stock', value: data.filter(r => r.expired > 0).length },
    ],
  };
}

async function expiry(q: Query): Promise<Report> {
  const state = choice(q['state'], ['ALL', 'USABLE', 'EXPIRED', 'QUARANTINED', 'INACTIVE'], 'ALL');
  const within = q['within'] === undefined || q['within'] === '' ? null : Number(q['within']);
  if (within !== null && (!Number.isInteger(within) || within < 1 || within > 3650)) throw new StockError(400, 'Choose between 1 and 3650 days.');
  const text = search(q['q']);
  const today = todayInput();
  const rows = await prisma.$queryRaw<{ name: string; detail: string | null; brand: string; lotNumber: string; expiryDate: Date; baseUnit: string; physical: Prisma.Decimal; state: string; days: number }[]>(Prisma.sql`
    WITH ${batchTotals()} SELECT *, ("expiryDate" - ${today}::date)::integer AS days FROM batch_totals WHERE "physical" > 0
    ${state === 'ALL' ? Prisma.empty : Prisma.sql`AND "state" = ${state}`}
    ${within === null ? Prisma.empty : Prisma.sql`AND "expiryDate" >= ${today}::date AND "expiryDate" <= (${today}::date + ${within}::integer)`}
    ${likeAll(text, [Prisma.sql`"name"`, Prisma.sql`"detail"`, Prisma.sql`"brand"`, Prisma.sql`"lotNumber"`])}
    ORDER BY "expiryDate", "name", "lotNumber"`);
  const data = rows.map(r => ({ item: item(r.name, r.detail), brand: r.brand, lot: r.lotNumber, expiry: niceDay(dayText(r.expiryDate)), days: r.days, state: STATE_LABEL[r.state] ?? r.state, quantity: num(r.physical), unit: r.baseUnit }));
  return {
    name: 'stock-expiry', title: 'Batches by expiry', period: `${within ? `Expiring within ${within} days` : 'All batches holding stock'} · as at ${niceDay(today)}`,
    columns: [
      { key: 'item', header: 'Item', type: 'text', width: 34 }, { key: 'brand', header: 'Brand', type: 'text', width: 20 },
      { key: 'lot', header: 'Lot / batch', type: 'text', width: 16 }, { key: 'expiry', header: 'Expiry date', type: 'text', width: 14 },
      { key: 'days', header: 'Days left', type: 'int', width: 10 }, { key: 'state', header: 'Status', type: 'text', width: 13 },
      { key: 'quantity', header: 'Quantity', type: 'number', width: 12 }, { key: 'unit', header: 'Unit', type: 'text', width: 11 },
    ],
    rows: data, totals: null,
    summary: [
      { label: 'Batches listed', value: data.length },
      { label: 'Already expired', value: data.filter(r => r.days < 0).length },
      { label: 'Quarantined', value: data.filter(r => r.state === STATE_LABEL['QUARANTINED']).length },
    ],
  };
}

async function movements(q: Query): Promise<Report> {
  const r = range(q);
  const type = choice(q['type'], ['ALL', 'RECEIVED', 'ISSUED', 'LOSS', 'ADJUSTMENT', 'REVERSAL'], 'ALL');
  const text = search(q['q']);
  const rows = await prisma.$queryRaw<{ createdAt: Date; reference: string; type: string; name: string; detail: string | null; brand: string; lotNumber: string; quantity: Prisma.Decimal; baseUnit: string; reason: string | null; actorId: string }[]>(Prisma.sql`
    SELECT m."createdAt", m."reference", m."type", c."name", c."detail", p."brand", b."lotNumber", m."quantity", m."baseUnit", m."reason", m."actorId"
    FROM "StockMovement" m JOIN "StockBatch" b ON b."id" = m."batchId" JOIN "PharmacyProduct" p ON p."id" = b."productId"
    JOIN "PriceListItem" c ON c."itemType" = p."catalogueType" AND c."catalogueRef" = p."catalogueRef"
    WHERE m."createdAt" >= ${r.start}::timestamp AND m."createdAt" < ${r.end}::timestamp
    ${type === 'ALL' ? Prisma.empty : Prisma.sql`AND m."type" = ${type}::"StockMovementType"`}
    ${likeAll(text, [Prisma.sql`c."name"`, Prisma.sql`p."brand"`, Prisma.sql`b."lotNumber"`, Prisma.sql`m."reference"`])}
    ORDER BY m."postingOrder" LIMIT 20000`);
  const who = await userNames(rows.map(x => x.actorId));
  const data = rows.map(x => {
    const qty = num(x.quantity);
    return { time: x.createdAt.toISOString(), reference: x.reference, type: TYPE_LABEL[x.type] ?? x.type, item: item(x.name, x.detail), brand: x.brand, lot: x.lotNumber,
      qin: qty > 0 ? qty : null, qout: qty < 0 ? -qty : null, unit: x.baseUnit, reason: x.reason ?? '', by: who[x.actorId] ?? '' };
  });
  const count = (t: string) => data.filter(d => d.type === t).length;
  return {
    name: 'stock-movements', title: 'Stock movements', period: r.label,
    columns: [
      { key: 'time', header: 'Date and time', type: 'date', width: 20 }, { key: 'reference', header: 'Reference', type: 'text', width: 18 },
      { key: 'type', header: 'Type', type: 'text', width: 12 }, { key: 'item', header: 'Item', type: 'text', width: 32 },
      { key: 'brand', header: 'Brand', type: 'text', width: 18 }, { key: 'lot', header: 'Lot / batch', type: 'text', width: 14 },
      { key: 'qin', header: 'Stock in', type: 'number', width: 11 }, { key: 'qout', header: 'Stock out', type: 'number', width: 11 },
      { key: 'unit', header: 'Unit', type: 'text', width: 10 }, { key: 'reason', header: 'Reason', type: 'text', width: 26 },
      { key: 'by', header: 'Handled by', type: 'text', width: 20 },
    ],
    rows: data, totals: null,
    summary: [
      { label: 'Movements', value: data.length }, { label: 'Received', value: count('Received') }, { label: 'Issued', value: count('Issued') },
      { label: 'Losses', value: count('Loss') }, { label: 'Adjustments', value: count('Adjustment') }, { label: 'Reversals', value: count('Reversal') },
    ],
  };
}

async function adjustments(q: Query): Promise<Report> {
  const r = range(q);
  const status = choice(q['status'], ['ALL', 'PENDING', 'POSTED', 'REJECTED', 'CANCELLED'], 'ALL');
  const text = search(q['q']);
  const rows = await prisma.$queryRaw<{ preparedAt: Date; reference: string; kind: string; reasonCode: string; reason: string | null; status: string; preparedById: string; reviewedById: string | null; reviewedAt: Date | null;
    name: string; detail: string | null; brand: string; lotNumber: string; baseUnit: string; changeQuantity: Prisma.Decimal; countedQuantity: Prisma.Decimal | null }[]>(Prisma.sql`
    SELECT a."preparedAt", a."reference", a."kind", a."reasonCode", a."reason", a."status", a."preparedById", a."reviewedById", a."reviewedAt",
      c."name", c."detail", p."brand", b."lotNumber", l."baseUnit", l."changeQuantity", l."countedQuantity"
    FROM "StockAdjustment" a JOIN "StockAdjustmentLine" l ON l."adjustmentId" = a."id" JOIN "StockBatch" b ON b."id" = l."batchId"
    JOIN "PharmacyProduct" p ON p."id" = b."productId" JOIN "PriceListItem" c ON c."itemType" = p."catalogueType" AND c."catalogueRef" = p."catalogueRef"
    WHERE a."preparedAt" >= ${r.start}::timestamp AND a."preparedAt" < ${r.end}::timestamp
    ${status === 'ALL' ? Prisma.empty : Prisma.sql`AND a."status" = ${status}`}
    ${likeAll(text, [Prisma.sql`c."name"`, Prisma.sql`p."brand"`, Prisma.sql`b."lotNumber"`, Prisma.sql`a."reference"`])}
    ORDER BY a."preparedAt", a."reference", c."name" LIMIT 20000`);
  const who = await userNames(rows.flatMap(x => [x.preparedById, x.reviewedById]));
  const KIND: Record<string, string> = { LOSS: 'Loss', WRITE_OFF: 'Expiry write-off', COUNT: 'Stock count' };
  const data = rows.map(x => ({
    time: x.preparedAt.toISOString(), reference: x.reference, kind: KIND[x.kind] ?? x.kind,
    reason: (ADJUSTMENT_REASONS[x.kind]?.[x.reasonCode] ?? x.reasonCode) + (x.reason ? ` · ${x.reason}` : ''),
    item: item(x.name, x.detail), brand: x.brand, lot: x.lotNumber, change: num(x.changeQuantity), unit: x.baseUnit,
    status: STATUS_LABEL[x.status] ?? x.status, preparedBy: who[x.preparedById] ?? '', reviewedBy: x.reviewedById ? (who[x.reviewedById] ?? '') : '',
  }));
  const refs = (s: string) => new Set(rows.filter(x => x.status === s).map(x => x.reference)).size;
  return {
    name: 'stock-adjustments', title: 'Adjustments, losses and write-offs', period: r.label,
    columns: [
      { key: 'time', header: 'Prepared', type: 'date', width: 20 }, { key: 'reference', header: 'Reference', type: 'text', width: 18 },
      { key: 'kind', header: 'Type', type: 'text', width: 16 }, { key: 'reason', header: 'Reason', type: 'text', width: 30 },
      { key: 'item', header: 'Item', type: 'text', width: 32 }, { key: 'brand', header: 'Brand', type: 'text', width: 18 },
      { key: 'lot', header: 'Lot / batch', type: 'text', width: 14 }, { key: 'change', header: 'Change', type: 'number', width: 11 },
      { key: 'unit', header: 'Unit', type: 'text', width: 10 }, { key: 'status', header: 'Status', type: 'text', width: 18 },
      { key: 'preparedBy', header: 'Prepared by', type: 'text', width: 20 }, { key: 'reviewedBy', header: 'Reviewed by', type: 'text', width: 20 },
    ],
    rows: data, totals: null,
    summary: [
      { label: 'Requests', value: new Set(rows.map(x => x.reference)).size }, { label: 'Awaiting approval', value: refs('PENDING') },
      { label: 'Approved', value: refs('POSTED') }, { label: 'Rejected', value: refs('REJECTED') },
    ],
  };
}

function whole(v: unknown, min: number, max: number, fallback: number, what: string): number {
  if (v === undefined || v === '') return fallback;
  const n = typeof v === 'string' && /^\d{1,4}$/.test(v) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) throw new StockError(400, `${what} must be a whole number from ${min} to ${max}.`);
  return n;
}
const REORDER_STATUS: Record<string, string> = { OUT: 'Out of stock', REORDER: 'Reorder now', OK: 'OK', NO_USE: 'No recent use' };

// Reorder suggestions: how fast each medicine is dispensed against what is usable now. Use is read from the
// ledger (issues, less any issue that was reversed); losses, expiry write-offs and counts are not use. Brands of
// the same item and unit are added together, since they substitute for each other when ordering. Read-only.
async function reorder(q: Query): Promise<Report> {
  const days = whole(q['days'], 7, 365, 90, 'Days of use to look at'), lead = whole(q['lead'], 0, 120, 14, 'Delivery time'), cover = whole(q['cover'], 1, 365, 30, 'Days of stock to order');
  const status = choice(q['status'], ['ALL', 'ACTION', 'OUT', 'REORDER', 'OK', 'NO_USE'], 'ALL');
  const text = search(q['q']);
  const today = todayInput(), horizon = lead + cover;
  const r = range({ from: dayText(new Date(Date.parse(today) - (days - 1) * 86_400_000)), to: today });
  const rows = await prisma.$queryRaw<{ name: string; detail: string | null; baseUnit: string; products: number; available: Prisma.Decimal; expired: Prisma.Decimal; used: Prisma.Decimal; expiring: Prisma.Decimal; firstAt: Date | null }[]>(Prisma.sql`
    WITH ${batchTotals()}, item_stock AS (
      SELECT pt."catalogueRef", pt."baseUnit", MIN(pt."name") AS "name", MIN(pt."detail") AS "detail", COUNT(*)::integer AS "products",
        SUM(pt."available") AS "available", SUM(pt."expired") AS "expired"
      FROM product_totals pt WHERE pt."active" AND pt."catalogueActive" GROUP BY pt."catalogueRef", pt."baseUnit"
    ), expiring AS (
      SELECT bt."catalogueRef", bt."baseUnit", SUM(bt."physical") AS "quantity" FROM batch_totals bt
      WHERE bt."state" = 'USABLE' AND bt."expiryDate" <= (${today}::date + ${horizon}::integer) GROUP BY bt."catalogueRef", bt."baseUnit"
    ), usage AS (
      SELECT p."catalogueRef", m."baseUnit", -SUM(m."quantity") AS "used"
      FROM "StockMovement" m JOIN "StockBatch" b ON b."id" = m."batchId" JOIN "PharmacyProduct" p ON p."id" = b."productId"
      LEFT JOIN "StockMovement" o ON o."id" = m."reversalOfId"
      WHERE m."createdAt" >= ${r.start}::timestamp AND m."createdAt" < ${r.end}::timestamp AND (m."type" = 'ISSUED' OR (m."type" = 'REVERSAL' AND o."type" = 'ISSUED'))
      GROUP BY p."catalogueRef", m."baseUnit"
    ), first_seen AS (
      SELECT p."catalogueRef", MIN(m."createdAt") AS "firstAt" FROM "StockMovement" m JOIN "StockBatch" b ON b."id" = m."batchId" JOIN "PharmacyProduct" p ON p."id" = b."productId" GROUP BY p."catalogueRef"
    )
    SELECT s."name", s."detail", s."baseUnit", s."products", s."available", s."expired", COALESCE(u."used", 0) AS "used", COALESCE(e."quantity", 0) AS "expiring", f."firstAt"
    FROM item_stock s LEFT JOIN usage u ON u."catalogueRef" = s."catalogueRef" AND u."baseUnit" = s."baseUnit"
    LEFT JOIN expiring e ON e."catalogueRef" = s."catalogueRef" AND e."baseUnit" = s."baseUnit" LEFT JOIN first_seen f ON f."catalogueRef" = s."catalogueRef"
    WHERE TRUE ${likeAll(text, [Prisma.sql`s."name"`, Prisma.sql`s."detail"`])}`);
  const RANK: Record<string, number> = { OUT: 0, REORDER: 1, OK: 2, NO_USE: 3 };
  const all = rows.map(x => {
    const available = Math.max(0, num(x.available)), used = Math.max(0, num(x.used));
    // A medicine first received last week has only a week of history, so its rate uses that week and not the whole window.
    const firstDay = x.firstAt ? new Date(x.firstAt.getTime() + 2 * 3_600_000).toISOString().slice(0, 10) : today;
    const observed = Math.min(days, Math.max(1, Math.round((Date.parse(today) - Date.parse(firstDay)) / 86_400_000) + 1));
    const perDay = used / observed, coverDays = perDay > 0 ? available / perDay : null;
    const code = used <= 0 ? 'NO_USE' : available <= 0 ? 'OUT' : coverDays! <= lead ? 'REORDER' : 'OK';
    const suggested = (code === 'OUT' || code === 'REORDER') ? Math.max(0, Math.ceil(perDay * horizon - available)) : null;
    return { code, item: item(x.name, x.detail), unit: x.baseUnit, products: x.products, available, used, perDay: Math.round(perDay * 100) / 100, coverDays: coverDays === null ? null : Math.round(coverDays * 10) / 10,
      expiring: num(x.expiring), suggested, status: REORDER_STATUS[code], observed };
  });
  const keep = (c: string) => status === 'ALL' || c === status || (status === 'ACTION' && (c === 'OUT' || c === 'REORDER'));
  const data = all.filter(d => keep(d.code)).sort((a, b) => RANK[a.code] - RANK[b.code] || (a.coverDays ?? Infinity) - (b.coverDays ?? Infinity) || b.perDay - a.perDay || a.item.localeCompare(b.item));
  const count = (c: string) => all.filter(d => d.code === c).length;
  return {
    name: 'stock-reorder', title: 'Reorder suggestions',
    period: `Use over the last ${days} days · delivery ${lead} days · order to cover ${cover} days · as at ${niceDay(today)}`,
    columns: [
      { key: 'item', header: 'Item', type: 'text', width: 36 }, { key: 'unit', header: 'Unit', type: 'text', width: 11 },
      { key: 'available', header: 'Usable now', type: 'number', width: 12 }, { key: 'used', header: `Used, last ${days} days`, type: 'number', width: 16 },
      { key: 'perDay', header: 'Used per day', type: 'number', width: 13 }, { key: 'coverDays', header: 'Days of stock left', type: 'number', width: 17 },
      { key: 'expiring', header: `Expires within ${horizon} days`, type: 'number', width: 20 }, { key: 'suggested', header: 'Suggested order', type: 'number', width: 16 },
      { key: 'status', header: 'Status', type: 'text', width: 16 },
    ],
    rows: data, totals: null, // units differ across rows, so no column total
    summary: [
      { label: 'Items listed', value: data.length }, { label: 'Out of stock (in use)', value: count('OUT') },
      { label: 'Reorder now', value: count('REORDER') }, { label: 'No recent use', value: count('NO_USE') },
    ],
  };
}

export async function buildStockReport(name: string, q: Query): Promise<Report> {
  if (name === 'reorder') return reorder(q);
  if (name === 'on-hand') return onHand(q);
  if (name === 'expiry') return expiry(q);
  if (name === 'movements') return movements(q);
  if (name === 'adjustments') return adjustments(q);
  throw new StockError(404, 'Unknown stock report.');
}

// GET /pharmacy-stock/reports/:name?format=xlsx — admin and pharmacist only (router guard)
export async function runStockReport(req: AuthRequest, res: Response): Promise<void> {
  try {
    const report = await buildStockReport(String(req.params['name']), req.query as Query);
    if (req.query['format'] === 'xlsx') {
      const who = (await userNames([req.userId]))[req.userId ?? ''] ?? 'staff';
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="ses-${report.name}-${new Date().toISOString().slice(0, 10)}.xlsx"`);
      res.send(await toWorkbook(report, who));
      return;
    }
    res.json(report);
  } catch (error) {
    if (error instanceof StockError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
}
