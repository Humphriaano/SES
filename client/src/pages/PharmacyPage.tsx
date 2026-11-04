import { pricingUnit, PriceBasis } from '../lib/prescriptionSupply';
import { PrescriptionDraft } from '../components/consultation/blocks/PrescriptionForm';
import DispensingForm, { DispensingRecovery } from '../components/pharmacy/DispensingForm';
import { sendDispensing, StockSelection } from '../lib/stockDispensing';
import { readStockReview, reviewStock, retryStockReview, stockReviewMessage, STOCK_REVIEW_EVENT, pharmacyStockKey, StockAvailabilityResult } from '../lib/stockAvailability';
import { stockQuantity } from '../lib/stockViews';
import StockReceiving from '../components/pharmacy/StockReceiving';
import StockViews from '../components/pharmacy/StockViews';
import StockAdjustments from '../components/pharmacy/StockAdjustments';
import { formatCourseDate } from '../lib/prescriptionCourse';
import { useEffect, useState, useRef, useCallback, Fragment } from 'react';
import { Navigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Package, Edit2, RefreshCw, Printer, User, Search, CheckCircle, AlertTriangle, X } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../lib/money';
import { canAccessModule, moduleLanding } from '../lib/moduleAccess';
import { staffDisplayName, staffPosition } from '../lib/staffNames';
import { usePatient } from '../context/PatientContext';
import { Encounter } from '../types';
import ConsultationSidebar from '../components/consultation/ConsultationSidebar';
import '../components/consultation/ClinicalWorkspace.css';
import { searchCatalog, DrugEntry } from '../data/drugCatalog';
import { CataloguePrice } from '../components/billing/InlinePrice';

import { flushPriceEdits } from '../lib/priceEditing';
import toast from 'react-hot-toast';

// ── Design tokens (CSS var-based for dark mode support) ───────────────────────
const C = {
  pageBg:       'var(--bg-page)',
  cardBg: 'var(--premium-panel-bg)',
  cardBorder:   '1px solid var(--border)',
  cardRadius:   22,
  divider:      '1px solid var(--border-light)',
  red:          'var(--ses-red)',
  redHover:     'var(--ses-red-dark)',
  title:        'var(--text-heading)',
  body:         'var(--text-body2)',
  muted:        'var(--text-muted)',
  faint:        'var(--text-subtle)',
  inputBorder:  '1.5px solid var(--border-input)',
  inputBg:      'var(--bg-input)',
  font:         'var(--font-body)',
};

const cardStyle: React.CSSProperties = {
  background: C.cardBg, borderRadius: C.cardRadius, border: C.cardBorder,
  overflow: 'hidden',
};

const cardHeaderStyle: React.CSSProperties = {
  padding: '14px 18px 10px',
  borderBottom: C.divider,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 500, color: C.title,
};

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '9px 12px', minHeight: 40, borderRadius: 12, fontSize: 13.5,
  border: C.inputBorder, background: C.inputBg,
  color: C.title, outline: 'none',
};

function primaryBtn(disabled = false): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '9px 18px', minHeight: 40, borderRadius: 999, border: 'none',
    background: disabled ? 'var(--border-input)' : C.red,
    color: disabled ? C.faint : '#fff',
    fontSize: 13, fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

function ghostBtn(): React.CSSProperties {
  return {
    padding: '8px 16px', minHeight: 40, borderRadius: 999,
    border: '1px solid var(--border-input)', background: 'var(--bg-card)',
    color: C.body, fontSize: 13, cursor: 'pointer',
  };
}

function smallBtn(): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '6px 12px', minHeight: 34, borderRadius: 999, border: '1px solid var(--btn2-line)',
    background: 'var(--btn2)', color: C.title, fontSize: 12,
    fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' as const,
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface RxPatient {
  id: string; firstName: string; lastName: string;
  nationalId?: string; dateOfBirth?: string; gender?: string;
}

interface RxMedication { name: string; dosage?: string; frequency?: string; route?: string; catalogueCode?: string; duration?: string; durationDays?: number; durationCount?: number; durationUnit?: string; unitsPerDose?: number | string; notes?: string; quantity?: number | string; quantityUnit?: string; startDate?: string; endDate?: string; unitPrice?: number | string; doseUnit?: string; priceBasis?: PriceBasis; bottleSizeMl?: number | string; courseQuantity?: number | string; billingQuantity?: number | string }
interface GlobalPrescription {
  id: string; encounterId: string;
  medication: RxMedication;
  substituteMedication?: RxMedication;
  preferredStockProduct?: { id: string; brand: string; manufacturer: string | null; baseUnit: string; active: boolean } | null;
  dispensed: boolean; dispensedAt?: string; notAvailable?: boolean;
  encounter: { patient: RxPatient; clinician: { id: string; name: string } };
  createdAt: string;
}

interface Dispensing {
  id: string; prescriptionId?: string; patientId: string;
  type: string; dispensedDrug: string;
  dispensedDose?: string; dispensedFrequency?: string; dispensedDuration?: string;
  quantity?: number | string; unitPrice?: number | string; quantityUnit?: string; priceBasis?: PriceBasis; billingQuantity?: number | string;
  dispensedBy: string; dispensedAt: string;
  substitution?: Record<string, unknown>; modifications?: Record<string, unknown>;
  stockAllocations?: { id: string; quantity: string; baseUnit: string; batch: { lotNumber: string; expiryDate: string; product: { brand: string; manufacturer: string | null } }; movement: { reason: string | null } }[];
  patient: { firstName: string; lastName: string; nationalId?: string };
}

