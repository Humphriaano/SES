import { FormEvent, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Plus, Printer, Trash2, Wallet } from 'lucide-react';
import api from '../../api/client';
import { apiError, METHOD_LABEL, plain, zmw } from '../../lib/money';
import { Modal, Pill } from './ui';
import { printInvoice, printReceipt } from './receipt';
import { Session } from './SessionBar';
import { useAuth } from '../../context/AuthContext';
import { staffDisplayName } from '../../lib/staffNames';

export interface Line {
  id: string; sourceType: string; description: string; detail: string | null; quantity: number; unitPrice: number | null; lineTotal: number | null;
  status: string; auto: boolean; needsReview: boolean; quantityUnsure: boolean; createdByName: string | null; voidReason: string | null;
}
export interface PaymentRow {
  id: string; receiptNumber: string; amount: number; method: string; reference: string | null; payerName: string | null; payerPhone: string | null;
  status: string; createdAt: string; receivedByName: string | null; voidReason: string | null; voidedByName: string | null;
}
export interface Invoice {
  id: string; number: string; status: 'OPEN' | 'PART_PAID' | 'PAID' | 'VOID' | 'WAIVED'; emergency: boolean; createdAt: string; dueDate: string | null; lockedAt: string | null;
  lines: Line[]; payments: PaymentRow[]; total: number; discount: number; payable: number; paid: number; balance: number; unpriced: number; review: number; overdue: boolean;
  discountReason: string | null; discountByName: string | null; waivedReason: string | null; waivedByName: string | null; voidReason: string | null;
  releasedAt: string | null; releasedByName: string | null; releaseReason: string | null;
}

const STATUS: Record<Invoice['status'], { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' | 'blue' }> = {
  OPEN: { label: 'Not paid yet', tone: 'warn' }, PART_PAID: { label: 'Part paid', tone: 'blue' }, PAID: { label: 'Paid', tone: 'ok' }, VOID: { label: 'Void', tone: 'muted' }, WAIVED: { label: 'Waived', tone: 'muted' },
};
const SOURCE: Record<string, string> = { CONSULTATION: 'Consultation', PRESCRIPTION: 'Drug', INVESTIGATION: 'Investigation', PROCEDURE: 'Procedure', MANUAL: 'Added by hand' };
const dt = (d: string) => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const day = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

type Dialog =
  | { kind: 'pay' } | { kind: 'edit'; line: Line } | { kind: 'remove'; line: Line } | { kind: 'discount' }
  | { kind: 'waive' } | { kind: 'void' } | { kind: 'release' } | { kind: 'voidReceipt'; pay: PaymentRow } | { kind: 'audit' };

