import prisma from './prisma';
import { parsePeriod, sqlWithin, type Period } from './reportPeriod';
import { AGE_BANDS, bandOf, patientCode, maskNrc, LINE_LIMIT } from './attendanceReports';
import { userNames } from './billingOps';
import type { Report } from '../controllers/billingReports.controller';

// OPD diagnoses: the ICD-11 diagnoses recorded on consultations in the period, how often, for how many patients, as the main diagnosis or not, by sex.
// Every number opens the consultations behind it.

export const DIAGNOSIS_DEFINITIONS = [
  'A diagnosis is one ICD-11 code recorded on a consultation, counted on the day of the consultation. A consultation with two diagnoses counts under each.',
  'Consultations: how many consultations recorded the code. Patients: how many different patients they were for. Main diagnosis: how many recorded it as the primary diagnosis.',
  'Age is in completed years on the day of the consultation, in the same bands as the Attendance report. Sex is as recorded on the patient.',
  'Diagnoses on the patient\'s problem list that were not recorded on a consultation are not counted here; the chronic disease reports use the problem list.',
  `A line list shows at most ${LINE_LIMIT.toLocaleString()} consultations, newest first; the counts always cover all of them. It shows a patient ID and a masked NRC unless a clinical role asks for names.`,
];

const SEXES = ['MALE', 'FEMALE', 'OTHER'] as const;
interface Filters { period: Period; code?: string; sex?: string; ageBand?: string; mainOnly: boolean }
interface Row { id: string; encounterId: string; at: Date; patientId: string; clinicianId: string; code: string; description: string; isPrimary: boolean; gender: string; age: number }

function parse(q: Record<string, unknown>): Filters | { error: string } {
  const period = parsePeriod(q);
  if ('error' in period) return period;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const code = text(q['code']), sex = text(q['sex']), ageBand = text(q['ageBand']), main = text(q['main']);
  if (code && !/^[A-Z0-9][A-Z0-9.&/-]{0,30}$/i.test(code)) return { error: 'Choose an ICD-11 code from the list.' };
  if (sex && !(SEXES as readonly string[]).includes(sex)) return { error: 'Choose male, female or other for the sex filter.' };
  if (ageBand && !AGE_BANDS.some(b => b.key === ageBand)) return { error: 'Choose one of the age bands listed.' };
  if (main && main !== 'yes') return { error: 'The main diagnosis filter is yes or left out.' };
  return { period, code, sex, ageBand, mainOnly: main === 'yes' };
}

const load = (p: Period) => prisma.$queryRaw<Row[]>`
  SELECT d.id, e.id AS "encounterId", e."createdAt" AS at, e."patientId", e."clinicianId", c.code, c.description, d."isPrimary",
    pt.gender::text AS gender, date_part('year', age(e."createdAt"::date, pt."dateOfBirth"::date))::int AS age
  FROM "EncounterDiagnosis" d
  JOIN "Encounter" e ON e.id = d."encounterId"
  JOIN "ICD11Code" c ON c.id = d."icd11Id"
  JOIN "Patient" pt ON pt.id = e."patientId"
  WHERE TRUE ${sqlWithin('e."createdAt"', p)}
  ORDER BY e."createdAt", d.id`;

// One row per consultation and code: a code recorded twice on one consultation counts once, as the main diagnosis if either entry was.
function unique(rows: Row[]): Row[] {
  const by = new Map<string, Row>();
  for (const r of rows) { const k = r.encounterId + '|' + r.code, seen = by.get(k); if (!seen) by.set(k, r); else if (r.isPrimary && !seen.isPrimary) by.set(k, { ...seen, isPrimary: true }); }
  return [...by.values()];
}

const keep = (rows: Row[], f: Filters, withCode: boolean) => unique(rows).filter(r =>
  (!withCode || !f.code || r.code === f.code) && (!f.sex || r.gender === f.sex) && (!f.ageBand || bandOf(r.age).key === f.ageBand) && (!f.mainOnly || r.isPrimary));

