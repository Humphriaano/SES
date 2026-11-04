import { Prisma } from '@prisma/client';
import { calculateCourse, durationInDays, courseInstant, medicationDateInput, todayInput } from './prescriptionCourse';
import { calculateSupply, PriceBasis } from './prescriptionSupply';

export interface MedicationDraft {
  name: string; dosage?: string; frequency?: string; route?: string; duration?: string; catalogueCode?: string;
  startDate: Date; endDate?: Date; notes?: string; durationDays?: number; durationCount?: number; durationUnit?: string; unitsPerDose?: number;
  quantity?: number; quantityUnit?: string; quantityManual?: boolean; unitPrice?: number;
  doseUnit?: string; priceBasis?: PriceBasis; bottleSizeMl?: number; courseQuantity?: number; billingQuantity?: number;
}

export function parseMedicationDraft(input: unknown): { data: MedicationDraft } | { error: string } {
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const text = (key: string, limit = 500) => typeof body[key] === 'string' ? (body[key] as string).trim().slice(0, limit) || undefined : undefined;
  const name = text('name');
  if (!name) return { error: 'Choose or enter a medicine.' };
  const start = text('startDate') ? medicationDateInput(text('startDate')!) : todayInput();
  if (!start) return { error: 'Enter a valid start date.' };
  let end = text('endDate') ? medicationDateInput(text('endDate')!) : null;
  if (text('endDate') && !end) return { error: 'Enter a valid end date.' };
  const data: MedicationDraft = { name, dosage: text('dosage'), frequency: text('frequency', 40), route: text('route', 40), duration: text('duration', 40), catalogueCode: text('catalogueCode', 80), startDate: courseInstant(start), notes: text('notes', 10000) };
  if (body.priceBasis !== undefined && !data.dosage) return { error: 'Dosage is required.' };
  const structured = body.durationCount !== undefined || body.durationDays !== undefined || body.unitsPerDose !== undefined || body.quantity !== undefined;
  if (structured) {
    const durationUnit = text('durationUnit', 10) || 'days';
    const count = body.durationCount === undefined ? undefined : Number(body.durationCount);
    const days = count !== undefined ? durationInDays(start, count, durationUnit) ?? NaN : body.durationDays === undefined ? undefined : Number(body.durationDays);
    const units = body.unitsPerDose === undefined ? undefined : Math.round(Number(body.unitsPerDose) * 100) / 100;
    if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 3660)) return { error: 'Days must be a whole number between 1 and 3,660.' };
    if (units !== undefined && (!Number.isFinite(units) || units <= 0 || units > 10000)) return { error: 'Enter valid units per dose.' };
    if (body.priceBasis !== undefined && units === undefined) return { error: 'Enter the amount per dose.' };
    if (body.quantityManual !== undefined && typeof body.quantityManual !== 'boolean') return { error: 'Invalid quantity option.' };
    const course = days === undefined ? null : calculateCourse(start, days, data.frequency ?? '', units ?? '');
    if (course) end = course.endDate;
    const calculated = body.quantityManual !== true ? course?.quantity : null;
    const quantity = Math.round((calculated ?? Number(body.quantity)) * 100) / 100;
    if (body.priceBasis === undefined && (!Number.isFinite(quantity) || quantity <= 0 || quantity > 10000)) return { error: 'Quantity must be more than 0 and no more than 10,000 units.' };
    Object.assign(data, { durationDays: days, unitsPerDose: units, quantity, quantityUnit: text('quantityUnit', 40) || 'unit', quantityManual: calculated == null });
    if (days) data.duration = `${count ?? days} ${count !== undefined ? durationUnit : 'days'}`;
    if (count !== undefined) Object.assign(data, { durationCount: count, durationUnit });
    if (body.priceBasis !== undefined) {
      const basis = body.priceBasis as PriceBasis;
      if (!['ITEM', 'BOTTLE', 'COURSE'].includes(basis)) return { error: 'Choose a valid price basis.' };
      const doseUnit = text('doseUnit', 40) || 'unit';
      const bottle = body.bottleSizeMl == null || body.bottleSizeMl === '' ? null : Number(body.bottleSizeMl);
      if (bottle !== null && (!Number.isFinite(bottle) || bottle < 0.01 || bottle > 1000000)) return { error: 'Enter a valid bottle size in mL.' };
      // Recompute from the clinical dose, not the submitted bottle/billing count.
      const supply = calculateSupply(course?.quantity ?? null, doseUnit, basis, bottle, Number(body.quantity));
      if (!supply) return { error: basis === 'BOTTLE' ? 'Enter mL per dose and the bottle size to calculate bottles to supply.' : 'Enter a valid quantity to supply.' };
      Object.assign(data, { doseUnit, priceBasis: basis, bottleSizeMl: bottle ?? undefined, quantity: supply.quantity, quantityUnit: supply.quantityUnit, billingQuantity: supply.billingQuantity, courseQuantity: supply.courseQuantity ?? undefined, quantityManual: !supply.calculated });
    }
  }
  if (body.unitPrice !== undefined && body.unitPrice !== null && body.unitPrice !== '') {
    const price = Number(body.unitPrice);
    if (!Number.isFinite(price) || price < 0 || price > 10000000) return { error: 'Enter a valid unit price in ZMW.' };
    if (!data.catalogueCode) data.unitPrice = new Prisma.Decimal(String(body.unitPrice)).toDecimalPlaces(2).toNumber();
  }
  if (end && end < start) return { error: 'The end date cannot be before the start date.' };
  if (end) data.endDate = courseInstant(end, true);
  return { data };
}
