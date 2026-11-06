import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { parsePeriod, type Period } from './reportPeriod';
import { patientCode, maskNrc, LINE_LIMIT } from './attendanceReports';
import {
  BP_LIMITS, MEASURES, MEASURE_LABEL, MEASURE_NAMES, OVERDUE_BUCKETS, SEEN_DAYS, bpState, countsFor, daysSince, isSeen, loadConditions, loadPatientConditions, patientTotals,
  type BpState, type Condition, type Counts, type Ctx, type Measure, type PatientCondition,
} from './chronic';
import type { Report } from '../controllers/billingReports.controller';

// The chronic disease register (counts per condition, and the patients behind them) and the overdue and defaulters list (who has not been
// seen in 90 days). Both read the one set of rows and measures in lib/chronic.ts.

export const CHRONIC_DEFINITIONS = [
  'Active: a patient with at least one diagnosis for the condition that has not been resolved. A diagnosis belongs to a condition when its ICD-11 code starts with one of the condition\'s listed prefixes. Diagnoses entered without an ICD-11 code are not matched.',
  'New in the period: the condition was first recorded for the patient in the period. Resolved: every diagnosis for the condition is resolved, the last of them in the period.',
  `Seen: any visit in the last ${SEEN_DAYS} days, as of today: a queue check-in that was not removed, or a consultation. Overdue: active and not seen in ${SEEN_DAYS} days, or no visit on record at all.`,
  `Blood pressure (hypertension only): the patient's latest reading, if taken in the last ${BP_LIMITS.recentDays} days, is under ${BP_LIMITS.systolic}/${BP_LIMITS.diastolic}, or ${BP_LIMITS.systolic}/${BP_LIMITS.diastolic} or higher; otherwise no recent reading. No control rule is defined yet for the other conditions.`,
  'A patient with more than one condition appears in each of their conditions, so the rows add up to more than the number of patients.',
  'Current medicines are those on the patient\'s record that have started and not ended. Next appointment is the earliest scheduled or confirmed one from now on.',
  'Patient ID is a short code from the patient\'s record. A line list shows it and a masked NRC unless a clinical role asks for names. It lists the newest 5,000.',
];

interface Query { period: Period; condition?: string; measure?: Measure; status: 'active' | 'resolved' | 'any'; seen?: 'seen' | 'overdue'; control?: BpState }
function parse(q: Record<string, unknown>, conditions: Condition[]): Query | { error: string } {
  const period = parsePeriod(q);
  if ('error' in period) return period;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const condition = text(q['condition']), measure = text(q['measure']), status = text(q['status']) ?? 'active', seen = text(q['seen']), control = text(q['control']);
  if (condition && !conditions.some(c => c.key === condition)) return { error: 'Choose a condition from the list.' };
  if (measure && !(MEASURE_NAMES as string[]).includes(measure)) return { error: 'Unknown measure.' };
  if (!['active', 'resolved', 'any'].includes(status)) return { error: 'Choose active, resolved or any status.' };
  if (seen && seen !== 'seen' && seen !== 'overdue') return { error: 'Choose seen or overdue.' };
  if (control && !['controlled', 'notControlled', 'noReading'].includes(control)) return { error: 'Choose a blood pressure group from the list.' };
  return { period, condition, measure: measure as Measure | undefined, status: status as Query['status'], seen: seen as Query['seen'], control: control as BpState | undefined };
}

const base = async (q: Record<string, unknown>) => {
  const conditions = await loadConditions(), parsed = parse(q, conditions);
  if ('error' in parsed) return parsed;
  const shown = parsed.condition ? conditions.filter(c => c.key === parsed.condition) : conditions;
  return { q: parsed, conditions, shown, rows: await loadPatientConditions(shown), ctx: { period: parsed.period, now: new Date() } as Ctx };
};
const col = (key: string, header: string, width = 13) => ({ key, header, type: 'int' as const, width });
const sumOf = (counts: Counts[], k: keyof Counts) => counts.reduce((s, c) => s + (c[k] as number), 0);
const total = (counts: Counts[], keys: (keyof Counts)[], label: string) => ({ label, ...Object.fromEntries(keys.map(k => [k, sumOf(counts, k)])) });
const filterText = (q: Query, conditions: Condition[]) => (q.condition ? conditions.find(c => c.key === q.condition)?.label : '') ?? '';