export async function opdDiagnoses(q: Record<string, unknown>): Promise<Report | { error: string }> {
  const f = parse(q);
  if ('error' in f) return f;
  const rows = keep(await load(f.period), f, true);
  type Acc = { key: string; code: string; label: string; consultations: number; patients: Set<string>; main: number; female: number; male: number; other: number };
  const groups = new Map<string, Acc>();
  for (const r of rows) {
    const g = groups.get(r.code) ?? { key: r.code, code: r.code, label: r.description, consultations: 0, patients: new Set(), main: 0, female: 0, male: 0, other: 0 };
    g.consultations++; g.patients.add(r.patientId);
    if (r.isPrimary) g.main++;
    if (r.gender === 'FEMALE') g.female++; else if (r.gender === 'MALE') g.male++; else g.other++;
    groups.set(r.code, g);
  }
  const body = [...groups.values()].map(g => ({ key: g.key, code: g.code, label: g.label, consultations: g.consultations, patients: g.patients.size, main: g.main, female: g.female, male: g.male, other: g.other }))
    .sort((a, b) => b.consultations - a.consultations || a.code.localeCompare(b.code));
  const anyOther = body.some(r => r.other > 0);
  const int = (key: string, header: string, width = 13) => ({ key, header, type: 'int' as const, width });
  const consultations = new Set(rows.map(r => r.encounterId)).size, patients = new Set(rows.map(r => r.patientId)).size;
  const filterText = [f.sex && `sex ${f.sex.toLowerCase()}`, f.ageBand && `age ${AGE_BANDS.find(b => b.key === f.ageBand)!.label}`, f.mainOnly && 'main diagnoses only'].filter(Boolean).join(', ');
  return {
    name: 'opd-diagnoses', title: 'OPD diagnoses', period: filterText ? `${f.period.label} · ${filterText}` : f.period.label,
    columns: [
      { key: 'code', header: 'ICD-11 code', type: 'text', width: 12 }, { key: 'label', header: 'Diagnosis', type: 'text', width: 46 }, int('consultations', 'Consultations', 14), int('patients', 'Patients'),
      int('main', 'Main diagnosis', 15), int('female', 'Female'), int('male', 'Male'), ...(anyOther ? [int('other', 'Other')] : []),
    ],
    rows: body, totals: null,
    summary: [{ label: 'Diagnoses recorded', value: rows.length }, { label: 'Consultations with a diagnosis', value: consultations }, { label: 'Patients', value: patients }, { label: 'Different diagnoses', value: body.length }],
  };
}

export async function opdDiagnosisLines(q: Record<string, unknown>, options: { names: boolean }): Promise<Report | { error: string }> {
  const f = parse(q);
  if ('error' in f) return f;
  const all = keep(await load(f.period), f, true).sort((a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id));
  const rows = all.slice(0, LINE_LIMIT);
  const ids = [...new Set(rows.map(r => r.patientId))];
  const patients = ids.length ? await prisma.patient.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, nationalId: true } }) : [];
  const byId = new Map(patients.map(p => [p.id, p])), staff = await userNames(rows.map(r => r.clinicianId));
  const text = (key: string, header: string, width: number) => ({ key, header, type: 'text' as const, width });
  const SEX: Record<string, string> = { MALE: 'Male', FEMALE: 'Female', OTHER: 'Other' };
  return {
    name: 'opd-diagnoses-lines', title: 'OPD diagnoses line list', period: f.period.label,
    columns: [
      { key: 'at', header: 'Consultation', type: 'date', width: 18 }, text('patientCode', 'Patient ID', 16), ...(options.names ? [text('name', 'Name', 26)] : []), text('nrc', options.names ? 'NRC' : 'NRC (masked)', 16),
      text('sex', 'Sex', 9), { key: 'age', header: 'Age', type: 'int', width: 7 }, text('code', 'ICD-11 code', 12), text('diagnosis', 'Diagnosis', 40), text('main', 'Main diagnosis', 14), text('clinician', 'Clinician', 22),
    ],
    rows: rows.map(r => {
      const p = byId.get(r.patientId);
      return {
        at: r.at, patientCode: patientCode(r.patientId), name: options.names ? `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim() : '', nrc: options.names ? p?.nationalId ?? '' : maskNrc(p?.nationalId),
        sex: SEX[r.gender] ?? r.gender, age: Math.max(0, r.age), code: r.code, diagnosis: r.description, main: r.isPrimary ? 'Yes' : 'No', clinician: staff[r.clinicianId] ?? '',
      };
    }),
    totals: null,
    summary: [{ label: 'Diagnoses recorded', value: all.length }, ...(all.length > rows.length ? [{ label: `Not shown (the list holds the newest ${LINE_LIMIT})`, value: all.length - rows.length }] : [])],
  };
}
