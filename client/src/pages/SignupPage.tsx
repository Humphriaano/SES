import { useState, useEffect, useRef, useCallback, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import AuthLayout from '../components/auth/AuthLayout';
import { formatRegistrationPhone, maxPhoneDigits, normalizeRegistrationPhone, validateRegistrationPhone } from '../lib/registrationPhone';
import {
  Eye, EyeOff, ChevronDown, Check, X, AlertCircle, CheckCircle,
} from 'lucide-react';

// ── Data ──────────────────────────────────────────────────────────────────────

const DESIGNATIONS = [
  'Medical Doctor',
  'Surgeon',
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
  'Billing Clerk',
  'Cashier',
  'Billing Officer',
  'Accounts Assistant',
  'Accountant',
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

const registrationFieldStyle: React.CSSProperties = {
  width: '100%', minWidth: 0, height: 44, padding: '0 14px',
  border: '1px solid var(--border)', borderRadius: 14,
  background: 'var(--bg-surface)', color: 'var(--text-heading)',
  font: 'inherit', fontSize: 14, fontWeight: 400,
  outline: 'none', boxSizing: 'border-box',
};

function SearchableSelect({
  id, value, onChange, options, error,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
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
        id={id}
        type="button"
        aria-expanded={open}
        onClick={() => { setOpen(o => !o); setSearch(''); }}
        style={{
          ...registrationFieldStyle,
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderColor: error ? 'var(--badge-red-text)' : 'var(--border)',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value}
        </span>
        <ChevronDown size={14} color="var(--text-subtle)" style={{ flexShrink: 0, marginLeft: 4 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: 'var(--bg-card)', border: '1px solid var(--border-input)', borderRadius: 22,
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
                borderRadius: 14, fontSize: 13, outline: 'none', boxSizing: 'border-box',
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
        aria-label="Country code"
        onClick={() => { setOpen(o => !o); setSearch(''); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '0 10px',
          height: 42, border: 0, borderRight: '1px solid var(--border)', borderRadius: '14px 0 0 14px',
          background: 'transparent', cursor: 'pointer', fontSize: 14, whiteSpace: 'nowrap',
        }}
      >
        <span>{selected.flag}</span>
        <span style={{ color: 'var(--text-body)', fontWeight: 500 }}>{selected.code}</span>
        <ChevronDown size={12} color="var(--text-subtle)" />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 100, width: 220,
          background: 'var(--bg-card)', border: '1px solid var(--border-input)', borderRadius: 22,
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
                borderRadius: 14, fontSize: 13, outline: 'none', boxSizing: 'border-box',
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

function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 6 }}>
      {children}
    </label>
  );
}

function FieldInput({ error, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { error?: string }) {
  return (
    <div>
      <div style={{ position: 'relative' }}>
        <input
          {...props}
          style={{
            ...registrationFieldStyle,
            borderColor: error ? 'var(--badge-red-text)' : 'var(--border)',
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
      fontSize: 11, fontWeight: 500, color: 'var(--text-subtle)', textTransform: 'uppercase',
      letterSpacing: '0.07em', marginBottom: 14, paddingBottom: 8,
      borderBottom: '1px solid var(--border-light)',
    }}>
      {children}
    </div>
  );
}

const NRC_RE = /^\d{6}\/\d{2}\/\d$/;

function formatNrc(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 9);
  return [digits.slice(0, 6), digits.slice(6, 8), digits.slice(8)].filter(Boolean).join('/');
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
    else if (!form.hasNoNrc && !NRC_RE.test(form.nrc)) e.nrc = 'NRC must be 9 digits: 123456/78/9';
    const phone = validateRegistrationPhone(form.countryCode, form.cellphone);
    if (phone.error) e.cellphone = phone.error;
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
        cellphone: normalizeRegistrationPhone(form.cellphone, form.countryCode),
        email: form.email.trim().toLowerCase(),
        username: form.username.trim().toLowerCase(),
        password: form.password,
      });
      setSubmitted(true);
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.field === 'email') setErrors(prev => ({ ...prev, email: data.error }));
      else if (data?.field === 'nrc') setErrors(prev => ({ ...prev, nrc: data.error }));
      else if (data?.field === 'cellphone' || data?.field === 'countryCode') setErrors(prev => ({ ...prev, cellphone: data.error }));
      else if (data?.field === 'username') setErrors(prev => ({ ...prev, username: data.error }));
      else setErrors(prev => ({ ...prev, _global: data?.error ?? 'Registration failed. Please try again.' }));
    } finally {
      setLoading(false);
    }
  }

  // ── Layout shell ─────────────────────────────────────────────────────────────

  return (
    <AuthLayout wide>
          {submitted ? (
            // ── Success state ──────────────────────────────────────────────
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, textAlign: 'center' }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%', background: 'var(--badge-green-bg)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20,
              }}>
                <CheckCircle size={32} color="#16a34a" />
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-heading)', marginBottom: 10 }}>
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
                  padding: '10px 24px', background: 'var(--btn-accent)', color: '#fff',
                  borderRadius: 12, fontSize: 13.5, fontWeight: 500, textDecoration: 'none',
                }}
              >
                Back to Login
              </Link>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 28 }}>
                <h2 className="sl-form-title">Create account</h2>
                <p className="sl-form-intro">Request a staff account. An administrator will review your details before granting access.</p>
              </div>

              {errors._global && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                  background: 'var(--badge-red-bg)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 20,
                  fontSize: 13, color: 'var(--badge-red-text)',
                }}>
                  <AlertCircle size={15} style={{ flexShrink: 0 }} />
                  {errors._global}
                </div>
              )}

              <form onSubmit={handleSubmit} className="sl-signup">

                {/* ── Personal Info ──────────────────────────────────────── */}
                <SectionHeader>Personal Information</SectionHeader>

                <div className="sl-signup-grid">
                  <div>
                    <FieldLabel htmlFor="signup-first-name">First Name <span style={{ color: 'var(--badge-red-text)' }}>*</span></FieldLabel>
                    <FieldInput
                      id="signup-first-name"
                      value={form.firstName}
                      onChange={e => set('firstName', e.target.value)}
                      error={errors.firstName}
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor="signup-surname">Surname <span style={{ color: 'var(--badge-red-text)' }}>*</span></FieldLabel>
                    <FieldInput
                      id="signup-surname"
                      value={form.surname}
                      onChange={e => set('surname', e.target.value)}
                      error={errors.surname}
                    />
                  </div>
                </div>

                <div className="sl-signup-grid">
                  <div>
                    <FieldLabel htmlFor="signup-dob">Date of Birth <span style={{ color: 'var(--badge-red-text)' }}>*</span></FieldLabel>
                    <FieldInput
                      type="date"
                      id="signup-dob"
                      value={form.dateOfBirth}
                      onChange={e => set('dateOfBirth', e.target.value)}
                      max={new Date().toISOString().split('T')[0]}
                      error={errors.dateOfBirth}
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor="signup-sex">Sex <span style={{ color: 'var(--badge-red-text)' }}>*</span></FieldLabel>
                    <select
                      id="signup-sex"
                      value={form.sex}
                      onChange={e => set('sex', e.target.value)}
                      style={{
                        ...registrationFieldStyle,
                        borderColor: errors.sex ? 'var(--badge-red-text)' : 'var(--border)',
                        cursor: 'pointer',
                      }}
                    >
                      <option value="" />
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                    </select>
                    {errors.sex && <p style={{ fontSize: 11.5, color: 'var(--badge-red-text)', marginTop: 4 }}>{errors.sex}</p>}
                  </div>
                </div>

                <div>
                  <FieldLabel htmlFor="signup-designation">Designation <span style={{ color: 'var(--badge-red-text)' }}>*</span></FieldLabel>
                  <SearchableSelect
                    id="signup-designation"
                    value={form.designation}
                    onChange={v => set('designation', v)}
                    options={DESIGNATIONS}
                    error={errors.designation}
                  />
                </div>

                {/* ── Contact Info ───────────────────────────────────────── */}
                <SectionHeader>Contact Information</SectionHeader>

                <div>
                  <FieldLabel htmlFor="signup-nrc">NRC Number</FieldLabel>
                  <FieldInput
                    id="signup-nrc"
                    value={form.nrc}
                    onChange={e => set('nrc', formatNrc(e.target.value))}
                    inputMode="numeric"
                    maxLength={11}
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
                  <FieldLabel htmlFor="signup-address">Address</FieldLabel>
                  <FieldInput
                    id="signup-address"
                    value={form.address}
                    onChange={e => set('address', e.target.value)}
                  />
                </div>

                <div>
                  <FieldLabel htmlFor="signup-phone">Phone Number <span style={{ color: 'var(--badge-red-text)' }}>*</span></FieldLabel>
                  <div className="su-phone" style={{ ...registrationFieldStyle, padding: 0, display: 'flex', borderColor: errors.cellphone ? 'var(--badge-red-text)' : 'var(--border)' }}>
                    <CountryCodePicker
                      value={form.countryCode}
                      onChange={v => { set('countryCode', v); set('cellphone', formatRegistrationPhone(form.cellphone, v)); }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <input
                        type="tel"
                        id="signup-phone"
                        value={form.cellphone}
                        inputMode="numeric"
                        maxLength={maxPhoneDigits(form.countryCode)}
                        autoComplete="tel-national"
                        onChange={e => set('cellphone', formatRegistrationPhone(e.target.value, form.countryCode))}
                        onPaste={e => {
                          e.preventDefault();
                          const input = e.currentTarget;
                          const start = input.selectionStart ?? input.value.length;
                          const end = input.selectionEnd ?? input.value.length;
                          const pasted = input.value.slice(0, start) + e.clipboardData.getData('text') + input.value.slice(end);
                          set('cellphone', formatRegistrationPhone(pasted, form.countryCode));
                        }}
                        style={{
                          ...registrationFieldStyle, height: 42, border: 0,
                          borderRadius: '0 14px 14px 0', background: 'transparent',
                        }}
                      />
                    </div>
                  </div>
                  {errors.cellphone && <p style={{ fontSize: 11.5, color: 'var(--badge-red-text)', marginTop: 4 }}>{errors.cellphone}</p>}
                </div>

                {/* ── Login Info ─────────────────────────────────────────── */}
                <SectionHeader>Login Information</SectionHeader>

                <div>
                  <FieldLabel htmlFor="signup-email">Email Address <span style={{ color: 'var(--badge-red-text)' }}>*</span></FieldLabel>
                  <FieldInput
                    type="email"
                    id="signup-email"
                    value={form.email}
                    onChange={e => set('email', e.target.value)}
                    error={errors.email}
                  />
                </div>

                <div>
                  <FieldLabel htmlFor="signup-username">Username <span style={{ color: 'var(--badge-red-text)' }}>*</span></FieldLabel>
                  <div style={{ position: 'relative' }}>
                    <input
                      id="signup-username"
                      value={form.username}
                      onChange={e => set('username', e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                      style={{
                        ...registrationFieldStyle, paddingRight: 40,
                        borderColor: errors.username || usernameStatus === 'taken' ? 'var(--badge-red-text)' : usernameStatus === 'available' ? 'var(--badge-green-text)' : 'var(--border)',
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
                  <FieldLabel htmlFor="signup-password">Password <span style={{ color: 'var(--badge-red-text)' }}>*</span></FieldLabel>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      id="signup-password"
                      value={form.password}
                      onChange={e => set('password', e.target.value)}
                      style={{
                        ...registrationFieldStyle, paddingRight: 46,
                        borderColor: errors.password ? 'var(--badge-red-text)' : 'var(--border)',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(p => !p)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="sl-eye"
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {errors.password && <p style={{ fontSize: 11.5, color: 'var(--badge-red-text)', marginTop: 4 }}>{errors.password}</p>}
                </div>

                <div>
                  <FieldLabel htmlFor="signup-confirm-password">Confirm Password <span style={{ color: 'var(--badge-red-text)' }}>*</span></FieldLabel>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      id="signup-confirm-password"
                      value={form.confirmPassword}
                      onChange={e => set('confirmPassword', e.target.value)}
                      style={{
                        ...registrationFieldStyle, paddingRight: 46,
                        borderColor: errors.confirmPassword ? 'var(--badge-red-text)' : 'var(--border)',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(p => !p)}
                      aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
                      className="sl-eye"
                    >
                      {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {errors.confirmPassword && <p style={{ fontSize: 11.5, color: 'var(--badge-red-text)', marginTop: 4 }}>{errors.confirmPassword}</p>}
                </div>

                <button
                  type="submit"
                  disabled={loading || usernameStatus === 'taken' || usernameStatus === 'checking'}
                  className="sl-btn"
                >
                  {loading ? 'Submitting…' : 'Submit Registration'}
                </button>

                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>Already have an account? </span>
                  <Link to="/login" style={{ fontSize: 12.5, color: 'var(--link)', fontWeight: 500, textDecoration: 'none' }}>
                    Sign in here
                  </Link>
                </div>
              </form>
            </>
          )}
    </AuthLayout>
  );
}
