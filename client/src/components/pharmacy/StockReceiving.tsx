import { FormEvent, useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { searchCatalog, DrugEntry } from '../../data/drugCatalog';
import { loadCustomCatalogue } from '../../lib/customCatalogue';
import { apiError, hasRole, zmw } from '../../lib/money';
import { todayInput, prescriptionUnit, formatCourseDate } from '../../lib/prescriptionCourse';
import { isLiquidMedicine } from '../../lib/prescriptionSupply';
import { staffDisplayName } from '../../lib/staffNames';
import { STOCK_UNITS, packConversion, stockNumber, readStockRequest, newStockRequest, storeStockRequest, clearStockRequest, sendStockRequest, stockRequestRejected } from '../../lib/stockReceiving';
import './StockReceiving.css';

interface Product { id: string; catalogueRef: string; brand: string; manufacturer?: string; baseUnit: string; packSize: string; packLabel: string; active: boolean; receiptCount?: number }
interface Batch { id: string; lotNumber: string; expiryDate: string; status: string }
interface LineDraft { id: string; drug: DrugEntry | null; query: string; productId: string; products: Product[]; newProduct: boolean; brand: string; manufacturer: string; baseUnit: string; packSize: string; packLabel: string; lotNumber: string; expiryDate: string; packCount: string; costPerPack: string }
interface Draft { kind: 'DELIVERY' | 'OPENING'; receivedDate: string; reference: string; source: string; lines: LineDraft[] }
interface Receipt { id: string; kind: string; reference: string; receivedDate: string; source: string; status: string; receivedBy?: { name: string; designation?: string }; lines: { id: string; packCount: string; packSize: string; packLabel: string; baseQuantity: string; baseUnit: string; costPerPack: string | null; batch: Batch & { product: Product & { catalogueItem: { name: string; detail: string } } }; movement?: { reversal?: { reason: string } } }[] }
const freshLine = (): LineDraft => ({ id: crypto.randomUUID(), drug: null, query: '', productId: '', products: [], newProduct: false, brand: '', manufacturer: '', baseUnit: 'tablet', packSize: '1', packLabel: 'pack', lotNumber: '', expiryDate: '', packCount: '', costPerPack: '' });
const freshDraft = (): Draft => ({ kind: 'DELIVERY', receivedDate: todayInput(), reference: '', source: '', lines: [freshLine()] });

function useStockWrite(scope: string, onSuccess: (data: any) => void | Promise<void>) {
  const [pending, setPending] = useState(() => readStockRequest(scope));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const inFlight = useRef(false);
  async function execute(url?: string, body?: unknown) {
    if (inFlight.current) return;
    const request = pending ?? (url ? newStockRequest(url, body) : null);
    if (!request) return;
    // Persist before sending. An interrupted response must never become a new receipt.
    try { storeStockRequest(scope, request); } catch { setError('This browser could not retain the receipt for safe retry. Enable local storage before posting.'); return; }
    inFlight.current = true; setBusy(true); setPending(request); setError('');
    try {
      const { data } = await sendStockRequest(request);
      clearStockRequest(scope); setPending(null); await onSuccess(data);
    } catch (err) {
      if (stockRequestRejected(err)) { clearStockRequest(scope); setPending(null); }
      setError(apiError(err));
    } finally { inFlight.current = false; setBusy(false); }
  }
  return { pending, busy, error, execute, locked: busy || Boolean(pending) };
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={`sr-field${wide ? ' sr-wide' : ''}`}><span>{label}</span>{children}</label>;
}

function MissingDrug({ scope, initial, onPick, onClose }: { scope: string; initial: string; onPick: (drug: DrugEntry) => void; onClose: () => void }) {
  const [restored] = useState(() => readStockRequest(scope + ':catalogue')?.body as { generic?: string; form?: string; route?: string; atcCode?: string; ingredients?: { name: string; amount: string; unit: string }[] } | undefined);
  const [generic, setGeneric] = useState(restored?.generic ?? initial), [form, setForm] = useState(restored?.form ?? 'Tablet'), [route, setRoute] = useState(restored?.route ?? 'Oral'), [atcCode, setAtc] = useState(restored?.atcCode ?? '');
  const [ingredients, setIngredients] = useState(restored?.ingredients ?? [{ name: '', amount: '', unit: 'mg' }]);
  const matches = [...new Map([generic, ...ingredients.map(row => row.name)].filter(term => term.length >= 2).flatMap(term => searchCatalog(term, 4)).map(drug => [drug.sku, drug])).values()].slice(0, 6);
  const write = useStockWrite(scope + ':catalogue', async drug => { await loadCustomCatalogue(); onPick({ name: drug.generic, sku: drug.code, dose: drug.strength, form: drug.form, route: drug.route, pendingReview: true }); });
  const blocked = ingredients.some(row => !row.name.trim() || !row.amount || !row.unit.trim()) || !generic.trim() || !form.trim() || !route.trim();
  return createPortal(<div className="sr-overlay"><section role="dialog" aria-modal="true" aria-label="Add catalogue drug" className="sr-dialog">
    <header><h3>Add catalogue drug</h3><button type="button" className="sr-icon" aria-label="Close add catalogue drug" onClick={onClose} disabled={write.locked}><X size={18} /></button></header>
    <form onSubmit={event => { event.preventDefault(); event.stopPropagation(); void write.execute('/pharmacy-stock/catalogue-drugs', { generic, form, route, atcCode, ingredients }); }}>
      <fieldset disabled={write.locked} className="sr-grid">
        <Field label="Generic name" wide><input aria-label="Generic name" value={generic} maxLength={120} onChange={e => setGeneric(e.target.value)} autoFocus /></Field>
        {matches.length > 0 && <div className="sr-wide sr-matches"><span className="sr-muted">Existing catalogue matches</span>{matches.map(drug => <button type="button" key={drug.sku} onClick={() => onPick(drug)}>{drug.name} · {drug.dose} · {drug.form}<span>Use item</span></button>)}</div>}
        <div className="sr-wide"><div className="sr-row"><h4>Active ingredients</h4><button type="button" className="sr-button" onClick={() => setIngredients(rows => [...rows, { name: '', amount: '', unit: 'mg' }])} disabled={ingredients.length >= 10}><Plus size={13} />Ingredient</button></div>{ingredients.map((row, index) => <div className="sr-ingredient" key={index}>
          <Field label="Ingredient"><input aria-label={`Ingredient ${index + 1}`} value={row.name} maxLength={120} onChange={e => setIngredients(rows => rows.map((r, i) => i === index ? { ...r, name: e.target.value } : r))} /></Field>
          <Field label="Amount"><input aria-label={`Ingredient amount ${index + 1}`} type="number" min="0.000001" step="any" value={row.amount} onChange={e => setIngredients(rows => rows.map((r, i) => i === index ? { ...r, amount: e.target.value } : r))} /></Field>
          <Field label="Unit"><input aria-label={`Ingredient unit ${index + 1}`} list="sr-ingredient-units" value={row.unit} maxLength={30} onChange={e => setIngredients(rows => rows.map((r, i) => i === index ? { ...r, unit: e.target.value } : r))} /></Field>
          {ingredients.length > 1 && <button type="button" className="sr-icon" aria-label={`Remove ingredient ${index + 1}`} onClick={() => setIngredients(rows => rows.filter((_, i) => i !== index))}><X size={15} /></button>}
        </div>)}</div>
        <Field label="Form"><input aria-label="Drug form" value={form} list="sr-drug-forms" maxLength={60} onChange={e => setForm(e.target.value)} /></Field>
        <Field label="Route"><input aria-label="Drug route" value={route} list="sr-drug-routes" maxLength={60} onChange={e => setRoute(e.target.value)} /></Field>
        <Field label="ATC code (optional)"><input aria-label="ATC code" value={atcCode} maxLength={10} onChange={e => setAtc(e.target.value)} /></Field>
        <datalist id="sr-ingredient-units">{['mg', 'g', 'microgram', 'IU', '%', 'mg/mL', 'mg/5mL', 'g/L', 'mmol/mL'].map(value => <option key={value}>{value}</option>)}</datalist>
        <datalist id="sr-drug-forms">{['Tablet', 'Capsule', 'Syrup', 'Suspension', 'Injection', 'Infusion', 'Cream', 'Ointment', 'Inhaler', 'Suppository', 'Powder', 'Patch'].map(value => <option key={value}>{value}</option>)}</datalist>
        <datalist id="sr-drug-routes">{['Oral', 'IV', 'IM', 'SC', 'Topical', 'Inhaled', 'Rectal', 'Ophthalmic', 'Vaginal'].map(value => <option key={value}>{value}</option>)}</datalist>
      </fieldset>
      <p className="sr-muted">Available immediately · marked pending review for an administrator.</p>
      {write.error && <p role="alert" className="sr-error">{write.error}</p>}
      <footer><button type="button" className="sr-button" disabled={write.locked} onClick={onClose}>Cancel</button><button type="submit" className="sr-primary" disabled={write.busy || (!write.pending && blocked)}>{write.busy ? 'Adding…' : write.pending ? 'Retry add' : 'Add to catalogue'}</button></footer>
    </form>
  </section></div>, document.body);
}

function ReceiptLineEditor({ line, number, locked, scope, change, remove }: { line: LineDraft; number: number; locked: boolean; scope: string; change: (line: LineDraft) => void; remove?: () => void }) {
  const [showHits, setShowHits] = useState(false), [missing, setMissing] = useState(() => Boolean(readStockRequest(scope + ':' + line.id + ':catalogue'))), [batches, setBatches] = useState<Batch[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const request = useRef(0);
  const hits = !line.drug && line.query.length >= 2 ? searchCatalog(line.query, 8) : [];
  const product = line.newProduct ? { baseUnit: line.baseUnit, packSize: line.packSize, packLabel: line.packLabel } : line.products.find(p => p.id === line.productId);
  const converted = product ? packConversion(line.packCount, product.packSize) : null;
  const selectedBatch = batches.find(batch => batch.lotNumber === line.lotNumber.trim().toUpperCase());
  useEffect(() => {
    if (!line.productId || line.newProduct) { setBatches([]); return; }
    let cancelled = false;
    api.get('/pharmacy-stock/batches', { params: { productId: line.productId } }).then(r => { if (!cancelled) setBatches(r.data); }).catch(e => { if (!cancelled) setError(apiError(e)); });
    return () => { cancelled = true; };
  }, [line.productId, line.newProduct]);
  useEffect(() => () => { request.current++; }, []);
  async function pick(drug: DrugEntry) {
    const token = ++request.current; setShowHits(false); setLoading(true); setError('');
    const packagedLiquid = isLiquidMedicine(`${drug.form} ${drug.dose}`), baseUnit = packagedLiquid ? 'bottle' : prescriptionUnit(`${drug.form} ${drug.dose}`).name;
    const selected: LineDraft = { ...line, drug, query: drug.name, productId: '', products: [], newProduct: false, brand: '', manufacturer: '', baseUnit, packSize: '1', packLabel: baseUnit, lotNumber: '', expiryDate: '', packCount: '', costPerPack: '' };
    change(selected);
    try {
      const { data } = await api.get('/pharmacy-stock/products', { params: { catalogueRef: drug.sku } });
      if (token !== request.current) return;
      change({ ...selected, products: data, productId: data.find((p: Product) => p.active)?.id ?? '', newProduct: !data.some((p: Product) => p.active) });
    } catch (err) { if (token === request.current) setError(apiError(err)); }
    finally { if (token === request.current) setLoading(false); }
  }
  function set<K extends keyof LineDraft>(key: K, value: LineDraft[K]) { change({ ...line, [key]: value }); }
  return <section className="sr-line" aria-label={`Stock line ${number}`}>
    <div className="sr-row"><h4>Item {number}</h4>{remove && <button type="button" className="sr-icon" aria-label={`Remove stock line ${number}`} disabled={locked} onClick={remove}><Trash2 size={15} /></button>}</div>
    <fieldset className="sr-grid" disabled={locked || loading}>
      <div className="sr-search"><Field label="Catalogue item"><input aria-label={`Catalogue item ${number}`} value={line.query} autoComplete="off" onFocus={() => setShowHits(true)} onChange={e => { request.current++; change({ ...line, query: e.target.value, drug: null, productId: '', products: [], newProduct: false }); setShowHits(true); }} /></Field>
        {showHits && hits.length > 0 && <div className="sr-hits">{hits.map(drug => <button type="button" key={drug.sku} onMouseDown={e => e.preventDefault()} onClick={() => void pick(drug)}><strong>{drug.name}</strong><span>{drug.dose} · {drug.form} · {drug.route}{drug.pendingReview ? ' · Pending review' : ''}</span></button>)}</div>}
        {!line.drug && line.query.length >= 2 && <button type="button" className="sr-link" onClick={() => setMissing(true)}>Add missing catalogue item</button>}
        {line.drug && <div className="sr-muted sr-caption">{line.drug.dose} · {line.drug.form} · {line.drug.route}{line.drug.pendingReview && <span className="sr-badge">Pending review</span>}</div>}
      </div>
      {line.drug && <>
        <Field label="Product / brand"><select aria-label={`Product ${number}`} value={line.newProduct ? 'new' : line.productId} onChange={e => change({ ...line, newProduct: e.target.value === 'new', productId: e.target.value === 'new' ? '' : e.target.value, lotNumber: '', expiryDate: '' })}><option value="" disabled>Choose product</option>{line.products.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.brand}{p.manufacturer ? ` · ${p.manufacturer}` : ''} · {stockNumber(p.packSize)} {p.baseUnit} / {p.packLabel}</option>)}<option value="new">+ Add product</option></select></Field>
        {line.newProduct && <div className="sr-new-product sr-wide sr-grid">
          <Field label="Brand / product name"><input aria-label={`Brand ${number}`} value={line.brand} maxLength={160} onChange={e => set('brand', e.target.value)} /></Field>
          <Field label="Manufacturer (optional)"><input aria-label={`Manufacturer ${number}`} value={line.manufacturer} maxLength={160} onChange={e => set('manufacturer', e.target.value)} /></Field>
          <Field label="Stock unit"><select aria-label={`Stock unit ${number}`} value={line.baseUnit} onChange={e => set('baseUnit', e.target.value)}>{STOCK_UNITS.map(value => <option key={value}>{value}</option>)}</select></Field>
          <Field label="Pack type"><input aria-label={`Pack type ${number}`} value={line.packLabel} list="sr-pack-labels" maxLength={60} onChange={e => set('packLabel', e.target.value)} /></Field>
          <Field label="Stock units per pack"><input aria-label={`Units per pack ${number}`} type="number" min="0.01" step="0.01" value={line.packSize} onChange={e => set('packSize', e.target.value)} /></Field>
        </div>}
        <Field label="Lot / batch number"><input aria-label={`Batch number ${number}`} value={line.lotNumber} list={`sr-lots-${line.id}`} maxLength={100} onChange={e => { const batch = batches.find(b => b.lotNumber === e.target.value.trim().toUpperCase()); change({ ...line, lotNumber: e.target.value, expiryDate: batch ? batch.expiryDate.slice(0, 10) : line.expiryDate }); }} /><datalist id={`sr-lots-${line.id}`}>{batches.map(b => <option key={b.id} value={b.lotNumber}>{formatCourseDate(b.expiryDate)}</option>)}</datalist></Field>
        <Field label="Expiry date"><input aria-label={`Expiry date ${number}`} type="date" min={todayInput()} readOnly={Boolean(selectedBatch)} value={line.expiryDate} onChange={e => set('expiryDate', e.target.value)} /></Field>
        <Field label={`Quantity (${product?.packLabel || 'packs'})`}><input aria-label={`Pack quantity ${number}`} type="number" min="0.01" step="0.01" value={line.packCount} onChange={e => set('packCount', e.target.value)} /></Field>
        <Field label={`Cost per ${product?.packLabel || 'pack'} (ZMW, optional)`}><input aria-label={`Cost per pack ${number}`} type="number" min="0" step="0.01" value={line.costPerPack} onChange={e => set('costPerPack', e.target.value)} /></Field>
        {product && <output className="sr-conversion sr-wide" aria-label={`Pack conversion ${number}`}>{converted ? <>{stockNumber(line.packCount)} {product.packLabel} × {stockNumber(product.packSize)} {product.baseUnit} = <strong>{stockNumber(converted)} {product.baseUnit}</strong></> : 'Enter quantity and pack size to calculate stock.'}</output>}
        {selectedBatch?.status === 'QUARANTINED' && <p className="sr-muted sr-wide">This batch is quarantined.</p>}
      </>}
    </fieldset>
    {loading && <p className="sr-muted">Loading saved products…</p>}
    {error && <p className="sr-error" role="alert">{error} <button type="button" className="sr-link" onClick={() => line.drug && void pick(line.drug)}>Retry</button></p>}
    {missing && <MissingDrug scope={scope + ':' + line.id} initial={line.query} onClose={() => setMissing(false)} onPick={drug => { setMissing(false); void pick(drug); }} />}
  </section>;
}

