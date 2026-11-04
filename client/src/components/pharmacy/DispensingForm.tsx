import { ComponentProps, useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { apiError } from '../../lib/money';
import { formatCourseDate } from '../../lib/prescriptionCourse';
import { stockQuantity } from '../../lib/stockViews';
import { DispensePlan, StockSelection, DISPENSING_PENDING_EVENT, readPendingDispensing, retryDispensing, sameStockAllocations, validStockAllocations } from '../../lib/stockDispensing';
import PrescriptionForm, { PrescriptionDraft } from '../consultation/blocks/PrescriptionForm';
import './DispensingForm.css';

function usePending() {
  const { user } = useAuth();
  const read = () => { try { return { pending: user?.id ? readPendingDispensing(user.id) : null, error: '' }; } catch (e) { return { pending: null, error: (e as Error).message }; } };
  const [state, setState] = useState(read);
  useEffect(() => { const update = () => setState(read()); update(); window.addEventListener(DISPENSING_PENDING_EVENT, update); window.addEventListener('storage', update); return () => { window.removeEventListener(DISPENSING_PENDING_EVENT, update); window.removeEventListener('storage', update); }; }, [user?.id]);
  return { ...state, user };
}
export function DispensingRecovery({ onResolved }: { onResolved: (record: any) => void }) {
  const { pending, error, user } = usePending(), [busy,setBusy] = useState(false);
  if (!pending && !error) return null;
  return <div className="ds-recovery" role="status"><span>{error || `Confirming dispensing: ${pending!.body.dispensedDrug}. Retry to check the original request.`}</span>{pending && <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { const saved = await retryDispensing(user!.id); toast.success('Dispensing confirmed'); onResolved(saved.data); } catch (e) { toast.error(apiError(e)); } finally { setBusy(false); } }}>{busy ? 'Checking…' : 'Retry dispensing'}</button>}</div>;
}

