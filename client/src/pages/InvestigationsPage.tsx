import { useEffect, useState, Fragment } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { Plus, ChevronDown, ChevronRight, X } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../lib/money';
import { moduleLanding } from '../lib/moduleAccess';
import { usePatient } from '../context/PatientContext';
import { Encounter } from '../types';
import ConsultationSidebar from '../components/consultation/ConsultationSidebar';
import '../components/consultation/ClinicalWorkspace.css';
import catalogJson from '../data/investigationsCatalogue.json';
import {
  searchCatalogue, CatalogueResult, CataloguePanel, CatalogueSingle,
  getPanelById, getSingleById, allPanels,
} from '../data/investigationsCatalogue';

const catalogue = catalogJson as { panels: CataloguePanel[]; singles: CatalogueSingle[] };

function getPanelByName(name: string): CataloguePanel | undefined {
  return allPanels().find(p => p.panelName.toLowerCase() === name.toLowerCase());
}
import toast from 'react-hot-toast';

// ── Design tokens (CSS var-based for dark mode support) ───────────────────────
const T = {
  pageBg: 'var(--bg-page)',
  cardBg: 'var(--premium-panel-bg)',
  cardBorder: '1px solid var(--border)',
  title: 'var(--text-heading)',
  body: 'var(--text-body2)',
  muted: 'var(--text-muted)',
  primary: 'var(--ses-red)',
  font: 'var(--font-body)',
};

function statusBadge(status: string) {
  const map: Record<string, { bg: string; color: string }> = {
    Pending:       { bg: 'var(--badge-gray-bg)',  color: 'var(--badge-gray-text)' },
    'In Progress': { bg: 'var(--badge-blue-bg)',  color: 'var(--badge-blue-text)' },
    Resulted:      { bg: 'var(--badge-green-bg)', color: 'var(--badge-green-text)' },
    Amended:       { bg: 'var(--badge-amber-bg)', color: 'var(--badge-amber-text)' },
  };
  const s = map[status] ?? { bg: 'var(--badge-gray-bg)', color: 'var(--badge-gray-text)' };
  return (
    <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 10, background: s.bg, color: s.color }}>
      {status}
    </span>
  );
}

function resultColor(status: string): string {
  if (status === 'High' || status === 'Low' || status === 'Abnormal') return 'var(--clinical-abnormal)';
  if (status === 'Critical') return 'var(--clinical-critical)';
  if (status === 'Positive') return 'var(--clinical-critical)';
  if (status === 'Normal' || status === 'Negative') return 'var(--clinical-normal)';
  return T.body;
}

// ── Basket ────────────────────────────────────────────────────────────────────
interface BasketItem {
  key: string;
  kind: 'panel' | 'single';
  item: CataloguePanel | CatalogueSingle;
}

