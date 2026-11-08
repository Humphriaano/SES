import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Download } from 'lucide-react';
import { useReport } from '../../hooks/useReport';
import { downloadError, downloadWorkbook } from '../../lib/reportDownload';
import { duration } from '../../lib/labReport';
import { AGE_BANDS } from '../../lib/attendanceReport';
import {
  DIAGNOSIS_DEFAULTS, FIRST_ROWS, WORKLOAD_DEFAULTS, diagnosisLabel, diagnosisLineParams, diagnosisParams, visibleRows, workloadLabel, workloadLineParams, workloadParams,
  type DiagnosisCell, type DiagnosisFilters, type DiagnosisMeasure, type DiagnosisRow, type Period, type WorkloadCell, type WorkloadFilters, type WorkloadMeasure, type WorkloadRow,
} from '../../lib/attendanceExtras';
import LineListCard, { type LineTable } from './LineListCard';

interface Table extends LineTable { totals: Record<string, unknown> | null; definitions: string[] }
export interface ViewAccess { lineList: boolean; canSeeNames: boolean }
const NOTE = /^(Left out|Not shown)/;
const Stats = ({ table, count = 4 }: { table: Table; count?: number }) => (
  <div className="rp-stats" style={{ marginBottom: 12 }}>{table.summary.filter(s => !NOTE.test(s.label)).slice(0, count).map(s => <div key={s.label} className="rp-stat"><b>{typeof s.value === 'number' ? s.value.toLocaleString() : s.value}</b><span>{s.label}</span></div>)}</div>
);
const Notes = ({ table }: { table: Table }) => <>{table.summary.filter(s => NOTE.test(s.label) && !s.label.startsWith('Not shown')).map(n => <p key={n.label} className="rp-sub" style={{ marginTop: 8 }}>{n.label}: {n.value}</p>)}</>;
const Definitions = ({ table }: { table: Table }) => <section className="rp-card" aria-label="Definitions"><div className="rp-card-head"><h2>Definitions</h2></div><ul className="rp-defs">{table.definitions.map(d => <li key={d}>{d}</li>)}</ul></section>;
const Retry = ({ text, onRetry }: { text: string; onRetry: () => void }) => <div className="rp-note bad" role="alert"><span>{text}</span><button type="button" className="bl-btn sm" onClick={onRetry}>Try again</button></div>;

