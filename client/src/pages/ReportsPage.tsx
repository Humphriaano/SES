import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Users, Activity, Pill, Package, FlaskConical, Syringe, Wallet, Download, Printer, RefreshCw, ChevronRight } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { apiError, hasRole } from '../lib/money';
import { canAccessModule } from '../lib/moduleAccess';
import { DEFAULT_PERIOD, PERIOD_PRESETS, periodFor, periodId, periodProblem, rangeLabel, type PeriodChoice, type PeriodKey } from '../lib/reportPeriod';
import PeriodBar from '../components/reports/PeriodBar';
import { readSaved, writeSaved, type Overview } from '../lib/populationReport';
import { BILLING_CSS } from '../components/billing/ui';
import ReportsAIPanel from '../components/reports/ReportsAIPanel';
import { ChronicPanel, DiagnosesPanel, InvestigationsPanel, MedicinesPanel, PatientsPanel, ProceduresPanel } from '../components/reports/ReportPanels';
import './ReportsPage.css';

const PERIOD_KEY = 'ses.reports.period';
function savedChoice(): PeriodChoice {
  try {
    const raw = JSON.parse(localStorage.getItem(PERIOD_KEY) ?? 'null') as { key?: string; from?: string; to?: string } | null;
    const key = PERIOD_PRESETS.find(p => p.key === raw?.key)?.key;
    if (key) return periodFor(key, new Date(), key === 'custom' ? { from: String(raw?.from ?? ''), to: String(raw?.to ?? '') } : undefined);
  } catch { /* storage unavailable: use the default */ }
  return periodFor(DEFAULT_PERIOD);
}

interface Kpi { icon: ReactNode; value: string; label: string; sub?: string; to?: string }
function KpiCard({ k }: { k: Kpi }) {
  const body = (
    <>
      <div className="rp-kpi-icon" aria-hidden="true">{k.icon}{k.to && <ChevronRight size={15} className="rp-kpi-go" />}</div>
      <div className="rp-kpi-value">{k.value}</div>
      <div className="rp-kpi-label">{k.label}</div>
      {k.sub && <div className="rp-kpi-sub" title={k.sub}>{k.sub}</div>}
    </>
  );
  return k.to ? <Link to={k.to} className="rp-kpi" aria-label={`${k.label}: ${k.value}. ${k.sub ?? ''} Open.`}>{body}</Link> : <div className="rp-kpi">{body}</div>;
}
const KpiSkeleton = () => <div className="rp-kpi" aria-hidden="true"><div className="rp-skel" style={{ height: 14, width: 18, marginBottom: 10 }} /><div className="rp-skel" style={{ height: 26, width: 52, marginBottom: 8 }} /><div className="rp-skel" style={{ height: 12, width: '70%' }} /></div>;

function kpisFor(o: Overview, role: string | undefined): Kpi[] {
  const p = o.patients, w = o.procedures.waiting;
  return [
    { icon: <Users size={18} />, value: p.total.toLocaleString(), label: 'Patients', sub: p.newInPeriod === null ? `${p.female} female · ${p.male} male` : `${p.newInPeriod.toLocaleString()} new in period`, to: canAccessModule(role, 'home') ? '/patients' : undefined },
    { icon: <Activity size={18} />, value: o.diagnoses.total.toLocaleString(), label: 'Diagnoses recorded', sub: o.diagnoses.top[0]?.description ?? 'None in this period' },
    { icon: <Pill size={18} />, value: o.medications.prescriptions.toLocaleString(), label: 'Prescriptions', sub: 'Written in period', to: canAccessModule(role, 'pharmacy') ? '/pharmacy' : undefined },
    { icon: <Package size={18} />, value: o.medications.dispensed.toLocaleString(), label: 'Dispensed', sub: `${o.medications.dispensedToday.toLocaleString()} today`, to: canAccessModule(role, 'pharmacy') ? '/pharmacy' : undefined },
    { icon: <FlaskConical size={18} />, value: (o.investigations.waiting.pending + o.investigations.waiting.inProgress).toLocaleString(), label: 'Labs waiting now', sub: `${o.investigations.waiting.pending} pending · ${o.investigations.waiting.inProgress} in progress` },
    { icon: <Syringe size={18} />, value: o.procedures.done.toLocaleString(), label: 'Procedures done', sub: w.total ? `${w.total} waiting now${w.urgent ? `, ${w.urgent} urgent` : ''}` : 'None waiting now', to: canAccessModule(role, 'treatment') ? '/treatment-room' : undefined },
  ];
}

// An error answer sent as a file (the Excel export) arrives as a Blob: read the server's message out of it.
async function exportError(e: unknown): Promise<string> {
  const data = (e as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) { try { const msg = (JSON.parse(await data.text()) as { error?: string }).error; if (msg) return msg; } catch { /* not JSON */ } }
  return apiError(e, 'Could not build the Excel file. Check your connection and try again.');
}

interface Result { id: string; data?: Overview; error?: string; savedAt?: string }