export default function InvoiceCard({ invoice: inv, isAdmin, canTakePayment, session, credit, defaultOpen, onChange, onAddCharge }: {
  invoice: Invoice; isAdmin: boolean; canTakePayment: boolean; session: Session | null | undefined; credit: number; defaultOpen: boolean; onChange: () => void;
  onAddCharge?: () => void;
}) {
  const { user } = useAuth();
  const generatedBy = staffDisplayName(user?.name, user?.designation);
  const [open, setOpen] = useState(defaultOpen);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const closed = inv.status === 'VOID' || inv.status === 'WAIVED';
  const locked = inv.status !== 'OPEN';
  const lines = inv.lines;
  const st = STATUS[inv.status];
  const done = () => { setDialog(null); onChange(); };

  const canPay = canTakePayment && (inv.status === 'OPEN' || inv.status === 'PART_PAID') && inv.balance > 0;
  const payBlock = !canPay ? '' : inv.unpriced > 0 ? `${inv.unpriced} charge${inv.unpriced === 1 ? ' has' : 's have'} no price yet` : !session ? 'Open your cashier session first' : '';

  async function print(id: string) {
    try { if (!(await printReceipt(id, generatedBy))) toast.error('Allow pop-ups for this site to print.'); } catch (e) { toast.error(apiError(e, 'Couldn’t load the receipt.')); }
  }

  async function printThisInvoice() {
    try { if (!(await printInvoice(inv.id, generatedBy))) toast.error('Allow pop-ups for this site to print.'); } catch (e) { toast.error(apiError(e, 'Couldn’t load the invoice.')); }
  }

  return (
    <section className="bl-card" aria-label={`Invoice ${inv.number}`} style={{ overflow: 'hidden' }}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'none', border: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontWeight: 500, color: 'var(--text-heading)', fontSize: 14.5 }}>{inv.number}</div>
          <div className="bl-muted" style={{ fontSize: 12.5 }}>{day(inv.createdAt)} · {lines.filter((l) => l.status === 'ACTIVE').length} charge{lines.filter((l) => l.status === 'ACTIVE').length === 1 ? '' : 's'}</div>
        </div>
        {inv.emergency && <Pill tone="bad">Emergency</Pill>}
        {inv.overdue && <Pill tone="bad">Overdue</Pill>}
        {inv.releasedAt && inv.balance > 0 && <Pill tone="blue">Released with balance</Pill>}
        <Pill tone={st.tone}>{st.label}</Pill>
        <div style={{ textAlign: 'right', minWidth: 110 }}>
          <div style={{ fontWeight: 500, color: 'var(--text-heading)' }}>{zmw(inv.payable)}</div>
          {inv.balance > 0 && !closed && <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--badge-red-text)' }}>{zmw(inv.balance)} owing</div>}
        </div>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {inv.status === 'WAIVED' && <div className="bl-mb" style={{ paddingBottom: 0 }}><p className="bl-muted" style={{ margin: 0, fontSize: 13 }}>Free / exempt: <b>{inv.waivedReason}</b> — approved by {inv.waivedByName}.</p></div>}
          {inv.status === 'VOID' && <div className="bl-mb" style={{ paddingBottom: 0 }}><p className="bl-muted" style={{ margin: 0, fontSize: 13 }}>Voided: <b>{inv.voidReason}</b>. The number stays on record.</p></div>}

          <div style={{ overflowX: 'auto' }}>
            <table className="bl-tbl" style={{ minWidth: 640 }}>
              <thead><tr><th>Charge</th><th className="bl-num">Qty</th><th className="bl-num">Price</th><th className="bl-num">Total</th><th style={{ width: 90 }} /></tr></thead>
              <tbody>
                {lines.map((l) => {
                  const voided = l.status !== 'ACTIVE';
                  const mayEdit = !voided && !closed && (isAdmin || (!locked && (!l.auto || l.unitPrice === null || l.quantityUnsure)));
                  const mayRemove = !voided && !closed && (isAdmin || (!locked && !l.auto));
                  return (
                    <tr key={l.id} className={voided ? 'void' : ''}>
                      <td>
                        <div style={{ fontWeight: 500, color: 'var(--text-heading)' }}>{l.description}</div>
                        <div className="bl-faint" style={{ fontSize: 12 }}>
                          {SOURCE[l.sourceType] ?? l.sourceType}{l.detail ? ` · ${l.detail}` : ''}
                          {voided && l.voidReason ? ` · removed: ${l.voidReason}` : ''}
                        </div>
                        {!voided && l.unitPrice === null && <Pill tone="bad">No price</Pill>}
                        {!voided && l.unitPrice !== null && l.quantityUnsure && <Pill tone="warn">Check quantity</Pill>}
                      </td>
                      <td className="bl-num">{l.quantity}</td>
                      <td className="bl-num">{plain(l.unitPrice)}</td>
                      <td className="bl-num" style={{ fontWeight: 500 }}>{plain(l.lineTotal)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {mayEdit && <button type="button" className="bl-x" style={{ display: 'inline-flex' }} aria-label={`Edit ${l.description}`} title="Edit" onClick={() => setDialog({ kind: 'edit', line: l })}><Pencil size={14} /></button>}
                        {mayRemove && <button type="button" className="bl-x" style={{ display: 'inline-flex' }} aria-label={`Remove ${l.description}`} title="Remove" onClick={() => setDialog({ kind: 'remove', line: l })}><Trash2 size={14} /></button>}
                      </td>
                    </tr>
                  );
                })}
                {lines.length === 0 && <tr><td colSpan={5} className="bl-muted" style={{ textAlign: 'center', padding: 24 }}>No charges on this invoice.</td></tr>}
              </tbody>
            </table>
          </div>

          <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'flex-end' }}>
            <dl style={{ margin: 0, width: 300, maxWidth: '100%', fontSize: 13.5, display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 6 }}>
              <dt className="bl-muted">Charges</dt><dd className="bl-num" style={{ margin: 0 }}>{zmw(inv.total)}</dd>
              {inv.discount > 0 && <>
                <dt className="bl-muted" title={`${inv.discountReason ?? ''} — approved by ${inv.discountByName ?? ''}`}>Discount</dt><dd className="bl-num" style={{ margin: 0 }}>− {zmw(inv.discount)}</dd>
              </>}
              <dt style={{ fontWeight: 500, color: 'var(--text-heading)' }}>To pay</dt><dd className="bl-num" style={{ margin: 0, fontWeight: 500, color: 'var(--text-heading)' }}>{zmw(inv.payable)}</dd>
              <dt className="bl-muted">Paid</dt><dd className="bl-num" style={{ margin: 0 }}>{zmw(inv.paid)}</dd>
              <dt style={{ fontWeight: 500 }}>{inv.balance < 0 ? 'Overpaid (kept as credit)' : 'Balance'}</dt>
              <dd className="bl-num" style={{ margin: 0, fontWeight: 500, fontSize: 15, color: inv.balance > 0 ? 'var(--badge-red-text)' : 'var(--badge-green-text)' }}>{zmw(Math.abs(inv.balance))}</dd>
              {inv.dueDate && inv.balance > 0 && !closed && <><dt className="bl-muted">Due</dt><dd className="bl-num" style={{ margin: 0, color: inv.overdue ? 'var(--badge-red-text)' : undefined }}>{day(inv.dueDate)}</dd></>}
            </dl>
          </div>

          {inv.payments.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', overflowX: 'auto' }}>
              <table className="bl-tbl" style={{ minWidth: 640 }}>
                <thead><tr><th>Receipt</th><th>When</th><th>Method</th><th className="bl-hide-sm">Paid by</th><th className="bl-num">Amount</th><th style={{ width: 110 }} /></tr></thead>
                <tbody>
                  {inv.payments.map((p) => (
                    <tr key={p.id} className={p.status === 'VOID' ? 'void' : ''}>
                      <td style={{ fontWeight: 500, color: 'var(--text-heading)' }}>{p.receiptNumber}{p.status === 'VOID' && <> <Pill tone="muted">Void</Pill></>}</td>
                      <td>{dt(p.createdAt)}<div className="bl-faint" style={{ fontSize: 12 }}>{p.receivedByName}</div></td>
                      <td>{METHOD_LABEL[p.method] ?? p.method}{p.reference && <div className="bl-faint" style={{ fontSize: 12 }}>{p.reference}</div>}</td>
                      <td className="bl-hide-sm">{[p.payerName, p.payerPhone].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="bl-num" style={{ fontWeight: 500 }}>{plain(p.amount)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button type="button" className="bl-x" style={{ display: 'inline-flex' }} aria-label={`Print receipt ${p.receiptNumber}`} title="Print receipt" onClick={() => print(p.id)}><Printer size={14} /></button>
                        {isAdmin && p.status === 'ACTIVE' && <button type="button" className="bl-btn sm danger" onClick={() => setDialog({ kind: 'voidReceipt', pay: p })}>Void</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {canTakePayment && inv.status === 'OPEN' && !inv.lockedAt && onAddCharge && (
              <button type="button" className="bl-btn" onClick={onAddCharge}><Plus size={15} /> Add charge</button>
            )}
            {canPay && (
              <button type="button" className="bl-btn primary" disabled={!!payBlock} onClick={() => setDialog({ kind: 'pay' })} title={payBlock || undefined}><Wallet size={15} /> Take payment</button>
            )}
            {canPay && payBlock && <span className="bl-muted" style={{ fontSize: 12.5 }}>{payBlock}.</span>}
            {isAdmin && !closed && <button type="button" className="bl-btn" onClick={() => setDialog({ kind: 'discount' })}>{inv.discount > 0 ? 'Change discount' : 'Discount'}</button>}
            {isAdmin && inv.status === 'OPEN' && <button type="button" className="bl-btn" onClick={() => setDialog({ kind: 'waive' })}>Free / exempt</button>}
            {isAdmin && !closed && inv.balance > 0 && !inv.releasedAt && <button type="button" className="bl-btn" onClick={() => setDialog({ kind: 'release' })}>Release with balance</button>}
            {isAdmin && !closed && !inv.payments.some((p) => p.status === 'ACTIVE') && <button type="button" className="bl-btn danger" onClick={() => setDialog({ kind: 'void' })}>Void invoice</button>}
            <button type="button" className="bl-btn" style={{ marginLeft: 'auto' }} onClick={printThisInvoice}><Printer size={15} /> Print invoice</button>
            {isAdmin && <button type="button" className="bl-btn" onClick={() => setDialog({ kind: 'audit' })}>History</button>}
          </div>
          {inv.releasedAt && inv.balance > 0 && <div className="bl-muted" style={{ padding: '0 16px 12px', fontSize: 12.5 }}>Released with balance by {inv.releasedByName}: {inv.releaseReason}</div>}
        </div>
      )}

      {dialog?.kind === 'pay' && <PayDialog inv={inv} credit={credit} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'edit' && <EditDialog line={dialog.line} locked={locked} isAdmin={isAdmin} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'remove' && (
        <ReasonDialog title={`Remove “${dialog.line.description}”`} label="Why is this being removed?" action="Remove charge" danger
          note={locked ? 'This invoice has a payment. Anything paid beyond the new total is kept as credit for the patient.' : undefined}
          onClose={() => setDialog(null)} onSubmit={(reason) => api.post(`/charge-lines/${dialog.line.id}/void`, { reason })} onDone={done} />
      )}
      {dialog?.kind === 'discount' && <DiscountDialog inv={inv} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'waive' && (
        <ReasonDialog title="Free / exempt visit" label="Reason (programme, staff dependant …)" action="Waive invoice" note={`${zmw(inv.total)} will be written off. Only an administrator can do this and it is recorded.`}
          onClose={() => setDialog(null)} onSubmit={(reason) => api.post(`/invoices/${inv.id}/waive`, { reason })} onDone={done} />
      )}
      {dialog?.kind === 'void' && (
        <ReasonDialog title={`Void ${inv.number}`} label="Why is this invoice being voided?" action="Void invoice" danger note="The invoice number stays on record, marked void."
          onClose={() => setDialog(null)} onSubmit={(reason) => api.post(`/invoices/${inv.id}/void`, { reason })} onDone={done} />
      )}
      {dialog?.kind === 'release' && (
        <ReasonDialog title="Release with balance" label="Why may the client leave with a balance?" action="Approve release" note={`${zmw(inv.balance)} stays owing and is flagged when overdue.`}
          onClose={() => setDialog(null)} onSubmit={(reason) => api.post(`/invoices/${inv.id}/release`, { reason })} onDone={done} />
      )}
      {dialog?.kind === 'voidReceipt' && (
        <ReasonDialog title={`Void receipt ${dialog.pay.receiptNumber}`} label="Why is this receipt being voided?" action="Void receipt" danger note={`${zmw(dialog.pay.amount)} comes off what the client has paid. The receipt stays on record, marked void.`}
          onClose={() => setDialog(null)} onSubmit={(reason) => api.post(`/payments/${dialog.pay.id}/void`, { reason })} onDone={done} />
      )}
      {dialog?.kind === 'audit' && <AuditDialog invoiceId={inv.id} onClose={() => setDialog(null)} />}
    </section>
  );
}

// ── Dialogs ───────────────────────────────────────────────────────────────────
function PayDialog({ inv, credit, onClose, onDone }: { inv: Invoice; credit: number; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(inv.balance.toFixed(2));
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [payerName, setPayerName] = useState('');
  const [payerPhone, setPayerPhone] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const num = Number(amount.replace(/,/g, ''));
  const remaining = Number.isFinite(num) ? Math.max(inv.balance - num, 0) : inv.balance;
  const needsRef = method === 'MOBILE_MONEY' || method === 'CARD';
  const methods = ['CASH', 'MOBILE_MONEY', 'CARD', ...(credit > 0 ? ['CREDIT'] : [])];

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const { data } = await api.post(`/invoices/${inv.id}/payments`, { amount, method, reference, payerName, payerPhone, dueDate: remaining > 0 && dueDate ? dueDate : undefined });
      toast.success(`Receipt ${data.receiptNumber} recorded`);
      onDone();
    } catch (err) { setError(apiError(err, 'Couldn’t record the payment.')); } finally { setBusy(false); }
  }

  return (
    <Modal title={`Take payment · ${inv.number}`} onClose={onClose} busy={busy}>
      <form onSubmit={submit}>
        <div className="bl-mb">
          <div className="bl-card" style={{ padding: 12, background: 'var(--bg-surface)', display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
            <span className="bl-muted">Balance to pay</span><b style={{ color: 'var(--badge-red-text)' }}>{zmw(inv.balance)}</b>
          </div>
          <div role="radiogroup" aria-label="Payment method" className="bl-seg">
            {methods.map((m) => <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => { setMethod(m); setError(''); if (m === 'CREDIT') setAmount(Math.min(credit, inv.balance).toFixed(2)); }}>{METHOD_LABEL[m]}</button>)}
          </div>
          <div className="bl-row">
            <div>
              <label className="bl-k" htmlFor="p-amt">Amount (ZMW)</label>
              <input id="p-amt" className={`bl-in${error && /amount|balance|credit/i.test(error) ? ' err' : ''}`} inputMode="decimal" autoFocus value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^\d.,]/g, '')); setError(''); }} />
              {method === 'CREDIT' && <div className="bl-faint" style={{ fontSize: 12, marginTop: 4 }}>Credit available: {zmw(credit)}</div>}
            </div>
            {needsRef && (
              <div>
                <label className="bl-k" htmlFor="p-ref">{method === 'CARD' ? 'Card slip / approval no.' : 'Mobile money reference'}</label>
                <input id="p-ref" className="bl-in" maxLength={40} value={reference} onChange={(e) => { setReference(e.target.value); setError(''); }} />
              </div>
            )}
          </div>
          <div className="bl-row">
            <div><label className="bl-k" htmlFor="p-name">Paid by <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· if not the patient</span></label><input id="p-name" className="bl-in" maxLength={100} value={payerName} onChange={(e) => setPayerName(e.target.value)} /></div>
            <div><label className="bl-k" htmlFor="p-phone">Payer’s phone</label><input id="p-phone" className="bl-in" inputMode="tel" maxLength={20} value={payerPhone} onChange={(e) => setPayerPhone(e.target.value.replace(/[^\d+\s-]/g, ''))} /></div>
          </div>
          {remaining > 0 && (
            <div>
              <label className="bl-k" htmlFor="p-due">Balance of {zmw(remaining)} due by <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· default 7 days</span></label>
              <input id="p-due" type="date" className="bl-in" min={new Date().toISOString().slice(0, 10)} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          )}
          <p className="bl-faint" style={{ margin: 0, fontSize: 12.5 }}>After the first payment this invoice is locked. Later changes need an administrator.</p>
          {error && <p role="alert" className="bl-err">{error}</p>}
        </div>
        <div className="bl-mf">
          <button type="button" className="bl-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="bl-btn primary" disabled={busy || !amount}>{busy ? 'Recording…' : 'Record payment'}</button>
        </div>
      </form>
    </Modal>
  );
}

