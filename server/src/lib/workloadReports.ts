import { parsePeriod, type Period } from './reportPeriod';
import { loadRows, patientCode, maskNrc, LINE_LIMIT, type Row } from './attendanceReports';
import { userNames } from './billingOps';
import { median, duration } from './labReports';
import prisma from './prisma';
import type { Report } from '../controllers/billingReports.controller';

// Workload: attendances by service point or by the staff member who started seeing them, how many were seen, and how long they waited.
// Built from the same check-ins as the Attendance report, so the totals match it.

export const WORKLOAD_DEFINITIONS = [
  'An attendance is one check-in at a service point in the period, as in the Attendance report. A check-in taken off the queue without the patient being seen is not counted.',
  'Seen: a staff member started seeing the patient (the queue records when, and who). Not seen yet: still waiting, or finished without anyone starting the visit on the queue.',
  'Wait: from check-in to the moment a staff member started seeing the patient, for patients who were seen. Median is the middle wait; longest is the longest.',
  'By staff member: the person who started the visit. A patient moved between rooms counts under the room they were last assigned to.',
  'A start recorded before its check-in is a recording error: that visit counts as seen, but its wait is left out and counted in the notes.',
  `A line list shows at most ${LINE_LIMIT.toLocaleString()} attendances, newest first; the counts always cover all of them. It shows a patient ID and a masked NRC unless a clinical role asks for names.`,
];

const GROUPS = ['servicePoint', 'staff'] as const;
type Group = (typeof GROUPS)[number];
const NOBODY = 'none';
interface Filters { period: Period; groupBy: Group; servicePoint?: string; staff?: string; seen?: 'yes' | 'no' }

function parse(q: Record<string, unknown>): Filters | { error: string } {
  const period = parsePeriod(q);
  if ('error' in period) return period;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const groupBy = text(q['groupBy']) ?? 'servicePoint', servicePoint = text(q['servicePoint']), staff = text(q['staff']), seen = text(q['seen']);
  if (!(GROUPS as readonly string[]).includes(groupBy)) return { error: 'Group by service point or by staff member.' };
  if (servicePoint && !/^[0-9a-f-]{36}$/i.test(servicePoint)) return { error: 'Choose a service point from the list.' };
  if (staff && staff !== NOBODY && !/^[0-9a-f-]{36}$/i.test(staff)) return { error: 'Choose a staff member from the list.' };
  if (seen && seen !== 'yes' && seen !== 'no') return { error: 'Choose seen or not seen yet.' };
  return { period, groupBy: groupBy as Group, servicePoint, staff, seen: seen as Filters['seen'] };
}

const waitOf = (r: Row): number | null => (r.startedAt ? Math.round((r.startedAt.getTime() - r.at.getTime()) / 60000) : null);
const keep = (rows: Row[], f: Filters) => rows.filter(r =>
  (!f.servicePoint || r.roomId === f.servicePoint) && (!f.staff || (f.staff === NOBODY ? !r.startedById : r.startedById === f.staff)) &&
  (!f.seen || (f.seen === 'yes') === !!r.startedAt));

