import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Wallet } from 'lucide-react';
import { useReport } from '../../hooks/useReport';
import { zmw } from '../../lib/money';
import { BarList } from './ReportPanels';

interface Figure { label: string; value: number | string; money?: boolean }
interface Tile { id: string; title: string; opens: string; figures: Figure[]; error?: string }
interface Billing {
  error?: string;
  collected?: { label: string; value: number }[]; collectedTotal?: number; creditUsed?: number;
  revenue?: { label: string; value: number }[]; charged?: number; discounts?: number; waived?: number;
  outstanding?: { label: string; value: number }[]; outstandingTotal?: number; invoices?: number; overdue?: number;
}
interface Summary { period: string; tiles: Tile[]; billing: Billing | null }
const NONE: Record<string, string> = {};

// The overview's summary: one tile per report area, and the billing snapshot for the people who may open billing. Every figure is read by the server from the
// report it opens, so it equals what that report shows. Selecting a tile opens that report's tab.
export default function OverviewSummary({ period, onOpen }: { period: { from: string; to: string }; onOpen: (tab: string) => void }) {
  const [reload, setReload] = useState(0);
  const params = useMemo(() => (period.from ? { from: period.from, to: period.to } : NONE), [period.from, period.to]);
  const { data, error, loading } = useReport<Summary>('/reports/hub/summary', params, reload);
  const retry = <button type="button" className="bl-btn sm" onClick={() => setReload(n => n + 1)}>Try again</button>;

  if (!data && !error) return <div className="rp-glance" aria-busy="true">{[0, 1, 2, 3].map(i => <div key={i} className="rp-tile" aria-hidden="true"><div className="rp-skel" style={{ height: 14, width: '40%', marginBottom: 12 }} /><div className="rp-skel" style={{ height: 70 }} /></div>)}</div>;
  if (!data) return <div className="rp-note bad" role="alert"><span>{error}</span>{retry}</div>;
  if (data.tiles.length === 0 && !data.billing) return null;
  const b = data.billing;
  const value = (f: Figure) => (typeof f.value === 'number' ? (f.money ? zmw(f.value) : f.value.toLocaleString()) : f.value);

  return (
    <section aria-label="Summary" aria-busy={loading} style={{ opacity: loading ? 0.55 : 1, marginBottom: 24 }}>
      {error && <div className="rp-note bad" role="alert"><span>{error} Showing the last figures.</span>{retry}</div>}
      {data.tiles.length > 0 && (
        <div className="rp-glance">
          {data.tiles.map(t => (
            <button key={t.id} type="button" className="rp-tile" onClick={() => onOpen(t.opens)} aria-label={`${t.title}: ${t.error ? 'could not load' : t.figures.map(f => `${f.label} ${value(f)}`).join(', ')}. Open.`}>
              <span className="rp-tile-head"><b>{t.title}</b><ChevronRight size={15} className="rp-kpi-go" aria-hidden="true" /></span>
              {t.error ? <span className="rp-sub">{t.error}</span> : (
                <dl>{t.figures.map(f => <div key={f.label}><dt>{f.label}</dt><dd>{value(f)}</dd></div>)}</dl>
              )}
            </button>
          ))}
        </div>
      )}

      {b && (
        <section className="rp-card" aria-label="Billing snapshot" style={{ marginTop: 14 }}>
          <div className="rp-card-head"><div><h2>Billing snapshot</h2><p className="rp-sub">{b.error ? '' : `${data.period}. Outstanding balances are as at today.`}</p></div>
            <Link to="/billing/reports" className="bl-btn sm rp-noprint" style={{ textDecoration: 'none' }}><Wallet size={14} /> Billing reports</Link></div>
          {b.error ? <p className="rp-empty">{b.error}</p> : (
            <div className="rp-three">
              <div><p className="rp-k">Collected by payment method</p>
                <BarList rows={(b.collected ?? []).map(r => ({ key: r.label, label: r.label, value: r.value }))} empty="Nothing collected." format={zmw} />
                <p className="rp-sub">Total collected <b>{zmw(b.collectedTotal)}</b>{b.creditUsed ? ` · account credit used ${zmw(b.creditUsed)} (not new money)` : ''}</p></div>
              <div><p className="rp-k">Revenue by service</p>
                <BarList rows={(b.revenue ?? []).map(r => ({ key: r.label, label: r.label, value: r.value }))} empty="Nothing charged." format={zmw} />
                <p className="rp-sub">Charged <b>{zmw(b.charged)}</b> · discounts {zmw(b.discounts)} · waived {zmw(b.waived)}</p></div>
              <div><p className="rp-k">Outstanding by age of invoice</p>
                <BarList rows={(b.outstanding ?? []).map(r => ({ key: r.label, label: r.label, value: r.value }))} empty="Nothing outstanding." format={zmw} />
                <p className="rp-sub">Outstanding <b>{zmw(b.outstandingTotal)}</b> on {(b.invoices ?? 0).toLocaleString()} {b.invoices === 1 ? 'invoice' : 'invoices'}{b.overdue ? ` · ${b.overdue} overdue` : ''}</p></div>
            </div>
          )}
        </section>
      )}
    </section>
  );
}
