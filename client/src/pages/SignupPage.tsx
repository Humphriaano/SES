import { useState, useEffect, useRef, useCallback, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import {
  HeartPulse, Mail, Lock, Eye, EyeOff, User, Phone,
  MapPin, ChevronDown, Check, X, AlertCircle, CheckCircle,
} from 'lucide-react';

// ── Data ──────────────────────────────────────────────────────────────────────

const DESIGNATIONS = [
  'Medical Doctor',
  'Medical Licentiate Practitioner',
  'Clinical Officer General',
  'Registered Nurse',
  'Registered Midwife',
  'Enrolled Nurse',
  'Nurse Practitioner',
  'Medical Laboratory Technologist',
  'Pharmacy Technologist',
  'Pharmacist',
  'Clinical Mental Psychiatrist',
  'Biomedical Scientific Officer',
  'Dental Technologist',
  'Physiotherapist',
  'Radiography Technologist',
  'Dental Therapist',
  'CHA',
  'Record Clerk',
  'Counsellor',
  'Administration',
  'Dental Assistant',
  'Health Information Officer',
  'Health Information Technician',
  'Monitoring & Evaluation (M&E) Officer',
  'Data Clerk / Data Entry Operator',
  'Medical Records Officer',
  'Digital Health Officer',
  'Data Analyst / Data Scientist',
  'ICT Officer / Health IT Specialist',
  'Psychiatric Nurse',
  'Public Health Nurse',
  'Nursing Assistant',
  'Public Health Scientist',
  'Advanced Clinical Officer',
  'Radiographer',
  'Sonographer',
  'Sonography Technologist',
  'Drug store operator',
  'Specialist',
  'Dental Surgeon',
  'Clinical Psychologist',
  'Health Psychologist',
  'Anaesthetist',
  'Clinical Anaesthetist Technologist',
  'Environmental Health Officer',
  'Dispenser',
  'Regulatory pharmacist',
  'Nutrition Technologist',
  'Environmental Health Technologist',
  'Emergency Care Practitioner',
  'Clinical Technologist',
  'Clinical ophthalmic officer',
  'Optometrist',
  'Optometry Technologist',
  'Dispensing Optician',
  'Nutritionist/Dietician',
  'Audiology Technologist',
  'Audiology Assistant',
  'Ultrasound Technologist',
  'Forensic Psychologist',
  'Clinical Neuropsychologist',
  'Counselling Psychologist',
  'Pharmacy Dispenser',
  'Occupational Therapist',
  'Medical Laboratory Technician',
  'Medical Imaging Assistant',
  'Orthopaedic Technologist',
  'Advanced life support practitioner',
  'Emergency Medical Technician',
  'Dental Hygienist',
  'Pharmacologist',
  'Osteopath',
  'Podiatrist',
  'Audiologist',
  'Physiotherapy Technologist',
  'Clinical Scientist',
  'Radiation Therapist',
  'Radiation Therapy Technologist',
  'Clinical Medical Physicist - medical imaging',
  'Clinical Medical Physicist - nuclear Medicine',
  'Clinical Medical Physicist - Radiotherapy',
  'Community Oral Health Educator',
  'Orthotist/Prosthetist',
  'Optician',
  'Community Health Assistant',
  'Dental Laboratory Scientist',
  'Orthopaedic Technician',
  'Speech Language Therapist',
  'Dialysis Therapist',
  'Chiropractor',
  'Professor',
];

const COUNTRY_CODES = [
  { code: '+260', country: 'Zambia', flag: '🇿🇲' },
  { code: '+27', country: 'South Africa', flag: '🇿🇦' },
  { code: '+263', country: 'Zimbabwe', flag: '🇿🇼' },
  { code: '+265', country: 'Malawi', flag: '🇲🇼' },
  { code: '+255', country: 'Tanzania', flag: '🇹🇿' },
  { code: '+254', country: 'Kenya', flag: '🇰🇪' },
  { code: '+256', country: 'Uganda', flag: '🇺🇬' },
  { code: '+243', country: 'DR Congo', flag: '🇨🇩' },
  { code: '+267', country: 'Botswana', flag: '🇧🇼' },
  { code: '+258', country: 'Mozambique', flag: '🇲🇿' },
  { code: '+266', country: 'Lesotho', flag: '🇱🇸' },
  { code: '+264', country: 'Namibia', flag: '🇳🇦' },
  { code: '+44', country: 'United Kingdom', flag: '🇬🇧' },
  { code: '+1', country: 'United States', flag: '🇺🇸' },
  { code: '+61', country: 'Australia', flag: '🇦🇺' },
  { code: '+49', country: 'Germany', flag: '🇩🇪' },
  { code: '+33', country: 'France', flag: '🇫🇷' },
  { code: '+91', country: 'India', flag: '🇮🇳' },
  { code: '+86', country: 'China', flag: '🇨🇳' },
];

// ── Searchable dropdown ───────────────────────────────────────────────────────

function SearchableSelect({
  value, onChange, options, placeholder, error,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setSearch(''); }}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 12px', height: 40, border: `1px solid ${error ? 'var(--badge-red-text)' : 'var(--border-input)'}`,
          borderRadius: 8, background: 'var(--bg-input)', cursor: 'pointer', fontSize: 13.5,
          color: value ? 'var(--text-heading)' : 'var(--text-subtle)', textAlign: 'left',
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value || placeholder}
        </span>
        <ChevronDown size={14} color="var(--text-subtle)" style={{ flexShrink: 0, marginLeft: 4 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: 'var(--bg-card)', border: '1px solid var(--border-input)', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)', marginTop: 4, overflow: 'hidden',
        }}>
          <div style={{ padding: '8px 8px 4px' }}>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              style={{
                width: '100%', padding: '6px 10px', border: '1px solid var(--border-input)',
                borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box',
                background: 'var(--bg-input)', color: 'var(--text-heading)',
              }}
            />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--text-subtle)' }}>No results</div>
            ) : filtered.map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => { onChange(opt); setOpen(false); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none',
                  background: value === opt ? 'var(--badge-red-bg)' : 'transparent', cursor: 'pointer',
                  fontSize: 13.5, color: 'var(--text-heading)', display: 'flex', alignItems: 'center', gap: 8,
                }}
                onMouseEnter={e => { if (value !== opt) e.currentTarget.style.background = 'var(--bg-surface)'; }}
                onMouseLeave={e => { if (value !== opt) e.currentTarget.style.background = 'transparent'; }}
              >
                {value === opt && <Check size={13} color="var(--ses-red)" style={{ flexShrink: 0 }} />}
                {opt}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <p style={{ fontSize: 11.5, color: 'var(--badge-red-text)', marginTop: 4 }}>{error}</p>}
    </div>
  );
}

