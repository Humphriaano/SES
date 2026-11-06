import { parsePeriod } from './reportPeriod';
import { findReport, mayUse } from './reportRegistry';
import './reportDefinitions';
import type { Report } from '../controllers/billingReports.controller';

// The Reports hub's summary (Reports Hub stage 8). Every figure is read from a registered report run for the same period, so a tile can never
// disagree with the report it opens. A person gets a tile only when their role may open that report's counts, and one report failing leaves the rest.
// No figure is worked out here: this file only picks numbers a report already states.

export interface Figure { label: string; value: number | string; money?: boolean }
export interface Tile { id: string; title: string; opens: string; figures: Figure[]; error?: string }
export interface BillingSnapshot {
  error?: string; note?: string;
  collected?: { label: string; value: number }[]; collectedTotal?: number; creditUsed?: number;
  revenue?: { label: string; value: number }[]; charged?: number; discounts?: number; waived?: number;
  outstanding?: { label: string; value: number }[]; outstandingTotal?: number; invoices?: number; overdue?: number;
}

type Run = { report: Report } | { error: string } | null;
// null: this role may not open the report. error: the report refused or failed.
async function open(role: string | undefined, area: string, name: string, query: Record<string, string>): Promise<Run> {
  const def = findReport(area, name);
  if (!def || !mayUse(role, def.roles.aggregate)) return null;
  try {
    const out = await def.run(query);
    return 'error' in out ? { error: out.error } : { report: out };
  } catch (e) {
    console.error(`[reports/hub] ${area}/${name} failed:`, e);
    return { error: 'Could not load this. Try again.' };
  }
}
const fig = (r: Report, label: string): Figure | null => { const s = r.summary.find(x => x.label === label); return s ? { label: s.label, value: s.value, ...(s.money ? { money: true } : {}) } : null; };
const figs = (r: Report, labels: string[]) => labels.map(l => fig(r, l)).filter((f): f is Figure => !!f);
const money = (v: unknown) => Number(v ?? 0);

async function tile(role: string | undefined, query: Record<string, string>, id: string, title: string, opens: string, parts: { area: string; name: string; labels: string[] }[]): Promise<Tile | null> {
  const runs = await Promise.all(parts.map(p => open(role, p.area, p.name, query)));
  if (runs[0] === null) return null;   // the first report is the one the tile opens: without it there is no tile
  if ('error' in runs[0]) return { id, title, opens, figures: [], error: runs[0].error };
  const figures = runs.flatMap((r, i) => (r && 'report' in r ? figs(r.report, parts[i]!.labels) : []));
  return { id, title, opens, figures };
}

export async function hubSummary(role: string | undefined, query: Record<string, unknown>): Promise<{ period: string; tiles: Tile[]; billing: BillingSnapshot | null } | { error: string }> {
  const period = parsePeriod(query);
  if ('error' in period) return period;
  const q: Record<string, string> = period.from ? { from: period.fromDay!, to: period.toDay! } : {};   // only the period: a tile never carries a report's own filters

  const [tiles, billing] = await Promise.all([
    Promise.all([
      tile(role, q, 'attendance', 'Attendance', 'attendance', [{ area: 'attendance', name: 'attendance', labels: ['Attendances', 'New attendance', 'Re-attendance'] }]),
      tile(role, q, 'chronic', 'Chronic disease', 'chronic', [{ area: 'chronic', name: 'register', labels: ['Patients with an active chronic condition', 'Seen in the last 90 days (all conditions)', 'Overdue (all conditions)'] }]),
      tile(role, q, 'lab', 'Laboratory', 'lab', [
        { area: 'lab', name: 'turnaround', labels: ['Tests resulted', 'Median, order to result', 'Longest, order to result'] },
        { area: 'lab', name: 'tests', labels: ['Waiting (pending or in progress)'] },
      ]),
      tile(role, q, 'pharmacy', 'Pharmacy', 'pharmacy', [
        { area: 'pharmacy', name: 'dispensed', labels: ['Dispensings', 'Patients'] },
        { area: 'pharmacy', name: 'prescriptions', labels: ['Not available', 'Waiting'] },
      ]),
    ]),
    billingSnapshot(role, q, !!period.from),
  ]);
  return { period: period.label, tiles: tiles.filter((t): t is Tile => !!t), billing };
}

// Billing keeps its own reports and screens; this is a summary of them for the people who may open them. The billing reports cover one date range
// of up to a year, so "all time" has no billing figures. Outstanding balances are as at today whatever the period.
async function billingSnapshot(role: string | undefined, q: Record<string, string>, hasPeriod: boolean): Promise<BillingSnapshot | null> {
  const [revenue, collections, outstanding] = await Promise.all([open(role, 'billing', 'revenue', q), open(role, 'billing', 'collections', q), open(role, 'billing', 'outstanding', {})]);
  if (revenue === null || collections === null || outstanding === null) return null;
  if (!hasPeriod) return { error: 'Choose a period to see billing figures. The billing reports cover up to one year at a time.' };
  for (const r of [revenue, collections, outstanding]) if ('error' in r) return { error: r.error };
  const rev = (revenue as { report: Report }).report, col = (collections as { report: Report }).report, out = (outstanding as { report: Report }).report;
  const t = col.totals ?? {};
  const value = (r: Report, label: string) => money(r.summary.find(s => s.label === label)?.value);
  return {
    collected: [{ label: 'Cash', value: money(t['cash']) }, { label: 'Mobile money', value: money(t['mobile']) }, { label: 'Card', value: money(t['card']) }],
    collectedTotal: value(col, 'Collected'), creditUsed: money(t['credit']),
    revenue: rev.rows.map(r => ({ label: String(r['service']), value: money(r['charged']) })), charged: value(rev, 'Charged'), discounts: value(rev, 'Discounts given'), waived: value(rev, 'Waived (free / exempt)'),
    outstanding: ['0–7 days', '8–30 days', '31–60 days', 'Over 60 days'].map(label => ({ label, value: value(out, label) })), outstandingTotal: value(out, 'Outstanding'), invoices: value(out, 'Invoices'), overdue: value(out, 'Overdue'),
  };
}