function EditDialog({ line, locked, isAdmin, onClose, onDone }: { line: Line; locked: boolean; isAdmin: boolean; onClose: () => void; onDone: () => void }) {
  const canQty = isAdmin || !line.auto || line.quantityUnsure;
  const canPrice = isAdmin || !line.auto || line.unitPrice === null;
  const [qty, setQty] = useState(String(line.quantity));
  const [price, setPrice] = useState(line.unitPrice === null ? '' : line.unitPrice.toFixed(2));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    const body: Record<string, unknown> = {};
    if (canQty && Number(qty) !== line.quantity) body['quantity'] = qty;
    if (canPrice && price !== '' && Number(price.replace(/,/g, '')) !== line.unitPrice) body['unitPrice'] = price;
    if (canQty && line.quantityUnsure && !body['quantity']) body['quantity'] = qty;   // confirming the quantity as it stands
    if (Object.keys(body).length === 0) { onClose(); return; }
    if (locked) body['reason'] = reason;
    setBusy(true);
    try { await api.patch(`/charge-lines/${line.id}`, body); toast.success('Charge updated'); onDone(); }
    catch (err) { setError(apiError(err, 'Couldn’t save the change.')); } finally { setBusy(false); }
  }

  return (
    <Modal title={`Edit “${line.description}”`} onClose={onClose} busy={busy} width={440}>
      <form onSubmit={submit}>
        <div className="bl-mb">
          {line.auto && <p className="bl-muted" style={{ margin: 0, fontSize: 13 }}>{isAdmin ? 'This charge came from the clinical record. The change is logged with your name.' : line.unitPrice === null ? 'This item isn’t on the price list yet. Enter its price.' : 'The quantity couldn’t be worked out from the prescription. Confirm what is being dispensed.'}</p>}
          <div className="bl-row">
            {canQty && <div><label className="bl-k" htmlFor="e-qty">Quantity</label><input id="e-qty" className="bl-in" inputMode="decimal" autoFocus={line.quantityUnsure || !canPrice} value={qty} onChange={(e) => { setQty(e.target.value.replace(/[^\d.]/g, '')); setError(''); }} /></div>}
            {canPrice && <div><label className="bl-k" htmlFor="e-price">Unit price (ZMW)</label><input id="e-price" className="bl-in" inputMode="decimal" autoFocus={!line.quantityUnsure && canPrice} value={price} onChange={(e) => { setPrice(e.target.value.replace(/[^\d.,]/g, '')); setError(''); }} /></div>}
          </div>
          {locked && (
            <div><label className="bl-k" htmlFor="e-why">Reason</label><textarea id="e-why" className="bl-in" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          )}
          {error && <p role="alert" className="bl-err">{error}</p>}
        </div>
        <div className="bl-mf">
          <button type="button" className="bl-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="bl-btn primary" disabled={busy || (locked && reason.trim().length < 3)}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ReasonDialog({ title, label, action, note, danger, onClose, onSubmit, onDone }: {
  title: string; label: string; action: string; note?: string; danger?: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<unknown>; onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await onSubmit(reason.trim()); toast.success('Done'); onDone(); } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  }
  return (
    <Modal title={title} onClose={onClose} busy={busy} width={440}>
      <form onSubmit={submit}>
        <div className="bl-mb">
          {note && <p className="bl-muted" style={{ margin: 0, fontSize: 13 }}>{note}</p>}
          <div><label className="bl-k" htmlFor="r-why">{label}</label><textarea id="r-why" className="bl-in" rows={3} autoFocus maxLength={300} value={reason} onChange={(e) => { setReason(e.target.value); setError(''); }} /></div>
          {error && <p role="alert" className="bl-err">{error}</p>}
        </div>
        <div className="bl-mf">
          <button type="button" className="bl-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={`bl-btn ${danger ? 'danger' : 'primary'}`} disabled={busy || reason.trim().length < 3}>{busy ? 'Saving…' : action}</button>
        </div>
      </form>
    </Modal>
  );
}

