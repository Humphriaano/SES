import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { PrescriptionBlockData, PrescriptionItem } from '../../../types/consultation';
import { searchCatalog, DrugEntry } from '../../../data/drugCatalog';
import api from '../../../api/client';

const FREQUENCIES = ['OD', 'BD', 'TDS', 'QDS', 'PRN', 'Stat', 'Weekly', 'Monthly'];
const ROUTES = ['Oral', 'IV', 'IM', 'IV/IM', 'SC', 'Topical', 'Inhaled', 'SL', 'PR', 'Nasal', 'Ophthalmic', 'Rectal', 'Vaginal', 'Transdermal'];

function ItemForm({ onAdd, onCancel, patientId, encounterId }: {
  onAdd: (item: Omit<PrescriptionItem, 'id'>) => void;
  onCancel: () => void;
  patientId?: string;
  encounterId?: string;
}) {
  const [drug, setDrug] = useState('');
  const [form, setForm] = useState({ dose: '', frequency: 'OD', duration: '', route: 'Oral', specialInstructions: '' });
  const [suggestions, setSuggestions] = useState<DrugEntry[]>([]);
  const [showDrugs, setShowDrugs] = useState(false);
  const [saving, setSaving] = useState(false);
  const canAdd = drug.trim() && form.dose.trim() && !saving;

  function handleDrugChange(value: string) {
    setDrug(value);
    if (value.length >= 2) {
      const hits = searchCatalog(value, 10);
      setSuggestions(hits);
      setShowDrugs(hits.length > 0);
    } else {
      setSuggestions([]);
      setShowDrugs(false);
    }
  }

  function pickDrug(entry: DrugEntry) {
    setDrug(entry.name);
    setForm(f => ({
      ...f,
      dose: entry.dose || f.dose,
      route: entry.route && ROUTES.includes(entry.route) ? entry.route : f.route,
    }));
    setShowDrugs(false);
  }

  const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px',
    border: '1.5px solid var(--border)', borderRadius: 6,
    fontSize: 13, outline: 'none', boxSizing: 'border-box',
    background: 'var(--bg-input)', color: 'var(--text-heading)',
  };

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginTop: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {/* Drug search */}
        <div style={{ gridColumn: '1/-1', position: 'relative' }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-body)', marginBottom: 3, display: 'block' }}>Drug</label>
          <input
            type="text"
            placeholder="Search drug name…"
            value={drug}
            onChange={e => handleDrugChange(e.target.value)}
            onFocus={() => { if (suggestions.length > 0) setShowDrugs(true); }}
            onBlur={() => setTimeout(() => setShowDrugs(false), 150)}
            style={fieldStyle}
          />
          {showDrugs && suggestions.length > 0 && (
            <div style={{
              position: 'absolute', zIndex: 100, background: 'var(--bg-card)',
              border: '1px solid var(--border-input)', borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
              width: '100%', maxHeight: 200, overflowY: 'auto', marginTop: 4,
            }}>
              {suggestions.map((entry, i) => (
                <button
                  key={`${entry.name}-${entry.sku}-${i}`}
                  onMouseDown={() => pickDrug(entry)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '7px 12px',
                    background: 'none', border: 'none', borderBottom: '1px solid var(--border-light)',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <div style={{ fontSize: 13, color: 'var(--text-heading)', fontWeight: 500 }}>{entry.name}</div>
                  {(entry.dose || entry.form) && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                      {[entry.dose, entry.form, entry.route].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Dose */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-body)', marginBottom: 3, display: 'block' }}>Dose</label>
          <input
            type="text" placeholder="e.g. 500mg"
            value={form.dose} onChange={e => setForm(f => ({ ...f, dose: e.target.value }))}
            style={fieldStyle}
          />
        </div>

        {/* Frequency */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-body)', marginBottom: 3, display: 'block' }}>Frequency</label>
          <select
            value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}
            style={fieldStyle}
          >
            {FREQUENCIES.map(f => <option key={f}>{f}</option>)}
          </select>
        </div>

        {/* Duration */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-body)', marginBottom: 3, display: 'block' }}>Duration</label>
          <input
            type="text" placeholder="e.g. 7 days"
            value={form.duration} onChange={e => setForm(f => ({ ...f, duration: e.target.value }))}
            style={fieldStyle}
          />
        </div>

        {/* Route */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-body)', marginBottom: 3, display: 'block' }}>Route</label>
          <select
            value={form.route} onChange={e => setForm(f => ({ ...f, route: e.target.value }))}
            style={fieldStyle}
          >
            {ROUTES.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>

        {/* Instructions */}
        <div style={{ gridColumn: '1/-1' }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-body)', marginBottom: 3, display: 'block' }}>
            Special Instructions <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span>
          </label>
          <input
            type="text" placeholder="e.g. Take with food, avoid sunlight"
            value={form.specialInstructions} onChange={e => setForm(f => ({ ...f, specialInstructions: e.target.value }))}
            style={fieldStyle}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{ background: 'var(--bg-surface-2)', color: 'var(--text-body)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}
        >
          Cancel
        </button>
        <button
          onClick={async () => {
            if (!canAdd) return;
            const base: Omit<PrescriptionItem, 'id'> = {
              drugName: drug.trim(), dose: form.dose, frequency: form.frequency,
              duration: form.duration, route: form.route, specialInstructions: form.specialInstructions,
            };
            if (patientId && encounterId) {
              setSaving(true);
              try {
                const medRes = await api.post(`/patients/${patientId}/medications`, {
                  name: base.drugName, dosage: base.dose, frequency: base.frequency,
                  route: base.route, startDate: new Date().toISOString(),
                });
                const rxRes = await api.post(`/encounters/${encounterId}/prescriptions`, {
                  medicationId: medRes.data.id,
                });
                onAdd({ ...base, medicationId: medRes.data.id, prescriptionId: rxRes.data.id });
              } catch {
                toast.error('Saved locally — sync to server failed');
                onAdd(base);
              } finally {
                setSaving(false);
              }
            } else {
              onAdd(base);
            }
          }}
          disabled={!canAdd}
          style={{
            background: canAdd ? 'var(--ses-red)' : 'var(--border-input)',
            color: canAdd ? '#fff' : 'var(--text-subtle)',
            border: 'none', borderRadius: 6, padding: '6px 14px',
            fontSize: 12, fontWeight: 600, cursor: canAdd ? 'pointer' : 'not-allowed',
          }}
        >
          {saving ? 'Saving…' : 'Add Drug'}
        </button>
      </div>
    </div>
  );
}

interface Props {
  data: PrescriptionBlockData;
  onChange: (data: PrescriptionBlockData) => void;
  onRemove: () => void;
  readOnly?: boolean;
  patientId?: string;
  encounterId?: string;
}

export default function PrescriptionBlock({ data, onChange, onRemove, readOnly, patientId, encounterId }: Props) {
  const [addingItem, setAddingItem] = useState(data.items.length === 0 && !readOnly);

  return (
    <div style={{
      borderLeft: '3px solid var(--ses-blue-deep)',
      background: 'var(--bg-card)',
      borderRadius: '0 10px 10px 0',
      padding: '10px 14px',
      margin: '4px 0',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: data.items.length > 0 ? 8 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ses-blue-deep)', background: 'var(--ses-blue-tint)', padding: '2px 7px', borderRadius: 4, fontFamily: 'monospace' }}>Rx</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-heading)' }}>Prescription</span>
        </div>
        {!readOnly && (
          <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={12} />
          </button>
        )}
      </div>

      {data.items.map((item, i) => (
        <div key={item.id} style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '8px 12px', marginBottom: 6,
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-heading)' }}>{item.drugName}</span>
              <span style={{ fontSize: 12, color: 'var(--text-body)' }}>{item.dose}</span>
              <span style={{ fontSize: 11, background: 'var(--badge-blue-bg)', color: 'var(--badge-blue-text)', padding: '1px 7px', borderRadius: 4 }}>{item.frequency}</span>
              {item.duration && <span style={{ fontSize: 11, color: 'var(--text-body2)' }}>{item.duration}</span>}
              <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>·</span>
              <span style={{ fontSize: 11, color: 'var(--text-body2)' }}>{item.route}</span>
            </div>
            {item.specialInstructions && (
              <p style={{ fontSize: 12, color: 'var(--text-body2)', margin: '3px 0 0', fontStyle: 'italic' }}>{item.specialInstructions}</p>
            )}
          </div>
          {!readOnly && (
            <button
              onClick={() => onChange({ items: data.items.filter((_, j) => j !== i) })}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0 }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}

      {addingItem && !readOnly ? (
        <ItemForm
          patientId={patientId}
          encounterId={encounterId}
          onAdd={item => { onChange({ items: [...data.items, { ...item, id: `${Date.now()}` }] }); setAddingItem(false); }}
          onCancel={() => { setAddingItem(false); if (data.items.length === 0) onRemove(); }}
        />
      ) : (
        !readOnly && (
          <button
            onClick={() => setAddingItem(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'none', border: '1.5px dashed var(--border)',
              borderRadius: 7, padding: '6px 12px', fontSize: 12,
              color: 'var(--badge-blue-text)', cursor: 'pointer', marginTop: data.items.length > 0 ? 4 : 0,
            }}
          >
            <Plus size={12} /> Add Drug
          </button>
        )
      )}
    </div>
  );
}