type Props = Omit<ComponentProps<typeof PrescriptionForm>, 'onSave' | 'onAdd' | 'onDraftChange'> & { onSave: (draft: PrescriptionDraft, stock: StockSelection, userId: string) => Promise<void>; onRecovered: (record: any) => void; prescriberPreference?: { id: string; brand: string; manufacturer: string | null; baseUnit: string; active: boolean } | null };
export default function DispensingForm({ onSave, onRecovered, prescriberPreference, children, canSubmit = true, ...props }: Props) {
  const { user, pending, error: pendingError } = usePending();
  const [candidate,setCandidate] = useState<{ drugCode?: string; quantity?: number; quantityUnit?: string }>({});
  const [plan,setPlan] = useState<DispensePlan | null>(null), [error,setError] = useState(''), [productId,setProductId] = useState(''), [manual,setManual] = useState(false), [amounts,setAmounts] = useState<Record<string,string>>({}), [reason,setReason] = useState(''), [refresh,setRefresh] = useState(0);
  const changed = useCallback((value: typeof candidate) => setCandidate(value), []);
  useEffect(() => { setProductId(''); setManual(false); setAmounts({}); setReason(''); }, [candidate.drugCode, candidate.quantityUnit]);
  useEffect(() => {
    let cancelled = false; setPlan(null); setError('');
    if (!candidate.drugCode || !candidate.quantity || !candidate.quantityUnit) return;
    api.get('/pharmacy-stock/dispense-plan', { params: { catalogueRef: candidate.drugCode, baseUnit: candidate.quantityUnit, quantity: candidate.quantity, productId: productId || undefined } }).then(response => { if (!cancelled) setPlan(response.data); }).catch(e => { if (!cancelled) setError(apiError(e)); });
    return () => { cancelled = true; };
  }, [candidate.drugCode, candidate.quantity, candidate.quantityUnit, productId, refresh]);
  const chosen = manual ? Object.entries(amounts).filter(([,value]) => value !== '' && Number(value) !== 0).map(([batchId,quantity]) => ({ batchId, quantity })) : plan?.suggested ?? [];
  const override = Boolean(plan?.tracked && !sameStockAllocations(chosen, plan.defaultSuggested));
  const ready = !candidate.drugCode || Boolean(plan && (!plan.tracked || (validStockAllocations(plan, chosen, productId || undefined) && (!override || reason.trim()))));
  const blocked = Boolean(pending || pendingError);
  const products = [...new Map(plan?.batches.map(batch => [batch.productId, batch]) ?? []).values()];
  const rows = plan?.batches.filter(batch => manual ? !productId || batch.productId === productId : chosen.some(row => row.batchId === batch.batchId)) ?? [];
  return <><fieldset className="ds-form" disabled={blocked}><PrescriptionForm {...props} canSubmit={canSubmit && ready && !blocked && Boolean(user?.id)} onDraftChange={changed} onSave={draft => onSave(draft, plan?.tracked ? { ...(productId ? { productId } : {}), ...(manual ? { allocations: chosen } : {}), ...(override ? { overrideReason: reason.trim() } : {}) } : {}, user!.id)}>
    {candidate.drugCode && <section className="ds-stock" aria-label="Dispensing stock allocation">
      <div className="ds-stock-heading"><strong>Stock to supply</strong><button type="button" onClick={() => setRefresh(value => value + 1)}>Refresh stock</button></div>
      {prescriberPreference && <p className="ds-muted" style={{ margin: '0 0 8px' }}>Prescriber preference: <strong>{prescriberPreference.brand}</strong>{prescriberPreference.manufacturer ? ' · ' + prescriberPreference.manufacturer : ''}{plan?.tracked && !plan.batches.some(batch => batch.productId === prescriberPreference.id) ? ' · not currently available' : ''}</p>}
      {error ? <p className="ds-error" role="alert">{error}</p> : !plan ? <span role="status">{candidate.quantity ? 'Checking stock…' : 'Supply quantity required'}</span> : !plan.tracked ? <span className="ds-muted">Untracked</span> : <>
        <div className="ds-stock-controls"><label>Product / brand<select aria-label="Stock product or brand" value={productId} onChange={e => { setProductId(e.target.value); setManual(false); setAmounts({}); setReason(''); }}><option value="">Automatic · earliest expiry</option>{productId && !products.some(product => product.productId === productId) && <option value={productId}>Selected product · unavailable</option>}{products.map(product => <option key={product.productId} value={product.productId}>{product.brand}{product.manufacturer ? ' · ' + product.manufacturer : ''}</option>)}</select></label><span>Available <b>{stockQuantity(plan.available)} {plan.baseUnit}</b></span></div>
        {!plan.sufficient && <p className="ds-error" role="alert">Insufficient usable stock for {stockQuantity(plan.quantity)} {plan.baseUnit}.</p>}
        {rows.length > 0 && <div className="ds-table-wrap"><table><thead><tr><th>Brand / batch</th><th>Expiry</th><th>Available</th><th>Supply ({plan.baseUnit})</th></tr></thead><tbody>{rows.map(batch => <tr key={batch.batchId}><td>{batch.brand}<small>{batch.lotNumber}</small></td><td>{formatCourseDate(batch.expiryDate)}</td><td>{stockQuantity(batch.available)}</td><td>{manual ? <input aria-label={`Supply from ${batch.lotNumber}`} type="number" min="0" step="0.01" value={amounts[batch.batchId] ?? ''} onChange={e => setAmounts(current => ({ ...current, [batch.batchId]: e.target.value }))} /> : stockQuantity(chosen.find(row => row.batchId === batch.batchId)?.quantity)}</td></tr>)}</tbody></table></div>}
        <button type="button" onClick={() => { setManual(!manual); setAmounts(Object.fromEntries(plan.suggested.map(row => [row.batchId,row.quantity]))); }}>{manual ? 'Use automatic batches' : 'Change batch allocation'}</button>
        {override && <label className="ds-reason">Batch selection reason<input aria-label="Batch selection reason" maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>}
      </>}
    </section>}
    {children}
  </PrescriptionForm></fieldset>{blocked && <DispensingRecovery onResolved={onRecovered} />}</>;
}