// ── Country code picker ───────────────────────────────────────────────────────

function CountryCodePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const selected = COUNTRY_CODES.find(c => c.code === value) ?? COUNTRY_CODES[0];
  const filtered = COUNTRY_CODES.filter(c =>
    c.country.toLowerCase().includes(search.toLowerCase()) || c.code.includes(search)
  );

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setSearch(''); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '0 10px',
          height: 40, border: '1px solid var(--border-input)', borderRadius: '8px 0 0 8px',
          background: 'var(--bg-surface)', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap',
        }}
      >
        <span>{selected.flag}</span>
        <span style={{ color: 'var(--text-body)', fontWeight: 500 }}>{selected.code}</span>
        <ChevronDown size={12} color="var(--text-subtle)" />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 100, width: 220,
          background: 'var(--bg-card)', border: '1px solid var(--border-input)', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)', marginTop: 4, overflow: 'hidden',
        }}>
          <div style={{ padding: '8px 8px 4px' }}>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search country…"
              style={{
                width: '100%', padding: '6px 10px', border: '1px solid var(--border-input)',
                borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box',
                background: 'var(--bg-input)', color: 'var(--text-heading)',
              }}
            />
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {filtered.map(c => (
              <button
                key={c.code}
                type="button"
                onClick={() => { onChange(c.code); setOpen(false); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '7px 12px', border: 'none',
                  background: c.code === value ? 'var(--badge-red-bg)' : 'transparent', cursor: 'pointer',
                  fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
                }}
                onMouseEnter={e => { if (c.code !== value) e.currentTarget.style.background = 'var(--bg-surface)'; }}
                onMouseLeave={e => { if (c.code !== value) e.currentTarget.style.background = 'transparent'; }}
              >
                <span>{c.flag}</span>
                <span style={{ color: 'var(--text-body)' }}>{c.country}</span>
                <span style={{ color: 'var(--text-subtle)', marginLeft: 'auto' }}>{c.code}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Field helpers ─────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-body)', marginBottom: 6 }}>
      {children}
    </label>
  );
}

