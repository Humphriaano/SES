import { Prisma } from '@prisma/client';

const str = (value: unknown, max: number): string | null => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) || null : null;

// Shared by the existing catalogue editor and receiving's add-missing-item flow.
export function readDrug(body: any) {
  const generic = str(body.generic, 120), strength = str(body.strength, 60), form = str(body.form, 60), route = str(body.route, 60);
  if (!generic) return { error: 'Enter the generic name.' };
  if (!strength) return { error: 'Enter the strength, for example 500mg or 125mg/5ml.' };
  if (!form) return { error: 'Choose the form (tablet, syrup, injection…).' };
  if (!route) return { error: 'Choose the route.' };
  const atc = str(body.atcCode, 10)?.toUpperCase() ?? null;
  if (atc && !/^[A-Z]\d{2}[A-Z]{0,2}\d{0,2}$/.test(atc)) return { error: 'The ATC code looks wrong. It is a letter, two digits, then up to two letters and two digits, e.g. N02BE01.' };
  return { data: { generic, brand: str(body.brand, 120), strength, form, route, atcCode: atc, manufacturer: str(body.manufacturer, 120) } };
}

export function readDrugIngredients(value: unknown): { data: { name: string; amount: string; unit: string }[]; strength: string; error?: never } | { error: string; data?: never; strength?: never } {
  if (!Array.isArray(value) || !value.length || value.length > 10) return { error: 'Enter 1–10 active ingredients.' };
  const data: { name: string; amount: string; unit: string }[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !['name', 'amount', 'unit'].includes(key))) return { error: 'Enter valid ingredient details.' };
    const name = str(raw.name, 120), unit = str(raw.unit, 30), amount = String(raw.amount ?? '');
    if (!name || !unit || !/^\d{1,10}(?:\.\d{1,6})?$/.test(amount) || new Prisma.Decimal(amount).lte(0) || new Prisma.Decimal(amount).gt('1000000000')) return { error: 'Each ingredient needs a name, a positive amount and a unit.' };
    data.push({ name, amount: new Prisma.Decimal(amount).toString(), unit });
  }
  if (new Set(data.map(row => row.name.toLowerCase().replace(/\s+/g, ''))).size !== data.length) return { error: 'Combine repeated active ingredients.' };
  const strength = data.map(row => row.amount + row.unit).join(' + ');
  if (strength.length > 60) return { error: 'The combined strength is too long for the catalogue.' };
  return { data, strength };
}
