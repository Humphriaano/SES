import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTreatmentCount } from '../../hooks/useTreatmentCount';
import { staffDisplayName, staffInitials, staffPosition } from '../../lib/staffNames';
import { hasRole } from '../../lib/money';
import { billingHref, canAccessModule, patientSelectionPath } from '../../lib/moduleAccess';
import { usePatient } from '../../context/PatientContext';
import { useWindowSize } from '../../hooks/useWindowSize';
import api from '../../api/client';
import { Patient } from '../../types';
import ThemeSwatches from '../ThemeSwatches';
import ServicePointPicker from '../ServicePointPicker';
import { useServicePoint } from '../../context/ServicePointContext';
import { toggleQueueDrawer } from '../../lib/queue';
import RegisterModal from '../RegisterModal';
import toast from 'react-hot-toast';
import { Search, LogOut, Shield, X, Loader2, UserPlus, Users } from 'lucide-react';

const NAV_ITEMS = [
  { label: 'Vitals',         path: 'vitals' },
  { label: 'Consultation',   path: 'consultation' },
  { label: 'Pharmacy',       path: 'pharmacy' },
  { label: 'Investigations', path: 'investigations' },
] as const;

function calcAge(dob: string) {
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000));
}

function normalize(v: string) {
  return v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Bold + underline the part of `text` that matches the search term.
function Mark({ text, term }: { text: string; term: string }) {
  const t = term.trim();
  const i = t ? normalize(text).indexOf(normalize(t)) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark className="sd-m">{text.slice(i, i + t.length)}</mark>{text.slice(i + t.length)}</>;
}

const SEX: Record<string, string> = { MALE: 'Male', FEMALE: 'Female', OTHER: 'Other' };

function PatientSearch() {
  const { user } = useAuth();
  const { setActivePatient, setActiveEncounterId } = usePatient();
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Patient[]>([]);
  const [settled, setSettled] = useState('');        // the query the current results belong to
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [registering, setRegistering] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqRef = useRef(0);
  const term = query.trim();

  // "/" focuses the search from anywhere outside a text field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, []);

  useEffect(() => {
    if (term.length < 2) { reqRef.current++; setResults([]); setSettled(''); setOpen(false); setSearching(false); return; }
    const id = ++reqRef.current;
    setSearching(true);
    setFailed(false);
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get('/patients', { params: { search: term } });
        if (id !== reqRef.current) return;          // a newer keystroke superseded this request
        setResults(data);
        setSettled(term);
        setActive(0);
        setOpen(true);
      } catch {
        if (id === reqRef.current) { setFailed(true); setResults([]); setSettled(term); setOpen(true); }
      } finally {
        if (id === reqRef.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [term]);

  function openPatient(p: Patient) {
    setActivePatient(p);
    setActiveEncounterId(null);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
    navigate(patientSelectionPath(user?.role, p.id, location.pathname));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); (e.target as HTMLElement).blur(); return; }
    if (!open) { if (e.key === 'ArrowDown' && results.length) setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); openPatient(results[active]); }
  }

  const showResults = open && settled === term && !failed && results.length > 0;
  const showNone = open && settled === term && !failed && results.length === 0 && !searching;
  const showFailed = open && settled === term && failed;
  const oneWord = !/\s/.test(term);

  return (
    <div ref={wrapRef} className="tn-searchwrap">
      <label className={`tn-search${open ? ' open' : ''}`}>
        {searching ? <Loader2 size={16} className="tn-spin" color="var(--bar-muted)" /> : <Search size={16} color="var(--bar-muted)" />}
        <span className="sr-only">Search patients</span>
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls="sd-list"
          aria-activedescendant={showResults ? `sd-opt-${active}` : undefined}
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => { if (settled === term && term.length >= 2) setOpen(true); }}
          placeholder="Search name, NRC or phone"
          style={query ? { fontWeight: 500 } : undefined}
        />
        {query
          ? <button type="button" className="tn-clear" aria-label="Clear search"
              onClick={() => { setQuery(''); setOpen(false); inputRef.current?.focus(); }}><X size={14} /></button>
          : <kbd className="tn-kbd">/</kbd>}
      </label>

      {showResults && (
        <div className="sd" id="sd-list" role="listbox" aria-label="Patient results">
          <div className="sd-h">
            <span>Patients</span>
            <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>
              {results.length >= 50 ? '50+ matches — keep typing to narrow' : `${results.length} match${results.length === 1 ? '' : 'es'}`}
            </span>
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {results.map((p, i) => {
              const meta = [
                SEX[p.gender] ?? p.gender, `${calcAge(p.dateOfBirth)} yrs`,
                p.nationalId && `NRC ${p.nationalId}`, p.phone,
              ].filter(Boolean) as string[];
              return (
                <a key={p.id} id={`sd-opt-${i}`} role="option" aria-selected={i === active} href={patientSelectionPath(user?.role, p.id, location.pathname)}
                  className={`sd-row${i === active ? ' sd-on' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={(e) => { e.preventDefault(); openPatient(p); }}>
                  <span className="sd-av" aria-hidden="true">{p.firstName.charAt(0)}{p.lastName.charAt(0)}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 500 }}>
                      <Mark text={p.firstName} term={term} /> <Mark text={p.lastName} term={term} />
                    </span>
                    <span className="sd-meta" style={{ display: 'block' }}>
                      {meta.map((m, j) => <span key={j}>{j > 0 && ' · '}<Mark text={m} term={term} /></span>)}
                    </span>
                  </span>
                  {i === active && <span className="sd-open">Open <kbd className="sd-k">↵</kbd></span>}
                </a>
              );
            })}
          </div>
          <div className="sd-f">
            <span>Not the right person?{' '}
              <button type="button" className="sd-link" onClick={() => { setOpen(false); setRegistering(true); }}>Register new client</button>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <kbd className="sd-k">↑</kbd><kbd className="sd-k">↓</kbd> move <kbd className="sd-k">Esc</kbd> close
            </span>
          </div>
        </div>
      )}

      {showNone && (
        <div className="sd" id="sd-list" role="region" aria-label="No patient found">
          <div style={{ padding: '22px 20px 18px', textAlign: 'center' }}>
            <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 500, color: 'var(--text-heading)' }}>No patient matches “{term}”</p>
            <p style={{ margin: '0 0 16px', color: 'var(--text-muted)' }}>Check the spelling, or try their NRC number or phone.</p>
            {canAccessModule(user?.role, 'home') && <><button type="button" className="sd-reg" onClick={() => { setOpen(false); setRegistering(true); }}>
              <UserPlus size={15} strokeWidth={2.2} /> Register new client
            </button>
            <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--text-subtle)' }}>
              “{term}” will be filled in as the {oneWord ? 'first name' : 'name'}.
            </p></>}
          </div>
        </div>
      )}

      {showFailed && (
        <div className="sd" id="sd-list" role="alert">
          <div style={{ padding: '22px 20px 18px', textAlign: 'center' }}>
            <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 500, color: 'var(--text-heading)' }}>Couldn’t search right now</p>
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>Check your connection and try again.</p>
          </div>
        </div>
      )}

      {registering && (
        <RegisterModal
          initialName={term}
          onClose={() => setRegistering(false)}
          onCreated={(p) => {
            toast.success(`${p.firstName} ${p.lastName} registered`);
            setRegistering(false);
            openPatient(p);
          }}
        />
      )}
    </div>
  );
}

// Opens the queue drawer. The badge counts people waiting in your room (or everywhere if you haven't chosen one).
function QueueButton({ iconOnly }: { iconOnly?: boolean }) {
  const { rooms, room } = useServicePoint();
  const waiting = room ? room.waitingCount : rooms.reduce((n, r) => n + r.waitingCount, 0);
  return (
    <button type="button" className="tn-q" onClick={toggleQueueDrawer} aria-label={`Queue, ${waiting} waiting`} title="Open the patient queue">
      <Users size={15} aria-hidden="true" />
      {!iconOnly && <span style={{ fontWeight: 500 }}>Queue</span>}
      <span className={`tn-qn${waiting > 0 ? ' hot' : ''}`}>{waiting}</span>
    </button>
  );
}

export default function TopNav() {
  const { user, logout } = useAuth();
  const treatment = useTreatmentCount(canAccessModule(user?.role, 'treatment'));
  const { activePatient } = usePatient();
  const { isMobile } = useWindowSize();
  const navigate = useNavigate();
  const location = useLocation();
  const billingTo = billingHref(user?.role, activePatient?.id);
  const inBilling = location.pathname === '/billing' || location.pathname.startsWith('/billing/') || location.pathname.endsWith('/billing');
  const isAdmin = !!user?.role?.includes('admin');
  const roleLabel = staffPosition(user?.designation, user?.role?.split(',')[0]);

  const accountName = staffDisplayName(user?.name, user?.designation);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <header className="tn" style={{ position: 'sticky', top: 0, zIndex: 30 }}>
      <div className="tn-bar" style={{ padding: isMobile ? '0 12px' : '0 24px', gap: isMobile ? 10 : 20 }}>
        <Link to="/" title="Home" style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 'none', textDecoration: 'none', color: 'inherit' }}>
          <img src="/ses-mark.svg" alt="SES" style={{ width: isMobile ? 30 : 36, height: 'auto', display: 'block' }} />
          {!isMobile && (
            <div style={{ paddingLeft: 12, borderLeft: '1px solid var(--bar-line)' }}>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 500, fontSize: 15, lineHeight: 1.1, letterSpacing: 0.3 }}>SES EHR</div>
              <div style={{ fontSize: 11, color: 'var(--bar-muted)' }}>Specialty Emergency Services</div>
            </div>
          )}
        </Link>

        {!isMobile && <PatientSearch />}

        <div style={{ flex: 1 }} />

        {canAccessModule(user?.role, 'home') && <QueueButton iconOnly={isMobile} />}
        {!isMobile && <ServicePointPicker />}

        {!isMobile && (
          <div style={{ padding: '0 12px', borderLeft: '1px solid var(--bar-line)', borderRight: '1px solid var(--bar-line)', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>
            <ThemeSwatches size={16} />
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 'none' }}>
          {isAdmin && (
            <Link to="/admin/users" className="tn-icon" title="Admin settings" aria-label="Admin settings"><Shield size={18} strokeWidth={1.8} /></Link>
          )}
          <button type="button" className="tn-icon" onClick={handleLogout} title="Log out" aria-label="Log out"><LogOut size={18} strokeWidth={1.8} /></button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 4 }} aria-label={`Account: ${accountName}`}>
            <span className="tn-me">{staffInitials(user?.firstName || user?.name, 1)}</span>
            {!isMobile && (
              <span style={{ lineHeight: 1.2 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>{accountName}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--bar-muted)', textTransform: 'capitalize' }}>{roleLabel}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      <nav className="tn-nav module-nav" aria-label="Modules" style={{ padding: isMobile ? '0 4px' : '0 12px' }}>
        {canAccessModule(user?.role, 'home') && <NavLink to="/" end className="tn-link">Home</NavLink>}
        {canAccessModule(user?.role, 'reports') && <NavLink to="/reports" className="tn-link">Reports</NavLink>}
        {canAccessModule(user?.role, 'treatment') && (
          <NavLink to="/treatment-room" className="tn-link" aria-label={treatment.waiting ? `Treatment room, ${treatment.waiting} waiting${treatment.urgent ? `, ${treatment.urgent} urgent` : ''}` : 'Treatment room'}>
            Treatment{treatment.waiting > 0 && <span className="tn-count" style={treatment.urgent ? { background: 'var(--badge-red-text)' } : undefined}>{treatment.waiting}</span>}
          </NavLink>
        )}
        {!activePatient && canAccessModule(user?.role, 'pharmacy') && <NavLink to="/pharmacy" className="tn-link">Pharmacy</NavLink>}
        {/* Patient modules only appear once a patient is open, so there is nothing to click that can't work. */}
        {activePatient && NAV_ITEMS.filter(item => canAccessModule(user?.role, item.path)).map(({ label, path }) => (
          <NavLink key={path} to={`/patient/${activePatient.id}/${path}`} className={({ isActive }) => `tn-link${isActive || (path === 'pharmacy' && location.pathname === '/pharmacy') ? ' active' : ''}`}>
            {label}
          </NavLink>
        ))}
        {billingTo && <NavLink to={billingTo} className={`tn-link${inBilling ? ' active' : ''}`}>Billing</NavLink>}
        {activePatient && canAccessModule(user?.role, 'documents') && <NavLink to={`/patient/${activePatient.id}/documents`} className="tn-link">Documents</NavLink>}
      </nav>

      <style>{`
        .tn { background: var(--bar); color: var(--bar-text); transition: background-color .2s; }
        .tn-bar { display: flex; align-items: center; height: 44px; }
        .tn-searchwrap { position: relative; flex: 1; max-width: 520px; min-width: 0; }
        .tn-search { display: flex; align-items: center; gap: 10px; height: 30px; padding: 0 12px;
          background: var(--bar-field); border-radius: 10px; cursor: text; transition: background .15s, box-shadow .15s; }
        .tn-search:focus-within, .tn-search.open { background: rgba(255,255,255,.14); box-shadow: 0 0 0 3px rgba(125,180,230,.35); }
        .tn-search input { border: 0; outline: 0; background: transparent; font: inherit; font-size: 14px; color: #fff; flex: 1; min-width: 0; }
        .tn-search input::placeholder { color: var(--bar-muted); }
        .tn-search input::-webkit-search-cancel-button { display: none; }
        .tn-count { display: inline-block; min-width: 18px; margin-left: 6px; padding: 0 5px; border-radius: 9px; background: var(--ses-blue-deep); color: #fff; font-size: 11px; font-weight: 500; line-height: 18px; text-align: center; }
        .tn-kbd { font-family: inherit; font-size: 11px; color: var(--bar-muted); border: 1px solid rgba(255,255,255,.18); border-radius: 5px; padding: 1px 6px; }
        .tn-clear { width: 24px; height: 24px; border: 0; border-radius: 6px; background: transparent; color: var(--bar-muted); cursor: pointer;
          display: flex; align-items: center; justify-content: center; padding: 0; }
        .tn-clear:hover { background: rgba(255,255,255,.1); color: #fff; }
        .tn-spin { animation: tn-spin 1s linear infinite; }
        @keyframes tn-spin { to { transform: rotate(360deg); } }
        .sd { position: absolute; top: calc(100% + 8px); left: 0; width: min(520px, 92vw); z-index: 60; background: var(--bg-card); color: var(--text-heading);
          border: 1px solid var(--border); border-radius: 14px; box-shadow: 0 18px 48px rgba(0,0,0,.28); overflow: hidden; font-size: 14px; }
        .sd-h { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px 8px; font-size: 11px; font-weight:500;
          letter-spacing: 1px; text-transform: uppercase; color: var(--text-subtle); }
        .sd-row { display: flex; align-items: center; gap: 12px; padding: 10px 16px; text-decoration: none; color: var(--text-heading); cursor: pointer; }
        .sd-on { background: var(--ws-chip); box-shadow: inset 3px 0 0 var(--ws-link); }
        .sd-av { flex: none; width: 36px; height: 36px; border-radius: 50%; background: var(--ws-head); border: 1px solid var(--border);
          font-weight:500; font-size: 13px; display: flex; align-items: center; justify-content: center; }
        .sd-m { background: transparent; color: inherit; font-weight:500; text-decoration: underline; text-decoration-color: var(--ws-link);
          text-decoration-thickness: 2px; text-underline-offset: 2px; }
        .sd-meta { margin-top: 3px; font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .sd-open { flex: none; display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-subtle); }
        .sd-k { font-family: inherit; font-size: 11px; color: var(--text-subtle); border: 1px solid var(--border); border-radius: 5px; padding: 0 5px; background: var(--ws-head); }
        .sd-f { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--border-light);
          background: var(--ws-head); font-size: 12px; color: var(--text-muted); flex-wrap: wrap; }
        .sd-link { border: 0; background: none; padding: 0; font: inherit; font-size: 12px; font-weight:500; color: var(--ws-link); cursor: pointer; }
        .sd-link:hover { text-decoration: underline; }
        .sd-reg { height: 40px; padding: 0 18px; border: 0; border-radius: 10px; background: var(--btn-accent); color: #fff; font: inherit; font-size: 13px;
          font-weight:500; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; transition: filter .15s; }
        .sd-reg:hover { filter: brightness(1.06); }
        .tn-q { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 8px; border: 0; border-radius: 8px; background: transparent; color: var(--bar-text); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
        .tn-q:hover { background: var(--bar-field); }
        .tn-qn { display: inline-flex; align-items: center; justify-content: center; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 9px; background: var(--bar-field); color: var(--bar-muted); font-size: 10px; font-weight:500; }
        .tn-qn.hot { background: var(--selection-on-dark); color: var(--selection-on-dark-text); }
        .tn-icon { width: 38px; height: 38px; border: 0; border-radius: 10px; background: transparent; color: var(--bar-text);
          display: flex; align-items: center; justify-content: center; cursor: pointer; }
        .tn-icon:hover { background: rgba(255,255,255,.08); }
        .tn-me { width: 32px; height: 32px; border-radius: 50%; background: var(--btn-accent); color: #fff; font-weight:500; font-size: 13px;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .tn .sp-btn { height: 30px; }
        .tn-nav { display: flex; gap: 2px; height: 32px; align-items: stretch; border-top: 1px solid var(--bar-line); overflow-x: auto; }
        .tn-link { display: flex; align-items: center; padding: 0 14px; font-size: 13px; font-weight:500; white-space: nowrap;
          color: var(--nav-text); text-decoration: none; transition: color .15s, background .15s; }
        .tn-link:hover { color: #fff; background: rgba(255,255,255,.05); }
        .tn-link.active { color: #fff; background: var(--nav-active-bg); box-shadow: inset 0 -3px 0 var(--nav-active-line); }
        @media (max-width: 767px) { .tn-bar { height: 48px; } .tn-nav { height: 36px; } }
        .tn-link.disabled { opacity: .45; cursor: not-allowed; }
        .tn-link.disabled:hover { background: none; color: var(--nav-text); }
        .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
      `}</style>
    </header>
  );
}
