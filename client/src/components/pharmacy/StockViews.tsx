import { Fragment, useEffect, useState } from 'react';
import { ChevronDown, RefreshCw, Search, X } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { apiError, hasRole } from '../../lib/money';
import { formatCourseDate } from '../../lib/prescriptionCourse';
import { staffDisplayName } from '../../lib/staffNames';
import { StockPage, StockProduct, OnHandRow, ExpiryBatch, StockCardData, stockQuantity, movementColumns, STOCK_STATE_LABELS } from '../../lib/stockViews';
import './StockViews.css';

function useRead<T>(endpoint: string | null, params: Record<string, unknown>, refresh: number) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const signature = JSON.stringify(params);
  useEffect(() => {
    let cancelled = false; setData(null); setError('');
    if (!endpoint) { setLoading(false); return; }
    setLoading(true);
    api.get(endpoint, { params: JSON.parse(signature) }).then(result => { if (!cancelled) setData(result.data); }).catch(err => { if (!cancelled) setError(apiError(err)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [endpoint, signature, refresh]);
  return { data, error, loading };
}
function useSearch(value: string) { const [debounced, setDebounced] = useState(value); useEffect(() => { const timer = setTimeout(() => setDebounced(value), 200); return () => clearTimeout(timer); }, [value]); return debounced; }
function Status({ value }: { value: string }) { return <span className={`sv-badge sv-state-${value.toLowerCase()}`}>{STOCK_STATE_LABELS[value] ?? value}</span>; }
function SearchField({ value, change, label }: { value: string; change: (value: string) => void; label: string }) { return <label className="sv-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label={label} placeholder={label} value={value} onChange={event => change(event.target.value)} /></label>; }
function Pager({ data, change, label }: { data: StockPage<unknown> | null; change: (page: number) => void; label: string }) {
  if (!data) return null;
  return <div className="sv-pager"><span>{data.rows.length ? `${(data.page - 1) * data.pageSize + 1}–${Math.min(data.page * data.pageSize, data.total)} of ${data.total}` : data.total ? `0 of ${data.total}` : '0'} {label}</span><div><button type="button" disabled={data.page <= 1} onClick={() => change(data.page - 1)}>Previous</button><button type="button" disabled={data.page * data.pageSize >= data.total} onClick={() => change(data.page + 1)}>Next</button></div></div>;
}
function ReadState({ error, loading }: { error: string; loading: boolean }) { return error ? <p role="alert" className="sv-error">{error}</p> : loading ? <span role="status" className="sv-loading">Loading…</span> : null; }
type OpenCard = (productId: string, batchId?: string) => void;

function ProductRows({ item, refresh, openCard }: { item: OnHandRow; refresh: number; openCard: OpenCard }) {
  const [page, setPage] = useState(1);
  const read = useRead<StockPage<StockProduct>>('/pharmacy-stock/product-stock', { catalogueRef: item.catalogueRef, baseUnit: item.baseUnit, page, pageSize: 10 }, refresh);
  return <div className="sv-products"><ReadState {...read} /><table><thead><tr><th>Product / brand</th><th>Pack</th><th className="sv-number">Available</th><th className="sv-number">Physical</th><th /></tr></thead><tbody>{read.data?.rows.map(product => <tr key={product.productId}><td><strong>{product.brand}</strong><small>{product.manufacturer ?? '—'}{!product.active ? ' · Inactive' : ''}</small></td><td>{stockQuantity(product.packSize)} {product.baseUnit} / {product.packLabel}</td><td className="sv-number">{stockQuantity(product.available)}</td><td className="sv-number">{stockQuantity(product.physical)}</td><td className="sv-action"><button type="button" onClick={() => openCard(product.productId)}>Stock card</button></td></tr>)}</tbody></table><Pager data={read.data} change={setPage} label="products" /></div>;
}
function OnHand({ refresh, openCard }: { refresh: number; openCard: OpenCard }) {
  const [q, setQ] = useState(''), [tracking, setTracking] = useState('TRACKED'), [level, setLevel] = useState('ALL'), [page, setPage] = useState(1), [expanded, setExpanded] = useState<string | null>(null);
  const term = useSearch(q), read = useRead<StockPage<OnHandRow>>('/pharmacy-stock/on-hand', { q: term, tracking, level, page }, refresh);
  return <>
    <div className="sv-toolbar"><SearchField value={q} change={value => { setQ(value); setPage(1); setExpanded(null); }} label="Search item, strength, brand or code" /><select aria-label="Stock tracking" value={tracking} onChange={e => { setTracking(e.target.value); setPage(1); setExpanded(null); }}><option value="TRACKED">Tracked items</option><option value="UNTRACKED">Untracked items</option><option value="ALL">All catalogue items</option></select><select aria-label="Stock level" value={level} onChange={e => { setLevel(e.target.value); setPage(1); }}><option value="ALL">All stock levels</option><option value="AVAILABLE">Available</option><option value="UNAVAILABLE">Unavailable</option><option value="OUT_OF_STOCK">No stock</option></select></div>
    <ReadState {...read} />
    <div className="sv-table-wrap"><table className="sv-on-hand"><thead><tr><th>Catalogue item</th><th>Unit</th><th className="sv-number">Available</th><th className="sv-number">Physical</th><th className="sv-number">Expired</th><th className="sv-number">Quarantined</th><th className="sv-number">Inactive</th><th>Status</th><th /></tr></thead><tbody>{read.data?.rows.map(row => {
      const key = row.catalogueRef + ':' + row.baseUnit;
      return <Fragment key={key}><tr><td><strong>{row.name}</strong><small>{row.detail}</small><small>{row.catalogueRef}</small></td><td>{row.baseUnit ?? '—'}</td><td className="sv-number sv-available">{stockQuantity(row.available)}</td><td className="sv-number">{stockQuantity(row.physical)}</td><td className="sv-number">{stockQuantity(row.expired)}</td><td className="sv-number">{stockQuantity(row.quarantined)}</td><td className="sv-number">{stockQuantity(row.inactive)}</td><td><Status value={row.state} /></td><td className="sv-action">{row.tracked && <button type="button" aria-label={`Show products for ${row.name}, ${row.baseUnit}`} aria-expanded={expanded === key} onClick={() => setExpanded(expanded === key ? null : key)}>{row.productCount} {row.productCount === 1 ? 'product' : 'products'}<ChevronDown size={13} /></button>}</td></tr>{expanded === key && <tr><td colSpan={9}><ProductRows item={row} refresh={refresh} openCard={openCard} /></td></tr>}</Fragment>;
    })}</tbody></table></div><Pager data={read.data} change={setPage} label="item units" />
  </>;
}

function ProductPicker({ product, selected, choose, clear, refresh }: { product?: StockCardData['product']; selected: boolean; choose: OpenCard; clear: () => void; refresh: number }) {
  const [q, setQ] = useState(''), term = useSearch(q);
  const read = useRead<StockPage<StockProduct>>(selected ? null : '/pharmacy-stock/product-stock', { q: term, pageSize: 10 }, refresh);
  if (selected) return <div className="sv-selected"><div><strong>{product?.name ?? 'Stock card'}</strong><small>{product ? [product.detail, product.brand, product.manufacturer].filter(Boolean).join(' · ') : 'Loading…'}</small></div><button type="button" aria-label="Choose another stock product" onClick={() => { setQ(''); clear(); }}><X size={15} />Change product</button></div>;
  return <div className="sv-picker"><SearchField value={q} change={setQ} label="Find a stocked product or brand" /><ReadState {...read} />{read.data?.rows.map(row => <button type="button" className="sv-product-choice" key={row.productId} onClick={() => choose(row.productId)}><span><strong>{row.name}</strong><small>{row.detail} · {row.brand}{row.manufacturer ? ' · ' + row.manufacturer : ''}</small></span><span>{stockQuantity(row.physical)} {row.baseUnit}</span></button>)}</div>;
}
function Card({ productId, batchId, refresh, openCard, clear }: { productId: string | null; batchId?: string; refresh: number; openCard: OpenCard; clear: () => void }) {
  const [batch, setBatch] = useState(batchId ?? ''), [from, setFrom] = useState(''), [to, setTo] = useState(''), [type, setType] = useState('ALL'), [page, setPage] = useState(1);
  const read = useRead<StockCardData>(productId ? `/pharmacy-stock/products/${encodeURIComponent(productId)}/card` : null, { batchId: batch, from, to, type, page }, refresh);
  const data = read.data;
  const [metadata, setMetadata] = useState<Pick<StockCardData, 'product' | 'batches'> | null>(null);
  useEffect(() => { if (data) setMetadata({ product: data.product, batches: data.batches }); }, [data]);
  return <>
    <ProductPicker product={data?.product ?? metadata?.product} selected={Boolean(productId)} choose={openCard} clear={clear} refresh={refresh} />
    {productId && <>
      <div className="sv-toolbar sv-card-filters"><label>Batch<select aria-label="Stock card batch" value={batch} onChange={e => { setBatch(e.target.value); setPage(1); }}><option value="">All batches</option>{(data?.batches ?? metadata?.batches)?.map(row => <option key={row.id} value={row.id}>{row.lotNumber} · {formatCourseDate(row.expiryDate)}</option>)}</select></label><label>From<input aria-label="Stock card from date" type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label><label>To<input aria-label="Stock card to date" type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></label><label>Movement<select aria-label="Stock movement type" value={type} onChange={e => { setType(e.target.value); setPage(1); }}><option value="ALL">All movements</option><option value="RECEIVED">Received / opening</option><option value="ISSUED">Issued</option><option value="LOSS">Loss</option><option value="ADJUSTMENT">Adjustment</option><option value="REVERSAL">Reversal</option></select></label></div>
      <ReadState {...read} />
      {data && <div className="sv-balances"><span>Opening balance <strong>{stockQuantity(data.openingBalance)} {data.balanceUnit}</strong></span><span>Closing balance <strong>{stockQuantity(data.closingBalance)} {data.balanceUnit}</strong></span><span>Current physical <strong>{stockQuantity(data.currentBalance)} {data.balanceUnit}</strong></span><small>{batch ? 'Batch balance' : 'Product balance'} · balances include all movement types</small></div>}
      <div className="sv-table-wrap"><table className="sv-card-table"><thead><tr><th>Posted / reference</th><th>Batch · expiry</th><th>Source / recipient</th><th className="sv-number">Received</th><th className="sv-number">Issued</th><th className="sv-number">Loss / adjustment</th><th className="sv-number">Balance</th><th>Handled by</th></tr></thead><tbody>{data?.rows.map(row => {
        const values = movementColumns(row), kind = row.type === 'RECEIVED' ? row.receiptKind === 'OPENING' ? 'Opening stock' : 'Received' : ({ ISSUED: 'Issued', LOSS: 'Loss', ADJUSTMENT: 'Adjustment', REVERSAL: 'Reversal' } as Record<string, string>)[row.type];
        return <tr key={row.id}><td><strong>{row.reference}</strong><small>{new Date(row.createdAt).toLocaleString('en-GB', { timeZone: 'Africa/Lusaka', dateStyle: 'medium', timeStyle: 'short' })}</small><small>{kind}</small></td><td>{row.lotNumber}<small>{formatCourseDate(row.expiryDate)}</small></td><td>{row.counterparty ?? '—'}{row.reason && <small>{row.reason}</small>}</td><td className="sv-number">{stockQuantity(values.received)}</td><td className="sv-number">{stockQuantity(values.issued)}</td><td className="sv-number">{stockQuantity(values.adjustment)}</td><td className="sv-number"><strong>{stockQuantity(row.runningBalance)}</strong></td><td>{row.actorName ? staffDisplayName(row.actorName, row.actorDesignation) : '—'}</td></tr>;
      })}</tbody></table></div><Pager data={data} change={setPage} label="movements" />
    </>}
  </>;
}

function Expiry({ refresh, openCard }: { refresh: number; openCard: OpenCard }) {
  const [q, setQ] = useState(''), [state, setState] = useState('ALL'), [within, setWithin] = useState(''), [zero, setZero] = useState(false), [page, setPage] = useState(1);
  const term = useSearch(q), read = useRead<StockPage<ExpiryBatch>>('/pharmacy-stock/expiry-batches', { q: term, state, expiresWithin: within, includeZero: String(zero), page }, refresh);
  return <><div className="sv-toolbar"><SearchField value={q} change={value => { setQ(value); setPage(1); }} label="Search item, brand or batch" /><select aria-label="Batch stock status" value={state} onChange={e => { setState(e.target.value); setPage(1); }}><option value="ALL">All statuses</option><option value="USABLE">Usable</option><option value="EXPIRED">Expired</option><option value="QUARANTINED">Quarantined</option><option value="INACTIVE">Inactive</option></select><select aria-label="Expiry window" value={within} onChange={e => { setWithin(e.target.value); setPage(1); }}><option value="">All expiry dates</option>{[30,60,90,180,365].map(days => <option value={days} key={days}>Expires within {days} days</option>)}</select><label className="sv-check"><input aria-label="Include batches with no stock" type="checkbox" checked={zero} onChange={e => { setZero(e.target.checked); setPage(1); }} />Include zero stock</label></div><ReadState {...read} />
    <div className="sv-table-wrap"><table className="sv-expiry-table"><thead><tr><th>Catalogue item</th><th>Product / brand</th><th>Batch</th><th>Expiry date</th><th className="sv-number">Remaining</th><th className="sv-number">Available</th><th>Status</th><th /></tr></thead><tbody>{read.data?.rows.map(row => <tr key={row.batchId}><td><strong>{row.name}</strong><small>{row.detail}</small></td><td>{row.brand}<small>{row.manufacturer ?? row.catalogueRef}</small></td><td>{row.lotNumber}</td><td>{formatCourseDate(row.expiryDate)}<small>{row.daysToExpiry < 0 ? `${Math.abs(row.daysToExpiry)} ${row.daysToExpiry === -1 ? 'day' : 'days'} past expiry` : row.daysToExpiry === 0 ? 'Expires today' : `In ${row.daysToExpiry} ${row.daysToExpiry === 1 ? 'day' : 'days'}`}</small></td><td className="sv-number">{stockQuantity(row.physical)} {row.baseUnit}</td><td className="sv-number">{stockQuantity(row.available)}</td><td><Status value={row.state} /></td><td className="sv-action"><button type="button" onClick={() => openCard(row.productId, row.batchId)}>Stock card</button></td></tr>)}</tbody></table></div><Pager data={read.data} change={setPage} label="batches" />
  </>;
}

export default function StockViews() {
  const { user } = useAuth();
  const [view, setView] = useState<'on-hand' | 'card' | 'expiry'>('on-hand'), [selected, setSelected] = useState<{ productId: string; batchId?: string } | null>(null), [refresh, setRefresh] = useState(0);
  if (!hasRole(user?.role, 'admin', 'pharmacist')) return null;
  function openCard(productId: string, batchId?: string) { setSelected({ productId, batchId }); setView('card'); }
  return <section className="sv-root" aria-label="Pharmacy stock"><header className="sv-heading"><nav aria-label="Stock views">{([['on-hand','Stock on hand'],['card','Stock card'],['expiry','Batches by expiry']] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={view === id} className={view === id ? 'sv-selected-tab' : ''} onClick={() => setView(id)}>{label}</button>)}</nav><button type="button" className="sv-refresh" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} />Refresh</button></header>
    <div className="sv-panel">{view === 'on-hand' && <OnHand refresh={refresh} openCard={openCard} />}{view === 'card' && <Card key={selected?.productId + ':' + selected?.batchId} productId={selected?.productId ?? null} batchId={selected?.batchId} refresh={refresh} openCard={openCard} clear={() => setSelected(null)} />}{view === 'expiry' && <Expiry refresh={refresh} openCard={openCard} />}</div>
  </section>;
}
