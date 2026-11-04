import { useCallback, useEffect, useRef, useState, FormEvent } from 'react';
import toast from 'react-hot-toast';
import { Search, Plus, Download, Upload, DatabaseZap, Check } from 'lucide-react';
import api from '../api/client';
import { catalogueSeeds } from '../lib/priceCatalogue';
import { notifyPricesChanged } from '../lib/prices';
import { parseCsv, toCsv, downloadText } from '../lib/csv';

type ItemType = 'DRUG' | 'INVESTIGATION' | 'PROCEDURE' | 'CONSULTATION' | 'OTHER';

interface PriceItem {
  id: string; itemType: ItemType; catalogueRef: string; name: string; detail: string | null;
  unit: string; unitPrice: number | null; bottleSizeMl?: number | string | null; active: boolean; effectiveFrom: string | null; updatedAt: string;
  updatedBy?: { id: string; name: string } | null;
}

interface Listing {
  items: PriceItem[]; total: number;
  counts: Partial<Record<ItemType, number>>; unpriced: Partial<Record<ItemType, number>>;
}

interface ImportResult {
  updated: number; unchanged: number; blank: number; ambiguous: number;
  unmatched: string[]; unmatchedCount: number; invalid: string[]; invalidCount: number;
}

const TABS: { id: ItemType | 'ALL'; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'DRUG', label: 'Drugs' },
  { id: 'INVESTIGATION', label: 'Investigations' },
  { id: 'PROCEDURE', label: 'Procedures' },
  { id: 'CONSULTATION', label: 'Consultation' },
  { id: 'OTHER', label: 'Other' },
];
const TYPE_LABEL: Record<ItemType, string> = { DRUG: 'Drug', INVESTIGATION: 'Test', PROCEDURE: 'Procedure', CONSULTATION: 'Consultation', OTHER: 'Other' };
const PAGE = 50;
const sum = (o: Partial<Record<string, number>>) => Object.values(o).reduce<number>((a, b) => a + (b ?? 0), 0);
const apiMessage = (err: any) => (err?.response ? err.response.data?.error ?? 'Something went wrong (' + err.response.status + '). Try again.' : 'Can’t reach the server.');

