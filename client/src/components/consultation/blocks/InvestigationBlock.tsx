import { useState, useRef, useEffect, useCallback } from 'react';
import { useVisiblePolling } from '../../../hooks/useVisiblePolling';
import { flattenOrders, pairWithOrders, isDone } from '../../../lib/investigations';
import { X, Plus, FlaskConical } from 'lucide-react';
import { InvestigationBlockData } from '../../../types/consultation';
import { searchCatalogue, CatalogueResult, CataloguePanel, CatalogueSingle } from '../../../data/investigationsCatalogue';
import api from '../../../api/client';
import { usePrices, priceText } from '../../../lib/prices';
import InlinePrice from '../../billing/InlinePrice';
import { flushPriceEdits } from '../../../lib/priceEditing';
import { zmw } from '../../../lib/money';
import toast from 'react-hot-toast';

interface BasketItem {
  key: string;
  kind: 'panel' | 'single';
  item: CataloguePanel | CatalogueSingle;
}

interface Props {
  data: InvestigationBlockData;
  onChange: (data: InvestigationBlockData) => void;
  onRemove: () => void;
  readOnly?: boolean;
  patientId?: string;
  encounterId?: string;
}

// What the lab has actually done with an ordered test, as reported by the server.
type LiveStatus = 'Pending' | 'In Progress' | 'Resulted' | 'Amended';

const DONE: LiveStatus[] = ['Resulted', 'Amended'];

