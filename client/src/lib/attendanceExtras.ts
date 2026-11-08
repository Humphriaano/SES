// The Workload and OPD diagnoses screens' logic: what to ask for and what a clicked number stands for. Apart from the screens so it can be tested.
export interface Period { from: string; to: string }
const dates = (p: Period): Record<string, string> => (p.from ? { from: p.from, to: p.to } : {});

// ── Workload ────────────────────────────────────────────────────────────────
export type WorkloadGroup = 'servicePoint' | 'staff';
export type WorkloadMeasure = 'attendances' | 'seen' | 'notSeen';
export interface WorkloadFilters { groupBy: WorkloadGroup; names: boolean }
export const WORKLOAD_DEFAULTS: WorkloadFilters = { groupBy: 'servicePoint', names: false };
export interface WorkloadRow { key: string; label: string; attendances: number; seen: number; notSeen: number; medianMin: number | null; longestMin: number | null }
export interface WorkloadCell { key: string | null; measure: WorkloadMeasure }   // key null is the totals row

export const workloadParams = (period: Period, f: WorkloadFilters): Record<string, string> => ({ ...dates(period), ...(f.groupBy === 'staff' ? { groupBy: 'staff' } : {}) });

// A row is a service point or a staff member ("none" is the row of patients nobody started seeing); seen and not seen narrow it further.
export function workloadLineParams(period: Period, f: WorkloadFilters, cell: WorkloadCell): Record<string, string> {
  const out: Record<string, string> = { ...dates(period) };
  if (cell.key !== null) out[f.groupBy === 'staff' ? 'staff' : 'servicePoint'] = cell.key;
  if (cell.measure === 'seen') out['seen'] = 'yes';
  if (cell.measure === 'notSeen') out['seen'] = 'no';
  if (f.names) out['names'] = '1';
  return out;
}
const WORKLOAD_TEXT: Record<WorkloadMeasure, string> = { attendances: 'All attendances', seen: 'Seen', notSeen: 'Not seen yet' };
export function workloadLabel(f: WorkloadFilters, cell: WorkloadCell, labels: Record<string, string>): string {
  const who = cell.key !== null ? labels[cell.key] ?? cell.key : f.groupBy === 'staff' ? 'All staff' : 'All service points';
  return `${who} · ${WORKLOAD_TEXT[cell.measure]}`;
}

// ── OPD diagnoses ───────────────────────────────────────────────────────────
export type DiagnosisMeasure = 'consultations' | 'main' | 'female' | 'male' | 'other';
export interface DiagnosisFilters { sex: '' | 'MALE' | 'FEMALE' | 'OTHER'; ageBand: string; mainOnly: boolean; names: boolean }
export const DIAGNOSIS_DEFAULTS: DiagnosisFilters = { sex: '', ageBand: '', mainOnly: false, names: false };
export interface DiagnosisRow { key: string; code: string; label: string; consultations: number; patients: number; main: number; female: number; male: number; other: number }
export interface DiagnosisCell { code: string; measure: DiagnosisMeasure }

export function diagnosisParams(period: Period, f: DiagnosisFilters): Record<string, string> {
  const out: Record<string, string> = { ...dates(period) };
  if (f.sex) out['sex'] = f.sex;
  if (f.ageBand) out['ageBand'] = f.ageBand;
  if (f.mainOnly) out['main'] = 'yes';
  return out;
}
// A clicked number keeps the screen's filters and adds its own: its code, and the main diagnosis or the sex its column stands for.
export function diagnosisLineParams(period: Period, f: DiagnosisFilters, cell: DiagnosisCell): Record<string, string> {
  const out: Record<string, string> = { ...diagnosisParams(period, f), code: cell.code };
  if (cell.measure === 'main') out['main'] = 'yes';
  if (cell.measure === 'female') out['sex'] = 'FEMALE';
  if (cell.measure === 'male') out['sex'] = 'MALE';
  if (cell.measure === 'other') out['sex'] = 'OTHER';
  if (f.names) out['names'] = '1';
  return out;
}
const DIAGNOSIS_TEXT: Record<DiagnosisMeasure, string> = { consultations: 'All consultations', main: 'Main diagnosis', female: 'Female', male: 'Male', other: 'Other' };
export const diagnosisLabel = (cell: DiagnosisCell, labels: Record<string, string>): string => `${cell.code} ${labels[cell.code] ?? ''}`.trim() + ` · ${DIAGNOSIS_TEXT[cell.measure]}`;

// How many diagnosis rows to show before "Show all": the commonest come first, and a long tail of single cases is one click away.
export const FIRST_ROWS = 25;
export const visibleRows = <T>(rows: T[], all: boolean): T[] => (all ? rows : rows.slice(0, FIRST_ROWS));
