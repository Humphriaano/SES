import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePatient } from '../context/PatientContext';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { ArrowLeft, Download, Printer, Search, Share2 } from 'lucide-react';
import api from '../api/client';
import { apiError, plain } from '../lib/money';
import { BILLING_CSS } from '../components/billing/ui';
import { printReceipt } from '../components/billing/receipt';
import { staffDisplayName } from '../lib/staffNames';
import { shareBillingReport } from '../lib/shareBillingReport';

interface Col { key: string; header: string; type: 'text' | 'money' | 'int' | 'number' | 'date'; width: number }
interface Report {
  name: string; title: string; period: string; columns: Col[]; rows: Record<string, any>[];
  totals: Record<string, any> | null; summary: { label: string; value: number | string; money?: boolean }[];
}

const REPORTS = [
  { id: 'daybook', label: 'Day book' }, { id: 'revenue', label: 'Revenue by service' },
  { id: 'outstanding', label: 'Outstanding balances' }, { id: 'collections', label: 'Collections by staff' },
  { id: 'fast-moving', label: 'Fast-moving items' },
];
const SERVICES = [['', 'All services'], ['CONSULTATION', 'Consultation'], ['PRESCRIPTION', 'Drugs'], ['INVESTIGATION', 'Investigations'], ['PROCEDURE', 'Procedures'], ['MANUAL', 'Other charges']];
const METHODS = [['', 'All methods'], ['CASH', 'Cash'], ['MOBILE_MONEY', 'Mobile money'], ['CARD', 'Card'], ['CREDIT', 'Account credit']];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function preset(p: string): { from: string; to: string } {
  const now = new Date();
  if (p === 'week') { const s = new Date(now); s.setDate(now.getDate() - ((now.getDay() + 6) % 7)); return { from: iso(s), to: iso(now) }; }   // Monday to today
  if (p === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  return { from: iso(now), to: iso(now) };
}

export default function BillingReportsPage() {
  const { user } = useAuth();
  const [name, setName] = useState('daybook');
  const [range, setRange] = useState<'today' | 'week' | 'month' | 'custom'>('today');
  const [dates, setDates] = useState(preset('today'));
  const [service, setService] = useState('');
  const [rankBy, setRankBy] = useState('charges');
  const [method, setMethod] = useState('');
  const [cashier, setCashier] = useState('');
  const [cashiers, setCashiers] = useState<{ id: string; name: string }[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [search, setSearch] = useState('');
  const { setActivePatient } = usePatient();
  const navigate = useNavigate();

  useEffect(() => { api.get('/billing/reports/cashiers').then((r) => setCashiers(r.data)).catch(() => setCashiers([])); }, []);

  const params = useCallback(() => ({
    from: dates.from, to: dates.to, ...(service && ['revenue', 'daybook', 'fast-moving'].includes(name) ? { service } : {}),
    ...(name === 'fast-moving' ? { sort: rankBy } : {}),
    ...(method && name === 'daybook' ? { method } : {}), ...(cashier && name === 'daybook' ? { cashier } : {}),
  }), [dates, service, method, cashier, name, rankBy]);

  useEffect(() => {
    let live = true;
    setLoading(true); setError('');
    api.get(`/billing/reports/${name}`, { params: params() })
      .then((r) => { if (live) setReport(r.data); })
      .catch((e) => { if (live) { setError(apiError(e, 'Couldn’t load the report.')); setReport(null); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [name, params]);

  async function exportXlsx() {
    setExporting(true);
    try {
      const res = await api.get(`/billing/reports/${name}`, { params: { ...params(), format: 'xlsx' }, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = `ses-${name}-${dates.to}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast.error(apiError(e, 'Couldn’t export the report.')); } finally { setExporting(false); }
  }

  const cell = (c: Col, v: any) => {
    if (v === null || v === undefined || v === '') return '—';
    if (c.type === 'money') return plain(v);
    if (c.type === 'int' || c.type === 'number') return Number(v).toLocaleString('en-US');
    if (c.type === 'date') return new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', ...(c.key === 'time' ? { hour: '2-digit', minute: '2-digit' } : {}) });
    return String(v);
  };
  const isNum = (c: Col) => c.type === 'money' || c.type === 'int' || c.type === 'number';
  const showRange = name !== 'outstanding';

  // Search narrows the rows on screen (any column); the totals row and the Excel export always cover the whole report.
  const term = search.trim().toLowerCase();
  const shown = !report ? [] : term
    ? report.rows.filter((r) => report.columns.some((c) => c.type !== 'date' && String(r[c.key] ?? '').toLowerCase().includes(term)))
    : report.rows;

  async function shareReport() {
    if (!report) return;
    setSharing(true);
    try {
      const result = await shareBillingReport({ report, rows: shown, generatedBy: staffDisplayName(user?.name, user?.designation), search: search.trim() });
      if (result === 'downloaded') toast.success('PDF downloaded for sharing.');
    } catch (error) { toast.error(apiError(error, 'Couldn’t prepare the report for sharing.')); }
    finally { setSharing(false); }
  }

  // Opens the patient (as if searched for) on their billing page.
  async function openPatient(id: string) {
    try {
      const { data } = await api.get(`/patients/${id}`);
      setActivePatient(data);
      navigate(`/patient/${id}/billing`);
    } catch (e) { toast.error(apiError(e, 'Couldn’t open that patient.')); }
  }

  async function printRow(id: string) {
    try { if (!(await printReceipt(id, staffDisplayName(user?.name, user?.designation)))) toast.error('Allow pop-ups for this site to print.'); } catch (e) { toast.error(apiError(e, 'Couldn’t load the receipt.')); }
  }

  // Prints the report as it is on screen (filtered rows, with the totals).
  function printReport() {
    if (!report) return;
    const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));
    const head = report.columns.map((c) => `<th class="${isNum(c) ? 'r' : ''}">${esc(c.header)}</th>`).join('');
    const body = shown.map((r) => `<tr class="${r['status'] === 'Void' ? 'v' : ''}">${report.columns.map((c) => `<td class="${isNum(c) ? 'r' : ''}">${esc(cell(c, r[c.key]))}</td>`).join('')}</tr>`).join('');
    const foot = report.totals ? `<tr class="t">${report.columns.map((c) => `<td class="${isNum(c) ? 'r' : ''}">${report.totals![c.key] !== undefined ? esc(cell(c, report.totals![c.key])) : ''}</td>`).join('')}</tr>` : '';
    const sums = report.summary.map((s) => `<span><b>${esc(s.label)}</b> ${esc(typeof s.value === 'number' ? (s.money ? plain(s.value) : s.value.toLocaleString('en-US')) : s.value)}</span>`).join('');
    const w = window.open('', '_blank', 'width=1100,height=800');
    if (!w) { toast.error('Allow pop-ups for this site to print.'); return; }
    w.document.open();
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(report.title)}</title><style>
      @page{size:A4 landscape;margin:12mm} body{font-family:Segoe UI,Arial,sans-serif;color:#1b1f23;font-size:11px;margin:0}
      h1{font-size:18px;margin:0;color:#1F5F96} .m{color:#5b6670;margin:2px 0 8px} .s{display:flex;gap:18px;flex-wrap:wrap;margin:0 0 10px;font-size:11.5px} .s b{color:#5b6670;font-weight:500;margin-right:4px}
      table{width:100%;border-collapse:collapse} th{background:#eef3f8;text-align:left;padding:5px 6px;border-bottom:1px solid #cbd5df} td{padding:4px 6px;border-bottom:1px solid #e3e8ee}
      .r{text-align:right;white-space:nowrap} .v td{color:#8a949e;text-decoration:line-through} .t td{font-weight:500;border-top:2px solid #1F5F96}
    </style></head><body><h1>SES EHR · ${esc(report.title)}</h1><div class="m">${esc(report.period)}${term ? ` · filtered by “${esc(search.trim())}”` : ''}</div>
    <div class="s">${sums}</div><table><thead><tr>${head}</tr></thead><tbody>${body}${foot}</tbody></table>
    <script>window.onload=function(){window.focus();window.print();}</script></body></html>`);
    w.document.close();
  }

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{BILLING_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link to="/billing" className="bl-x" aria-label="Back to Billing" title="Billing" style={{ display: 'flex' }}><ArrowLeft size={18} /></Link>
          <h2 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-heading)', margin: 0 }}>Billing reports</h2>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="bl-btn" onClick={shareReport} disabled={sharing || loading || !report}><Share2 size={15} /> {sharing ? 'Preparing…' : 'Share'}</button>
          <button type="button" className="bl-btn" onClick={printReport} disabled={loading || !report}><Printer size={15} /> Print</button>
          <button type="button" className="bl-btn primary" onClick={exportXlsx} disabled={exporting || loading || !report}><Download size={15} /> {exporting ? 'Preparing…' : 'Export to Excel'}</button>
        </div>
      </div>

      <div className="bl-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div role="tablist" aria-label="Report" className="bl-seg">
          {REPORTS.map((r) => <button key={r.id} type="button" role="tab" aria-checked={name === r.id} aria-selected={name === r.id} onClick={() => { setName(r.id); setSearch(''); }}>{r.label}</button>)}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {showRange && (
            <>
              <div role="radiogroup" aria-label="Period" className="bl-seg">
                {([['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Custom']] as const).map(([k, l]) => (
                  <button key={k} type="button" role="radio" aria-checked={range === k} onClick={() => { setRange(k); if (k !== 'custom') setDates(preset(k)); }}>{l}</button>
                ))}
              </div>
              {range === 'custom' && (
                <>
                  <div><label className="bl-k" htmlFor="r-from">From</label><input id="r-from" type="date" className="bl-in" style={{ width: 160 }} value={dates.from} max={dates.to} onChange={(e) => e.target.value && setDates({ ...dates, from: e.target.value })} /></div>
                  <div><label className="bl-k" htmlFor="r-to">To</label><input id="r-to" type="date" className="bl-in" style={{ width: 160 }} value={dates.to} min={dates.from} onChange={(e) => e.target.value && setDates({ ...dates, to: e.target.value })} /></div>
                </>
              )}
            </>
          )}
          {['daybook', 'revenue', 'fast-moving'].includes(name) && (
            <div><label className="bl-k" htmlFor="r-svc">Service</label><select id="r-svc" className="bl-in" style={{ width: 170 }} value={service} onChange={(e) => setService(e.target.value)}>{SERVICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          )}
          {name === 'fast-moving' && (
            <div><label className="bl-k" htmlFor="r-rank">Rank by</label><select id="r-rank" className="bl-in" style={{ width: 180 }} value={rankBy} onChange={e => setRankBy(e.target.value)}><option value="charges">Times charged</option><option value="quantity">Quantity charged</option><option value="value">Billed value</option></select></div>
          )}
          {name === 'daybook' && (
            <>
              <div><label className="bl-k" htmlFor="r-met">Payment method</label><select id="r-met" className="bl-in" style={{ width: 170 }} value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
              <div><label className="bl-k" htmlFor="r-cash">Cashier</label><select id="r-cash" className="bl-in" style={{ width: 170 }} value={cashier} onChange={(e) => setCashier(e.target.value)}><option value="">All cashiers</option>{cashiers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            </>
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
            {report.summary.map((s) => (
              <div key={s.label} className="bl-card" style={{ padding: '10px 14px' }}>
                <div className="bl-faint" style={{ fontSize: 11, fontWeight: 500, letterSpacing: '.05em', textTransform: 'uppercase' }}>{s.label}</div>
                <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-heading)' }}>{typeof s.value === 'number' ? (s.money ? plain(s.value) : s.value.toLocaleString('en-US')) : s.value}</div>
              </div>
            ))}
          </div>
          <div className="bl-card" style={{ overflow: 'hidden' }}>
            {report.rows.length > 0 && (
              <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Search size={15} aria-hidden="true" style={{ color: 'var(--text-subtle)', flex: 'none' }} />
                <input className="bl-in" style={{ maxWidth: 320 }} placeholder="Search this report…" aria-label="Search this report" value={search} onChange={(e) => setSearch(e.target.value)} />
                {term && <span className="bl-muted" style={{ fontSize: 12.5 }}>{shown.length} of {report.rows.length}</span>}
              </div>
            )}
            {report.rows.length === 0 ? (
              <p className="bl-muted" style={{ margin: 0, padding: '36px 16px', textAlign: 'center' }}>Nothing to show for this period.</p>
            ) : shown.length === 0 ? (
              <p className="bl-muted" style={{ margin: 0, padding: '36px 16px', textAlign: 'center' }}>No rows match “{search.trim()}”.</p>
            ) : (
              <div style={{ overflowX: 'auto', maxHeight: '60vh' }}>
                <table className="bl-tbl" style={{ minWidth: 720 }}>
                  <thead><tr>{report.columns.map((c) => <th key={c.key} className={isNum(c) ? 'bl-num' : ''} style={{ position: 'sticky', top: 0 }}>{c.header}</th>)}{name === 'daybook' && <th style={{ position: 'sticky', top: 0, width: 44 }} />}</tr></thead>
                  <tbody>
                    {shown.map((r, i) => (
                      <tr key={i} className={r['status'] === 'Void' ? 'void' : ''}>
                        {report.columns.map((c) => <td key={c.key} className={isNum(c) ? 'bl-num' : ''} style={r['status'] === 'Overdue' && c.key === 'status' ? { color: 'var(--badge-red-text)', fontWeight: 500 } : c.key === 'balance' && Number(r[c.key]) > 0 ? { color: 'var(--badge-red-text)', fontWeight: 500 } : undefined}>{c.key === 'patient' && r['patientId'] ? <button type="button" onClick={() => openPatient(String(r['patientId']))} title="Open this patient" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 500, color: 'var(--ws-link)', cursor: 'pointer', textAlign: 'left' }}>{cell(c, r[c.key])}</button> : cell(c, r[c.key])}</td>)}
                        {name === 'daybook' && <td style={{ textAlign: 'right' }}>{r['id'] ? <button type="button" className="bl-x" style={{ display: 'inline-flex' }} aria-label={`Print receipt ${r['receipt']}`} title="Print receipt" onClick={() => printRow(String(r['id']))}><Printer size={14} /></button> : null}</td>}
                      </tr>
                    ))}
                  </tbody>
                  {report.totals && (
                    <tfoot><tr>{report.columns.map((c) => <td key={c.key} className={isNum(c) ? 'bl-num' : ''} style={{ fontWeight: 500, color: 'var(--text-heading)', borderTop: '2px solid var(--border)' }}>{report.totals![c.key] !== undefined ? cell(c, report.totals![c.key]) : ''}</td>)}{name === 'daybook' && <td style={{ borderTop: '2px solid var(--border)' }} />}</tr></tfoot>
                  )}
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
