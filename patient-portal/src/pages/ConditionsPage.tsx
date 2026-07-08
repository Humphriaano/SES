import { useCallback } from 'react';
import { Lightbulb, ShieldQuestion } from 'lucide-react';
import api from '../api/client';
import { usePortalData } from '../hooks/usePortalData';
import type { Condition } from '../types';
import OfflineBanner from '../components/OfflineBanner';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState, { OfflineNoDataState } from '../components/EmptyState';

export default function ConditionsPage() {
  const fetcher = useCallback(() => api.get<Condition[]>('/conditions').then((r) => r.data), []);
  const { data, loading, offlineNoData, lastUpdated } = usePortalData('conditions', fetcher);

  if (loading) {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}><SkeletonCard /><SkeletonCard /></div>;
  }

  if (offlineNoData || !data) return <OfflineNoDataState />;

  return (
    <div>
      <OfflineBanner lastUpdated={lastUpdated} />
      <h1 style={{ fontSize: 20, marginTop: 12, marginBottom: 16 }}>Your conditions</h1>

      {data.length === 0 ? (
        <EmptyState title="Nothing on file yet" body="Any ongoing conditions your care team is tracking will show up here." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {data.map((c, i) => (
            <div className="card" key={i}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                <h3 style={{ fontSize: 16 }}>{c.plainName}</h3>
              </div>
              <div className="tag tag-stable" style={{ marginBottom: 10 }}>{c.patientStatus}</div>
              {c.plainDescription && (
                <p style={{ fontSize: 13, color: 'var(--text-body)', lineHeight: 1.5, marginBottom: 12 }}>{c.plainDescription}</p>
              )}
              {c.tip && (
                <div style={{ display: 'flex', gap: 8, background: 'var(--orange-soft)', borderRadius: 10, padding: '10px 12px', marginBottom: c.mythBuster ? 8 : 0 }}>
                  <Lightbulb size={15} color="var(--ses-blue-deep)" style={{ flexShrink: 0, marginTop: 1 }} />
                  <p style={{ fontSize: 12.5, lineHeight: 1.5 }}>{c.tip}</p>
                </div>
              )}
              {c.mythBuster && (
                <div style={{ display: 'flex', gap: 8, background: 'var(--orange-soft)', borderRadius: 10, padding: '10px 12px' }}>
                  <ShieldQuestion size={15} color="var(--ses-blue-deep)" style={{ flexShrink: 0, marginTop: 1 }} />
                  <p style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                    <strong>Myth:</strong> {c.mythBuster.myth}<br />
                    <strong>Truth:</strong> {c.mythBuster.truth}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
