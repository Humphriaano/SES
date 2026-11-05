import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import api from '../../api/client';

export interface ReportStart { report: 'expiry' | 'reorder'; within?: string; state?: string }
interface Alerts {
  attention: boolean;
  reorder: { out: number; reorderNow: number; items: { item: string; unit: string; available: number; coverDays: number | null; suggested: number | null; status: string }[] };
  expiry: { withinDays: number; batches: number; expiredWithStock: number; soonest: { item: string; brand: string; lot: string; days: number; quantity: number; unit: string }[] };
}
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const REFRESH_AFTER_MS = 30_000;

// A slim strip at the top of the Pharmacy page for what needs doing now. It uses the same figures as the stock
// reports, shows nothing when nothing needs attention (or if it cannot be read), and refreshes when the page
// opens or the window regains focus, not on a timer.
export default function StockAlerts({ onOpen }: { onOpen: (start: ReportStart) => void }) {
  const [data, setData] = useState<Alerts | null>(null);
  const last = useRef(0);
  useEffect(() => {
    let live = true;
    const load = () => {
      if (document.hidden || Date.now() - last.current < REFRESH_AFTER_MS) return;
      last.current = Date.now();
      api.get('/pharmacy-stock/alerts').then(r => { if (live) setData(r.data); }).catch(() => { last.current = 0; });
    };
    load();
    window.addEventListener('focus', load);
    return () => { live = false; window.removeEventListener('focus', load); };
  }, []);
  if (!data?.attention) return null;

  const { reorder, expiry } = data;
  const link = (label: string, start: ReportStart) => (
    <button type="button" onClick={() => onOpen(start)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--selection-text)', fontSize: 12, fontWeight: 500, cursor: 'pointer', textDecoration: 'underline' }}>{label}</button>
  );
  const segment = { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' as const };
  return (
    <section aria-label="Stock needing attention" style={{ margin: '12px 0 0', padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 14, background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <AlertTriangle size={15} aria-hidden="true" style={{ color: 'var(--badge-amber-text)', flex: 'none' }} />
        {(reorder.out > 0 || reorder.reorderNow > 0) && (
          <span style={segment}>
            {reorder.out > 0 && <b style={{ color: 'var(--badge-red-text)', fontWeight: 500 }}>{plural(reorder.out, 'medicine', 'medicines')} out of stock</b>}
            {reorder.reorderNow > 0 && <span style={{ color: 'var(--badge-amber-text)' }}>{plural(reorder.reorderNow, 'medicine', 'medicines')} to reorder</span>}
            {link('Reorder list', { report: 'reorder' })}
          </span>
        )}
        {expiry.batches > 0 && (
          <span style={segment}>
            <span style={{ color: 'var(--text-body2)' }}>{plural(expiry.batches, 'batch expires', 'batches expire')} within {expiry.withinDays} days</span>
            {link('Expiry list', { report: 'expiry', within: String(expiry.withinDays) })}
          </span>
        )}
        {expiry.expiredWithStock > 0 && (
          <span style={segment}>
            <b style={{ color: 'var(--badge-red-text)', fontWeight: 500 }}>{plural(expiry.expiredWithStock, 'expired batch', 'expired batches')} still holding stock</b>
            {link('Review', { report: 'expiry', state: 'EXPIRED' })}
          </span>
        )}
      </div>
      {(reorder.items.length > 0 || expiry.soonest.length > 0) && (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)' }}>Details</summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--text-body2)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {reorder.items.map(r => <li key={r.item + r.unit}>{r.item}: {r.status === 'Out of stock' ? 'out of stock' : `about ${r.coverDays} days left`}{r.suggested ? `, suggest ordering ${r.suggested.toLocaleString('en-US')} ${r.unit}` : ''}</li>)}
            {expiry.soonest.map(b => <li key={b.lot + b.item}>{b.item} ({b.brand}, lot {b.lot}): {b.quantity.toLocaleString('en-US')} {b.unit} expire in {b.days} {b.days === 1 ? 'day' : 'days'}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
