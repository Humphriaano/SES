import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Download, Printer, Search } from 'lucide-react';
import api from '../../api/client';
import { apiError } from '../../lib/money';
import { BILLING_CSS } from '../billing/ui';

interface Col { key: string; header: string; type: 'text' | 'money' | 'int' | 'number' | 'date'; width: number }
interface Report { name: string; title: string; period: string; columns: Col[]; rows: Record<string, any>[]; summary: { label: string; value: number | string }[] }

const REPORTS = [
  { id: 'on-hand', label: 'Stock on hand' }, { id: 'expiry', label: 'Batches by expiry' },
  { id: 'movements', label: 'Stock movements' }, { id: 'adjustments', label: 'Losses and adjustments' },
] as const;
type ReportId = typeof REPORTS[number]['id'];
const HAS_PERIOD: ReportId[] = ['movements', 'adjustments'];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function preset(p: string): { from: string; to: string } {
  const now = new Date();
  if (p === 'week') { const s = new Date(now); s.setDate(now.getDate() - ((now.getDay() + 6) % 7)); return { from: iso(s), to: iso(now) }; }
  if (p === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  return { from: iso(now), to: iso(now) };
}
const isNum = (c: Col) => c.type === 'money' || c.type === 'int' || c.type === 'number';
function cell(c: Col, v: any): string {
  if (v === null || v === undefined || v === '') return '—';
  if (c.type === 'int') return Number(v).toLocaleString('en-US');
  if (c.type === 'number') return Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (c.type === 'date') return new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lusaka' });
  return String(v);
}

// Same layout as the billing reports. The server builds every report from the stock ledger,
// so these screens, the Excel file and the stock views always agree.
export default function StockReports() {
  const [name, setName] = useState<ReportId>('on-hand');
  const [range, setRange] = useState<'today' | 'week' | 'month' | 'custom'>('week');
  const [dates, setDates] = useState(preset('week'));
  const [level, setLevel] = useState('ALL');
  const [state, setState] = useState('ALL');
  const [within, setWithin] = useState('');
  const [type, setType] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => { const t = window.setTimeout(() => setQuery(text.trim()), 300); return () => window.clearTimeout(t); }, [text]);

  const params = useMemo(() => ({
    ...(query ? { q: query } : {}),
    ...(HAS_PERIOD.includes(name) ? { from: dates.from, to: dates.to } : {}),
    ...(name === 'on-hand' && level !== 'ALL' ? { level } : {}),
    ...(name === 'expiry' && state !== 'ALL' ? { state } : {}), ...(name === 'expiry' && within ? { within } : {}),
    ...(name === 'movements' && type !== 'ALL' ? { type } : {}),
    ...(name === 'adjustments' && status !== 'ALL' ? { status } : {}),
  }), [name, query, dates, level, state, within, type, status]);

  useEffect(() => {
    let live = true;
    setLoading(true); setError('');
    api.get(`/pharmacy-stock/reports/${name}`, { params })
      .then(r => { if (live) setReport(r.data); })
      .catch(e => { if (live) { setError(apiError(e, 'Couldn’t load the report.')); setReport(null); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [name, params]);

  async function exportXlsx() {
    setExporting(true);
    try {
      const res = await api.get(`/pharmacy-stock/reports/${name}`, { params: { ...params, format: 'xlsx' }, responseType: 'blob' });
      const url = URL.createObjectURL(res.data), a = document.createElement('a');
      a.href = url; a.download = `ses-stock-${name}-${iso(new Date())}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast.error(apiError(e, 'Couldn’t export the report.')); } finally { setExporting(false); }
  }

  function printReport() {
    if (!report) return;
    const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));
    const head = report.columns.map(c => `<th class="${isNum(c) ? 'r' : ''}">${esc(c.header)}</th>`).join('');
    const body = report.rows.map(r => `<tr>${report.columns.map(c => `<td class="${isNum(c) ? 'r' : ''}">${esc(cell(c, r[c.key]))}</td>`).join('')}</tr>`).join('');
    const sums = report.summary.map(s => `<span><b>${esc(s.label)}</b> ${esc(typeof s.value === 'number' ? s.value.toLocaleString('en-US') : s.value)}</span>`).join('');
    const w = window.open('', '_blank', 'width=1100,height=800');
    if (!w) { toast.error('Allow pop-ups for this site to print.'); return; }
    w.document.open();
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(report.title)}</title><style>
      @page{size:A4 landscape;margin:12mm} body{font-family:Segoe UI,Arial,sans-serif;color:#1b1f23;font-size:11px;margin:0}
      h1{font-size:18px;margin:0;color:#1F5F96} .m{color:#5b6670;margin:2px 0 8px} .s{display:flex;gap:18px;flex-wrap:wrap;margin:0 0 10px;font-size:11.5px} .s b{color:#5b6670;font-weight:500;margin-right:4px}
      table{width:100%;border-collapse:collapse} th{background:#eef3f8;text-align:left;padding:5px 6px;border-bottom:1px solid #cbd5df} td{padding:4px 6px;border-bottom:1px solid #e3e8ee}
      .r{text-align:right;white-space:nowrap}
    </style></head><body><h1>SES EHR · ${esc(report.title)}</h1><div class="m">${esc(report.period)}${query ? ` · filtered by “${esc(query)}”` : ''}</div>
    <div class="s">${sums}</div><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    <script>window.onload=function(){window.focus();window.print();}</script></body></html>`);
    w.document.close();
  }

  const tone = (r: Record<string, any>, c: Col) => {
    if (c.key === 'state' && r['state'] === 'Expired') return { color: 'var(--badge-red-text)', fontWeight: 500 };
    if (c.key === 'days' && Number(r['days']) < 0) return { color: 'var(--badge-red-text)', fontWeight: 500 };
    if (c.key === 'expired' && Number(r[c.key]) > 0) return { color: 'var(--badge-red-text)', fontWeight: 500 };
    if (c.key === 'available' && Number(r[c.key]) <= 0) return { color: 'var(--badge-amber-text)', fontWeight: 500 };
    if (c.key === 'status' && r['status'] === 'Awaiting approval') return { color: 'var(--badge-amber-text)', fontWeight: 500 };
    return undefined;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{BILLING_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-heading)', margin: 0 }}>Stock reports</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="bl-btn" onClick={printReport} disabled={loading || !report}><Printer size={15} /> Print</button>
          <button type="button" className="bl-btn primary" onClick={exportXlsx} disabled={exporting || loading || !report}><Download size={15} /> {exporting ? 'Preparing…' : 'Export to Excel'}</button>
        </div>
      </div>

      <div className="bl-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div role="tablist" aria-label="Stock report" className="bl-seg">
          {REPORTS.map(r => <button key={r.id} type="button" role="tab" aria-selected={name === r.id} aria-checked={name === r.id} onClick={() => { setName(r.id); setText(''); setQuery(''); }}>{r.label}</button>)}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {HAS_PERIOD.includes(name) && (
            <>
              <div role="radiogroup" aria-label="Period" className="bl-seg">
                {([['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Custom']] as const).map(([k, l]) => (
                  <button key={k} type="button" role="radio" aria-checked={range === k} onClick={() => { setRange(k); if (k !== 'custom') setDates(preset(k)); }}>{l}</button>
                ))}
              </div>
              {range === 'custom' && (
                <>
                  <div><label className="bl-k" htmlFor="sr-from">From</label><input id="sr-from" type="date" className="bl-in" style={{ width: 160 }} value={dates.from} max={dates.to} onChange={e => e.target.value && setDates({ ...dates, from: e.target.value })} /></div>
                  <div><label className="bl-k" htmlFor="sr-to">To</label><input id="sr-to" type="date" className="bl-in" style={{ width: 160 }} value={dates.to} min={dates.from} onChange={e => e.target.value && setDates({ ...dates, to: e.target.value })} /></div>
                </>
              )}
            </>
          )}
          {name === 'on-hand' && (
            <div><label className="bl-k" htmlFor="sr-level">Show</label><select id="sr-level" className="bl-in" style={{ width: 190 }} value={level} onChange={e => setLevel(e.target.value)}>
              <option value="ALL">All products</option><option value="AVAILABLE">With usable stock</option><option value="OUT_OF_STOCK">Out of stock</option><option value="HAS_EXPIRED">Holding expired stock</option></select></div>
          )}
          {name === 'expiry' && (
            <>
              <div><label className="bl-k" htmlFor="sr-state">Status</label><select id="sr-state" className="bl-in" style={{ width: 170 }} value={state} onChange={e => setState(e.target.value)}>
                <option value="ALL">All statuses</option><option value="USABLE">Usable</option><option value="EXPIRED">Expired</option><option value="QUARANTINED">Quarantined</option><option value="INACTIVE">Inactive</option></select></div>
              <div><label className="bl-k" htmlFor="sr-within">Expiring within</label><select id="sr-within" className="bl-in" style={{ width: 170 }} value={within} onChange={e => setWithin(e.target.value)}>
                <option value="">Any time</option><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option><option value="180">180 days</option></select></div>
            </>
          )}
          {name === 'movements' && (
            <div><label className="bl-k" htmlFor="sr-type">Movement</label><select id="sr-type" className="bl-in" style={{ width: 170 }} value={type} onChange={e => setType(e.target.value)}>
              <option value="ALL">All movements</option><option value="RECEIVED">Received</option><option value="ISSUED">Issued</option><option value="LOSS">Losses</option><option value="ADJUSTMENT">Adjustments</option><option value="REVERSAL">Reversals</option></select></div>
          )}
          {name === 'adjustments' && (
            <div><label className="bl-k" htmlFor="sr-status">Status</label><select id="sr-status" className="bl-in" style={{ width: 190 }} value={status} onChange={e => setStatus(e.target.value)}>
              <option value="ALL">All requests</option><option value="PENDING">Awaiting approval</option><option value="POSTED">Approved</option><option value="REJECTED">Rejected</option><option value="CANCELLED">Cancelled</option></select></div>
          )}
        </div>
      </div>

      {error ? (
        <div className="bl-card" style={{ padding: '36px 20px', textAlign: 'center' }}><p className="bl-err" role="alert" style={{ margin: 0 }}>{error}</p></div>
      ) : !report ? (
        <div className="bl-card" style={{ padding: 20 }} aria-busy="true"><div style={{ height: 18, width: '40%', borderRadius: 6, background: 'var(--bg-surface-2)' }} /></div>
      ) : (
        <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .15s', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <h3 className="bl-h" style={{ fontSize: 16 }}>{report.title}</h3>
            <div className="bl-muted" style={{ fontSize: 13 }}>{report.period}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {report.summary.map(s => (
              <div key={s.label} className="bl-card" style={{ padding: '10px 14px' }}>
                <div className="bl-faint" style={{ fontSize: 11, fontWeight: 500, letterSpacing: '.05em', textTransform: 'uppercase' }}>{s.label}</div>
                <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-heading)' }}>{typeof s.value === 'number' ? s.value.toLocaleString('en-US') : s.value}</div>
              </div>
            ))}
          </div>
          <div className="bl-card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Search size={15} aria-hidden="true" style={{ color: 'var(--text-subtle)', flex: 'none' }} />
              <input className="bl-in" style={{ maxWidth: 320 }} placeholder="Search item, brand or batch…" aria-label="Search this report" value={text} onChange={e => setText(e.target.value)} maxLength={160} />
              <span className="bl-muted" style={{ fontSize: 12.5 }}>{report.rows.length.toLocaleString('en-US')} {report.rows.length === 1 ? 'row' : 'rows'}</span>
            </div>
            {report.rows.length === 0 ? (
              <p className="bl-muted" style={{ margin: 0, padding: '36px 16px', textAlign: 'center' }}>{query ? `Nothing matches “${query}”.` : 'Nothing to show.'}</p>
            ) : (
              <div style={{ overflowX: 'auto', maxHeight: '60vh' }}>
                <table className="bl-tbl" style={{ minWidth: 720 }}>
                  <thead><tr>{report.columns.map(c => <th key={c.key} className={isNum(c) ? 'bl-num' : ''} style={{ position: 'sticky', top: 0 }}>{c.header}</th>)}</tr></thead>
                  <tbody>
                    {report.rows.map((r, i) => (
                      <tr key={i}>{report.columns.map(c => <td key={c.key} className={isNum(c) ? 'bl-num' : ''} style={tone(r, c)}>{cell(c, r[c.key])}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
