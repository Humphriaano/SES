// Date ranges for the Reports page. Days are local calendar days, written YYYY-MM-DD, both ends included. No dates means all time.
export type PeriodKey = 'today' | '7d' | '30d' | 'month' | '90d' | 'year' | 'all' | 'custom';
export interface PeriodChoice { key: PeriodKey; from: string; to: string }

export const PERIOD_PRESETS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'month', label: 'This month' },
  { key: '90d', label: '90 days' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom' },
];
export const DEFAULT_PERIOD: PeriodKey = '30d';

export function dayText(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const daysBack = (today: Date, n: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);

// The range a preset stands for on a given day. "7 days" is today and the six before it.
export function periodFor(key: PeriodKey, today: Date = new Date(), custom?: { from: string; to: string }): PeriodChoice {
  const end = dayText(today);
  switch (key) {
    case 'today': return { key, from: end, to: end };
    case '7d': return { key, from: dayText(daysBack(today, 6)), to: end };
    case '30d': return { key, from: dayText(daysBack(today, 29)), to: end };
    case '90d': return { key, from: dayText(daysBack(today, 89)), to: end };
    case 'month': return { key, from: dayText(new Date(today.getFullYear(), today.getMonth(), 1)), to: end };
    case 'year': return { key, from: dayText(new Date(today.getFullYear(), 0, 1)), to: end };
    case 'custom': return { key, from: custom?.from ?? '', to: custom?.to ?? '' };
    default: return { key: 'all', from: '', to: '' };
  }
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
function realDay(value: string): boolean {
  const m = DAY.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])], date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
}

// Why a custom range cannot be used yet, in words for the person typing it; '' when it can.
export function periodProblem(from: string, to: string): string {
  if (!from || !to) return 'Choose both a start date and an end date.';
  if (!realDay(from) || !realDay(to)) return 'Enter real dates.';
  if (to < from) return 'The end date is before the start date.';
  return '';
}

// A key that names one set of figures, for the saved copy.
export const periodId = (p: { from: string; to: string }) => `${p.from || 'start'}|${p.to || 'now'}`;

// "12 min", "1 h 5 min": how long, for waiting times.
export function minutesText(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—';
  const m = Math.max(0, Math.round(minutes));
  if (m < 1) return 'Under 1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), rest = m % 60;
  if (h < 24) return rest ? `${h} h ${rest} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}

// Whole-number share of a total, "—" when there is no total to share of.
export function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';
}

// Bar width as a fraction of the largest value; every non-zero value stays visible.
export function barFraction(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.max(0.02, Math.min(1, value / max));
}

// "3 Mar 2026" or "1 Feb 2026 to 3 Mar 2026"; "All time" when no dates are given.
export function rangeLabel(from: string, to: string): string {
  if (!from && !to) return 'All time';
  const show = (day: string) => {
    const m = DAY.exec(day);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : day;
  };
  return !to || from === to ? show(from) : `${show(from)} to ${show(to)}`;
}
