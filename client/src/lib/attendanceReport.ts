// The attendance screen's logic: what to ask the server for, and what a clicked number stands for. Kept apart from the screen so it can be tested.
export type GroupBy = 'period' | 'day' | 'week' | 'month' | 'servicePoint';
export type Sex = 'MALE' | 'FEMALE' | 'OTHER';
export type Visit = 'new' | 're';

export interface AttendanceFilters { servicePoint: string; sex: '' | Sex; ageBand: string; groupBy: GroupBy; names: boolean }
export const DEFAULT_FILTERS: AttendanceFilters = { servicePoint: '', sex: '', ageBand: '', groupBy: 'period', names: false };

// The same bands the server counts with (placeholders until the HIA2 template is confirmed).
export const AGE_BANDS = [
  { key: 'u1', label: 'Under 1' }, { key: '1-4', label: '1 to 4' }, { key: '5-14', label: '5 to 14' },
  { key: '15-24', label: '15 to 24' }, { key: '25-49', label: '25 to 49' }, { key: '50plus', label: '50 and over' },
];
export const GROUP_LABEL: Record<GroupBy, string> = { period: 'Whole period', day: 'By day', week: 'By week', month: 'By month', servicePoint: 'By service point' };

export interface AttendanceRow {
  label: string; key: string; from?: string; to?: string;
  newMale: number; newFemale: number; newOther?: number; newTotal: number;
  reMale: number; reFemale: number; reOther?: number; reTotal: number; all: number;
}
export interface Period { from: string; to: string }
export interface Cell { row: AttendanceRow | null; visit: Visit | null; sex: Sex | null }   // row null is the totals row; visit or sex null means all

// Filters and period as the query the server reads. Empty ones are left out; no dates means all time.
export function attendanceParams(period: Period, f: AttendanceFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (period.from) { out['from'] = period.from; out['to'] = period.to; }
  if (f.servicePoint) out['servicePoint'] = f.servicePoint;
  if (f.sex) out['sex'] = f.sex;
  if (f.ageBand) out['ageBand'] = f.ageBand;
  if (f.groupBy !== 'period') out['groupBy'] = f.groupBy;
  if (f.names) out['names'] = '1';
  return out;
}

// The records behind a clicked number: the same filters, narrowed to that cell. A grouped row narrows to its own days; an age row to its band.
export function cellParams(period: Period, f: AttendanceFilters, cell: Cell): Record<string, string> {
  const out = attendanceParams(period, { ...f, groupBy: 'period' });
  if (cell.row && f.groupBy === 'period') out['ageBand'] = cell.row.key;
  if (cell.row && f.groupBy === 'servicePoint') out['servicePoint'] = cell.row.key;   // a service point's row opens that service point's attendances
  if (cell.row && f.groupBy !== 'period' && cell.row.from && cell.row.to) { out['from'] = cell.row.from; out['to'] = cell.row.to; }
  if (cell.visit) out['visit'] = cell.visit;
  if (cell.sex) out['sex'] = cell.sex;
  return out;
}

const SEX_TEXT: Record<Sex, string> = { MALE: 'Male', FEMALE: 'Female', OTHER: 'Other' };
// "Re-attendance · Female · 25 to 49" for the line list's heading.
export function cellLabel(cell: Cell, groupBy: GroupBy): string {
  return [
    cell.visit === 'new' ? 'New attendance' : cell.visit === 're' ? 'Re-attendance' : 'All attendances',
    cell.sex ? SEX_TEXT[cell.sex] : null,
    cell.row ? cell.row.label : groupBy === 'period' ? 'All ages' : groupBy === 'servicePoint' ? 'All service points' : 'All periods',
  ].filter(Boolean).join(' · ');
}

// The number in a cell, so a screen reader and the click agree.
export function cellValue(row: AttendanceRow, visit: Visit | null, sex: Sex | null): number {
  if (!visit && !sex) return row.all;
  if (!visit) return (row.newMale + row.reMale) * Number(sex === 'MALE') + (row.newFemale + row.reFemale) * Number(sex === 'FEMALE') + ((row.newOther ?? 0) + (row.reOther ?? 0)) * Number(sex === 'OTHER');
  if (!sex) return visit === 'new' ? row.newTotal : row.reTotal;
  const key = `${visit}${sex === 'MALE' ? 'Male' : sex === 'FEMALE' ? 'Female' : 'Other'}` as keyof AttendanceRow;
  return Number(row[key] ?? 0);
}

// "Showing 11–20 of 121".
export function pageText(page: number, size: number, total: number): string {
  if (total === 0) return 'Nothing to show';
  const from = page * size + 1, to = Math.min(total, (page + 1) * size);
  return `Showing ${from}–${to} of ${total.toLocaleString()}`;
}
export const lastPage = (size: number, total: number) => Math.max(0, Math.ceil(total / size) - 1);
