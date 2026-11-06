import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { parsePeriod, sqlWithin, type Period } from './reportPeriod';
import { userNames } from './billingOps';
import { patientCode, maskNrc, LINE_LIMIT } from './attendanceReports';
import type { Report } from '../controllers/billingReports.controller';

// Laboratory reports (Reports Hub stage 5): tests ordered and done, turnaround, and abnormal or positive results.
// They are built from the investigation order items and their results. Counts and line lists come from the same rows,
// so every number can be traced to the tests behind it.

const WHICH = 'Imported documents are left out: a result typed in from a scanned paper was not ordered or done here, and its times are the day it was imported.';

export const LAB_DEFINITIONS = [
  'A test is one item on an investigation order. A panel (for example a full blood count) is one test, not one per component.',
  'Tests ordered and done are counted by the day they were ordered. Turnaround and abnormal results are counted by the day the result was first entered.',
  'Pending: ordered, no sample marked as received yet. In progress: the lab has started. Completed: resulted, including results that were later corrected.',
  'Turnaround: the time from the order to the first time a result was entered. A later correction does not change it. Sample to result is shown only for tests where the lab marked the sample as received.',
  'A result whose time is before its order time is a recording error: it is left out of the turnaround and counted in the notes above the table.',
  'Abnormal, positive and critical come from the flag the lab chose when the result was entered; the system does not judge the values. A test with several components takes the most serious flag among them (critical, then positive, then abnormal, which includes high and low).',
  'Test group and ward or department are not recorded on lab orders, so the lists are by test name and by specimen.',
  'Rejected samples are not recorded, so they cannot be reported.',
  WHICH,
  `A line list shows at most ${LINE_LIMIT.toLocaleString()} tests; the counts always cover all of them. It shows a patient ID and a masked NRC unless a clinical role asks for names.`,
];

const GROUPS = ['test', 'specimen'] as const;
type Group = (typeof GROUPS)[number];
const STATUSES = ['pending', 'inProgress', 'completed', 'other'] as const;
const FLAGS = ['flagged', 'all', 'abnormal', 'positive', 'critical', 'normal', 'none'] as const;
const NOT_RECORDED = 'Not recorded';

interface Filters { period: Period; groupBy: Group; test?: string; specimen?: string; status?: (typeof STATUSES)[number]; flag: (typeof FLAGS)[number] }
interface Row {
  id: string; name: string; specimen: string | null; status: string; orderedAt: Date; sampleAt: Date | null; resultedAt: Date | null;
  patientId: string; orderedById: string; resultedById: string | null; resultsJson: string | null;
}

function parseFilters(q: Record<string, unknown>): Filters | { error: string } {
  const period = parsePeriod(q);
  if ('error' in period) return period;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const groupBy = text(q['groupBy']) ?? 'test', status = text(q['status']), flag = text(q['flag']) ?? 'flagged';
  if (!(GROUPS as readonly string[]).includes(groupBy)) return { error: 'Group by test or by specimen.' };
  if (status && !(STATUSES as readonly string[]).includes(status)) return { error: 'Choose pending, in progress, completed or other.' };
  if (!(FLAGS as readonly string[]).includes(flag)) return { error: 'Choose flagged, all, abnormal, positive, critical, normal or no flag recorded.' };
  return { period, groupBy: groupBy as Group, test: text(q['test']), specimen: text(q['specimen']), status: status as Filters['status'], flag: flag as Filters['flag'] };
}

const specimenOf = (r: Row) => r.specimen?.trim() || NOT_RECORDED;
const statusOf = (r: Row): 'pending' | 'inProgress' | 'completed' | 'other' =>
  r.status === 'Pending' ? 'pending' : r.status === 'In Progress' ? 'inProgress' : r.status === 'Resulted' || r.status === 'Amended' ? 'completed' : 'other';
const keyOf = (r: Row, by: Group) => (by === 'test' ? r.name.trim() : specimenOf(r));

