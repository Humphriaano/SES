import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { Patient } from '../types';
import { usePatient } from '../context/PatientContext';
import { useWindowSize } from '../hooks/useWindowSize';
import {
  Search, UserPlus, Users, DoorOpen,
  X, ChevronRight, Clock, UserCheck, Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface FacilityRoom { id: string; name: string; tag: string; active: boolean; waitingCount: number; }

export default function DashboardPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Patient[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [rooms, setRooms] = useState<FacilityRoom[]>([]);
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const { setActivePatient, setActiveEncounterId } = usePatient();
  const { isMobile } = useWindowSize();
  const navigate = useNavigate();
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadRooms();
    const interval = setInterval(loadRooms, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (query.length < 3) {
      setResults([]);
      setSearched(false);
      setShowDropdown(false);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await api.get('/patients', { params: { search: query } });
        setResults(data);
        setSearched(true);
        setShowDropdown(true);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  async function loadRooms() {
    try {
      const { data } = await api.get('/queue/rooms');
      setRooms(data);
    } catch {}
  }

  function openPatient(p: Patient) {
    setActivePatient(p);
    setActiveEncounterId(null);
    setQuery('');
    setShowDropdown(false);
    navigate(`/patient/${p.id}/vitals`);
  }

  function calcAge(dob: string) {
    return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000));
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)' }}>
      {/* Hero search area */}
      <div style={{
        background: 'linear-gradient(135deg, #1a1f2e 0%, #2d1a1a 100%)',
        padding: isMobile ? '28px 16px 56px' : '48px 24px 80px',
        textAlign: 'center',
      }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#fff', marginBottom: 6, letterSpacing: '-0.3px' }}>
          SES — Chronic Disease Management
        </h1>
        <p style={{ fontSize: 14, color: '#94a3b8', marginBottom: 32 }}>
          Search for a patient or register a new client below
        </p>

        {/* Search bar */}
        <div ref={searchRef} style={{ position: 'relative', maxWidth: 580, margin: '0 auto' }}>
          <div style={{
            display: 'flex', alignItems: 'center',
            background: 'var(--bg-card)', borderRadius: 14,
            boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
            border: '2px solid transparent',
            transition: 'border-color 0.15s, background-color 0.2s',
          }}>
            {searching
              ? <Loader2 size={18} style={{ margin: '0 14px', color: 'var(--text-subtle)', flexShrink: 0, animation: 'spin 1s linear infinite' }} />
              : <Search size={18} style={{ margin: '0 14px', color: 'var(--text-subtle)', flexShrink: 0 }} />
            }
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, NRC number, or cell phone…"
              style={{
                flex: 1, border: 'none', outline: 'none', padding: '15px 0',
                fontSize: 15, color: 'var(--text-heading)', background: 'transparent',
              }}
              autoFocus
            />
            {query && (
              <button onClick={() => { setQuery(''); setResults([]); setSearched(false); setShowDropdown(false); }}
                style={{ padding: '0 14px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)' }}>
                <X size={16} />
              </button>
            )}
          </div>

          {query.length > 0 && query.length < 3 && (
            <p style={{ color: '#94a3b8', fontSize: 12, marginTop: 8 }}>
              Type {3 - query.length} more character{3 - query.length !== 1 ? 's' : ''} to search…
            </p>
          )}

          {/* Dropdown results */}
          {showDropdown && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0,
              background: 'var(--bg-card)', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
              border: '1px solid var(--border)', overflow: 'hidden', zIndex: 50,
              maxHeight: 360, overflowY: 'auto',
            }}>
              {results.length > 0 ? (
                <>
                  <div style={{ padding: '8px 14px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-light)' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {results.length} patient{results.length !== 1 ? 's' : ''} found
                    </span>
                  </div>
                  {results.map((p) => (
                    <button key={p.id} onClick={() => openPatient(p)}
                      style={{
                        width: '100%', textAlign: 'left', padding: '12px 16px',
                        display: 'flex', alignItems: 'center', gap: 12,
                        background: 'none', border: 'none', borderBottom: '1px solid var(--border-light)',
                        cursor: 'pointer', transition: 'background 0.1s', color: 'inherit',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--chip-red-bg)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                    >
                      <div style={{
                        width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                        background: `hsl(${(p.firstName.charCodeAt(0) * 13) % 360}, 55%, 88%)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700,
                        color: `hsl(${(p.firstName.charCodeAt(0) * 13) % 360}, 55%, 36%)`,
                      }}>
                        {p.firstName.charAt(0)}{p.lastName.charAt(0)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-heading)' }}>
                          {p.firstName} {p.lastName}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2, display: 'flex', gap: 12 }}>
                          {p.nationalId && <span>NRC: {p.nationalId}</span>}
                          {p.phone && <span>{p.phone}</span>}
                          <span>{calcAge(p.dateOfBirth)} yrs · {p.gender}</span>
                        </div>
                      </div>
                      <ChevronRight size={16} color="#c8102e" />
                    </button>
                  ))}
                </>
              ) : searched && (
                <div style={{ padding: '24px 20px', textAlign: 'center' }}>
                  <p style={{ fontWeight: 600, color: 'var(--text-body)', marginBottom: 4 }}>No patient found</p>
                  <p style={{ fontSize: 13, color: 'var(--text-subtle)', marginBottom: 16 }}>
                    No results for "{query}" — would you like to register a new client?
                  </p>
                  <button
                    onClick={() => { setShowDropdown(false); setShowRegisterForm(true); }}
                    className="btn-primary" style={{ margin: '0 auto' }}
                  >
                    <UserPlus size={14} /> Register New Client
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {!showDropdown && (
          <button
            onClick={() => setShowRegisterForm(true)}
            style={{
              marginTop: 20, display: 'inline-flex', alignItems: 'center', gap: 7,
              background: 'rgba(255,255,255,0.1)', color: '#e2e8f0',
              border: '1px solid rgba(255,255,255,0.2)', borderRadius: 9,
              padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
          >
            <UserPlus size={14} /> Register New Client
          </button>
        )}
      </div>

      {/* Service Point cards — grouped by tag */}
      <div style={{ maxWidth: 960, margin: isMobile ? '-32px auto 0' : '-40px auto 0', padding: isMobile ? '0 14px 32px' : '0 24px 40px' }}>
        {rooms.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 24px', background: 'var(--bg-card)', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', border: '1px dashed var(--border)' }}>
            <DoorOpen size={32} color="var(--text-subtle)" style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-heading)', marginBottom: 6 }}>No service points configured</div>
            <div style={{ fontSize: 13, color: 'var(--text-subtle)' }}>Go to Admin → Rooms to set up your facility's service points.</div>
          </div>
        ) : (
          <>
            {/* Group rooms by tag */}
            {Object.entries(
              rooms.reduce<Record<string, FacilityRoom[]>>((acc, r) => {
                (acc[r.tag] = acc[r.tag] ?? []).push(r);
                return acc;
              }, {})
            ).sort(([a], [b]) => a.localeCompare(b)).map(([tag, tagRooms], tagIdx) => (
              <div key={tag} style={{ marginBottom: 28 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <h2 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
                    {tag}
                  </h2>
                  {tagIdx === 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-subtle)' }}>
                      <Clock size={12} /> Live · updates every 15s
                    </div>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(200px, 1fr))', gap: isMobile ? 10 : 14 }}>
                  {tagRooms.map(room => (
                    <div key={room.id} className="card" style={{ padding: '18px 20px', cursor: 'default', transition: 'box-shadow 0.15s' }}
                      onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)')}
                      onMouseLeave={e => (e.currentTarget.style.boxShadow = '')}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                        <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--chip-red-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <DoorOpen size={18} color="#c8102e" />
                        </div>
                        <div style={{
                          minWidth: 34, height: 34, borderRadius: 9, padding: '0 8px',
                          background: room.waitingCount > 0 ? '#c8102e' : 'var(--bg-surface-2)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          boxShadow: room.waitingCount > 0 ? '0 2px 8px rgba(200,16,46,0.35)' : 'none',
                        }}>
                          <span style={{ fontSize: 18, fontWeight: 800, color: room.waitingCount > 0 ? '#fff' : 'var(--text-subtle)', lineHeight: 1 }}>
                            {room.waitingCount}
                          </span>
                        </div>
                      </div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-heading)', marginBottom: 3 }}>{room.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                        {room.waitingCount === 0 ? 'No patients waiting' : `${room.waitingCount} patient${room.waitingCount !== 1 ? 's' : ''} waiting`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <button onClick={() => navigate('/patients')} className="btn-ghost" style={{ fontSize: 13 }}>
            <Users size={14} /> View all patients
          </button>
        </div>
      </div>

      {showRegisterForm && (
        <RegisterModal
          initialName={query}
          onClose={() => setShowRegisterForm(false)}
          onCreated={(p) => {
            toast.success(`${p.firstName} ${p.lastName} registered`);
            setShowRegisterForm(false);
            openPatient(p);
          }}
        />
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function RegisterModal({ initialName, onClose, onCreated }: {
  initialName: string;
  onClose: () => void;
  onCreated: (p: Patient) => void;
}) {
  const parts = initialName.trim().split(' ');
  const [form, setForm] = useState({
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
    nationalId: '', phone: '', dateOfBirth: '',
    gender: 'MALE', address: '',
  });
  const [loading, setLoading] = useState(false);

  function set(f: string, v: string) { setForm((p) => ({ ...p, [f]: v })); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/patients', { ...form, hivStatus: 'UNKNOWN' });
      onCreated(data);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--modal-overlay)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 50, backdropFilter: 'blur(3px)',
    }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 16, width: '100%', maxWidth: 'min(520px, calc(100vw - 24px))', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden', margin: '0 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--border-light)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--chip-red-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <UserCheck size={16} color="#c8102e" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-heading)' }}>Register New Client</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>All fields marked * are required</div>
            </div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={14} />
          </button>
        </div>

        <form onSubmit={submit} style={{ padding: '20px 22px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: window.innerWidth < 480 ? '1fr' : '1fr 1fr', gap: 13 }}>
            <RField label="First Name *">
              <input required className="field-input" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} placeholder="e.g. John" />
            </RField>
            <RField label="Surname *">
              <input required className="field-input" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} placeholder="e.g. Banda" />
            </RField>
            <RField label="NRC Number">
              <input className="field-input" value={form.nationalId} onChange={(e) => set('nationalId', e.target.value)} placeholder="123456/78/9" />
            </RField>
            <RField label="Cell Phone">
              <input className="field-input" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+260 9X XXX XXXX" />
            </RField>
            <RField label="Date of Birth *">
              <input required type="date" className="field-input" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
            </RField>
            <RField label="Gender *">
              <select required className="field-input" value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </select>
            </RField>
            <RField label="Address" style={{ gridColumn: '1 / -1' }}>
              <input className="field-input" value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Physical address (optional)" />
            </RField>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-light)' }}>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary">
              <UserPlus size={14} /> {loading ? 'Registering…' : 'Register & Open Profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RField({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={style}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-body)', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}
