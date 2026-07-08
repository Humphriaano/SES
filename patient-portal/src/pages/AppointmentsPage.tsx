import { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import { Phone, CalendarCheck, CalendarClock } from 'lucide-react';
import api from '../api/client';
import { usePortalData } from '../hooks/usePortalData';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import type { Appointment } from '../types';
import OfflineBanner from '../components/OfflineBanner';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState, { OfflineNoDataState } from '../components/EmptyState';

const CLINIC_PHONE = '+260211234567'; // TODO: source from clinic settings once available

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

function AppointmentRow({ appt, onConfirm, confirming }: { appt: Appointment; onConfirm: (id: string) => void; confirming: boolean }) {
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {appt.status === 'CONFIRMED' || appt.status === 'COMPLETED' ? (
          <CalendarCheck size={18} color="var(--green-text)" style={{ marginTop: 2, flexShrink: 0 }} />
        ) : (
          <CalendarClock size={18} color="var(--orange)" style={{ marginTop: 2, flexShrink: 0 }} />
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-heading)' }}>{formatDate(appt.scheduledAt)}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>
            {appt.clinicName}{appt.clinicianName ? ` · ${appt.clinicianName}` : ''}
          </div>
        </div>
      </div>
      {appt.status === 'SCHEDULED' && (
        <button className="btn-primary" style={{ width: '100%', marginTop: 12 }} disabled={confirming} onClick={() => onConfirm(appt.id)}>
          {confirming ? 'Confirming…' : 'Confirm'}
        </button>
      )}
      {(appt.status === 'CONFIRMED' || appt.status === 'COMPLETED') && (
        <div className="tag tag-improving" style={{ marginTop: 10 }}>
          {appt.status === 'COMPLETED' ? 'Completed' : 'Confirmed'}
          {appt.confirmedVia ? ` · via ${appt.confirmedVia === 'PORTAL' ? 'app' : 'email'}` : ''}
        </div>
      )}
    </div>
  );
}

export default function AppointmentsPage() {
  const online = useOnlineStatus();
  const fetcher = useCallback(() => api.get<{ upcoming: Appointment[]; past: Appointment[] }>('/appointments').then((r) => r.data), []);
  const { data, loading, offlineNoData, lastUpdated, reload } = usePortalData('appointments', fetcher);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function confirm(id: string) {
    if (!online) { toast.error("You're offline — this needs a connection."); return; }
    setConfirmingId(id);
    try {
      await api.post(`/appointments/${id}/confirm`);
      toast.success('Appointment confirmed');
      reload();
    } catch {
      toast.error("Couldn't confirm — please try again.");
    } finally {
      setConfirmingId(null);
    }
  }

  if (loading) {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}><SkeletonCard /><SkeletonCard /></div>;
  }

  if (offlineNoData || !data) return <OfflineNoDataState />;

  return (
    <div>
      <OfflineBanner lastUpdated={lastUpdated} />
      <h1 style={{ fontSize: 20, marginTop: 12, marginBottom: 16 }}>Appointments</h1>

      <div className="stat-label" style={{ marginBottom: 8 }}>Upcoming</div>
      {data.upcoming.length === 0 ? (
        <div className="card" style={{ marginBottom: 20 }}>
          <EmptyState title="No upcoming appointments" body="When your clinic books your next visit, it'll appear here." />
        </div>
      ) : (
        <div style={{ marginBottom: 20 }}>
          {data.upcoming.map((a) => <AppointmentRow key={a.id} appt={a} onConfirm={confirm} confirming={confirmingId === a.id} />)}
        </div>
      )}

      <div className="card" style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Phone size={16} color="var(--navy)" style={{ flexShrink: 0 }} />
        <div style={{ fontSize: 12.5 }}>
          Need to change it? Call the clinic at{' '}
          <a href={`tel:${CLINIC_PHONE}`} style={{ color: 'var(--orange)', fontWeight: 600 }}>{CLINIC_PHONE}</a>
        </div>
      </div>

      <div className="stat-label" style={{ marginBottom: 8 }}>Past visits</div>
      {data.past.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-subtle)' }}>No past visits on record yet.</p>
      ) : (
        data.past.map((a) => <AppointmentRow key={a.id} appt={a} onConfirm={confirm} confirming={false} />)
      )}
    </div>
  );
}
