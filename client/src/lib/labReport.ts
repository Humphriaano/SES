// The laboratory screens' logic: what to ask for, what a clicked number stands for, and how long is written. Apart from the screen so it can be tested.
export type View = 'tests' | 'turnaround' | 'abnormal';
export type GroupBy = 'test' | 'specimen';
export type Measure = 'ordered' | 'pending' | 'inProgress' | 'completed' | 'other' | 'resulted' | 'normal' | 'abnormal' | 'positive' | 'critical' | 'none';
export interface LabFilters { groupBy: GroupBy; names: boolean }
export const DEFAULT_FILTERS: LabFilters = { groupBy: 'test', names: false };
export interface Period { from: string; to: string }
export interface Cell { key: string | null; measure: Measure }   // key null is the totals row: every test in the filters

export interface TestRow { key: string; label: string; ordered: number; pending: number; inProgress: number; completed: number; other: number }
export interface TurnaroundRow { key: string; label: string; resulted: number; medianMin: number | null; longestMin: number | null; withSample: number; medianSampleMin: number | null }
export interface AbnormalRow { key: string; label: string; resulted: number; normal: number; abnormal: number; positive: number; critical: number; none: number }

const dates = (p: Period): Record<string, string> => (p.from ? { from: p.from, to: p.to } : {});

export function countParams(period: Period, f: LabFilters): Record<string, string> {
  return { ...dates(period), ...(f.groupBy === 'specimen' ? { groupBy: 'specimen' } : {}) };
}

// The records behind a clicked number. The row names a test or a specimen, depending on how the table is grouped.
export function listParams(view: View, period: Period, f: LabFilters, cell: Cell): Record<string, string> {
  const out: Record<string, string> = { ...dates(period) };
  if (cell.key !== null) out[f.groupBy] = cell.key;
  if (view === 'tests' && cell.measure !== 'ordered') out['status'] = cell.measure;
  if (view === 'abnormal') out['flag'] = cell.measure === 'resulted' ? 'all' : cell.measure;
  if (f.names) out['names'] = '1';
  return out;
}

const MEASURE_TEXT: Record<Measure, string> = {
  ordered: 'Ordered', pending: 'Pending', inProgress: 'In progress', completed: 'Completed', other: 'Other status', resulted: 'Resulted',
  normal: 'Normal', abnormal: 'Abnormal', positive: 'Positive', critical: 'Critical', none: 'No flag recorded',
};
// "FBC · Pending"; the totals row is "All tests" (or "All specimens").
export function listLabel(f: LabFilters, cell: Cell, view: View): string {
  const what = cell.key ?? (f.groupBy === 'specimen' ? 'All specimens' : 'All tests');
  if (view === 'turnaround') return `${what} · Slowest first`;
  return `${what} · ${MEASURE_TEXT[cell.measure]}`;
}

// How long, for a turnaround: "45 min", "2 h 15 min", "3 days". The same wording the server uses in its summary.
export function duration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—';
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  if (m < 2880) { const h = Math.floor(m / 60), rest = m % 60; return rest ? `${h} h ${rest} min` : `${h} h`; }
  const d = Math.floor(m / 1440), h = Math.round((m % 1440) / 60);
  return h ? `${d} days ${h} h` : `${d} days`;
}
