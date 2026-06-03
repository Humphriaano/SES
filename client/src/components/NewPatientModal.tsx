import { useState, FormEvent } from 'react';
import api from '../api/client';
import { Patient } from '../types';
import { X, UserPlus } from 'lucide-react';

interface Props {
  onClose: () => void;
  onCreated: (p: Patient) => void;
}

export default function NewPatientModal({ onClose, onCreated }: Props) {
  const [form, setForm] = useState({
    firstName: '', lastName: '', dateOfBirth: '', gender: 'MALE',
    phone: '', address: '', nationalId: '', hivStatus: 'UNKNOWN', hivTestDate: '',
  });
  const [loading, setLoading] = useState(false);

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/patients', form);
      onCreated(data);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
      backdropFilter: 'blur(2px)',
    }}>
      <div style={{
        background: 'var(--bg-card)', borderRadius: 16, width: '100%', maxWidth: 560,
        boxShadow: '0 20px 60px rgba(0,0,0,0.18)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 24px', borderBottom: '1px solid var(--border-light)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 8, background: 'var(--badge-red-bg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <UserPlus size={16} color="#c8102e" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-heading)' }}>Register New Patient</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 1 }}>Fill in the patient's details below</div>
            </div>
          </div>
          <button onClick={onClose} style={{
            width: 30, height: 30, borderRadius: 7, border: '1px solid var(--border)',
            background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--text-muted)',
          }}>
            <X size={14} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={submit} style={{ padding: '20px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <FormField label="First Name" required>
              <input className="field-input" required value={form.firstName} onChange={(e) => set('firstName', e.target.value)} placeholder="e.g. John" />
            </FormField>
            <FormField label="Last Name" required>
              <input className="field-input" required value={form.lastName} onChange={(e) => set('lastName', e.target.value)} placeholder="e.g. Banda" />
            </FormField>
            <FormField label="Date of Birth" required>
              <input type="date" className="field-input" required value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
            </FormField>
            <FormField label="Gender">
              <select className="field-input" value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </select>
            </FormField>
            <FormField label="Phone Number">
              <input className="field-input" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+260 9X XXX XXXX" />
            </FormField>
            <FormField label="National ID">
              <input className="field-input" value={form.nationalId} onChange={(e) => set('nationalId', e.target.value)} placeholder="NRC number" />
            </FormField>
            <FormField label="Address" style={{ gridColumn: '1 / -1' }}>
              <input className="field-input" value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Physical address" />
            </FormField>
            <FormField label="HIV Status">
              <select className="field-input" value={form.hivStatus} onChange={(e) => set('hivStatus', e.target.value)}>
                <option value="UNKNOWN">Unknown</option>
                <option value="NEGATIVE">Negative</option>
                <option value="POSITIVE">Positive</option>
              </select>
            </FormField>
            <FormField label="HIV Test Date">
              <input type="date" className="field-input" value={form.hivTestDate} onChange={(e) => set('hivTestDate', e.target.value)} />
            </FormField>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--border-light)' }}>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary">
              <UserPlus size={14} />
              {loading ? 'Registering…' : 'Register Patient'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FormField({ label, required, children, style }: {
  label: string; required?: boolean;
  children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <div style={style}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-body)', marginBottom: 5 }}>
        {label} {required && <span style={{ color: '#c8102e' }}>*</span>}
      </label>
      {children}
    </div>
  );
}
