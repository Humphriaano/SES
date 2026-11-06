import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Download, Lock } from 'lucide-react';
import { useReport } from '../../hooks/useReport';
import { downloadError, downloadWorkbook } from '../../lib/reportDownload';
import { lastPage, pageText } from '../../lib/attendanceReport';
import { percent } from '../../lib/reportPeriod';
import {
  DEFAULT_FILTERS, countParams, listLabel, listParams, optionParams, quantityText, sameAsOptions,
  type Cell, type DispensedRow, type Measure, type PharmacyFilters, type Period, type PrescriptionRow, type View,
} from '../../lib/pharmacyReport';

interface Col { key: string; header: string; type: string }
interface Table { title: string; period: string; columns: Col[]; rows: Record<string, unknown>[]; totals: Record<string, unknown> | null; summary: { label: string; value: number | string }[]; definitions?: string[] }
export interface PharmacyAccess { lineList: boolean; canSeeNames: boolean }
const PAGE = 10, BASE: Record<View, string> = { dispensed: '/reports/pharmacy/dispensed', prescriptions: '/reports/pharmacy/prescriptions' };
const VIEW_TEXT: Record<View, { tab: string; title: string; sub: string; file: string }> = {
  dispensed: { tab: 'Medicines dispensed', title: 'Medicines dispensed', sub: 'What the pharmacy gave out in the period. Select a number to see the dispensings behind it.', file: 'ses-pharmacy-dispensed' },
  prescriptions: { tab: 'Prescriptions and dispensed', title: 'Prescriptions and dispensed', sub: 'Prescriptions written in the period, and whether each was dispensed, marked not available, or is still waiting. The items with gaps come first.', file: 'ses-pharmacy-prescriptions' },
};
const NOTE = /^(Left out|Imported|Not shown|Dispensings with no)/;
const show = (v: unknown, type: string) => {
  if (v === null || v === undefined || v === '') return '';
  if (type === 'date') { const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  return String(v);
};

// Pharmacy: what was dispensed and what was prescribed against it. Any number opens the records behind it. Stock reports stay in Pharmacy.
// Each report is its own screen with its own loaded figures (keyed by report), so one report's rows are never drawn with another's columns.
export default function PharmacyTab({ period, access, stockLink }: { period: Period; access: Partial<Record<View, PharmacyAccess>>; stockLink: boolean }) {
  const views = (['dispensed', 'prescriptions'] as View[]).filter(v => access[v]);
  const [chosen, setChosen] = useState<View>('dispensed');
  const [filters, setFilters] = useState<PharmacyFilters>(DEFAULT_FILTERS);
  const view: View = access[chosen] ? chosen : views[0]!;
  return (
    <div className="rp-att">
      <div className="rp-subtabs rp-noprint" role="tablist" aria-label="Pharmacy reports">
        {views.map(v => <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setChosen(v)}>{VIEW_TEXT[v].tab}</button>)}
      </div>
      <PharmacyView key={view} view={view} period={period} access={access[view]!} filters={filters} setFilters={setFilters} />
      {stockLink && <p className="rp-sub rp-noprint">Stock on hand, expiry, movements, adjustments and reorder reports are in <Link to="/pharmacy">Pharmacy</Link>.</p>}
    </div>
  );
}

