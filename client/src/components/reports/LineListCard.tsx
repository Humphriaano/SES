import { Download, Lock } from 'lucide-react';
import { lastPage, pageText } from '../../lib/attendanceReport';

interface Col { key: string; header: string; type: string }
export interface LineTable { title: string; period: string; columns: Col[]; rows: Record<string, unknown>[]; summary: { label: string; value: number | string }[] }
const PAGE = 10;
const show = (v: unknown, type: string) => {
  if (v === null || v === undefined || v === '') return '';
  if (type === 'date') { const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  return String(v);
};

// The records behind a clicked number: what was clicked, the records a page at a time, and an Excel copy of them. Names are shown only when asked for.
export default function LineListCard({ heading, names, data, loading, error, onRetry, page, onPage, onExport, exporting, noun }: {
  heading: string | null; names: boolean; data: LineTable | undefined; loading: boolean; error?: string; onRetry: () => void;
  page: number; onPage: (page: number) => void; onExport: () => void; exporting: boolean; noun: string;
}) {
  const shown = data?.rows.slice(page * PAGE, page * PAGE + PAGE) ?? [];
  const hidden = data?.summary.find(s => s.label.startsWith('Not shown'));
  return (
    <section className="rp-card" aria-label="Line list" aria-busy={!!heading && loading}>
      <div className="rp-card-head"><div><h2>Line list</h2>{heading && <p className="rp-sub"><b style={{ color: 'var(--text-heading)', fontWeight: 500 }}>{heading}</b></p>}</div>
        <span className="rp-pill" title={names ? 'Names are showing' : 'Patient ID and masked NRC only'}><Lock size={12} aria-hidden="true" style={{ verticalAlign: '-1px' }} /> {names ? 'Names shown' : 'Names hidden'}</span></div>
      {!heading && <p className="rp-empty">Select a number in the table to see the {noun} behind it.</p>}
      {heading && error && <div className="rp-note bad" role="alert"><span>{error}</span><button type="button" className="bl-btn sm" onClick={onRetry}>Try again</button></div>}
      {heading && loading && !data && <div className="rp-skel" style={{ height: 160 }} aria-hidden="true" />}
      {heading && data && (<>
        <p className="rp-sub" style={{ margin: '0 0 8px' }}>{Number(data.summary[0]?.value ?? data.rows.length).toLocaleString()} {noun} behind this number. Newest first.{hidden ? ` ${Number(hidden.value).toLocaleString()} older ones are not shown; the Excel file has the same limit.` : ''}</p>
        <div className="rp-scroll"><table className="rp-lines">
          <thead><tr>{data.columns.map(c => <th key={c.key} scope="col">{c.header}</th>)}</tr></thead>
          <tbody>{shown.map((r, i) => <tr key={page * PAGE + i}>{data.columns.map(c => <td key={c.key}>{show(r[c.key], c.type)}</td>)}</tr>)}</tbody>
        </table></div>
        <div className="rp-pager"><span className="rp-sub">{pageText(page, PAGE, data.rows.length)}</span>
          <div><button type="button" className="bl-btn sm" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</button>{' '}
            <button type="button" className="bl-btn sm" disabled={page >= lastPage(PAGE, data.rows.length)} onClick={() => onPage(page + 1)}>Next</button></div></div>
        <button type="button" className="bl-btn rp-noprint" style={{ marginTop: 12 }} onClick={onExport} disabled={exporting} aria-busy={exporting}><Download size={15} /> {exporting ? 'Preparing…' : `Export these ${data.rows.length.toLocaleString()} rows to Excel`}</button>
        <p className="rp-sub" style={{ marginTop: 8 }}>Line list exports are written to the audit log with your name, the report, the filters and the time.</p>
      </>)}
    </section>
  );
}
