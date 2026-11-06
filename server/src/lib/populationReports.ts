import { Prisma } from '@prisma/client';
import prisma from './prisma';
import type { Report } from '../controllers/billingReports.controller';

// Population figures for the Reports page and its Excel export. Aggregates only: no patient is ever named here.

export interface Period { from: Date | null; to: Date | null; fromDay: string | null; toDay: string | null; label: string }   // `to` is the start of the day after the last day, so a range is [from, to)

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
function parseDay(value: string): Date | null {
  const m = DAY.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;   // rejects 31 February
}
const dayText = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shortDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

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

const within = (p: Period): Prisma.DateTimeFilter | undefined => (p.from && p.to ? { gte: p.from, lt: p.to } : undefined);
const sqlWithin = (column: string, p: Period): Prisma.Sql => (p.from && p.to ? Prisma.sql`AND ${Prisma.raw(column)} >= ${p.from} AND ${Prisma.raw(column)} < ${p.to}` : Prisma.empty);

// ── Chronic diseases ───────────────────────────────────────────────────────
// A starter list for clinical review. A diagnosis counts when its ICD-11 code starts with one of the prefixes (so every more
// specific code under it counts too) and does not start with an excluded one. Custom diagnoses without an ICD-11 code are not matched.
export interface ChronicCondition { key: string; label: string; prefixes: string[]; exclude?: string[] }
export const CHRONIC_CONDITIONS: ChronicCondition[] = [
  { key: 'hypertension', label: 'Hypertension', prefixes: ['BA00', 'BA01', 'BA02', 'BA04'] },
  { key: 'diabetes', label: 'Diabetes mellitus', prefixes: ['5A10', '5A11', '5A13', '5A14'] },
  { key: 'hiv', label: 'HIV disease', prefixes: ['1C60', '1C61', '1C62'] },
  { key: 'asthma', label: 'Asthma', prefixes: ['CA23'] },
  { key: 'copd', label: 'Chronic obstructive pulmonary disease', prefixes: ['CA22'] },
  { key: 'epilepsy', label: 'Epilepsy', prefixes: ['8A60', '8A61', '8A62'] },
  { key: 'heart_failure', label: 'Heart failure', prefixes: ['BD10', 'BD11'] },
  { key: 'ckd', label: 'Chronic kidney disease', prefixes: ['GB61'] },
  { key: 'sickle_cell', label: 'Sickle cell disease', prefixes: ['3A51'], exclude: ['3A51.0'] },   // 3A51.0 is the trait, not the disease
  { key: 'depression', label: 'Depression', prefixes: ['6A70', '6A71'] },
];
export const BP_LIMITS = { systolic: 140, diastolic: 90, recentDays: 90 } as const;
export const SEEN_DAYS = 90;

export interface ChronicRow {
  key: string; label: string; active: number; newInPeriod: number;
  female: number; male: number; other: number; under18: number; adults: number; older: number;
  seenRecently: number; notSeenRecently: number;
  bpControl: { controlled: number; notControlled: number; noRecentReading: number } | null;
}
export interface ChronicSummary { rows: ChronicRow[]; patientsWithAny: number; patientsWithSeveral: number; seenDays: number; bp: typeof BP_LIMITS }

interface ChronicRaw { grp: string; patientId: string; active: boolean; firstRecorded: Date; gender: string; age: number; lastVisit: Date | null; sys: number | null; dia: number | null; bpAt: Date | null }

