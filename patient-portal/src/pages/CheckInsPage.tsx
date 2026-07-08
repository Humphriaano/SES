import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Mail } from 'lucide-react';
import api from '../api/client';
import { usePortalData } from '../hooks/usePortalData';
import type { CheckInSummary } from '../types';
import OfflineBanner from '../components/OfflineBanner';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState, { OfflineNoDataState } from '../components/EmptyState';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function CheckInsPage() {
  const navigate = useNavigate();
  const fetcher = useCallback(() => api.get<CheckInSummary[]>('/check-ins').then((r) => r.data), []);
  const { data, loading, offlineNoData, lastUpdated } = usePortalData('check-ins', fetcher);

  if (loading) {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}><SkeletonCard /><SkeletonCard /></div>;
  }

  if (offlineNoData || !data) return <OfflineNoDataState />;

  return (
    <div>
      <OfflineBanner lastUpdated={lastUpdated} />
      <h1 style={{ fontSize: 20, marginTop: 12, marginBottom: 16 }}>My check-ins</h1>

      {data.length === 0 ? (
        <EmptyState
          icon={<Mail size={26} color="var(--text-muted)" />}
          title="No check-ins yet"
          body="Your first monthly check-in email will appear here once your care team sends it."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(`/check-ins/${c.id}`)}
              className="card"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left', cursor: 'pointer', border: '1px solid var(--border)' }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-heading)' }}>{c.subject}</div>
                <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>{formatDate(c.sentAt)}</div>
              </div>
              <ChevronRight size={16} color="var(--text-muted)" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
