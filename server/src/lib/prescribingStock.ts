import { Prisma, PrismaClient } from '@prisma/client';
import { StockActor, StockError, stockPrimitives as s } from './stock';
import { todayInput } from './prescriptionCourse';

export const PRESCRIBING_STOCK_ROLES = ['admin', 'clinician', 'doctor', 'pharmacist', 'nurse'];
export const preferredStockInclude = { select: { id: true, brand: true, manufacturer: true, baseUnit: true, active: true } } satisfies Prisma.PharmacyProductFindManyArgs;

// This deliberately limited read does not expose batches, costs, sources,
// recipients or audit records and never reserves or issues stock.
export async function prescribingAvailability(db: PrismaClient, actor: StockActor, refs: unknown) {
  if (!actor.userId) throw new StockError(401, 'Sign in before checking availability.');
  if (!(actor.role ?? '').split(',').some(role => PRESCRIBING_STOCK_ROLES.includes(role.trim()))) throw new StockError(403, 'Clinical prescribing access is required.');
  if (typeof refs !== 'string') throw new StockError(400, 'Choose exact catalogue references.');
  const codes = [...new Set(refs.split(',').map(code => s.ref(code)))];
  if (!codes.length || codes.length > 20) throw new StockError(400, 'Check no more than 20 catalogue variants at a time.');
  const today = todayInput();
  const rows = await db.$queryRaw<{ catalogueRef: string; id: string; brand: string; manufacturer: string | null; baseUnit: string; available: Prisma.Decimal }[]>(Prisma.sql`
    SELECT p."catalogueRef", p."id", p."brand", p."manufacturer", p."baseUnit",
      COALESCE(SUM(CASE WHEN p."active" AND c."active" AND b."status"='USABLE' AND b."expiryDate">=${today}::date THEN m."quantity" ELSE 0 END),0) AS "available"
    FROM "PharmacyProduct" p JOIN "PriceListItem" c ON c."itemType"=p."catalogueType" AND c."catalogueRef"=p."catalogueRef"
    LEFT JOIN "StockBatch" b ON b."productId"=p."id" LEFT JOIN "StockMovement" m ON m."batchId"=b."id"
    WHERE p."catalogueRef" IN (${Prisma.join(codes)}) GROUP BY p."id", c."id" ORDER BY lower(p."brand"),p."id"`);
  return { asOf: new Date().toISOString(), items: codes.map(catalogueRef => {
    const products = rows.filter(row => row.catalogueRef === catalogueRef);
    return { catalogueRef, tracked: products.length > 0, products: products.filter(row => row.available.gt(0)).map(({ catalogueRef: _code, ...row }) => ({ ...row, available: row.available.toFixed(2) })) };
  }) };
}

// Preference records identity, not a reservation or a guarantee of availability.
// A valid preference may survive stock depletion or product deactivation before
// pharmacy attends the order. It can never point at another SKU or stock unit.
export async function validateStockPreference(tx: Prisma.TransactionClient, value: unknown, medication: { catalogueCode: string | null; quantityUnit: string | null }) {
  if (value == null || value === '') return null;
  const id = s.text(value, 'preferred stock product', 80);
  const product = await tx.pharmacyProduct.findUnique({ where: { id }, select: { id: true, catalogueRef: true, baseUnit: true } });
  if (!product || !medication.catalogueCode || product.catalogueRef !== medication.catalogueCode || product.baseUnit !== medication.quantityUnit) throw new StockError(400, 'The preferred brand must match this exact medicine and supply unit.');
  return product.id;
}