// Tests in the period. `ordered` anchors on the order day; `resulted` on the day the result was first entered (so only tests that have one).
async function load(p: Period, anchor: 'ordered' | 'resulted', withResults: boolean): Promise<Row[]> {
  const column = anchor === 'ordered' ? 'o."orderedAt"' : 'first.at';
  return prisma.$queryRaw<Row[]>`
    SELECT i.id, i.name, i.specimen, i.status, o."orderedAt", i."sampleReceivedAt" AS "sampleAt", first.at AS "resultedAt",
      o."patientId", o."orderedById", cur."resultedById", ${withResults ? Prisma.sql`cur."resultsJson"` : Prisma.sql`NULL::text`} AS "resultsJson"
    FROM "InvestigationOrderItem" i
    JOIN "InvestigationOrder" o ON o.id = i."orderId"
    LEFT JOIN LATERAL (SELECT min(r."resultedAt") AS at FROM "InvestigationResult" r WHERE r."itemId" = i.id) first ON TRUE
    LEFT JOIN LATERAL (
      SELECT r."resultsJson", r."resultedById" FROM "InvestigationResult" r WHERE r."itemId" = i.id
      ORDER BY r."resultedAt" DESC, r."amendedAt" DESC NULLS LAST, r.id LIMIT 1
    ) cur ON TRUE
    WHERE i."catalogueId" NOT LIKE 'imported:%' ${anchor === 'resulted' ? Prisma.sql`AND first.at IS NOT NULL` : Prisma.empty} ${sqlWithin(column, p)}
    ORDER BY o."orderedAt", i.id`;
}
const importedCount = (p: Period, anchor: 'ordered' | 'resulted') => prisma.$queryRaw<{ n: number }[]>`
  SELECT count(*)::int AS n FROM "InvestigationOrderItem" i JOIN "InvestigationOrder" o ON o.id = i."orderId"
  LEFT JOIN LATERAL (SELECT min(r."resultedAt") AS at FROM "InvestigationResult" r WHERE r."itemId" = i.id) first ON TRUE
  WHERE i."catalogueId" LIKE 'imported:%' ${sqlWithin(anchor === 'ordered' ? 'o."orderedAt"' : 'first.at', p)}`.then(r => r[0]?.n ?? 0);

const keep = (rows: Row[], f: Filters) => rows.filter(r => (!f.test || r.name.trim() === f.test) && (!f.specimen || specimenOf(r) === f.specimen));
const filterText = (f: Filters) => [f.test && `test ${f.test}`, f.specimen && `specimen ${f.specimen}`].filter(Boolean).join(', ');
const titleFor = (f: Filters, base: string) => (f.groupBy === 'specimen' ? `${base} by specimen` : `${base} by test`);
const groupHeader = (f: Filters) => (f.groupBy === 'specimen' ? 'Specimen' : 'Test');
const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
const num = (key: string, header: string, width = 13) => ({ key, header, type: 'int' as const, width });
const text = (key: string, header: string, width: number) => ({ key, header, type: 'text' as const, width });

// ── Durations ───────────────────────────────────────────────────────────────
const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60000);
const hours = (minutes: number) => Math.round((minutes / 60) * 10) / 10;
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
export function duration(minutes: number | null): string {
  if (minutes === null) return '';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 2880) { const h = Math.floor(minutes / 60), m = minutes % 60; return m ? `${h} h ${m} min` : `${h} h`; }
  const d = Math.floor(minutes / 1440), h = Math.round((minutes % 1440) / 60);
  return h ? `${d} days ${h} h` : `${d} days`;
}

