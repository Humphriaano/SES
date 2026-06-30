import { NavLink, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { usePatient } from '../../context/PatientContext';
import { useTheme } from '../../context/ThemeContext';
import { useWindowSize } from '../../hooks/useWindowSize';
import { LogOut, Shield, Moon, Sun, UserCircle } from 'lucide-react';
import EyeLogo from '../EyeLogo';

const NAV_ITEMS = [
  { label: 'Vitals',         path: 'vitals'         },
  { label: 'Consultation',   path: 'consultation'   },
  { label: 'Pharmacy',       path: 'pharmacy'       },
  { label: 'Investigations', path: 'investigations' },
  { label: 'Reports',        path: 'reports'        },
  { label: 'Billing',        path: 'billing'        },
  { label: 'Documents',      path: 'documents'      },
];

/* Total bar height. Tabs are TAB_H tall and sit flush at the bottom. */
const BAR_H = 46;
const TAB_H = 36;

export default function TopNav() {
  const { user, logout } = useAuth();
  const { activePatient } = usePatient();
  const { isDark, toggle } = useTheme();
  const { isMobile } = useWindowSize();
  const navigate = useNavigate();

  function handleLogout() { logout(); navigate('/login'); }

  /* ── Polarity-derived tokens ─────────────────────────────────────── */
  const headerText    = 'var(--text-topbar)';
  const edgeSep       = isDark ? 'rgba(0,0,0,0.15)'  : 'rgba(255,255,255,0.15)';
  const tabSep        = isDark ? 'rgba(0,0,0,0.12)'  : 'rgba(255,255,255,0.12)';
  const inactiveClr   = isDark ? 'rgba(0,0,0,0.50)'  : 'rgba(255,255,255,0.50)';
  const disabledClr   = isDark ? 'rgba(0,0,0,0.22)'  : 'rgba(255,255,255,0.22)';
  const ctrlBg        = isDark ? 'rgba(0,0,0,0.07)'  : 'rgba(255,255,255,0.10)';
  const ctrlBorder    = isDark ? 'rgba(0,0,0,0.20)'  : 'rgba(255,255,255,0.20)';
  const ctrlHoverBg   = isDark ? 'rgba(0,0,0,0.14)'  : 'rgba(255,255,255,0.20)';

  /*
   * Polarity reminder:
   *   isDark=true  → app is dark,  header is WHITE → tab must be BLACK (dark-on-white)
   *   isDark=false → app is light, header is BLACK → tab must be WHITE (light-on-black)
   */

  /* Active trapezoid colours — contrast with header surface */
  const activeFill    = isDark ? '#000000' : '#FFFFFF';
  const activeTextClr = isDark ? '#FFFFFF' : '#000000';

  /* Active drop-shadow stack */
  const activeFilter = isDark
    /* white header → black tab → pressed/embossed dark shadow + blue undertone */
    ? 'drop-shadow(0px -3px 8px rgba(0,0,0,0.50)) drop-shadow(0px 2px 8px rgba(0,102,255,0.35)) drop-shadow(0px 1px 3px rgba(0,0,0,0.80))'
    /* black header → white tab → cyan glow radiating upward */
    : 'drop-shadow(0px -4px 10px rgba(0,229,255,0.70)) drop-shadow(0px -1px 4px rgba(0,229,255,0.40)) drop-shadow(0px 2px 6px rgba(0,0,0,0.60))';

  /* Hover drop-shadow (subtle version of active) */
  const hoverFilter = isDark
    ? 'drop-shadow(0px -2px 6px rgba(0,0,0,0.20))'
    : 'drop-shadow(0px -2px 6px rgba(0,229,255,0.25))';

  /* Hover fill — semi-transparent, contrasts with header */
  const hoverFill = isDark ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)';

  /* Shared clip-path for the downward-widening trapezoid */
  const trapClip = 'polygon(10px 0%, calc(100% - 10px) 0%, 100% 100%, 0% 100%)';

  /* Thin full-height edge divider (logo | nav, nav | controls) */
  const EdgeDivider = () => (
    <div style={{ width: 1, alignSelf: 'stretch', background: edgeSep, flexShrink: 0 }} />
  );

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 30,
      background: 'var(--bg-topbar)',
      borderBottom: `1px solid ${edgeSep}`,
      height: BAR_H,
      display: 'flex',
      alignItems: 'stretch',
      transition: 'background-color 0.2s',
      /* Do NOT set overflow:hidden — it would clip filter:drop-shadow */
    }}>

      {/* ── Logo — click navigates to home ──────────────────────── */}
      <Link
        to="/"
        style={{
          display: 'flex', alignItems: 'center',
          gap: 8, padding: '0 14px', flexShrink: 0,
          textDecoration: 'none', cursor: 'pointer',
        }}
      >
        <EyeLogo
          width={isMobile ? 32 : 38}
          color={isDark ? '#000000' : '#FFFFFF'}
        />
        {!isMobile && (
          <span style={{
            fontWeight: 800, fontSize: 14, color: headerText,
            letterSpacing: '-0.3px', whiteSpace: 'nowrap',
          }}>
            Demo EHR
          </span>
        )}
      </Link>

      <EdgeDivider />

      {/* ── Module nav ───────────────────────────────────────────── */}
      <nav
        className="module-nav"
        style={{
          display: 'flex',
          alignItems: 'stretch',   /* wrapping divs fill bar height */
          flex: 1,
          minWidth: 0,
          /* overflow defaults to visible — drop-shadows bleed through.
             The module-nav CSS class overrides overflow-x:auto for mobile scroll. */
        }}
      >
        {NAV_ITEMS.map(({ label, path }, idx) => {
          const href     = activePatient ? `/patient/${activePatient.id}/${path}` : '#';
          const disabled = !activePatient;

          return (
            /* Wrapper stretches to full bar height so separator is centred */
            <div
              key={path}
              style={{
                display: 'flex',
                alignItems: 'flex-end',  /* tab anchors to bottom */
                alignSelf: 'stretch',
                flexShrink: 0,
              }}
            >
              {/* Centred hairline separator between tabs */}
              {idx > 0 && (
                <div style={{
                  width: 1, height: 20,
                  alignSelf: 'center',
                  background: tabSep,
                  flexShrink: 0,
                }} />
              )}

              <NavLink
                to={href}
                onClick={(e) => { if (disabled) e.preventDefault(); }}
                /*
                 * className drives all visual states — no inline border/bg.
                 * The 'active' suffix is added by React Router when isActive.
                 */
                className={({ isActive }) => {
                  if (disabled) return 'nav-tab nav-tab--disabled';
                  return isActive ? 'nav-tab nav-tab--active' : 'nav-tab';
                }}
                /* Only responsive sizing stays inline */
                style={{
                  padding:  isMobile ? '0 10px' : '0 16px',
                  fontSize: isMobile ? 11     : 12,
                }}
              >
                {label}
              </NavLink>
            </div>
          );
        })}
      </nav>

      <EdgeDivider />

      {/* ── Right controls ───────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center',
        gap: 4, padding: '0 12px', flexShrink: 0,
      }}>

        {/* Patient session badge — B&W, sharp */}
        {activePatient && (
          <>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              border: `1px solid ${headerText}`,
              padding: isMobile ? '3px 7px' : '4px 10px',
              maxWidth: isMobile ? 120 : 240,
              overflow: 'hidden', flexShrink: 1,
            }}>
              <UserCircle size={12} color={headerText} style={{ flexShrink: 0 }} />
              <span style={{
                fontSize: 11.5, fontWeight: 600, color: headerText,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {activePatient.firstName} {activePatient.lastName}
              </span>
            </div>
            <EdgeDivider />
          </>
        )}

        {/* Theme toggle */}
        <button
          onClick={toggle}
          title={isDark ? 'Light mode' : 'Dark mode'}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 30, height: 30,
            background: ctrlBg, border: `1px solid ${ctrlBorder}`,
            cursor: 'pointer', color: headerText, flexShrink: 0,
            transition: 'background 0.12s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = ctrlHoverBg; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = ctrlBg; }}
        >
          {isDark ? <Sun size={13} /> : <Moon size={13} />}
        </button>

        {/* Admin */}
        {user?.role?.includes('admin') && (
          <Link
            to="/admin/users"
            title="Admin"
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: isMobile ? '5px 8px' : '5px 11px',
              background: 'var(--accent)',
              color: isDark ? '#000' : '#fff',
              border: 'none', fontSize: 12, fontWeight: 700,
              textDecoration: 'none', cursor: 'pointer', flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            <Shield size={12} />
            {!isMobile && 'Admin'}
          </Link>
        )}

        {/* Logout */}
        <button
          onClick={handleLogout}
          title="Logout"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: isMobile ? '5px 8px' : '5px 11px',
            background: ctrlBg, border: `1px solid ${ctrlBorder}`,
            cursor: 'pointer', color: headerText,
            fontSize: 12, fontWeight: 500, flexShrink: 0,
            whiteSpace: 'nowrap', transition: 'background 0.12s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = ctrlHoverBg; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = ctrlBg; }}
        >
          <LogOut size={13} />
          {!isMobile && 'Logout'}
        </button>
      </div>

      {/* ── Tab styles — injected per render so they react to isDark ─ */}
      <style>{`
        /* ── Base tab ─────────────────────────────────────────────── */
        .nav-tab {
          height: ${TAB_H}px;
          display: flex;
          align-items: center;
          font-weight: 600;
          letter-spacing: 0.01em;
          white-space: nowrap;
          text-decoration: none;
          user-select: none;
          cursor: pointer;
          box-sizing: border-box;
          border: none !important;          /* kill any inherited border */
          outline: none;
          position: relative;
          /* Transition everything except clip-path (polygon→none doesn't tween cleanly) */
          transition: background 0.15s, filter 0.15s, color 0.15s;
        }

        /* ── Active — trapezoid + glow ────────────────────────────── */
        .nav-tab--active {
          background: ${activeFill};
          color: ${activeTextClr};
          clip-path: ${trapClip};
          filter: ${activeFilter};
          z-index: 2;            /* glow sits above adjacent separators */
        }

        /* ── Inactive ─────────────────────────────────────────────── */
        .nav-tab:not(.nav-tab--active):not(.nav-tab--disabled) {
          background: transparent;
          color: ${inactiveClr};
          clip-path: none;
          filter: none;
        }

        /* ── Inactive hover — same trapezoid, semi-transparent fill ── */
        .nav-tab:not(.nav-tab--active):not(.nav-tab--disabled):hover {
          background: ${hoverFill};
          color: ${isDark ? '#000000' : '#FFFFFF'};
          clip-path: ${trapClip};
          filter: ${hoverFilter};
        }

        /* ── Disabled (no active patient) ─────────────────────────── */
        .nav-tab--disabled {
          background: transparent;
          color: ${disabledClr};
          clip-path: none;
          filter: none;
          cursor: not-allowed;
        }

        /* ── Scrollable on mobile ─────────────────────────────────── */
        .module-nav {
          overflow-x: auto;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .module-nav::-webkit-scrollbar { display: none; }
      `}</style>
    </header>
  );
}