function DiscountDialog({ inv, onClose, onDone }: { inv: Invoice; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState<'percent' | 'amount'>('percent');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const v = Number(value);
  const preview = Number.isFinite(v) && v > 0 ? (type === 'percent' ? inv.total * v / 100 : v) : 0;

  async function submit(e: FormEvent, clear = false) {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.post(`/invoices/${inv.id}/discount`, clear ? { type: 'clear', reason: reason || 'Discount removed' } : { type, value, reason }); toast.success(clear ? 'Discount removed' : 'Discount applied'); onDone(); }
    catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Discount" onClose={onClose} busy={busy} width={440}>
      <form onSubmit={(e) => submit(e)}>
        <div className="bl-mb">
          <p className="bl-muted" style={{ margin: 0, fontSize: 13 }}>Charges are {zmw(inv.total)}. The original prices stay on the invoice; the discount is shown separately and logged with your name.</p>
          <div role="radiogroup" aria-label="Discount type" className="bl-seg">
            <button type="button" role="radio" aria-checked={type === 'percent'} onClick={() => setType('percent')}>Percentage</button>
            <button type="button" role="radio" aria-checked={type === 'amount'} onClick={() => setType('amount')}>Amount (ZMW)</button>
          </div>
          <div>
            <label className="bl-k" htmlFor="d-val">{type === 'percent' ? 'Percent off' : 'Amount off'}</label>
            <input id="d-val" className="bl-in" inputMode="decimal" autoFocus value={value} onChange={(e) => { setValue(e.target.value.replace(/[^\d.]/g, '')); setError(''); }} />
            {preview > 0 && <div className="bl-faint" style={{ fontSize: 12, marginTop: 4 }}>Takes off {zmw(preview)}.</div>}
          </div>
          <div><label className="bl-k" htmlFor="d-why">Reason</label><textarea id="d-why" className="bl-in" rows={2} maxLength={300} value={reason} onChange={(e) => { setReason(e.target.value); setError(''); }} /></div>
          {error && <p role="alert" className="bl-err">{error}</p>}
        </div>
        <div className="bl-mf">
          {inv.discount > 0 && <button type="button" className="bl-btn danger" style={{ marginRight: 'auto' }} onClick={(e) => submit(e as unknown as FormEvent, true)} disabled={busy}>Remove discount</button>}
          <button type="button" className="bl-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="bl-btn primary" disabled={busy || !value || reason.trim().length < 3}>{busy ? 'Saving…' : 'Apply discount'}</button>
        </div>
      </form>
    </Modal>
  );
}

