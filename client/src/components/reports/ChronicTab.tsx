import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Download, Lock, ListChecks } from 'lucide-react';
import { useReport } from '../../hooks/useReport';
import { downloadError, downloadWorkbook } from '../../lib/reportDownload';
import { lastPage, pageText } from '../../lib/attendanceReport';
import { percent } from '../../lib/reportPeriod';
import {
  DEFAULT_FILTERS, OVERDUE_GROUPS, cellValue, countParams, listLabel, listParams, splitBar, splitByUse,
  type Cell, type ChronicCounts, type ChronicFilters, type Measure, type Period, type Status,
} from '../../lib/chronicReport';
import { BarList } from './ReportPanels';
import ConditionReview from './ConditionReview';

interface Col { key: string; header: string; type: string }
interface Table { title: string; period: string; columns: Col[]; rows: Record<string, unknown>[]; totals: Record<string, unknown> | null; summary: { label: string; value: number | string }[]; definitions: string[] }
const PAGE = 10, REGISTER = '/reports/chronic/register', OVERDUE = '/reports/chronic/overdue';
type View = 'register' | 'overdue';
const OVERDUE_ALL: Cell = { condition: null, measure: 'overdue' };

// Chronic diseases: the register (who has each condition, who has been seen, how blood pressure is controlled) and the overdue list
// (who has not been seen in 90 days, and how long). Any number opens the patients behind it.
export default function ChronicTab({ period, canLines, canSeeNames, isAdmin }: { period: Period; canLines: boolean; canSeeNames: boolean; isAdmin: boolean }) {
  const [view, setView] = useState<View>('register');
  const [filters, setFilters] = useState<ChronicFilters>(DEFAULT_FILTERS);
  const [cell, setCell] = useState<Cell | null>(null);
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const [exporting, setExporting] = useState<'counts' | 'lines' | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const base = view === 'register' ? REGISTER : OVERDUE;
  const counts = useReport<Table>(base, useMemo(() => countParams(period, { ...filters, condition: '' }), [period, filters]), reload);   // always every condition; the filter narrows the rows below
  const lineQuery = useMemo(() => (cell && canLines ? listParams(period, filters, cell) : null), [period, filters, cell, canLines]);
  const lines = useReport<Table>(base + '/lines', lineQuery, reload);

  const all = useMemo(() => (counts.data?.rows ?? []) as unknown as ChronicCounts[], [counts.data]);
  const rows = filters.condition ? all.filter(r => r.key === filters.condition) : all;
  const labels = useMemo(() => Object.fromEntries(all.map(r => [r.key, r.label])), [all]);
  const hasOther = !!counts.data?.columns.some(c => c.key === 'other');
  const { used, quiet } = splitByUse(rows);
  const sum = (k: keyof ChronicCounts) => used.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const hyper = rows.find(r => r.key === 'hypertension');
  const listed = lines.data, shown = listed?.rows.slice(page * PAGE, page * PAGE + PAGE) ?? [];

  const set = (patch: Partial<ChronicFilters>, clear = false) => { setFilters(f => ({ ...f, ...patch })); if (clear) { setCell(view === 'overdue' ? OVERDUE_ALL : null); } setPage(0); };
  const open = (next: Cell) => { setCell(next); setPage(0); };
  const switchView = (next: View) => { setView(next); setCell(next === 'overdue' ? OVERDUE_ALL : null); setPage(0); };

  async function exportCounts() {
    if (exporting) return; setExporting('counts');
    try { await downloadWorkbook(base, { ...countParams(period, filters), ...(filters.names ? { names: '1' } : {}) }, 'ses-chronic.xlsx'); } catch (e) { toast.error(await downloadError(e)); } finally { setExporting(null); }
  }
  async function exportLines() {
    if (exporting || !lineQuery) return; setExporting('lines');
    try { await downloadWorkbook(base + '/lines', lineQuery, 'ses-chronic-line-list.xlsx'); } catch (e) { toast.error(await downloadError(e)); } finally { setExporting(null); }
  }

  // A number, or a button that opens the patients behind it when the person may see them.
  const num = (row: ChronicCounts | null, measure: Measure, text?: string) => {
    const value = row ? cellValue(row, measure) : used.reduce((s, r) => s + cellValue(r, measure), 0);
    const target: Cell = { condition: row?.key ?? null, measure }, on = cell?.measure === measure && cell.condition === target.condition;
    const body = text ?? value.toLocaleString();
    return canLines && value > 0
      ? <button type="button" className="rp-cell" aria-pressed={on} aria-label={`${listLabel(target, labels)}: ${value}. Show these patients.`} onClick={() => open(target)}>{body}</button>
      : <span className={value === 0 ? 'rp-zero' : undefined}>{body}</span>;
  };
  const controlText = (r: ChronicCounts) => r.key === 'hypertension' ? `Under 140/90: ${r.controlled} of ${r.active} (${percent(r.controlled, r.active)})${r.noReading ? ` · ${r.noReading} with no recent reading` : ''}` : 'Rule not defined yet';

  return (
    <div className="rp-att">
      <div className="rp-subtabs rp-noprint" role="tablist" aria-label="Chronic disease reports">
        <button type="button" role="tab" aria-selected={view === 'register'} onClick={() => switchView('register')}>Register</button>
        <button type="button" role="tab" aria-selected={view === 'overdue'} onClick={() => switchView('overdue')}>Overdue and defaulters</button>
      </div>

      <div className="rp-card rp-noprint">
        <div className="rp-filters">
          <div><label htmlFor="ch-cond">Condition</label>
            <select id="ch-cond" className="bl-in" value={filters.condition} onChange={e => set({ condition: e.target.value }, true)}>
              <option value="">All chronic conditions</option>{all.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select></div>
          {view === 'register' && (<>
          <div><label htmlFor="ch-status">Status</label>
            <select id="ch-status" className="bl-in" value={filters.status} onChange={e => set({ status: e.target.value as Status })}>
              <option value="active">Active</option><option value="resolved">Resolved</option><option value="any">Active and resolved</option>
            </select></div>
          <div><label htmlFor="ch-seen">Last seen</label>
            <select id="ch-seen" className="bl-in" value={filters.seen} onChange={e => set({ seen: e.target.value as ChronicFilters['seen'] })}>
              <option value="">Any</option><option value="seen">Seen in 90 days</option><option value="overdue">Not seen in 90 days</option>
            </select></div>
          </>)}
          <div><label htmlFor="ch-ctl">Control</label>
            <select id="ch-ctl" className="bl-in" value={filters.control} onChange={e => set({ control: e.target.value as ChronicFilters['control'] })}>
              <option value="">Any</option><option value="controlled">Under 140/90</option><option value="notControlled">140/90 or higher</option><option value="noReading">No recent reading</option>
            </select></div>
          <div className="rp-filters-end">
            {canLines && <button type="button" className="bl-btn" onClick={() => setReviewing(r => !r)} aria-expanded={reviewing}><ListChecks size={15} /> Review condition list</button>}
            {canSeeNames && <label className="rp-check"><input type="checkbox" checked={filters.names} onChange={e => set({ names: e.target.checked })} /> Show patient names <span className="rp-sub">(clinical roles only)</span></label>}
            <button type="button" className="bl-btn" onClick={() => void exportCounts()} disabled={!!exporting || !counts.data} aria-busy={exporting === 'counts'}><Download size={15} /> {exporting === 'counts' ? 'Preparing…' : 'Export to Excel'}</button>
          </div>
        </div>
        {(filters.status !== 'active' || filters.seen || filters.control) && <p className="rp-sub" style={{ margin: '10px 0 0' }}>Status, last seen and control narrow the patients you open, not the counts.</p>}
      </div>

      {reviewing && <ConditionReview canEdit={isAdmin} onChanged={() => setReload(n => n + 1)} onClose={() => setReviewing(false)} />}
      {counts.error && <div className="rp-note bad" role="alert"><span>{counts.error}</span><button type="button" className="bl-btn sm" onClick={() => setReload(n => n + 1)}>Try again</button></div>}

      <section className="rp-card" aria-label={counts.data?.title ?? 'Chronic diseases'} aria-busy={counts.loading} style={{ opacity: counts.loading && counts.data ? 0.55 : 1 }}>
        <div className="rp-card-head"><div><h2>{view === 'register' ? 'Chronic disease register' : 'Overdue and defaulters'}</h2>
          <p className="rp-sub">{view === 'register' ? 'Patients with an active diagnosis, matched on ICD-11 codes. Seen means any visit in the last 90 days, as of today.' : 'Active patients not seen in the last 90 days, as of today.'}</p></div></div>
        {canLines && <p className="rp-sub" style={{ margin: '0 0 8px' }}>Select a number to see the patients behind it.</p>}
        {!counts.data && !counts.error && <div className="rp-skel" style={{ height: 200 }} aria-hidden="true" />}
        {counts.data && used.length === 0 && <p className="rp-empty">No chronic disease diagnoses are recorded for this selection.</p>}
        {counts.data && used.length > 0 && (
          <div className="rp-scroll"><table className="rp-matrix rp-register">
            <thead>{view === 'register' ? (
              <tr><th scope="col">Condition</th><th scope="col">Active</th><th scope="col">Female</th><th scope="col">Male</th>{hasOther && <th scope="col">Other</th>}<th scope="col">{period.from ? 'New in period' : 'Recorded'}</th><th scope="col">Resolved</th><th scope="col">Seen in 90 days</th><th scope="col">Overdue</th><th scope="col">Control</th></tr>
            ) : (
              <tr><th scope="col">Condition</th><th scope="col">Active</th><th scope="col">Not seen in 90 days</th><th scope="col">Appointment booked</th>{OVERDUE_GROUPS.map(g => <th key={g.key} scope="col">{g.label}</th>)}</tr>
            )}</thead>
            <tbody>
              {used.map(r => view === 'register' ? (
                <tr key={r.key}><th scope="row">{r.label}</th><td>{num(r, 'active')}</td><td>{num(r, 'female')}</td><td>{num(r, 'male')}</td>{hasOther && <td>{num(r, 'other')}</td>}
                  <td>{num(r, 'new')}</td><td>{num(r, 'resolved')}</td><td>{num(r, 'seen', `${r.seen} (${percent(r.seen, r.active)})`)}</td><td>{num(r, 'overdue')}</td><td className="rp-ctl">{controlText(r)}</td></tr>
              ) : (
                <tr key={r.key}><th scope="row">{r.label}</th><td>{r.active.toLocaleString()}</td><td>{num(r, 'overdue')}</td><td>{r.booked.toLocaleString()}</td>{OVERDUE_GROUPS.map(g => <td key={g.key}>{r[g.key].toLocaleString()}</td>)}</tr>
              ))}
            </tbody>
            {used.length > 1 && (
              <tfoot>{view === 'register' ? (
                <tr><th scope="row">All conditions</th><td>{num(null, 'active')}</td><td>{num(null, 'female')}</td><td>{num(null, 'male')}</td>{hasOther && <td>{num(null, 'other')}</td>}<td>{num(null, 'new')}</td><td>{num(null, 'resolved')}</td>
                  <td>{num(null, 'seen', `${sum('seen')} (${percent(sum('seen'), sum('active'))})`)}</td><td>{num(null, 'overdue')}</td><td /></tr>
              ) : (
                <tr><th scope="row">All conditions</th><td>{sum('active').toLocaleString()}</td><td>{num(null, 'overdue')}</td><td>{sum('booked').toLocaleString()}</td>{OVERDUE_GROUPS.map(g => <td key={g.key}>{sum(g.key).toLocaleString()}</td>)}</tr>
              )}</tfoot>
            )}
          </table></div>
        )}
        {quiet.length > 0 && used.length > 0 && <p className="rp-sub" style={{ marginTop: 12 }}>No active patients: {quiet.map(r => r.label).join(', ')}.</p>}
        <p className="rp-sub" style={{ marginTop: 8 }}>A patient with more than one condition appears in each of their conditions, so rows add up to more than the number of patients.</p>
      </section>

      {counts.data && used.length > 0 && view === 'register' && (
        <div className="rp-two">
          <section className="rp-card" aria-label="Follow-up by condition">
            <div className="rp-card-head"><div><h2>Follow-up by condition</h2><p className="rp-sub">Active patients seen in the last 90 days, and those not seen (overdue).</p></div></div>
            <ul className="rp-bars">{used.filter(r => r.active > 0).map(r => { const [a, b] = splitBar([r.seen, r.overdue]); return (
              <li key={r.key}><div className="rp-bar-text"><span className="rp-bar-label">{r.label}</span>
                <span className="rp-sub"><b>{r.seen}</b> seen · {canLines && r.overdue > 0 ? <button type="button" className="rp-cell" onClick={() => open({ condition: r.key, measure: 'overdue' })} aria-label={`${r.label} overdue: ${r.overdue}. Show these patients.`}>{r.overdue} overdue</button> : <>{r.overdue} overdue</>}</span></div>
                <div className="rp-track rp-2seg" aria-hidden="true"><div className="rp-fill" style={{ width: `${a}%` }} /><div className="rp-late" style={{ width: `${b}%` }} /></div></li>
            ); })}</ul>
            <p className="rp-legend"><i className="rp-sw" /> Seen in the last 90 days <i className="rp-sw late" /> Overdue</p>
          </section>
          {hyper && hyper.active > 0 && (() => { const [a, b, c] = splitBar([hyper.controlled, hyper.notControlled, hyper.noReading]); return (
            <section className="rp-card" aria-label="Blood pressure control">
              <div className="rp-card-head"><div><h2>Blood pressure control</h2><p className="rp-sub">Hypertension patients, by latest reading in the last 90 days.</p></div></div>
              <div className="rp-track rp-3seg" aria-hidden="true"><div className="rp-fill" style={{ width: `${a}%` }} /><div className="rp-bad" style={{ width: `${b}%` }} /><div className="rp-none" style={{ width: `${c}%` }} /></div>
              <ul className="rp-legend-list">
                {([['controlled', 'Under 140/90', hyper.controlled, ''], ['notControlled', 'At or above 140/90', hyper.notControlled, 'bad'], ['noReading', 'No reading in 90 days', hyper.noReading, 'none']] as const).map(([m, text, n, cls]) => (
                  <li key={m}><i className={`rp-sw ${cls}`} /> <span>{text}</span> {num(hyper, m, `${n} · ${percent(n, hyper.active)}`)}</li>
                ))}
              </ul>
            </section>
          ); })()}
        </div>
      )}

      {counts.data && view === 'overdue' && used.length > 0 && (
        <section className="rp-card" aria-label="How overdue">
          <div className="rp-card-head"><div><h2>How overdue</h2><p className="rp-sub">{rows.length === 1 ? rows[0]!.label : 'All conditions'}: overdue patients, by days since their last visit.</p></div></div>
          <BarList rows={OVERDUE_GROUPS.map(g => ({ key: g.key, label: g.label, value: sum(g.key) }))} empty="Nobody is overdue." />
        </section>
      )}

      {canLines && (
        <section className="rp-card" aria-label="Line list" aria-busy={!!lineQuery && lines.loading}>
          <div className="rp-card-head"><div><h2>Line list</h2>{cell && <p className="rp-sub"><b style={{ color: 'var(--text-heading)', fontWeight: 500 }}>{view === 'overdue' && cell === OVERDUE_ALL ? 'All conditions · Overdue, longest first' : listLabel(cell, labels)}</b></p>}</div>
            <span className="rp-pill" title={filters.names ? 'Names are showing' : 'Patient ID and masked NRC only'}><Lock size={12} aria-hidden="true" style={{ verticalAlign: '-1px' }} /> {filters.names ? 'Names shown' : 'Names hidden'}</span></div>
          {!cell && <p className="rp-empty">Select a number in the table to see the patients behind it.</p>}
          {cell && lines.error && <div className="rp-note bad" role="alert"><span>{lines.error}</span><button type="button" className="bl-btn sm" onClick={() => setReload(n => n + 1)}>Try again</button></div>}
          {cell && lines.loading && !listed && <div className="rp-skel" style={{ height: 160 }} aria-hidden="true" />}
          {listed && cell && (<>
            <p className="rp-sub" style={{ margin: '0 0 8px' }}>{Number(listed.summary[0]?.value ?? listed.rows.length).toLocaleString()} patients behind this number.{listed.summary[1] ? ` ${Number(listed.summary[1].value).toLocaleString()} more are not shown; the Excel file has the same limit.` : ''}</p>
            <div className="rp-scroll"><table className="rp-lines">
              <thead><tr>{listed.columns.map(c => <th key={c.key} scope="col">{c.header}</th>)}</tr></thead>
              <tbody>{shown.map((r, i) => <tr key={page * PAGE + i}>{listed.columns.map(c => {
                const v = String(r[c.key] ?? '');
                return <td key={c.key}>{c.key === 'followUp' && v === 'Overdue' ? <span className="rp-pill">Overdue</span> : c.key === 'lastBp' && v.includes('at or above') ? <span className="rp-rose">{v}</span> : v}</td>;
              })}</tr>)}</tbody>
            </table></div>
            <div className="rp-pager"><span className="rp-sub">{pageText(page, PAGE, listed.rows.length)}</span>
              <div><button type="button" className="bl-btn sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button>{' '}
                <button type="button" className="bl-btn sm" disabled={page >= lastPage(PAGE, listed.rows.length)} onClick={() => setPage(p => p + 1)}>Next</button></div></div>
            <button type="button" className="bl-btn rp-noprint" style={{ marginTop: 12 }} onClick={() => void exportLines()} disabled={!!exporting} aria-busy={exporting === 'lines'}><Download size={15} /> {exporting === 'lines' ? 'Preparing…' : `Export these ${listed.rows.length.toLocaleString()} rows to Excel`}</button>
            <p className="rp-sub" style={{ marginTop: 8 }}>Blood pressure at or above 140/90 is marked with the clinical alert colour and always said in words, so it reads without colour. Line list exports are written to the audit log with your name, the report, the filters and the time.</p>
          </>)}
        </section>
      )}

      {counts.data && (
        <section className="rp-card" aria-label="Definitions"><div className="rp-card-head"><h2>Definitions</h2></div><ul className="rp-defs">{counts.data.definitions.map(d => <li key={d}>{d}</li>)}</ul></section>
      )}
    </div>
  );
}
