import { useEffect, useRef, useState, FormEvent, ReactNode } from 'react';
import api from '../api/client';
import { Patient } from '../types';
import { X, ChevronDown, Calendar } from 'lucide-react';

const COUNTRY_CODES = [
  ['+260', 'ZM'], ['+263', 'ZW'], ['+265', 'MW'], ['+258', 'MZ'], ['+255', 'TZ'], ['+243', 'CD'], ['+244', 'AO'],
  ['+267', 'BW'], ['+264', 'NA'], ['+27', 'ZA'], ['+254', 'KE'], ['+44', 'GB'], ['+1', 'US'],
];
// Mobile number length after the country code (no leading 0), and how to group it.
const PHONE_FORMAT: Record<string, { len: number; groups: number[] }> = {
  '+260': { len: 9, groups: [2, 3, 4] }, '+263': { len: 9, groups: [2, 3, 4] }, '+265': { len: 9, groups: [3, 3, 3] },
  '+258': { len: 9, groups: [2, 3, 4] }, '+255': { len: 9, groups: [3, 3, 3] }, '+243': { len: 9, groups: [3, 3, 3] },
  '+244': { len: 9, groups: [3, 3, 3] }, '+267': { len: 8, groups: [2, 3, 3] }, '+264': { len: 9, groups: [2, 3, 4] },
  '+27':  { len: 9, groups: [2, 3, 4] }, '+254': { len: 9, groups: [3, 3, 3] }, '+44':  { len: 10, groups: [4, 6] },
  '+1':   { len: 10, groups: [3, 3, 4] },
};
const phoneFmt = (cc: string) => PHONE_FORMAT[cc] ?? { len: 9, groups: [2, 3, 4] };

// Digits only, leading 0 dropped (local habit: "097…"), capped at the country's length, grouped with spaces.
function formatPhone(raw: string, cc: string) {
  const { len, groups } = phoneFmt(cc);
  let d = raw.replace(/\D/g, '');
  // A pasted "+260 97 123 4567" carries the country code; drop it.
  const ccDigits = cc.slice(1);
  if (d.length > len && d.startsWith(ccDigits)) d = d.slice(ccDigits.length);
  d = d.replace(/^0+/, '').slice(0, len);
  const out: string[] = [];
  let i = 0;
  for (const g of groups) { if (i >= d.length) break; out.push(d.slice(i, i + g)); i += g; }
  return out.join(' ');
}
function phonePlaceholder(cc: string) {
  return formatPhone('9'.repeat(phoneFmt(cc).len), cc).replace(/9/g, 'X').replace(/^X/, '9');
}
const phoneDigits = (v: string) => v.replace(/\D/g, '');

// Zambian NRC: 6 digits / 2 digits / 1 digit, slashes added as you type.
const NRC_RE = /^\d{6}\/\d{2}\/\d$/;
function formatNrc(raw: string) {
  const d = raw.replace(/\D/g, '').slice(0, 9);
  return [d.slice(0, 6), d.slice(6, 8), d.slice(8)].filter(Boolean).join('/');
}
const RELIGIONS = ['Christian', 'Muslim', 'Hindu', 'Traditional', 'Other', 'None', 'Prefer not to say'];
const RELATIONSHIPS = ['Spouse', 'Parent', 'Child', 'Sibling', 'Other'];

type Errors = Partial<Record<'firstName' | 'lastName' | 'dob' | 'gender' | 'phone' | 'email' | 'nationalId' | 'kinPhone' | 'form', string>>;