interface StockInfo { quantity: number | string; unit: string; tracked?: boolean; unknown?: boolean }
type SimplePatient = { id: string; firstName: string; lastName: string; nationalId?: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function stockPill(qty: number) {
  const [bg, color] =
    qty <= 0  ? ['var(--clinical-abnormal-bg)', 'var(--clinical-abnormal)'] :
    qty < 10  ? ['var(--clinical-caution-bg)', 'var(--clinical-caution)'] :
                ['var(--clinical-normal-bg)', 'var(--clinical-normal)'];
  return (
    <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 10, background: bg, color }}>
      {qty} {qty <= 0 ? '— out of stock' : 'in stock'}
    </span>
  );
}

function typePill(type: string) {
  const map: Record<string, [string, string]> = {
    substitution: ['var(--badge-blue-bg)', 'var(--badge-blue-text)'],
    modified:     ['var(--badge-blue-bg)', 'var(--ws-link)'],
    direct:       ['var(--bg-surface)', 'var(--text-body2)'],
    prescription: ['var(--badge-green-bg)', 'var(--badge-green-text)'],
  };
  const [bg, color] = map[type] ?? ['var(--bg-surface)', 'var(--text-body2)'];
  return (
    <span style={{ fontSize: 10, fontWeight: 500, padding: '2px 7px', borderRadius: 10, background: bg, color }}>
      {type === 'prescription' ? 'Rx' : type.charAt(0).toUpperCase() + type.slice(1)}
    </span>
  );
}

function printLabel(drug: string, dose: string, freq: string, patient: string, nationalId: string) {
  const win = window.open('', '_blank', 'width=400,height=300');
  if (!win) return;
  win.document.write(`<html><head><title>Drug Label</title>
    <style>body{font-family:monospace;padding:20px;font-size:13px}hr{border:1px dashed #999}h2{margin:0 0 6px}</style>
    </head><body>
    <h2>${drug}</h2><hr/>
    <p><b>Dose:</b> ${dose || '—'}</p>
    <p><b>Frequency:</b> ${freq || '—'}</p>
    <p><b>Patient:</b> ${patient}</p>
    <p><b>ID:</b> ${nationalId || '—'}</p>
    <p><b>Date:</b> ${new Date().toLocaleDateString()}</p>
    <hr/><p style="font-size:10px;color:#666">SES Health — Keep out of reach of children</p>
    </body></html>`);
  win.document.close();
  win.print();
}

// ── Drug autocomplete (ZAMMSA catalog + existing records) ────────────────────

interface DrugAutocompleteProps {
  value: string;
  onChange: (name: string) => void;
  onSelect?: (entry: DrugEntry) => void;
  placeholder?: string;
}

function DrugAutocomplete({ value, onChange, onSelect, placeholder }: DrugAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<DrugEntry[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value.length < 2) { setSuggestions([]); setOpen(false); return; }

    // Catalog search is instant and client-side
    const catalogHits = searchCatalog(value, 10);

    // Also hit the backend for drugs already in patient records / inventory
    api.get(`/drugs?search=${encodeURIComponent(value)}`).then(r => {
      const backendNames: string[] = r.data.map((d: { name: string }) => d.name);
      const catalogNames = new Set(catalogHits.map(h => h.name.toLowerCase()));
      // Add backend results not already in catalog
      const extra: DrugEntry[] = backendNames
        .filter(n => !catalogNames.has(n.toLowerCase()))
        .map(n => ({ name: n, dose: '', form: '', route: '', sku: '' }));
      setSuggestions([...catalogHits, ...extra].slice(0, 12));
      setOpen(true);
    }).catch(() => {
      setSuggestions(catalogHits);
      if (catalogHits.length > 0) setOpen(true);
    });
  }, [value]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function pick(entry: DrugEntry) {
    onChange(entry.name);
    onSelect?.(entry);
    setOpen(false);
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        type="text" value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? 'Drug name…'}
        style={inputStyle}
      />
      {open && suggestions.length > 0 && (
        <ul style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: 'var(--bg-card)', border: C.cardBorder, borderRadius: 8,
          maxHeight: 220, overflowY: 'auto',
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', margin: 0, padding: 0, listStyle: 'none',
        }}>
          {suggestions.map((entry, i) => (
            <li key={`${entry.name}-${entry.sku}-${i}`} onMouseDown={() => pick(entry)}
              style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: i < suggestions.length - 1 ? C.divider : 'none' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--ws-chip)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <div style={{ fontSize: 13, fontWeight: 500, color: C.title }}>{entry.name}</div>
              {(entry.dose || entry.form) && (
                <div style={{ fontSize: 11, color: C.faint, marginTop: 1 }}>
                  {[entry.dose, entry.form, entry.route].filter(Boolean).join(' · ')}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Modal overlay ─────────────────────────────────────────────────────────────

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--modal-overlay)',
      zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: 'var(--bg-card)', borderRadius: 14, padding: 24,
        width: '100%', maxWidth: 500, maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 24px 64px rgba(0,0,0,0.2)',
      }}>
        {children}
      </div>
    </div>
  );
}

function ModalTitle({ children }: { children: React.ReactNode }) {
  return <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 500, color: C.title }}>{children}</h3>;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 5 }}>{children}</label>;
}