// ── Patients and staff for a line list ──────────────────────────────────────
const SOURCE_NOTE = (n: number) => (n ? [{ label: 'Imported documents left out', value: n }] : []);
async function people(rows: Row[], names: boolean) {
  const ids = [...new Set(rows.map(r => r.patientId))];
  const patients = ids.length ? await prisma.patient.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, nationalId: true } }) : [];
  const byId = new Map(patients.map(p => [p.id, p]));
  const staff = await userNames(rows.flatMap(r => [r.orderedById, r.resultedById]));
  return (r: Row) => {
    const p = byId.get(r.patientId);
    return {
      patientCode: patientCode(r.patientId), name: names ? `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim() : '', nrc: names ? p?.nationalId ?? '' : maskNrc(p?.nationalId),
      orderedBy: staff[r.orderedById] ?? '', resultedBy: staff[r.resultedById ?? ''] ?? '',
    };
  };
}
const patientColumns = (names: boolean) => [text('patientCode', 'Patient ID', 16), ...(names ? [text('name', 'Name', 26)] : []), text('nrc', names ? 'NRC' : 'NRC (masked)', 16)];

// ── Tests ordered and done ──────────────────────────────────────────────────
const STATUS_LABEL = { pending: 'Pending', inProgress: 'In progress', completed: 'Completed', other: 'Other' } as const;

export async function labTests(q: Record<string, unknown>): Promise<Report | { error: string }> {
  const f = parseFilters(q);
  if ('error' in f) return f;
  const [all, imported] = await Promise.all([load(f.period, 'ordered', false), importedCount(f.period, 'ordered')]);
  const rows = keep(all, f);

  const groups = new Map<string, { label: string; ordered: number; pending: number; inProgress: number; completed: number; other: number }>();
  for (const r of rows) {
    const k = keyOf(r, f.groupBy), g = groups.get(k) ?? { label: k, ordered: 0, pending: 0, inProgress: 0, completed: 0, other: 0 };
    g.ordered++; g[statusOf(r)]++; groups.set(k, g);
  }
  const body = [...groups.values()].sort((a, b) => b.ordered - a.ordered || byLabel(a, b)).map(g => ({ ...g, key: g.label }));
  const total = body.reduce((t, g) => ({ ordered: t.ordered + g.ordered, pending: t.pending + g.pending, inProgress: t.inProgress + g.inProgress, completed: t.completed + g.completed, other: t.other + g.other }),
    { ordered: 0, pending: 0, inProgress: 0, completed: 0, other: 0 });
  const filters = filterText(f);
  return {
    name: 'lab-tests', title: titleFor(f, 'Tests ordered and done'), period: filters ? `${f.period.label} · ${filters}` : f.period.label,
    columns: [text('label', groupHeader(f), 40), num('ordered', 'Ordered'), num('pending', 'Pending'), num('inProgress', 'In progress', 14), num('completed', 'Completed'), ...(total.other ? [num('other', 'Other status')] : [])],
    rows: body, totals: { label: 'All', ...total },
    summary: [
      { label: 'Tests ordered', value: total.ordered }, { label: 'Completed', value: total.completed }, { label: 'Waiting (pending or in progress)', value: total.pending + total.inProgress },
      { label: 'Completed share (%)', value: total.ordered ? Math.round((total.completed / total.ordered) * 100) : 0 }, ...SOURCE_NOTE(imported),
    ],
  };
}

export async function labTestLines(q: Record<string, unknown>, options: { names: boolean }): Promise<Report | { error: string }> {
  const f = parseFilters(q);
  if ('error' in f) return f;
  const [loaded, imported] = await Promise.all([load(f.period, 'ordered', false), importedCount(f.period, 'ordered')]);
  const all = keep(loaded, f).filter(r => !f.status || statusOf(r) === f.status).sort((a, b) => b.orderedAt.getTime() - a.orderedAt.getTime() || b.id.localeCompare(a.id));
  const rows = all.slice(0, LINE_LIMIT), who = await people(rows, options.names);
  return {
    name: 'lab-tests-lines', title: 'Tests ordered line list', period: f.period.label,
    columns: [
      { key: 'orderedAt', header: 'Ordered', type: 'date', width: 18 }, ...patientColumns(options.names), text('test', 'Test', 36), text('specimen', 'Specimen', 14), text('status', 'Status', 13),
      { key: 'sampleAt', header: 'Sample received', type: 'date', width: 18 }, { key: 'resultedAt', header: 'Resulted', type: 'date', width: 18 }, text('orderedBy', 'Ordered by', 22), text('resultedBy', 'Resulted by', 22),
    ],
    rows: rows.map(r => ({ orderedAt: r.orderedAt, ...who(r), test: r.name, specimen: r.specimen ?? '', status: STATUS_LABEL[statusOf(r)], sampleAt: r.sampleAt, resultedAt: r.resultedAt })),
    totals: null,
    summary: [{ label: 'Tests', value: all.length }, ...(all.length > rows.length ? [{ label: `Not shown (the list holds the newest ${LINE_LIMIT})`, value: all.length - rows.length }] : []), ...SOURCE_NOTE(imported)],
  };
}

// ── Turnaround ──────────────────────────────────────────────────────────────
interface Timed { row: Row; total: number; sample: number | null }
// Tests with a usable order-to-result time; the rest are counted separately so nothing disappears quietly.
function timed(rows: Row[]): { good: Timed[]; bad: number } {
  const good: Timed[] = []; let bad = 0;
  for (const row of rows) {
    if (!row.resultedAt) continue;
    const total = minutesBetween(row.orderedAt, row.resultedAt);
    if (total < 0) { bad++; continue; }
    const sample = row.sampleAt && row.sampleAt >= row.orderedAt && row.sampleAt <= row.resultedAt ? minutesBetween(row.sampleAt, row.resultedAt) : null;
    good.push({ row, total, sample });
  }
  return { good, bad };
}

export async function labTurnaround(q: Record<string, unknown>): Promise<Report | { error: string }> {
  const f = parseFilters(q);
  if ('error' in f) return f;
  const [all, imported] = await Promise.all([load(f.period, 'resulted', false), importedCount(f.period, 'resulted')]);
  const { good, bad } = timed(keep(all, f));

  const stats = (items: Timed[]) => {
    const samples = items.filter(t => t.sample !== null).map(t => t.sample!), totals = items.map(t => t.total);
    return { resulted: items.length, medianMin: median(totals), longestMin: totals.length ? Math.max(...totals) : null, withSample: samples.length, medianSampleMin: median(samples) };
  };
  const groups = new Map<string, Timed[]>();
  for (const t of good) { const k = keyOf(t.row, f.groupBy); groups.set(k, [...(groups.get(k) ?? []), t]); }
  const body = [...groups.entries()].map(([label, items]) => {
    const s = stats(items);
    return { label, key: label, ...s, medianHours: s.medianMin === null ? null : hours(s.medianMin), longestHours: s.longestMin === null ? null : hours(s.longestMin), medianSampleHours: s.medianSampleMin === null ? null : hours(s.medianSampleMin) };
  }).sort((a, b) => (b.medianMin ?? 0) - (a.medianMin ?? 0) || byLabel(a, b));   // slowest first
  const all_ = stats(good), filters = filterText(f);
  return {
    name: 'lab-turnaround', title: titleFor(f, 'Lab turnaround'), period: filters ? `${f.period.label} · ${filters}` : f.period.label,
    columns: [
      text('label', groupHeader(f), 40), num('resulted', 'Tests resulted'), { key: 'medianHours', header: 'Median hours, order to result', type: 'number', width: 18 }, { key: 'longestHours', header: 'Longest hours', type: 'number', width: 14 },
      num('withSample', 'With sample time', 15), { key: 'medianSampleHours', header: 'Median hours, sample to result', type: 'number', width: 18 },
    ],
    rows: body,
    totals: { label: 'All', ...all_, medianHours: all_.medianMin === null ? null : hours(all_.medianMin), longestHours: all_.longestMin === null ? null : hours(all_.longestMin), medianSampleHours: all_.medianSampleMin === null ? null : hours(all_.medianSampleMin) },
    summary: [
      { label: 'Tests resulted', value: all_.resulted }, { label: 'Median, order to result', value: duration(all_.medianMin) || 'No results' }, { label: 'Longest, order to result', value: duration(all_.longestMin) || 'No results' },
      ...(all_.medianSampleMin === null ? [] : [{ label: 'Median, sample to result', value: duration(all_.medianSampleMin) }]),
      ...(bad ? [{ label: 'Left out: result time before order time', value: bad }] : []), ...SOURCE_NOTE(imported),
    ],
  };
}

export async function labTurnaroundLines(q: Record<string, unknown>, options: { names: boolean }): Promise<Report | { error: string }> {
  const f = parseFilters(q);
  if ('error' in f) return f;
  const [loaded, imported] = await Promise.all([load(f.period, 'resulted', false), importedCount(f.period, 'resulted')]);
  const { good } = timed(keep(loaded, f));
  const all = good.sort((a, b) => b.total - a.total || b.row.id.localeCompare(a.row.id));   // slowest first
  const rows = all.slice(0, LINE_LIMIT), who = await people(rows.map(t => t.row), options.names);
  return {
    name: 'lab-turnaround-lines', title: 'Lab turnaround line list', period: f.period.label,
    columns: [
      { key: 'resultedAt', header: 'Resulted', type: 'date', width: 18 }, ...patientColumns(options.names), text('test', 'Test', 36), text('specimen', 'Specimen', 14),
      { key: 'orderedAt', header: 'Ordered', type: 'date', width: 18 }, { key: 'sampleAt', header: 'Sample received', type: 'date', width: 18 },
      { key: 'hours', header: 'Hours, order to result', type: 'number', width: 16 }, text('time', 'Time taken', 14), text('orderedBy', 'Ordered by', 22), text('resultedBy', 'Resulted by', 22),
    ],
    rows: rows.map(t => ({ resultedAt: t.row.resultedAt, ...who(t.row), test: t.row.name, specimen: t.row.specimen ?? '', orderedAt: t.row.orderedAt, sampleAt: t.row.sampleAt, hours: hours(t.total), time: duration(t.total) })),
    totals: null,
    summary: [{ label: 'Tests', value: all.length }, ...(all.length > rows.length ? [{ label: `Not shown (the list holds the slowest ${LINE_LIMIT})`, value: all.length - rows.length }] : []), ...SOURCE_NOTE(imported)],
  };
}

// ── Abnormal and positive results ───────────────────────────────────────────
type Flag = (typeof FLAGS)[number];   // 'flagged' (any of abnormal, positive, critical) and 'all' are filters, not flags a result can have
const RANK: Record<string, number> = { Critical: 3, Positive: 2, High: 1, Low: 1, Abnormal: 1, Normal: 0, Negative: 0 };
const FLAG_BY_RANK: Flag[] = ['normal', 'abnormal', 'positive', 'critical'];
const FLAG_LABEL: Record<string, string> = { critical: 'Critical', positive: 'Positive', abnormal: 'Abnormal', normal: 'Normal', none: 'No flag recorded' };
interface Component { componentName?: string; value?: string; units?: string | null; status?: string }

// The most serious flag among a result's components, and the flagged components in words.
export function flagOf(resultsJson: string | null): { flag: Exclude<Flag, 'flagged' | 'all'>; detail: string } {
  let parts: Component[] = [];
  try { const v = JSON.parse(resultsJson ?? '[]'); if (Array.isArray(v)) parts = v; } catch { /* an unreadable result has no flag */ }
  let worst = -1;
  const flagged: string[] = [];
  for (const c of parts) {
    const rank = RANK[c?.status ?? ''];
    if (rank === undefined) continue;
    worst = Math.max(worst, rank);
    if (rank >= 1) flagged.push(`${c.componentName ?? 'Result'} ${[c.value, c.units].filter(Boolean).join(' ')} (${c.status})`.replace(/\s+/g, ' '));
  }
  return { flag: worst < 0 ? 'none' : FLAG_BY_RANK[worst] as Exclude<Flag, 'flagged' | 'all'>, detail: flagged.join('; ') };
}

export async function labAbnormal(q: Record<string, unknown>): Promise<Report | { error: string }> {
  const f = parseFilters(q);
  if ('error' in f) return f;
  const [all, imported] = await Promise.all([load(f.period, 'resulted', true), importedCount(f.period, 'resulted')]);
  const rows = keep(all, f);

  const blank = () => ({ resulted: 0, normal: 0, abnormal: 0, positive: 0, critical: 0, none: 0 });
  const groups = new Map<string, ReturnType<typeof blank> & { label: string }>();
  const total = blank();
  for (const r of rows) {
    const k = keyOf(r, f.groupBy), g = groups.get(k) ?? { label: k, ...blank() }, { flag } = flagOf(r.resultsJson);
    g.resulted++; g[flag]++; total.resulted++; total[flag]++; groups.set(k, g);
  }
  const flagged = (g: ReturnType<typeof blank>) => g.abnormal + g.positive + g.critical;
  const body = [...groups.values()].sort((a, b) => flagged(b) - flagged(a) || b.resulted - a.resulted || byLabel(a, b)).map(g => ({ ...g, key: g.label }));
  const filters = filterText(f);
  return {
    name: 'lab-abnormal', title: titleFor(f, 'Abnormal and positive results'), period: filters ? `${f.period.label} · ${filters}` : f.period.label,
    columns: [text('label', groupHeader(f), 40), num('resulted', 'Resulted'), num('normal', 'Normal'), num('abnormal', 'Abnormal'), num('positive', 'Positive'), num('critical', 'Critical'), num('none', 'No flag recorded', 16)],
    rows: body, totals: { label: 'All', ...total },
    summary: [
      { label: 'Tests resulted', value: total.resulted }, { label: 'Flagged (abnormal, positive or critical)', value: flagged(total) }, { label: 'Critical', value: total.critical },
      { label: 'Flagged share (%)', value: total.resulted ? Math.round((flagged(total) / total.resulted) * 100) : 0 }, ...SOURCE_NOTE(imported),
    ],
  };
}

export async function labAbnormalLines(q: Record<string, unknown>, options: { names: boolean }): Promise<Report | { error: string }> {
  const f = parseFilters(q);
  if ('error' in f) return f;
  const [loaded, imported] = await Promise.all([load(f.period, 'resulted', true), importedCount(f.period, 'resulted')]);
  const picked = keep(loaded, f).map(row => ({ row, ...flagOf(row.resultsJson) })).filter(x => (f.flag === 'all' ? true : f.flag === 'flagged' ? x.flag === 'abnormal' || x.flag === 'positive' || x.flag === 'critical' : x.flag === f.flag));
  const all = picked.sort((a, b) => b.row.resultedAt!.getTime() - a.row.resultedAt!.getTime() || b.row.id.localeCompare(a.row.id));
  const rows = all.slice(0, LINE_LIMIT), who = await people(rows.map(x => x.row), options.names);
  return {
    name: 'lab-abnormal-lines', title: 'Abnormal and positive results line list', period: f.period.label,
    columns: [
      { key: 'resultedAt', header: 'Resulted', type: 'date', width: 18 }, ...patientColumns(options.names), text('test', 'Test', 36), text('specimen', 'Specimen', 14),
      text('flag', 'Flag', 14), text('detail', 'Flagged results', 54), text('resultedBy', 'Resulted by', 22),
    ],
    rows: rows.map(x => ({ resultedAt: x.row.resultedAt, ...who(x.row), test: x.row.name, specimen: x.row.specimen ?? '', flag: FLAG_LABEL[x.flag], detail: x.detail })),
    totals: null,
    summary: [{ label: 'Tests', value: all.length }, ...(all.length > rows.length ? [{ label: `Not shown (the list holds the newest ${LINE_LIMIT})`, value: all.length - rows.length }] : []), ...SOURCE_NOTE(imported)],
  };
}
