import { useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceArea,
} from 'recharts';
import api from '../api/client';
import { usePortalData } from '../hooks/usePortalData';
import type { TrendMetric } from '../types';
import OfflineBanner from '../components/OfflineBanner';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState, { OfflineNoDataState } from '../components/EmptyState';

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function ChartTooltip({ active, payload, label, unit }: { active?: boolean; payload?: any[]; label?: string; unit: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--navy)', borderRadius: 8, padding: '8px 12px', color: '#fff' }}>
      <p style={{ fontSize: 10.5, opacity: 0.7, margin: '0 0 4px' }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ fontSize: 12.5, fontWeight: 600, margin: 0 }}>{p.value} {unit}</p>
      ))}
    </div>
  );
}

function TrendChart({ metric }: { metric: TrendMetric }) {
  const rows = metric.points.map((p, i) => ({
    date: shortDate(p.at),
    value: p.value,
    secondary: metric.secondaryPoints?.[i]?.value,
  }));

  if (metric.points.length < 2) {
    return (
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="stat-label" style={{ marginBottom: 6 }}>{metric.label}</div>
        <p style={{ fontSize: 13, color: 'var(--text-subtle)' }}>{metric.sentence}</p>
      </div>
    );
  }

  const allValues = rows.flatMap((r) => [r.value, r.secondary].filter((v): v is number => v != null));
  const dataMin = Math.min(...allValues, metric.targetRange?.min ?? Infinity);
  const dataMax = Math.max(...allValues, metric.targetRange?.max ?? -Infinity);
  const pad = (dataMax - dataMin) * 0.15 || 1;

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="stat-label" style={{ marginBottom: 8 }}>{metric.label} <span style={{ textTransform: 'none', fontWeight: 400 }}>({metric.unit})</span></div>
      <div style={{ height: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="date" tick={{ fontSize: 10.5, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
            <YAxis
              domain={[dataMin - pad, dataMax + pad]}
              tick={{ fontSize: 10.5, fill: 'var(--text-muted)' }}
              tickFormatter={(v: number) => (Math.round(v * 10) / 10).toString()}
              axisLine={false} tickLine={false} width={40}
            />
            <Tooltip content={<ChartTooltip unit={metric.unit} />} />
            {metric.targetRange && (
              <ReferenceArea y1={metric.targetRange.min} y2={metric.targetRange.max} fill="var(--ses-blue)" fillOpacity={0.08} strokeOpacity={0} />
            )}
            {/* No brand red inside charts — primary/secondary series use the blue pair. */}
            <Line type="linear" dataKey="value" stroke="var(--ses-blue-deep)" strokeWidth={2.5} dot={{ r: 3 }} />
            {metric.secondaryPoints && (
              <Line type="linear" dataKey="secondary" stroke="var(--ses-blue)" strokeWidth={2} dot={{ r: 2.5 }} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--text-subtle)', marginTop: 8 }}>{metric.sentence}</p>
    </div>
  );
}

export default function TrendsPage() {
  const fetcher = useCallback(() => api.get<{ metrics: TrendMetric[] }>('/vitals/history').then((r) => r.data), []);
  const { data, loading, offlineNoData, lastUpdated } = usePortalData('vitals-history', fetcher);

  if (loading) {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}><SkeletonCard /><SkeletonCard /></div>;
  }

  if (offlineNoData || !data) return <OfflineNoDataState />;

  return (
    <div>
      <OfflineBanner lastUpdated={lastUpdated} />
      <h1 style={{ fontSize: 20, marginTop: 12, marginBottom: 16 }}>Trends</h1>
      {data.metrics.length === 0 ? (
        <EmptyState
          title="No trends yet"
          body="Once you have a couple of readings on file, we'll chart them here so you can see how things are moving."
        />
      ) : (
        data.metrics.map((m) => <TrendChart key={m.key} metric={m} />)
      )}
    </div>
  );
}
