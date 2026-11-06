import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { parsePeriod, type Period } from './reportPeriod';
import { userNames } from './billingOps';
import type { Report } from '../controllers/billingReports.controller';

// Attendance: who came, when, to which service point, new or returning. The aggregate and the line list are built from the same
// rows, so every number can be traced to the records behind it.

export const ATTENDANCE_DEFINITIONS = [
  'Attendance: one check-in at a service point in the period. A check-in taken off the queue without the patient being seen is not counted.',
  'New attendance: the patient\'s first visit to this facility, with no earlier check-in and no earlier consultation on record. To be confirmed against the HIA2 definition.',
  'Re-attendance: any later visit.',
  'Age: completed years on the day of the check-in. The age bands are placeholders until the HIA2 template is confirmed.',
  'Service point: the room the patient was assigned to at that check-in (the last one, if they were moved).',
  'Primary diagnosis (line list): from the patient\'s first consultation on or after the check-in and before their next check-in, within one day.',
  'Patient ID is a short code taken from the patient\'s record; it is not a sequence number. A line list shows the patient ID and a masked NRC unless a clinical role asks for names.',
  'A line list shows the newest 5,000 attendances; the counts always cover all of them.',
];

export const AGE_BANDS = [
  { key: 'u1', label: 'Under 1', max: 0 }, { key: '1-4', label: '1 to 4', max: 4 }, { key: '5-14', label: '5 to 14', max: 14 },
  { key: '15-24', label: '15 to 24', max: 24 }, { key: '25-49', label: '25 to 49', max: 49 }, { key: '50plus', label: '50 and over', max: Infinity },
] as const;
export const bandOf = (age: number) => AGE_BANDS.find(b => Math.max(0, age) <= b.max)!;   // a date of birth in the future counts as under 1

export const LINE_LIMIT = 5000;
const SEXES = ['MALE', 'FEMALE', 'OTHER'] as const;
const GROUPS = ['period', 'day', 'week', 'month'] as const;
type Group = (typeof GROUPS)[number];

interface Filters { period: Period; servicePoint?: string; sex?: string; ageBand?: string; groupBy: Group; visit?: 'new' | 're' }
interface Row { id: string; at: Date; patientId: string; roomId: string; room: string; startedById: string | null; gender: string; age: number; isNew: boolean }

function parseFilters(q: Record<string, unknown>): Filters | { error: string } {
  const period = parsePeriod(q);
  if ('error' in period) return period;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const sex = text(q['sex']), ageBand = text(q['ageBand']), groupBy = text(q['groupBy']) ?? 'period', visit = text(q['visit']), servicePoint = text(q['servicePoint']);
  if (sex && !(SEXES as readonly string[]).includes(sex)) return { error: 'Choose male, female or other for the sex filter.' };
  if (ageBand && !AGE_BANDS.some(b => b.key === ageBand)) return { error: 'Choose one of the age bands listed.' };
  if (!(GROUPS as readonly string[]).includes(groupBy)) return { error: 'Group by day, week, month or the whole period.' };
  if (visit && visit !== 'new' && visit !== 're') return { error: 'Choose new attendance or re-attendance.' };
  if (servicePoint && !/^[0-9a-f-]{36}$/i.test(servicePoint)) return { error: 'Choose a service point from the list.' };
  return { period, servicePoint, sex, ageBand, groupBy: groupBy as Group, visit: visit as Filters['visit'] };
}

// Every counted check-in in the period, with whether it was the patient's first visit ever. History is looked at in full, not only the period.
async function loadRows(p: Period): Promise<Row[]> {
  const within = p.from && p.to ? Prisma.sql`AND q."checkedInAt" >= ${p.from} AND q."checkedInAt" < ${p.to}` : Prisma.empty;
  return prisma.$queryRaw<Row[]>`
    SELECT q.id, q."checkedInAt" AS at, q."patientId", q."roomId", r.name AS room, q."startedById", pt.gender::text AS gender,
      date_part('year', age(q."checkedInAt"::date, pt."dateOfBirth"::date))::int AS age,
      (NOT EXISTS (SELECT 1 FROM "QueueEntry" e WHERE e."patientId" = q."patientId" AND e.status <> 'Removed'
                     AND (e."checkedInAt" < q."checkedInAt" OR (e."checkedInAt" = q."checkedInAt" AND e.id < q.id)))
       AND NOT EXISTS (SELECT 1 FROM "Encounter" en WHERE en."patientId" = q."patientId" AND en."createdAt" < q."checkedInAt")) AS "isNew"
    FROM "QueueEntry" q
    JOIN "Patient" pt ON pt.id = q."patientId"
    JOIN "FacilityRoom" r ON r.id = q."roomId"
    WHERE q.status <> 'Removed' ${within}
    ORDER BY q."checkedInAt", q.id`;
}

