import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Download, Lock } from 'lucide-react';
import { useReport } from '../../hooks/useReport';
import { downloadError, downloadWorkbook } from '../../lib/reportDownload';
import { lastPage, pageText } from '../../lib/attendanceReport';
import { DEFAULT_FILTERS, countParams, duration, listLabel, listParams, type AbnormalRow, type Cell, type LabFilters, type Measure, type Period, type TestRow, type TurnaroundRow, type View } from '../../lib/labReport';

interface Col { key: string; header: string; type: string }
interface Table { title: string; period: string; columns: Col[]; rows: Record<string, unknown>[]; totals: Record<string, unknown> | null; summary: { label: string; value: number | string }[]; definitions: string[] }
export interface LabAccess { lineList: boolean; canSeeNames: boolean }
const PAGE = 10, BASE: Record<View, string> = { tests: '/reports/lab/tests', turnaround: '/reports/lab/turnaround', abnormal: '/reports/lab/abnormal' };
const VIEW_TEXT: Record<View, { tab: string; title: string; sub: string; file: string }> = {
  tests: { tab: 'Tests ordered and done', title: 'Tests ordered and done', sub: 'Tests ordered in the period and where they are now. Select a number to see the tests behind it.', file: 'ses-lab-tests' },
  turnaround: { tab: 'Turnaround', title: 'Turnaround', sub: 'Time from the order to the first result entered, for tests resulted in the period. Slowest first.', file: 'ses-lab-turnaround' },
  abnormal: { tab: 'Abnormal and positive', title: 'Abnormal and positive results', sub: 'Tests resulted in the period, by the most serious flag the lab chose. Select a number to see the patients behind it.', file: 'ses-lab-abnormal' },
};
const NOTE = /^(Left out|Imported|Not shown)/;
const show = (v: unknown, type: string) => {
  if (v === null || v === undefined || v === '') return '';
  if (type === 'date') { const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  return String(v);
};

// Laboratory: what was ordered and where it is, how long tests take, and which results were flagged. Any number opens the tests behind it.
// Each report is its own screen with its own loaded figures (keyed by report), so one report's rows are never drawn with another's columns.
export default function LabTab({ period, access }: { period: Period; access: Partial<Record<View, LabAccess>> }) {
  const views = (['tests', 'turnaround', 'abnormal'] as View[]).filter(v => access[v]);
  const [chosen, setChosen] = useState<View>('tests');
  const [filters, setFilters] = useState<LabFilters>(DEFAULT_FILTERS);
  const view: View = access[chosen] ? chosen : views[0]!;
  return (
    <div className="rp-att">
      <div className="rp-subtabs rp-noprint" role="tablist" aria-label="Laboratory reports">
        {views.map(v => <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setChosen(v)}>{VIEW_TEXT[v].tab}</button>)}
      </div>
      <LabView key={view} view={view} period={period} access={access[view]!} filters={filters} setFilters={setFilters} />
    </div>
  );
}