function FieldInput({ error, icon, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { error?: string; icon?: React.ReactNode }) {
  return (
    <div>
      <div style={{ position: 'relative' }}>
        {icon && (
          <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)', display: 'flex', alignItems: 'center' }}>
            {icon}
          </span>
        )}
        <input
          {...props}
          style={{
            width: '100%', height: 40, padding: icon ? '0 12px 0 38px' : '0 12px',
            border: `1px solid ${error ? 'var(--badge-red-text)' : 'var(--border-input)'}`, borderRadius: 8,
            fontSize: 13.5, color: 'var(--text-heading)', outline: 'none', boxSizing: 'border-box',
            background: props.disabled ? 'var(--bg-surface)' : 'var(--bg-input)',
            ...props.style,
          }}
        />
      </div>
      {error && <p style={{ fontSize: 11.5, color: 'var(--badge-red-text)', marginTop: 4 }}>{error}</p>}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase',
      letterSpacing: '0.07em', marginBottom: 14, paddingBottom: 8,
      borderBottom: '1px solid var(--border-light)',
    }}>
      {children}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface FormData {
  firstName: string; surname: string; dateOfBirth: string; sex: string; designation: string;
  nrc: string; hasNoNrc: boolean; address: string; countryCode: string; cellphone: string;
  email: string; username: string; password: string; confirmPassword: string;
}

interface FormErrors {
  [key: string]: string;
}