function PharmacyView({ view, period, access, filters, setFilters }: { view: View; period: Period; access: PharmacyAccess; filters: PharmacyFilters; setFilters: (update: (f: PharmacyFilters) => PharmacyFilters) => void }) {
  const canLines = access.lineList, canSeeNames = access.canSeeNames;
  const [cell, setCell] = useState<Cell | null>(null);
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const [exporting, setExporting] = useState<'counts' | 'lines' | null>(null);

  const base = BASE[view], text = VIEW_TEXT[view], brandView = view === 'dispensed' && filters.groupBy === 'brand';
  // The item choices are every item in the period. The table is the same request unless the screen narrows it, so it is only asked for again then.
  const options = useReport<Table>(base, useMemo(() => optionParams(period), [period]), reload);
  const narrowed = !sameAsOptions(view, filters);
  const own = useReport<Table>(base, useMemo(() => (narrowed ? countParams(view, period, filters) : null), [narrowed, view, period, filters]), reload);
  const counts = narrowed ? own : options;
  const lineQuery = useMemo(() => (cell && canLines ? listParams(view, period, filters, cell) : null), [view, period, filters, cell, canLines]);
  const lines = useReport<Table>(base + '/lines', lineQuery, reload);

  const table = counts.data, listed = lines.data, shown = listed?.rows.slice(page * PAGE, page * PAGE + PAGE) ?? [];
  const rows = (table?.rows ?? []) as unknown as (DispensedRow & PrescriptionRow)[];
  const totals = table?.totals as unknown as (DispensedRow & PrescriptionRow) | null;
  const choices = useMemo(() => (options.data?.rows ?? []) as unknown as { key: string; label: string; unit?: string }[], [options.data]);
  const labels = useMemo(() => Object.fromEntries([...choices, ...(counts.data?.rows ?? []) as unknown as { key: string; label: string }[]].map(r => [r.key, r.label])), [choices, counts.data]);
  const unitOf = choices.find(c => c.key === filters.item)?.unit ?? '';
  const stats = (table?.summary ?? []).filter(s => !NOTE.test(s.label)).slice(0, 5), notes = (table?.summary ?? []).filter(s => NOTE.test(s.label));
  const itemLabel = view === 'dispensed' && filters.item ? (labels[filters.item] ?? '') : '';

  const set = (patch: Partial<PharmacyFilters>, clear = false) => { setFilters(f => ({ ...f, ...patch })); if (clear) setCell(null); setPage(0); };   // a new grouping or filter changes what the rows mean, so the open list closes; showing names does not
  const open = (next: Cell) => { setCell(next); setPage(0); };

  async function exportCounts() {
    if (exporting) return; setExporting('counts');
    try { await downloadWorkbook(base, { ...countParams(view, period, filters), ...(filters.names ? { names: '1' } : {}) }, text.file + '.xlsx'); } catch (e) { toast.error(await downloadError(e)); } finally { setExporting(null); }
  }
  async function exportLines() {
    if (exporting || !lineQuery) return; setExporting('lines');
    try { await downloadWorkbook(base + '/lines', lineQuery, text.file + '-line-list.xlsx'); } catch (e) { toast.error(await downloadError(e)); } finally { setExporting(null); }
  }

  // A number, or a button that opens the records behind it when the person may see them.
  const num = (row: { key: string } | null, measure: Measure, value: number) => {
    const key = row?.key ?? null, on = cell?.measure === measure && cell.key === key;
    return canLines && value > 0
      ? <button type="button" className="rp-cell" aria-pressed={on} aria-label={`${listLabel(view, filters, { key, measure }, labels)}: ${value}. Show these records.`} onClick={() => open({ key, measure })}>{value.toLocaleString()}</button>
      : <span className={value === 0 ? 'rp-zero' : undefined}>{value.toLocaleString()}</span>;
  };
  const cells = (row: DispensedRow & PrescriptionRow, r: { key: string } | null) => {
    if (view === 'prescriptions') return (<><td>{num(r, 'all', row.written)}</td><td>{num(r, 'dispensed', row.dispensed)}</td><td>{num(r, 'notAvailable', row.notAvailable)}</td><td>{num(r, 'waiting', row.waiting)}</td><td>{percent(row.dispensed, row.written)}</td></>);
    if (brandView) return (<><td>{num(r, 'all', row.dispensings)}</td><td>{row.patients.toLocaleString()}</td><td>{row.items.toLocaleString()}</td>{filters.item && <td>{r ? quantityText(row.quantity, unitOf) : '—'}</td>}</>);
    return (<><td>{num(r, 'all', row.dispensings)}</td><td>{row.patients.toLocaleString()}</td><td>{r ? quantityText(row.quantity, row.unit) : '—'}</td><td>{num(r, 'prescription', row.prescription)}</td><td>{num(r, 'substitution', row.substitution)}</td><td>{num(r, 'direct', row.direct)}</td></>);
  };
  const heads = view === 'prescriptions' ? ['Written', 'Dispensed', 'Not available', 'Waiting', 'Dispensed share']
    : brandView ? ['Dispensings', 'Patients', 'Items', ...(filters.item ? ['Quantity'] : [])]
      : ['Dispensings', 'Patients', 'Quantity', 'On prescription', 'Substituted', 'Without prescription'];
  const first = brandView ? 'Brand' : 'Item';

  return (
    <>
      <div className="rp-card rp-noprint">
        <div className="rp-filters">
          {view === 'dispensed' && <div><label htmlFor="ph-group">Group by</label>
            <select id="ph-group" className="bl-in" value={filters.groupBy} onChange={e => set({ groupBy: e.target.value as PharmacyFilters['groupBy'] }, true)}>
              <option value="item">Item</option><option value="brand">Brand</option>
            </select></div>}
          <div><label htmlFor="ph-item">Item</label>
            <select id="ph-item" className="bl-in" value={filters.item} onChange={e => set({ item: e.target.value }, true)}>
              <option value="">All items</option>{choices.map(c => <option key={c.key} value={c.key}>{c.label}{c.unit ? ` (${c.unit})` : ''}</option>)}
            </select></div>
          {view === 'dispensed' && <div><label htmlFor="ph-type">Type</label>
            <select id="ph-type" className="bl-in" value={filters.type} onChange={e => set({ type: e.target.value as PharmacyFilters['type'] }, true)}>
              <option value="">All types</option><option value="prescription">On prescription</option><option value="substitution">Substituted</option><option value="direct">Without prescription</option>
            </select></div>}
          <div className="rp-filters-end">
            {canSeeNames && <label className="rp-check"><input type="checkbox" checked={filters.names} onChange={e => set({ names: e.target.checked })} /> Show patient names <span className="rp-sub">(clinical roles only)</span></label>}
            <button type="button" className="bl-btn" onClick={() => void exportCounts()} disabled={!!exporting || !table} aria-busy={exporting === 'counts'}><Download size={15} /> {exporting === 'counts' ? 'Preparing…' : 'Export to Excel'}</button>
          </div>
        </div>
      </div>

      {(counts.error || options.error) && <div className="rp-note bad" role="alert"><span>{counts.error ?? options.error}</span><button type="button" className="bl-btn sm" onClick={() => setReload(n => n + 1)}>Try again</button></div>}

      <section className="rp-card" aria-label={table?.title ?? text.title} aria-busy={counts.loading} style={{ opacity: counts.loading && table ? 0.55 : 1 }}>
        <div className="rp-card-head"><div><h2>{text.title}{brandView ? ' by brand' : ''}{itemLabel ? ` · ${itemLabel}` : ''}</h2><p className="rp-sub">{text.sub}</p></div></div>
        {stats.length > 0 && <div className="rp-stats" style={{ marginBottom: 12 }}>{stats.map(s => <div key={s.label} className="rp-stat"><b>{typeof s.value === 'number' ? s.value.toLocaleString() : s.value}</b><span>{s.label}</span></div>)}</div>}
        {!table && !counts.error && <div className="rp-skel" style={{ height: 200 }} aria-hidden="true" />}
        {table && rows.length === 0 && <p className="rp-empty">{view === 'dispensed' ? 'Nothing was dispensed' : 'No prescriptions were written'} for this selection.</p>}
        {table && rows.length > 0 && (
          <div className="rp-scroll"><table className="rp-matrix rp-register">
            <thead><tr><th scope="col">{first}</th>{heads.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
            <tbody>{rows.map(r => <tr key={r.key}><th scope="row">{r.label}{view === 'dispensed' && !brandView && r.unit ? <span className="rp-sub"> · {r.unit}</span> : null}</th>{cells(r, r)}</tr>)}</tbody>
            {rows.length > 1 && totals && <tfoot><tr><th scope="row">{brandView ? 'All brands' : 'All items'}</th>{cells(totals, null)}</tr></tfoot>}
          </table></div>
        )}
        {brandView && rows.length > 1 && <p className="rp-sub" style={{ marginTop: 8 }}>A dispensing taken from batches of two brands is counted under each, so the rows can add up to more than the total.</p>}
        {view === 'dispensed' && !brandView && rows.length > 0 && <p className="rp-sub" style={{ marginTop: 8 }}>Quantities are only added together for the same item in the same unit.</p>}
        {notes.map(n => <p key={n.label} className="rp-sub" style={{ marginTop: 8 }}>{n.label}: {typeof n.value === 'number' ? n.value.toLocaleString() : n.value}</p>)}
      </section>

      {canLines && (
        <section className="rp-card" aria-label="Line list" aria-busy={!!lineQuery && lines.loading}>
          <div className="rp-card-head"><div><h2>Line list</h2>{cell && <p className="rp-sub"><b style={{ color: 'var(--text-heading)', fontWeight: 500 }}>{listLabel(view, filters, cell, labels)}</b></p>}</div>
            <span className="rp-pill" title={filters.names ? 'Names are showing' : 'Patient ID and masked NRC only'}><Lock size={12} aria-hidden="true" style={{ verticalAlign: '-1px' }} /> {filters.names ? 'Names shown' : 'Names hidden'}</span></div>
          {!cell && <p className="rp-empty">Select a number in the table to see the records behind it.</p>}
          {cell && lines.error && <div className="rp-note bad" role="alert"><span>{lines.error}</span><button type="button" className="bl-btn sm" onClick={() => setReload(n => n + 1)}>Try again</button></div>}
          {cell && lines.loading && !listed && <div className="rp-skel" style={{ height: 160 }} aria-hidden="true" />}
          {listed && cell && (<>
            <p className="rp-sub" style={{ margin: '0 0 8px' }}>{Number(listed.summary[0]?.value ?? listed.rows.length).toLocaleString()} {view === 'dispensed' ? 'dispensings' : 'prescriptions'} behind this number.{listed.summary.find(s => s.label.startsWith('Not shown')) ? ` ${Number(listed.summary.find(s => s.label.startsWith('Not shown'))!.value).toLocaleString()} more are not shown; the Excel file has the same limit.` : ''}</p>
            <div className="rp-scroll"><table className="rp-lines">
              <thead><tr>{listed.columns.map(c => <th key={c.key} scope="col">{c.header}</th>)}</tr></thead>
              <tbody>{shown.map((r, i) => <tr key={page * PAGE + i}>{listed.columns.map(c => {
                const v = show(r[c.key], c.type);
                return <td key={c.key}>{c.key === 'status' && v && v !== 'Dispensed' ? <span className="rp-pill">{v}</span> : v}</td>;
              })}</tr>)}</tbody>
            </table></div>
            <div className="rp-pager"><span className="rp-sub">{pageText(page, PAGE, listed.rows.length)}</span>
              <div><button type="button" className="bl-btn sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button>{' '}
                <button type="button" className="bl-btn sm" disabled={page >= lastPage(PAGE, listed.rows.length)} onClick={() => setPage(p => p + 1)}>Next</button></div></div>
            <button type="button" className="bl-btn rp-noprint" style={{ marginTop: 12 }} onClick={() => void exportLines()} disabled={!!exporting} aria-busy={exporting === 'lines'}><Download size={15} /> {exporting === 'lines' ? 'Preparing…' : `Export these ${listed.rows.length.toLocaleString()} rows to Excel`}</button>
            <p className="rp-sub" style={{ marginTop: 8 }}>Line list exports are written to the audit log with your name, the report, the filters and the time.</p>
          </>)}
        </section>
      )}

    </>
  );
}
