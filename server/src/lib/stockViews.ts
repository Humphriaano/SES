import { Prisma, PrismaClient } from '@prisma/client';
import { StockActor, StockError, stockPrimitives as s } from './stock';
import { todayInput, validCourseDate } from './prescriptionCourse';

type Query = Record<string, unknown>;
const decimal = (value: Prisma.Decimal | null | undefined) => (value ?? new Prisma.Decimal(0)).toFixed(2);
function integer(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) throw new StockError(400, 'Choose a valid page or page size.');
  return Number(value);
}
function option(value: unknown, choices: string[], fallback: string): string {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || !choices.includes(value)) throw new StockError(400, 'Choose a valid stock filter.');
  return value;
}
function queryText(value: unknown) { return value === undefined || value === '' ? '' : s.text(value, 'stock search', 160); }
function pagination(query: Query) { const page = integer(query.page, 1, 100000), pageSize = integer(query.pageSize, 20, 100); return { page, pageSize, skip: (page - 1) * pageSize }; }
function search(query: string, fields: Prisma.Sql[]) {
  const words = query.split(/\s+/).filter(Boolean).slice(0, 8);
  return words.length ? Prisma.sql`AND ${Prisma.join(words.map(word => { const pattern = '%' + word.replace(/[\\%_]/g, '\\$&') + '%'; return Prisma.sql`(${Prisma.join(fields.map(field => Prisma.sql`${field} ILIKE ${pattern}`), ' OR ')})`; }), ' AND ')}` : Prisma.empty;
}
function facilityDate(value: unknown, label: string): string | null {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !validCourseDate(value)) throw new StockError(400, `Enter a valid ${label}.`);
  return value;
}