// ── Dispense Modal ────────────────────────────────────────────────────────────

function medicationBody(draft: PrescriptionDraft) {
  return { name: draft.drugName, dosage: draft.dose, frequency: draft.frequency, route: draft.route, duration: draft.duration, catalogueCode: draft.drugCode, startDate: draft.startDate, endDate: draft.endDate, unitsPerDose: draft.unitsPerDose, durationDays: draft.durationDays, durationCount: draft.durationCount, durationUnit: draft.durationUnit, quantity: draft.quantity, quantityUnit: draft.quantityUnit, quantityManual: draft.quantityManual, doseUnit: draft.doseUnit, priceBasis: draft.priceBasis, bottleSizeMl: draft.bottleSizeMl, courseQuantity: draft.courseQuantity, billingQuantity: draft.billingQuantity, unitPrice: draft.unitPrice, notes: draft.specialInstructions };
}
function courseDraft(m: RxMedication): Partial<PrescriptionDraft> {
  const legacy = m.duration?.match(/^(\d+)\s*(days?|weeks?|months?)$/i);
  const durationUnit = m.durationUnit ?? (legacy ? legacy[2].toLowerCase().replace(/s?$/, 's') : undefined);
  return { drugName: m.name, drugCode: m.catalogueCode, dose: m.dosage, frequency: m.frequency, route: m.route, duration: m.duration, durationDays: m.durationDays, durationCount: m.durationCount ?? (legacy ? Number(legacy[1]) : undefined), durationUnit, unitsPerDose: m.unitsPerDose != null ? Number(m.unitsPerDose) : undefined, quantity: m.quantity != null ? Number(m.quantity) : undefined, quantityUnit: m.quantityUnit, startDate: m.startDate, endDate: m.endDate, unitPrice: m.unitPrice != null ? Number(m.unitPrice) : undefined, specialInstructions: m.notes, doseUnit: m.doseUnit, priceBasis: m.priceBasis, bottleSizeMl: m.bottleSizeMl != null ? Number(m.bottleSizeMl) : undefined, courseQuantity: m.courseQuantity != null ? Number(m.courseQuantity) : undefined, billingQuantity: m.billingQuantity != null ? Number(m.billingQuantity) : undefined };
}

function DispenseModal({ rx, onClose, onDone, dispensedBy }: {
  rx: GlobalPrescription; onClose: () => void; onDone: (d: Dispensing) => void; dispensedBy: string;
}) {
  const pt = rx.encounter.patient;
  async function confirm(draft: PrescriptionDraft, stock: StockSelection, userId: string) {
    const { data } = await sendDispensing({ prescriptionId: rx.id, patientId: pt.id, type: 'prescription', dispensedDrug: draft.drugName, dispensedBy, medication: medicationBody(draft), stock }, userId);
    onDone(data);
  }
  return <ModalOverlay onClose={onClose}><ModalTitle>Confirm Dispense</ModalTitle>
    <p style={{ margin: '-10px 0 8px', fontSize: 12, color: C.muted }}>{pt.firstName} {pt.lastName}</p>
    <DispensingForm prescriberPreference={rx.preferredStockProduct} initial={courseDraft(rx.medication)} lockDrug patientId={pt.id} encounterId={rx.encounterId} onSave={confirm} onRecovered={onDone} onCancel={onClose} submitLabel="Dispense" />
  </ModalOverlay>;
}

// ── Substitute Modal ──────────────────────────────────────────────────────────

function SubstituteModal({ rx, onClose, onDone, dispensedBy }: {
  rx: GlobalPrescription; onClose: () => void; onDone: (d: Dispensing) => void; dispensedBy: string;
}) {
  const [subType, setSubType] = useState('generic_equivalent');
  const [reason, setReason] = useState('');
  const pt = rx.encounter.patient;
  async function substitute(draft: PrescriptionDraft, stock: StockSelection, userId: string) {
    const { data } = await sendDispensing({
      prescriptionId: rx.id, patientId: pt.id, type: 'substitution', dispensedDrug: draft.drugName, dispensedBy,
      medication: medicationBody(draft), stock,
      substitution: { substituteType: subType, reason },
    }, userId);
    onDone(data);
  }
  return <ModalOverlay onClose={onClose}>
    <ModalTitle>Substitute Drug</ModalTitle>
    <p style={{ margin: '-10px 0 8px', fontSize: 12, color: C.muted }}>Prescribed: <strong>{rx.medication.name} {rx.medication.dosage}</strong></p>
    <DispensingForm patientId={pt.id} encounterId={rx.encounterId} onSave={substitute} onRecovered={onDone} onCancel={onClose} submitLabel="Substitute & Dispense" requirePrice>
      <FieldLabel>Substitution type</FieldLabel>
      <select aria-label="Substitution type" value={subType} onChange={e => setSubType(e.target.value)} style={inputStyle}>
        <option value="generic_equivalent">Generic Equivalent</option><option value="therapeutic_alternative">Therapeutic Alternative</option><option value="out_of_stock">Out of Stock — nearest equivalent</option>
      </select>
      <div style={{ marginTop: 8 }}><FieldLabel>Reason (optional)</FieldLabel><textarea aria-label="Substitution reason" value={reason} onChange={e => setReason(e.target.value)} rows={2} style={inputStyle}/></div>
    </DispensingForm>
  </ModalOverlay>;
}