export default function SignupPage() {
  const [form, setForm] = useState<FormData>({
    firstName: '', surname: '', dateOfBirth: '', sex: '', designation: '',
    nrc: '', hasNoNrc: false, address: '', countryCode: '+260', cellphone: '',
    email: '', username: '', password: '', confirmPassword: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const usernameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function set(field: keyof FormData, value: string | boolean) {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => { const e = { ...prev }; delete e[field]; return e; });
  }

  const checkUsernameAvailability = useCallback((username: string) => {
    if (usernameTimer.current) clearTimeout(usernameTimer.current);
    if (!username || username.length < 2) { setUsernameStatus('idle'); return; }
    setUsernameStatus('checking');
    usernameTimer.current = setTimeout(async () => {
      try {
        const { data } = await api.get(`/auth/check-username?username=${encodeURIComponent(username)}`);
        setUsernameStatus(data.available ? 'available' : 'taken');
      } catch {
        setUsernameStatus('idle');
      }
    }, 500);
  }, []);

  useEffect(() => {
    checkUsernameAvailability(form.username);
  }, [form.username, checkUsernameAvailability]);

  function validate(): boolean {
    const e: FormErrors = {};
    if (!form.firstName.trim()) e.firstName = 'First name is required';
    if (!form.surname.trim()) e.surname = 'Surname is required';
    if (!form.dateOfBirth) e.dateOfBirth = 'Date of birth is required';
    if (!form.sex) e.sex = 'Sex is required';
    if (!form.designation) e.designation = 'Designation is required';
    if (!form.hasNoNrc && !form.nrc.trim()) e.nrc = 'NRC is required (or check "I do not have NRC")';
    if (!form.cellphone.trim()) e.cellphone = 'Phone number is required';
    if (!form.email.trim()) e.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email address';
    if (!form.username.trim()) e.username = 'Username is required';
    else if (form.username.length < 3) e.username = 'Username must be at least 3 characters';
    else if (usernameStatus === 'taken') e.username = 'Username is already taken';
    if (!form.password) e.password = 'Password is required';
    else if (form.password.length < 6) e.password = 'Password must be at least 6 characters';
    if (!form.confirmPassword) e.confirmPassword = 'Please confirm your password';
    else if (form.password !== form.confirmPassword) e.confirmPassword = 'Passwords do not match';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      await api.post('/auth/register', {
        firstName: form.firstName.trim(),
        surname: form.surname.trim(),
        dateOfBirth: form.dateOfBirth,
        sex: form.sex,
        designation: form.designation,
        nrc: form.hasNoNrc ? null : form.nrc.trim(),
        hasNoNrc: form.hasNoNrc,
        address: form.address.trim() || null,
        countryCode: form.countryCode,
        cellphone: form.cellphone.trim(),
        email: form.email.trim().toLowerCase(),
        username: form.username.trim().toLowerCase(),
        password: form.password,
      });
      setSubmitted(true);
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.field === 'email') setErrors(prev => ({ ...prev, email: data.error }));
      else if (data?.field === 'username') setErrors(prev => ({ ...prev, username: data.error }));
      else setErrors(prev => ({ ...prev, _global: data?.error ?? 'Registration failed. Please try again.' }));
    } finally {
      setLoading(false);
    }
  }

  // ── Layout shell ─────────────────────────────────────────────────────────────

  return (
    <div style={{
      minHeight: '100vh', display: 'flex',
      background: 'linear-gradient(135deg, #252B2D 0%, #3D1F1F 50%, #252B2D 100%)',
    }}>
      {/* Left branding panel */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center',
        alignItems: 'center', padding: 48, color: '#fff',
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16, background: 'var(--ses-red)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 24px rgba(215,29,36,0.4)', marginBottom: 24,
        }}>
          <HeartPulse size={32} color="#fff" />
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 8 }}>SES EHR</h1>
        <p style={{ fontSize: 14, color: '#94a3b8', textAlign: 'center', maxWidth: 280, lineHeight: 1.6 }}>
          Specialty Emergency Services<br />Chronic Disease Management System
        </p>
        <div style={{ marginTop: 48, display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 280 }}>
          {[
            { label: 'Longitudinal patient care', desc: 'Track disease progression over time' },
            { label: 'Integrated workflows', desc: 'Labs, pharmacy, billing in one place' },
            { label: 'ICD-11 coded diagnoses', desc: 'Structured clinical documentation' },
          ].map(f => (
            <div key={f.label} style={{ display: 'flex', gap: 12 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ses-red)', flexShrink: 0, marginTop: 5 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{f.label}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 1 }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right form panel */}
      <div style={{
        width: 500, background: 'var(--bg-card)', display: 'flex', flexDirection: 'column',
        overflowY: 'auto', boxShadow: '-4px 0 40px rgba(0,0,0,0.3)',
      }}>
        <div style={{ padding: '40px 40px 48px', flex: 1 }}>

          {submitted ? (
            // ── Success state ──────────────────────────────────────────────
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, textAlign: 'center' }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%', background: 'var(--badge-green-bg)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20,
              }}>
                <CheckCircle size={32} color="#16a34a" />
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-heading)', marginBottom: 10 }}>
                Account Request Submitted
              </h2>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.7, maxWidth: 340, marginBottom: 28 }}>
                Your registration has been submitted successfully. An administrator will review your request
                and you will be notified once your account is approved.
              </p>
              <Link
                to="/login"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '10px 24px', background: 'var(--ses-red)', color: '#fff',
                  borderRadius: 8, fontSize: 13.5, fontWeight: 600, textDecoration: 'none',
                }}
              >
                Back to Login
              </Link>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 28 }}>
                <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-heading)', marginBottom: 6 }}>Create Account</h2>
                <p style={{ fontSize: 13.5, color: 'var(--text-subtle)' }}>Complete the form to request access</p>
              </div>

              {errors._global && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                  background: 'var(--badge-red-bg)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 20,
                  fontSize: 13, color: 'var(--badge-red-text)',
                }}>
                  <AlertCircle size={15} style={{ flexShrink: 0 }} />
                  {errors._global}
                </div>
              )}

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

                {/* ── Personal Info ──────────────────────────────────────── */}
                <SectionHeader>Personal Information</SectionHeader>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <FieldLabel>First Name <span style={{ color: 'var(--badge-red-text)' }}>*</span></FieldLabel>
                    <FieldInput
                      value={form.firstName}
                      onChange={e => set('firstName', e.target.value)}
                      placeholder="John"
                      error={errors.firstName}
                      icon={<User size={14} />}
                    />
                  </div>
                  <div>
                    <FieldLabel>Surname <span style={{ color: 'var(--badge-red-text)' }}>*</span></FieldLabel>
                    <FieldInput
                      value={form.surname}
                      onChange={e => set('surname', e.target.value)}
                      placeholder="Doe"
                      error={errors.surname}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <FieldLabel>Date of Birth <span style={{ color: 'var(--badge-red-text)' }}>*</span></FieldLabel>
                    <FieldInput
                      type="date"
                      value={form.dateOfBirth}
                      onChange={e => set('dateOfBirth', e.target.value)}
                      max={new Date().toISOString().split('T')[0]}
                      error={errors.dateOfBirth}
                    />
                  </div>
                  <div>
                    <FieldLabel>Sex <span style={{ color: 'var(--badge-red-text)' }}>*</span></FieldLabel>
                    <select
                      value={form.sex}
                      onChange={e => set('sex', e.target.value)}
                      style={{
                        width: '100%', height: 40, padding: '0 12px',
                        border: `1px solid ${errors.sex ? 'var(--badge-red-text)' : 'var(--border-input)'}`,
                        borderRadius: 8, fontSize: 13.5, color: form.sex ? 'var(--text-heading)' : 'var(--text-subtle)',
                        background: 'var(--bg-input)', outline: 'none', cursor: 'pointer',
                      }}
                    >
                      <option value="">Select…</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                    </select>
                    {errors.sex && <p style={{ fontSize: 11.5, color: 'var(--badge-red-text)', marginTop: 4 }}>{errors.sex}</p>}
                  </div>
                </div>

                <div>
                  <FieldLabel>Designation <span style={{ color: 'var(--badge-red-text)' }}>*</span></FieldLabel>
                  <SearchableSelect
                    value={form.designation}
                    onChange={v => set('designation', v)}
                    options={DESIGNATIONS}
                    placeholder="Search your designation…"
                    error={errors.designation}
                  />
                </div>

                {/* ── Contact Info ───────────────────────────────────────── */}
                <SectionHeader>Contact Information</SectionHeader>

                <div>
                  <FieldLabel>NRC Number</FieldLabel>
                  <FieldInput
                    value={form.nrc}
                    onChange={e => set('nrc', e.target.value)}
                    placeholder="000000/00/0"
                    disabled={form.hasNoNrc}
                    error={errors.nrc}
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={form.hasNoNrc}
                      onChange={e => {
                        set('hasNoNrc', e.target.checked);
                        if (e.target.checked) set('nrc', '');
                      }}
                      style={{ width: 14, height: 14, accentColor: 'var(--ses-red)' }}
                    />
                    <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>I do not have an NRC</span>
                  </label>
                </div>

                <div>
                  <FieldLabel>Address</FieldLabel>
                  <FieldInput
                    value={form.address}
                    onChange={e => set('address', e.target.value)}
                    placeholder="Street, City"
                    icon={<MapPin size={14} />}
                  />
                </div>

                <div>
                  <FieldLabel>Phone Number <span style={{ color: 'var(--badge-red-text)' }}>*</span></FieldLabel>
                  <div style={{ display: 'flex' }}>
                    <CountryCodePicker
                      value={form.countryCode}
                      onChange={v => set('countryCode', v)}
                    />
                    <div style={{ flex: 1, position: 'relative' }}>
                      <Phone size={14} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }} />
                      <input
                        type="tel"
                        value={form.cellphone}
                        onChange={e => set('cellphone', e.target.value)}
                        placeholder="0977 000000"
                        style={{
                          width: '100%', height: 40, paddingLeft: 38, paddingRight: 12,
                          border: `1px solid ${errors.cellphone ? 'var(--badge-red-text)' : 'var(--border-input)'}`,
                          borderLeft: 'none', borderRadius: '0 8px 8px 0', fontSize: 13.5,
                          color: 'var(--text-heading)', outline: 'none', boxSizing: 'border-box',
                          background: 'var(--bg-input)',
                        }}
                      />
                    </div>
                  </div>
                  {errors.cellphone && <p style={{ fontSize: 11.5, color: 'var(--badge-red-text)', marginTop: 4 }}>{errors.cellphone}</p>}
                </div>

                {/* ── Login Info ─────────────────────────────────────────── */}
                <SectionHeader>Login Information</SectionHeader>

                <div>
                  <FieldLabel>Email Address <span style={{ color: 'var(--badge-red-text)' }}>*</span></FieldLabel>
                  <FieldInput
                    type="email"
                    value={form.email}
                    onChange={e => set('email', e.target.value)}
                    placeholder="you@ses.zm"
                    icon={<Mail size={14} />}
                    error={errors.email}
                  />
                </div>

                <div>
                  <FieldLabel>Username <span style={{ color: 'var(--badge-red-text)' }}>*</span></FieldLabel>
                  <div style={{ position: 'relative' }}>
                    <User size={14} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }} />
                    <input
                      value={form.username}
                      onChange={e => set('username', e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                      placeholder="john.doe"
                      style={{
                        width: '100%', height: 40, paddingLeft: 38, paddingRight: 36,
                        border: `1px solid ${errors.username || usernameStatus === 'taken' ? 'var(--badge-red-text)' : usernameStatus === 'available' ? 'var(--badge-green-text)' : 'var(--border-input)'}`,
                        borderRadius: 8, fontSize: 13.5, color: 'var(--text-heading)', outline: 'none', boxSizing: 'border-box',
                        background: 'var(--bg-input)',
                      }}
                    />
                    <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex' }}>
                      {usernameStatus === 'checking' && (
                        <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>…</span>
                      )}
                      {usernameStatus === 'available' && <Check size={15} color="var(--badge-green-text)" />}
                      {usernameStatus === 'taken' && <X size={15} color="var(--badge-red-text)" />}
                    </span>
                  </div>
                  {usernameStatus === 'available' && !errors.username && (
                    <p style={{ fontSize: 11.5, color: 'var(--badge-green-text)', marginTop: 4 }}>Username is available</p>
                  )}
                  {usernameStatus === 'taken' && (
                    <p style={{ fontSize: 11.5, color: 'var(--badge-red-text)', marginTop: 4 }}>Username is already taken</p>
                  )}
                  {errors.username && (
                    <p style={{ fontSize: 11.5, color: 'var(--badge-red-text)', marginTop: 4 }}>{errors.username}</p>
                  )}
                </div>

                <div>
                  <FieldLabel>Password <span style={{ color: 'var(--badge-red-text)' }}>*</span></FieldLabel>
                  <div style={{ position: 'relative' }}>
                    <Lock size={14} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }} />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={e => set('password', e.target.value)}
                      placeholder="••••••••"
                      style={{
                        width: '100%', height: 40, paddingLeft: 38, paddingRight: 40,
                        border: `1px solid ${errors.password ? 'var(--badge-red-text)' : 'var(--border-input)'}`,
                        borderRadius: 8, fontSize: 13.5, color: 'var(--text-heading)', outline: 'none', boxSizing: 'border-box',
                        background: 'var(--bg-input)',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(p => !p)}
                      style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'var(--text-subtle)', padding: 0 }}
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {errors.password && <p style={{ fontSize: 11.5, color: 'var(--badge-red-text)', marginTop: 4 }}>{errors.password}</p>}
                </div>

                <div>
                  <FieldLabel>Confirm Password <span style={{ color: 'var(--badge-red-text)' }}>*</span></FieldLabel>
                  <div style={{ position: 'relative' }}>
                    <Lock size={14} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }} />
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      value={form.confirmPassword}
                      onChange={e => set('confirmPassword', e.target.value)}
                      placeholder="••••••••"
                      style={{
                        width: '100%', height: 40, paddingLeft: 38, paddingRight: 40,
                        border: `1px solid ${errors.confirmPassword ? 'var(--badge-red-text)' : 'var(--border-input)'}`,
                        borderRadius: 8, fontSize: 13.5, color: 'var(--text-heading)', outline: 'none', boxSizing: 'border-box',
                        background: 'var(--bg-input)',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(p => !p)}
                      style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'var(--text-subtle)', padding: 0 }}
                    >
                      {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {errors.confirmPassword && <p style={{ fontSize: 11.5, color: 'var(--badge-red-text)', marginTop: 4 }}>{errors.confirmPassword}</p>}
                </div>

                <button
                  type="submit"
                  disabled={loading || usernameStatus === 'taken' || usernameStatus === 'checking'}
                  style={{
                    width: '100%', height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    gap: 8, background: loading ? 'var(--border-input)' : 'var(--ses-red)', color: loading ? 'var(--text-subtle)' : '#fff',
                    border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
                    marginTop: 4, transition: 'background 0.15s',
                  }}
                >
                  {loading ? 'Submitting…' : 'Submit Registration'}
                </button>

                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>Already have an account? </span>
                  <Link to="/login" style={{ fontSize: 12.5, color: 'var(--ses-red)', fontWeight: 600, textDecoration: 'none' }}>
                    Sign in here
                  </Link>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