function ReceiptCard({ receipt, scope, refresh }: { receipt: Receipt; scope: string; refresh: () => void }) {
  const [open, setOpen] = useState(false), [correct, setCorrect] = useState(false), [reason, setReason] = useState('');
  const write = useStockWrite(scope + ':reverse:' + receipt.id, () => { setCorrect(false); setReason(''); refresh(); });
  return <article className="sr-receipt"><button type="button" className="sr-receipt-head" onClick={() => setOpen(!open)} aria-expanded={open}><span><strong>{receipt.reference}</strong><span className="sr-muted">{formatCourseDate(receipt.receivedDate)} · {receipt.kind === 'OPENING' ? 'Opening stock' : 'Delivery'} · {receipt.lines.length} items</span></span><span className={`sr-badge${receipt.status === 'POSTED' ? ' sr-success' : ''}`}>{receipt.status === 'POSTED' ? 'Posted' : receipt.status === 'REVERSED' ? 'Reversed' : 'Partly reversed'}</span><ChevronDown size={16} /></button>
    {(open || write.pending) && <div className="sr-receipt-body"><div className="sr-row sr-muted"><span>{receipt.source}</span><span>Received by {receipt.receivedBy ? staffDisplayName(receipt.receivedBy.name, receipt.receivedBy.designation) : 'Staff'}</span></div><div className="sr-table-wrap"><table><thead><tr><th>Item / brand</th><th>Batch · expiry</th><th className="sr-numeric">Packs</th><th className="sr-numeric">Stock added</th></tr></thead><tbody>{receipt.lines.map(line => <tr key={line.id}><td>{line.batch.product.catalogueItem.name}<small>{line.batch.product.catalogueItem.detail} · {line.batch.product.brand}</small></td><td>{line.batch.lotNumber}<small>{formatCourseDate(line.batch.expiryDate)}</small></td><td className="sr-numeric">{stockNumber(line.packCount)} {line.packLabel}</td><td className="sr-numeric">{stockNumber(line.baseQuantity)} {line.baseUnit}{line.costPerPack != null && <small>{zmw(Number(line.costPerPack))} / {line.packLabel}</small>}{line.movement?.reversal && <small>Reversed · {line.movement.reversal.reason}</small>}</td></tr>)}</tbody></table></div>
      {receipt.status !== 'REVERSED' && !correct && !write.pending && <button type="button" className="sr-button" onClick={() => setCorrect(true)}>Correct receipt</button>}
      {(correct || write.pending) && <form className="sr-correction" onSubmit={e => { e.preventDefault(); void write.execute(`/pharmacy-stock/receipts/${receipt.id}/reverse`, { reason }); }}><Field label="Correction reason"><input aria-label={`Correction reason ${receipt.reference}`} value={reason} maxLength={1000} disabled={write.locked} onChange={e => setReason(e.target.value)} /></Field><button type="button" className="sr-button" disabled={write.locked} onClick={() => setCorrect(false)}>Cancel</button><button type="submit" className="sr-button" disabled={write.busy || (!write.pending && !reason.trim())}>{write.busy ? 'Reversing…' : write.pending ? 'Retry reversal' : 'Reverse receipt'}</button></form>}
      {write.error && <p className="sr-error" role="alert">{write.error}</p>}
    </div>}
  </article>;
}

