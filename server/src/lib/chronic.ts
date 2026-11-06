import { Prisma } from '@prisma/client';
import prisma from './prisma';
import type { Period } from './reportPeriod';

// Chronic disease figures. One row per patient and condition; every count and every line list is a filter over those rows with one of the
// named measures below, so a number and the records behind it cannot disagree.

export const SEEN_DAYS = 90;
export const BP_LIMITS = { systolic: 140, diastolic: 90, recentDays: 90 } as const;
const DAY_MS = 86_400_000;

export interface Condition { id: string; key: string; label: string; prefixes: string[]; exclude: string[]; active: boolean; sortOrder: number; reviewedAt: Date | null }
export const loadConditions = (activeOnly = true): Promise<Condition[]> => prisma.chronicCondition.findMany({
  where: activeOnly ? { active: true } : {}, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  select: { id: true, key: true, label: true, prefixes: true, exclude: true, active: true, sortOrder: true, reviewedAt: true },
});

export interface PatientCondition {
  key: string; patientId: string; active: boolean; firstRecorded: Date; resolvedAt: Date | null; diagnosedAt: Date | null;
  gender: string; age: number; lastVisit: Date | null; nextAppointment: Date | null; sys: number | null; dia: number | null; bpAt: Date | null;
}

// A patient has a condition when a diagnosis on their record has an ICD-11 code starting with one of its prefixes (and none of its exclusions).
// It is active while any such diagnosis is unresolved. A visit is a queue check-in that was not removed, or a consultation.
export async function loadPatientConditions(conditions: Condition[]): Promise<PatientCondition[]> {
  const defs = conditions.flatMap(c => c.prefixes.map(prefix => Prisma.sql`(${c.key}::text, ${prefix}::text)`));
  if (defs.length === 0) return [];
  const skips = conditions.flatMap(c => c.exclude.map(prefix => Prisma.sql`(${c.key}::text, ${prefix}::text)`));
  return prisma.$queryRaw<PatientCondition[]>`
    WITH defs(key, prefix) AS (VALUES ${Prisma.join(defs)}),
    skip(key, prefix) AS (VALUES ${skips.length ? Prisma.join(skips) : Prisma.sql`(NULL::text, NULL::text)`}),
    dx AS (
      SELECT pd."patientId", d.key AS grp, MIN(pd."createdAt") AS first_recorded, BOOL_OR(pd."resolvedAt" IS NULL) AS active,
             MAX(pd."resolvedAt") AS resolved_at, MIN(pd."diagnosedAt") AS diagnosed_at
      FROM "PatientDiagnosis" pd
      JOIN "ICD11Code" c ON c.id = pd."icd11Id"
      JOIN defs d ON c.code LIKE d.prefix || '%'
      WHERE NOT EXISTS (SELECT 1 FROM skip s WHERE s.key = d.key AND c.code LIKE s.prefix || '%')
      GROUP BY pd."patientId", d.key
    )
    SELECT dx.grp AS key, dx."patientId", dx.active, dx.first_recorded AS "firstRecorded",
      CASE WHEN dx.active THEN NULL ELSE dx.resolved_at END AS "resolvedAt", dx.diagnosed_at AS "diagnosedAt",
      p.gender::text AS gender, date_part('year', age(CURRENT_DATE, p."dateOfBirth"))::int AS age,
      GREATEST((SELECT MAX(e."createdAt") FROM "Encounter" e WHERE e."patientId" = dx."patientId"),
               (SELECT MAX(q."checkedInAt") FROM "QueueEntry" q WHERE q."patientId" = dx."patientId" AND q.status <> 'Removed')) AS "lastVisit",
      (SELECT MIN(a."scheduledAt") FROM "Appointment" a WHERE a."patientId" = dx."patientId" AND a.status::text IN ('SCHEDULED', 'CONFIRMED')
         AND a."scheduledAt" >= (now() AT TIME ZONE 'UTC')) AS "nextAppointment",
      lb.sys, lb.dia, lb."recordedAt" AS "bpAt"
    FROM dx
    JOIN "Patient" p ON p.id = dx."patientId"
    LEFT JOIN LATERAL (
      SELECT v."bloodPressureSystolic" AS sys, v."bloodPressureDiastolic" AS dia, v."recordedAt"
      FROM "Vital" v
      WHERE v."patientId" = dx."patientId" AND dx.grp = 'hypertension' AND v."bloodPressureSystolic" IS NOT NULL AND v."bloodPressureDiastolic" IS NOT NULL
      ORDER BY v."recordedAt" DESC LIMIT 1
    ) lb ON TRUE`;
}

// ── The measures ────────────────────────────────────────────────────────────
export interface Ctx { period: Period; now: Date }
export type Measure = 'active' | 'female' | 'male' | 'other' | 'new' | 'resolved' | 'seen' | 'overdue' | 'controlled' | 'notControlled' | 'noReading';
export type BpState = 'controlled' | 'notControlled' | 'noReading';

const since = (c: Ctx, days: number) => c.now.getTime() - days * DAY_MS;
export const isSeen = (r: PatientCondition, c: Ctx) => !!r.lastVisit && r.lastVisit.getTime() >= since(c, SEEN_DAYS);
// Only hypertension has a control rule today: the latest reading, if taken in the last 90 days, against 140/90.
export function bpState(r: PatientCondition, c: Ctx): BpState | null {
  if (r.key !== 'hypertension') return null;
  if (!r.bpAt || r.sys === null || r.dia === null || r.bpAt.getTime() < since(c, BP_LIMITS.recentDays)) return 'noReading';
  return r.sys < BP_LIMITS.systolic && r.dia < BP_LIMITS.diastolic ? 'controlled' : 'notControlled';
}
const inPeriod = (d: Date | null, c: Ctx) => !c.period.from || (!!d && d >= c.period.from && d < c.period.to!);