// ── Edit inline expand row ────────────────────────────────────────────────────

function EditExpandRow({ rx, colSpan, onClose, onDone, dispensedBy }: {
  rx: GlobalPrescription; colSpan: number; onClose: () => void; onDone: (d: Dispensing) => void; dispensedBy: string;
}) {
  async function submit(draft: PrescriptionDraft, stock: StockSelection, userId: string) {
    const { data } = await sendDispensing({ prescriptionId: rx.id, patientId: rx.encounter.patient.id, type: 'modified', dispensedDrug: draft.drugName, dispensedBy, medication: medicationBody(draft), stock }, userId);
    onDone(data);
  }
  return <tr><td colSpan={colSpan} style={{ padding: '10px 14px' }}><DispensingForm prescriberPreference={rx.preferredStockProduct} initial={courseDraft(rx.medication)} lockDrug patientId={rx.encounter.patient.id} encounterId={rx.encounterId} onSave={submit} onRecovered={onDone} onCancel={onClose} submitLabel="Dispense" /></td></tr>;
}

// ── Dispensing card ───────────────────────────────────────────────────────────

function DispensingCard({ record, canAct }: {
  record: Dispensing; canAct: boolean;
}) {
  return (
    <div style={{
      background: 'var(--bg-card)', borderRadius: 22, border: C.cardBorder,
      padding: '12px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: C.title }}>{record.dispensedDrug}</div>
          <div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>
            {record.patient.firstName} {record.patient.lastName}
            {record.patient.nationalId ? ` · ${record.patient.nationalId}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' as const, justifyContent: 'flex-end' }}>
          {typePill(record.type)}
        </div>
      </div>
      {Boolean(record.substitution?.originalDrug) && <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>Substituted: <s>{String(record.substitution!.originalDrug)}</s></div>}
      {record.stockAllocations?.map(line => <div key={line.id} style={{ fontSize: 11, color: C.muted, marginBottom: 5 }}>{line.batch.product.brand} · {line.batch.lotNumber} · {stockQuantity(line.quantity)} {line.baseUnit} · Exp {formatCourseDate(line.batch.expiryDate)}{line.movement.reason && <span> · {line.movement.reason}</span>}</div>)}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))', gap: 4, marginBottom: 6 }}>
        {[['Dosage', record.dispensedDose], ['Freq', record.dispensedFrequency], ['Duration', record.dispensedDuration], ['Qty', record.quantity != null ? String(record.quantity) + ' ' + (record.quantityUnit || 'items') : undefined], ['Price', record.unitPrice != null ? 'ZMW ' + Number(record.unitPrice).toFixed(2) + ' ' + pricingUnit(record.priceBasis ?? 'ITEM', record.quantityUnit || 'unit') : undefined]].map(([lbl, val]) => (
          <div key={lbl as string}>
            <span style={{ fontSize: 10, color: C.faint }}>{lbl as string}: </span>
            <span style={{ fontSize: 11, color: C.body, fontWeight: 500 }}>{val || '—'}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: C.faint }}>{new Date(record.dispensedAt).toLocaleString()}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {canAct && (
            <button type="button" onClick={() => printLabel(record.dispensedDrug, record.dispensedDose ?? '', record.dispensedFrequency ?? '', `${record.patient.firstName} ${record.patient.lastName}`, record.patient.nationalId ?? '')}
              style={smallBtn()}>
              <Printer size={11} /> Print label
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Section C: Patient History Search (inside Queue tab) ──────────────────────

function PatientHistorySearch({ canAct }: { canAct: boolean }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SimplePatient[]>([]);
  const [selected, setSelected] = useState<SimplePatient | null>(null);
  const [history, setHistory] = useState<Dispensing[]>([]);
  const [loading, setLoading] = useState(false);

  async function search() {
    if (!query.trim()) return;
    try {
      const { data } = await api.get(`/patients?search=${encodeURIComponent(query)}`);
      setResults((data as SimplePatient[]).slice(0, 10));
    } catch { toast.error('Search failed'); }
  }

  async function selectPatient(p: SimplePatient) {
    setSelected(p); setResults([]);
    setLoading(true);
    try {
      const { data } = await api.get(`/patients/${p.id}/dispensing`);
      setHistory(data);
    } catch { toast.error('Failed to load history'); }
    finally { setLoading(false); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          placeholder="Search patient by name or national ID…"
          style={{ ...inputStyle, flex: 1 }}
        />
        <button onClick={search} style={primaryBtn()}>
          <Search size={13} /> Search
        </button>
      </div>

      {results.length > 0 && (
        <ul style={{
          background: 'var(--bg-card)', border: C.cardBorder, borderRadius: 8,
          listStyle: 'none', margin: '0 0 12px', padding: 0, overflow: 'hidden',
        }}>
          {results.map(p => (
            <li key={p.id} onClick={() => selectPatient(p)}
              style={{ padding: '9px 14px', fontSize: 13, color: C.title, cursor: 'pointer', borderBottom: C.divider }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--ws-chip)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              {p.firstName} {p.lastName} {p.nationalId ? `· ${p.nationalId}` : ''}
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: C.title, display: 'flex', alignItems: 'center', gap: 6 }}>
              <User size={13} color={C.muted} />
              {selected.firstName} {selected.lastName}
            </span>
            <button onClick={() => { setSelected(null); setHistory([]); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.faint, display: 'flex' }}>
              <X size={14} />
            </button>
          </div>
          {loading
            ? <p style={{ textAlign: 'center', color: C.faint, fontSize: 13, padding: '16px 0' }}>Loading…</p>
            : history.length === 0
              ? null
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {history.map(r => <DispensingCard key={r.id} record={r} canAct={canAct} />)}
                </div>}
        </div>
      )}
    </div>
  );
}

// ── Queue Tab ─────────────────────────────────────────────────────────────────

function QueueTab({ dispensedBy, canAct }: { dispensedBy: string; canAct: boolean }) {
  const {user}=useAuth();
  const [reviewBusy,setReviewBusy]=useState(false),[reviewPending,setReviewPending]=useState(false),[reviewError,setReviewError]=useState(''),[reviewResults,setReviewResults]=useState<Record<string,StockAvailabilityResult>>({});
  const reviewInFlight=useRef(false);
  useEffect(()=>{function read(){try{setReviewPending(Boolean(readStockReview(user!.id)));setReviewError('')}catch(e){setReviewError((e as Error).message)}}read();window.addEventListener(STOCK_REVIEW_EVENT,read);window.addEventListener('storage',read);return()=>{window.removeEventListener(STOCK_REVIEW_EVENT,read);window.removeEventListener('storage',read)}},[user?.id]);
  const reviewLocked=reviewBusy||reviewPending||Boolean(reviewError);
  const [prescriptions, setPrescriptions] = useState<GlobalPrescription[]>([]);
  const [dispensedToday, setDispensedToday] = useState<Dispensing[]>([]);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [sectionBOpen, setSectionBOpen] = useState(false);
  const [stocks, setStocks] = useState<Record<string, StockInfo>>({});
  const [dispenseModal, setDispenseModal] = useState<GlobalPrescription | null>(null);
  const [substituteModal, setSubstituteModal] = useState<GlobalPrescription | null>(null);
  const [editRow, setEditRow] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const colSpan = canAct ? 7 : 6;


  const loadQueue = useCallback(async () => {
    setLoading(true);
    setReviewResults({});
    try {
      const params = filter === 'pending' ? '?status=pending' : '';
      const [rxRes, todayRes] = await Promise.all([
        api.get(`/prescriptions${params}`),
        api.get('/dispensing?date=today'),
      ]);
      setPrescriptions(rxRes.data);
      setDispensedToday(todayRes.data);
    } catch { toast.error('Failed to load queue'); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  useEffect(() => {
    let cancelled = false;
    setStocks({});
    const medicines = [...new Map(prescriptions.map(rx => [pharmacyStockKey(rx.medication), rx.medication])).values()];
    medicines.forEach(med => {
      const key = pharmacyStockKey(med);
      const request = canAct && med.catalogueCode
        ? api.get('/pharmacy-stock/dispense-plan', { params: { catalogueRef: med.catalogueCode, quantity: med.quantity || 1, baseUnit: med.quantityUnit || 'unit' } }).then(r => ({ quantity: r.data.available ?? 0, unit: r.data.baseUnit, tracked: r.data.tracked, unknown: r.data.tracked && (!med.quantityUnit || r.data.unitMatched === false) }))
        : api.get(`/inventory?drug=${encodeURIComponent(med.name)}`).then(r => r.data);
      request.then(data => { if (!cancelled) setStocks(prev => ({ ...prev, [key]: data })); }).catch(() => {});
    });
    return () => { cancelled = true; };
  }, [prescriptions, canAct]);

  async function checkStock(rx?:GlobalPrescription) {
    if(reviewInFlight.current||!user)return;
    reviewInFlight.current=true;setReviewBusy(true);
    try{const{data}=await(rx?reviewStock(user.id,rx.id):retryStockReview(user.id));await loadQueue();setReviewResults(previous=>({...previous,[data.id]:data}));toast.success(stockReviewMessage(data))}catch(e:any){toast.error(e?.response?.data?.error??e?.message??'Couldn’t check stock.')}finally{reviewInFlight.current=false;setReviewBusy(false)}
  }

  // Out of stock here: the client buys it elsewhere and is not charged for it
  async function setAvailability(rx: GlobalPrescription, notAvailable: boolean) {
    try {
      await api.patch(`/prescriptions/${rx.id}/availability`, { notAvailable });
      setPrescriptions(prev => prev.map(r => r.id === rx.id ? { ...r, notAvailable } : r));
      setReviewResults(previous=>{const next={...previous};delete next[rx.id];return next});
      toast.success(notAvailable ? 'Marked not available here. The charge was removed.' : 'Back in stock. The charge was restored.');
    } catch (e: any) { toast.error(e?.response?.data?.error ?? 'Couldn’t update that.'); }
  }

  function handleDispensed(d: Dispensing) {
    setDispenseModal(null); setSubstituteModal(null); setEditRow(null);
    if (d.prescriptionId) setPrescriptions(prev => prev.filter(rx => rx.id !== d.prescriptionId));
    setDispensedToday(prev => [d, ...prev]);
    toast.success('Dispensed successfully');
  }

  const thStyle: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 500,
    color: C.faint, textTransform: 'uppercase', letterSpacing: '0.4px',
    background: 'var(--bg-surface)', whiteSpace: 'nowrap',
  };

  const tdStyle: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Section A: Prescription queue ── */}
      {(reviewPending||reviewError)&&<div role="status" style={{...cardStyle,padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}><span style={{fontSize:12,color:C.body}}>{reviewError||'A stock review is awaiting confirmation.'}</span>{reviewPending&&<button style={smallBtn()} disabled={reviewBusy} onClick={()=>void checkStock()}>{reviewBusy?'Checking…':'Retry stock review'}</button>}</div>}
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={cardTitleStyle}>Prescription Queue</span>
            <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 10, background: 'var(--ws-chip)', color: C.red }}>
              {prescriptions.length}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <select value={filter} onChange={e => setFilter(e.target.value as 'pending' | 'all')}
              style={{ padding: '5px 10px', borderRadius: 6, border: C.inputBorder, background: C.inputBg, fontSize: 12, color: C.body, cursor: 'pointer' }}>
              <option value="pending">Pending</option>
              <option value="all">All</option>
            </select>
            <button onClick={loadQueue} title="Refresh"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.faint, display: 'flex', padding: 4 }}>
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {loading ? (
          <p style={{ textAlign: 'center', color: C.faint, fontSize: 13, padding: '40px 0' }}>Loading…</p>
        ) : prescriptions.length === 0 ? null : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Patient</th>
                  <th style={thStyle}>Drug</th>
                  <th style={thStyle}>Dose / Freq</th>
                  <th style={thStyle}>Stock</th>
                  <th style={thStyle}>Prescriber</th>
                  <th style={thStyle}>Time</th>
                  {canAct && <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {prescriptions.map(order => { const rx = { ...order, medication: order.substituteMedication ?? order.medication }; return (
                  <Fragment key={rx.id}>
                    <tr style={{ borderTop: C.divider, opacity: rx.dispensed ? 0.55 : 1 }}>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 500, color: C.title }}>
                          {rx.encounter.patient.firstName} {rx.encounter.patient.lastName}
                        </div>
                        <div style={{ fontSize: 11, color: C.faint }}>
                          {rx.encounter.patient.nationalId ?? '—'}
                        </div>
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 500, color: C.title }}>{rx.medication.name}{rx.preferredStockProduct && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{order.substituteMedication ? 'Original brand preference' : 'Preferred brand'}: {rx.preferredStockProduct.brand}</div>}{order.substituteMedication && <div style={{ fontSize: 11, color: C.muted }}>Substituted: <s>{order.medication.name}</s></div>}{rx.medication.catalogueCode && <div style={{ marginTop: 5, fontSize: 12, fontWeight: 400 }}><CataloguePrice catalogueRef={rx.medication.catalogueCode} itemType="DRUG" name={rx.medication.name} patientId={rx.encounter.patient.id} suffix={" " + pricingUnit(rx.medication.priceBasis ?? 'ITEM', rx.medication.doseUnit || rx.medication.quantityUnit || 'unit')} editable={canAct && !rx.dispensed} unpricedLabel="Add price" /></div>}{rx.notAvailable && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 500, color: 'var(--badge-amber-text)' }}>NOT AVAILABLE HERE</span>}</td>
                      <td style={tdStyle}>
                        <div style={{ color: C.body }}>{rx.medication.dosage ?? '—'}</div>
                        <div style={{ fontSize: 11, color: C.faint }}>{rx.medication.frequency ?? '—'}{rx.medication.duration ? ' · ' + rx.medication.duration : ''}</div>{rx.medication.quantity != null && <div style={{ fontSize: 11, color: C.body }}>Qty {String(rx.medication.quantity)} {rx.medication.quantityUnit || 'units'}</div>}{rx.medication.endDate && <div style={{ fontSize: 11, color: C.faint }}>Ends {formatCourseDate(rx.medication.endDate)}</div>}
                      </td>
                      <td style={tdStyle}>
                        {stocks[pharmacyStockKey(rx.medication)] != null
                          ? (() => { const stock = stocks[pharmacyStockKey(rx.medication)]; return stock.unknown ? <span style={{fontSize:11,color:C.muted}}>Unit unverified</span> : stock.tracked === undefined ? stockPill(Number(stock.quantity)) : <span style={{ fontSize: 11, color: stock.tracked && Number(stock.quantity) === 0 ? 'var(--badge-red-text)' : C.muted }}>{stock.tracked ? `${stockQuantity(String(stock.quantity))} ${stock.unit}` : 'Untracked'}</span>; })()
                          : <span style={{ color: C.faint, fontSize: 11 }}>—</span>}
                        {reviewResults[rx.id]?.state==='PARTIAL'&&<div style={{fontSize:11,color:C.muted,marginTop:4}}>Partial stock · review</div>}
                        {['UNKNOWN','REVIEW'].includes(reviewResults[rx.id]?.state)&&<div style={{fontSize:11,color:C.muted,marginTop:4}}>Supply details need review</div>}
                      </td>
                      <td style={{ ...tdStyle, color: C.body }}>{rx.encounter.clinician.name}</td>
                      <td style={{ ...tdStyle, color: C.faint, fontSize: 11 }}>
                        {new Date(rx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      {canAct && (
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          {rx.dispensed ? (
                            <span style={{ fontSize: 11, color: 'var(--badge-green-text)', display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                              <CheckCircle size={11} /> Done
                            </span>
                          ) : (
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <button disabled={reviewLocked} onClick={() => setDispenseModal(rx)} style={smallBtn()}>
                                <Package size={10} /> Dispense
                              </button>
                              <button disabled={reviewLocked} onClick={() => setEditRow(editRow === rx.id ? null : rx.id)}
                                style={smallBtn()}>
                                <Edit2 size={10} /> Edit
                              </button>
                              <button disabled={reviewLocked} onClick={() => setSubstituteModal(rx)} style={smallBtn()}>
                                <RefreshCw size={10} /> Sub
                              </button>
                              {rx.medication.catalogueCode&&<button disabled={reviewLocked} onClick={()=>void checkStock(rx)} style={smallBtn()} title="Verify usable stock for this prescription and update only its availability charge">Check stock</button>}
                              <button disabled={reviewLocked} onClick={() => setAvailability(rx, !rx.notAvailable)} style={smallBtn()}
                                title={rx.notAvailable ? 'Put the charge back' : 'Not in stock: the client buys it elsewhere and is not charged'}>
                                {rx.notAvailable ? 'In stock' : 'Not here'}
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                    {editRow === rx.id && canAct && (
                      <EditExpandRow
                        rx={rx} colSpan={colSpan}
                        onClose={() => setEditRow(null)}
                        onDone={handleDispensed}
                        dispensedBy={dispensedBy}
                      />
                    )}
                  </Fragment>
                ); })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Section B: Dispensed today (collapsible) ── */}
      <div style={cardStyle}>
        <button
          onClick={() => setSectionBOpen(v => !v)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 18px', background: 'none', border: 'none', cursor: 'pointer',
            borderBottom: sectionBOpen ? C.divider : 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={cardTitleStyle}>Dispensed Today</span>
            <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 10, background: 'var(--badge-green-bg)', color: 'var(--badge-green-text)' }}>
              {dispensedToday.length}
            </span>
          </div>
          {sectionBOpen
            ? <ChevronDown size={15} color={C.muted} />
            : <ChevronRight size={15} color={C.muted} />}
        </button>

        {sectionBOpen && (
          <div style={{ padding: '12px 18px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {dispensedToday.length === 0
              ? null
              : dispensedToday.map(r => <DispensingCard key={r.id} record={r} canAct={canAct} />)}
          </div>
        )}
      </div>

      {/* ── Section C: Patient drug history search ── */}
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <span style={cardTitleStyle}>Patient Drug History</span>
        </div>
        <div style={{ padding: '14px 18px' }}>
          <PatientHistorySearch canAct={canAct} />
        </div>
      </div>

      {dispenseModal && (
        <DispenseModal rx={dispenseModal} onClose={() => setDispenseModal(null)} onDone={handleDispensed} dispensedBy={dispensedBy} />
      )}
      {substituteModal && (
        <SubstituteModal rx={substituteModal} onClose={() => setSubstituteModal(null)} onDone={handleDispensed} dispensedBy={dispensedBy} />
      )}
    </div>
  );
}

// ── Patient Tab ───────────────────────────────────────────────────────────────

function PatientTab({ dispensedBy, canAct }: { dispensedBy: string; canAct: boolean }) {
  const [query, setQuery] = useState('');
  const [patients, setPatients] = useState<SimplePatient[]>([]);
  const [selected, setSelected] = useState<SimplePatient | null>(null);
  const [history, setHistory] = useState<Dispensing[]>([]);
  const [loading, setLoading] = useState(false);
  const [walkInKey, setWalkInKey] = useState(0);


  async function search() {
    if (!query.trim()) return;
    try {
      const { data } = await api.get(`/patients?search=${encodeURIComponent(query)}`);
      setPatients((data as SimplePatient[]).slice(0, 10));
    } catch { toast.error('Search failed'); }
  }

  async function selectPatient(p: SimplePatient) {
    setSelected(p); setPatients([]);
    setQuery(`${p.firstName} ${p.lastName}`);
    setLoading(true);
    try {
      const { data } = await api.get(`/patients/${p.id}/dispensing`);
      setHistory(data);
    } catch { toast.error('Failed to load history'); }
    finally { setLoading(false); }
  }

  async function directDispense(draft: PrescriptionDraft, stock: StockSelection, userId: string) {
    if (!selected) return;
    const { data } = await sendDispensing({ patientId: selected.id, type: 'direct', dispensedDrug: draft.drugName, dispensedBy, medication: medicationBody(draft), stock }, userId);
    setHistory(h => [data, ...h]); setWalkInKey(k => k + 1); toast.success('Dispensed');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Patient search */}
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <span style={cardTitleStyle}>Find Patient</span>
        </div>
        <div style={{ padding: '14px 18px' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input
              value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && search()}
              placeholder="Search by name or national ID…"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button onClick={search} style={primaryBtn()}>
              <Search size={13} /> Search
            </button>
          </div>

          {patients.length > 0 && (
            <ul style={{
              background: 'var(--bg-card)', border: C.cardBorder, borderRadius: 8,
              listStyle: 'none', margin: '0 0 10px', padding: 0, overflow: 'hidden',
            }}>
              {patients.map(p => (
                <li key={p.id} onClick={() => selectPatient(p)}
                  style={{ padding: '9px 14px', fontSize: 13, color: C.title, cursor: 'pointer', borderBottom: C.divider, display: 'flex', alignItems: 'center', gap: 8 }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--ws-chip)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <User size={13} color={C.faint} />
                  {p.firstName} {p.lastName} {p.nationalId ? `· ${p.nationalId}` : ''}
                </li>
              ))}
            </ul>
          )}

          {selected && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--ws-chip)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <User size={13} color={C.red} />
              <span style={{ fontSize: 13, fontWeight: 500, color: C.title }}>{selected.firstName} {selected.lastName}</span>
              {selected.nationalId && <span style={{ fontSize: 12, color: C.faint }}>· {selected.nationalId}</span>}
              <button onClick={() => { setSelected(null); setHistory([]); setQuery(''); }}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: C.faint, display: 'flex' }}>
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Walk-in direct dispense */}
      {selected && canAct && (
        <div style={cardStyle}>
          <div style={cardHeaderStyle}>
            <span style={cardTitleStyle}>Walk-in Direct Dispense</span>
          </div>
          <div style={{ padding: '10px 18px' }}><DispensingForm key={selected.id + ':' + walkInKey} patientId={selected.id} onSave={directDispense} onRecovered={data => { setHistory(h => [data, ...h]); setWalkInKey(k => k + 1); }} onCancel={() => setWalkInKey(k => k + 1)} submitLabel="Dispense" /></div>
        </div>
      )}

      {/* Dispensing history */}
      {selected && (
        <div style={cardStyle}>
          <div style={cardHeaderStyle}>
            <span style={cardTitleStyle}>Dispensing History</span>
            <span style={{ fontSize: 11, color: C.faint }}>{history.length} records</span>
          </div>
          <div style={{ padding: '12px 18px 16px' }}>
            {loading
              ? <p style={{ textAlign: 'center', color: C.faint, fontSize: 13, padding: '16px 0', margin: 0 }}>Loading…</p>
              : history.length === 0
                ? null
                : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {history.map(r => <DispensingCard key={r.id} record={r} canAct={canAct} />)}
                  </div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PharmacyPage() {
  const { user } = useAuth();
  const { activePatient } = usePatient();
  const [tab, setTab] = useState<'queue' | 'patient' | 'receiving' | 'stock' | 'adjustments'>('queue');
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [dispensingVersion,setDispensingVersion] = useState(0);

  useEffect(() => {
    if (!activePatient) { setEncounters([]); return; }
    api.get(`/patients/${activePatient.id}/encounters`)
      .then(r => setEncounters(r.data))
      .catch(() => {});
  }, [activePatient?.id]);

  if (!user) return (
    <div style={{ padding: '40px 24px', textAlign: 'center', color: C.faint, fontSize: 13, fontFamily: C.font }}>
      Not authenticated.
    </div>
  );

  const role = user.role;
  const canAct = hasRole(role, 'pharmacist', 'admin');
  const canView = canAccessModule(role, 'pharmacy');

  if (!canView) {
    return <Navigate to={moduleLanding(role)} replace />;
  }

  return (
    <div className="clinical-module clinical-workspace" data-has-summary={!!activePatient && (tab === 'queue' || tab === 'patient')} style={{ fontFamily: C.font }}>

      {/* ── Compact clinical summary (same component as Consultation) ── */}
        {activePatient && (tab === 'queue' || tab === 'patient') && (
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
      <div style={{ flex: 1, minWidth: 0, background: C.pageBg, display: 'flex', flexDirection: 'column' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 0 16px', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 500, color: C.title, letterSpacing: '-0.3px' }}>
              Pharmacy
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: C.muted }}>
              {staffDisplayName(user.name, user.designation)} · {staffPosition(user.designation, role)}
              {!canAct && (
                <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 500, color: 'var(--badge-amber-text)', background: 'var(--badge-amber-bg)', padding: '2px 8px', borderRadius: 10 }}>
                  View only
                </span>
              )}
            </p>
          </div>
        </div>

        {/* ── Tab bar ── */}
        <div style={{
          padding: 4, borderRadius: 999, border: '1px solid var(--border)',
          display: 'flex', width: 'fit-content', maxWidth: '100%', flexWrap: 'wrap', gap: 4,
          background: 'var(--bg-surface)',
        }}>
          {(['queue', 'patient', ...(canAct ? ['stock' as const, 'receiving' as const, 'adjustments' as const] : [])] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '8px 18px', borderRadius: 999, border: 'none',
              background: tab === t ? 'var(--bg-card)' : 'transparent',
              boxShadow: tab === t ? 'var(--premium-selected-shadow)' : 'none',
              color: tab === t ? 'var(--selection-text)' : C.faint,
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
              transition: 'color 0.15s',
            }}>
              {t === 'queue' ? 'Queue' : t === 'patient' ? 'Patient' : t === 'stock' ? 'Stock' : t === 'receiving' ? 'Receive stock' : 'Adjust stock'}
            </button>
          ))}
        </div>

        {/* ── Tab content ── */}
        <div style={{ padding: '16px 0 0', flex: 1, overflowY: 'auto' }}>
          {canAct && <DispensingRecovery onResolved={() => setDispensingVersion(value => value + 1)} />}
          {tab === 'queue' && <QueueTab key={dispensingVersion} dispensedBy={user.name} canAct={canAct} />}
          {tab === 'patient' && <PatientTab key={dispensingVersion} dispensedBy={user.name} canAct={canAct} />}
          {tab === 'receiving' && canAct && <StockReceiving key={user.id} />}
          {tab === 'stock' && canAct && <StockViews />}
          {tab === 'adjustments' && canAct && <StockAdjustments key={user.id} />}
        </div>

      </div>
    </div>
  );
}
