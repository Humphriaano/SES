import { useState, useRef, useEffect } from 'react';
import { X, Plus, FlaskConical } from 'lucide-react';
import { InvestigationBlockData } from '../../../types/consultation';
import { searchCatalogue, CatalogueResult, CataloguePanel, CatalogueSingle } from '../../../data/investigationsCatalogue';
import api from '../../../api/client';
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
        await api.post('/investigations/orders', { patientId, encounterId, items });
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
    <div style={{
      borderLeft: '3px solid #00897B',
      background: 'var(--bg-card)',
      borderRadius: '0 10px 10px 0',
      padding: '10px 14px',
      margin: '4px 0',
      fontFamily: "'Segoe UI', system-ui, sans-serif",
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: (data.items.length > 0 || basket.length > 0) ? 8 : 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, color: '#00897B',
            background: 'var(--badge-green-bg)', padding: '2px 7px', borderRadius: 4, fontFamily: 'monospace',
          }}>Inv</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-heading)' }}>Investigations</span>
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
          <FlaskConical size={12} color="#00897B" />
          <span style={{ flex: 1, fontSize: 13, color: 'var(--text-heading)' }}>{item.name}</span>
          <span style={{
            fontSize: 11, fontWeight: 600,
            background: item.status === 'RESULTED' ? '#DCFCE7' : '#FEF9C3',
            color: item.status === 'RESULTED' ? '#14532D' : '#713F12',
            border: `1px solid ${item.status === 'RESULTED' ? '#86EFAC' : '#FDE047'}`,
            borderRadius: 5, padding: '2px 8px',
          }}>
            {item.status === 'RESULTED' ? '✓ Resulted' : 'Pending'}
          </span>
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
          <div style={{ fontSize: 10, fontWeight: 600, color: '#00897B', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Basket ({basket.length})
          </div>
          {basket.map(b => {
            const isPanel = b.kind === 'panel';
            const panel = isPanel ? (b.item as CataloguePanel) : null;
            const single = !isPanel ? (b.item as CatalogueSingle) : null;
            return (
              <div key={b.key} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'var(--badge-green-bg)', border: '1px solid var(--border)',
                borderRadius: 6, padding: '5px 10px', marginBottom: 4,
              }}>
                <span style={{
                  fontSize: 9, fontWeight: 700,
                  background: isPanel ? '#0d9488' : '#0891b2',
                  color: '#fff', borderRadius: 3, padding: '1px 5px',
                }}>
                  {isPanel ? 'Panel' : 'Test'}
                </span>
                <span style={{ flex: 1, fontSize: 12, color: 'var(--text-heading)', fontWeight: 500 }}>
                  {isPanel ? panel!.panelName : single!.name}
                </span>
                {isPanel && (
                  <span style={{ fontSize: 11, color: '#0f766e' }}>
                    {panel!.specimen} · {panel!.components.length} tests
                  </span>
                )}
                {!isPanel && single!.specimen && (
                  <span style={{ fontSize: 11, color: '#0f766e' }}>{single!.specimen}</span>
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
                border: '1.5px solid var(--border)', borderRadius: 6,
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
                    onMouseDown={() => !inBasket && addToBasket(result)}
                    style={{
                      width: '100%', textAlign: 'left', padding: '8px 12px',
                      background: inBasket ? 'var(--badge-green-bg)' : 'none',
                      border: 'none', borderBottom: '1px solid var(--border-light)',
                      fontSize: 13, cursor: inBasket ? 'default' : 'pointer',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}
                    onMouseEnter={e => { if (!inBasket) e.currentTarget.style.background = 'var(--bg-surface)'; }}
                    onMouseLeave={e => { if (!inBasket) e.currentTarget.style.background = 'none'; }}
                  >
                    <span style={{
                      fontSize: 9, fontWeight: 700,
                      background: isPanel ? '#0d9488' : '#0891b2',
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
                    {inBasket && <span style={{ fontSize: 10, color: '#00897B' }}>Added</span>}
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
                background: submitting ? 'var(--text-subtle)' : '#00897B',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '7px 14px',
                fontSize: 13,
                fontWeight: 600,
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
