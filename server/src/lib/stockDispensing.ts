import { Prisma, PrismaClient } from '@prisma/client';
import { audit } from './billingOps';
import { todayInput } from './prescriptionCourse';
import { StockActor, StockError, stockPrimitives as s } from './stock';

type Tx = Prisma.TransactionClient;
interface Batch { batchId: string; productId: string; brand: string; manufacturer: string | null; lotNumber: string; expiryDate: Date; available: Prisma.Decimal }
interface Allocation { batchId: string; quantity: string }
export interface DispensingStockSelection { productId?: string; allocations?: Allocation[]; overrideReason?: string }
export function stockSelection(value: unknown): DispensingStockSelection {
  if (value == null) return {};
  const b = s.input(value, ['productId', 'allocations', 'overrideReason']);
  const result: DispensingStockSelection = {};
  if (b.productId) result.productId = s.text(b.productId, 'stock product', 80);
  if (b.overrideReason) result.overrideReason = s.text(b.overrideReason, 'batch selection reason', 1000);
  if (b.allocations !== undefined) {
    if (!Array.isArray(b.allocations) || !b.allocations.length || b.allocations.length > 100) throw new StockError(400, 'Choose 1–100 batch allocations.');
    result.allocations = b.allocations.map(value => { const line = s.input(value, ['batchId', 'quantity']); return { batchId: s.text(line.batchId, 'batch ID', 80), quantity: s.quantity(line.quantity, 'batch quantity').toFixed(2) }; });
    if (new Set(result.allocations.map(line => line.batchId)).size !== result.allocations.length) throw new StockError(400, 'Use one allocation per batch.');
  }
  return result;
}
// One catalogue lock coordinates the transition to tracked stock and all
// dispensing plans for that item. Batch locks also protect other ledger writers.
async function candidates(tx: Tx, code: string, baseUnit: string, lock: boolean) {
  const products = await tx.pharmacyProduct.findMany({ where: { catalogueRef: code }, select: { id: true, active: true, baseUnit: true } });
  if (!products.length) return { tracked: false, unitMatched: false, batches: [] as Batch[] };
  const item = await tx.priceListItem.findUnique({ where: { itemType_catalogueRef: { itemType: 'DRUG', catalogueRef: code } } });
  const ids = products.filter(p => p.active && p.baseUnit === baseUnit).map(p => p.id);
  if (!item?.active || !ids.length) return { tracked: true, unitMatched: products.some(product => product.baseUnit === baseUnit), batches: [] as Batch[] };
  if (lock) {
    const batches = await tx.stockBatch.findMany({ where: { productId: { in: ids } }, select: { id: true } });
    await s.lockBatches(tx, batches.map(b => b.id));
  }
  const today = todayInput();
  const batches = await tx.$queryRaw<Batch[]>(Prisma.sql`
    SELECT b."id" AS "batchId", p."id" AS "productId", p."brand", p."manufacturer", b."lotNumber", b."expiryDate",
      COALESCE(SUM(m."quantity"),0) AS "available"
    FROM "StockBatch" b JOIN "PharmacyProduct" p ON p."id"=b."productId"
    LEFT JOIN "StockMovement" m ON m."batchId"=b."id"
    WHERE p."id" IN (${Prisma.join(ids)}) AND b."status"='USABLE' AND b."expiryDate">=${today}::date
    GROUP BY b."id", p."id" HAVING COALESCE(SUM(m."quantity"),0)>0
    ORDER BY b."expiryDate", b."id"`);
  return { tracked: true, unitMatched: true, batches };
}
function allocate(batches: Batch[], quantity: Prisma.Decimal): Allocation[] {
  let remaining = quantity;
  const result: Allocation[] = [];
  for (const batch of batches) {
    if (remaining.isZero()) break;
    const take = Prisma.Decimal.min(remaining, batch.available);
    result.push({ batchId: batch.batchId, quantity: take.toFixed(2) });
    remaining = remaining.minus(take);
  }
  return result;
}
function sameAllocations(a: Allocation[], b: Allocation[]) {
  const normalized = (rows: Allocation[]) => rows.map(row => row.batchId + ':' + row.quantity).sort().join('|');
  return normalized(a) === normalized(b);
}
export async function dispenseStockPlan(db: PrismaClient, actor: StockActor, query: Record<string, unknown>) {
  s.authorize(actor);
  const code = s.ref(query.catalogueRef), baseUnit = s.unit(query.baseUnit), quantity = s.quantity(query.quantity, 'supply quantity');
  const productId = query.productId ? s.text(query.productId, 'stock product', 80) : null;
  return db.$transaction(async tx => {
    const result = await candidates(tx, code, baseUnit, false);
    const filtered = productId ? result.batches.filter(b => b.productId === productId) : result.batches;
    const available = filtered.reduce((sum,b) => sum.plus(b.available), new Prisma.Decimal(0));
    return { catalogueRef: code, baseUnit, quantity: quantity.toFixed(2), tracked: result.tracked, unitMatched: result.unitMatched, available: result.tracked ? available.toFixed(2) : null,
      sufficient: !result.tracked || available.gte(quantity), suggested: allocate(filtered, quantity), defaultSuggested: allocate(result.batches, quantity),
      batches: result.batches.map(b => ({ ...b, expiryDate: b.expiryDate.toISOString().slice(0,10), available: b.available.toFixed(2) })) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

// Exact physical stock only. Missing clinical supply units are unknown, never
// proof of zero. A bottle balance cannot establish availability of mL stock.
export async function prescriptionStockAvailability(tx: Tx, medication: { catalogueCode: string|null; quantityUnit: string|null; quantity: Prisma.Decimal|null }, lock = false) {
  const code = medication.catalogueCode;
  const unknown = { state: 'UNKNOWN', tracked: false, baseUnit: medication.quantityUnit, available: null as string|null, required: medication.quantity?.toFixed(2) ?? null };
  if (!code) return unknown;
  if (lock) await s.lockCatalogue(tx, code);
  const products = await tx.pharmacyProduct.findMany({ where: { catalogueRef: code }, select: { baseUnit: true } });
  if (!products.length) return { ...unknown, state: 'UNTRACKED' };
  if (!medication.quantityUnit || !products.some(product => product.baseUnit === medication.quantityUnit)) return { ...unknown, tracked: true };
  const { batches } = await candidates(tx, code, medication.quantityUnit, lock);
  const available = batches.reduce((sum,batch) => sum.plus(batch.available), new Prisma.Decimal(0));
  const state = available.isZero() ? 'UNAVAILABLE' : !medication.quantity?.gt(0) ? 'REVIEW' : available.lt(medication.quantity) ? 'PARTIAL' : 'AVAILABLE';
  return { ...unknown, tracked: true, state, available: available.toFixed(2) };
}

export async function issueDispensingStock(tx: Tx, operationId: string, actorId: string, dispensing: { id: string; catalogueCode: string | null; quantity: Prisma.Decimal | null; quantityUnit: string | null }, selection: DispensingStockSelection) {
  const code = dispensing.catalogueCode;
  if (!code) {
    if (selection.productId || selection.allocations) throw new StockError(400, 'Choose an exact catalogue medicine before selecting stock.');
    return false;
  }
  await s.lockCatalogue(tx, code);
  // Check tracking before validating legacy quantities: untracked medicines
  // retain their existing workflow until verified opening stock is recorded.
  if (!await tx.pharmacyProduct.count({ where: { catalogueRef: code } })) {
    if (selection.productId || selection.allocations) throw new StockError(409, 'This medicine has no tracked stock product. Refresh the stock selection.');
    return false;
  }
  const baseUnit = s.unit(dispensing.quantityUnit), quantity = s.quantity(dispensing.quantity?.toString(), 'supply quantity');
  if (baseUnit === 'bottle' && !quantity.isInteger()) throw new StockError(400, 'Supply whole bottles, or choose a medicine tracked in mL for volume dispensing.');
  const { batches } = await candidates(tx, code, baseUnit, true);
  const suggested = allocate(batches, quantity);
  const available = batches.reduce((sum,b) => sum.plus(b.available), new Prisma.Decimal(0));
  if (available.lt(quantity)) throw new StockError(409, `Insufficient usable stock: ${available.toFixed(2)} ${baseUnit} available. Refresh stock or receive more before dispensing.`);
  const chosen = selection.allocations ?? allocate(selection.productId ? batches.filter(b => b.productId === selection.productId) : batches, quantity);
  if (!chosen.reduce((sum,line) => sum.plus(line.quantity), new Prisma.Decimal(0)).eq(quantity)) throw new StockError(409, 'Batch allocations must equal the full supply quantity.');
  for (const line of chosen) {
    const batch = batches.find(b => b.batchId === line.batchId);
    if (!batch || (selection.productId && batch.productId !== selection.productId) || batch.available.lt(line.quantity)) throw new StockError(409, 'A selected batch is unavailable, expired, quarantined or does not match this medicine and stock unit. Refresh stock.');
  }
  const override = !sameAllocations(suggested, chosen);
  if (override && !selection.overrideReason) throw new StockError(400, 'Enter a reason for choosing different stock from the earliest-expiry suggestion.');
  const allocations = [];
  for (const line of chosen) {
    const movement = await tx.stockMovement.create({ data: { operationId, batchId: line.batchId, type: 'ISSUED', quantity: new Prisma.Decimal(line.quantity).negated(), baseUnit, reference: 'DISPENSE:' + dispensing.id, actorId, reason: override ? selection.overrideReason : null } });
    allocations.push(await tx.stockDispensingAllocation.create({ data: { dispensingId: dispensing.id, batchId: line.batchId, movementId: movement.id, quantity: line.quantity, baseUnit } }));
  }
  await audit(tx, { userId: actorId, action: 'STOCK_DISPENSED', entity: 'Dispensing', entityId: dispensing.id, after: s.snapshot({ allocations, selection: override ? 'OVERRIDE' : 'EARLIEST_EXPIRY' }), reason: override ? selection.overrideReason : undefined });
  return true;
}

export const dispensingStockInclude = { batch: { select: { lotNumber: true, expiryDate: true, product: { select: { id: true, brand: true, manufacturer: true } } } }, movement: { select: { reason: true } } } satisfies Prisma.StockDispensingAllocationInclude;
