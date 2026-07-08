import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import api from '../api/client';
import { usePortalData } from '../hooks/usePortalData';
import type { CheckInDetail } from '../types';
import StatusTag from '../components/StatusTag';
import { SkeletonCard } from '../components/Skeleton';
import { OfflineNoDataState } from '../components/EmptyState';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function CheckInDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fetcher = useCallback(() => api.get<CheckInDetail>(`/check-ins/${id}`).then((r) => r.data), [id]);
  const { data, loading, offlineNoData } = usePortalData(`check-in-${id}`, fetcher);

  return (
    <div>
      <button className="btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, paddingLeft: 0 }} onClick={() => navigate('/check-ins')}>
        <ArrowLeft size={15} /> All check-ins
      </button>

      {loading && <SkeletonCard />}
      {!loading && (offlineNoData || !data) && <OfflineNoDataState />}

      {!loading && data && (
        <>
          <h1 style={{ fontSize: 19, marginBottom: 2 }}>{data.subject}</h1>
          <p style={{ fontSize: 12.5, color: 'var(--text-subtle)', marginBottom: 18 }}>{formatDate(data.sentAt)}</p>

          <p style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 18 }}>{data.dataSnapshot.focus}</p>

          <div className="stat-label" style={{ marginBottom: 8 }}>Your numbers that month</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
            {data.dataSnapshot.metrics.map((m) => (
              <div key={m.key} className="stat-card">
                <span className="stat-label">{m.label}</span>
                <span className="stat-value">{m.value}<span className="stat-unit">{m.unit}</span></span>
                <StatusTag tag={m.tag} />
              </div>
            ))}
          </div>

          {data.dataSnapshot.conditions.length > 0 && (
            <>
              <div className="stat-label" style={{ marginBottom: 8 }}>Conditions</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data.dataSnapshot.conditions.map((c, i) => (
                  <div key={i} className="card">
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{c.plainName} <span style={{ fontWeight: 400, color: 'var(--text-subtle)' }}>— {c.patientStatus}</span></div>
                    {c.tip && <p style={{ fontSize: 12.5, color: 'var(--text-body)' }}>💡 {c.tip}</p>}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