// Price in kwacha, saved when you leave the box or press Enter. Esc puts the old value back.
function PriceInput({ item, onSaved }: { item: PriceItem; onSaved: (i: PriceItem) => void }) {
  const initial = item.unitPrice === null ? '' : item.unitPrice.toFixed(2);
  const [v, setV] = useState(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [err, setErr] = useState('');
  useEffect(() => { setV(initial); }, [initial]);

  async function commit() {
    const clean = v.replace(/[, ]/g, '');
    if (clean === initial || (clean === '' && item.unitPrice === null)) { setV(initial); return; }
    const num = clean === '' ? null : Number(clean);
    if (num !== null && (!Number.isFinite(num) || num < 0)) { setErr('Enter a price of 0 or more'); setState('error'); return; }
    setState('saving'); setErr('');
    try {
      const { data } = await api.patch(`/price-list/${item.id}`, { unitPrice: num });
      onSaved(data);
      setState('saved');
      setTimeout(() => setState('idle'), 1500);
    } catch (e: any) {
      setErr(apiMessage(e) ?? 'Couldn’t save'); setState('error');
      if (e?.response?.status === 404) onSaved(item);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
      <span className="pl-ccy">ZMW</span>
      <input
        className={`pl-in${state === 'error' ? ' err' : ''}`}
        inputMode="decimal"
        value={v}
        placeholder="—"
        aria-label={`Price for ${item.name}`}
        aria-invalid={state === 'error'}
        onChange={(e) => { setV(e.target.value.replace(/[^\d.,]/g, '').slice(0, 12)); if (state === 'error') setState('idle'); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setV(initial); setState('idle'); (e.target as HTMLInputElement).blur(); }
        }}
        title={err || (item.updatedBy ? `Last set by ${item.updatedBy.name}, ${new Date(item.updatedAt).toLocaleDateString('en-GB')}` : undefined)}
      />
      <span style={{ width: 16, display: 'inline-flex' }} aria-live="polite">
        {state === 'saving' ? <span className="pl-dot" /> : state === 'saved' ? <Check size={14} color="var(--st-ok)" aria-label="Saved" /> : null}
      </span>
      {state === 'error' && <span role="alert" className="a-err" style={{ margin: 0, fontSize: 12 }}>{err}</span>}
    </div>
  );
}

export default function PriceListSection() {
  const [tab, setTab] = useState<ItemType | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [onlyUnpriced, setOnlyUnpriced] = useState(false);
  const [skip, setSkip] = useState(0);
  const [data, setData] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<'sync' | 'import' | 'export' | null>(null);
  const [adding, setAdding] = useState(false);
  const [report, setReport] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { const t = setTimeout(() => { setTerm(q.trim()); setSkip(0); }, 250); return () => clearTimeout(t); }, [q]);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const { data: d } = await api.get('/price-list', {
        params: { type: tab === 'ALL' ? undefined : tab, q: term || undefined, priced: onlyUnpriced ? 'no' : undefined, take: PAGE, skip },
      });
      setData(d);
    } catch { setFailed(true); } finally { setLoading(false); }
  }, [tab, term, onlyUnpriced, skip]);
  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener('price-list-changed', refresh);
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('price-list-changed', refresh); window.removeEventListener('focus', refresh); };
  }, [load]);

  function replaceItem(updated: PriceItem) {
    notifyPricesChanged();
    setData((d) => d && { ...d, items: d.items.map((i) => (i.id === updated.id ? { ...i, ...updated } : i)) });
    load();   // refresh counts and the "no price" filter
  }

  async function setActive(item: PriceItem) {
    try {
      const { data: u } = await api.patch(`/price-list/${item.id}`, { active: !item.active });
      replaceItem(u);
    } catch (e: any) { const m = apiMessage(e); if (m) toast.error(m); if (e?.response?.status === 404) load(); }
  }

  async function syncFromCatalogues() {
    setBusy('sync');
    try {
      const seeds = catalogueSeeds();
      let created = 0;
      for (let i = 0; i < seeds.length; i += 200) {
        const { data: r } = await api.post('/price-list/sync', { items: seeds.slice(i, i + 200) });
        created += r.created;
      }
      toast.success(created > 0 ? `Added ${created.toLocaleString()} items from the catalogues (prices blank)` : 'Everything in the catalogues is already on the list');
      notifyPricesChanged();
      setSkip(0); load();
    } catch (e: any) { const m = apiMessage(e); if (m) toast.error(m); } finally { setBusy(null); }
  }

  async function exportCsv() {
    setBusy('export');
    try {
      const { data: rows } = await api.get('/price-list/export');
      const csv = toCsv([['type', 'code', 'name', 'detail', 'unit', 'price', 'active'],
        ...rows.map((r: any) => [r.type, r.code, r.name, r.detail, r.unit, r.price, r.active ? 'yes' : 'no'])]);
      downloadText(`ses-price-list-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      toast.success(`Exported ${rows.length.toLocaleString()} items. Fill in the price column, then import the file back.`);
    } catch (e: any) { const m = apiMessage(e); if (m) toast.error(m); } finally { setBusy(null); }
  }

  async function importCsv(file: File) {
    setBusy('import'); setReport(null);
    try {
      const rows = parseCsv(await file.text());
      if (rows.length < 2) { toast.error('That file has no data rows.'); return; }
      const head = rows[0].map((h) => h.trim().toLowerCase());
      const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
      const [cCode, cType, cName, cDetail, cPrice] = [col('code', 'sku', 'ref'), col('type'), col('name', 'item', 'description'), col('detail', 'details', 'dose'), col('price', 'unit price', 'unitprice', 'zmw')];
      if (cPrice < 0 || (cName < 0 && cCode < 0)) { toast.error('The file needs a “price” column and either “code” or “name”. Export the list to get the right layout.'); return; }
      const body = rows.slice(1).map((r) => ({
        code: cCode >= 0 ? r[cCode]?.trim() : undefined, type: cType >= 0 ? r[cType]?.trim() : undefined,
        name: cName >= 0 ? r[cName]?.trim() : undefined, detail: cDetail >= 0 ? r[cDetail]?.trim() : undefined, price: r[cPrice],
      }));
      const { data: res } = await api.post('/price-list/import', { rows: body });
      setReport(res);
      notifyPricesChanged();
      toast.success(`${res.updated.toLocaleString()} prices updated`);
      load();
    } catch (e: any) { toast.error(e?.response ? apiMessage(e) : 'Couldn’t read that file.'); } finally { setBusy(null); if (fileRef.current) fileRef.current.value = ''; }
  }

  const total = data?.total ?? 0;
  const counts = data?.counts ?? {};
  const unpricedTotal = sum(data?.unpriced ?? {});
  const empty = !loading && !failed && sum(counts) === 0;

  return (
    <section aria-labelledby="pl-h" className="a-card">
      <div className="pl-header">
        <div className="pl-intro">
          <div className="pl-title-row">
            <h2 id="pl-h" className="a-h2">Price list</h2>
            {unpricedTotal > 0 && (
              <span className="pl-unpriced" title="Active items without a price">{unpricedTotal.toLocaleString()} unpriced</span>
            )}
          </div>
          <p className="a-muted pl-description">Prices in ZMW for drugs, tests, procedures and consultations.</p>
        </div>
        <div className="pl-actions" role="group" aria-label="Price list actions">
          <button type="button" className="a-q" onClick={syncFromCatalogues} disabled={busy !== null} title="Add every drug and test from the app’s catalogues. Existing prices are never changed.">
            <DatabaseZap size={15} aria-hidden="true" /><span>{busy === 'sync' ? 'Loading…' : 'Load from catalogues'}</span>
          </button>
          <button type="button" className="a-q" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
            <Upload size={15} aria-hidden="true" /><span>{busy === 'import' ? 'Importing…' : 'Import prices'}</span>
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); }} />
          <button type="button" className="a-q" onClick={exportCsv} disabled={busy !== null || empty}>
            <Download size={15} aria-hidden="true" /><span>{busy === 'export' ? 'Exporting…' : 'Export'}</span>
          </button>
          <button type="button" className="a-btn" onClick={() => setAdding(true)} disabled={adding}><Plus size={15} strokeWidth={2.2} aria-hidden="true" /><span>Add item</span></button>
        </div>
      </div>

      {report && (
        <div className="pl-report" role="status">
          <div style={{ flex: 1 }}>
            <strong>Import finished:</strong> {report.updated.toLocaleString()} updated, {report.unchanged.toLocaleString()} already had that price
            {report.blank > 0 && <>, {report.blank.toLocaleString()} left blank</>}.
            {(report.unmatchedCount > 0 || report.invalidCount > 0 || report.ambiguous > 0) && (
              <div style={{ marginTop: 4, color: 'var(--st-warn)' }}>
                {report.unmatchedCount > 0 && <>{report.unmatchedCount} not found{report.unmatched.length ? ` (e.g. ${report.unmatched.slice(0, 3).join('; ')})` : ''}. </>}
                {report.invalidCount > 0 && <>{report.invalidCount} had an invalid price{report.invalid.length ? ` (e.g. ${report.invalid[0]})` : ''}. </>}
                {report.ambiguous > 0 && <>{report.ambiguous} matched more than one item — include the code column. </>}
              </div>
            )}
          </div>
          <button type="button" className="a-q" onClick={() => setReport(null)}>Dismiss</button>
        </div>
      )}

      {adding && <AddItem onCancel={() => setAdding(false)} onAdded={() => { setAdding(false); load(); }} />}

      <div className="pl-bar">
        <div role="tablist" aria-label="Item type" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {TABS.map((t) => {
            const n = t.id === 'ALL' ? sum(counts) : counts[t.id] ?? 0;
            const u = t.id === 'ALL' ? unpricedTotal : data?.unpriced?.[t.id] ?? 0;
            return (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`pl-tab${tab === t.id ? ' on' : ''}`}
                onClick={() => { setTab(t.id); setSkip(0); }}>
                {t.label} · {n.toLocaleString()}{u > 0 && <span className="pl-u" title={`${u} without a price`}>{u.toLocaleString()}</span>}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyUnpriced} onChange={(e) => { setOnlyUnpriced(e.target.checked); setSkip(0); }} /> No price only
          </label>
          <label className="a-search" style={{ width: 280 }}>
            <Search size={16} color="var(--text-subtle)" aria-hidden="true" />
            <span className="sr-only">Search the price list</span>
            <input type="search" placeholder="Search name, dose or code" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
      </div>

      {failed ? (
        <div style={{ padding: '40px 20px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px', fontWeight: 500, color: 'var(--text-heading)' }}>Couldn’t load the price list</p>
          <p className="a-muted" style={{ margin: '0 0 14px' }}>Check your connection, then try again.</p>
          <button type="button" className="a-q" onClick={() => { setLoading(true); load(); }}>Try again</button>
        </div>
      ) : loading && !data ? (
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>{[0, 1, 2, 3].map((i) => <div key={i} className="a-skel" />)}</div>
      ) : empty ? (
        <div style={{ padding: '48px 20px 52px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 500, color: 'var(--text-heading)' }}>The price list is empty</p>
          <p className="a-muted" style={{ margin: '0 0 16px' }}>Load every drug and test from the app’s catalogues, then fill in prices here or import them from a spreadsheet.</p>
          <button type="button" className="a-btn" onClick={syncFromCatalogues} disabled={busy !== null}>{busy === 'sync' ? 'Loading…' : 'Load from catalogues'}</button>
        </div>
      ) : (data?.items.length ?? 0) === 0 ? (
        <div style={{ padding: '40px 20px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px', fontWeight: 500, color: 'var(--text-heading)' }}>Nothing matches{term ? ` “${term}”` : ' these filters'}</p>
          <p className="a-muted" style={{ margin: 0 }}>Try a different word, or clear the filters.</p>
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto', opacity: loading ? 0.6 : 1, transition: 'opacity .15s' }}>
            <table className="a-tbl" style={{ minWidth: 820 }}>
              <thead><tr>
                <th style={{ paddingLeft: 20 }}>Item</th><th>Type</th><th>Priced</th><th style={{ textAlign: 'right' }}>Price</th><th style={{ paddingRight: 20 }}>Active</th>
              </tr></thead>
              <tbody>
                {data!.items.map((i) => (
                  <tr key={i.id} style={{ opacity: i.active ? 1 : 0.55 }}>
                    <td style={{ paddingLeft: 20 }}>
                      <div style={{ fontWeight: 500, color: 'var(--text-heading)' }}>{i.name}</div>
                      <div className="a-faint" style={{ fontSize: 12 }}>{[i.detail, i.catalogueRef].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td><span className="a-tag">{TYPE_LABEL[i.itemType]}</span></td>
                    <td className="a-muted" style={{ fontSize: 13 }}>{i.unit}{i.bottleSizeMl != null && <div style={{ fontSize: 11 }}>{Number(i.bottleSizeMl)} mL bottle</div>}</td>
                    <td><PriceInput item={i} onSaved={replaceItem} /></td>
                    <td style={{ paddingRight: 20 }}>
                      <button type="button" role="switch" aria-checked={i.active} aria-label={`${i.name} active`} className={`a-sw${i.active ? ' on' : ''}`} onClick={() => setActive(i)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pl-foot">
            <span className="a-muted" style={{ fontSize: 13 }}>
              {total === 0 ? '0' : `${(skip + 1).toLocaleString()}–${Math.min(skip + PAGE, total).toLocaleString()}`} of {total.toLocaleString()}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="a-q" onClick={() => setSkip(Math.max(0, skip - PAGE))} disabled={skip === 0 || loading}>Previous</button>
              <button type="button" className="a-q" onClick={() => setSkip(skip + PAGE)} disabled={skip + PAGE >= total || loading}>Next</button>
            </div>
          </div>
        </>
      )}

      <style>{CSS}</style>
    </section>
  );
}

function AddItem({ onCancel, onAdded }: { onCancel: () => void; onAdded: () => void }) {
  const [itemType, setItemType] = useState<'PROCEDURE' | 'CONSULTATION' | 'OTHER'>('PROCEDURE');
  const [name, setName] = useState('');
  const [detail, setDetail] = useState('');
  const [unit, setUnit] = useState('each');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) { setError('Enter a name.'); return; }
    setBusy(true); setError('');
    try {
      await api.post('/price-list', { itemType, name: name.trim(), detail: detail.trim() || undefined, unit: unit.trim() || 'each', unitPrice: price.trim() === '' ? null : price });
      toast.success(`${name.trim()} added`);
      onAdded();
    } catch (err: any) { const m = apiMessage(err); if (m) setError(m); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={save} className="pl-add">
      <div style={{ flex: '0 0 150px' }}>
        <label className="a-k" htmlFor="pl-type" style={{ display: 'block', marginBottom: 6 }}>Type</label>
        <select id="pl-type" className="a-field" value={itemType} onChange={(e) => setItemType(e.target.value as typeof itemType)}>
          <option value="PROCEDURE">Procedure</option><option value="CONSULTATION">Consultation</option><option value="OTHER">Other</option>
        </select>
      </div>
      <div style={{ flex: '2 1 220px' }}>
        <label className="a-k" htmlFor="pl-name" style={{ display: 'block', marginBottom: 6 }}>Name</label>
        <input id="pl-name" className="a-field" value={name} autoFocus maxLength={120} placeholder="e.g. Wound dressing" onChange={(e) => { setName(e.target.value); setError(''); }} />
      </div>
      <div style={{ flex: '1 1 150px' }}>
        <label className="a-k" htmlFor="pl-detail" style={{ display: 'block', marginBottom: 6 }}>Detail <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· optional</span></label>
        <input id="pl-detail" className="a-field" value={detail} maxLength={120} onChange={(e) => setDetail(e.target.value)} />
      </div>
      <div style={{ flex: '0 0 120px' }}>
        <label className="a-k" htmlFor="pl-unit" style={{ display: 'block', marginBottom: 6 }}>Priced per</label>
        <input id="pl-unit" className="a-field" value={unit} maxLength={40} onChange={(e) => setUnit(e.target.value)} />
      </div>
      <div style={{ flex: '0 0 130px' }}>
        <label className="a-k" htmlFor="pl-price" style={{ display: 'block', marginBottom: 6 }}>Price (ZMW)</label>
        <input id="pl-price" className="a-field" inputMode="decimal" value={price} placeholder="optional" onChange={(e) => setPrice(e.target.value.replace(/[^\d.,]/g, ''))} />
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" className="a-q" style={{ height: 40 }} onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="a-btn" disabled={busy}>{busy ? 'Saving…' : 'Add'}</button>
      </div>
      {error && <p role="alert" className="a-err" style={{ flexBasis: '100%', margin: 0 }}>{error}</p>}
    </form>
  );
}

export const CSS = `
.pl-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 20px; padding: 20px; border-bottom: 1px solid var(--border-light); }
.pl-intro { flex: 1 1 360px; min-width: 0; }
.pl-title-row { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.pl-description { margin: 6px 0 0; font-size: 13px; line-height: 1.6; }
.pl-unpriced { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 999px; background: var(--st-warn-bg); color: var(--st-warn); font-size: 11px; line-height: 1.5; font-weight:500; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pl-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.pl-actions > button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 38px; padding: 0 14px; border-radius: 10px; font-family: var(--font-body); font-size: 13px; font-weight:500; line-height: 1; white-space: nowrap; }
.pl-actions > button svg { flex-shrink: 0; }
.pl-actions > button:focus-visible { outline: 2px solid var(--ring); outline-offset: 3px; }
@media (max-width: 560px) { .pl-header { padding: 16px; gap: 16px; } .pl-intro { flex-basis: 100%; } .pl-actions { display: grid; width: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); } .pl-actions > button { min-width: 0; padding: 0 8px; font-size: 12px; } }

@media (max-width: 380px) { .pl-actions { grid-template-columns: minmax(0, 1fr); } }
.pl-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 12px 20px; border-bottom: 1px solid var(--border-light); }
.pl-tab { height: 30px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; color: var(--text-muted); font: inherit; font-size: 12px; font-weight:500; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.pl-tab:hover { background: var(--ws-chip); }
.pl-tab.on { background: var(--ws-chip-on); color: var(--ws-chip-on-text); }
.pl-u { min-width: 18px; height: 16px; padding: 0 5px; border-radius: 8px; background: var(--st-warn-bg); color: var(--st-warn); font-size: 11px; font-weight:500; display: inline-flex; align-items: center; justify-content: center; }
.pl-ccy { font-size: 12px; font-weight:500; color: var(--text-subtle); }
.pl-in { width: 110px; height: 34px; padding: 0 10px; border: 1px solid var(--btn2-line); border-radius: 8px; background: var(--btn2); color: var(--text-heading); font: inherit; font-size: 14px; font-weight:500; text-align: right; font-variant-numeric: tabular-nums; outline: 0; }
.pl-in::placeholder { color: var(--text-subtle); font-weight: 400; }
.pl-in:focus { border-color: var(--ring); box-shadow: 0 0 0 3px var(--ring-glow); }
.pl-in.err { border-color: var(--st-bad); }
.pl-dot { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--text-subtle); border-top-color: transparent; animation: pl-spin .8s linear infinite; display: inline-block; }
@keyframes pl-spin { to { transform: rotate(360deg); } }
.pl-foot { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-top: 1px solid var(--border-light); }
.pl-add { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; padding: 14px 20px; background: var(--ws-head); border-bottom: 1px solid var(--border-light); }
.pl-report { display: flex; gap: 12px; align-items: flex-start; padding: 12px 20px; background: var(--ws-blue-bg); border-bottom: 1px solid var(--border-light); font-size: 13px; color: var(--text-heading); }
`;