export default function StockReceiving() {
  const { user } = useAuth();
  const scope = `ses-stock-receiving:${user?.id}`, draftKey = scope + ':draft';
  const [draft, setDraft] = useState<Draft>(() => { try { const stored = JSON.parse(localStorage.getItem(draftKey) ?? 'null'); return stored?.lines?.length && ['DELIVERY', 'OPENING'].includes(stored.kind) ? stored : freshDraft(); } catch { return freshDraft(); } });
  const [saved, setSaved] = useState<Receipt | null>(null), [receipts, setReceipts] = useState<Receipt[]>([]), [readError, setReadError] = useState('');
  const refreshId = useRef(0);
  async function refresh() { const id = ++refreshId.current; try { const { data } = await api.get('/pharmacy-stock/receipts'); if (id === refreshId.current) { setReceipts(data); setReadError(''); } } catch (err) { if (id === refreshId.current) setReadError(apiError(err)); } }
  const write = useStockWrite(scope + ':post', data => { setSaved(data); localStorage.removeItem(draftKey); void refresh(); });
  useEffect(() => { void refresh(); return () => { refreshId.current++; }; }, []);
  useEffect(() => { if (!saved) { try { localStorage.setItem(draftKey, JSON.stringify(draft)); } catch { /* Posting checks durable storage explicitly. */ } } }, [draft, saved]);
  if (!hasRole(user?.role, 'admin', 'pharmacist')) return null;
  const validLines = draft.lines.every(line => {
    const product = line.newProduct ? { packSize: line.packSize } : line.products.find(p => p.id === line.productId);
    return line.drug && product && (!line.newProduct || (line.brand.trim() && line.packLabel.trim())) && line.lotNumber.trim() && line.expiryDate >= todayInput() && packConversion(line.packCount, product.packSize);
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    const body = { kind: draft.kind, receivedDate: draft.receivedDate, reference: draft.reference, source: draft.source, lines: draft.lines.map(line => ({ ...(line.newProduct ? { newProduct: { catalogueRef: line.drug!.sku, brand: line.brand, manufacturer: line.manufacturer || null, baseUnit: line.baseUnit, packSize: line.packSize, packLabel: line.packLabel } } : { productId: line.productId }), lotNumber: line.lotNumber, expiryDate: line.expiryDate, packCount: line.packCount, costPerPack: line.costPerPack || null })) };
    void write.execute('/pharmacy-stock/receipts', body);
  }
  return <div className="sr-root">
    {saved && <div className="sr-heading"><h2>Receive stock</h2><button type="button" className="sr-primary" onClick={() => { setSaved(null); setDraft(freshDraft()); }}>Receive more stock</button></div>}
    {saved ? <div role="status"><p className="sr-saved">{saved.kind === 'OPENING' ? 'Opening stock recorded' : 'Stock received'} · {saved.reference}</p><ReceiptCard key={saved.id + saved.status} receipt={receipts.find(r => r.id === saved.id) ?? saved} scope={scope} refresh={() => void refresh()} /></div> : <form className="sr-form" onSubmit={submit}>
      <fieldset className="sr-grid sr-header-fields" disabled={write.locked}>
        <Field label="Entry type"><select aria-label="Stock entry type" value={draft.kind} onChange={e => { const kind = e.target.value as Draft['kind']; setDraft(d => ({ ...d, kind, reference: kind === 'OPENING' && !d.reference ? `OPENING-${d.receivedDate}` : d.reference, source: kind === 'OPENING' && !d.source ? 'Physical stock count' : d.source })); }}><option value="DELIVERY">Delivery</option><option value="OPENING">Opening stock count</option></select></Field>
        <Field label={draft.kind === 'OPENING' ? 'Count date' : 'Date received'}><input aria-label="Date received" type="date" max={todayInput()} value={draft.receivedDate} onChange={e => setDraft(d => ({ ...d, receivedDate: e.target.value }))} /></Field>
        <Field label={draft.kind === 'OPENING' ? 'Count reference' : 'Delivery / invoice reference'}><input aria-label="Receipt reference" maxLength={160} value={draft.reference} onChange={e => setDraft(d => ({ ...d, reference: e.target.value }))} /></Field>
        <Field label={draft.kind === 'OPENING' ? 'Count location / source' : 'Received from'}><input aria-label="Received from" maxLength={160} value={draft.source} onChange={e => setDraft(d => ({ ...d, source: e.target.value }))} /></Field>
      </fieldset>
      {draft.lines.map((line, index) => <ReceiptLineEditor key={line.id} line={line} number={index + 1} scope={scope} locked={write.locked} change={updated => setDraft(d => ({ ...d, lines: d.lines.map(row => row.id === line.id ? updated : row) }))} remove={draft.lines.length > 1 ? () => setDraft(d => ({ ...d, lines: d.lines.filter(row => row.id !== line.id) })) : undefined} />)}
      <datalist id="sr-pack-labels">{['box', 'strip', 'bottle', 'sachet', 'pack', 'carton', 'tube', 'vial', 'ampoule'].map(label => <option key={label}>{label}</option>)}</datalist>
      {write.error && <p role="alert" className="sr-error">{write.error}</p>}
      {write.pending && !write.busy && <p className="sr-muted">Receipt not confirmed. Retry to check and finish this receipt.</p>}
      <footer className="sr-submit"><button type="button" className="sr-button" disabled={write.locked || draft.lines.length >= 50} onClick={() => setDraft(d => ({ ...d, lines: [...d.lines, freshLine()] }))}><Plus size={14} />Add item</button><span className="sr-muted">Received by {staffDisplayName(user?.name ?? 'Staff', user?.designation)}</span><button type="submit" className="sr-primary" disabled={write.busy || (!write.pending && (!validLines || !draft.reference.trim() || !draft.source.trim() || !draft.receivedDate || draft.receivedDate > todayInput()))}>{write.busy ? 'Posting…' : write.pending ? 'Retry receipt' : draft.kind === 'OPENING' ? 'Record opening stock' : 'Post receipt'}</button></footer>
    </form>}
    <section className="sr-history"><div className="sr-row"><h3>Recent receipts</h3><button type="button" className="sr-button" onClick={() => void refresh()}><RefreshCw size={13} />Refresh</button></div>{readError && <p role="alert" className="sr-error">{readError}</p>}{receipts.filter(r => r.id !== saved?.id).map(receipt => <ReceiptCard key={receipt.id + receipt.status} receipt={receipt} scope={scope} refresh={() => void refresh()} />)}</section>
  </div>;
}
