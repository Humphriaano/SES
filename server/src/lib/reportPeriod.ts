import { Prisma } from '@prisma/client';

// A reporting period: whole local days, both ends included. Shared by every report that takes from and to.
export interface Period { from: Date | null; to: Date | null; fromDay: string | null; toDay: string | null; label: string }   // `to` is the start of the day after the last day, so a range is [from, to)

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
function parseDay(value: string): Date | null {
  const m = DAY.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;   // rejects 31 February
}
export const dayText = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const shortDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// No dates means all time. Dates are whole local days, both ends included.
export function parsePeriod(q: Record<string, unknown>): Period | { error: string } {
  const from = typeof q['from'] === 'string' ? q['from'] : '', to = typeof q['to'] === 'string' ? q['to'] : '';
  if (!from && !to) return { from: null, to: null, fromDay: null, toDay: null, label: 'All time' };
  if (!from || !to) return { error: 'Give both a start date and an end date.' };
  const start = parseDay(from), last = parseDay(to);
  if (!start || !last) return { error: 'Dates must be real days written as YYYY-MM-DD.' };
  if (last < start) return { error: 'The end date is before the start date.' };
  const end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
  return { from: start, to: end, fromDay: dayText(start), toDay: dayText(last), label: from === to ? shortDate(start) : `${shortDate(start)} to ${shortDate(last)}` };
}

export const within = (p: Period): Prisma.DateTimeFilter | undefined => (p.from && p.to ? { gte: p.from, lt: p.to } : undefined);
export const sqlWithin = (column: string, p: Period): Prisma.Sql => (p.from && p.to ? Prisma.sql`AND ${Prisma.raw(column)} >= ${p.from} AND ${Prisma.raw(column)} < ${p.to}` : Prisma.empty);
