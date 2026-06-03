import { useEffect, useState, useRef, useCallback, Fragment } from 'react';
import { ChevronDown, ChevronRight, Package, Edit2, RefreshCw, Printer, User, Search, CheckCircle, AlertTriangle, X } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { usePatient } from '../context/PatientContext';
import { Encounter } from '../types';
import ConsultationSidebar from '../components/consultation/ConsultationSidebar';
import { searchCatalog, DrugEntry } from '../data/drugCatalog';
import toast from 'react-hot-toast';

// ── Design tokens (CSS var-based for dark mode support) ───────────────────────
const C = {
  pageBg:       'var(--bg-page)',
  cardBg:       'var(--bg-card)',
  cardBorder:   '1px solid var(--border)',
  cardRadius:   12,
  divider:      '1px solid var(--border-light)',
  red:          '#c0392b',
  redHover:     '#a93226',
  title:        'var(--text-heading)',
  body:         'var(--text-body2)',
  muted:        'var(--text-muted)',
  faint:        'var(--text-subtle)',
  inputBorder:  '1.5px solid var(--border-input)',
  inputBg:      'var(--bg-input)',
  font:         "'Segoe UI', system-ui, sans-serif",
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
  fontSize: 13, fontWeight: 700, color: C.title,
};

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '9px 12px', borderRadius: 7, fontSize: 13,
  border: C.inputBorder, background: C.inputBg,
  color: C.title, outline: 'none',
};

function primaryBtn(disabled = false): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '9px 18px', borderRadius: 8, border: 'none',
    background: disabled ? '#e2e8f0' : C.red,
    color: disabled ? C.faint : '#fff',
    fontSize: 13, fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

function ghostBtn(): React.CSSProperties {
  return {
    padding: '8px 16px', borderRadius: 7,
    border: '1px solid #e2e8f0', background: '#fff',
    color: C.body, fontSize: 13, cursor: 'pointer',
  };
}

function smallBtn(color: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '5px 10px', borderRadius: 6, border: 'none',
    background: color, color: '#fff', fontSize: 11,
    fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' as const,
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface RxPatient {
  id: string; firstName: string; lastName: string;
  nationalId?: string; dateOfBirth?: string; gender?: string;
}

interface GlobalPrescription {
  id: string; encounterId: string;
  medication: { name: string; dosage?: string; frequency?: string; route?: string };
  dispensed: boolean; dispensedAt?: string;
  encounter: { patient: RxPatient; clinician: { id: string; name: string } };
  createdAt: string;
}

interface Dispensing {
  id: string; prescriptionId?: string; patientId: string;
  type: string; dispensedDrug: string;
  dispensedDose?: string; dispensedFrequency?: string; dispensedDuration?: string;
  dispensedBy: string; dispensedAt: string;
  substitution?: Record<string, unknown>; modifications?: Record<string, unknown>;
  collectedAt?: string; collectedBy?: string;
  patient: { firstName: string; lastName: string; nationalId?: string };
}

interface StockInfo { quantity: number; unit: string }
type SimplePatient = { id: string; firstName: string; lastName: string; nationalId?: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function stockPill(qty: number) {
  const [bg, color] =
    qty <= 0  ? ['#fef2f2', '#b91c1c'] :
    qty < 10  ? ['#fffbeb', '#92400e'] :
                ['#f0fdf4', '#166534'];
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: bg, color }}>
      {qty} {qty <= 0 ? '— out of stock' : 'in stock'}
    </span>
  );
}

function typePill(type: string) {
  const map: Record<string, [string, string]> = {
    substitution: ['#f5f3ff', '#6d28d9'],
    modified:     ['#eff6ff', '#1d4ed8'],
    direct:       ['#f8fafc', '#475569'],
    prescription: ['#f0fdf4', '#166534'],
  };
  const [bg, color] = map[type] ?? ['#f8fafc', '#475569'];
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: bg, color }}>
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
          background: '#fff', border: C.cardBorder, borderRadius: 8,
          maxHeight: 220, overflowY: 'auto',
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', margin: 0, padding: 0, listStyle: 'none',
        }}>
          {suggestions.map((entry, i) => (
            <li key={`${entry.name}-${entry.sku}-${i}`} onMouseDown={() => pick(entry)}
              style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: i < suggestions.length - 1 ? C.divider : 'none' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#fef2f2')}
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
        width: 500, maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 24px 64px rgba(0,0,0,0.2)',
      }}>
        {children}
      </div>
    </div>
  );
}

