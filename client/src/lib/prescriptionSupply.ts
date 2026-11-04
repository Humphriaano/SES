export type PriceBasis = 'ITEM' | 'BOTTLE' | 'COURSE';

export function isLiquidMedicine(form: string): boolean {
  // Classify the supplied product, rather than the liquid it can be mixed into.
  if (/sachet|powder|granule/i.test(form)) return false;
  return /syrup|suspension|solution|mixture|elixir|liquid|^ml$/i.test(form);
}

export const dispensingUnits = ['tablet', 'capsule', 'sachet', 'vial', 'ampoule', 'tube', 'inhaler', 'patch', 'suppository', 'pessary', 'unit'] as const;

export function basisFromUnit(unit: string | undefined): PriceBasis | null {
  return /course/i.test(unit ?? '') ? 'COURSE' : /bottle/i.test(unit ?? '') ? 'BOTTLE' : unit && !/^(per unit|each)$/i.test(unit) ? 'ITEM' : null;
}

export function pricingUnit(basis: PriceBasis, doseUnit: string): string {
  return basis === 'COURSE' ? 'per course' : basis === 'BOTTLE' ? 'per bottle' : `per ${doseUnit || 'unit'}`;
}

// Clinical amount and invoice quantity have different units. A course price is
// charged once; a bottle price is multiplied by bottles, never by liquid doses.
export function calculateSupply(amount: number | null, doseUnit: string, basis: PriceBasis, bottleSizeMl?: number | null, manualQuantity?: number | null) {
  if (!['ITEM', 'BOTTLE', 'COURSE'].includes(basis)) return null;
  const liquid = doseUnit === 'mL';
  if (basis === 'BOTTLE' && !liquid) return null;
  if (bottleSizeMl != null && (!Number.isFinite(bottleSizeMl) || bottleSizeMl <= 0)) return null;
  const hasBottle = liquid && bottleSizeMl != null && Number.isFinite(bottleSizeMl) && bottleSizeMl > 0;
  const quantityUnit = basis === 'BOTTLE' || (liquid && basis === 'COURSE' && hasBottle) ? 'bottle' : doseUnit;
  let quantity: number, calculated = amount != null;
  if (amount != null) {
    if (!Number.isFinite(amount) || amount <= 0) return null;
    if (basis === 'BOTTLE' && !hasBottle) {
      if (manualQuantity == null || !Number.isInteger(manualQuantity) || manualQuantity <= 0) return null;
      quantity = manualQuantity; calculated = false;
    } else quantity = quantityUnit === 'bottle' ? Math.ceil(amount / bottleSizeMl!) : amount;
  } else {
    if (manualQuantity == null || !Number.isFinite(manualQuantity) || manualQuantity <= 0) return null;
    quantity = manualQuantity;
  }
  if (quantityUnit === 'bottle' && !Number.isInteger(quantity)) return null;
  if (quantity <= 0 || quantity > 10000) return null;
  return { quantity: Math.round(quantity * 100) / 100, quantityUnit, billingQuantity: basis === 'COURSE' ? 1 : Math.round(quantity * 100) / 100, courseQuantity: amount, calculated };
}