function LabView({ view, period, access, filters, setFilters }: { view: View; period: Period; access: LabAccess; filters: LabFilters; setFilters: (update: (f: LabFilters) => LabFilters) => void }) {
  const canLines = access.lineList, canSeeNames = access.canSeeNames;
  const [cell, setCell] = useState<Cell | null>(null);
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const [exporting, setExporting] = useState<'counts' | 'lines' | null>(null);

  const base = BASE[view], text = VIEW_TEXT[view];
  const counts = useReport<Table>(base, useMemo(() => countParams(period, filters), [period, filters]), reload);
  const lineQuery = useMemo(() => (cell && canLines ? listParams(view, period, filters, cell) : null), [view, period, filters, cell, canLines]);
  const lines = useReport<Table>(base + '/lines', lineQuery, reload);
  const table = counts.data, listed = lines.data, shown = listed?.rows.slice(page * PAGE, page * PAGE + PAGE) ?? [];
  const rows = (table?.rows ?? []) as unknown as (TestRow & TurnaroundRow & AbnormalRow)[];
  const totals = table?.totals as unknown as (TestRow & TurnaroundRow & AbnormalRow) | null;
  const hasOther = !!table?.columns.some(c => c.key === 'other');
  const stats = (table?.summary ?? []).filter(s => !NOTE.test(s.label)).slice(0, 4), notes = (table?.summary ?? []).filter(s => NOTE.test(s.label));
  const kind = filters.groupBy === 'specimen' ? 'Specimen' : 'Test';

  const set = (patch: Partial<LabFilters>, clear = false) => { setFilters(f => ({ ...f, ...patch })); if (clear) setCell(null); setPage(0); };   // a new grouping changes what the rows mean, so the open list closes; showing names does not
  const open = (next: Cell) => { setCell(next); setPage(0); };

  async function exportCounts() {
    if (exporting) return; setExporting('counts');
    try { await downloadWorkbook(base, { ...countParams(period, filters), ...(filters.names ? { names: '1' } : {}) }, text.file + '.xlsx'); } catch (e) { toast.error(await downloadError(e)); } finally { setExporting(null); }
  }
  async function exportLines() {
    if (exporting || !lineQuery) return; setExporting('lines');
    try { await downloadWorkbook(base + '/lines', lineQuery, text.file + '-line-list.xlsx'); } catch (e) { toast.error(await downloadError(e)); } finally { setExporting(null); }
  }

  // A number, or a button that opens the tests behind it when the person may see them.
  const num = (row: { key: string; label: string } | null, measure: Measure, value: number) => {
    const key = row?.key ?? null, on = cell?.measure === measure && cell.key === key;
    return canLines && value > 0
      ? <button type="button" className="rp-cell" aria-pressed={on} aria-label={`${listLabel(filters, { key: row?.label ?? null, measure }, view)}: ${value}. Show these tests.`} onClick={() => open({ key, measure })}>{value.toLocaleString()}</button>
      : <span className={value === 0 ? 'rp-zero' : undefined}>{value.toLocaleString()}</span>;
  };
    const cells = (row: TestRow & TurnaroundRow & AbnormalRow, r: { key: string; label: string } | null) => {
    if (view === 'tests') return (<><td>{num(r, 'ordered', row.ordered)}</td><td>{num(r, 'pending', row.pending)}</td><td>{num(r, 'inProgress', row.inProgress)}</td><td>{num(r, 'completed', row.completed)}</td>{hasOther && <td>{num(r, 'other', Number(row.other ?? 0))}</td>}</>);
    if (view === 'turnaround') return (<><td>{num(r, 'resulted', row.resulted)}</td><td>{duration(row.medianMin)}</td><td>{duration(row.longestMin)}</td><td>{row.withSample.toLocaleString()}</td><td>{duration(row.medianSampleMin)}</td></>);
    return (<><td>{num(r, 'resulted', row.resulted)}</td><td>{num(r, 'normal', row.normal)}</td><td>{num(r, 'abnormal', row.abnormal)}</td><td>{num(r, 'positive', row.positive)}</td><td>{num(r, 'critical', row.critical)}</td><td>{num(r, 'none', row.none)}</td></>);
  };
  const heads = view === 'tests' ? ['Ordered', 'Pending', 'In progress', 'Completed', ...(hasOther ? ['Other status'] : [])]
    : view === 'turnaround' ? ['Tests resulted', 'Median, order to result', 'Longest', 'With sample time', 'Median, sample to result']
      : ['Resulted', 'Normal', 'Abnormal', 'Positive', 'Critical', 'No flag recorded'];

  return (
    <>
      <div className="rp-card rp-noprint">
        <div className="rp-filters">
          <div><label htmlFor="lab-group">Group by</label>
            <select id="lab-group" className="bl-in" value={filters.groupBy} onChange={e => set({ groupBy: e.target.value as LabFilters['groupBy'] }, true)}>
              <option value="test">Test</option><option value="specimen">Specimen</option>
            </select></div>
          <div className="rp-filters-end">
            {canSeeNames && <label className="rp-check"><input type="checkbox" checked={filters.names} onChange={e => set({ names: e.target.checked })} /> Show patient names <span className="rp-sub">(clinical roles only)</span></label>}
            <button type="button" className="bl-btn" onClick={() => void exportCounts()} disabled={!!exporting || !table} aria-busy={exporting === 'counts'}><Download size={15} /> {exporting === 'counts' ? 'Preparing…' : 'Export to Excel'}</button>
          </div>
        </div>
      </div>

      {counts.error && <div className="rp-note bad" role="alert"><span>{counts.error}</span><button type="button" className="bl-btn sm" onClick={() => setReload(n => n + 1)}>Try again</button></div>}

      <section className="rp-card" aria-label={table?.title ?? text.title} aria-busy={counts.loading} style={{ opacity: counts.loading && table ? 0.55 : 1 }}>
        <div className="rp-card-head"><div><h2>{text.title}{filters.groupBy === 'specimen' ? ' by specimen' : ''}</h2><p className="rp-sub">{text.sub}</p></div></div>
        {stats.length > 0 && <div className="rp-stats" style={{ marginBottom: 12 }}>{stats.map(s => <div key={s.label} className="rp-stat"><b>{typeof s.value === 'number' ? s.value.toLocaleString() : s.value}</b><span>{s.label}</span></div>)}</div>}
        {!table && !counts.error && <div className="rp-skel" style={{ height: 200 }} aria-hidden="true" />}
        {table && rows.length === 0 && <p className="rp-empty">{view === 'tests' ? 'No tests were ordered' : 'No results were entered'} in this period.</p>}
        {table && rows.length > 0 && (
          <div className="rp-scroll"><table className="rp-matrix rp-register">
            <thead><tr><th scope="col">{kind}</th>{heads.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
            <tbody>{rows.map(r => <tr key={r.key}><th scope="row">{r.label}</th>{cells(r, r)}</tr>)}</tbody>
            {rows.length > 1 && totals && <tfoot><tr><th scope="row">{filters.groupBy === 'specimen' ? 'All specimens' : 'All tests'}</th>{cells(totals, null)}</tr></tfoot>}
          </table></div>
        )}
        {notes.map(n => <p key={n.label} className="rp-sub" style={{ marginTop: 8 }}>{n.label}: {typeof n.value === 'number' ? n.value.toLocaleString() : n.value}</p>)}
      </section>

      {canLines && (
        <section className="rp-card" aria-label="Line list" aria-busy={!!lineQuery && lines.loading}>
          <div className="rp-card-head"><div><h2>Line list</h2>{cell && <p className="rp-sub"><b style={{ color: 'var(--text-heading)', fontWeight: 500 }}>{listLabel(filters, cell, view)}</b></p>}</div>
            <span className="rp-pill" title={filters.names ? 'Names are showing' : 'Patient ID and masked NRC only'}><Lock size={12} aria-hidden="true" style={{ verticalAlign: '-1px' }} /> {filters.names ? 'Names shown' : 'Names hidden'}</span></div>
          {!cell && <p className="rp-empty">Select a number in the table to see the tests behind it.</p>}
          {cell && lines.error && <div className="rp-note bad" role="alert"><span>{lines.error}</span><button type="button" className="bl-btn sm" onClick={() => setReload(n => n + 1)}>Try again</button></div>}
          {cell && lines.loading && !listed && <div className="rp-skel" style={{ height: 160 }} aria-hidden="true" />}
          {listed && cell && (<>
            <p className="rp-sub" style={{ margin: '0 0 8px' }}>{Number(listed.summary[0]?.value ?? listed.rows.length).toLocaleString()} tests behind this number.{listed.summary.find(s => s.label.startsWith('Not shown')) ? ` ${Number(listed.summary.find(s => s.label.startsWith('Not shown'))!.value).toLocaleString()} more are not shown; the Excel file has the same limit.` : ''}</p>
            <div className="rp-scroll"><table className="rp-lines">
              <thead><tr>{listed.columns.map(c => <th key={c.key} scope="col">{c.header}</th>)}</tr></thead>
              <tbody>{shown.map((r, i) => <tr key={page * PAGE + i}>{listed.columns.map(c => {
                const v = show(r[c.key], c.type);
                return <td key={c.key}>{c.key === 'flag' && v && v !== 'Normal' ? <span className="rp-pill">{v}</span> : v}</td>;
              })}</tr>)}</tbody>
            </table></div>
            <div className="rp-pager"><span className="rp-sub">{pageText(page, PAGE, listed.rows.length)}</span>
              <div><button type="button" className="bl-btn sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button>{' '}
                <button type="button" className="bl-btn sm" disabled={page >= lastPage(PAGE, listed.rows.length)} onClick={() => setPage(p => p + 1)}>Next</button></div></div>
            <button type="button" className="bl-btn rp-noprint" style={{ marginTop: 12 }} onClick={() => void exportLines()} disabled={!!exporting} aria-busy={exporting === 'lines'}><Download size={15} /> {exporting === 'lines' ? 'Preparing…' : `Export these ${listed.rows.length.toLocaleString()} rows to Excel`}</button>
            <p className="rp-sub" style={{ marginTop: 8 }}>The flags are the ones the lab chose when entering each result, and are always written in words. Line list exports are written to the audit log with your name, the report, the filters and the time.</p>
          </>)}
        </section>
      )}

      {table && <section className="rp-card" aria-label="Definitions"><div className="rp-card-head"><h2>Definitions</h2></div><ul className="rp-defs">{table.definitions.map(d => <li key={d}>{d}</li>)}</ul></section>}
    </>
  );
}