function OrderBasket({ basket, setBasket }: {
  basket: BasketItem[];
  setBasket: React.Dispatch<React.SetStateAction<BasketItem[]>>;
}) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<CatalogueResult[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (query.length >= 2) { setSuggestions(searchCatalogue(query, 15)); setOpen(true); }
    else { setSuggestions([]); setOpen(false); }
  }, [query]);

  function add(result: CatalogueResult) {
    const key = result.kind === 'panel'
      ? `panel_${(result.item as CataloguePanel).id}`
      : `single_${(result.item as CatalogueSingle).id}`;
    if (basket.some(b => b.key === key)) return;
    setBasket(prev => [...prev, { key, kind: result.kind, item: result.item }]);
    setQuery(''); setSuggestions([]); setOpen(false);
  }

  return (
    <div>
      {basket.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {basket.map(b => {
            const isPanel = b.kind === 'panel';
            const panel = isPanel ? (b.item as CataloguePanel) : null;
            const single = !isPanel ? (b.item as CatalogueSingle) : null;
            return (
              <div key={b.key} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'var(--badge-green-bg)', border: '1px solid var(--border)',
                borderRadius: 10, padding: '6px 10px', marginBottom: 5,
              }}>
                <span style={{ fontSize: 9, fontWeight: 500, background: isPanel ? 'var(--ses-blue-deep)' : 'var(--ses-blue)', color: '#fff', borderRadius: 3, padding: '1px 5px' }}>
                  {isPanel ? 'Panel' : 'Test'}
                </span>
                <span style={{ flex: 1, fontSize: 13, color: 'var(--text-heading)', fontWeight: 500 }}>
                  {isPanel ? panel!.panelName : single!.name}
                </span>
                {isPanel && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{panel!.specimen} · {panel!.components.length} tests</span>}
                {!isPanel && single!.specimen && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{single!.specimen}</span>}
                <button onClick={() => setBasket(prev => prev.filter(x => x.key !== b.key))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          placeholder="Search investigations (e.g. FBC, HIV, LFTs…)"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => { if (query.length >= 2) setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '8px 12px',
            border: '1.5px solid var(--border-input)', borderRadius: 14, fontSize: 13,
            outline: 'none', fontFamily: T.font, background: 'var(--bg-input)', color: 'var(--text-heading)',
          }}
        />
        {open && suggestions.length > 0 && (
          <div style={{
            position: 'absolute', zIndex: 300, background: 'var(--bg-card)',
            border: T.cardBorder, borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            width: '100%', maxHeight: 240, overflowY: 'auto', marginTop: 4,
          }}>
            {suggestions.map(result => {
              const isPanel = result.kind === 'panel';
              const panel = isPanel ? (result.item as CataloguePanel) : null;
              const single = !isPanel ? (result.item as CatalogueSingle) : null;
              const key = isPanel ? `panel_${panel!.id}` : `single_${single!.id}`;
              const inBasket = basket.some(b => b.key === key);
              return (
                <button key={key} onMouseDown={() => !inBasket && add(result)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '8px 12px',
                    background: inBasket ? 'var(--badge-green-bg)' : 'none', border: 'none',
                    borderBottom: '1px solid var(--border-light)', fontSize: 13,
                    cursor: inBasket ? 'default' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8, fontFamily: T.font,
                  }}
                  onMouseEnter={e => { if (!inBasket) e.currentTarget.style.background = 'var(--bg-surface)'; }}
                  onMouseLeave={e => { if (!inBasket) e.currentTarget.style.background = 'none'; }}
                >
                  <span style={{ fontSize: 9, fontWeight: 500, background: isPanel ? 'var(--ses-blue-deep)' : 'var(--ses-blue)', color: '#fff', borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap' }}>
                    {isPanel ? 'Panel' : 'Test'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: isPanel ? 700 : 400, color: T.title, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {isPanel ? panel!.panelName : single!.name}
                      {!isPanel && single!.abbr && single!.abbr !== single!.name && (
                        <span style={{ color: T.muted }}> — {single!.abbr}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: T.muted }}>
                      {isPanel ? `${panel!.specimen} · ${panel!.components.length} tests` : single!.specimen || ''}
                    </div>
                  </div>
                  {inBasket && <span style={{ fontSize: 10, color: T.primary }}>Added</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Auto-status ───────────────────────────────────────────────────────────────
function autoStatus(value: string, dataType: string, referenceRange: string | null, options?: string[]): string {
  if (dataType === 'enum' && options) {
    const v = value.toLowerCase();
    if (v.includes('positive') || v.includes('reactive') || v.includes('abnormal')) return 'Abnormal';
    if (v.includes('negative') || v.includes('non-reactive') || v.includes('normal')) return 'Normal';
    return 'Normal';
  }
  if ((dataType === 'float' || dataType === 'integer') && referenceRange) {
    const m = referenceRange.match(/([\d.]+)\s*[-–]\s*([\d.]+)/);
    if (m) {
      const lo = parseFloat(m[1]), hi = parseFloat(m[2]), n = parseFloat(value);
      if (!isNaN(n)) { if (n < lo) return 'Low'; if (n > hi) return 'High'; return 'Normal'; }
    }
  }
  return 'Normal';
}

// ── Inline Results Entry Form ─────────────────────────────────────────────────
interface ResultRow {
  componentId: string | number;
  componentName: string;
  abbr?: string;
  value: string;
  units: string | null;
  dataType: string;
  referenceRange: string | null;
  options?: string[];
  status: string;
}

function InlineResultsForm({ item, isAmend, colSpan, onClose, onSaved }: {
  item: any;
  isAmend: boolean;
  colSpan: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existingResult = item.results?.[0];

  function buildInitialRows(): ResultRow[] {
    // ── Panel path ─────────────────────────────────────────────────────────
    if (item.type === 'panel') {
      let components: any[] = [];

      // Tier 1: stored componentsJson on the order item
      if (item.componentsJson) {
        try { components = JSON.parse(item.componentsJson); } catch { components = []; }
      }

      // Tier 2: catalogue lookup by stored catalogueId (e.g. "panel_4")
      if (components.length === 0) {
        const cat = getPanelById(item.catalogueId);
        if (cat) components = cat.components;
      }

      // Tier 3: catalogue lookup by panel name (fallback when catalogueId format differs)
      if (components.length === 0) {
        const cat = getPanelByName(item.name);
        if (cat) components = cat.components;
      }

      if (components.length > 0) {
        return components.map((c: any) => ({
          componentId: c.id,
          componentName: c.name,
          abbr: c.abbr ?? '',
          value: '',
          units: c.units ?? null,
          dataType: c.dataType ?? 'free_text',
          referenceRange: c.referenceRange ?? null,
          options: Array.isArray(c.options) ? c.options : undefined,
          status: 'Normal',
        }));
      }
    }

    // ── Single path (or panel with no components found) ────────────────────
    const cat = getSingleById(parseInt(item.catalogueId));
    return [{
      componentId: item.catalogueId,
      componentName: item.name,
      abbr: cat?.abbr ?? '',
      value: '',
      units: cat?.units ?? null,
      dataType: cat?.dataType ?? 'free_text',
      referenceRange: cat?.referenceRange ?? null,
      options: Array.isArray(cat?.options) ? cat!.options : undefined,
      status: 'Normal',
    }];
  }

  const [rows, setRows] = useState<ResultRow[]>(() => {
    const initial = buildInitialRows();
    if (isAmend && existingResult) {
      try {
        const prev: any[] = JSON.parse(existingResult.resultsJson);
        return initial.map(r => {
          const match = prev.find((p: any) =>
            String(p.componentId) === String(r.componentId) || p.componentName === r.componentName
          );
          return match ? { ...r, value: match.value ?? '', status: match.status ?? r.status } : r;
        });
      } catch { return initial; }
    }
    return initial;
  });

  const [saving, setSaving] = useState(false);

  function updateRow(idx: number, field: keyof ResultRow, val: string) {
    setRows(prev => prev.map((r, i) => {
      if (i !== idx) return r;
      const updated = { ...r, [field]: val };
      if (field === 'value') updated.status = autoStatus(val, r.dataType, r.referenceRange, r.options);
      return updated;
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const payload = rows.map(r => ({
        componentId: r.componentId,
        componentName: r.componentName,
        abbr: r.abbr,
        value: r.value,
        units: r.units,
        dataType: r.dataType,
        referenceRange: r.referenceRange,
        status: r.status,
      }));
      if (isAmend && existingResult) {
        await api.patch(`/investigations/results/${existingResult.id}`, { results: payload });
        toast.success('Result amended');
      } else {
        await api.post('/investigations/results', { itemId: item.id, results: payload });
        toast.success('Results saved');
      }
      onSaved();
    } catch {
      toast.error('Failed to save results');
    } finally {
      setSaving(false);
    }
  }

  const isPanel = item.type === 'panel' && rows.length > 1;

  return (
    <td colSpan={colSpan} style={{ padding: '0 0 0 28px', background: 'var(--bg-surface)' }}>
      <div style={{ borderLeft: `3px solid ${T.primary}`, paddingLeft: 16, paddingTop: 14, paddingBottom: 14 }}>
        {/* Form header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 500, color: T.title }}>{item.name}</span>
            {item.specimen && <span style={{ fontSize: 12, color: T.muted, marginLeft: 8 }}>— {item.specimen}</span>}
            {isPanel && <span style={{ fontSize: 11, color: T.muted, marginLeft: 8 }}>{rows.length} components</span>}
            {isAmend && <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--badge-amber-text)', marginLeft: 10 }}>Amending</span>}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, padding: 4 }}>
            <X size={14} />
          </button>
        </div>

        {/* Component rows */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '5px 8px 5px 0', color: T.muted, fontWeight: 500, fontSize: 10, textTransform: 'uppercase', width: '28%' }}>
                  {isPanel ? 'Component' : 'Test'}
                </th>
                {isPanel && (
                  <th style={{ textAlign: 'left', padding: '5px 8px', color: T.muted, fontWeight: 500, fontSize: 10, textTransform: 'uppercase', width: '10%' }}>Abbr</th>
                )}
                <th style={{ textAlign: 'left', padding: '5px 8px', color: T.muted, fontWeight: 500, fontSize: 10, textTransform: 'uppercase', width: '30%' }}>Result</th>
                <th style={{ textAlign: 'left', padding: '5px 8px', color: T.muted, fontWeight: 500, fontSize: 10, textTransform: 'uppercase', width: '12%' }}>Units</th>
                <th style={{ textAlign: 'left', padding: '5px 0', color: T.muted, fontWeight: 500, fontSize: 10, textTransform: 'uppercase', width: '20%' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <td style={{ padding: '7px 8px 7px 0', verticalAlign: 'top' }}>
                    <div style={{ color: T.title, fontWeight: 500 }}>{row.componentName}</div>
                    {row.referenceRange && (
                      <div style={{ fontSize: 10, color: T.muted, marginTop: 1 }}>Ref: {row.referenceRange}</div>
                    )}
                  </td>
                  {isPanel && (
                    <td style={{ padding: '7px 8px', verticalAlign: 'middle', color: T.muted }}>{row.abbr ?? '—'}</td>
                  )}
                  <td style={{ padding: '7px 8px', verticalAlign: 'middle' }}>
                    {row.dataType === 'enum' && row.options ? (
                      <select
                        value={row.value}
                        onChange={e => updateRow(idx, 'value', e.target.value)}
                        style={{ width: '100%', padding: '4px 7px', border: '1px solid var(--border)', borderRadius: 14, fontSize: 12, fontFamily: T.font, background: 'var(--bg-input)', color: 'var(--text-heading)' }}
                      >
                        <option value="">Select…</option>
                        {row.options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input
                        type={row.dataType === 'float' || row.dataType === 'integer' ? 'number' : 'text'}
                        value={row.value}
                        onChange={e => updateRow(idx, 'value', e.target.value)}
                        style={{ width: '100%', padding: '4px 7px', border: '1px solid var(--border)', borderRadius: 14, fontSize: 12, fontFamily: T.font, boxSizing: 'border-box', background: 'var(--bg-input)', color: 'var(--text-heading)' }}
                      />
                    )}
                  </td>
                  <td style={{ padding: '7px 8px', verticalAlign: 'middle', color: T.muted, fontSize: 11, whiteSpace: 'nowrap' }}>
                    {row.units ?? '—'}
                  </td>
                  <td style={{ padding: '7px 0', verticalAlign: 'middle' }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: resultColor(row.status), marginBottom: 3 }}>{row.status}</div>
                    <select
                      value={row.status}
                      onChange={e => updateRow(idx, 'status', e.target.value)}
                      style={{ padding: '2px 5px', border: '1px solid var(--border)', borderRadius: 14, fontSize: 11, fontFamily: T.font, background: 'var(--bg-input)', color: 'var(--text-heading)' }}
                    >
                      {['Normal', 'High', 'Low', 'Abnormal', 'Positive', 'Negative', 'Indeterminate', 'Critical'].map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer buttons */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ padding: '6px 14px', border: T.cardBorder, borderRadius: 999, background: 'var(--bg-card)', color: T.body, fontSize: 12, cursor: 'pointer', fontFamily: T.font }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            style={{
              padding: '6px 16px', border: 'none', borderRadius: 999,
              background: isAmend ? 'var(--clinical-caution)' : T.primary,
              color: '#fff', fontSize: 12, fontWeight: 500,
              cursor: saving ? 'not-allowed' : 'pointer', fontFamily: T.font,
            }}
          >
            {saving ? 'Saving…' : (isAmend ? 'Submit Amendment' : (isPanel ? 'Finalise All Results' : 'Finalise Result'))}
          </button>
        </div>
      </div>
    </td>
  );
}

// ── Results view (expanded read-only) ─────────────────────────────────────────
function InlineResultsView({ item, colSpan }: { item: any; colSpan: number }) {
  const latestResult = item.results?.[0];
  let resultRows: any[] = [];
  if (latestResult) {
    try { resultRows = JSON.parse(latestResult.resultsJson); } catch {}
  }

  return (
    <td colSpan={colSpan} style={{ padding: '0 14px 14px 42px', background: 'var(--bg-surface)' }}>
      {resultRows.length === 0 ? (
        <div style={{ padding: '10px 0', color: T.muted, fontSize: 13, fontStyle: 'italic' }}>
          Awaiting results
        </div>
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 4 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Component', 'Abbreviation', 'Result', 'Units', 'Status'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '5px 10px', fontSize: 10, fontWeight: 500, color: T.muted, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resultRows.map((r: any, i: number) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <td style={{ padding: '6px 10px', color: T.title, fontWeight: 500 }}>{r.componentName}</td>
                  <td style={{ padding: '6px 10px', color: T.muted }}>{r.abbr ?? '—'}</td>
                  <td style={{ padding: '6px 10px', fontWeight: 500, color: resultColor(r.status) }}>{r.value || '—'}</td>
                  <td style={{ padding: '6px 10px', color: T.muted }}>{r.units ?? '—'}</td>
                  <td style={{ padding: '6px 10px' }}>
                    <span style={{ fontSize: 11, fontWeight: 500, color: resultColor(r.status) }}>{r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {latestResult && (
            <div style={{ fontSize: 10, color: T.muted, marginTop: 6 }}>
              {latestResult.amendedAt
                ? `Amended on ${new Date(latestResult.amendedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                : `Resulted on ${new Date(latestResult.resultedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
              }
            </div>
          )}
        </>
      )}
    </td>
  );
}

// ── Shared action buttons cell ─────────────────────────────────────────────────
function ActionCell({ item, onConfirm, onEnter, onAmend }: {
  item: any;
  onConfirm: (e: React.MouseEvent) => void;
  onEnter: (e: React.MouseEvent) => void;
  onAmend: (e: React.MouseEvent) => void;
}) {
  return (
    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
      {item.status === 'Pending' && (
        <button onClick={onConfirm} style={{
          padding: '4px 11px', border: '1px solid var(--border)', borderRadius: 999,
          background: 'var(--bg-card)', color: 'var(--text-body2)', fontSize: 12, cursor: 'pointer', fontFamily: T.font,
        }}>
          Confirm Sample
        </button>
      )}
      {item.status === 'In Progress' && (
        <button onClick={onEnter} style={{
          padding: '4px 11px', border: 'none', borderRadius: 999,
          background: T.primary, color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: T.font,
        }}>
          Enter Results
        </button>
      )}
      {(item.status === 'Resulted' || item.status === 'Amended') && (
        <button onClick={onAmend} style={{
          padding: '4px 11px', border: '1px solid var(--badge-amber-text)', borderRadius: 999,
          background: 'var(--bg-card)', color: 'var(--badge-amber-text)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: T.font,
        }}>
          Amend
        </button>
      )}
    </td>
  );
}

function calcAge(dob: string): number {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate())) age--;
  return age;
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function InvestigationsPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const { user } = useAuth();
  const { activeEncounterId, activePatient, setActivePatient } = usePatient();

  const role = user?.role ?? '';
  const isDoctor = hasRole(role, 'doctor', 'clinician', 'admin');
  const isLabTech = !isDoctor && hasRole(role, 'lab_tech', 'lab_technician');
  const canAct = hasRole(role, 'lab_tech', 'lab_technician', 'admin');

  const [orders, setOrders] = useState<any[]>([]);
  const [worklist, setWorklist] = useState<any[]>([]);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [basket, setBasket] = useState<BasketItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Shared expansion state
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [entryMode, setEntryMode] = useState<{ itemId: string; isAmend: boolean } | null>(null);

  // Load patient into context if navigated directly (e.g. tab switch without Consultation first)
  useEffect(() => {
    if (!patientId) return;
    if (activePatient?.id !== patientId) {
      api.get(`/patients/${patientId}`).then(r => setActivePatient(r.data)).catch(() => {});
    }
  }, [patientId]);

  // Load encounters for sidebar
  useEffect(() => {
    const pid = activePatient?.id ?? patientId;
    if (!pid) return;
    api.get(`/patients/${pid}/encounters`).then(r => setEncounters(r.data)).catch(() => {});
  }, [activePatient?.id, patientId]);

  useEffect(() => {
    if (isDoctor && patientId) {
      api.get(`/investigations/orders?patientId=${patientId}`)
        .then(r => { setOrders(r.data); setLoading(false); })
        .catch(() => setLoading(false));
    } else if (isLabTech) {
      api.get('/investigations/orders?worklist=true')
        .then(r => { setWorklist(r.data); setLoading(false); })
        .catch(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [patientId, isDoctor, isLabTech]);

  function refreshOrders() {
    if (patientId) {
      api.get(`/investigations/orders?patientId=${patientId}`).then(r => setOrders(r.data)).catch(() => {});
    }
  }
  function refreshWorklist() {
    api.get('/investigations/orders?worklist=true').then(r => setWorklist(r.data)).catch(() => {});
  }

  // ── Row interaction handlers ──────────────────────────────────────────────
  function handleRowClick(itemId: string) {
    if (entryMode?.itemId === itemId) return;
    if (expandedItemId === itemId) {
      setExpandedItemId(null);
      setEntryMode(null);
    } else {
      setExpandedItemId(itemId);
      setEntryMode(null);
    }
  }

  async function handleConfirmSample(itemId: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.patch(`/investigations/items/${itemId}`, {
        status: 'In Progress',
        sampleReceivedAt: new Date().toISOString(),
      });
      toast.success('Sample confirmed');
      // Optimistic update
      setOrders(prev => prev.map(o => ({
        ...o, items: (o.items ?? []).map((i: any) => i.id === itemId ? { ...i, status: 'In Progress' } : i),
      })));
      setWorklist(prev => prev.map(i => i.id === itemId ? { ...i, status: 'In Progress' } : i));
    } catch {
      toast.error('Failed to confirm sample');
    }
  }

  function handleEnterResults(itemId: string, isAmend: boolean, e: React.MouseEvent) {
    e.stopPropagation();
    setExpandedItemId(itemId);
    setEntryMode({ itemId, isAmend });
  }

  function handleEntrySaved() {
    setEntryMode(null);
    if (isDoctor) refreshOrders();
    if (isLabTech) refreshWorklist();
  }

  function handleEntryClose() {
    setEntryMode(null);
  }

  async function submitNewOrder() {
    if (basket.length === 0 || !patientId) return;
    const items = basket.map(b => {
      if (b.kind === 'panel') {
        const p = b.item as CataloguePanel;
        return { type: 'panel', catalogueId: p.id, name: p.panelName, specimen: p.specimen, componentsJson: p.components };
      } else {
        const s = b.item as CatalogueSingle;
        return { type: 'single', catalogueId: String(s.id), name: s.name, specimen: s.specimen, componentsJson: null };
      }
    });
    // Use active encounter, fall back to any open encounter for this patient, or null
    const encId = activeEncounterId
      ?? encounters.find((e: Encounter) => e.status === 'OPEN')?.id
      ?? null;
    setSubmitting(true);
    try {
      await api.post('/investigations/orders', { patientId, encounterId: encId, items });
      toast.success('Order placed');
      setBasket([]); setShowNewOrder(false);
      refreshOrders();
    } catch {
      toast.error('Failed to place order');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Column definitions ────────────────────────────────────────────────────
  const docHeaders = ['', 'Test Name', 'Type', 'Specimen', 'Ordered By', 'Date Ordered', 'Status', ...(canAct ? ['Actions'] : [])];
  const labHeaders = ['Patient', 'Test Name', 'Specimen', 'Ordered By', 'Time Ordered', 'Status', 'Actions'];
  const docColSpan = docHeaders.length;
  const labColSpan = labHeaders.length;

  // ── Doctor / Admin View ───────────────────────────────────────────────────
  if (isDoctor) {
    const allItems: any[] = orders.flatMap(o => (o.items ?? []).map((i: any) => ({ ...i, order: o })));

    return (
      <div className="clinical-module clinical-workspace" data-has-summary={!!activePatient} style={{ fontFamily: T.font }}>

        {/* ── Compact clinical summary ── */}
        {activePatient && (
          <aside className="clinical-workspace-summary" aria-label="Clinical summary">
            <ConsultationSidebar
              patientId={activePatient.id}
              patient={activePatient}
              encounters={encounters}
              visible
              currentNodes={[]}
            />
          </aside>
        )}

        {/* ── Main content ── */}
        <div style={{ flex: 1, minWidth: 0, background: T.pageBg }}>

        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: activePatient ? 4 : 0 }}>
            <h1 style={{ fontSize: 22, fontWeight: 500, color: T.title, margin: 0 }}>Investigations</h1>
            <button
              onClick={() => { setShowNewOrder(v => !v); setBasket([]); }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: T.primary, color: '#fff', border: 'none', borderRadius: 999, padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: T.font }}
            >
              <Plus size={14} /> New Order
            </button>
          </div>
          {activePatient && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-heading)' }}>
                {activePatient.firstName} {activePatient.lastName}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                {calcAge(activePatient.dateOfBirth)} yrs · {activePatient.gender}
                {activePatient.nationalId ? ` · ${activePatient.nationalId}` : ''}
              </span>
            </div>
          )}
        </div>

        {showNewOrder && (
          <div style={{ background: T.cardBg, border: T.cardBorder, borderRadius: 10, padding: 20, marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h3 style={{ fontSize: 14, fontWeight: 500, color: T.title, margin: 0 }}>New Investigation Order</h3>
              <button onClick={() => setShowNewOrder(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted }}>
                <X size={16} />
              </button>
            </div>
            <OrderBasket basket={basket} setBasket={setBasket} />
            {basket.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button onClick={() => setBasket([])} style={{ padding: '7px 16px', border: T.cardBorder, borderRadius: 999, background: 'var(--bg-card)', color: T.body, fontSize: 13, cursor: 'pointer', fontFamily: T.font }}>Clear</button>
                <button
                  onClick={submitNewOrder}
                  disabled={submitting}
                  style={{ padding: '7px 18px', border: 'none', borderRadius: 999, background: submitting ? 'var(--border-input)' : T.primary, color: '#fff', fontSize: 13, fontWeight: 500, cursor: submitting ? 'not-allowed' : 'pointer', fontFamily: T.font }}
                >
                  {submitting ? 'Submitting…' : `Submit Order (${basket.length} item${basket.length !== 1 ? 's' : ''})`}
                </button>
              </div>
            )}
          </div>
        )}

        <div style={{ display: !loading && allItems.length === 0 ? 'none' : undefined, background: T.cardBg, border: T.cardBorder, borderRadius: 14, overflowX: 'auto' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: T.muted }}>Loading…</div>
          ) : allItems.length === 0 ? null : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-surface)', borderBottom: T.cardBorder }}>
                  {docHeaders.map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 500, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allItems.map(item => {
                  const isExpanded = expandedItemId === item.id;
                  const inEntry = entryMode?.itemId === item.id;

                  return (
                    <Fragment key={item.id}>
                      <tr
                        onClick={() => handleRowClick(item.id)}
                        style={{ borderBottom: '1px solid var(--border-light)', cursor: 'pointer', background: isExpanded ? 'var(--bg-surface)' : 'transparent' }}
                        onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'var(--bg-surface)'; }}
                        onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <td style={{ padding: '10px 6px 10px 14px', width: 24 }}>
                          {isExpanded ? <ChevronDown size={13} color={T.muted} /> : <ChevronRight size={13} color={T.muted} />}
                        </td>
                        <td style={{ padding: '10px 14px', fontWeight: 500, color: T.title }}>{item.name}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ fontSize: 10, fontWeight: 500, padding: '2px 7px', borderRadius: 10, background: item.type === 'panel' ? 'var(--badge-blue-bg)' : 'var(--badge-green-bg)', color: item.type === 'panel' ? 'var(--badge-blue-text)' : 'var(--badge-green-text)' }}>
                            {item.type === 'panel' ? 'Panel' : 'Single'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', color: T.body }}>{item.specimen ?? '—'}</td>
                        <td style={{ padding: '10px 14px', color: T.body }}>{item.order?.orderedBy?.name ?? '—'}</td>
                        <td style={{ padding: '10px 14px', color: T.body }}>
                          {new Date(item.order?.orderedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                        <td style={{ padding: '10px 14px' }}>{statusBadge(item.status)}</td>
                        {canAct && (
                          <ActionCell
                            item={item}
                            onConfirm={e => handleConfirmSample(item.id, e)}
                            onEnter={e => handleEnterResults(item.id, false, e)}
                            onAmend={e => handleEnterResults(item.id, true, e)}
                          />
                        )}
                      </tr>
                      {isExpanded && (
                        <tr style={{ background: 'var(--bg-surface)' }}>
                          {inEntry ? (
                            <InlineResultsForm
                              item={item}
                              isAmend={entryMode!.isAmend}
                              colSpan={docColSpan}
                              onClose={handleEntryClose}
                              onSaved={handleEntrySaved}
                            />
                          ) : (
                            <InlineResultsView item={item} colSpan={docColSpan} />
                          )}
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        </div>
      </div>
    );
  }

  // ── Lab Technician View ───────────────────────────────────────────────────
  if (isLabTech) {
    return (
      <div className="clinical-module" style={{ background: T.pageBg, minHeight: '100%', padding: 'clamp(14px, 3vw, 24px)', fontFamily: T.font }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 500, color: T.title, margin: 0 }}>Investigations Worklist</h1>
        </div>

        <div style={{ display: !loading && worklist.length === 0 ? 'none' : undefined, background: T.cardBg, border: T.cardBorder, borderRadius: 14, overflowX: 'auto' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: T.muted }}>Loading worklist…</div>
          ) : worklist.length === 0 ? null : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-surface)', borderBottom: T.cardBorder }}>
                  {labHeaders.map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 500, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {worklist.map(item => {
                  const patient = item.order?.patient;
                  const patName = patient ? `${patient.firstName} ${patient.lastName}` : '—';
                  const isExpanded = expandedItemId === item.id;
                  const inEntry = entryMode?.itemId === item.id;

                  return (
                    <Fragment key={item.id}>
                      <tr
                        onClick={() => handleRowClick(item.id)}
                        style={{ borderBottom: '1px solid var(--border-light)', cursor: 'pointer', background: isExpanded ? 'var(--bg-surface)' : 'transparent' }}
                        onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'var(--bg-surface)'; }}
                        onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ fontWeight: 500, color: T.title }}>{patName}</div>
                          <div style={{ fontSize: 10, color: T.muted }}>{patient?.id?.slice(0, 8) ?? ''}</div>
                        </td>
                        <td style={{ padding: '10px 14px', color: T.title, fontWeight: 500 }}>{item.name}</td>
                        <td style={{ padding: '10px 14px', color: T.body }}>{item.specimen ?? '—'}</td>
                        <td style={{ padding: '10px 14px', color: T.body }}>{item.order?.orderedBy?.name ?? '—'}</td>
                        <td style={{ padding: '10px 14px', color: T.body }}>
                          {new Date(item.order?.orderedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ padding: '10px 14px' }}>{statusBadge(item.status)}</td>
                        <ActionCell
                          item={item}
                          onConfirm={e => handleConfirmSample(item.id, e)}
                          onEnter={e => handleEnterResults(item.id, false, e)}
                          onAmend={e => handleEnterResults(item.id, true, e)}
                        />
                      </tr>
                      {isExpanded && (
                        <tr style={{ background: 'var(--bg-surface)' }}>
                          {inEntry ? (
                            <InlineResultsForm
                              item={item}
                              isAmend={entryMode!.isAmend}
                              colSpan={labColSpan}
                              onClose={handleEntryClose}
                              onSaved={handleEntrySaved}
                            />
                          ) : (
                            <InlineResultsView item={item} colSpan={labColSpan} />
                          )}
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  return <Navigate to={moduleLanding(role)} replace />;
}
