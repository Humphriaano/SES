import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, Search } from 'lucide-react';
import api from '../api/client';
import { BillingItem } from '../types';
import { useAuth } from '../context/AuthContext';
import { apiError, hasRole, plain, zmw } from '../lib/money';
import { BILLING_CSS, Modal } from '../components/billing/ui';
import InvoiceCard, { Invoice } from '../components/billing/InvoiceCard';
import VisitHistory from '../components/billing/VisitHistory';
import SessionBar, { useCashierSession } from '../components/billing/SessionBar';

interface PriceHit { id: string; name: string; detail: string | null; unit: string; unitPrice: number | null; itemType: string }

export default function BillingPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const { user } = useAuth();
  const isAdmin = hasRole(user?.role, 'admin');
  const isStaff = hasRole(user?.role, 'admin', 'billing', 'receptionist');   // may take payments and add charges
  const { session, refresh: refreshSession } = useCashierSession();

  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [credit, setCredit] = useState(0);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState<{ id?: string; number?: string } | null>(null);
  const [legacy, setLegacy] = useState<BillingItem[]>([]);

  const load = useCallback(async () => {
    if (!patientId) return;
    try {
      const { data } = await api.get(`/patients/${patientId}/invoices`);
      setInvoices(data.invoices); setCredit(data.credit); setFailed(false);
    } catch { setFailed(true); }
    api.get(`/patients/${patientId}/billing`).then((r) => setLegacy(r.data)).catch(() => setLegacy([]));
    refreshSession();
    window.dispatchEvent(new Event('billing-changed'));   // lets the patient banner refresh the balance
  }, [patientId, refreshSession]);

  useEffect(() => { setInvoices(null); setAdding(null); load(); }, [load]);

  const live = (invoices ?? []).filter((i) => i.status !== 'VOID' && i.status !== 'WAIVED');
  const charged = live.reduce((s, i) => s + i.payable, 0);
  const paid = live.reduce((s, i) => s + Math.min(i.paid, i.payable), 0);
  const owing = live.reduce((s, i) => s + Math.max(i.balance, 0), 0);

  async function legacyStatus(id: string, status: 'PAID' | 'WAIVED') {
    try { await api.patch(`/billing/${id}/status`, { status }); load(); toast.success(status === 'PAID' ? 'Marked as paid' : 'Waived'); }
    catch (e) { toast.error(apiError(e)); }
  }
  const legacyPending = legacy.filter((i) => i.status === 'PENDING');

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{BILLING_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-heading)', margin: 0 }}>Billing</h2>
        {isStaff && <Link to="/billing" className="bl-btn" style={{ textDecoration: 'none' }}>Overview</Link>}
      </div>

      {isStaff && <SessionBar session={session} onChange={refreshSession} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <Stat label="Charged" value={zmw(charged)} />
        <Stat label="Paid" value={zmw(paid)} tone="ok" />
        <Stat label="Owing" value={zmw(owing)} tone={owing > 0 ? 'bad' : 'ok'} />
        {credit > 0 && <Stat label="Credit on account" value={zmw(credit)} tone="ok" />}
      </div>

      {isStaff && invoices && !failed && !invoices.some(inv => inv.status === 'OPEN' && !inv.lockedAt) && (
        <section className="bl-card" aria-label="New invoice" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h3 className="bl-h">New invoice</h3>
          <button type="button" className="bl-btn" onClick={() => setAdding({})}><Plus size={15} /> Add first charge</button>
        </section>
      )}

      {failed && !invoices ? (
        <div className="bl-card" style={{ padding: '40px 20px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px', fontWeight: 500, color: 'var(--text-heading)' }}>Couldn’t load the invoices</p>
          <p className="bl-muted" style={{ margin: '0 0 14px' }}>Check your connection, then try again.</p>
          <button type="button" className="bl-btn" onClick={load}>Try again</button>
        </div>
      ) : invoices === null ? (
        <div className="bl-card" style={{ padding: 20 }} aria-busy="true"><div style={{ height: 18, width: '40%', borderRadius: 6, background: 'var(--bg-surface-2)' }} /></div>
      ) : invoices.length === 0 ? null : (
        invoices.map((inv, i) => (
          <InvoiceCard key={inv.id} invoice={inv} isAdmin={isAdmin} canTakePayment={isStaff} session={session} credit={credit}
            defaultOpen={i === 0 || inv.status === 'OPEN' || inv.status === 'PART_PAID'} onChange={load} onAddCharge={() => setAdding({ id: inv.id, number: inv.number })} />
        ))
      )}

      {patientId && <VisitHistory patientId={patientId} refreshKey={invoices} />}

      {legacy.length > 0 && (
        <details className="bl-card" style={{ padding: '12px 16px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 500, color: 'var(--text-heading)', fontSize: 14 }}>Earlier records ({legacy.length}){legacyPending.length > 0 && <span style={{ color: 'var(--badge-red-text)' }}> · {legacyPending.length} unpaid</span>}</summary>
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table className="bl-tbl" style={{ minWidth: 480 }}>
              <thead><tr><th>Description</th><th>Date</th><th>Status</th><th className="bl-num">Amount</th><th /></tr></thead>
              <tbody>
                {legacy.map((l) => (
                  <tr key={l.id}>
                    <td>{l.description}</td><td>{new Date(l.createdAt).toLocaleDateString('en-GB')}</td><td>{l.status}</td><td className="bl-num">{plain(l.amount)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {isStaff && l.status === 'PENDING' && <>
                        <button type="button" className="bl-btn sm" onClick={() => legacyStatus(l.id, 'PAID')}>Mark paid</button>{' '}
                        <button type="button" className="bl-btn sm" onClick={() => legacyStatus(l.id, 'WAIVED')}>Waive</button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {adding && patientId && <AddChargeDialog patientId={patientId} invoiceId={adding.id} invoiceNumber={adding.number} onClose={() => setAdding(null)} onDone={() => { setAdding(null); load(); }} />}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="bl-card" style={{ padding: '12px 16px' }}>
      <div className="bl-faint" style={{ fontSize: 11, fontWeight: 500, letterSpacing: '.06em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 500, marginTop: 2, color: tone === 'bad' ? 'var(--badge-red-text)' : tone === 'ok' ? 'var(--badge-green-text)' : 'var(--text-heading)' }}>{value}</div>
    </div>
  );
}

// Adds a charge the system didn't pick up: search the price list, or type a description and price.
function AddChargeDialog({ patientId, invoiceId, invoiceNumber, onClose, onDone }: { patientId: string; invoiceId?: string; invoiceNumber?: string; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PriceHit[]>([]);
  const [picked, setPicked] = useState<PriceHit | null>(null);
  const [description, setDescription] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reqRef = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2 || picked) { setHits([]); return; }
    const id = ++reqRef.current;
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/price-list', { params: { q: term, active: 'yes', take: 8 } });
        if (id === reqRef.current) setHits(data.items);
      } catch { if (id === reqRef.current) setHits([]); }
    }, 200);
    return () => clearTimeout(t);
  }, [q, picked]);

  function pick(h: PriceHit) {
    setPicked(h); setQ(h.name); setDescription([h.name, h.detail].filter(Boolean).join(' · ')); setPrice(h.unitPrice === null ? '' : h.unitPrice.toFixed(2)); setHits([]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await api.post(`/patients/${patientId}/invoice-lines`, { description, quantity: qty, unitPrice: price, priceItemId: picked?.id, ...(invoiceId ? { invoiceId } : {}) });
      toast.success('Charge added'); onDone();
    } catch (err) { setError(apiError(err, 'Couldn’t add the charge.')); } finally { setBusy(false); }
  }

  return (
    <Modal title={invoiceNumber ? `Add a charge · ${invoiceNumber}` : 'New invoice · Add first charge'} onClose={onClose} busy={busy}>
      <form onSubmit={submit}>
        <div className="bl-mb">
          <div style={{ position: 'relative' }}>
            <label className="bl-k" htmlFor="a-q">Find on the price list <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· optional</span></label>
            <div style={{ position: 'relative' }}>
              <Search size={15} aria-hidden="true" style={{ position: 'absolute', left: 11, top: 12, color: 'var(--text-subtle)' }} />
              <input id="a-q" className="bl-in" style={{ paddingLeft: 32 }} autoFocus autoComplete="off" value={q} placeholder="e.g. dressing, X-ray" onChange={(e) => { setQ(e.target.value); setPicked(null); }} />
            </div>
            {hits.length > 0 && (
              <div role="listbox" style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, top: '100%', marginTop: 4, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.14)', maxHeight: 220, overflowY: 'auto' }}>
                {hits.map((h) => (
                  <button key={h.id} type="button" role="option" aria-selected="false" onClick={() => pick(h)}
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 10, width: '100%', textAlign: 'left', padding: '8px 12px', border: 0, borderBottom: '1px solid var(--border-light)', background: 'none', cursor: 'pointer', font: 'inherit', fontSize: 13, color: 'var(--text-heading)' }}>
                    <span>{h.name}{h.detail && <span className="bl-faint"> · {h.detail}</span>}</span>
                    <b>{h.unitPrice === null ? 'no price' : plain(h.unitPrice)}</b>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div><label className="bl-k" htmlFor="a-d">Description</label><input id="a-d" className="bl-in" maxLength={200} value={description} onChange={(e) => { setDescription(e.target.value); setError(''); }} /></div>
          <div className="bl-row">
            <div><label className="bl-k" htmlFor="a-n">Quantity</label><input id="a-n" className="bl-in" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))} /></div>
            <div><label className="bl-k" htmlFor="a-p">Unit price (ZMW)</label><input id="a-p" className="bl-in" inputMode="decimal" value={price} onChange={(e) => { setPrice(e.target.value.replace(/[^\d.,]/g, '')); setError(''); }} /></div>
          </div>
          {error && <p role="alert" className="bl-err">{error}</p>}
        </div>
        <div className="bl-mf">
          <button type="button" className="bl-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="bl-btn primary" disabled={busy || !description.trim() || !price}>{busy ? 'Adding…' : 'Add charge'}</button>
        </div>
      </form>
    </Modal>
  );
}
