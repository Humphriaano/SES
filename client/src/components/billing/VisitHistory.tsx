import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import api from '../../api/client';
import { plain, zmw } from '../../lib/money';
import { Pill } from './ui';

interface Item { id: string; description: string; sourceType: string; quantity: number; unitPrice: number | null; lineTotal: number | null }
interface InvRef { id: string; number: string; status: 'OPEN' | 'PART_PAID' | 'PAID' | 'VOID' | 'WAIVED'; payable: number; paid: number; balance: number; overdue: boolean }
interface Group { charged: number; unpriced: number; items: Item[]; invoices: InvRef[] }
interface Visit extends Group { id: string; date: string; status: string; reason: string | null; clinician: string | null; diagnoses: string[] }
interface History { visits: Visit[]; other: Group | null }

const STATUS: Record<InvRef['status'], { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' | 'blue' }> = {
  OPEN: { label: 'Not paid yet', tone: 'warn' }, PART_PAID: { label: 'Part paid', tone: 'blue' }, PAID: { label: 'Paid', tone: 'ok' }, VOID: { label: 'Void', tone: 'muted' }, WAIVED: { label: 'Waived', tone: 'muted' },
};
const day = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

// The patient's past visits: what each was for, what was charged, and the invoices those charges sit on.
export default function VisitHistory({ patientId, refreshKey }: { patientId: string; refreshKey: unknown }) {
  const [data, setData] = useState<History | null>(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let live = true;
    api.get(`/patients/${patientId}/visit-history`)
      .then((r) => { if (live) { setData(r.data); setFailed(false); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [patientId, refreshKey]);

  if (failed && !data) return <div className="bl-card" style={{ padding: 16 }}><p className="bl-muted" style={{ margin: 0 }}>Couldn’t load the visit history.</p></div>;
  if (!data) return <div className="bl-card" style={{ padding: 16 }} aria-busy="true"><div style={{ height: 16, width: '30%', borderRadius: 6, background: 'var(--bg-surface-2)' }} /></div>;
  if (data.visits.length === 0 && !data.other) return null;

  const visits = all ? data.visits : data.visits.slice(0, 5);

  const row = (key: string, title: string, sub: string, g: Group, tag?: string) => {
    const open = openId === key;
    return (
      <div key={key} style={{ borderTop: '1px solid var(--border)' }}>
        <button type="button" onClick={() => setOpenId(open ? null : key)} aria-expanded={open}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'none', border: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit', flexWrap: 'wrap' }}>
          <ChevronDown size={15} aria-hidden="true" style={{ flex: 'none', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .15s', color: 'var(--text-subtle)' }} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 500, color: 'var(--text-heading)', fontSize: 14 }}>{title}{tag && <span className="bl-faint" style={{ fontWeight: 500 }}> · {tag}</span>}</div>
            <div className="bl-muted" style={{ fontSize: 12.5 }}>{sub}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {g.invoices.map((i) => <Pill key={i.id} tone={i.overdue ? 'bad' : STATUS[i.status].tone}>{i.number} · {i.overdue ? 'Overdue' : STATUS[i.status].label}</Pill>)}
          </div>
          <div style={{ textAlign: 'right', minWidth: 100, fontWeight: 500, color: 'var(--text-heading)' }}>{g.items.length ? zmw(g.charged) : '—'}</div>
        </button>
        {open && (
          <div style={{ padding: '0 16px 14px 43px' }}>
            {g.items.length === 0 ? <p className="bl-muted" style={{ margin: 0, fontSize: 13 }}>Nothing was charged for this visit.</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="bl-tbl" style={{ minWidth: 420 }}>
                  <thead><tr><th>Charge</th><th className="bl-num">Qty</th><th className="bl-num">Amount</th></tr></thead>
                  <tbody>
                    {g.items.map((it) => (
                      <tr key={it.id}><td>{it.description}{it.unitPrice === null && <> <Pill tone="bad">No price</Pill></>}</td><td className="bl-num">{it.quantity}</td><td className="bl-num">{plain(it.lineTotal)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {g.invoices.length > 0 && (
              <div className="bl-muted" style={{ fontSize: 12.5, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {g.invoices.map((i) => (
                  <span key={i.id}>{i.number}: paid {zmw(i.paid)} of {zmw(i.payable)}{i.balance > 0 && i.status !== 'VOID' && i.status !== 'WAIVED' ? <b style={{ color: 'var(--badge-red-text)' }}> · {zmw(i.balance)} owing</b> : ''}</span>
                ))}
                {g.invoices.length > 0 && <span className="bl-faint">Payments are recorded per invoice; an invoice can cover more than one visit.</span>}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="bl-card" aria-label="Visit history" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px' }}>
        <h3 className="bl-h" style={{ fontSize: 15 }}>Visit history</h3>
        <div className="bl-muted" style={{ fontSize: 12.5 }}>What each visit was for, what was charged and where it was billed.</div>
      </div>
      {visits.map((v) => row(
        v.id, day(v.date),
        [v.reason, v.diagnoses.slice(0, 2).join(', '), v.clinician && `seen by ${v.clinician}`].filter(Boolean).join(' · ') || 'No details recorded',
        v, v.status === 'OPEN' ? 'open' : undefined,
      ))}
      {data.visits.length > 5 && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '8px 16px' }}>
          <button type="button" className="bl-btn sm" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${data.visits.length} visits`}</button>
        </div>
      )}
      {data.other && row('other', 'Other charges', 'Not tied to a visit (added by hand)', data.other)}
    </section>
  );
}
