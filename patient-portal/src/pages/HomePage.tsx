import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CalendarCheck, ChevronRight } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { usePortalData } from '../hooks/usePortalData';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import type { DashboardData } from '../types';
import StatusTag from '../components/StatusTag';
import OfflineBanner from '../components/OfflineBanner';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState, { OfflineNoDataState } from '../components/EmptyState';

function formatAppointmentDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export default function HomePage() {
  const { patient } = useAuth();
  const online = useOnlineStatus();
  const navigate = useNavigate();
  const fetcher = useCallback(() => api.get<DashboardData>('/dashboard').then((r) => r.data), []);
  const { data, loading, offlineNoData, lastUpdated, reload } = usePortalData('dashboard', fetcher);
  const [confirming, setConfirming] = useState(false);

  async function confirmAppointment(id: string) {
    if (!online) { toast.error("You're offline — this needs a connection."); return; }
    setConfirming(true);
    try {
      await api.post(`/appointments/${id}/confirm`);
      toast.success('Appointment confirmed');
      reload();
    } catch {
      toast.error("Couldn't confirm — please try again.");
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SkeletonCard /><SkeletonCard /><SkeletonCard />
      </div>
    );
  }

  if (offlineNoData || !data) return <OfflineNoDataState />;

  const hasMetrics = data.metrics.length > 0;

  return (
    <div>
      <OfflineBanner lastUpdated={lastUpdated} />
      <h1 style={{ fontSize: 21, marginTop: 12, marginBottom: 2 }}>Hi {patient?.name ?? data.patient.name} 👋</h1>
      <p style={{ fontSize: 13.5, color: 'var(--text-subtle)', marginBottom: 18 }}>{data.focus}</p>

      {hasMetrics ? (
        <>
          <div className="stat-label" style={{ marginBottom: 8 }}>Your numbers</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
            {data.metrics.map((m) => (
              <div key={m.key} className="stat-card">
                <span className="stat-label">{m.label}</span>
                <span className="stat-value">{m.value}<span className="stat-unit">{m.unit}</span></span>
                <StatusTag tag={m.tag} />
                <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{m.changeText}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="card" style={{ marginBottom: 20 }}>
          <EmptyState
            title="Your numbers will show up here"
            body="Once your clinic records a reading at your next visit, we'll start tracking it for you here."
          />
        </div>
      )}

      {data.nextAppointment ? (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="stat-label" style={{ marginBottom: 8 }}>Your next appointment</div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <CalendarCheck size={18} color="var(--orange)" style={{ marginTop: 2, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--text-heading)' }}>
                {formatAppointmentDate(data.nextAppointment.scheduledAt)}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>
                {data.nextAppointment.clinicName}{data.nextAppointment.clinicianName ? ` · ${data.nextAppointment.clinicianName}` : ''}
              </div>
            </div>
          </div>
          {data.nextAppointment.status === 'SCHEDULED' ? (
            <button className="btn-primary" style={{ width: '100%', marginTop: 14 }} disabled={confirming} onClick={() => confirmAppointment(data.nextAppointment!.id)}>
              {confirming ? 'Confirming…' : 'Confirm appointment'}
            </button>
          ) : (
            <div className="tag tag-improving" style={{ marginTop: 12 }}>Confirmed</div>
          )}
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 20 }}>
          <EmptyState title="No upcoming appointments" body="When your clinic books your next visit, it'll appear here." />
        </div>
      )}

      <button className="btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '0 auto' }} onClick={() => navigate('/appointments')}>
        View all appointments <ChevronRight size={14} />
      </button>
    </div>
  );
}
