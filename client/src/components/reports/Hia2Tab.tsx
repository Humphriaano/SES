import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Download, Lock } from 'lucide-react';
import { useReport } from '../../hooks/useReport';
import { downloadError, downloadWorkbook } from '../../lib/reportDownload';
import { lastPage, pageText } from '../../lib/attendanceReport';
import { buildGrid, cellLabel, countParams, defaultMonth, listParams, monthChoices, monthText, type Row } from '../../lib/hia2Report';

interface Col { key: string; header: string; type: string }
interface Table { title: string; period: string; columns: Col[]; rows: Record<string, unknown>[]; totals: Record<string, unknown> | null; summary: { label: string; value: number | string }[] }
const PAGE = 10, BASE = '/reports/hia2/opd', MONTH_KEY = 'ses.reports.hia2month';
const show = (v: unknown, type: string) => {
  if (v === null || v === undefined || v === '') return '';
  if (type === 'date') { const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  return String(v);
};
function savedMonth(): string {
  try { const m = localStorage.getItem(MONTH_KEY); if (m && monthChoices().some(c => c.id === m)) return m; } catch { /* storage unavailable: use the default */ }
  return defaultMonth();
}

// The HIA2 monthly return, section 6.1 Out patients (OPD), laid out as the form lays it out and with the form's codes beside each number.
// A month is chosen here, not on the period bar, because the return is for one calendar month. Any number opens the attendances behind it.
export default function Hia2Tab({ canLines, canSeeNames }: { canLines: boolean; canSeeNames: boolean }) {
  const [month, setMonth] = useState(savedMonth);
  const [code, setCode] = useState<string | null | undefined>(undefined);   // undefined: no list open; null: every attendance of the month; a code: one cell
  const [names, setNames] = useState(false);
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const [exporting, setExporting] = useState<'counts' | 'lines' | null>(null);

  const counts = useReport<Table>(BASE, useMemo(() => countParams(month), [month]), reload);
  const lineQuery = useMemo(() => (code !== undefined && canLines ? listParams(month, code, names) : null), [month, code, names, canLines]);
  const lines = useReport<Table>(BASE + '/lines', lineQuery, reload);
  const table = counts.data, listed = lines.data, shown = listed?.rows.slice(page * PAGE, page * PAGE + PAGE) ?? [];
  const rows = useMemo(() => (table?.rows ?? []) as unknown as Row[], [table]);
  const grid = useMemo(() => buildGrid(rows), [rows]);
  const notes = (table?.summary ?? []).filter(s => s.label.startsWith('Sex recorded'));
  const stats = (table?.summary ?? []).filter(s => !s.label.startsWith('Sex recorded'));

  const pick = (next: string) => { setMonth(next); setCode(undefined); setPage(0); try { localStorage.setItem(MONTH_KEY, next); } catch { /* not remembered */ } };
  const open = (next: string | null) => { setCode(next); setPage(0); };

  async function exportCounts() {
    if (exporting) return; setExporting('counts');
    try { await downloadWorkbook(BASE, { ...countParams(month), ...(names ? { names: '1' } : {}) }, `ses-hia2-opd-${month}.xlsx`); } catch (e) { toast.error(await downloadError(e)); } finally { setExporting(null); }
  }
  async function exportLines() {
    if (exporting || !lineQuery) return; setExporting('lines');
    try { await downloadWorkbook(BASE + '/lines', lineQuery, `ses-hia2-opd-${month}-line-list.xlsx`); } catch (e) { toast.error(await downloadError(e)); } finally { setExporting(null); }
  }

  const cell = (c: { code: string; value: number }) => (
    <td key={c.code}>
      {canLines && c.value > 0
        ? <button type="button" className="rp-cell" aria-pressed={code === c.code} aria-label={`${cellLabel(rows, c.code)}: ${c.value}. Show these attendances.`} onClick={() => open(c.code)}>{c.value.toLocaleString()}</button>
        : <span className={c.value === 0 ? 'rp-zero' : undefined}>{c.value.toLocaleString()}</span>}
      <span className="rp-code">{c.code}</span>
    </td>
  );

  return (
    <div className="rp-att">
      <div className="rp-printonly rp-form-head">
        <b>Ministry of Health · Service Delivery Reporting Form</b>
        <span>HIA2, version February 2023 · 6.1 Out patients (OPD)</span>
        <span>Month: {monthText(month)} · Facility: ______________________ · District: ______________________</span>
      </div>

      <div className="rp-card rp-noprint">
        <div className="rp-filters">
          <div><label htmlFor="h2-month">Month of the return</label>
            <select id="h2-month" className="bl-in" value={month} onChange={e => pick(e.target.value)}>
              {monthChoices().map((m, i) => <option key={m.id} value={m.id}>{m.label}{i === 0 ? ' (in progress)' : ''}</option>)}
            </select></div>
          <div className="rp-filters-end">
            {canSeeNames && <label className="rp-check"><input type="checkbox" checked={names} onChange={e => { setNames(e.target.checked); setPage(0); }} /> Show patient names <span className="rp-sub">(clinical roles only)</span></label>}
            <button type="button" className="bl-btn" onClick={() => void exportCounts()} disabled={!!exporting || !table} aria-busy={exporting === 'counts'}><Download size={15} /> {exporting === 'counts' ? 'Preparing…' : 'Export to Excel'}</button>
          </div>
        </div>
      </div>

      {counts.error && <div className="rp-note bad" role="alert"><span>{counts.error}</span><button type="button" className="bl-btn sm" onClick={() => setReload(n => n + 1)}>Try again</button></div>}

      <section className="rp-card" aria-label="HIA2 OPD attendances" aria-busy={counts.loading} style={{ opacity: counts.loading && table ? 0.55 : 1 }}>
        <div className="rp-card-head"><div><h2>HIA2 OPD attendances · {monthText(month)}</h2>
          <p className="rp-sub">Section 6.1 of the monthly return, with the code of the form beside each number. Only this section is recorded in SES.{canLines ? ' Select a number to see the attendances behind it.' : ''}</p></div></div>
        {stats.length > 0 && <div className="rp-stats" style={{ marginBottom: 12, gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>{stats.map(s => <div key={s.label} className="rp-stat"><b>{typeof s.value === 'number' ? s.value.toLocaleString() : s.value}</b><span>{s.label}</span></div>)}</div>}
        {!table && !counts.error && <div className="rp-skel" style={{ height: 240 }} aria-hidden="true" />}
        {grid.map(section => (
          <div key={section.label} className="rp-scroll" style={{ marginBottom: 14 }}>
            <table className="rp-matrix rp-hia2">
              <caption>{section.label}</caption>
              <thead><tr><th scope="col">Age group</th><th scope="col">Male</th><th scope="col">Female</th><th scope="col">Total</th></tr></thead>
              <tbody>{section.rows.map(r => <tr key={r.age}><th scope="row">{r.age}</th>{r.cells.map(cell)}</tr>)}</tbody>
            </table>
          </div>
        ))}
        {notes.map(n => <p key={n.label} className="rp-sub" style={{ marginTop: 8 }}>{n.label}: {n.value}. The form has Male and Female columns only.</p>)}
        {table && canLines && <button type="button" className="bl-btn sm rp-noprint" style={{ marginTop: 8 }} onClick={() => open(null)} aria-pressed={code === null}>See every attendance of the month</button>}
      </section>

      {canLines && (
        <section className="rp-card" aria-label="Line list" aria-busy={!!lineQuery && lines.loading}>
          <div className="rp-card-head"><div><h2>Line list</h2>{code !== undefined && <p className="rp-sub"><b style={{ color: 'var(--text-heading)', fontWeight: 500 }}>{code === null ? `Every attendance of ${monthText(month)}` : cellLabel(rows, code)}</b></p>}</div>
            <span className="rp-pill" title={names ? 'Names are showing' : 'Patient ID and masked NRC only'}><Lock size={12} aria-hidden="true" style={{ verticalAlign: '-1px' }} /> {names ? 'Names shown' : 'Names hidden'}</span></div>
          {code === undefined && <p className="rp-empty">Select a number in the form to see the attendances behind it.</p>}
          {code !== undefined && lines.error && <div className="rp-note bad" role="alert"><span>{lines.error}</span><button type="button" className="bl-btn sm" onClick={() => setReload(n => n + 1)}>Try again</button></div>}
          {code !== undefined && lines.loading && !listed && <div className="rp-skel" style={{ height: 160 }} aria-hidden="true" />}
          {listed && code !== undefined && (<>
            <p className="rp-sub" style={{ margin: '0 0 8px' }}>{Number(listed.summary[0]?.value ?? listed.rows.length).toLocaleString()} attendances behind this number. Newest first.{listed.summary[1] ? ` ${Number(listed.summary[1].value).toLocaleString()} older ones are not shown; the Excel file has the same limit.` : ''}</p>
            <div className="rp-scroll"><table className="rp-lines">
              <thead><tr>{listed.columns.map(c => <th key={c.key} scope="col">{c.header}</th>)}</tr></thead>
              <tbody>{shown.map((r, i) => <tr key={page * PAGE + i}>{listed.columns.map(c => <td key={c.key}>{show(r[c.key], c.type)}</td>)}</tr>)}</tbody>
            </table></div>
            <div className="rp-pager"><span className="rp-sub">{pageText(page, PAGE, listed.rows.length)}</span>
              <div><button type="button" className="bl-btn sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button>{' '}
                <button type="button" className="bl-btn sm" disabled={page >= lastPage(PAGE, listed.rows.length)} onClick={() => setPage(p => p + 1)}>Next</button></div></div>
            <button type="button" className="bl-btn rp-noprint" style={{ marginTop: 12 }} onClick={() => void exportLines()} disabled={!!exporting} aria-busy={exporting === 'lines'}><Download size={15} /> {exporting === 'lines' ? 'Preparing…' : `Export these ${listed.rows.length.toLocaleString()} rows to Excel`}</button>
            <p className="rp-sub" style={{ marginTop: 8 }}>Line list exports are written to the audit log with your name, the report, the filters and the time.</p>
          </>)}
        </section>
      )}

      <div className="rp-printonly rp-form-foot">
        <span>Compiled by: ____________________ Title: ______________ Date: __________ Sign: __________</span>
        <span>Delivered by: ____________________ Title: ______________ Date: __________ Sign: __________</span>
      </div>
    </div>
  );
}
