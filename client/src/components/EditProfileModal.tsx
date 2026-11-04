import { useState, FormEvent } from 'react';
import api from '../api/client';
import { Patient } from '../types';
import { X, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';

// Zambian NRC format, e.g. "123456/78/9" — matches the placeholder already
// used on the registration forms (RegisterModal / NewPatientModal).
const NRC_REGEX = /^\d{6}\/\d{2}\/\d$/;

function isValidPhone(v: string): boolean {
  const digits = v.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 && /^[\d\s+()-]+$/.test(v);
}

interface Props {
  patient: Patient;
  onClose: () => void;
  onSaved: (updated: Patient) => void;
}

export default function EditProfileModal({ patient, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    firstName: patient.firstName,
    lastName: patient.lastName,
    dateOfBirth: patient.dateOfBirth ? patient.dateOfBirth.slice(0, 10) : '',
    gender: patient.gender,
    nationalId: patient.nationalId ?? '',
    phone: patient.phone ?? '',
    address: patient.address ?? '',
    email: patient.email ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: '' }));
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.firstName.trim()) next.firstName = 'First name is required';
    if (!form.lastName.trim()) next.lastName = 'Last name is required';
    if (!form.dateOfBirth) next.dateOfBirth = 'Date of birth is required';
    else if (new Date(form.dateOfBirth) > new Date()) next.dateOfBirth = 'Date of birth cannot be in the future';
    if (!form.gender) next.gender = 'Gender is required';
    if (form.nationalId.trim() && !NRC_REGEX.test(form.nationalId.trim())) {
      next.nationalId = 'NRC must be in the format 123456/78/9';
    }
    if (form.phone.trim() && !isValidPhone(form.phone.trim())) {
      next.phone = 'Enter a valid phone number';
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      next.email = 'Invalid email address';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    try {
      const { data } = await api.patch(`/patients/${patient.id}`, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        dateOfBirth: form.dateOfBirth,
        gender: form.gender,
        nationalId: form.nationalId.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        email: form.email.trim() || null,
      });
      toast.success('Profile updated');
      onSaved(data);
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70,
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
              <Pencil size={15} color="var(--ses-red)" />
            </div>
            <div>
              <div style={{ fontWeight: 500, fontSize: 15, color: 'var(--text-heading)' }}>Edit Profile</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 1 }}>Update registration details</div>
            </div>
          </div>
          <button onClick={onClose} style={{
            width: 30, height: 30, borderRadius: 999, border: '1px solid var(--border)',
            background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--text-muted)',
          }}>
            <X size={14} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={submit} noValidate style={{ padding: '20px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <FormField label="First Name" required error={errors.firstName}>
              <input
                className="field-input" value={form.firstName}
                onChange={(e) => set('firstName', e.target.value)}
                style={errors.firstName ? { border: '1.5px solid var(--badge-red-text)' } : undefined}
              />
            </FormField>
            <FormField label="Last Name" required error={errors.lastName}>
              <input
                className="field-input" value={form.lastName}
                onChange={(e) => set('lastName', e.target.value)}
                style={errors.lastName ? { border: '1.5px solid var(--badge-red-text)' } : undefined}
              />
            </FormField>
            <FormField label="Date of Birth" required error={errors.dateOfBirth}>
              <input
                type="date" className="field-input" value={form.dateOfBirth}
                onChange={(e) => set('dateOfBirth', e.target.value)}
                style={errors.dateOfBirth ? { border: '1.5px solid var(--badge-red-text)' } : undefined}
              />
            </FormField>
            <FormField label="Gender" required error={errors.gender}>
              <select className="field-input" value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </select>
            </FormField>
            <FormField label="National ID" error={errors.nationalId}>
              <input
                className="field-input" value={form.nationalId}
                onChange={(e) => set('nationalId', e.target.value)}
                placeholder="123456/78/9"
                style={errors.nationalId ? { border: '1.5px solid var(--badge-red-text)' } : undefined}
              />
            </FormField>
            <FormField label="Phone Number" error={errors.phone}>
              <input
                className="field-input" value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="+260 9X XXX XXXX"
                style={errors.phone ? { border: '1.5px solid var(--badge-red-text)' } : undefined}
              />
            </FormField>
            <FormField label="Email" error={errors.email}>
              <input
                type="email" className="field-input" value={form.email}
                onChange={(e) => set('email', e.target.value)}
                style={errors.email ? { border: '1.5px solid var(--badge-red-text)' } : undefined}
              />
            </FormField>
            <FormField label="Address">
              <input className="field-input" value={form.address} onChange={(e) => set('address', e.target.value)} />
            </FormField>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--border-light)' }}>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FormField({ label, required, error, children }: {
  label: string; required?: boolean; error?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-body)', marginBottom: 5 }}>
        {label} {required && <span style={{ color: 'var(--ses-red)' }}>*</span>}
      </label>
      {children}
      {error && <p style={{ fontSize: 11.5, color: 'var(--badge-red-text)', marginTop: 4 }}>{error}</p>}
    </div>
  );
}
