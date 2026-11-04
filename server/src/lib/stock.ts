import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Prisma, PrismaClient } from '@prisma/client';
import { audit } from './billingOps';
import { todayInput, validCourseDate } from './prescriptionCourse';

type Tx = Prisma.TransactionClient;
export interface StockActor { userId?: string; role?: string }
export class StockError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const UNITS = ['tablet', 'capsule', 'sachet', 'vial', 'ampoule', 'tube', 'inhaler', 'patch', 'suppository', 'pessary', 'bottle', 'mL', 'unit'];
const MAX_QUANTITY = new Prisma.Decimal('10000000000');
type Input = Record<string, unknown>;
function input(value: unknown, fields: string[]): Input {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StockError(400, 'Enter stock details.');
  const body = value as Input;
  if (Object.keys(body).some(key => !fields.includes(key))) throw new StockError(400, 'An unsupported stock field was supplied.');
  return body;
}
function text(value: unknown, label: string, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new StockError(400, `Enter a valid ${label}.`);
  return value.trim().replace(/\s+/g, ' ');
}
function optionalText(value: unknown, label: string, max = 160): string | null {
  return value == null || value === '' ? null : text(value, label, max);
}
function ref(value: unknown): string {
  const result = text(value, 'catalogue code', 80);
  if (!/^[A-Za-z0-9_.:-]+$/.test(result)) throw new StockError(400, 'Choose an exact catalogue code.');
  return result;
}
function quantity(value: unknown, label: string, zero = false): Prisma.Decimal {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d{1,11}(?:\.\d{1,2})?$/.test(String(value))) throw new StockError(400, `${label} must be a decimal with at most two places.`);
  const n = new Prisma.Decimal(String(value));
  if ((zero ? n.lt(0) : n.lte(0)) || n.gt(MAX_QUANTITY)) throw new StockError(400, `Enter a valid ${label}.`);
  return n;
}
function unit(value: unknown): string {
  if (typeof value !== 'string' || !UNITS.includes(value)) throw new StockError(400, 'Choose a physical stock unit, not a course or price unit.');
  return value;
}
function date(value: unknown, label: string): string {
  if (typeof value !== 'string' || !validCourseDate(value)) throw new StockError(400, `Enter a valid ${label} as YYYY-MM-DD.`);
  return value;
}
function authorize(actor: StockActor): string {
  if (!actor.userId) throw new StockError(401, 'Sign in before accessing stock.');
  if (!(actor.role ?? '').split(',').some(role => ['admin', 'pharmacist'].includes(role.trim()))) throw new StockError(403, 'Stock management requires pharmacy access.');
  return actor.userId;
}
function snapshot(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value, (_key, field) => typeof field === 'bigint' ? field.toString() : field)); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}

// Built-in variants are bundled definitions; custom variants live in the DB.
// A manually entered price row alone is not a new clinical catalogue item.
let builtinRefs: Set<string> | undefined;
async function requireCatalogue(tx: Tx, catalogueRef: string) {
  if (!builtinRefs) {
    const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/builtin-price-items.json'), 'utf8')) as { itemType: string; catalogueRef: string }[];
    builtinRefs = new Set(rows.filter(row => row.itemType === 'DRUG').map(row => row.catalogueRef));
  }
  const custom = builtinRefs.has(catalogueRef) ? null : await tx.catalogueDrug.findUnique({ where: { code: catalogueRef } });
  if (!builtinRefs.has(catalogueRef) && !custom?.active) throw new StockError(400, 'Choose an active drug variant from the catalogue.');
  const item = await tx.priceListItem.findUnique({ where: { itemType_catalogueRef: { itemType: 'DRUG', catalogueRef } } });
  if (!item?.active) throw new StockError(409, 'Load or activate the catalogue item before linking stock. A selling price is not required.');
}

