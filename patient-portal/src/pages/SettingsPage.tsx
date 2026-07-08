import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { LogOut, Smartphone } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { usePortalData } from '../hooks/usePortalData';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import type { PortalSessionInfo } from '../types';
import { SkeletonCard } from '../components/Skeleton';

function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  if (/iphone/i.test(userAgent)) return 'iPhone';
  if (/ipad/i.test(userAgent)) return 'iPad';
  if (/android/i.test(userAgent)) return 'Android device';
  if (/windows/i.test(userAgent)) return 'Windows computer';
  if (/mac os/i.test(userAgent)) return 'Mac';
  return 'Browser';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function SettingsPage() {
  const { patient, logout } = useAuth();
  const online = useOnlineStatus();
  const navigate = useNavigate();
  const [emailOptedIn, setEmailOptedIn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const prefsFetcher = useCallback(() => api.get<{ emailOptedIn: boolean }>('/preferences').then((r) => {
    setEmailOptedIn(r.data.emailOptedIn);
    return r.data;
  }), []);
  usePortalData('preferences', prefsFetcher);

  const sessionsFetcher = useCallback(() => api.get<PortalSessionInfo[]>('/sessions').then((r) => r.data), []);
  const { data: sessions, loading: sessionsLoading } = usePortalData('sessions', sessionsFetcher);

  async function togglePreference() {
    if (!online || emailOptedIn === null) { toast.error("You're offline — this needs a connection."); return; }
    const next = !emailOptedIn;
    setSaving(true);
    try {
      await api.put('/preferences', { emailOptedIn: next });
      setEmailOptedIn(next);
    } catch {
      toast.error("Couldn't save — please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    if (!online) { toast.error("You're offline — signing out needs a connection."); return; }
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div>
      <h1 style={{ fontSize: 20, marginTop: 12, marginBottom: 16 }}>Settings</h1>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="stat-label" style={{ marginBottom: 4 }}>Signed in as</div>
        <p style={{ fontSize: 14, fontWeight: 600 }}>{patient?.email}</p>
      </div>

      <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>Monthly check-in emails</div>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Your monthly summary and tips by email</div>
        </div>
        <button
          role="switch"
          aria-checked={!!emailOptedIn}
          disabled={saving || emailOptedIn === null}
          onClick={togglePreference}
          style={{
            width: 44, height: 26, borderRadius: 999, border: 'none', flexShrink: 0, cursor: 'pointer',
            background: emailOptedIn ? 'var(--orange)' : '#d8d8d8', position: 'relative', transition: 'background 0.15s',
          }}
        >
          <span style={{
            position: 'absolute', top: 3, left: emailOptedIn ? 21 : 3, width: 20, height: 20, borderRadius: '50%',
            background: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }} />
        </button>
      </div>

      <div className="stat-label" style={{ marginBottom: 8 }}>Signed-in devices</div>
      {sessionsLoading ? <SkeletonCard /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {(sessions ?? []).map((s) => (
            <div key={s.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12 }}>
              <Smartphone size={16} color="var(--text-subtle)" style={{ flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{deviceLabel(s.userAgent)}{s.isCurrent ? ' · This device' : ''}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>Last active {formatDate(s.lastSeenAt)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <button className="btn-secondary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={handleLogout}>
        <LogOut size={15} /> Log out
      </button>
    </div>
  );
}