// All quantities originate in this per-batch ledger sum. Categories are
// disjoint: expired first, then quarantine, inactive, finally usable stock.
function batchTotals() {
  const today = todayInput();
  return Prisma.sql`batch_totals AS (
    SELECT b."id" AS "batchId", b."productId", b."lotNumber", b."expiryDate", b."status" AS "batchStatus",
      p."catalogueRef", p."brand", p."manufacturer", p."baseUnit", p."packSize", p."packLabel", p."active",
      c."name", c."detail", c."active" AS "catalogueActive", COALESCE(SUM(m."quantity"), 0) AS "physical",
      CASE WHEN b."expiryDate" < ${today}::date THEN 'EXPIRED' WHEN b."status" = 'QUARANTINED' THEN 'QUARANTINED'
        WHEN NOT p."active" OR NOT c."active" THEN 'INACTIVE' ELSE 'USABLE' END AS "state"
    FROM "StockBatch" b JOIN "PharmacyProduct" p ON p."id" = b."productId"
    JOIN "PriceListItem" c ON c."itemType" = p."catalogueType" AND c."catalogueRef" = p."catalogueRef"
    LEFT JOIN "StockMovement" m ON m."batchId" = b."id" GROUP BY b."id", p."id", c."id"
  ), product_totals AS (
    SELECT p."id" AS "productId", p."catalogueRef", p."brand", p."manufacturer", p."baseUnit", p."packSize", p."packLabel", p."active",
      c."name", c."detail", c."active" AS "catalogueActive", COUNT(b."batchId")::integer AS "batchCount",
      COALESCE(SUM(b."physical"), 0) AS "physical",
      COALESCE(SUM(CASE WHEN b."state" = 'USABLE' THEN b."physical" ELSE 0 END), 0) AS "available",
      COALESCE(SUM(CASE WHEN b."state" = 'EXPIRED' THEN b."physical" ELSE 0 END), 0) AS "expired",
      COALESCE(SUM(CASE WHEN b."state" = 'QUARANTINED' THEN b."physical" ELSE 0 END), 0) AS "quarantined",
      COALESCE(SUM(CASE WHEN b."state" = 'INACTIVE' THEN b."physical" ELSE 0 END), 0) AS "inactive"
    FROM "PharmacyProduct" p JOIN "PriceListItem" c ON c."itemType" = p."catalogueType" AND c."catalogueRef" = p."catalogueRef"
    LEFT JOIN batch_totals b ON b."productId" = p."id" GROUP BY p."id", c."id"
  )`;
}
interface Totals { physical: Prisma.Decimal; available: Prisma.Decimal; expired: Prisma.Decimal; quarantined: Prisma.Decimal; inactive: Prisma.Decimal }
function quantities<T extends Totals>(row: T) { return { ...row, physical: decimal(row.physical), available: decimal(row.available), expired: decimal(row.expired), quarantined: decimal(row.quarantined), inactive: decimal(row.inactive) }; }
async function pageRows<T>(db: PrismaClient, prefix: Prisma.Sql, select: Prisma.Sql, order: Prisma.Sql, query: Query) {
  const { page, pageSize, skip } = pagination(query);
  return db.$transaction(async tx => {
    const count = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`${prefix} SELECT COUNT(*)::integer AS total FROM ${select}`);
    const rows = await tx.$queryRaw<T[]>(Prisma.sql`${prefix} SELECT * FROM ${select} ${order} LIMIT ${pageSize} OFFSET ${skip}`);
    return { page, pageSize, total: count[0].total, rows };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function stockOnHand(db: PrismaClient, actor: StockActor, query: Query) {
  s.authorize(actor);
  const q = queryText(query.q), tracking = option(query.tracking, ['TRACKED', 'UNTRACKED', 'ALL'], 'TRACKED');
  const level = option(query.level, ['ALL', 'AVAILABLE', 'UNAVAILABLE', 'OUT_OF_STOCK'], 'ALL');
  const prefix = Prisma.sql`WITH ${batchTotals()}, item_totals AS (
    SELECT c."catalogueRef", c."name", c."detail", p."baseUnit", COUNT(p."productId")::integer AS "productCount",
      SUM(COALESCE(p."batchCount",0))::integer AS "batchCount", COUNT(p."productId") > 0 AS "tracked",
      COALESCE(SUM(p."physical"),0) AS "physical", COALESCE(SUM(p."available"),0) AS "available",
      COALESCE(SUM(p."expired"),0) AS "expired", COALESCE(SUM(p."quarantined"),0) AS "quarantined", COALESCE(SUM(p."inactive"),0) AS "inactive"
    FROM "PriceListItem" c LEFT JOIN product_totals p ON p."catalogueRef" = c."catalogueRef" WHERE c."itemType" = 'DRUG'
      ${search(q, [Prisma.sql`c."name"`, Prisma.sql`c."detail"`, Prisma.sql`c."catalogueRef"`, Prisma.sql`COALESCE((SELECT string_agg(p2."brand" || ' ' || COALESCE(p2."manufacturer",''), ' ') FROM "PharmacyProduct" p2 WHERE p2."catalogueRef" = c."catalogueRef"),'')`])}
    GROUP BY c."id", p."baseUnit"
  ), filtered AS (SELECT * FROM item_totals WHERE TRUE
    ${tracking === 'ALL' ? Prisma.empty : tracking === 'TRACKED' ? Prisma.sql`AND "tracked"` : Prisma.sql`AND NOT "tracked"`}
    ${level === 'AVAILABLE' ? Prisma.sql`AND "tracked" AND "available" > 0` : level === 'UNAVAILABLE' ? Prisma.sql`AND "tracked" AND "available" = 0 AND "physical" > 0` : level === 'OUT_OF_STOCK' ? Prisma.sql`AND "tracked" AND "physical" = 0` : Prisma.empty}
  )`;
  const data = await pageRows<Totals & { catalogueRef: string; name: string; detail: string | null; baseUnit: string | null; productCount: number; batchCount: number; tracked: boolean }>(db, prefix, Prisma.sql`filtered`, Prisma.sql`ORDER BY lower("name"), "catalogueRef", "baseUnit" NULLS FIRST`, query);
  return { ...data, asOf: new Date().toISOString(), rows: data.rows.map(row => ({ ...quantities(row), ...(!row.tracked ? { physical: null, available: null, expired: null, quarantined: null, inactive: null } : {}), state: !row.tracked ? 'UNTRACKED' : row.available.gt(0) ? 'AVAILABLE' : row.physical.gt(0) ? 'UNAVAILABLE' : 'OUT_OF_STOCK' })) };
}

export async function stockProductRows(db: PrismaClient, actor: StockActor, query: Query) {
  s.authorize(actor);
  const q = queryText(query.q), catalogueRef = query.catalogueRef === undefined ? null : s.ref(query.catalogueRef), baseUnit = query.baseUnit === undefined ? null : s.unit(query.baseUnit);
  const prefix = Prisma.sql`WITH ${batchTotals()}, filtered AS (SELECT * FROM product_totals WHERE TRUE
    ${catalogueRef ? Prisma.sql`AND "catalogueRef" = ${catalogueRef}` : Prisma.empty} ${baseUnit ? Prisma.sql`AND "baseUnit" = ${baseUnit}` : Prisma.empty}
    ${search(q, [Prisma.sql`"name"`, Prisma.sql`"detail"`, Prisma.sql`"catalogueRef"`, Prisma.sql`"brand"`, Prisma.sql`"manufacturer"`])}
  )`;
  const data = await pageRows<Totals & { productId: string; catalogueRef: string; name: string; detail: string | null; brand: string; manufacturer: string | null; baseUnit: string; packSize: Prisma.Decimal; packLabel: string; active: boolean; catalogueActive: boolean; batchCount: number }>(db, prefix, Prisma.sql`filtered`, Prisma.sql`ORDER BY lower("name"), lower("brand"), "productId"`, query);
  return { ...data, rows: data.rows.map(row => ({ ...quantities(row), packSize: decimal(row.packSize) })) };
}

export async function stockExpiryBatches(db: PrismaClient, actor: StockActor, query: Query) {
  s.authorize(actor);
  const q = queryText(query.q), state = option(query.state, ['ALL', 'USABLE', 'EXPIRED', 'QUARANTINED', 'INACTIVE'], 'ALL');
  const includeZero = option(query.includeZero, ['true', 'false'], 'false') === 'true';
  const expiresWithin = query.expiresWithin === undefined || query.expiresWithin === '' ? null : integer(query.expiresWithin, 90, 3650);
  const todayText = todayInput(), today = new Date(todayText + 'T00:00:00Z'), end = expiresWithin === null ? null : new Date(today.getTime() + expiresWithin * 86400000).toISOString().slice(0,10);
  const prefix = Prisma.sql`WITH ${batchTotals()}, filtered AS (SELECT * FROM batch_totals WHERE TRUE
    ${includeZero ? Prisma.empty : Prisma.sql`AND "physical" > 0`} ${state === 'ALL' ? Prisma.empty : Prisma.sql`AND "state" = ${state}`}
    ${end ? Prisma.sql`AND "expiryDate" >= ${todayText}::date AND "expiryDate" <= ${end}::date` : Prisma.empty}
    ${search(q, [Prisma.sql`"name"`, Prisma.sql`"detail"`, Prisma.sql`"catalogueRef"`, Prisma.sql`"brand"`, Prisma.sql`"manufacturer"`, Prisma.sql`"lotNumber"`])}
  )`;
  const data = await pageRows<{ batchId: string; productId: string; catalogueRef: string; name: string; detail: string | null; brand: string; manufacturer: string | null; baseUnit: string; packSize: Prisma.Decimal; packLabel: string; expiryDate: Date; state: string; physical: Prisma.Decimal }>(db, prefix, Prisma.sql`filtered`, Prisma.sql`ORDER BY "expiryDate", lower("name"), "batchId"`, query);
  return { ...data, facilityDate: todayInput(), rows: data.rows.map(row => ({ ...row, physical: decimal(row.physical), available: row.state === 'USABLE' ? decimal(row.physical) : '0.00', packSize: decimal(row.packSize), expiryDate: row.expiryDate.toISOString().slice(0,10), daysToExpiry: Math.round((row.expiryDate.getTime() - today.getTime()) / 86400000) })) };
}

export async function stockCard(db: PrismaClient, actor: StockActor, productId: unknown, query: Query) {
  s.authorize(actor);
  const id = s.text(productId, 'product ID', 80), batchId = query.batchId === undefined || query.batchId === '' ? null : s.text(query.batchId, 'batch ID', 80);
  const from = facilityDate(query.from, 'start date'), to = facilityDate(query.to, 'end date');
  if (from && to && from > to) throw new StockError(400, 'The end date must be on or after the start date.');
  // Prisma timestamps are stored as UTC without a timezone. Bind UTC clock
  // strings explicitly, so the database session timezone cannot shift filters.
  const start = from ? new Date(from + 'T00:00:00+02:00').toISOString().replace('Z','') : null, end = to ? new Date(new Date(to + 'T00:00:00+02:00').getTime() + 86400000).toISOString().replace('Z','') : null;
  const type = option(query.type, ['ALL', 'RECEIVED', 'ISSUED', 'LOSS', 'ADJUSTMENT', 'REVERSAL'], 'ALL'), { page, pageSize, skip } = pagination(query);
  return db.$transaction(async tx => {
    const product = await tx.pharmacyProduct.findUnique({ where: { id }, include: { catalogueItem: { select: { name: true, detail: true, active: true } } } });
    if (!product) throw new StockError(404, 'Stock product not found.');
    const batches = await tx.stockBatch.findMany({ where: { productId: id }, orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }], select: { id: true, lotNumber: true, expiryDate: true, status: true } });
    if (batchId && !batches.some(batch => batch.id === batchId)) throw new StockError(404, 'That batch does not belong to this product.');
    const scope = Prisma.sql`b."productId" = ${id} ${batchId ? Prisma.sql`AND b."id" = ${batchId}` : Prisma.empty}`;
    const base = Prisma.sql`WITH ledger AS (
      SELECT m.*, b."lotNumber", b."expiryDate", r."kind" AS "receiptKind",
        COALESCE(r."source", rr."source", CASE WHEN patient."id" IS NOT NULL THEN patient."firstName" || ' ' || patient."lastName" ELSE NULL END) AS "counterparty",
        u."name" AS "actorName", u."designation" AS "actorDesignation",
        SUM(m."quantity") OVER (ORDER BY m."postingOrder" ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS "runningBalance"
      FROM "StockMovement" m JOIN "StockBatch" b ON b."id" = m."batchId"
      LEFT JOIN "StockReceiptLine" l ON l."id" = m."receiptLineId" LEFT JOIN "StockReceipt" r ON r."id" = l."receiptId"
      LEFT JOIN "StockMovement" original ON original."id" = m."reversalOfId"
      LEFT JOIN "StockReceiptLine" rl ON rl."id" = original."receiptLineId" LEFT JOIN "StockReceipt" rr ON rr."id" = rl."receiptId"
      LEFT JOIN "StockDispensingAllocation" allocation ON allocation."movementId" = m."id"
      LEFT JOIN "Dispensing" d ON d."id" = allocation."dispensingId" LEFT JOIN "Patient" patient ON patient."id" = d."patientId"
      LEFT JOIN "User" u ON u."id" = m."actorId" WHERE ${scope}
    ), filtered AS (SELECT * FROM ledger WHERE TRUE
      ${start ? Prisma.sql`AND "createdAt" >= ${start}::timestamp` : Prisma.empty} ${end ? Prisma.sql`AND "createdAt" < ${end}::timestamp` : Prisma.empty}
      ${type === 'ALL' ? Prisma.empty : Prisma.sql`AND "type" = ${type}::"StockMovementType"`}
    )`;
    const count = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`${base} SELECT COUNT(*)::integer AS total FROM filtered`);
    const rows = await tx.$queryRaw<{ id: string; postingOrder: bigint; batchId: string; type: string; quantity: Prisma.Decimal; baseUnit: string; reference: string; reason: string | null; actorId: string; createdAt: Date; lotNumber: string; expiryDate: Date; receiptKind: string | null; counterparty: string | null; actorName: string | null; actorDesignation: string | null; runningBalance: Prisma.Decimal }[]>(Prisma.sql`${base} SELECT "id", "postingOrder", "batchId", "type", "quantity", "baseUnit", "reference", "reason", "actorId", "createdAt", "lotNumber", "expiryDate", "receiptKind", "counterparty", "actorName", "actorDesignation", "runningBalance" FROM filtered ORDER BY "postingOrder" LIMIT ${pageSize} OFFSET ${skip}`);
    const [totals] = await tx.$queryRaw<{ current: Prisma.Decimal; opening: Prisma.Decimal; closing: Prisma.Decimal }[]>(Prisma.sql`
      SELECT COALESCE(SUM(m."quantity"),0) AS current,
        COALESCE(SUM(CASE WHEN ${start !== null} AND m."createdAt" < ${start}::timestamp THEN m."quantity" ELSE 0 END),0) AS opening,
        COALESCE(SUM(CASE WHEN ${end === null} OR m."createdAt" < ${end}::timestamp THEN m."quantity" ELSE 0 END),0) AS closing
      FROM "StockMovement" m JOIN "StockBatch" b ON b."id" = m."batchId" WHERE ${scope}`);
    return { product: { productId: product.id, catalogueRef: product.catalogueRef, name: product.catalogueItem.name, detail: product.catalogueItem.detail, brand: product.brand, manufacturer: product.manufacturer, baseUnit: product.baseUnit, packSize: decimal(product.packSize), packLabel: product.packLabel, active: product.active }, batches: batches.map(batch => ({ ...batch, expiryDate: batch.expiryDate.toISOString().slice(0,10) })), selectedBatchId: batchId, page, pageSize, total: count[0].total, from, to, type, balanceUnit: product.baseUnit,
      openingBalance: decimal(totals.opening), closingBalance: decimal(totals.closing), currentBalance: decimal(totals.current),
      rows: rows.map(row => ({ ...row, postingOrder: row.postingOrder.toString(), quantity: decimal(row.quantity), runningBalance: decimal(row.runningBalance), createdAt: row.createdAt.toISOString(), expiryDate: row.expiryDate.toISOString().slice(0,10) })) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