export default function ReportsPage() {
  const { user } = useAuth();
  const [choice, setChoice] = useState<PeriodChoice>(savedChoice);
  const [reloads, setReloads] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [exporting, setExporting] = useState(false);

  const problem = choice.key === 'custom' ? periodProblem(choice.from, choice.to) : '';
  const id = periodId(choice);
  const userId = user?.id;
  const saved = useMemo(() => (problem ? null : readSaved(userId, id)), [problem, userId, id]);
  const current = result?.id === id ? result : null;
  const data = current?.data ?? saved?.data;
  const savedAt = current?.savedAt ?? saved?.savedAt;
  const loading = !problem && !current;

  useEffect(() => {
    if (problem) return;
    let alive = true;
    api.get<Overview>('/reports/population/overview', { params: choice.from ? { from: choice.from, to: choice.to } : {} })
      .then(res => { if (alive) { writeSaved(userId, id, res.data); setResult({ id, data: res.data }); } })
      .catch(e => { if (alive) { const copy = readSaved(userId, id); setResult({ id, data: copy?.data, savedAt: copy?.savedAt, error: apiError(e, 'Could not load the reports. Check your connection and try again.') }); } });
    return () => { alive = false; };
  }, [id, problem, choice.from, choice.to, userId, reloads]);
  useEffect(() => {   // a lost connection coming back refreshes whatever failed
    const again = () => setReloads(n => n + 1);
    window.addEventListener('online', again);
    return () => window.removeEventListener('online', again);
  }, []);

  function pick(key: PeriodKey) {
    const next = periodFor(key, new Date(), key === 'custom' ? { from: choice.from, to: choice.to } : undefined);
    setChoice(next);
    try { localStorage.setItem(PERIOD_KEY, JSON.stringify(next)); } catch { /* the choice just is not remembered */ }
  }
  function setDate(which: 'from' | 'to', value: string) {
    const next = { ...choice, [which]: value };
    setChoice(next);
    try { localStorage.setItem(PERIOD_KEY, JSON.stringify(next)); } catch { /* not remembered */ }
  }
  async function exportExcel() {
    if (exporting || problem) return;
    setExporting(true);
    try {
      const res = await api.get('/reports/population/export', { params: choice.from ? { from: choice.from, to: choice.to } : {}, responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob), a = document.createElement('a');
      a.href = url; a.download = `ses-reports-${choice.from ? `${choice.from}${choice.to !== choice.from ? `_to_${choice.to}` : ''}` : 'all-time'}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { toast.error(await exportError(e)); } finally { setExporting(false); }
  }

  const kpis = data ? kpisFor(data, user?.role) : [];
  const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const showingCopy = !!data && !current?.data;   // saved figures on screen while a fresh copy loads, or after it failed
  const dim = loading && !!data;

  return (
    <div className="reports-page clinical-module">
      <style>{BILLING_CSS}</style>

      <div className="reports-header">
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-heading)', margin: '0 0 2px' }}>Reports & Analytics</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            Counts for all patients · {rangeLabel(choice.from, choice.to)}{current?.data ? ` · updated ${when(current.data.generatedAt)}` : ''}
          </p>
        </div>
        <div className="rp-noprint" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="bl-btn" onClick={() => setReloads(n => n + 1)} disabled={loading || !!problem} aria-label="Refresh the figures"><RefreshCw size={15} /> Refresh</button>
          <button type="button" className="bl-btn" onClick={() => window.print()} disabled={!data || !!problem}><Printer size={15} /> Print</button>
          <button type="button" className="bl-btn" onClick={() => void exportExcel()} disabled={exporting || !!problem} aria-busy={exporting}><Download size={15} /> {exporting ? 'Preparing…' : 'Export to Excel'}</button>
          {hasRole(user?.role, 'admin', 'billing') && <Link to="/billing/reports" className="bl-btn" style={{ textDecoration: 'none' }}><Wallet size={15} /> Billing reports</Link>}
        </div>
      </div>

      <PeriodBar choice={choice} problem={problem} onPick={pick} onDate={setDate} />
      {current?.error && (
        <div className="rp-note bad" role="alert">
          <span>{current.error}{data && savedAt ? ` Showing the copy saved ${when(savedAt)}.` : ''}</span>
          <button type="button" className="bl-btn sm" onClick={() => setReloads(n => n + 1)}>Try again</button>
        </div>
      )}
      {!current?.error && showingCopy && !loading && savedAt && <div className="rp-note" role="status">Showing the copy saved {when(savedAt)}.</div>}

      <div className="reports-kpis" aria-busy={loading}>
        {kpis.length ? kpis.map(k => <KpiCard key={k.label} k={k} />) : Array.from({ length: 6 }, (_, i) => <KpiSkeleton key={i} />)}
      </div>

      <div className="reports-columns">
        <div className="reports-insights" style={{ opacity: dim ? 0.55 : 1 }} aria-busy={loading}>
          {data ? (
            <>
              <ChronicPanel o={data} />
              <DiagnosesPanel o={data} />
              <ProceduresPanel o={data} roomLink={canAccessModule(user?.role, 'treatment')} />
              <MedicinesPanel o={data} />
              <InvestigationsPanel o={data} />
              <PatientsPanel o={data} />
            </>
          ) : problem ? null : current?.error ? (
            <div className="rp-card"><p className="rp-empty">No figures to show yet. Use Try again above.</p></div>
          ) : (
            [150, 220, 180].map(h => <div key={h} className="rp-card" aria-hidden="true"><div className="rp-skel" style={{ height: 16, width: '35%', marginBottom: 14 }} /><div className="rp-skel" style={{ height: h }} /></div>)
          )}
        </div>

        <div className="reports-chat">
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', boxShadow: '0 1px 4px var(--shadow-sm)' }}>
            <ReportsAIPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
