import { parsePeriod, type Period } from './reportPeriod';
import { loadRows, lineReport, type Row } from './attendanceReports';
import type { Report } from '../controllers/billingReports.controller';

// Busy times: attendances by weekday and hour of check-in. Built from the same rows as the Attendance report, so the total always equals its total for
// the same period, and every cell opens the attendances behind it.

export const BUSY_DEFINITIONS = [
  'An attendance is one check-in at a service point. A check-in taken off the queue without the patient being seen is not counted. The totals equal those of the Attendance report for the same period.',
  'The weekday and the hour are those of the check-in, in the facility\'s local time. Hour 10 means from 10:00 to 10:59.',
  'Weekday counts add every such weekday in the period: three Mondays make one Monday row.',
  'A line list shows the newest 5,000 attendances; the counts always cover all of them. It shows a patient ID and a masked NRC unless a clinical role asks for names.',
];

export const WEEKDAYS = [
  { key: 1, label: 'Mon' }, { key: 2, label: 'Tue' }, { key: 3, label: 'Wed' }, { key: 4, label: 'Thu' }, { key: 5, label: 'Fri' }, { key: 6, label: 'Sat' }, { key: 7, label: 'Sun' },
] as const;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourKey = (h: number) => 'h' + String(h).padStart(2, '0');
const weekdayOf = (d: Date) => ((d.getDay() + 6) % 7) + 1;   // Monday is 1, Sunday is 7

interface Filters { period: Period; servicePoint?: string; weekday?: number; hour?: number }
function parse(q: Record<string, unknown>): Filters | { error: string } {
  const period = parsePeriod(q);
  if ('error' in period) return period;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const servicePoint = text(q['servicePoint']), weekday = text(q['weekday']), hour = text(q['hour']);
  if (servicePoint && !/^[0-9a-f-]{36}$/i.test(servicePoint)) return { error: 'Choose a service point from the list.' };
  if (weekday && !/^[1-7]$/.test(weekday)) return { error: 'Choose a weekday from 1 (Monday) to 7 (Sunday).' };
  if (hour && !(/^\d{1,2}$/.test(hour) && Number(hour) <= 23)) return { error: 'Choose an hour from 0 to 23.' };
  return { period, servicePoint, weekday: weekday ? Number(weekday) : undefined, hour: hour !== undefined ? Number(hour) : undefined };
}

const inPlace = (rows: Row[], servicePoint?: string) => rows.filter(r => !servicePoint || r.roomId === servicePoint);
const hhmm = (h: number) => String(h).padStart(2, '0') + ':00';

export async function busyTimes(q: Record<string, unknown>): Promise<Report | { error: string }> {
  const f = parse(q);
  if ('error' in f) return f;
  const rows = inPlace(await loadRows(f.period), f.servicePoint);
  const grid = new Map<string, number>(), perHour = new Map<number, number>();
  for (const r of rows) {
    const w = weekdayOf(r.at), h = r.at.getHours();
    grid.set(`${w}-${h}`, (grid.get(`${w}-${h}`) ?? 0) + 1); perHour.set(h, (perHour.get(h) ?? 0) + 1);
  }
  const body = WEEKDAYS.map(d => ({
    label: d.label, key: String(d.key), ...Object.fromEntries(HOURS.map(h => [hourKey(h), grid.get(`${d.key}-${h}`) ?? 0])),
    total: HOURS.reduce((s, h) => s + (grid.get(`${d.key}-${h}`) ?? 0), 0),
  }));
  let best: { day: string; hour: number; n: number } | null = null;
  for (const d of WEEKDAYS) for (const h of HOURS) { const n = grid.get(`${d.key}-${h}`) ?? 0; if (n > (best?.n ?? 0)) best = { day: d.label, hour: h, n }; }
  return {
    name: 'busy-times', title: 'Busy times', period: f.servicePoint ? `${f.period.label} · one service point` : f.period.label,
    columns: [
      { key: 'label', header: 'Weekday', type: 'text', width: 12 },
      ...HOURS.map(h => ({ key: hourKey(h), header: hhmm(h), type: 'int' as const, width: 7 })), { key: 'total', header: 'All day', type: 'int', width: 10 },
    ],
    rows: body,
    totals: { label: 'All days', ...Object.fromEntries(HOURS.map(h => [hourKey(h), perHour.get(h) ?? 0])), total: rows.length },
    summary: [{ label: 'Attendances', value: rows.length }, ...(best ? [{ label: 'Busiest hour', value: `${best.day} ${hhmm(best.hour)} (${best.n})` }] : [])],
  };
}

// The attendances behind one cell, one weekday, one hour of every day, or all of them.
export async function busyTimesLines(q: Record<string, unknown>, options: { names: boolean }): Promise<Report | { error: string }> {
  const f = parse(q);
  if ('error' in f) return f;
  const rows = inPlace(await loadRows(f.period), f.servicePoint).filter(r => (f.weekday === undefined || weekdayOf(r.at) === f.weekday) && (f.hour === undefined || r.at.getHours() === f.hour));
  const what = [f.weekday !== undefined && WEEKDAYS[f.weekday - 1]!.label, f.hour !== undefined && hhmm(f.hour)].filter(Boolean).join(' ');
  return lineReport(rows, what ? `${f.period.label} · ${what}` : f.period.label, options);
}