function ModalTitle({ children }: { children: React.ReactNode }) {
  return <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700, color: C.title }}>{children}</h3>;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 5 }}>{children}</label>;
}

// ── Dispense Modal ────────────────────────────────────────────────────────────

function DispenseModal({ rx, onClose, onDone, dispensedBy }: {
  rx: GlobalPrescription; onClose: () => void; onDone: (d: Dispensing) => void; dispensedBy: string;
}) {
  const [loading, setLoading] = useState(false);
  const [stock, setStock] = useState<StockInfo | null>(null);
  const { medication: med, encounter: { patient: pt } } = rx;

  useEffect(() => {
    api.get(`/inventory?drug=${encodeURIComponent(med.name)}`).then(r => setStock(r.data)).catch(() => {});
  }, [med.name]);

  async function confirm() {
    setLoading(true);
    try {
      const { data } = await api.post('/dispensing', {
        prescriptionId: rx.id, patientId: pt.id, type: 'prescription',
        dispensedDrug: med.name, dispensedDose: med.dosage,
        dispensedFrequency: med.frequency, dispensedBy,
      });
      printLabel(med.name, med.dosage ?? '', med.frequency ?? '', `${pt.firstName} ${pt.lastName}`, pt.nationalId ?? '');
      onDone(data);
    } catch { toast.error('Dispense failed'); }
    finally { setLoading(false); }
  }

  const row = (label: string, value: string) => (
    <div style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: C.divider }}>
      <span style={{ fontSize: 12, color: C.faint, width: 90, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, color: C.title, fontWeight: 500 }}>{value || '—'}</span>
    </div>
  );

  return (
    <ModalOverlay onClose={onClose}>
      <ModalTitle>Confirm Dispense</ModalTitle>
      <div style={{ marginBottom: 20 }}>
        {row('Patient', `${pt.firstName} ${pt.lastName}${pt.nationalId ? ` · ${pt.nationalId}` : ''}`)}
        {row('Drug', med.name)}
        {row('Dose', med.dosage ?? '')}
        {row('Frequency', med.frequency ?? '')}
        {row('Route', med.route ?? '')}
        {stock && (
          <div style={{ display: 'flex', gap: 8, padding: '8px 0', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: C.faint, width: 90 }}>Stock</span>
            {stockPill(stock.quantity)}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={ghostBtn()}>Cancel</button>
        <button onClick={confirm} disabled={loading} style={primaryBtn(loading)}>
          <Printer size={13} /> {loading ? 'Dispensing…' : 'Dispense & Print'}
        </button>
      </div>
    </ModalOverlay>
  );
}

// ── Substitute Modal ──────────────────────────────────────────────────────────

function SubstituteModal({ rx, onClose, onDone, dispensedBy }: {
  rx: GlobalPrescription; onClose: () => void; onDone: (d: Dispensing) => void; dispensedBy: string;
}) {
  const [drug, setDrug] = useState('');
  const [dose, setDose] = useState('');
  const [freq, setFreq] = useState('');
  const [duration, setDuration] = useState('');
  const [subType, setSubType] = useState('generic_equivalent');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const pt = rx.encounter.patient;

  async function submit() {
    if (!drug.trim()) { toast.error('Enter substitute drug name'); return; }
    if (!reason.trim()) { toast.error('Reason is required'); return; }
    setLoading(true);
    try {
      const { data } = await api.post('/dispensing', {
        prescriptionId: rx.id, patientId: pt.id, type: 'substitution',
        dispensedDrug: drug, dispensedDose: dose,
        dispensedFrequency: freq, dispensedDuration: duration, dispensedBy,
        substitution: { originalDrug: rx.medication.name, substituteType: subType, reason },
      });
      printLabel(drug, dose, freq, `${pt.firstName} ${pt.lastName}`, pt.nationalId ?? '');
      onDone(data);
    } catch { toast.error('Substitution failed'); }
    finally { setLoading(false); }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <ModalTitle>Substitute Drug</ModalTitle>
      <p style={{ margin: '-10px 0 16px', fontSize: 12, color: C.muted }}>
        Prescribed: <strong style={{ color: C.title }}>{rx.medication.name}</strong>
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <FieldLabel>Substitute Drug *</FieldLabel>
          <DrugAutocomplete
            value={drug} onChange={setDrug} placeholder="Search substitute drug…"
            onSelect={e => { setDrug(e.name); if (e.dose) setDose(e.dose); }}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {([['Dose', dose, setDose], ['Frequency', freq, setFreq], ['Duration', duration, setDuration]] as const).map(([lbl, val, setter]) => (
            <div key={lbl}>
              <FieldLabel>{lbl}</FieldLabel>
              <input value={val} onChange={e => setter(e.target.value)} style={inputStyle} />
            </div>
          ))}
        </div>
        <div>
          <FieldLabel>Substitution Type</FieldLabel>
          <select value={subType} onChange={e => setSubType(e.target.value)}
            style={{ ...inputStyle, appearance: 'none' as const }}>
            <option value="generic_equivalent">Generic Equivalent</option>
            <option value="therapeutic_alternative">Therapeutic Alternative</option>
            <option value="out_of_stock">Out of Stock — nearest equivalent</option>
          </select>
        </div>
        <div>
          <FieldLabel>Reason *</FieldLabel>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
            style={{ ...inputStyle, resize: 'none' }} />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
        <button onClick={onClose} style={ghostBtn()}>Cancel</button>
        <button onClick={submit} disabled={loading}
          style={{ ...primaryBtn(loading), background: loading ? '#e2e8f0' : '#7c3aed' }}>
          <Printer size={13} /> {loading ? 'Submitting…' : 'Substitute & Print'}
        </button>
      </div>
    </ModalOverlay>
  );
}

// ── Edit inline expand row ────────────────────────────────────────────────────

function EditExpandRow({ rx, colSpan, onClose, onDone, dispensedBy }: {
  rx: GlobalPrescription; colSpan: number;
  onClose: () => void; onDone: (d: Dispensing) => void; dispensedBy: string;
}) {
  const [drug, setDrug] = useState(rx.medication.name);
  const [dose, setDose] = useState(rx.medication.dosage ?? '');
  const [freq, setFreq] = useState(rx.medication.frequency ?? '');
  const [duration, setDuration] = useState('');
  const [loading, setLoading] = useState(false);
  const pt = rx.encounter.patient;

  async function submit() {
    setLoading(true);
    try {
      const mods: Record<string, unknown> = {};
      if (drug !== rx.medication.name) mods.drugChanged = { from: rx.medication.name, to: drug };
      if (dose !== (rx.medication.dosage ?? '')) mods.doseChanged = { from: rx.medication.dosage, to: dose };
      if (freq !== (rx.medication.frequency ?? '')) mods.freqChanged = { from: rx.medication.frequency, to: freq };
      const { data } = await api.post('/dispensing', {
        prescriptionId: rx.id, patientId: pt.id, type: 'modified',
        dispensedDrug: drug, dispensedDose: dose,
        dispensedFrequency: freq, dispensedDuration: duration, dispensedBy,
        modifications: Object.keys(mods).length ? mods : undefined,
      });
      printLabel(drug, dose, freq, `${pt.firstName} ${pt.lastName}`, pt.nationalId ?? '');
      onDone(data);
    } catch { toast.error('Dispense failed'); }
    finally { setLoading(false); }
  }

  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: '14px 18px', background: 'var(--badge-blue-bg)', borderBottom: C.divider }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <FieldLabel>Drug</FieldLabel>
            <DrugAutocomplete
              value={drug} onChange={setDrug}
              onSelect={e => { setDrug(e.name); if (e.dose) setDose(e.dose); }}
            />
          </div>
          {([['Dose', dose, setDose], ['Frequency', freq, setFreq], ['Duration', duration, setDuration]] as const).map(([lbl, val, setter]) => (
            <div key={lbl}>
              <FieldLabel>{lbl}</FieldLabel>
              <input value={val} onChange={e => setter(e.target.value)} style={inputStyle} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={ghostBtn()}>Cancel</button>
          <button onClick={submit} disabled={loading} style={{ ...smallBtn('#1d4ed8'), padding: '7px 14px', fontSize: 12 }}>
            <Printer size={11} /> {loading ? 'Dispensing…' : 'Dispense & Print'}
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Dispensing card ───────────────────────────────────────────────────────────

function DispensingCard({ record, onCollect, canAct }: {
  record: Dispensing; onCollect: (id: string) => void; canAct: boolean;
}) {
  return (
    <div style={{
      background: '#fff', borderRadius: 10, border: C.cardBorder,
      padding: '12px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.title }}>{record.dispensedDrug}</div>
          <div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>
            {record.patient.firstName} {record.patient.lastName}
            {record.patient.nationalId ? ` · ${record.patient.nationalId}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' as const, justifyContent: 'flex-end' }}>
          {typePill(record.type)}
          {record.collectedAt
            ? <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: '#f0fdf4', color: '#166534' }}>Collected</span>
            : <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: '#fffbeb', color: '#92400e' }}>Pending</span>}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, marginBottom: 6 }}>
        {[['Dose', record.dispensedDose], ['Freq', record.dispensedFrequency], ['Duration', record.dispensedDuration]].map(([lbl, val]) => (
          <div key={lbl as string}>
            <span style={{ fontSize: 10, color: C.faint }}>{lbl as string}: </span>
            <span style={{ fontSize: 11, color: C.body, fontWeight: 500 }}>{val || '—'}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: C.faint }}>{new Date(record.dispensedAt).toLocaleString()}</span>
        {!record.collectedAt && canAct && (
          <button onClick={() => onCollect(record.id)}
            style={{ ...smallBtn('#166534'), background: 'transparent', color: '#166534', border: '1px solid #bbf7d0' }}>
            <CheckCircle size={11} /> Mark Collected
          </button>
        )}
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

  async function collect(id: string) {
    try {
      await api.patch(`/dispensing/${id}`, {});
      setHistory(h => h.map(r => r.id === id ? { ...r, collectedAt: new Date().toISOString() } : r));
      toast.success('Marked collected');
    } catch { toast.error('Failed'); }
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
          background: '#fff', border: C.cardBorder, borderRadius: 8,
          listStyle: 'none', margin: '0 0 12px', padding: 0, overflow: 'hidden',
        }}>
          {results.map(p => (
            <li key={p.id} onClick={() => selectPatient(p)}
              style={{ padding: '9px 14px', fontSize: 13, color: C.title, cursor: 'pointer', borderBottom: C.divider }}
              onMouseEnter={e => (e.currentTarget.style.background = '#fef2f2')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              {p.firstName} {p.lastName} {p.nationalId ? `· ${p.nationalId}` : ''}
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.title, display: 'flex', alignItems: 'center', gap: 6 }}>
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
              ? <p style={{ textAlign: 'center', color: C.faint, fontSize: 13, padding: '16px 0' }}>No dispensing records.</p>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {history.map(r => <DispensingCard key={r.id} record={r} onCollect={collect} canAct={canAct} />)}
                </div>}
        </div>
      )}
    </div>
  );
}

// ── Queue Tab ─────────────────────────────────────────────────────────────────

function QueueTab({ dispensedBy, canAct }: { dispensedBy: string; canAct: boolean }) {
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
    const drugs = [...new Set(prescriptions.map(rx => rx.medication.name))];
    drugs.forEach(drug => {
      api.get(`/inventory?drug=${encodeURIComponent(drug)}`).then(r => {
        setStocks(prev => ({ ...prev, [drug]: r.data }));
      }).catch(() => {});
    });
  }, [prescriptions]);

  async function collect(id: string) {
    try {
      await api.patch(`/dispensing/${id}`, {});
      setDispensedToday(d => d.map(r => r.id === id ? { ...r, collectedAt: new Date().toISOString() } : r));
      toast.success('Marked collected');
    } catch { toast.error('Failed'); }
  }

  function handleDispensed(d: Dispensing) {
    setDispenseModal(null); setSubstituteModal(null); setEditRow(null);
    if (d.prescriptionId) setPrescriptions(prev => prev.filter(rx => rx.id !== d.prescriptionId));
    setDispensedToday(prev => [d, ...prev]);
    toast.success('Dispensed successfully');
  }

  const thStyle: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600,
    color: C.faint, textTransform: 'uppercase', letterSpacing: '0.4px',
    background: '#f8fafc', whiteSpace: 'nowrap',
  };

  const tdStyle: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Section A: Prescription queue ── */}
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={cardTitleStyle}>Prescription Queue</span>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: '#fef2f2', color: C.red }}>
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
        ) : prescriptions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <Package size={28} color="#e2e8f0" style={{ marginBottom: 10 }} />
            <p style={{ fontSize: 14, fontWeight: 600, color: '#374151', margin: '0 0 4px' }}>
              No {filter === 'pending' ? 'pending ' : ''}prescriptions
            </p>
            <p style={{ fontSize: 13, color: C.faint, margin: 0 }}>Prescriptions from encounters will appear here.</p>
          </div>
        ) : (
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
                {prescriptions.map(rx => (
                  <Fragment key={rx.id}>
                    <tr style={{ borderTop: C.divider, opacity: rx.dispensed ? 0.55 : 1 }}>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600, color: C.title }}>
                          {rx.encounter.patient.firstName} {rx.encounter.patient.lastName}
                        </div>
                        <div style={{ fontSize: 11, color: C.faint }}>
                          {rx.encounter.patient.nationalId ?? '—'}
                        </div>
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 600, color: C.title }}>{rx.medication.name}</td>
                      <td style={tdStyle}>
                        <div style={{ color: C.body }}>{rx.medication.dosage ?? '—'}</div>
                        <div style={{ fontSize: 11, color: C.faint }}>{rx.medication.frequency ?? '—'}</div>
                      </td>
                      <td style={tdStyle}>
                        {stocks[rx.medication.name] != null
                          ? stockPill(stocks[rx.medication.name].quantity)
                          : <span style={{ color: C.faint, fontSize: 11 }}>—</span>}
                      </td>
                      <td style={{ ...tdStyle, color: C.body }}>{rx.encounter.clinician.name}</td>
                      <td style={{ ...tdStyle, color: C.faint, fontSize: 11 }}>
                        {new Date(rx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      {canAct && (
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          {rx.dispensed ? (
                            <span style={{ fontSize: 11, color: '#166534', display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                              <CheckCircle size={11} /> Done
                            </span>
                          ) : (
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <button onClick={() => setDispenseModal(rx)} style={smallBtn('#166534')}>
                                <Package size={10} /> Dispense
                              </button>
                              <button onClick={() => setEditRow(editRow === rx.id ? null : rx.id)}
                                style={smallBtn(editRow === rx.id ? '#1e40af' : '#1d4ed8')}>
                                <Edit2 size={10} /> Edit
                              </button>
                              <button onClick={() => setSubstituteModal(rx)} style={smallBtn('#6d28d9')}>
                                <RefreshCw size={10} /> Sub
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
                ))}
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
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: '#f0fdf4', color: '#166534' }}>
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
              ? <p style={{ textAlign: 'center', color: C.faint, fontSize: 13, padding: '16px 0', margin: 0 }}>Nothing dispensed today yet.</p>
              : dispensedToday.map(r => <DispensingCard key={r.id} record={r} onCollect={collect} canAct={canAct} />)}
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
  const [walkIn, setWalkIn] = useState({ drug: '', dose: '', freq: '', duration: '' });
  const [walkInLoading, setWalkInLoading] = useState(false);

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

  async function directDispense() {
    if (!selected) { toast.error('Select a patient first'); return; }
    if (!walkIn.drug.trim()) { toast.error('Enter drug name'); return; }
    setWalkInLoading(true);
    try {
      const { data } = await api.post('/dispensing', {
        patientId: selected.id, type: 'direct',
        dispensedDrug: walkIn.drug, dispensedDose: walkIn.dose,
        dispensedFrequency: walkIn.freq, dispensedDuration: walkIn.duration,
        dispensedBy,
      });
      printLabel(walkIn.drug, walkIn.dose, walkIn.freq, `${selected.firstName} ${selected.lastName}`, selected.nationalId ?? '');
      setHistory(h => [data, ...h]);
      setWalkIn({ drug: '', dose: '', freq: '', duration: '' });
      toast.success('Dispensed');
    } catch { toast.error('Dispense failed'); }
    finally { setWalkInLoading(false); }
  }

  async function collect(id: string) {
    try {
      await api.patch(`/dispensing/${id}`, {});
      setHistory(h => h.map(r => r.id === id ? { ...r, collectedAt: new Date().toISOString() } : r));
      toast.success('Marked collected');
    } catch { toast.error('Failed'); }
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
              background: '#fff', border: C.cardBorder, borderRadius: 8,
              listStyle: 'none', margin: '0 0 10px', padding: 0, overflow: 'hidden',
            }}>
              {patients.map(p => (
                <li key={p.id} onClick={() => selectPatient(p)}
                  style={{ padding: '9px 14px', fontSize: 13, color: C.title, cursor: 'pointer', borderBottom: C.divider, display: 'flex', alignItems: 'center', gap: 8 }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#fef2f2')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <User size={13} color={C.faint} />
                  {p.firstName} {p.lastName} {p.nationalId ? `· ${p.nationalId}` : ''}
                </li>
              ))}
            </ul>
          )}

          {selected && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca' }}>
              <User size={13} color={C.red} />
              <span style={{ fontSize: 13, fontWeight: 600, color: C.title }}>{selected.firstName} {selected.lastName}</span>
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
          <div style={{ padding: '14px 18px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
              <div>
                <FieldLabel>Drug *</FieldLabel>
                <DrugAutocomplete
                  value={walkIn.drug}
                  onChange={v => setWalkIn(w => ({ ...w, drug: v }))}
                  onSelect={e => setWalkIn(w => ({ ...w, drug: e.name, dose: e.dose || w.dose }))}
                />
              </div>
              {([['Dose', 'dose'], ['Frequency', 'freq'], ['Duration', 'duration']] as const).map(([lbl, key]) => (
                <div key={key}>
                  <FieldLabel>{lbl}</FieldLabel>
                  <input
                    value={walkIn[key]}
                    onChange={e => setWalkIn(w => ({ ...w, [key]: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={directDispense} disabled={walkInLoading} style={primaryBtn(walkInLoading)}>
                <Printer size={13} /> {walkInLoading ? 'Dispensing…' : 'Dispense & Print'}
              </button>
            </div>
          </div>
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
                ? <p style={{ textAlign: 'center', color: C.faint, fontSize: 13, padding: '16px 0', margin: 0 }}>No dispensing records for this patient.</p>
                : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {history.map(r => <DispensingCard key={r.id} record={r} onCollect={collect} canAct={canAct} />)}
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
  const [tab, setTab] = useState<'queue' | 'patient'>('queue');
  const [encounters, setEncounters] = useState<Encounter[]>([]);

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
  const canAct = role === 'pharmacist' || role === 'admin';
  const canView = canAct || role === 'clinician' || role === 'doctor' || role === 'nurse';

  if (!canView) {
    return (
      <div style={{ background: C.pageBg, minHeight: '100%', fontFamily: C.font, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', padding: 40 }}>
          <AlertTriangle size={32} color="#f59e0b" style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 14, color: C.body }}>You do not have access to the Pharmacy module.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: '100%', fontFamily: C.font }}>

      {/* ── Dark clinical sidebar (same component as Consultation) ── */}
      <ConsultationSidebar
        patientId={activePatient?.id ?? ''}
        patient={activePatient}
        encounters={encounters}
        visible={!!activePatient}
        currentNodes={[]}
      />

      {/* ── Main content ── */}
      <div style={{ flex: 1, minWidth: 0, background: C.pageBg, display: 'flex', flexDirection: 'column' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'clamp(12px, 2vw, 20px) clamp(14px, 3vw, 24px) 16px', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.title, letterSpacing: '-0.3px' }}>
              Pharmacy
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: C.muted }}>
              {user.name} · {role}
              {!canAct && (
                <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 600, color: '#92400e', background: '#fffbeb', padding: '2px 8px', borderRadius: 10 }}>
                  View only
                </span>
              )}
            </p>
          </div>
        </div>

        {/* ── Tab bar ── */}
        <div style={{
          borderBottom: '1px solid var(--border-light)',
          padding: '0 24px',
          display: 'flex',
          gap: 2,
          background: 'var(--bg-card)',
        }}>
          {(['queue', 'patient'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '12px 16px 10px',
              border: 'none', background: 'transparent',
              borderBottom: `2px solid ${tab === t ? C.red : 'transparent'}`,
              color: tab === t ? C.red : C.faint,
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              transition: 'color 0.15s',
            }}>
              {t === 'queue' ? 'Queue' : 'Patient'}
            </button>
          ))}
        </div>

        {/* ── Tab content ── */}
        <div style={{ padding: '16px 24px 24px', flex: 1, overflowY: 'auto' }}>
          {tab === 'queue' && <QueueTab dispensedBy={user.name} canAct={canAct} />}
          {tab === 'patient' && <PatientTab dispensedBy={user.name} canAct={canAct} />}
        </div>

      </div>
    </div>
  );
}