export const MEASURES: Record<Measure, (r: PatientCondition, c: Ctx) => boolean> = {
  active: r => r.active,
  female: r => r.active && r.gender === 'FEMALE',
  male: r => r.active && r.gender === 'MALE',
  other: r => r.active && r.gender !== 'FEMALE' && r.gender !== 'MALE',
  new: (r, c) => inPeriod(r.firstRecorded, c),
  resolved: (r, c) => !r.active && inPeriod(r.resolvedAt, c),
  seen: (r, c) => r.active && isSeen(r, c),
  overdue: (r, c) => r.active && !isSeen(r, c),
  controlled: (r, c) => r.active && bpState(r, c) === 'controlled',
  notControlled: (r, c) => r.active && bpState(r, c) === 'notControlled',
  noReading: (r, c) => r.active && bpState(r, c) === 'noReading',
};
export const MEASURE_NAMES = Object.keys(MEASURES) as Measure[];
export const MEASURE_LABEL: Record<Measure, string> = {
  active: 'Active', female: 'Active female', male: 'Active male', other: 'Active other', new: 'New in the period', resolved: 'Resolved in the period',
  seen: `Seen in the last ${SEEN_DAYS} days`, overdue: `Overdue (not seen in ${SEEN_DAYS} days)`, controlled: `Blood pressure under ${BP_LIMITS.systolic}/${BP_LIMITS.diastolic}`,
  notControlled: `Blood pressure ${BP_LIMITS.systolic}/${BP_LIMITS.diastolic} or higher`, noReading: `No blood pressure in ${BP_LIMITS.recentDays} days`,
};

// Days since the last visit, rounded down; null when there has been none.
export const daysSince = (r: PatientCondition, c: Ctx) => (r.lastVisit ? Math.max(0, Math.floor((c.now.getTime() - r.lastVisit.getTime()) / DAY_MS)) : null);
export const OVERDUE_BUCKETS = [
  { key: 'b120', label: '91 to 120 days', max: 120 }, { key: 'b180', label: '121 to 180 days', max: 180 }, { key: 'b365', label: '181 to 365 days', max: 365 }, { key: 'over', label: 'Over a year', max: Infinity },
] as const;
export const bucketOf = (days: number) => OVERDUE_BUCKETS.find(b => days <= b.max)!;

// ── Counts per condition ────────────────────────────────────────────────────
export interface Counts {
  key: string; label: string; active: number; female: number; male: number; other: number; new: number; resolved: number; seen: number; overdue: number;
  controlled: number; notControlled: number; noReading: number; booked: number; never: number; b120: number; b180: number; b365: number; over: number;
}
export function countsFor(conditions: Condition[], rows: PatientCondition[], c: Ctx): Counts[] {
  return conditions.map(cond => {
    const mine = rows.filter(r => r.key === cond.key), n = (m: Measure) => mine.filter(r => MEASURES[m](r, c)).length;
    const late = mine.filter(r => MEASURES.overdue(r, c));
    const inBucket = (key: string) => late.filter(r => r.lastVisit && bucketOf(daysSince(r, c)!).key === key).length;
    return {
      key: cond.key, label: cond.label, active: n('active'), female: n('female'), male: n('male'), other: n('other'), new: n('new'), resolved: n('resolved'), seen: n('seen'), overdue: late.length,
      controlled: n('controlled'), notControlled: n('notControlled'), noReading: n('noReading'),
      booked: late.filter(r => r.nextAppointment).length, never: late.filter(r => !r.lastVisit).length,
      b120: inBucket('b120'), b180: inBucket('b180'), b365: inBucket('b365'), over: inBucket('over'),
    };
  });
}
export function patientTotals(rows: PatientCondition[]) {
  const per = new Map<string, number>();
  for (const r of rows) if (r.active) per.set(r.patientId, (per.get(r.patientId) ?? 0) + 1);
  return { patientsWithAny: per.size, patientsWithSeveral: [...per.values()].filter(n => n > 1).length };
}

// ── The summary the Reports overview and its export use ─────────────────────
export interface ChronicRow {
  key: string; label: string; active: number; newInPeriod: number;
  female: number; male: number; other: number; under18: number; adults: number; older: number;
  seenRecently: number; notSeenRecently: number;
  bpControl: { controlled: number; notControlled: number; noRecentReading: number } | null;
}
export interface ChronicSummary {
  rows: ChronicRow[]; patientsWithAny: number; patientsWithSeveral: number; seenDays: number; bp: typeof BP_LIMITS;
  reviewed: { done: number; total: number };   // conditions a clinical lead has confirmed, of those in use
}

export async function chronicSummary(period: Period, now = new Date()): Promise<ChronicSummary> {
  const conditions = await loadConditions(), data = await loadPatientConditions(conditions), c: Ctx = { period, now };
  const rows = countsFor(conditions, data, c).map((k): ChronicRow => {
    const active = data.filter(r => r.key === k.key && r.active);
    return {
      key: k.key, label: k.label, active: k.active, newInPeriod: k.new, female: k.female, male: k.male, other: k.other,
      under18: active.filter(r => r.age < 18).length, adults: active.filter(r => r.age >= 18 && r.age < 65).length, older: active.filter(r => r.age >= 65).length,
      seenRecently: k.seen, notSeenRecently: k.overdue,
      bpControl: k.key === 'hypertension' ? { controlled: k.controlled, notControlled: k.notControlled, noRecentReading: k.noReading } : null,
    };
  });
  return { rows, ...patientTotals(data), seenDays: SEEN_DAYS, bp: BP_LIMITS, reviewed: { done: conditions.filter(x => x.reviewedAt).length, total: conditions.length } };
}