export async function workload(q: Record<string, unknown>): Promise<Report | { error: string }> {
  const f = parse(q);
  if ('error' in f) return f;
  const rows = keep(await loadRows(f.period), { ...f, seen: undefined });   // seen narrows the records, not the counts: the columns split it
  const staff = f.groupBy === 'staff' ? await userNames(rows.map(r => r.startedById)) : {};

  type Acc = { key: string; label: string; attendances: number; seen: number; waits: number[] };
  const groups = new Map<string, Acc>();
  let bad = 0;
  for (const r of rows) {
    const key = f.groupBy === 'servicePoint' ? r.roomId : r.startedById ?? NOBODY;
    const label = f.groupBy === 'servicePoint' ? r.room : r.startedById ? staff[r.startedById] ?? 'Unknown staff member' : 'Not seen yet';
    const g = groups.get(key) ?? { key, label, attendances: 0, seen: 0, waits: [] };
    g.attendances++;
    if (r.startedAt) { g.seen++; const w = waitOf(r)!; if (w >= 0) g.waits.push(w); else bad++; }
    groups.set(key, g);
  }
  const shape = (g: Acc) => ({ label: g.label, key: g.key, attendances: g.attendances, seen: g.seen, notSeen: g.attendances - g.seen, medianMin: median(g.waits), longestMin: g.waits.length ? Math.max(...g.waits) : null, timed: g.waits.length });
  const body = [...groups.values()].map(shape).sort((a, b) => (a.key === NOBODY ? 1 : b.key === NOBODY ? -1 : 0) || b.attendances - a.attendances || a.label.localeCompare(b.label));   // busiest first, "Not seen yet" last
  const all = shape({ key: 'all', label: 'All', attendances: rows.length, seen: rows.filter(r => r.startedAt).length, waits: rows.map(waitOf).filter((w): w is number => w !== null && w >= 0) });
  const int = (key: string, header: string, width = 13) => ({ key, header, type: 'int' as const, width });
  return {
    name: 'workload', title: f.groupBy === 'staff' ? 'Workload by staff member' : 'Workload by service point', period: f.servicePoint ? `${f.period.label} · one service point` : f.period.label,
    columns: [
      { key: 'label', header: f.groupBy === 'staff' ? 'Staff member' : 'Service point', type: 'text', width: 30 }, int('attendances', 'Attendances'), int('seen', 'Seen'), int('notSeen', 'Not seen yet', 14),
      int('medianMin', 'Median wait (min)', 17), int('longestMin', 'Longest wait (min)', 18),
    ],
    rows: body, totals: { ...all, label: 'All' },
    summary: [
      { label: 'Attendances', value: all.attendances }, { label: 'Seen', value: all.seen }, { label: 'Median wait', value: duration(all.medianMin) || 'No waits recorded' },
      { label: 'Longest wait', value: duration(all.longestMin) || 'No waits recorded' }, ...(bad ? [{ label: 'Left out: started before check-in', value: bad }] : []),
    ],
  };
}

// The attendances behind a number, newest first, with who saw them and how long they waited.
export async function workloadLines(q: Record<string, unknown>, options: { names: boolean }): Promise<Report | { error: string }> {
  const f = parse(q);
  if ('error' in f) return f;
  const all = keep(await loadRows(f.period), f).sort((a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id));
  const rows = all.slice(0, LINE_LIMIT);
  const ids = [...new Set(rows.map(r => r.patientId))];
  const patients = ids.length ? await prisma.patient.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, nationalId: true } }) : [];
  const byId = new Map(patients.map(p => [p.id, p])), staff = await userNames(rows.map(r => r.startedById));
  const text = (key: string, header: string, width: number) => ({ key, header, type: 'text' as const, width });
  return {
    name: 'workload-lines', title: 'Workload line list', period: f.period.label,
    columns: [
      { key: 'at', header: 'Checked in', type: 'date', width: 18 }, text('patientCode', 'Patient ID', 16), ...(options.names ? [text('name', 'Name', 26)] : []), text('nrc', options.names ? 'NRC' : 'NRC (masked)', 16),
      text('servicePoint', 'Service point', 22), text('seenBy', 'Seen by', 22), { key: 'startedAt', header: 'Started', type: 'date', width: 18 },
      { key: 'waitMin', header: 'Wait (min)', type: 'int', width: 11 }, text('wait', 'Waited', 14),
    ],
    rows: rows.map(r => {
      const p = byId.get(r.patientId), w = waitOf(r);
      return {
        at: r.at, patientCode: patientCode(r.patientId), name: options.names ? `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim() : '', nrc: options.names ? p?.nationalId ?? '' : maskNrc(p?.nationalId),
        servicePoint: r.room, seenBy: r.startedById ? staff[r.startedById] ?? '' : 'Not seen yet', startedAt: r.startedAt, waitMin: w !== null && w >= 0 ? w : null, wait: w === null ? '' : w < 0 ? 'Recording error' : duration(w),
      };
    }),
    totals: null,
    summary: [{ label: 'Attendances', value: all.length }, ...(all.length > rows.length ? [{ label: `Not shown (the list holds the newest ${LINE_LIMIT})`, value: all.length - rows.length }] : [])],
  };
}