export default function InvestigationBlock({
  data,
  onChange,
  onRemove,
  readOnly,
  patientId,
  encounterId,
}: Props) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<CatalogueResult[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [basket, setBasket] = useState<BasketItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<Record<string, LiveStatus>>({});   // block item id → real status
  const refOf = (r: { kind: 'panel' | 'single'; item: CataloguePanel | CatalogueSingle }) =>
    r.kind === 'panel' ? `panel_${(r.item as CataloguePanel).id}` : `single_${(r.item as CatalogueSingle).id}`;
  const prices = usePrices([...suggestions.map(refOf), ...basket.map(b => b.key), ...(!readOnly ? data.items.map(item => item.catalogCode ?? '') : [])]);
  const basketTotal = basket.reduce((s, b) => s + (prices[b.key] ?? 0), 0);
  const basketUnpriced = basket.filter(b => prices[b.key] === null).length;
  const basketPricing = basket.some(b => prices[b.key] === undefined);
  const dataRef = useRef(data);
  dataRef.current = data;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // The block is a note: its Pending/Resulted label was frozen the moment the test was ordered.
  // Ask the server what the lab has done, show that, and keep the note's saved status in step
  // (the decision-support panel reads "pending investigations" from the note).
  const sync = useCallback(async () => {
    if (!encounterId && !patientId) return;
    try {
      const { data: orders } = await api.get('/investigations/orders', { params: encounterId ? { encounterId } : { patientId } });
      const items = dataRef.current.items;
      const matched = pairWithOrders(items, flattenOrders(orders));

      const nextLive: Record<string, LiveStatus> = {};
      let changed = false;
      const updated = items.map((item, i) => {
        const s = matched[i];
        if (!s) return item;
        nextLive[item.id] = s.status;
        const stored: 'PENDING' | 'RESULTED' = isDone(s.status) ? 'RESULTED' : 'PENDING';
        if (item.status !== stored || item.orderItemId !== s.id) { changed = true; return { ...item, status: stored, orderItemId: s.id }; }
        return item;
      });
      setLive(nextLive);
      if (changed && !readOnly) onChangeRef.current({ items: updated });
    } catch { /* keep what is shown; the API client already reported connectivity problems */ }
  }, [encounterId, patientId, readOnly]);

  // Check on open, whenever the list of tests changes, and every 30s while anything is still outstanding.
  const outstanding = data.items.some((i) => i.status !== 'RESULTED' || !i.orderItemId);
  useVisiblePolling(sync, 30000, outstanding);
  useEffect(() => { sync(); }, [data.items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (query.length >= 2) {
      setSuggestions(searchCatalogue(query, 15));
      setDropdownOpen(true);
    } else {
      setSuggestions([]);
      setDropdownOpen(false);
    }
  }, [query]);

  function addToBasket(result: CatalogueResult) {
    const key = result.kind === 'panel'
      ? `panel_${(result.item as CataloguePanel).id}`
      : `single_${(result.item as CatalogueSingle).id}`;
    if (basket.some(b => b.key === key)) return;
    setBasket(prev => [...prev, { key, kind: result.kind, item: result.item }]);
    setQuery('');
    setSuggestions([]);
    setDropdownOpen(false);
  }

  function removeFromBasket(key: string) {
    setBasket(prev => prev.filter(b => b.key !== key));
  }

  async function submitOrder() {
    if (basket.length === 0) return;

    const items = basket.map(b => {
      if (b.kind === 'panel') {
        const panel = b.item as CataloguePanel;
        return {
          type: 'panel',
          catalogueId: panel.id,
          name: panel.panelName,
          specimen: panel.specimen,
          componentsJson: panel.components,
        };
      } else {
        const single = b.item as CatalogueSingle;
        return {
          type: 'single',
          catalogueId: String(single.id),
          name: single.name,
          specimen: single.specimen,
          componentsJson: null,
        };
      }
    });

    if (patientId && encounterId) {
      setSubmitting(true);
      try {
        if (!(await flushPriceEdits(basket.map(b => b.key)))) { toast.error('The price has not saved yet. Check the price field and try again.'); return; }
        const { data: order } = await api.post('/investigations/orders', { patientId, encounterId, items });
        const created: { id: string; type: string; catalogueId: string }[] = order?.items ?? [];
        const newItems = basket.map(b => ({
          id: `${Date.now()}_${b.key}`,
          name: b.kind === 'panel'
            ? (b.item as CataloguePanel).panelName
            : (b.item as CatalogueSingle).name,
          catalogCode: b.key,
          catalogueType: b.kind as 'panel' | 'single',
          status: 'PENDING' as const,
          orderItemId: created.find(c => `${c.type}_${c.catalogueId}` === b.key)?.id,
        }));
        onChange({ items: [...data.items, ...newItems] });
        setBasket([]);
        toast.success('Order submitted');
      } catch {
        toast.error('Failed to submit order');
      } finally {
        setSubmitting(false);
      }
    } else {
      const newItems = basket.map(b => ({
        id: `${Date.now()}_${b.key}`,
        name: b.kind === 'panel'
          ? (b.item as CataloguePanel).panelName
          : (b.item as CatalogueSingle).name,
        catalogCode: b.key,
        catalogueType: b.kind as 'panel' | 'single',
        status: 'PENDING' as const,
      }));
      onChange({ items: [...data.items, ...newItems] });
      setBasket([]);
    }
  }

  const canSubmit = basket.length > 0 && !readOnly;

  return (
    <div className="note-block" style={{
      border: '1px solid var(--border)',
      background: 'var(--bg-surface)',
      borderRadius: 18,
      padding: '10px 14px',
      margin: '16px 0',
      fontFamily: "'Segoe UI', system-ui, sans-serif",
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: (data.items.length > 0 || basket.length > 0) ? 8 : 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 10, fontWeight: 500, color: 'var(--ses-blue-deep)',
            background: 'var(--ses-blue-tint)', padding: '2px 7px', borderRadius: 4, fontFamily: 'monospace',
          }}>Inv</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-heading)' }}>Investigations</span>
        </div>
        {!readOnly && (
          <button
            onClick={onRemove}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Ordered items */}
      {data.items.map(item => (
        <div key={item.id} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 7, padding: '6px 10px', marginBottom: 5,
        }}>
          <FlaskConical size={12} color="var(--ses-blue-deep)" />
          <span style={{ flex: 1, fontSize: 13, color: 'var(--text-heading)' }}>{item.name}</span>
          {!readOnly && item.catalogCode && (
            <InlinePrice catalogueRef={item.catalogCode} itemType="INVESTIGATION" name={item.name} value={prices[item.catalogCode]} patientId={patientId} unpricedLabel="ZMW —" />
          )}
          {(() => {
            const real = live[item.id];
            const done = real ? DONE.includes(real) : item.status === 'RESULTED';
            const inProgress = real === 'In Progress';
            const tone = done ? 'green' : inProgress ? 'blue' : 'amber';
            return (
              <span style={{
                fontSize: 11, fontWeight: 500,
                background: `var(--badge-${tone}-bg)`,
                color: `var(--badge-${tone}-text)`,
                border: `1px solid var(--badge-${tone}-text)`,
                borderRadius: 5, padding: '2px 8px',
              }}>
                {done ? (real === 'Amended' ? '✓ Resulted · amended' : '✓ Resulted') : inProgress ? 'In progress' : 'Pending'}
              </span>
            );
          })()}
          {!readOnly && (
            <button
              onClick={() => onChange({ items: data.items.filter(i => i.id !== item.id) })}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
            >
              <X size={11} />
            </button>
          )}
        </div>
      ))}

      {/* Basket */}
      {!readOnly && basket.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--ses-blue-deep)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Basket ({basket.length})
          </div>
          {basket.map(b => {
            const isPanel = b.kind === 'panel';
            const panel = isPanel ? (b.item as CataloguePanel) : null;
            const single = !isPanel ? (b.item as CatalogueSingle) : null;
            return (
              <div key={b.key} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'var(--ses-blue-tint)', border: '1px solid var(--border)',
                borderRadius: 6, padding: '5px 10px', marginBottom: 4,
              }}>
                <span style={{
                  fontSize: 9, fontWeight: 500,
                  background: isPanel ? 'var(--ses-blue-deep)' : 'var(--ses-blue)',
                  color: '#fff', borderRadius: 3, padding: '1px 5px',
                }}>
                  {isPanel ? 'Panel' : 'Test'}
                </span>
                <span style={{ flex: 1, fontSize: 12, color: 'var(--text-heading)', fontWeight: 500 }}>
                  {isPanel ? panel!.panelName : single!.name}
                </span>
                {isPanel && (
                  <span style={{ fontSize: 11, color: 'var(--ses-blue-deep)' }}>
                    {panel!.specimen} · {panel!.components.length} tests
                  </span>
                )}
                {!isPanel && single!.specimen && (
                  <span style={{ fontSize: 11, color: 'var(--ses-blue-deep)' }}>{single!.specimen}</span>
                )}
                {basket.length > 1 && prices[b.key] !== undefined && (
                  <InlinePrice catalogueRef={b.key} itemType="INVESTIGATION" name={isPanel ? panel!.panelName : single!.name} value={prices[b.key]} patientId={patientId} editable={!readOnly} unpricedLabel="ZMW —" />
                )}
                <button
                  onClick={() => removeFromBasket(b.key)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-body2)', padding: '2px 4px' }}>
            <span>Estimated cost{basketUnpriced > 0 ? ` · ${basketUnpriced} without a price yet` : ''}</span>
            <b style={{ color: 'var(--text-heading)' }}>
              {basket.length === 1 ? <InlinePrice catalogueRef={basket[0].key} itemType="INVESTIGATION" name={basket[0].kind === 'panel' ? (basket[0].item as CataloguePanel).panelName : (basket[0].item as CatalogueSingle).name} value={prices[basket[0].key]} patientId={patientId} unpricedLabel={zmw(0)} /> : basketPricing ? 'Checking prices…' : zmw(basketTotal)}
            </b>
          </div>
        </div>
      )}

      {/* Search input */}
      {!readOnly && (
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              ref={inputRef}
              type="text"
              placeholder="Search investigations…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={() => { if (query.length >= 2) setDropdownOpen(true); }}
              onBlur={() => setTimeout(() => setDropdownOpen(false), 200)}
              style={{
                flex: 1, padding: '6px 10px',
                border: '1.5px solid var(--border)', borderRadius: 14,
                fontSize: 13, outline: 'none', background: 'var(--bg-input)',
                color: 'var(--text-heading)',
                fontFamily: "'Segoe UI', system-ui, sans-serif",
              }}
            />
          </div>

          {/* Dropdown */}
          {dropdownOpen && suggestions.length > 0 && (
            <div
              ref={dropdownRef}
              style={{
                position: 'absolute', zIndex: 200, background: 'var(--bg-card)',
                border: '1px solid var(--border-input)', borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                width: '100%', maxHeight: 220, overflowY: 'auto', marginTop: 4,
              }}
            >
              {suggestions.map(result => {
                const isPanel = result.kind === 'panel';
                const panel = isPanel ? (result.item as CataloguePanel) : null;
                const single = !isPanel ? (result.item as CatalogueSingle) : null;
                const key = isPanel
                  ? `panel_${panel!.id}`
                  : `single_${single!.id}`;
                const inBasket = basket.some(b => b.key === key);

                return (
                  <button
                    key={key}
                    title={(isPanel ? panel!.loinc : single!.loinc) ? `LOINC ${isPanel ? panel!.loinc : single!.loinc}` : undefined}
                    onMouseDown={() => !inBasket && addToBasket(result)}
                    style={{
                      width: '100%', textAlign: 'left', padding: '8px 12px',
                      background: inBasket ? 'var(--ses-blue-tint)' : 'none',
                      border: 'none', borderBottom: '1px solid var(--border-light)',
                      fontSize: 13, cursor: inBasket ? 'default' : 'pointer',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}
                    onMouseEnter={e => { if (!inBasket) e.currentTarget.style.background = 'var(--bg-surface)'; }}
                    onMouseLeave={e => { if (!inBasket) e.currentTarget.style.background = 'none'; }}
                  >
                    <span style={{
                      fontSize: 9, fontWeight: 500,
                      background: isPanel ? 'var(--ses-blue-deep)' : 'var(--ses-blue)',
                      color: '#fff', borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap',
                    }}>
                      {isPanel ? 'Panel' : 'Test'}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontWeight: isPanel ? 700 : 400,
                        color: 'var(--text-heading)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {isPanel ? panel!.panelName : single!.name}
                        {!isPanel && single!.abbr && single!.abbr !== single!.name && (
                          <span style={{ color: 'var(--text-body2)', fontWeight: 400 }}> — {single!.abbr}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-body2)' }}>
                        {isPanel
                          ? `${panel!.specimen} · ${panel!.components.length} tests`
                          : single!.specimen || ''}
                      </div>
                    </div>
                    {prices[key] !== undefined && (
                      <span style={{ fontSize: 11.5, fontWeight: 500, whiteSpace: 'nowrap', color: prices[key] === null ? 'var(--text-subtle)' : 'var(--text-heading)' }}>{priceText(prices[key])}</span>
                    )}
                    {inBasket && <span style={{ fontSize: 10, color: 'var(--ses-blue-deep)' }}>Added</span>}
                  </button>
                );
              })}
            </div>
          )}

          {/* Submit Order button */}
          {canSubmit && (
            <button
              onClick={submitOrder}
              disabled={submitting}
              style={{
                marginTop: 8,
                width: '100%',
                background: submitting ? 'var(--text-subtle)' : 'var(--btn-accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 999,
                padding: '7px 14px',
                fontSize: 13,
                fontWeight: 500,
                cursor: submitting ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <Plus size={13} />
              {submitting ? 'Submitting…' : (patientId && encounterId ? 'Submit Order' : 'Add to Note')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
