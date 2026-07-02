import { NavLink, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { usePatient } from '../../context/PatientContext';
import { useTheme } from '../../context/ThemeContext';
import { useWindowSize } from '../../hooks/useWindowSize';
import {
  Stethoscope, Activity, Pill, FlaskConical, BarChart2, Receipt, FolderOpen,
  LogOut, ChevronRight, UserCircle, HeartPulse, Shield, Moon, Sun,
} from 'lucide-react';

const NAV_ITEMS = [
  { label: 'Vitals',         path: 'vitals',         icon: Activity },
  { label: 'Consultation',   path: 'consultation',   icon: Stethoscope },
  { label: 'Pharmacy',       path: 'pharmacy',       icon: Pill },
  { label: 'Investigations', path: 'investigations', icon: FlaskConical },
  { label: 'Reports',        path: 'reports',        icon: BarChart2 },
  { label: 'Billing',        path: 'billing',        icon: Receipt },
  { label: 'Documents',      path: 'documents',      icon: FolderOpen },
];

export default function TopNav() {
  const { user, logout } = useAuth();
  const { activePatient } = usePatient();
  const { isDark, toggle } = useTheme();
  const { isMobile } = useWindowSize();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <header style={{
      background: 'var(--bg-topbar)',
      borderBottom: '1px solid var(--border)',
      boxShadow: '0 1px 4px var(--shadow-md)',
      transition: 'background-color 0.2s, border-color 0.2s',
      position: 'sticky', top: 0, zIndex: 30,
    }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: isMobile ? '0 12px' : '0 24px',
        height: 52,
        gap: 8,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 7 : 10, flexShrink: 0 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, background: '#c8102e',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 6px rgba(200,16,46,0.3)', flexShrink: 0,
          }}>
            <HeartPulse size={16} color="#fff" />
          </div>
          {!isMobile && (
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text-heading-alt)', letterSpacing: '-0.3px', lineHeight: 1 }}>SES EHR</div>
              <div style={{ fontSize: 10, color: 'var(--text-subtle)', fontWeight: 500, letterSpacing: '0.04em' }}>SPECIALTY EMERGENCY SERVICES</div>
            </div>
          )}
          {isMobile && (
            <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--text-heading-alt)', letterSpacing: '-0.3px' }}>SES EHR</span>
          )}
        </div>

        {/* Patient breadcrumb — centre on desktop, shown on mobile as icon-only chip */}
        {activePatient && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 6,
            background: 'var(--chip-red-bg)', border: '1px solid var(--chip-red-border)',
            borderRadius: 8, padding: isMobile ? '4px 8px' : '5px 12px',
            overflow: 'hidden', maxWidth: isMobile ? 140 : 280,
            flexShrink: 1,
          }}>
            <UserCircle size={14} color="#c8102e" style={{ flexShrink: 0 }} />
            <span style={{
              fontSize: isMobile ? 11 : 12, fontWeight: 600, color: 'var(--chip-red-text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {activePatient.firstName} {activePatient.lastName}
            </span>
            {!isMobile && (
              <>
                <ChevronRight size={12} color="#f87171" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: '#dc2626', flexShrink: 0 }}>Active Session</span>
              </>
            )}
          </div>
        )}

        {/* Right controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 4, flexShrink: 0 }}>
          {/* Theme toggle */}
          <button
            onClick={toggle}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, borderRadius: 8,
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              cursor: 'pointer', color: 'var(--text-muted)',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface-2)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-surface)'; }}
          >
            {isDark ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          {/* User avatar + name */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            background: 'var(--bg-surface)', borderRadius: 8,
            padding: isMobile ? '5px 7px' : '5px 11px',
            border: '1px solid var(--border)',
          }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%', background: '#c8102e',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0,
            }}>
              {user?.name?.charAt(0).toUpperCase()}
            </div>
            {!isMobile && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-heading-alt)', lineHeight: 1.2 }}>{user?.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'capitalize' }}>{user?.role}</div>
              </div>
            )}
          </div>

          {/* Admin link */}
          {user?.role?.includes('admin') && (
            <Link
              to="/admin/users"
              title="Admin"
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: isMobile ? '6px 8px' : '6px 12px',
                background: '#1e3a5f', color: '#93c5fd', border: 'none',
                borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                textDecoration: 'none', cursor: 'pointer',
              }}
            >
              <Shield size={13} />
              {!isMobile && 'Admin'}
            </Link>
          )}

          {/* Logout */}
          <button onClick={handleLogout} className="btn-ghost" style={{ padding: isMobile ? '6px 8px' : '7px 12px' }} title="Logout">
            <LogOut size={14} />
            {!isMobile && <span>Logout</span>}
          </button>
        </div>
      </div>

      {/* Module nav — horizontally scrollable on mobile */}
      <div
        className="module-nav"
        style={{
          display: 'flex', alignItems: 'center',
          padding: isMobile ? '0 8px' : '0 20px',
          background: 'var(--bg-nav)',
          gap: 2,
          transition: 'background-color 0.2s',
        }}
      >
        {NAV_ITEMS.map(({ label, path, icon: Icon }) => {
          const href = activePatient ? `/patient/${activePatient.id}/${path}` : '#';
          const disabled = !activePatient;
          return (
            <NavLink
              key={path}
              to={href}
              onClick={(e) => { if (disabled) e.preventDefault(); }}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: isMobile ? 4 : 6,
                padding: isMobile ? '8px 10px' : '10px 16px',
                fontSize: isMobile ? 11.5 : 12.5,
                fontWeight: 600,
                color: isActive ? '#fff' : disabled ? '#4b5563' : '#9ca3af',
                borderBottom: isActive ? '2px solid #c8102e' : '2px solid transparent',
                background: isActive ? 'rgba(200,16,46,0.12)' : 'transparent',
                cursor: disabled ? 'not-allowed' : 'pointer',
                textDecoration: 'none',
                transition: 'all 0.15s',
                userSelect: 'none',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              })}
              className={!activePatient ? '' : 'nav-item'}
            >
              <Icon size={isMobile ? 13 : 14} />
              {label}
            </NavLink>
          );
        })}
      </div>

      <style>{`
        .nav-item:hover { color: #fff !important; background: rgba(255,255,255,0.07) !important; }
      `}</style>
    </header>
  );
}