// "DD/MM/YYYY" as the user types; returns ISO date or null when not a real past date.
function formatDob(raw: string) {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join(' / ');
}
function parseDob(v: string): string | null {
  const m = v.replace(/\s/g, '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  if (date.getDate() !== Number(dd) || date.getMonth() !== Number(mm) - 1 || date > new Date() || Number(yyyy) < 1900) return null;
  return `${yyyy}-${mm}-${dd}`;
}
function fullPhone(cc: string, num: string) {
  const digits = num.replace(/\D/g, '').replace(/^0+/, '');
  return digits ? `${cc}${digits}` : '';
}
// Splits a stored "+260971234567" back into [country code, national number].
function splitPhone(stored?: string | null): [string, string] {
  const v = (stored ?? '').replace(/\s/g, '');
  const match = COUNTRY_CODES.map(([c]) => c).sort((a, b) => b.length - a.length).find((c) => v.startsWith(c));
  return match ? [match, v.slice(match.length)] : ['+260', v];
}
function isoToDob(iso?: string) {
  return iso ? formatDob(iso.slice(0, 10).split('-').reverse().join('')) : '';
}

// Registers a new client, or edits an existing one when `patient` is given.
export default function RegisterModal({ patient, initialName = '', onClose, onCreated }: {
  patient?: Patient;
  initialName?: string;
  onClose: () => void;
  onCreated: (p: Patient) => void;
}) {
  const parts = initialName.trim().split(/\s+/).filter(Boolean);
  const [phoneCc, phoneNum] = splitPhone(patient?.phone);
  const [kinCc, kinNum] = splitPhone(patient?.nextOfKinPhone);
  const [f, setF] = useState({
    firstName: patient?.firstName ?? parts[0] ?? '', lastName: patient?.lastName ?? parts.slice(1).join(' '),
    dob: isoToDob(patient?.dateOfBirth), gender: patient?.gender ?? '', religion: patient?.religion ?? '',
    phoneCc, phone: formatPhone(phoneNum, phoneCc), email: patient?.email ?? '',
    nationalId: patient?.nationalId ?? '', address: patient?.address ?? '',
    kinName: patient?.nextOfKinName ?? '', kinRel: patient?.nextOfKinRelationship ?? '', kinCc, kinPhone: formatPhone(kinNum, kinCc),
  });
  const editing = !!patient;
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    const raw = e.target.value;
    setF((p) => {
      switch (k) {
        case 'dob': return { ...p, dob: formatDob(raw) };
        case 'nationalId': return { ...p, nationalId: formatNrc(raw) };
        case 'phone': return { ...p, phone: formatPhone(raw, p.phoneCc) };
        case 'kinPhone': return { ...p, kinPhone: formatPhone(raw, p.kinCc) };
        // Switching country re-trims the number to the new country's length.
        case 'phoneCc': return { ...p, phoneCc: raw, phone: formatPhone(p.phone, raw) };
        case 'kinCc': return { ...p, kinCc: raw, kinPhone: formatPhone(p.kinPhone, raw) };
        default: return { ...p, [k]: raw };
      }
    });
    const errKey = k === 'phoneCc' ? 'phone' : k === 'kinCc' ? 'kinPhone' : k;
    setErrors((p) => ({ ...p, [errKey]: undefined, form: undefined }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const dob = parseDob(f.dob);
    const phone = fullPhone(f.phoneCc, f.phone);
    const kinPhone = fullPhone(f.kinCc, f.kinPhone);
    const next: Errors = {};
    if (!f.firstName.trim()) next.firstName = 'Enter a first name';
    if (!f.lastName.trim()) next.lastName = 'Enter a surname';
    if (!dob) next.dob = 'Enter a valid date as DD / MM / YYYY';
    if (!f.gender) next.gender = 'Select a gender';
    const phoneLen = phoneFmt(f.phoneCc).len;
    const kinLen = phoneFmt(f.kinCc).len;
    if (!phoneDigits(f.phone)) next.phone = 'Enter a phone number';
    else if (phoneDigits(f.phone).length !== phoneLen) next.phone = `Enter all ${phoneLen} digits, e.g. ${phonePlaceholder(f.phoneCc)}`;
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) next.email = 'Enter a valid email address';
    if (f.nationalId && !NRC_RE.test(f.nationalId)) next.nationalId = 'NRC must be 9 digits: 123456/78/9';
    if (phoneDigits(f.kinPhone) && phoneDigits(f.kinPhone).length !== kinLen) next.kinPhone = `Enter all ${kinLen} digits`;
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    // Blank optionals go as null so an edit can clear them (and a blank NRC never hits the unique index).
    const body = {
      firstName: f.firstName.trim(), lastName: f.lastName.trim(),
      dateOfBirth: dob, gender: f.gender, religion: f.religion || null,
      phone, email: f.email.trim() || null, nationalId: f.nationalId.trim() || null, address: f.address.trim() || null,
      nextOfKinName: f.kinName.trim() || null, nextOfKinRelationship: f.kinRel || null, nextOfKinPhone: kinPhone || null,
    };
    try {
      const { data } = editing
        ? await api.patch(`/patients/${patient!.id}`, body)
        : await api.post('/patients', { ...body, hivStatus: 'UNKNOWN' });
      onCreated(data);
    } catch (err: any) {
      const msg: string = err?.response?.data?.error ?? '';
      setErrors({
        form: /nationalId|Unique constraint/i.test(msg)
          ? 'A patient with this NRC number is already registered.'
          : err?.response?.status === 400 && msg
            ? msg
            : `Could not ${editing ? 'save the changes' : 'register the client'}. Please try again.`,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rg-scrim">
      <div role="dialog" aria-modal="true" aria-labelledby="rg-title" className="rg-card">
        <div className="rg-head">
          <div>
            <h2 id="rg-title" className="rg-title">{editing ? 'Edit client details' : 'Register new client'}</h2>
            <p className="rg-sub">Fields marked * are required.</p>
          </div>
          <button type="button" className="rg-x" aria-label="Close" onClick={onClose}><X size={18} strokeWidth={2} /></button>
        </div>

        <form id="rg-form" onSubmit={submit} noValidate className="rg-body">
          <p className="rg-sec">Personal details</p>
          <div className="rg-grid" style={{ marginBottom: 26 }}>
            <Field cls="s3" id="rg-fn" label="First name" required error={errors.firstName}>
              <input id="rg-fn" className="rg-f" autoComplete="given-name" value={f.firstName} onChange={set('firstName')} autoFocus />
            </Field>
            <Field cls="s3" id="rg-sn" label="Surname" required error={errors.lastName}>
              <input id="rg-sn" className="rg-f" autoComplete="family-name" value={f.lastName} onChange={set('lastName')} />
            </Field>
            <Field cls="s2" id="rg-dob" label="Date of birth" required error={errors.dob}>
              <DobInput value={f.dob} onChange={set('dob')} />
            </Field>
            <Field cls="s2" id="rg-sex" label="Gender" required error={errors.gender}>
              <Select id="rg-sex" value={f.gender} onChange={set('gender')}>
                <option value="">Select</option><option value="MALE">Male</option><option value="FEMALE">Female</option>
                {f.gender === 'OTHER' && <option value="OTHER">Other</option>}
              </Select>
            </Field>
            <Field cls="s2" id="rg-rel" label="Religion" optional>
              <Select id="rg-rel" value={f.religion} onChange={set('religion')}>
                <option value="">Select</option>{RELIGIONS.map((r) => <option key={r}>{r}</option>)}
              </Select>
            </Field>
          </div>

          <p className="rg-sec">Contact &amp; identification</p>
          <div className="rg-grid" style={{ marginBottom: 26 }}>
            <Field cls="s3" id="rg-ph" label="Cell phone" required error={errors.phone}>
              <Phone id="rg-ph" cc={f.phoneCc} onCc={set('phoneCc')} value={f.phone} onChange={set('phone')} />
            </Field>
            <Field cls="s3" id="rg-em" label="Email" optional error={errors.email}>
              <input id="rg-em" className="rg-f" type="email" autoComplete="email" placeholder="name@example.com" value={f.email} onChange={set('email')} />
            </Field>
            <Field cls="s2" id="rg-nrc" label="NRC number" optional error={errors.nationalId}>
              <input id="rg-nrc" className="rg-f" inputMode="numeric" maxLength={11} placeholder="123456/78/9" value={f.nationalId} onChange={set('nationalId')} />
            </Field>
            <Field cls="s4" id="rg-ad" label="Address" optional>
              <input id="rg-ad" className="rg-f" autoComplete="street-address" placeholder="Physical address" value={f.address} onChange={set('address')} />
            </Field>
          </div>

          <p className="rg-sec">Next of kin <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· optional</span></p>
          <div className="rg-grid" style={{ marginBottom: 24 }}>
            <Field cls="s2" id="rg-kn" label="Full name">
              <input id="rg-kn" className="rg-f" value={f.kinName} onChange={set('kinName')} />
            </Field>
            <Field cls="s2" id="rg-kr" label="Relationship">
              <Select id="rg-kr" value={f.kinRel} onChange={set('kinRel')}>
                <option value="">Select</option>{RELATIONSHIPS.map((r) => <option key={r}>{r}</option>)}
              </Select>
            </Field>
            <Field cls="s2" id="rg-kp" label="Phone" error={errors.kinPhone}>
              <Phone id="rg-kp" cc={f.kinCc} onCc={set('kinCc')} value={f.kinPhone} onChange={set('kinPhone')} />
            </Field>
          </div>

          {errors.form && <p role="alert" className="rg-alert">{errors.form}</p>}
        </form>

        <div className="rg-foot">
          <button type="button" className="rg-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="rg-form" className="rg-pri" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Register & open profile'}</button>
        </div>
      </div>

      <style>{CSS}</style>
    </div>
  );
}

function Field({ cls, id, label, required, optional, error, children }: {
  cls: string; id: string; label: string; required?: boolean; optional?: boolean; error?: string; children: ReactNode;
}) {
  return (
    <div className={`${cls}${error ? ' rg-err' : ''}`}>
      <label className="rg-l" htmlFor={id}>
        <span>{label}{required && <> <span className="rg-req">*</span></>}</span>
        {optional && <small>Optional</small>}
      </label>
      {children}
      {error && <p className="rg-msg">{error}</p>}
    </div>
  );
}

// Typed DD / MM / YYYY plus a calendar button backed by the native date picker.
function DobInput({ value, onChange }: { value: string; onChange: (e: { target: { value: string } }) => void }) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const iso = parseDob(value) ?? '';
  function openPicker() {
    const el = pickerRef.current;
    if (!el) return;
    try { el.showPicker(); } catch { el.focus(); el.click(); }
  }
  return (
    <div style={{ position: 'relative' }}>
      <input id="rg-dob" className="rg-f" inputMode="numeric" placeholder="DD / MM / YYYY" value={value} onChange={onChange} style={{ paddingRight: 44 }} />
      <button type="button" className="rg-cal" aria-label="Open calendar" onClick={openPicker}><Calendar size={17} /></button>
      <input
        ref={pickerRef} type="date" tabIndex={-1} aria-hidden="true" className="rg-native-date"
        max={new Date().toISOString().slice(0, 10)} min="1900-01-01" value={iso}
        onChange={(e) => onChange({ target: { value: e.target.value ? e.target.value.split('-').reverse().join('') : '' } })}
      />
    </div>
  );
}

function Select({ id, value, onChange, children }: { id: string; value: string; onChange: (e: { target: { value: string } }) => void; children: ReactNode }) {
  return (
    <div style={{ position: 'relative' }}>
      <select id={id} className="rg-f" value={value} onChange={onChange}>{children}</select>
      <ChevronDown size={16} className="rg-chev" style={{ right: 14, top: 14 }} />
    </div>
  );
}

function Phone({ id, cc, onCc, value, onChange }: {
  id: string; cc: string; onCc: (e: { target: { value: string } }) => void; value: string; onChange: (e: { target: { value: string } }) => void;
}) {
  return (
    <div className="rg-phone">
      <label htmlFor={`${id}-cc`} className="sr-only">Country code</label>
      <select id={`${id}-cc`} value={cc} onChange={onCc}>
        {COUNTRY_CODES.map(([code, iso]) => <option key={code} value={code}>{iso} {code}</option>)}
      </select>
      <ChevronDown size={14} className="rg-chev" style={{ left: 82, top: 15 }} />
      <input id={id} type="tel" inputMode="numeric" autoComplete="tel-national" placeholder={phonePlaceholder(cc)} value={value} onChange={onChange} />
    </div>
  );
}

const CSS = `
.rg-scrim { --rg-scrim: rgba(40,44,49,.62); --rg-head-bg: var(--bg-card); --rg-head-text: var(--text-heading); --rg-head-muted: var(--text-muted);
  --rg-head-line: var(--border); --rg-field: #FFFFFF; --rg-field-line: #D5D9DE; --rg-label: #2A2E32; --rg-faint: #6B7178;
  --rg-x-hover: #F0F2F4; --rg-foot: #FAFBFC; --rg-shadow: 0 24px 64px rgba(16,24,40,.28);
  position: fixed; inset: 0; z-index: 80; background: var(--rg-scrim); display: flex; align-items: center; justify-content: center;
  padding: 32px 16px; overflow-y: auto; font-family: var(--font-body); color: var(--text-heading); }
[data-theme="dark"] .rg-scrim { --rg-scrim: rgba(11,12,14,.8); --rg-head-bg: #181B1E; --rg-head-line: #262A2E; --rg-field: #1F2326; --rg-field-line: #33383D;
  --rg-label: #E4E6E8; --rg-faint: #8A9197; --rg-x-hover: rgba(255,255,255,.08); --rg-foot: #15181A; --rg-shadow: 0 24px 64px rgba(0,0,0,.6); }
[data-skin="blue"] .rg-scrim { --rg-head-bg: #1F5F96; --rg-head-text: #FFFFFF; --rg-head-muted: #CFE0F0; --rg-head-line: #1F5F96; --rg-x-hover: rgba(255,255,255,.14); }
.rg-card { width: 100%; max-width: 760px; margin: auto; background: var(--bg-card); border-radius: 18px; box-shadow: var(--rg-shadow); overflow: hidden; }
.rg-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 22px 28px 18px; background: var(--rg-head-bg); border-bottom: 1px solid var(--rg-head-line); }
.rg-title { margin: 0 0 4px; font-family: var(--font-heading); font-size: 19px; font-weight: 700; color: var(--rg-head-text); }
.rg-sub { margin: 0; font-size: 13px; color: var(--rg-head-muted); }
.rg-x { width: 36px; height: 36px; margin: -4px -8px 0 0; border: 0; border-radius: 8px; background: transparent; color: var(--rg-head-text); display: flex; align-items: center; justify-content: center; cursor: pointer; }
.rg-x:hover { background: var(--rg-x-hover); }
.rg-body { padding: 24px 28px 8px; }
.rg-sec { margin: 0 0 14px; font-size: 11px; font-weight: 700; letter-spacing: 1.4px; text-transform: uppercase; color: var(--rg-faint); }
.rg-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 14px 16px; }
.rg-grid .s2 { grid-column: span 2; } .rg-grid .s3 { grid-column: span 3; } .rg-grid .s4 { grid-column: span 4; }
.rg-l { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; font-weight: 600; color: var(--rg-label); margin-bottom: 6px; }
.rg-l small { font-size: 12px; font-weight: 400; color: var(--rg-faint); }
.rg-req { color: var(--text-muted); font-weight: 600; }
.rg-f { width: 100%; height: 44px; padding: 0 14px; border: 1px solid var(--rg-field-line); border-radius: 10px; background: var(--rg-field);
  font: inherit; font-size: 14px; color: var(--text-heading); outline: 0; appearance: none; -webkit-appearance: none; transition: border-color .15s, box-shadow .15s; }
.rg-f::placeholder, .rg-phone input::placeholder { color: var(--rg-faint); }
.rg-f:focus { border-color: var(--ring); box-shadow: 0 0 0 4px var(--ring-glow); }
select.rg-f { padding-right: 38px; cursor: pointer; }
.rg-cal { position: absolute; right: 4px; top: 4px; width: 36px; height: 36px; border: 0; border-radius: 8px; background: transparent;
  color: var(--rg-faint); display: flex; align-items: center; justify-content: center; cursor: pointer; }
.rg-cal:hover { background: var(--rg-x-hover); color: var(--text-heading); }
.rg-native-date { position: absolute; right: 0; bottom: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; border: 0; padding: 0; }
.rg-chev { position: absolute; pointer-events: none; color: var(--rg-faint); }
.rg-phone { position: relative; display: flex; align-items: stretch; height: 44px; border: 1px solid var(--rg-field-line); border-radius: 10px; background: var(--rg-field); overflow: hidden; }
.rg-phone:focus-within { border-color: var(--ring); box-shadow: 0 0 0 4px var(--ring-glow); }
.rg-phone select { flex: none; width: 104px; padding: 0 26px 0 14px; border: 0; border-right: 1px solid var(--rg-field-line); background: transparent;
  font: inherit; font-size: 14px; color: var(--text-heading); outline: 0; appearance: none; -webkit-appearance: none; cursor: pointer; }
.rg-phone input { flex: 1; min-width: 0; padding: 0 14px; border: 0; background: transparent; font: inherit; font-size: 14px; color: var(--text-heading); outline: 0; }
.rg-phone option, .rg-f option { color: #16181A; background: #fff; }
.rg-err .rg-f, .rg-err .rg-phone { border-color: #E5484D; }
.rg-msg { margin: 6px 0 0; font-size: 12px; color: #E5484D; }
.rg-alert { margin: 0 0 16px; padding: 10px 14px; border-radius: 10px; background: var(--chip-red-bg); color: var(--chip-red-text); font-size: 13px; font-weight: 600; }
.rg-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 28px; background: var(--rg-foot); border-top: 1px solid var(--border); }
.rg-ghost { height: 44px; padding: 0 18px; border: 1px solid var(--rg-field-line); border-radius: 10px; background: transparent; color: var(--text-heading); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.rg-ghost:hover { background: var(--rg-x-hover); }
.rg-pri { height: 44px; padding: 0 20px; border: 0; border-radius: 10px; background: #C41E25; color: #fff; font-family: var(--font-heading); font-size: 14px; font-weight: 700; cursor: pointer; }
.rg-pri:hover:not(:disabled) { filter: brightness(1.06); }
.rg-pri:disabled { opacity: .7; cursor: default; }
@media (max-width: 700px) {
  .rg-grid .s2, .rg-grid .s3, .rg-grid .s4 { grid-column: span 6; }
  .rg-head, .rg-body, .rg-foot { padding-left: 18px; padding-right: 18px; }
}
`;
