import { loadRows, lineReport, bandOf, type Row } from './attendanceReports';
import { dayText, type Period } from './reportPeriod';
import type { Report } from '../controllers/billingReports.controller';

// The HIA2 monthly Service Delivery Reporting Form (version February 2023), section 6.1 Out patients (OPD): first attendances, revisits and total OPD
// attendances by age and sex, codes OPD1-005 to OPD1-165. The numbers are the attendances of the Attendance report for one calendar month, grouped the way
// the form groups them, so the two can never disagree. Every cell opens the attendances behind it.
// The other sections of the form (child health, vaccination, maternal and newborn care, family planning, HIV, GBV, malaria, inpatient care and cancer
// screening) need records SES does not keep and are not part of this return.

export const HIA2_DEFINITIONS = [
  'This is section 6.1 Out patients (OPD) of the HIA2 Service Delivery Reporting Form, version February 2023, for one calendar month. The other sections of the form are not recorded in SES and are not included.',
  'An OPD attendance is one check-in at a service point in the month. A check-in taken off the queue without the patient being seen is not counted.',
  'First attendance: the patient\'s first visit to this facility, with no earlier check-in and no earlier consultation on record. Revisit: any later visit. To be confirmed against the HIA2 definition of a first attendance.',
  'Age is in completed years on the day of the check-in, grouped as the form groups it: under 1 year, 1 to 4, 5 to 14 and 15 and over.',
  'Sex is as recorded on the patient. The form has Male and Female columns only: an attendance by a patient recorded as another sex is counted in the Total column and not in Male or Female, and the number is shown.',
  'Total OPD attendances is first attendances plus revisits. The Total row adds the four age groups.',
  'The facility name and district are not recorded in SES; write them on the form.',
];

const BANDS = [
  { key: 'u1', label: '<1 year' }, { key: '1-4', label: '1-4 years' }, { key: '5-14', label: '5-14 years' }, { key: '15plus', label: '15+ years' },
] as const;
type Band = (typeof BANDS)[number]['key'];
const bandOfAge = (age: number): Band => { const k = bandOf(age).key; return k === 'u1' || k === '1-4' || k === '5-14' ? k : '15plus'; };
const SEXES = [{ key: 'MALE', label: 'Male' }, { key: 'FEMALE', label: 'Female' }, { key: null, label: 'Total' }] as const;
type Sex = 'MALE' | 'FEMALE' | null;
const SECTIONS = [{ key: 'new', label: 'First attendances', first: 5 }, { key: 're', label: 'Revisits', first: 80 }, { key: 'all', label: 'Total OPD attendances', first: 155 }] as const;
type Visit = 'new' | 're' | 'all';

export interface Cell { code: string; section: string; visit: Visit; age: string; band: Band | null; sex: string; sexKey: Sex }
const code = (n: number) => 'OPD1-' + String(n).padStart(3, '0');

// Every cell of the form, in the order of the form. Within a section the age groups run down the page and Male, Female, Total across; the Total row
// is last. The codes are the form's own: first attendances start at 005, revisits at 080 and the total at 155, and each row takes three codes.
export const CELLS: Cell[] = SECTIONS.flatMap(section => {
  const rows = section.key === 'all' ? [{ key: null, label: 'Total' }] : [...BANDS, { key: null, label: 'Total' }];
  return rows.flatMap((row, i) => SEXES.map((sex, j) => ({
    code: code(section.first + 15 * (section.key === 'all' ? 0 : i) + 5 * j), section: section.label, visit: section.key as Visit,
    age: row.label, band: row.key as Band | null, sex: sex.label, sexKey: sex.key as Sex,
  })));
});
const byCode = new Map(CELLS.map(c => [c.code, c]));

// The month: YYYY-MM, a month that has started.
export function parseMonth(q: Record<string, unknown>, today = new Date()): { period: Period; title: string } | { error: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(typeof q['month'] === 'string' ? q['month'] : '');
  if (!m) return { error: 'Choose the month of the return.' };
  const year = Number(m[1]), month = Number(m[2]);
  if (month < 1 || month > 12 || year < 2000) return { error: 'Choose a real month.' };
  const start = new Date(year, month - 1, 1), end = new Date(year, month, 1);
  if (start > today) return { error: 'That month has not started yet.' };
  const title = start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return { title, period: { from: start, to: end, fromDay: dayText(start), toDay: dayText(new Date(year, month, 0)), label: title } };
}

// Whether an attendance belongs in a cell.
const inCell = (r: Row, c: Cell) => (c.visit === 'all' || (c.visit === 'new') === r.isNew) && (!c.band || bandOfAge(r.age) === c.band) && (!c.sexKey || r.gender === c.sexKey);

export async function hia2Opd(q: Record<string, unknown>): Promise<Report | { error: string }> {
  const month = parseMonth(q);
  if ('error' in month) return month;
  const rows = await loadRows(month.period);
  const rowsOut = CELLS.map(c => ({ code: c.code, section: c.section, age: c.age, sex: c.sex, value: rows.filter(r => inCell(r, c)).length }));
  const total = (visit: Visit) => rowsOut.find(r => r.code === CELLS.find(c => c.visit === visit && c.band === null && c.sexKey === null)!.code)!.value;
  const other = rows.filter(r => r.gender !== 'MALE' && r.gender !== 'FEMALE').length;
  return {
    name: 'hia2-opd', title: 'HIA2 OPD attendances (6.1)', period: month.title,
    columns: [
      { key: 'code', header: 'HIA2 code', type: 'text', width: 13 }, { key: 'section', header: 'Section', type: 'text', width: 24 }, { key: 'age', header: 'Age group', type: 'text', width: 14 },
      { key: 'sex', header: 'Sex', type: 'text', width: 10 }, { key: 'value', header: 'Value', type: 'int', width: 10 },
    ],
    rows: rowsOut, totals: null,
    summary: [
      { label: 'First attendances', value: total('new') }, { label: 'Revisits', value: total('re') }, { label: 'Total OPD attendances', value: total('all') },
      ...(other ? [{ label: 'Sex recorded as other (in the Total column only)', value: other }] : []),
    ],
  };
}

// The attendances behind one cell of the form, or behind every cell when no code is given.
export async function hia2OpdLines(q: Record<string, unknown>, options: { names: boolean }): Promise<Report | { error: string }> {
  const month = parseMonth(q);
  if ('error' in month) return month;
  const wanted = typeof q['code'] === 'string' && q['code'].trim() ? q['code'].trim() : undefined;
  const cell = wanted ? byCode.get(wanted) : undefined;
  if (wanted && !cell) return { error: 'Choose a code from the form, for example OPD1-005.' };
  const rows = await loadRows(month.period);
  return lineReport(cell ? rows.filter(r => inCell(r, cell)) : rows, cell ? `${month.title} · ${cell.code} ${cell.section.toLowerCase()}, ${cell.age}, ${cell.sex.toLowerCase()}` : month.title, options);
}
