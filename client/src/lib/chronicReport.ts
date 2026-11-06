// The chronic disease screens' logic: what to ask for, what a clicked number stands for, and how the bars are drawn. Apart from the screen so it can be tested.
export type Measure = 'active' | 'female' | 'male' | 'other' | 'new' | 'resolved' | 'seen' | 'overdue' | 'controlled' | 'notControlled' | 'noReading';
export type Status = 'active' | 'resolved' | 'any';

export interface ChronicCounts {
  key: string; label: string; active: number; female: number; male: number; other?: number; new: number; resolved: number; seen: number; overdue: number;
  controlled: number; notControlled: number; noReading: number; booked: number; never: number; b120: number; b180: number; b365: number; over: number;
}
export interface ChronicFilters { condition: string; status: Status; seen: '' | 'seen' | 'overdue'; control: '' | 'controlled' | 'notControlled' | 'noReading'; names: boolean }
export const DEFAULT_FILTERS: ChronicFilters = { condition: '', status: 'active', seen: '', control: '', names: false };
export interface Period { from: string; to: string }
export interface Cell { condition: string | null; measure: Measure | null }   // condition null is the totals row; measure null is "everyone behind the filters"

const dates = (p: Period): Record<string, string> => (p.from ? { from: p.from, to: p.to } : {});

// The counts: only the period and the condition narrow them. Status, last seen and control narrow the records.
export function countParams(period: Period, f: ChronicFilters): Record<string, string> {
  return { ...dates(period), ...(f.condition ? { condition: f.condition } : {}) };
}

// The records behind a clicked number: the screen's filters, narrowed to that number. A measure names its own status, so the status filter steps aside.
export function listParams(period: Period, f: ChronicFilters, cell: Cell): Record<string, string> {
  const out: Record<string, string> = { ...dates(period) };
  const condition = cell.condition ?? f.condition;
  if (condition) out['condition'] = condition;
  if (cell.measure) out['measure'] = cell.measure; else if (f.status !== 'active') out['status'] = f.status;
  if (f.seen) out['seen'] = f.seen;
  if (f.control) out['control'] = f.control;
  if (f.names) out['names'] = '1';
  return out;
}

export const MEASURE_TEXT: Record<Measure, string> = {
  active: 'Active', female: 'Active · Female', male: 'Active · Male', other: 'Active · Other', new: 'New in the period', resolved: 'Resolved in the period',
  seen: 'Seen in the last 90 days', overdue: 'Overdue', controlled: 'Blood pressure under 140/90', notControlled: 'Blood pressure 140/90 or higher', noReading: 'No blood pressure in 90 days',
};
// "Hypertension · Overdue"; the totals row is "All conditions".
export function listLabel(cell: Cell, labels: Record<string, string>): string {
  return [cell.condition ? labels[cell.condition] ?? cell.condition : 'All conditions', cell.measure ? MEASURE_TEXT[cell.measure] : 'Everyone behind the filters'].join(' · ');
}

// The number a cell shows, by name.
export const cellValue = (row: ChronicCounts, measure: Measure): number => Number(row[measure] ?? 0);

export const OVERDUE_GROUPS: { key: 'b120' | 'b180' | 'b365' | 'over' | 'never'; label: string }[] = [
  { key: 'b120', label: '91 to 120 days' }, { key: 'b180', label: '121 to 180 days' }, { key: 'b365', label: '181 to 365 days' }, { key: 'over', label: 'Over a year' }, { key: 'never', label: 'No visit on record' },
];

// Widths in percent for a bar split into parts. They add up to 100 (or all zero), and a part that exists is never drawn thinner than 2%.
export function splitBar(parts: number[]): number[] {
  const total = parts.reduce((s, p) => s + Math.max(0, p), 0);
  if (total <= 0) return parts.map(() => 0);
  const raw = parts.map(p => (p > 0 ? Math.max(2, (p / total) * 100) : 0)), sum = raw.reduce((s, p) => s + p, 0);
  return raw.map(p => (p / sum) * 100);
}

// Conditions with nobody to show, kept out of the way of the ones with patients.
export function splitByUse(rows: ChronicCounts[]): { used: ChronicCounts[]; quiet: ChronicCounts[] } {
  const used = rows.filter(r => r.active > 0 || r.new > 0 || r.resolved > 0);
  return { used, quiet: rows.filter(r => !used.includes(r)) };
}