// ── Register ────────────────────────────────────────────────────────────────
export async function chronicRegister(query: Record<string, unknown>): Promise<Report | { error: string }> {
  const b = await base(query);
  if ('error' in b) return b;
  const counts = countsFor(b.shown, b.rows, b.ctx), { patientsWithAny, patientsWithSeveral } = patientTotals(b.rows);
  const hasOther = sumOf(counts, 'other') > 0;
  const keys = ['active', 'female', 'male', ...(hasOther ? ['other'] : []), 'new', 'resolved', 'seen', 'overdue', 'controlled', 'notControlled', 'noReading'] as (keyof Counts)[];
  const heads: Record<string, string> = { active: 'Active', female: 'Female', male: 'Male', other: 'Other', new: b.q.period.from ? 'New in period' : 'Recorded', resolved: 'Resolved', seen: `Seen in ${SEEN_DAYS} days`, overdue: 'Overdue', controlled: `BP under ${BP_LIMITS.systolic}/${BP_LIMITS.diastolic}`, notControlled: `BP ${BP_LIMITS.systolic}/${BP_LIMITS.diastolic} or higher`, noReading: 'No recent BP' };
  return {
    name: 'chronic-register', title: 'Chronic disease register', period: [b.q.period.label, filterText(b.q, b.conditions)].filter(Boolean).join(' · '),
    columns: [{ key: 'label', header: 'Condition', type: 'text', width: 38 }, ...keys.map(k => col(k, heads[k]!, k === 'notControlled' ? 18 : 14))],
    rows: counts.map(c => ({ ...c })), totals: total(counts, keys, 'All conditions'),
    summary: [
      { label: 'Patients with an active chronic condition', value: patientsWithAny }, { label: 'Patients with more than one', value: patientsWithSeveral },
      { label: `Seen in the last ${SEEN_DAYS} days (all conditions)`, value: sumOf(counts, 'seen') }, { label: 'Overdue (all conditions)', value: sumOf(counts, 'overdue') },
    ],
  };
}

// ── Overdue and defaulters ──────────────────────────────────────────────────
export async function chronicOverdue(query: Record<string, unknown>): Promise<Report | { error: string }> {
  const b = await base(query);
  if ('error' in b) return b;
  const counts = countsFor(b.shown, b.rows, b.ctx), keys: (keyof Counts)[] = ['active', 'overdue', 'booked', 'b120', 'b180', 'b365', 'over', 'never'];
  const late = sumOf(counts, 'overdue'), active = sumOf(counts, 'active');
  return {
    name: 'chronic-overdue', title: 'Overdue and defaulters', period: ['As at today', filterText(b.q, b.conditions)].filter(Boolean).join(' · '),
    columns: [
      { key: 'label', header: 'Condition', type: 'text', width: 38 }, col('active', 'Active'), col('overdue', `Not seen in ${SEEN_DAYS} days`, 20), col('booked', 'Appointment booked', 20),
      ...OVERDUE_BUCKETS.map(x => col(x.key, x.label, 17)), col('never', 'No visit on record', 18),
    ],
    rows: counts.map(c => ({ ...c })), totals: total(counts, keys, 'All conditions'),
    summary: [{ label: 'Active patient-conditions', value: active }, { label: 'Overdue', value: late }, { label: 'Overdue (%)', value: active ? Math.round((late / active) * 100) : 0 }, { label: 'Overdue with an appointment booked', value: sumOf(counts, 'booked') }],
  };
}