async function write(db: PrismaClient, actor: StockActor, key: unknown, kind: string, request: unknown, action: (tx: Tx, operationId: string, actorId: string) => Promise<unknown>) {
  const actorId = authorize(actor);
  if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new StockError(400, 'Supply a stable Idempotency-Key of 8–128 letters, digits or . _ : - characters.');
  const hash = createHash('sha256').update(canonical(request)).digest('hex');
  try {
    return await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'stock-operation:' + actorId + ':' + key}))`;
      const existing = await tx.stockOperation.findUnique({ where: { actorId_key: { actorId, key } } });
      if (existing) {
        if (existing.kind !== kind || existing.requestHash !== hash) throw new StockError(409, 'This stock operation key was already used for different details.');
        if (!existing.response) throw new StockError(409, 'This stock operation is incomplete.');
        return { result: existing.response, replayed: true };
      }
      const operation = await tx.stockOperation.create({ data: { actorId, key, kind, requestHash: hash } });
      const result = snapshot(await action(tx, operation.id, actorId));
      await tx.stockOperation.update({ where: { id: operation.id }, data: { response: result } });
      // Surface deferred approval/completeness failures before COMMIT. Some
      // Prisma/PostgreSQL versions can obscure errors raised during COMMIT.
      if (['SUBMIT_ADJUSTMENT', 'APPROVE_ADJUSTMENT', 'REJECT_ADJUSTMENT', 'CANCEL_ADJUSTMENT'].includes(kind)) await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return { result, replayed: false };
    }, { timeout: 20000 });
  } catch (error) {
    if (error instanceof StockError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2003', 'P2004', 'P2010', 'P2034'].includes(error.code)) throw new StockError(409, 'Stock changed or the record already exists. Refresh and check the stock details.');
    throw error;
  }
}

async function lockBatches(tx: Tx, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) {
    const found = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "StockBatch" WHERE "id" = ${id} FOR UPDATE`;
    if (!found.length) throw new StockError(404, 'Stock batch not found.');
  }
}
async function balance(tx: Tx, batchId: string) {
  return (await tx.stockMovement.aggregate({ where: { batchId }, _sum: { quantity: true } }))._sum.quantity ?? new Prisma.Decimal(0);
}
async function lockCatalogue(tx: Tx, code: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'stock-catalogue:' + code}))`;
}

function productInput(body: unknown) {
  const b = input(body, ['catalogueRef', 'brand', 'manufacturer', 'baseUnit', 'packSize', 'packLabel']);
  return { catalogueRef: ref(b.catalogueRef), brand: text(b.brand, 'brand'), manufacturer: optionalText(b.manufacturer, 'manufacturer'), baseUnit: unit(b.baseUnit), packSize: quantity(b.packSize, 'pack size').toFixed(2), packLabel: text(b.packLabel, 'pack label', 60) };
}
export function createStockProduct(db: PrismaClient, actor: StockActor, key: unknown, body: unknown) {
  const data = productInput(body);
  return write(db, actor, key, 'CREATE_PRODUCT', data, async (tx, _op, actorId) => {
    await lockCatalogue(tx, data.catalogueRef);
    await requireCatalogue(tx, data.catalogueRef);
    const product = await tx.pharmacyProduct.create({ data: { ...data, brandKey: data.brand.toLowerCase(), manufacturerKey: (data.manufacturer ?? '').toLowerCase(), createdById: actorId } });
    await audit(tx, { userId: actorId, action: 'STOCK_PRODUCT_CREATED', entity: 'PharmacyProduct', entityId: product.id, after: snapshot(product) });
    return product;
  });
}

export function createStockBatch(db: PrismaClient, actor: StockActor, key: unknown, body: unknown) {
  const b = input(body, ['productId', 'lotNumber', 'expiryDate', 'status']);
  const status = b.status ?? 'USABLE';
  if (status !== 'USABLE' && status !== 'QUARANTINED') throw new StockError(400, 'Choose a valid batch status.');
  const data = { productId: text(b.productId, 'product ID', 80), lotNumber: text(b.lotNumber, 'batch number', 100).toUpperCase(), expiryDate: date(b.expiryDate, 'expiry date'), status: status as 'USABLE' | 'QUARANTINED' };
  return write(db, actor, key, 'CREATE_BATCH', data, async (tx, _op, actorId) => {
    if (data.expiryDate < todayInput()) throw new StockError(400, 'The batch expiry date is in the past.');
    const product = await tx.pharmacyProduct.findUnique({ where: { id: data.productId } });
    if (!product?.active) throw new StockError(404, 'Active stock product not found.');
    await requireCatalogue(tx, product.catalogueRef);
    const batch = await tx.stockBatch.create({ data: { ...data, expiryDate: new Date(data.expiryDate + 'T00:00:00Z'), createdById: actorId } });
    await audit(tx, { userId: actorId, action: 'STOCK_BATCH_CREATED', entity: 'StockBatch', entityId: batch.id, after: snapshot(batch) });
    return batch;
  });
}

// Low-level foundation services. Public atomic receiving is in stockReceiving;
// direct issuing/adjustment routes await their corresponding workflow stages.
export function postStockReceipt(db: PrismaClient, actor: StockActor, key: unknown, body: unknown) {
  const b = input(body, ['receivedDate', 'reference', 'source', 'lines']);
  // Hash the caller's intent before applying time-dependent defaults. A retry
  // across midnight must still replay the original dated receipt.
  const receivedDate = b.receivedDate == null ? null : date(b.receivedDate, 'received date');
  if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 100) throw new StockError(400, 'A receipt needs 1–100 batch lines.');
  const lines = b.lines.map(raw => {
    const line = input(raw, ['batchId', 'packCount', 'costPerPack']);
    return { batchId: text(line.batchId, 'batch ID', 80), packCount: quantity(line.packCount, 'pack count').toFixed(2), costPerPack: line.costPerPack == null || line.costPerPack === '' ? null : quantity(line.costPerPack, 'cost per pack', true).toFixed(2) };
  });
  if (new Set(lines.map(line => line.batchId)).size !== lines.length) throw new StockError(400, 'Combine repeated batches into one receipt line.');
  const data = { receivedDate, reference: text(b.reference, 'receipt reference'), source: text(b.source, 'stock source'), lines };
  return write(db, actor, key, 'RECEIVE', data, async (tx, operationId, actorId) => {
    const effectiveDate = receivedDate ?? todayInput();
    if (effectiveDate > todayInput()) throw new StockError(400, 'Received date cannot be in the future.');
    await lockBatches(tx, lines.map(line => line.batchId));
    const receipt = await tx.stockReceipt.create({ data: { operationId, receivedDate: new Date(effectiveDate + 'T00:00:00Z'), reference: data.reference, source: data.source, receivedById: actorId } });
    const movements = [];
    for (const line of lines) {
      const batch = await tx.stockBatch.findUniqueOrThrow({ where: { id: line.batchId }, include: { product: true } });
      if (!batch.product.active) throw new StockError(409, 'The stock product is inactive.');
      if (batch.expiryDate.toISOString().slice(0, 10) < todayInput()) throw new StockError(409, 'Do not receive an expired batch.');
      const converted = new Prisma.Decimal(line.packCount).mul(batch.product.packSize);
      if (converted.decimalPlaces() > 2 || converted.gt(MAX_QUANTITY)) throw new StockError(400, 'The pack conversion exceeds the supported stock precision or quantity.');
      const savedLine = await tx.stockReceiptLine.create({ data: { receiptId: receipt.id, batchId: batch.id, packCount: line.packCount, packSize: batch.product.packSize, packLabel: batch.product.packLabel, baseQuantity: converted, baseUnit: batch.product.baseUnit, costPerPack: line.costPerPack } });
      movements.push(await tx.stockMovement.create({ data: { operationId, batchId: batch.id, type: 'RECEIVED', quantity: converted, baseUnit: batch.product.baseUnit, reference: data.reference, actorId, receiptLineId: savedLine.id } }));
    }
    await audit(tx, { userId: actorId, action: 'STOCK_RECEIVED', entity: 'StockReceipt', entityId: receipt.id, after: snapshot({ receipt, movements }) });
    return { receipt, movements };
  });
}

export function postStockIssue(db: PrismaClient, actor: StockActor, key: unknown, body: unknown) {
  const b = input(body, ['catalogueRef', 'baseUnit', 'reference', 'allocations']);
  if (!Array.isArray(b.allocations) || !b.allocations.length || b.allocations.length > 100) throw new StockError(400, 'Choose 1–100 batch allocations.');
  const allocations = b.allocations.map(raw => { const line = input(raw, ['batchId', 'quantity']); return { batchId: text(line.batchId, 'batch ID', 80), quantity: quantity(line.quantity, 'issue quantity').toFixed(2) }; });
  if (new Set(allocations.map(line => line.batchId)).size !== allocations.length) throw new StockError(400, 'Combine repeated batches into one allocation.');
  const data = { catalogueRef: ref(b.catalogueRef), baseUnit: unit(b.baseUnit), reference: text(b.reference, 'issue reference'), allocations };
  return write(db, actor, key, 'ISSUE', data, async (tx, operationId, actorId) => {
    await requireCatalogue(tx, data.catalogueRef);
    await lockBatches(tx, allocations.map(line => line.batchId));
    const movements = [];
    for (const line of allocations) {
      const batch = await tx.stockBatch.findUniqueOrThrow({ where: { id: line.batchId }, include: { product: true } });
      if (batch.product.catalogueRef !== data.catalogueRef || batch.product.baseUnit !== data.baseUnit) throw new StockError(409, 'The batch does not match the exact catalogue variant and stock unit.');
      if (!batch.product.active || batch.status !== 'USABLE' || batch.expiryDate.toISOString().slice(0, 10) < todayInput()) throw new StockError(409, 'This batch is inactive, quarantined or expired.');
      if ((await balance(tx, batch.id)).lt(line.quantity)) throw new StockError(409, 'The batch has insufficient stock.');
      movements.push(await tx.stockMovement.create({ data: { operationId, batchId: batch.id, type: 'ISSUED', quantity: new Prisma.Decimal(line.quantity).negated(), baseUnit: data.baseUnit, reference: data.reference, actorId } }));
    }
    await audit(tx, { userId: actorId, action: 'STOCK_ISSUED', entity: 'StockOperation', entityId: operationId, after: snapshot(movements) });
    return { movements };
  });
}

export function reverseStockMovement(db: PrismaClient, actor: StockActor, key: unknown, body: unknown) {
  const b = input(body, ['movementId', 'reason']);
  const data = { movementId: text(b.movementId, 'movement ID', 80), reason: text(b.reason, 'correction reason', 1000) };
  return write(db, actor, key, 'REVERSE', data, async (tx, operationId, actorId) => {
    const original = await tx.stockMovement.findUnique({ where: { id: data.movementId }, include: { allocation: true } });
    if (!original) throw new StockError(404, 'Stock movement not found.');
    if (original.type === 'REVERSAL') throw new StockError(409, 'Correct the source operation rather than reversing a reversal.');
    if (original.allocation) throw new StockError(409, 'A dispensing allocation needs a coordinated pharmacy correction.');
    await lockBatches(tx, [original.batchId]);
    if (await tx.stockMovement.findUnique({ where: { reversalOfId: original.id } })) throw new StockError(409, 'This stock movement has already been reversed.');
    const delta = original.quantity.negated();
    if ((await balance(tx, original.batchId)).plus(delta).lt(0)) throw new StockError(409, 'The receipt cannot be reversed after its stock has been issued.');
    const movement = await tx.stockMovement.create({ data: { operationId, batchId: original.batchId, type: 'REVERSAL', quantity: delta, baseUnit: original.baseUnit, reference: original.reference, reason: data.reason, actorId, reversalOfId: original.id } });
    await audit(tx, { userId: actorId, action: 'STOCK_REVERSED', entity: 'StockMovement', entityId: movement.id, before: snapshot(original), after: snapshot(movement), reason: data.reason });
    return movement;
  });
}

export async function listStockProducts(db: PrismaClient, actor: StockActor, catalogueRef: unknown) {
  authorize(actor);
  const code = ref(catalogueRef);
  const products = await db.pharmacyProduct.findMany({ where: { catalogueRef: code }, include: { batches: { select: { _count: { select: { receiptLines: true } } } } }, orderBy: [{ brand: 'asc' }, { id: 'asc' }], take: 100 });
  return products.map(({ batches, ...product }) => ({ ...product, receiptCount: batches.reduce((sum, batch) => sum + batch._count.receiptLines, 0) })).sort((a, b) => b.receiptCount - a.receiptCount || a.brand.localeCompare(b.brand));
}

// Shared only with the receiving service; HTTP access remains in guarded routes.
export const stockPrimitives = { input, text, optionalText, ref, quantity, unit, date, authorize, snapshot, canonical, write, requireCatalogue, lockBatches, lockCatalogue, balance, productInput };
export async function listStockBatches(db: PrismaClient, actor: StockActor, productId: unknown) {
  authorize(actor);
  return db.stockBatch.findMany({ where: { productId: text(productId, 'product ID', 80) }, orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }], take: 100 });
}
export async function stockBalances(db: PrismaClient, actor: StockActor, catalogueRef: unknown) {
  authorize(actor);
  const code = ref(catalogueRef);
  const today = todayInput();
  const rows = await db.$queryRaw<{ productId: string; brand: string; baseUnit: string; physical: Prisma.Decimal; available: Prisma.Decimal; expired: Prisma.Decimal; quarantined: Prisma.Decimal }[]>(Prisma.sql`
    SELECT p."id" AS "productId", p."brand", p."baseUnit",
      COALESCE(SUM(m."quantity"), 0) AS "physical",
      COALESCE(SUM(CASE WHEN p."active" AND c."active" AND b."status" = 'USABLE' AND b."expiryDate" >= ${today}::date THEN m."quantity" ELSE 0 END), 0) AS "available",
      COALESCE(SUM(CASE WHEN b."expiryDate" < ${today}::date THEN m."quantity" ELSE 0 END), 0) AS "expired",
      COALESCE(SUM(CASE WHEN b."status" = 'QUARANTINED' THEN m."quantity" ELSE 0 END), 0) AS "quarantined"
    FROM "PharmacyProduct" p JOIN "PriceListItem" c ON c."itemType" = p."catalogueType" AND c."catalogueRef" = p."catalogueRef"
    LEFT JOIN "StockBatch" b ON b."productId" = p."id"
    LEFT JOIN "StockMovement" m ON m."batchId" = b."id"
    WHERE p."catalogueRef" = ${code}
    GROUP BY p."id", p."brand", p."baseUnit" ORDER BY p."brand", p."id"`);
  return { catalogueRef: code, tracked: rows.length > 0, products: rows.map(row => ({ ...row, physical: row.physical.toFixed(2), available: row.available.toFixed(2), expired: row.expired.toFixed(2), quarantined: row.quarantined.toFixed(2) })) };
}