export async function chronicSummary(p: Period, now = new Date()): Promise<ChronicSummary> {
  const defs = CHRONIC_CONDITIONS.flatMap(c => c.prefixes.map(prefix => Prisma.sql`(${c.key}::text, ${prefix}::text)`));
  const excludes = CHRONIC_CONDITIONS.flatMap(c => (c.exclude ?? []).map(prefix => Prisma.sql`(${c.key}::text, ${prefix}::text)`));
  const raw = await prisma.$queryRaw<ChronicRaw[]>`
    WITH defs(key, prefix) AS (VALUES ${Prisma.join(defs)}),
    skip(key, prefix) AS (VALUES ${excludes.length ? Prisma.join(excludes) : Prisma.sql`(NULL::text, NULL::text)`}),
    dx AS (
      SELECT pd."patientId", d.key AS grp, MIN(pd."createdAt") AS first_recorded, BOOL_OR(pd."resolvedAt" IS NULL) AS active
      FROM "PatientDiagnosis" pd
      JOIN "ICD11Code" c ON c.id = pd."icd11Id"
      JOIN defs d ON c.code LIKE d.prefix || '%'
      WHERE NOT EXISTS (SELECT 1 FROM skip s WHERE s.key = d.key AND c.code LIKE s.prefix || '%')
      GROUP BY pd."patientId", d.key
    )
    SELECT dx.grp, dx."patientId", dx.active, dx.first_recorded AS "firstRecorded", p.gender::text AS gender,
      date_part('year', age(CURRENT_DATE, p."dateOfBirth"))::int AS age,
      (SELECT MAX(e."createdAt") FROM "Encounter" e WHERE e."patientId" = dx."patientId") AS "lastVisit",
      lb.sys, lb.dia, lb."recordedAt" AS "bpAt"
    FROM dx
    JOIN "Patient" p ON p.id = dx."patientId"
    LEFT JOIN LATERAL (
      SELECT v."bloodPressureSystolic" AS sys, v."bloodPressureDiastolic" AS dia, v."recordedAt"
      FROM "Vital" v
      WHERE v."patientId" = dx."patientId" AND dx.grp = 'hypertension'
        AND v."bloodPressureSystolic" IS NOT NULL AND v."bloodPressureDiastolic" IS NOT NULL
      ORDER BY v."recordedAt" DESC LIMIT 1
    ) lb ON TRUE`;

  const seenSince = now.getTime() - SEEN_DAYS * 86_400_000, bpSince = now.getTime() - BP_LIMITS.recentDays * 86_400_000;
  const perPatient = new Map<string, number>();
  const rows = CHRONIC_CONDITIONS.map((c): ChronicRow => {
    const mine = raw.filter(r => r.grp === c.key), active = mine.filter(r => r.active);
    const row: ChronicRow = {
      key: c.key, label: c.label, active: active.length,
      newInPeriod: mine.filter(r => !p.from || (r.firstRecorded >= p.from && r.firstRecorded < p.to!)).length,
      female: active.filter(r => r.gender === 'FEMALE').length, male: active.filter(r => r.gender === 'MALE').length,
      other: active.filter(r => r.gender !== 'FEMALE' && r.gender !== 'MALE').length,
      under18: active.filter(r => r.age < 18).length, adults: active.filter(r => r.age >= 18 && r.age < 65).length, older: active.filter(r => r.age >= 65).length,
      seenRecently: active.filter(r => r.lastVisit && r.lastVisit.getTime() >= seenSince).length, notSeenRecently: 0, bpControl: null,
    };
    row.notSeenRecently = row.active - row.seenRecently;
    if (c.key === 'hypertension') {
      const measured = active.filter(r => r.bpAt && r.bpAt.getTime() >= bpSince && r.sys !== null && r.dia !== null);
      const controlled = measured.filter(r => r.sys! < BP_LIMITS.systolic && r.dia! < BP_LIMITS.diastolic).length;
      row.bpControl = { controlled, notControlled: measured.length - controlled, noRecentReading: row.active - measured.length };
    }
    for (const r of active) perPatient.set(r.patientId, (perPatient.get(r.patientId) ?? 0) + 1);
    return row;
  });
  return { rows, patientsWithAny: perPatient.size, patientsWithSeveral: [...perPatient.values()].filter(n => n > 1).length, seenDays: SEEN_DAYS, bp: BP_LIMITS };
}

// ── Patients ───────────────────────────────────────────────────────────────
export const AGE_BANDS = ['0-4', '5-17', '18-35', '36-50', '51-64', '65+'] as const;
export interface AgeSexRow { band: string; female: number; male: number; other: number; total: number }