const keep = (rows: Row[], f: Filters, withVisit: boolean) => rows.filter(r =>
  (!f.servicePoint || r.roomId === f.servicePoint) && (!f.sex || r.gender === f.sex) && (!f.ageBand || bandOf(r.age).key === f.ageBand) &&
  (!withVisit || !f.visit || (f.visit === 'new') === r.isNew));

// ── Grouping by day, week or month ──────────────────────────────────────────
const dayText = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const show = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
function bucket(d: Date, by: Exclude<Group, 'period'>): { key: string; label: string; start: Date; end: Date } {
  if (by === 'day') { const s = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return { key: dayText(s), label: show(s), start: s, end: s }; }
  if (by === 'month') {
    const s = new Date(d.getFullYear(), d.getMonth(), 1), e = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { key: dayText(s), label: s.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), start: s, end: e };
  }
  const back = (d.getDay() + 6) % 7, s = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back), e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6);
  return { key: dayText(s), label: `Week of ${show(s)}`, start: s, end: e };
}

// ── Aggregate ───────────────────────────────────────────────────────────────
type Counts = { newMale: number; newFemale: number; newOther: number; reMale: number; reFemale: number; reOther: number };
const blank = (): Counts => ({ newMale: 0, newFemale: 0, newOther: 0, reMale: 0, reFemale: 0, reOther: 0 });
const addTo = (c: Counts, r: Row) => { const k = `${r.isNew ? 'new' : 're'}${r.gender === 'MALE' ? 'Male' : r.gender === 'FEMALE' ? 'Female' : 'Other'}` as keyof Counts; c[k]++; };
const finish = (c: Counts) => ({ ...c, newTotal: c.newMale + c.newFemale + c.newOther, reTotal: c.reMale + c.reFemale + c.reOther, all: c.newMale + c.newFemale + c.newOther + c.reMale + c.reFemale + c.reOther });

export async function attendanceReport(q: Record<string, unknown>): Promise<Report | { error: string }> {
  const f = parseFilters(q);
  if ('error' in f) return f;
  const rows = keep(await loadRows(f.period), f, false);   // the new/re split is in the columns, so the visit filter does not apply here

  const groups = new Map<string, { key: string; label: string; from?: string; to?: string; counts: Counts }>();
  if (f.groupBy === 'period') for (const b of AGE_BANDS) groups.set(b.key, { key: b.key, label: b.label, counts: blank() });
  for (const r of rows) {
    if (f.groupBy === 'period') { addTo(groups.get(bandOf(r.age).key)!.counts, r); continue; }
    const b = bucket(r.at, f.groupBy);
    const g = groups.get(b.key) ?? { key: b.key, label: b.label, from: dayText(b.start), to: dayText(b.end), counts: blank() };
    if (f.period.fromDay && g.from! < f.period.fromDay) g.from = f.period.fromDay;   // a week or month cut by the period only reaches as far as the period does
    if (f.period.toDay && g.to! > f.period.toDay) g.to = f.period.toDay;
    addTo(g.counts, r); groups.set(b.key, g);
  }
  const ordered = [...groups.values()].sort((a, b) => (f.groupBy === 'period' ? 0 : a.key.localeCompare(b.key)));
  const body = ordered.map(g => ({ label: g.label, key: g.key, from: g.from, to: g.to, ...finish(g.counts) }));
  const total = finish(rows.reduce((c, r) => { addTo(c, r); return c; }, blank()));
  const anyOther = total.newOther + total.reOther > 0;   // the Other columns appear only when someone is counted there, so the row totals always add up

  const col = (key: string, header: string, width = 13) => ({ key, header, type: 'int' as const, width });
  const first = f.groupBy === 'period' ? 'Age band' : f.groupBy === 'day' ? 'Day' : f.groupBy === 'week' ? 'Week' : 'Month';
  const filterText = [f.servicePoint && 'one service point', f.sex && `sex ${f.sex.toLowerCase()}`, f.ageBand && `age ${AGE_BANDS.find(b => b.key === f.ageBand)!.label}`].filter(Boolean).join(', ');
  return {
    name: 'attendance', title: f.groupBy === 'period' ? 'Attendance by age and sex' : `Attendance by ${f.groupBy}`, period: filterText ? `${f.period.label} · ${filterText}` : f.period.label,
    columns: [
      { key: 'label', header: first, type: 'text', width: 26 },
      col('newMale', 'New male'), col('newFemale', 'New female'), ...(anyOther ? [col('newOther', 'New other')] : []), col('newTotal', 'New total'),
      col('reMale', 'Re-attendance male', 18), col('reFemale', 'Re-attendance female', 18), ...(anyOther ? [col('reOther', 'Re-attendance other', 18)] : []), col('reTotal', 'Re-attendance total', 18),
      col('all', 'All attendances', 16),
    ],
    rows: body,
    totals: { label: f.groupBy === 'period' ? 'All ages' : 'All', ...total },
    summary: [
      { label: 'Attendances', value: total.all }, { label: 'New attendance', value: total.newTotal }, { label: 'Re-attendance', value: total.reTotal },
      { label: 'New share (%)', value: total.all ? Math.round((total.newTotal / total.all) * 100) : 0 },
    ],
  };
}