interface AuditRow { id: string; at: string; action: string; userName: string | null; approvedByName: string | null; reason: string | null; before: any; after: any }
const ACTION: Record<string, string> = {
  LINE_ADDED: 'Charge added', LINE_EDITED: 'Charge edited', LINE_VOIDED: 'Charge removed', LINE_ADJUSTED: 'Paid invoice adjusted', LINE_RESTORED: 'Charge restored', PAYMENT: 'Payment taken',
  PAYMENT_VOIDED: 'Receipt voided', DISCOUNT: 'Discount applied', DISCOUNT_REMOVED: 'Discount removed', WAIVED: 'Waived (free / exempt)', INVOICE_VOIDED: 'Invoice voided', RELEASED_WITH_BALANCE: 'Released with balance',
};
function AuditDialog({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { api.get(`/invoices/${invoiceId}/audit`).then((r) => setRows(r.data)).catch(() => setFailed(true)); }, [invoiceId]);
  return (
    <Modal title="Change history" onClose={onClose} width={560}>
      <div className="bl-mb" style={{ paddingBottom: 14 }}>
        {failed ? <p className="bl-err">Couldn’t load the history.</p> : rows === null ? <p className="bl-muted" style={{ margin: 0 }}>Loading…</p> : rows.length === 0 ? <p className="bl-muted" style={{ margin: 0 }}>Nothing has been changed on the billing side.</p> : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map((r) => (
              <li key={r.id} style={{ fontSize: 13 }}>
                <div><b style={{ color: 'var(--text-heading)' }}>{ACTION[r.action] ?? r.action}</b> <span className="bl-faint">· {dt(r.at)} · {r.userName ?? 'system'}</span></div>
                {r.reason && <div className="bl-muted">“{r.reason}”{r.approvedByName ? ` — approved by ${r.approvedByName}` : ''}</div>}
                {r.before && r.after && <div className="bl-faint" style={{ fontSize: 12 }}>{JSON.stringify(r.before)} → {JSON.stringify(r.after)}</div>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Modal>
  );
}