export async function ageSexBands(): Promise<AgeSexRow[]> {
  const raw = await prisma.$queryRaw<{ band: string; gender: string; n: number }[]>`
    SELECT band, gender, COUNT(*)::int AS n FROM (
      SELECT gender::text AS gender, CASE WHEN a < 5 THEN '0-4' WHEN a < 18 THEN '5-17' WHEN a < 36 THEN '18-35' WHEN a < 51 THEN '36-50' WHEN a < 65 THEN '51-64' ELSE '65+' END AS band
      FROM (SELECT gender, date_part('year', age(CURRENT_DATE, "dateOfBirth"))::int AS a FROM "Patient") x
    ) y GROUP BY band, gender`;
  return AGE_BANDS.map(band => {
    const mine = raw.filter(r => r.band === band), pick = (g: string) => mine.filter(r => r.gender === g).reduce((s, r) => s + r.n, 0);
    const female = pick('FEMALE'), male = pick('MALE'), total = mine.reduce((s, r) => s + r.n, 0);
    return { band, female, male, other: total - female - male, total };
  });
}

// ── Overview ───────────────────────────────────────────────────────────────
export async function buildOverview(p: Period, limit = 10, now = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const range = within(p);
  const orderedIn = range ? { orderedAt: range } : { orderedAt: { not: null } as Prisma.DateTimeNullableFilter };

  const [totalPatients, newPatients, bySex, ageSex,
    diagTop, diagTotal, drugTop, dispensed, dispensedToday, prescriptions,
    invStatus, invType, invWaiting,
    procDone, procTop, procSent, procReturned, procWaiting, chronic] = await Promise.all([
    prisma.patient.count(),
    range ? prisma.patient.count({ where: { createdAt: range } }) : Promise.resolve(null),
    prisma.patient.groupBy({ by: ['gender'], _count: { id: true } }),
    ageSexBands(),
    prisma.patientDiagnosis.groupBy({ by: ['icd11Id'], _count: { id: true }, where: range ? { createdAt: range } : {}, orderBy: { _count: { id: 'desc' } }, take: limit }),
    prisma.patientDiagnosis.count({ where: range ? { createdAt: range } : {} }),
    prisma.dispensing.groupBy({ by: ['dispensedDrug'], _count: { id: true }, where: range ? { dispensedAt: range } : {}, orderBy: { _count: { id: 'desc' } }, take: limit }),
    prisma.dispensing.count({ where: range ? { dispensedAt: range } : {} }),
    prisma.dispensing.count({ where: { dispensedAt: { gte: startOfToday } } }),
    prisma.prescription.count({ where: range ? { createdAt: range } : {} }),
    prisma.investigationOrderItem.groupBy({ by: ['status'], _count: { id: true }, where: range ? { order: { orderedAt: range } } : {} }),
    prisma.investigationOrderItem.groupBy({ by: ['type'], _count: { id: true }, where: range ? { order: { orderedAt: range } } : {}, orderBy: { _count: { id: 'desc' } }, take: limit }),
    prisma.investigationOrderItem.groupBy({ by: ['status'], _count: { id: true }, where: { status: { in: ['Pending', 'In Progress'] } } }),
    prisma.$queryRaw<{ done: number; viaRoom: number; medianWait: number | null }[]>`
      SELECT COUNT(*)::int AS done, COUNT("orderedAt")::int AS "viaRoom",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY (EXTRACT(EPOCH FROM ("performedAt" - "orderedAt")) / 60)::float8) FILTER (WHERE "orderedAt" IS NOT NULL) AS "medianWait"
      FROM "EncounterProcedure" WHERE status = 'ACTIVE' ${sqlWithin('"performedAt"', p)}`,
    prisma.encounterProcedure.groupBy({ by: ['name'], _count: { id: true }, where: { status: 'ACTIVE', ...(range ? { performedAt: range } : {}) }, orderBy: { _count: { id: 'desc' } }, take: limit }),
    prisma.encounterProcedure.count({ where: orderedIn }),
    prisma.encounterProcedure.count({ where: { ...orderedIn, status: 'RETURNED' } }),
    prisma.encounterProcedure.findMany({ where: { status: 'ORDERED' }, select: { priority: true, orderedAt: true } }),
    chronicSummary(p, now),
  ]);

  const codes = await prisma.iCD11Code.findMany({ where: { id: { in: diagTop.map(g => g.icd11Id) } }, select: { id: true, code: true, description: true } });
  const codeOf = new Map(codes.map(c => [c.id, c]));
  const waitingAt = procWaiting.map(w => w.orderedAt?.getTime()).filter((t): t is number => typeof t === 'number');
  const count = (rows: { status: string; _count: { id: number } }[], status: string) => rows.find(r => r.status === status)?._count.id ?? 0;
  const sexCount = (g: string) => bySex.find(s => s.gender === g)?._count.id ?? 0;

  return {
    generatedAt: now.toISOString(),
    period: { from: p.fromDay, to: p.toDay, label: p.label, allTime: !p.from },
    patients: { total: totalPatients, newInPeriod: newPatients, female: sexCount('FEMALE'), male: sexCount('MALE'), other: totalPatients - sexCount('FEMALE') - sexCount('MALE'), byAge: ageSex },
    diagnoses: { total: diagTotal, top: diagTop.map(g => ({ description: codeOf.get(g.icd11Id)?.description ?? 'Unknown', code: codeOf.get(g.icd11Id)?.code ?? '', count: g._count.id })) },
    medications: { prescriptions, dispensed, dispensedToday, top: drugTop.map(d => ({ name: d.dispensedDrug, count: d._count.id })) },
    investigations: {
      byStatus: invStatus.map(s => ({ status: s.status, count: s._count.id })).sort((a, b) => b.count - a.count),
      byType: invType.map(t => ({ type: t.type, count: t._count.id })),
      waiting: { pending: count(invWaiting, 'Pending'), inProgress: count(invWaiting, 'In Progress') },
    },
    procedures: {
      done: procDone[0]?.done ?? 0, doneViaRoom: procDone[0]?.viaRoom ?? 0,
      medianWaitMinutes: procDone[0]?.medianWait == null ? null : Math.round(procDone[0].medianWait),
      sentToRoom: procSent, returned: procReturned,
      waiting: { total: procWaiting.length, urgent: procWaiting.filter(w => w.priority === 'URGENT').length, oldestOrderedAt: waitingAt.length ? new Date(Math.min(...waitingAt)).toISOString() : null },
      top: procTop.map(t => ({ name: t.name, count: t._count.id })),
    },
    chronic,
  };
}
export type Overview = Awaited<ReturnType<typeof buildOverview>>;