// Workload: attendances by service point or staff member, how many were seen and how long they waited. Any count opens the attendances behind it.
export function WorkloadView({ period, access }: { period: Period; access: ViewAccess }) {
  const BASE = '/reports/attendance/workload';
  const [filters, setFilters] = useState<WorkloadFilters>(WORKLOAD_DEFAULTS);
  const [cell, setCell] = useState<WorkloadCell | null>(null);
  const [page, setPage] = useState(0), [reload, setReload] = useState(0), [exporting, setExporting] = useState<'counts' | 'lines' | null>(null);
  const counts = useReport<Table>(BASE, useMemo(() => workloadParams(period, filters), [period, filters]), reload);
  const lineQuery = useMemo(() => (cell && access.lineList ? workloadLineParams(period, filters, cell) : null), [cell, access.lineList, period, filters]);
  const lines = useReport<LineTable>(BASE + '/lines', lineQuery, reload);
  const table = counts.data, totals = table?.totals as unknown as WorkloadRow | null;
  const rows = useMemo(() => (table?.rows ?? []) as unknown as WorkloadRow[], [table]);
  const labels = useMemo(() => Object.fromEntries(rows.map(r => [r.key, r.label])), [rows]);

  const set = (patch: Partial<WorkloadFilters>, clear = false) => { setFilters(f => ({ ...f, ...patch })); if (clear) setCell(null); setPage(0); };
  async function exportFile(which: 'counts' | 'lines') {
    if (exporting || (which === 'lines' && !lineQuery)) return; setExporting(which);
    try { await downloadWorkbook(which === 'counts' ? BASE : BASE + '/lines', which === 'counts' ? { ...workloadParams(period, filters), ...(filters.names ? { names: '1' } : {}) } : lineQuery!, which === 'counts' ? 'ses-workload.xlsx' : 'ses-workload-line-list.xlsx'); }
    catch (e) { toast.error(await downloadError(e)); } finally { setExporting(null); }
  }
  const num = (row: WorkloadRow | null, measure: WorkloadMeasure, value: number) => {
    const key = row?.key ?? null, on = cell?.key === key && cell?.measure === measure;
    return access.lineList && value > 0
      ? <button type="button" className="rp-cell" aria-pressed={on} aria-label={`${workloadLabel(filters, { key, measure }, labels)}: ${value}. Show these attendances.`} onClick={() => { setCell({ key, measure }); setPage(0); }}>{value.toLocaleString()}</button>
      : <span className={value === 0 ? 'rp-zero' : undefined}>{value.toLocaleString()}</span>;
  };
  const cells = (r: WorkloadRow, row: WorkloadRow | null) => (<><td>{num(row, 'attendances', r.attendances)}</td><td>{num(row, 'seen', r.seen)}</td><td>{num(row, 'notSeen', r.notSeen)}</td><td>{duration(r.medianMin)}</td><td>{duration(r.longestMin)}</td></>);

  return (<>
    <div className="rp-card rp-noprint"><div className="rp-filters">
      <div><label htmlFor="wl-group">Group by</label>
        <select id="wl-group" className="bl-in" value={filters.groupBy} onChange={e => set({ groupBy: e.target.value as WorkloadFilters['groupBy'] }, true)}><option value="servicePoint">Service point</option><option value="staff">Staff member</option></select></div>
      <div className="rp-filters-end">
        {access.canSeeNames && <label className="rp-check"><input type="checkbox" checked={filters.names} onChange={e => set({ names: e.target.checked })} /> Show patient names <span className="rp-sub">(clinical roles only)</span></label>}
        <button type="button" className="bl-btn" onClick={() => void exportFile('counts')} disabled={!!exporting || !table} aria-busy={exporting === 'counts'}><Download size={15} /> {exporting === 'counts' ? 'Preparing…' : 'Export to Excel'}</button>
      </div>
    </div></div>
    {counts.error && <Retry text={counts.error} onRetry={() => setReload(n => n + 1)} />}
    <section className="rp-card" aria-label="Workload" aria-busy={counts.loading} style={{ opacity: counts.loading && table ? 0.55 : 1 }}>
      <div className="rp-card-head"><div><h2>Workload by {filters.groupBy === 'staff' ? 'staff member' : 'service point'}</h2>
        <p className="rp-sub">Attendances, how many were seen, and the wait from check-in to being seen.{access.lineList ? ' Select a number to see the attendances behind it.' : ''}</p></div></div>
      {table && <Stats table={table} />}
      {!table && !counts.error && <div className="rp-skel" style={{ height: 180 }} aria-hidden="true" />}
      {table && rows.length === 0 && <p className="rp-empty">Nothing was recorded in this period.</p>}
      {table && rows.length > 0 && (
        <div className="rp-scroll"><table className="rp-matrix rp-register">
          <thead><tr><th scope="col">{filters.groupBy === 'staff' ? 'Staff member' : 'Service point'}</th><th scope="col">Attendances</th><th scope="col">Seen</th><th scope="col">Not seen yet</th><th scope="col">Median wait</th><th scope="col">Longest wait</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.key}><th scope="row">{r.label}</th>{cells(r, r)}</tr>)}</tbody>
          {rows.length > 1 && totals && <tfoot><tr><th scope="row">All</th>{cells(totals, null)}</tr></tfoot>}
        </table></div>
      )}
      {table && <Notes table={table} />}
    </section>
    {access.lineList && <LineListCard heading={cell ? workloadLabel(filters, cell, labels) : null} names={filters.names} data={lines.data} loading={lines.loading} error={lines.error} onRetry={() => setReload(n => n + 1)}
      page={page} onPage={setPage} onExport={() => void exportFile('lines')} exporting={exporting === 'lines'} noun="attendances" />}
    {table && <Definitions table={table} />}
  </>);
}

