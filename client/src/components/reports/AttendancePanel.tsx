import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Download, Lock } from 'lucide-react';
import api from '../../api/client';
import { apiError } from '../../lib/money';
import { downloadError, downloadWorkbook } from '../../lib/reportDownload';
import { ByServicePoint, WeeklyTrend } from './AttendanceCharts';
import {
  AGE_BANDS, DEFAULT_FILTERS, GROUP_LABEL, attendanceParams, cellLabel, cellParams, cellValue, lastPage, pageText,
  type AttendanceFilters, type AttendanceRow, type Cell, type GroupBy, type Period, type Sex, type Visit,
} from '../../lib/attendanceReport';

interface Col { key: string; header: string; type: string }
interface Table { title: string; period: string; columns: Col[]; rows: Record<string, unknown>[]; totals: Record<string, unknown> | null; summary: { label: string; value: number | string }[]; definitions: string[] }
interface Result<T> { id: string; data?: T; error?: string }
const PAGE = 10, AREA = '/reports/attendance/attendance';

const when = (iso: unknown) => new Date(String(iso)).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Attendance for the chosen period: the counts by age and sex (or by day, week or month), and the records behind any number clicked.
export default function AttendancePanel({ period, canLines, canSeeNames }: { period: Period; canLines: boolean; canSeeNames: boolean }) {
  const [filters, setFilters] = useState<AttendanceFilters>(DEFAULT_FILTERS);
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([]);
  const [cell, setCell] = useState<Cell | null>(null);
  const [page, setPage] = useState(0);
  const [reloads, setReloads] = useState(0);
  const [counts, setCounts] = useState<Result<Table> | null>(null);
  const [records, setRecords] = useState<Result<Table> | null>(null);
  const [exporting, setExporting] = useState<'counts' | 'lines' | null>(null);

  // Names change the records and the Excel file, never the counts, so they are left out of what the counts are fetched with.
  const exportParams = useMemo(() => attendanceParams(period, filters), [period, filters]);
  const countParams = useMemo(() => attendanceParams(period, { ...filters, names: false }), [period, filters]);
  const chartParams = useMemo(() => { const p = attendanceParams(period, { ...filters, groupBy: 'period', names: false }); return p; }, [period, filters]);   // the pictures follow the filters, and group themselves
  const countId = JSON.stringify(countParams) + reloads;
  const lineParams = useMemo(() => (cell ? { ...cellParams(period, filters, cell), ...(filters.names ? { names: '1' } : {}) } : null), [period, filters, cell]);
  const lineId = lineParams ? JSON.stringify(lineParams) + reloads : '';

  useEffect(() => {
    let alive = true;
    api.get<Table>(AREA, { params: countParams })
      .then(r => { if (alive) setCounts({ id: countId, data: r.data }); })
      .catch(e => { if (alive) setCounts({ id: countId, error: apiError(e, 'Could not load attendance. Check your connection and try again.') }); });
    return () => { alive = false; };
  }, [countParams, countId]);
  useEffect(() => {
    if (!lineParams) return;
    let alive = true;
    api.get<Table>(`${AREA}/lines`, { params: lineParams })
      .then(r => { if (alive) setRecords({ id: lineId, data: r.data }); })
      .catch(e => { if (alive) setRecords({ id: lineId, error: apiError(e, 'Could not load the attendances. Check your connection and try again.') }); });
    return () => { alive = false; };
  }, [lineParams, lineId]);
  useEffect(() => {
    let alive = true;
    api.get<{ id: string; name: string }[]>('/queue/rooms').then(r => { if (alive && Array.isArray(r.data)) setRooms(r.data.map(x => ({ id: x.id, name: x.name }))); }).catch(() => { /* the filter just offers no service points */ });
    return () => { alive = false; };
  }, []);

  const set = (patch: Partial<AttendanceFilters>) => { setFilters(f => ({ ...f, ...patch })); setCell(null); setPage(0); };
  const pick = (next: Cell) => { setCell(next); setPage(0); };
  const countsNow = counts?.id === countId ? counts : null, recordsNow = records?.id === lineId ? records : null;
  const table = countsNow?.data ?? (counts?.data && !countsNow ? counts.data : undefined);   // the last figures stay on screen, dimmed, while new ones load
  const rows = (table?.rows ?? []) as unknown as AttendanceRow[];
  const hasOther = !!table?.columns.some(c => c.key === 'newOther');
  const sexes: (Sex | null)[] = hasOther ? ['MALE', 'FEMALE', 'OTHER', null] : ['MALE', 'FEMALE', null];
  const lines = recordsNow?.data, shown = lines?.rows.slice(page * PAGE, page * PAGE + PAGE) ?? [];

  async function exportCounts() {
    if (exporting) return; setExporting('counts');
    try { await downloadWorkbook(AREA, exportParams, 'ses-attendance.xlsx'); } catch (e) { toast.error(await downloadError(e)); } finally { setExporting(null); }
  }
  async function exportLines() {
    if (exporting || !lineParams) return; setExporting('lines');
    try { await downloadWorkbook(`${AREA}/lines`, lineParams, 'ses-attendance-line-list.xlsx'); } catch (e) { toast.error(await downloadError(e)); } finally { setExporting(null); }
  }

  const numberCell = (row: AttendanceRow | null, visit: Visit | null, sex: Sex | null, bold = false) => {
    const value = row ? cellValue(row, visit, sex) : cellValue({ ...(table!.totals as unknown as AttendanceRow) }, visit, sex);
    const target: Cell = { row, visit, sex }, selected = cell !== null && cell.row === row && cell.visit === visit && cell.sex === sex;
    const label = `${cellLabel(target, filters.groupBy)}: ${value}`;
    return (
      <td key={`${visit}${sex}`} className={bold ? 'rp-num rp-strong' : 'rp-num'}>
        {canLines && value > 0
          ? <button type="button" className="rp-cell" aria-pressed={selected} aria-label={`${label}. Show these attendances.`} onClick={() => pick(target)}>{value.toLocaleString()}</button>
          : <span className={value === 0 ? 'rp-zero' : undefined}>{value.toLocaleString()}</span>}
      </td>
    );
  };

  return (
    <div className="rp-att">
      <div className="rp-card rp-noprint">
        <div className="rp-filters">
          <div><label htmlFor="at-sp">Service point</label>
            <select id="at-sp" className="bl-in" value={filters.servicePoint} onChange={e => set({ servicePoint: e.target.value })}>
              <option value="">All service points</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select></div>
          <div><label htmlFor="at-sex">Sex</label>
            <select id="at-sex" className="bl-in" value={filters.sex} onChange={e => set({ sex: e.target.value as AttendanceFilters['sex'] })}>
              <option value="">All</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option>
            </select></div>
          <div><label htmlFor="at-age">Age band</label>
            <select id="at-age" className="bl-in" value={filters.ageBand} onChange={e => set({ ageBand: e.target.value })}>
              <option value="">All ages</option>{AGE_BANDS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select></div>
          <div><label htmlFor="at-group">Group by</label>
            <select id="at-group" className="bl-in" value={filters.groupBy} onChange={e => set({ groupBy: e.target.value as GroupBy })}>
              {(Object.keys(GROUP_LABEL) as GroupBy[]).map(g => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
            </select></div>
          <div className="rp-filters-end">
            {canSeeNames && (
              <label className="rp-check"><input type="checkbox" checked={filters.names} onChange={e => { setFilters(f => ({ ...f, names: e.target.checked })); setPage(0); }} /> Show patient names <span className="rp-sub">(clinical roles only)</span></label>
            )}
            <button type="button" className="bl-btn" onClick={() => void exportCounts()} disabled={!!exporting || !table} aria-busy={exporting === 'counts'}><Download size={15} /> {exporting === 'counts' ? 'Preparing…' : 'Export to Excel'}</button>
          </div>
        </div>
      </div>

      {countsNow?.error && (
        <div className="rp-note bad" role="alert"><span>{countsNow.error}</span><button type="button" className="bl-btn sm" onClick={() => setReloads(n => n + 1)}>Try again</button></div>
      )}

      <div className={canLines ? 'rp-att-grid' : undefined}>
        <section className="rp-card" aria-label={table?.title ?? 'Attendance'} aria-busy={!countsNow} style={{ opacity: countsNow || !table ? 1 : 0.55 }}>
          <div className="rp-card-head"><div><h2>{table?.title ?? 'Attendance'}</h2>
            <p className="rp-sub">{table ? `${table.summary[0]?.value.toLocaleString()} attendances · ${table.summary[1]?.value.toLocaleString()} new · ${table.summary[2]?.value.toLocaleString()} re-attendance · ${table.period}` : 'Loading…'}</p></div></div>
          {canLines && <p className="rp-sub" style={{ margin: '0 0 8px' }}>Select any number to see the attendances behind it.</p>}
          <p className="rp-sub" style={{ margin: '0 0 10px' }}>Age bands are placeholders until the HIA2 template is confirmed.</p>
          {!table && !countsNow?.error && <div className="rp-skel" style={{ height: 220 }} aria-hidden="true" />}
          {table && (
            <div className="rp-scroll">
              <table className="rp-matrix">
                <thead>
                  <tr><th rowSpan={2} scope="col">{table.columns[0]?.header}</th><th colSpan={sexes.length} scope="colgroup">New attendance</th><th colSpan={sexes.length} scope="colgroup">Re-attendance</th><th rowSpan={2} scope="col">All attendances</th></tr>
                  <tr>{[0, 1].flatMap(g => sexes.map(s => <th key={`${g}${s}`} scope="col">{s === 'MALE' ? 'Male' : s === 'FEMALE' ? 'Female' : s === 'OTHER' ? 'Other' : 'Total'}</th>))}</tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={sexes.length * 2 + 2} className="rp-empty">Nothing was recorded in this period.</td></tr>}
                  {rows.map(r => (
                    <tr key={r.key}><th scope="row">{r.label}</th>
                      {(['new', 're'] as Visit[]).flatMap(v => sexes.map(s => numberCell(r, v, s, s === null)))}
                      {numberCell(r, null, null, true)}</tr>
                  ))}
                </tbody>
                {rows.length > 0 && (
                  <tfoot><tr><th scope="row">{String(table.totals?.['label'] ?? 'All')}</th>
                    {(['new', 're'] as Visit[]).flatMap(v => sexes.map(s => numberCell(null, v, s, true)))}
                    {numberCell(null, null, null, true)}</tr></tfoot>
                )}
              </table>
            </div>
          )}
        </section>

        {canLines && (
          <section className="rp-card" aria-label="Line list" aria-busy={!!lineParams && !recordsNow}>
            <div className="rp-card-head"><div><h2>Line list</h2>{cell && <p className="rp-sub"><b style={{ color: 'var(--text-heading)', fontWeight: 500 }}>{cellLabel(cell, filters.groupBy)}</b></p>}</div>
              <span className="rp-pill" title={filters.names ? 'Names are showing' : 'Patient ID and masked NRC only'}><Lock size={12} aria-hidden="true" style={{ verticalAlign: '-1px' }} /> {filters.names ? 'Names shown' : 'Names hidden'}</span></div>
            {!cell && <p className="rp-empty">Select a number in the table to see the attendances behind it.</p>}
            {cell && recordsNow?.error && <div className="rp-note bad" role="alert"><span>{recordsNow.error}</span><button type="button" className="bl-btn sm" onClick={() => setReloads(n => n + 1)}>Try again</button></div>}
            {cell && !recordsNow && <div className="rp-skel" style={{ height: 180 }} aria-hidden="true" />}
            {lines && (<>
              <p className="rp-sub" style={{ margin: '0 0 8px' }}>{(lines.summary[0]?.value ?? lines.rows.length).toLocaleString()} attendances behind this number. Newest first.{lines.summary[1] ? ` ${Number(lines.summary[1].value).toLocaleString()} older ones are not shown; the Excel file has the same limit.` : ''}</p>
              <div className="rp-scroll"><table className="rp-lines">
                <thead><tr>{lines.columns.map(c => <th key={c.key} scope="col">{c.header}</th>)}</tr></thead>
                <tbody>{shown.map((r, i) => <tr key={page * PAGE + i}>{lines.columns.map(c => <td key={c.key}>{c.type === 'date' ? when(r[c.key]) : String(r[c.key] ?? '')}</td>)}</tr>)}</tbody>
              </table></div>
              <div className="rp-pager">
                <span className="rp-sub">{pageText(page, PAGE, lines.rows.length)}</span>
                <div><button type="button" className="bl-btn sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button>{' '}
                  <button type="button" className="bl-btn sm" disabled={page >= lastPage(PAGE, lines.rows.length)} onClick={() => setPage(p => p + 1)}>Next</button></div>
              </div>
              <button type="button" className="bl-btn rp-noprint" style={{ width: '100%', marginTop: 12 }} onClick={() => void exportLines()} disabled={!!exporting} aria-busy={exporting === 'lines'}>
                <Download size={15} /> {exporting === 'lines' ? 'Preparing…' : `Export these ${lines.rows.length.toLocaleString()} rows to Excel`}</button>
              <p className="rp-sub" style={{ marginTop: 8 }}>Line list exports are written to the audit log with your name, the report, the filters and the time.</p>
            </>)}
            {!canSeeNames && <p className="rp-sub" style={{ marginTop: 10 }}>Line lists name patients, so they open only for clinical roles. Every line list export is logged.</p>}
          </section>
        )}
      </div>

      <div className="rp-charts-two rp-noprint-chart">
        <WeeklyTrend params={chartParams} />
        <ByServicePoint params={chartParams} onPick={id => set({ servicePoint: id })} />
      </div>

      {table && (
        <section className="rp-card" aria-label="Definitions">
          <div className="rp-card-head"><h2>Definitions</h2></div>
          <ul className="rp-defs">{table.definitions.map(d => <li key={d}>{d}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