// ── Excel sheets ───────────────────────────────────────────────────────────
type Cols = Report['columns'];
const text = (key: string, header: string, width = 30): Cols[number] => ({ key, header, type: 'text', width });
const int = (key: string, header: string, width = 14): Cols[number] => ({ key, header, type: 'int', width });

export function exportSheets(o: Overview): Report[] {
  const period = o.period.label, c = o.chronic;
  const sheet = (name: string, title: string, columns: Cols, rows: Record<string, unknown>[], totals: Record<string, unknown> | null = null, summary: Report['summary'] = []): Report =>
    ({ name, title, period, columns, rows, totals, summary });
  const minutes = (m: number | null) => (m === null ? 'No treatment room procedures done' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);

  return [
    sheet('summary', 'Summary', [text('measure', 'Measure', 46), int('value', 'Value', 14), text('note', 'Note', 50)], [
      { measure: 'Patients on record', value: o.patients.total, note: `${o.patients.female} female, ${o.patients.male} male, ${o.patients.other} other` },
      ...(o.patients.newInPeriod === null ? [] : [{ measure: 'New patients registered in the period', value: o.patients.newInPeriod, note: '' }]),
      { measure: 'Diagnoses recorded in the period', value: o.diagnoses.total, note: o.diagnoses.top[0] ? `Most common: ${o.diagnoses.top[0].description}` : '' },
      { measure: 'Prescriptions written in the period', value: o.medications.prescriptions, note: '' },
      { measure: 'Medicines dispensed in the period', value: o.medications.dispensed, note: `${o.medications.dispensedToday} today` },
      { measure: 'Investigations waiting now', value: o.investigations.waiting.pending + o.investigations.waiting.inProgress, note: `${o.investigations.waiting.pending} pending, ${o.investigations.waiting.inProgress} in progress` },
      { measure: 'Procedures done in the period', value: o.procedures.done, note: `${o.procedures.doneViaRoom} through the treatment room` },
      { measure: 'Procedures waiting in the treatment room now', value: o.procedures.waiting.total, note: `${o.procedures.waiting.urgent} urgent` },
      { measure: 'Patients with a chronic disease (active)', value: c.patientsWithAny, note: `${c.patientsWithSeveral} have more than one` },
    ]),
    sheet('diagnoses', 'Diagnoses', [int('rank', '#', 6), text('description', 'Diagnosis', 52), text('code', 'ICD-11 code', 14), int('count', 'Recorded')],
      o.diagnoses.top.map((d, i) => ({ rank: i + 1, ...d })), { description: 'All diagnoses recorded', count: o.diagnoses.total }),
    sheet('medications', 'Medicines dispensed', [int('rank', '#', 6), text('name', 'Medicine', 52), int('count', 'Times dispensed', 16)],
      o.medications.top.map((m, i) => ({ rank: i + 1, ...m })), { name: 'All dispensings', count: o.medications.dispensed }),
    sheet('investigations', 'Investigations', [text('kind', 'Grouped by', 14), text('name', 'Name', 40), int('count', 'Count')], [
      ...o.investigations.byStatus.map(s => ({ kind: 'Status', name: s.status, count: s.count })),
      ...o.investigations.byType.map(t => ({ kind: 'Test type', name: t.type, count: t.count })),
    ], null, [{ label: 'Waiting now (pending)', value: o.investigations.waiting.pending }, { label: 'Waiting now (in progress)', value: o.investigations.waiting.inProgress }]),
    sheet('patients', 'Patients by age and sex', [text('band', 'Age (years)', 14), int('female', 'Female'), int('male', 'Male'), int('other', 'Other'), int('total', 'Total')],
      o.patients.byAge.map(b => ({ ...b })), { band: 'All ages', female: o.patients.female, male: o.patients.male, other: o.patients.other, total: o.patients.total }),
    sheet('procedures', 'Procedures', [int('rank', '#', 6), text('name', 'Procedure', 52), int('count', 'Done')],
      o.procedures.top.map((t, i) => ({ rank: i + 1, ...t })), { name: 'All procedures done', count: o.procedures.done }, [
        { label: 'Sent to the treatment room', value: o.procedures.sentToRoom }, { label: 'Done through the treatment room', value: o.procedures.doneViaRoom },
        { label: 'Sent back to the doctor', value: o.procedures.returned }, { label: 'Median wait before done', value: minutes(o.procedures.medianWaitMinutes) },
        { label: 'Waiting now', value: o.procedures.waiting.total }, { label: 'Waiting now (urgent)', value: o.procedures.waiting.urgent },
      ]),
    sheet('chronic', 'Chronic diseases', [
      text('label', 'Condition', 40), int('active', 'Active patients'), int('newInPeriod', 'New in period'), int('female', 'Female'), int('male', 'Male'), int('other', 'Other'),
      int('under18', 'Under 18'), int('adults', '18 to 64'), int('older', '65 and over'), int('seenRecently', `Seen in last ${c.seenDays} days`, 18), int('notSeenRecently', `Not seen in ${c.seenDays}+ days`, 18),
      int('bpControlled', `BP under ${c.bp.systolic}/${c.bp.diastolic}`, 16), int('bpNotControlled', `BP ${c.bp.systolic}/${c.bp.diastolic} or higher`, 18), int('bpNoReading', `No BP in ${c.bp.recentDays} days`, 18),
    ], c.rows.map(r => ({ ...r, bpControlled: r.bpControl?.controlled ?? null, bpNotControlled: r.bpControl?.notControlled ?? null, bpNoReading: r.bpControl?.noRecentReading ?? null })), null, [
      { label: 'Patients with at least one chronic disease', value: c.patientsWithAny }, { label: 'Patients with more than one', value: c.patientsWithSeveral },
    ]),
  ];
}