// ── Line list ───────────────────────────────────────────────────────────────
const SEX_LABEL: Record<string, string> = { MALE: 'Male', FEMALE: 'Female', OTHER: 'Other' };
export const patientCode = (id: string) => 'SES-' + id.replace(/-/g, '').slice(0, 8).toUpperCase();
export const maskNrc = (nrc: string | null | undefined) => (nrc ? nrc.replace(/[A-Za-z0-9]/g, (c, i, all) => (i === all.length - 1 ? c : '•')) : '');   // every character but the last, separators kept

export async function attendanceLines(q: Record<string, unknown>, options: { names: boolean }): Promise<Report | { error: string }> {
  const f = parseFilters(q);
  if ('error' in f) return f;
  const all = keep(await loadRows(f.period), f, true).sort((a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id));
  const rows = all.slice(0, LINE_LIMIT);

  const detail = rows.length === 0 ? [] : await prisma.$queryRaw<{ id: string; firstName: string; lastName: string; nationalId: string | null; clinicianId: string | null; diagnosis: string | null }[]>`
    SELECT q.id, pt."firstName", pt."lastName", pt."nationalId", enc."clinicianId", dx.description AS diagnosis
    FROM "QueueEntry" q
    JOIN "Patient" pt ON pt.id = q."patientId"
    LEFT JOIN LATERAL (
      SELECT en.id, en."clinicianId" FROM "Encounter" en
      WHERE en."patientId" = q."patientId" AND en."createdAt" >= q."checkedInAt" AND en."createdAt" < q."checkedInAt" + interval '1 day'
        AND NOT EXISTS (SELECT 1 FROM "QueueEntry" n WHERE n."patientId" = q."patientId" AND n.status <> 'Removed' AND n."checkedInAt" > q."checkedInAt" AND n."checkedInAt" <= en."createdAt")
      ORDER BY en."createdAt" LIMIT 1
    ) enc ON TRUE
    LEFT JOIN LATERAL (
      SELECT c.description FROM "EncounterDiagnosis" d JOIN "ICD11Code" c ON c.id = d."icd11Id" WHERE d."encounterId" = enc.id ORDER BY d."isPrimary" DESC, d.id LIMIT 1
    ) dx ON TRUE
    WHERE q.id IN (${Prisma.join(rows.map(r => r.id))})`;
  const byId = new Map(detail.map(d => [d.id, d]));
  const staff = await userNames([...rows.map(r => r.startedById), ...detail.map(d => d.clinicianId)]);

  const out = rows.map(r => {
    const d = byId.get(r.id);
    return {
      time: r.at, patientCode: patientCode(r.patientId), name: options.names ? `${d?.firstName ?? ''} ${d?.lastName ?? ''}`.trim() : '',
      nrc: options.names ? d?.nationalId ?? '' : maskNrc(d?.nationalId), sex: SEX_LABEL[r.gender] ?? r.gender, age: Math.max(0, r.age),
      visit: r.isNew ? 'New attendance' : 'Re-attendance', servicePoint: r.room, clinician: staff[r.startedById ?? ''] ?? staff[d?.clinicianId ?? ''] ?? '', diagnosis: d?.diagnosis ?? '',
    };
  });
  const text = (key: string, header: string, width: number) => ({ key, header, type: 'text' as const, width });
  return {
    name: 'attendance-lines', title: 'Attendance line list', period: f.period.label,
    columns: [
      { key: 'time', header: 'Date and time', type: 'date', width: 18 }, text('patientCode', 'Patient ID', 16), ...(options.names ? [text('name', 'Name', 26)] : []),
      text('nrc', options.names ? 'NRC' : 'NRC (masked)', 16), text('sex', 'Sex', 9), { key: 'age', header: 'Age', type: 'int' as const, width: 7 },
      text('visit', 'New or re-attendance', 20), text('servicePoint', 'Service point', 22), text('clinician', 'Seen by', 22), text('diagnosis', 'Primary diagnosis', 40),
    ],
    rows: out, totals: null,
    summary: [{ label: 'Attendances', value: all.length }, ...(all.length > rows.length ? [{ label: `Not shown (the list holds the newest ${LINE_LIMIT})`, value: all.length - rows.length }] : [])],
  };
}