// OPD diagnoses: the ICD-11 diagnoses recorded on consultations, commonest first. Any count opens the consultations behind it.
export function DiagnosesView({ period, access }: { period: Period; access: ViewAccess }) {
  const BASE = '/reports/attendance/diagnoses';
  const [filters, setFilters] = useState<DiagnosisFilters>(DIAGNOSIS_DEFAULTS);
  const [cell, setCell] = useState<DiagnosisCell | null>(null);
  const [all, setAll] = useState(false), [page, setPage] = useState(0), [reload, setReload] = useState(0), [exporting, setExporting] = useState<'counts' | 'lines' | null>(null);
  const counts = useReport<Table>(BASE, useMemo(() => diagnosisParams(period, filters), [period, filters]), reload);
  const lineQuery = useMemo(() => (cell && access.lineList ? diagnosisLineParams(period, filters, cell) : null), [cell, access.lineList, period, filters]);
  const lines = useReport<LineTable>(BASE + '/lines', lineQuery, reload);
  const table = counts.data;
  const rows = useMemo(() => (table?.rows ?? []) as unknown as DiagnosisRow[], [table]);
  const hasOther = !!table?.columns.some(c => c.key === 'other');
  const labels = useMemo(() => Object.fromEntries(rows.map(r => [r.code, r.label])), [rows]);

  const set = (patch: Partial<DiagnosisFilters>, clear = true) => { setFilters(f => ({ ...f, ...patch })); if (clear) setCell(null); setPage(0); };
  async function exportFile(which: 'counts' | 'lines') {
    if (exporting || (which === 'lines' && !lineQuery)) return; setExporting(which);
    try { await downloadWorkbook(which === 'counts' ? BASE : BASE + '/lines', which === 'counts' ? { ...diagnosisParams(period, filters), ...(filters.names ? { names: '1' } : {}) } : lineQuery!, which === 'counts' ? 'ses-opd-diagnoses.xlsx' : 'ses-opd-diagnoses-line-list.xlsx'); }
    catch (e) { toast.error(await downloadError(e)); } finally { setExporting(null); }
  }
  const num = (r: DiagnosisRow, measure: DiagnosisMeasure, value: number) => {
    const on = cell?.code === r.code && cell?.measure === measure;
    return access.lineList && value > 0
      ? <button type="button" className="rp-cell" aria-pressed={on} aria-label={`${diagnosisLabel({ code: r.code, measure }, labels)}: ${value}. Show these consultations.`} onClick={() => { setCell({ code: r.code, measure }); setPage(0); }}>{value.toLocaleString()}</button>
      : <span className={value === 0 ? 'rp-zero' : undefined}>{value.toLocaleString()}</span>;
  };

  return (<>
    <div className="rp-card rp-noprint"><div className="rp-filters">
      <div><label htmlFor="dx-sex">Sex</label>
        <select id="dx-sex" className="bl-in" value={filters.sex} onChange={e => set({ sex: e.target.value as DiagnosisFilters['sex'] })}><option value="">All</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option></select></div>
      <div><label htmlFor="dx-age">Age band</label>
        <select id="dx-age" className="bl-in" value={filters.ageBand} onChange={e => set({ ageBand: e.target.value })}><option value="">All ages</option>{AGE_BANDS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}</select></div>
      <label className="rp-check" style={{ alignSelf: 'center' }}><input type="checkbox" checked={filters.mainOnly} onChange={e => set({ mainOnly: e.target.checked })} /> Main diagnoses only</label>
      <div className="rp-filters-end">
        {access.canSeeNames && <label className="rp-check"><input type="checkbox" checked={filters.names} onChange={e => set({ names: e.target.checked }, false)} /> Show patient names <span className="rp-sub">(clinical roles only)</span></label>}
        <button type="button" className="bl-btn" onClick={() => void exportFile('counts')} disabled={!!exporting || !table} aria-busy={exporting === 'counts'}><Download size={15} /> {exporting === 'counts' ? 'Preparing…' : 'Export to Excel'}</button>
      </div>
    </div></div>
    {counts.error && <Retry text={counts.error} onRetry={() => setReload(n => n + 1)} />}
    <section className="rp-card" aria-label="OPD diagnoses" aria-busy={counts.loading} style={{ opacity: counts.loading && table ? 0.55 : 1 }}>
      <div className="rp-card-head"><div><h2>OPD diagnoses</h2><p className="rp-sub">ICD-11 diagnoses recorded on consultations, commonest first.{access.lineList ? ' Select a number to see the consultations behind it.' : ''}</p></div></div>
      {table && <Stats table={table} />}
      {!table && !counts.error && <div className="rp-skel" style={{ height: 200 }} aria-hidden="true" />}
      {table && rows.length === 0 && <p className="rp-empty">No diagnoses were recorded on consultations for this selection.</p>}
      {table && rows.length > 0 && (
        <div className="rp-scroll"><table className="rp-matrix rp-register">
          <thead><tr><th scope="col">Diagnosis</th><th scope="col">Consultations</th><th scope="col">Patients</th><th scope="col">Main diagnosis</th><th scope="col">Female</th><th scope="col">Male</th>{hasOther && <th scope="col">Other</th>}</tr></thead>
          <tbody>{visibleRows(rows, all).map(r => (
            <tr key={r.code}><th scope="row"><span className="rp-sub" style={{ marginRight: 6 }}>{r.code}</span>{r.label}</th>
              <td>{num(r, 'consultations', r.consultations)}</td><td>{r.patients.toLocaleString()}</td><td>{num(r, 'main', r.main)}</td><td>{num(r, 'female', r.female)}</td><td>{num(r, 'male', r.male)}</td>{hasOther && <td>{num(r, 'other', r.other)}</td>}</tr>
          ))}</tbody>
        </table></div>
      )}
      {table && rows.length > FIRST_ROWS && <button type="button" className="rp-link rp-noprint" style={{ marginTop: 10 }} onClick={() => setAll(a => !a)} aria-expanded={all}>{all ? `Show the first ${FIRST_ROWS}` : `Show all ${rows.length} diagnoses`}</button>}
      <p className="rp-sub" style={{ marginTop: 8 }}>A consultation with two diagnoses counts under each, so the rows add up to more than the consultations.</p>
    </section>
    {access.lineList && <LineListCard heading={cell ? diagnosisLabel(cell, labels) : null} names={filters.names} data={lines.data} loading={lines.loading} error={lines.error} onRetry={() => setReload(n => n + 1)}
      page={page} onPage={setPage} onExport={() => void exportFile('lines')} exporting={exporting === 'lines'} noun="consultations" />}
    {table && <Definitions table={table} />}
  </>);
}
