// The arithmetic behind the report charts: axis ticks, bar and point positions, heat levels, the hours to show, and the splits the pictures are made of.
// Apart from the screen so it can be tested. Every picture is drawn from rows a registered report already returns, so it never states a number the table does not.

// A round top for an axis and its ticks, so the axis reads 0, 10, 20 and not 0, 7, 14: the largest of 1, 2, 5 times a power of ten that is at least the maximum.
export function niceAxis(max: number, wanted = 3): { max: number; ticks: number[] } {
  const top = Math.max(1, Math.ceil(max));
  const raw = top / wanted, pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map(m => m * pow).find(s => s >= raw)!;
  const stepSafe = Math.max(1, step), niceTop = Math.ceil(top / stepSafe) * stepSafe;
  return { max: niceTop, ticks: Array.from({ length: Math.round(niceTop / stepSafe) + 1 }, (_, i) => i * stepSafe) };
}

// The y of a value in a chart that is `height` tall with `max` at the top; 0 sits at `height`.
export const yFor = (value: number, max: number, height: number): number => (max > 0 ? height - (Math.max(0, value) / max) * height : height);

// Heights of the two parts of one stacked bar, in the same units as `height`. A part that exists is never drawn thinner than `min`.
export function stackHeights(a: number, b: number, max: number, height: number, min = 2): { a: number; b: number } {
  if (max <= 0) return { a: 0, b: 0 };
  const grow = (v: number) => (v > 0 ? Math.max(min, (v / max) * height) : 0);
  return { a: grow(a), b: grow(b) };
}

// Which of `count` labels along an axis to write: about `wanted`, always the first and the last, evenly spaced.
export function labelIndexes(count: number, wanted = 5): number[] {
  if (count <= 0) return [];
  if (count <= wanted) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (wanted - 1);
  return [...new Set(Array.from({ length: wanted }, (_, i) => Math.round(i * step)))];
}

// How strongly to colour a heat cell, 0 for nothing and between a faint 0.15 and 1 for something, in proportion to the busiest cell.
export const heatLevel = (value: number, max: number): number => (value <= 0 || max <= 0 ? 0 : 0.15 + 0.85 * Math.min(1, value / max));

// The hours worth showing: those with attendances, widened to the working day (8 to 16) so a quiet facility still reads as a day, never beyond 0 to 23.
export function hourWindow(totalsByHour: number[], dayStart = 8, dayEnd = 16): { from: number; to: number } {
  const used = totalsByHour.map((n, h) => (n > 0 ? h : -1)).filter(h => h >= 0);
  return { from: Math.max(0, Math.min(dayStart, ...used)), to: Math.min(23, Math.max(dayEnd, ...used)) };
}

// Points of a line chart: values spread evenly across `width`, 0 at the bottom of `height`. One value sits in the middle.
export function linePoints(values: number[], max: number, width: number, height: number): { x: number; y: number }[] {
  return values.map((v, i) => ({ x: values.length === 1 ? width / 2 : (i / (values.length - 1)) * width, y: yFor(v, max, height) }));
}

export interface SexRow { label: string; female: number; male: number }
interface Counts { label: string; newMale?: number; newFemale?: number; reMale?: number; reFemale?: number }
// Female and male attendances per age band, new and re-attendance together. The sex "other" has no bar; the caller says how many there are.
export const bandSplit = (rows: Counts[]): SexRow[] => rows.map(r => ({ label: r.label, female: (r.newFemale ?? 0) + (r.reFemale ?? 0), male: (r.newMale ?? 0) + (r.reMale ?? 0) }));

// Width of each side of a back-to-back bar, in percent of the half-width available, for the largest value in the chart.
export const sideWidth = (value: number, max: number): number => (max > 0 && value > 0 ? Math.max(2, (value / max) * 100) : 0);

// How many days a period covers, or null for all time.
export function daysIn(p: { from: string; to: string }): number | null {
  if (!p.from) return null;
  const a = new Date(p.from + 'T00:00:00'), b = new Date(p.to + 'T00:00:00');
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}
export type Grain = 'day' | 'week' | 'month';
// Which groupings suit a period, and which to start on: days for up to about three months, weeks for up to a year, months always. All time is by month only.
export function grains(p: { from: string; to: string }): { allowed: Grain[]; first: Grain } {
  const days = daysIn(p);
  const allowed: Grain[] = days === null ? ['month'] : [...(days <= 92 ? ['day' as const] : []), ...(days <= 400 ? ['week' as const] : []), 'month'];
  const first: Grain = days === null || days > 200 ? 'month' : days <= 45 ? 'day' : 'week';
  return { allowed, first };
}
