import { Prisma } from '@prisma/client';
import prisma from './prisma';
import type { Report } from '../controllers/billingReports.controller';
import { within, sqlWithin, type Period } from './reportPeriod';
import { chronicSummary, type ChronicRow, type ChronicSummary } from './chronic';

export { parsePeriod, type Period } from './reportPeriod';
export { chronicSummary, type ChronicRow, type ChronicSummary };

// Population figures for the Reports page and its Excel export. Aggregates only: no patient is ever named here.

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
