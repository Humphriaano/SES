// The pharmacy screens' logic: what to ask for, what a clicked number stands for, and how quantities are written. Apart from the screen so it can be tested.
export type View = 'dispensed' | 'prescriptions';
export type GroupBy = 'item' | 'brand';
export type Measure = 'all' | 'prescription' | 'substitution' | 'direct' | 'dispensed' | 'notAvailable' | 'waiting';
export type DispensedType = '' | 'prescription' | 'substitution' | 'direct';
export interface PharmacyFilters { groupBy: GroupBy; item: string; type: DispensedType; names: boolean }
export const DEFAULT_FILTERS: PharmacyFilters = { groupBy: 'item', item: '', type: '', names: false };
export interface Period { from: string; to: string }
export interface Cell { key: string | null; measure: Measure }   // key null is the totals row: everything inside the filters

export interface DispensedRow { key: string; label: string; unit: string; dispensings: number; patients: number; items: number; quantity: number; prescription: number; substitution: number; direct: number }
export interface PrescriptionRow { key: string; label: string; written: number; dispensed: number; notAvailable: number; waiting: number }

const dates = (p: Period): Record<string, string> => (p.from ? { from: p.from, to: p.to } : {});

// The item choices: every item in the period, never narrowed by the filters, so a chosen item can always be changed.
export const optionParams = (period: Period): Record<string, string> => dates(period);

// The counts for the table. Only the dispensed report groups by brand or filters by type.
export function countParams(view: View, period: Period, f: PharmacyFilters): Record<string, string> {
  const out = dates(period);
  if (f.item) out['item'] = f.item;
  if (view === 'dispensed') { if (f.groupBy === 'brand') out['groupBy'] = 'brand'; if (f.type) out['type'] = f.type; }
  return out;
}

// True when the table is the same request as the item choices, so one request serves both.
export const sameAsOptions = (view: View, f: PharmacyFilters): boolean => !f.item && (view === 'prescriptions' || (f.groupBy === 'item' && !f.type));

// The records behind a clicked number: the screen's filters, narrowed to that number.
export function listParams(view: View, period: Period, f: PharmacyFilters, cell: Cell): Record<string, string> {
  const out: Record<string, string> = { ...dates(period) };
  if (f.item) out['item'] = f.item;
  if (view === 'dispensed') {
    if (cell.key !== null) out[f.groupBy === 'brand' ? 'brand' : 'item'] = cell.key;
    const type = cell.measure === 'prescription' || cell.measure === 'substitution' || cell.measure === 'direct' ? cell.measure : f.type;
    if (type) out['type'] = type;
  } else {
    if (cell.key !== null) out['item'] = cell.key;
    if (cell.measure === 'dispensed' || cell.measure === 'notAvailable' || cell.measure === 'waiting') out['status'] = cell.measure;
  }
  if (f.names) out['names'] = '1';
  return out;
}

const MEASURE_TEXT: Record<Measure, string> = {
  all: 'All', prescription: 'On prescription', substitution: 'Substituted', direct: 'Without prescription', dispensed: 'Dispensed', notAvailable: 'Not available', waiting: 'Waiting',
};
// "Amoxicillin · Substituted"; the totals row is "All items" (or "All brands").
export function listLabel(view: View, f: PharmacyFilters, cell: Cell, labels: Record<string, string>): string {
  const what = cell.key !== null ? labels[cell.key] ?? cell.key : view === 'dispensed' && f.groupBy === 'brand' ? 'All brands' : 'All items';
  if (view === 'prescriptions') return cell.measure === 'all' ? `${what} · All prescriptions` : `${what} · ${MEASURE_TEXT[cell.measure]}`;
  return `${what} · ${cell.measure === 'all' ? 'All dispensings' : MEASURE_TEXT[cell.measure]}`;
}

// "49 capsule": a quantity with its unit, as the pharmacy supplied it.
export function quantityText(quantity: number | null | undefined, unit: string | null | undefined): string {
  if (quantity === null || quantity === undefined || !Number.isFinite(quantity)) return '—';
  return `${Math.round(quantity * 100) / 100}${unit ? ' ' + unit : ''}`;
}