// ── Line list ───────────────────────────────────────────────────────────────
const day = (d: Date | null) => (d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
function bpText(r: PatientCondition, c: Ctx): string {
  if (r.key !== 'hypertension') return '';
  if (r.sys === null || r.dia === null || !r.bpAt) return 'No reading on record';
  const reading = `${r.sys}/${r.dia}`;
  const state = bpState(r, c);
  return state === 'noReading' ? `${reading}, taken ${day(r.bpAt)} (over ${BP_LIMITS.recentDays} days ago)` : `${reading} ${state === 'controlled' ? 'under' : 'at or above'} ${BP_LIMITS.systolic}/${BP_LIMITS.diastolic}`;
}

export async function chronicLines(view: 'register' | 'overdue', query: Record<string, unknown>, options: { names: boolean }): Promise<Report | { error: string }> {
  const b = await base(query);
  if ('error' in b) return b;
  const { q, ctx } = b, measure: Measure | undefined = view === 'overdue' ? 'overdue' : q.measure;
  const order = new Map(b.shown.map((c, i) => [c.key, i]));
  const all = b.rows.filter(r =>
    (measure ? MEASURES[measure](r, ctx) : q.status === 'any' || (q.status === 'active') === r.active) &&
    (!q.seen || (r.active && isSeen(r, ctx) === (q.seen === 'seen'))) && (!q.control || bpState(r, ctx) === q.control),
  ).sort((x, y) => view === 'overdue'
    ? (daysSince(y, ctx) ?? Infinity) - (daysSince(x, ctx) ?? Infinity) || order.get(x.key)! - order.get(y.key)!
    : order.get(x.key)! - order.get(y.key)! || (daysSince(y, ctx) ?? Infinity) - (daysSince(x, ctx) ?? Infinity));
  const rows = all.slice(0, LINE_LIMIT), ids = [...new Set(rows.map(r => r.patientId))];

  const detail = ids.length === 0 ? [] : await prisma.$queryRaw<{ id: string; firstName: string; lastName: string; nationalId: string | null; meds: string | null }[]>`
    SELECT p.id, p."firstName", p."lastName", p."nationalId",
      (SELECT string_agg(m.name || COALESCE(' ' || m.dosage, ''), '; ' ORDER BY m.name) FROM "Medication" m
        WHERE m."patientId" = p.id AND m."startDate" <= (now() AT TIME ZONE 'UTC') AND (m."endDate" IS NULL OR m."endDate" >= (now() AT TIME ZONE 'UTC')::date)) AS meds
    FROM "Patient" p WHERE p.id IN (${Prisma.join(ids)})`;
  const byId = new Map(detail.map(d => [d.id, d])), label = new Map(b.conditions.map(c => [c.key, c.label]));
  const out = rows.map(r => {
    const d = byId.get(r.patientId), days = daysSince(r, ctx);
    return {
      patientCode: patientCode(r.patientId), name: options.names ? `${d?.firstName ?? ''} ${d?.lastName ?? ''}`.trim() : '',
      nrc: options.names ? d?.nationalId ?? '' : maskNrc(d?.nationalId), sex: r.gender === 'FEMALE' ? 'Female' : r.gender === 'MALE' ? 'Male' : 'Other', age: Math.max(0, r.age),
      condition: label.get(r.key) ?? r.key, status: r.active ? 'Active' : 'Resolved', diagnosed: String((r.diagnosedAt ?? r.firstRecorded).getFullYear()),
      lastVisit: r.lastVisit ? day(r.lastVisit) : 'No visit on record', daysSince: days, lastBp: bpText(r, ctx), medicines: d?.meds ?? '',
      followUp: !r.active ? '' : isSeen(r, ctx) ? 'Seen' : 'Overdue', nextAppointment: r.nextAppointment ? day(r.nextAppointment) : r.active ? 'None booked' : '',
    };
  });
  const text = (key: string, header: string, width: number) => ({ key, header, type: 'text' as const, width });
  const title = view === 'overdue' ? 'Overdue and defaulters line list' : 'Chronic disease register line list';
  return {
    name: view === 'overdue' ? 'chronic-overdue-lines' : 'chronic-register-lines', title, period: [view === 'overdue' ? 'As at today' : q.period.label, measure ? MEASURE_LABEL[measure] : ''].filter(Boolean).join(' · '),
    columns: [
      text('patientCode', 'Patient ID', 16), ...(options.names ? [text('name', 'Name', 26)] : []), text('nrc', options.names ? 'NRC' : 'NRC (masked)', 16), text('sex', 'Sex', 9), { key: 'age', header: 'Age', type: 'int' as const, width: 7 },
      text('condition', 'Condition', 30), text('status', 'Status', 10), text('diagnosed', 'Diagnosed', 11), text('lastVisit', 'Last visit', 18), { key: 'daysSince', header: 'Days since', type: 'int' as const, width: 11 },
      text('lastBp', 'Last blood pressure', 34), text('medicines', 'Current medicines', 44), text('followUp', 'Follow-up', 11), text('nextAppointment', 'Next appointment', 17),
    ],
    rows: out, totals: null,
    summary: [{ label: view === 'overdue' ? 'Overdue patient-conditions' : 'Patient-conditions', value: all.length }, ...(all.length > rows.length ? [{ label: `Not shown (the list holds the first ${LINE_LIMIT})`, value: all.length - rows.length }] : [])],
  };
}
