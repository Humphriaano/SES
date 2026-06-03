import { useState } from 'react';
import { X } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {
  CHART_CONFIGS, ChartKey, DisplayRecord, getTrend,
} from '../../lib/vitalsConfig';

interface Props {
  open: boolean;
  patientName: string;
  history: DisplayRecord[];
  onClose: () => void;
}

function PanelTooltip({ active, payload, label, unit }: { active?: boolean; payload?: any[]; label?: string; unit: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#1e293b', borderRadius: 8, padding: '8px 12px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
      <p style={{ color: '#64748b', fontSize: 10, margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
        Recorded
      </p>
      <p style={{ color: '#f1f5f9', fontSize: 12, fontWeight: 600, margin: '0 0 6px' }}>{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color, fontSize: 13, fontWeight: 600, margin: 0 }}>
          {p.name}: {p.value} {unit}
        </p>
      ))}
    </div>
  );
}

export default function VitalsTrendsPanel({ open, patientName, history, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<ChartKey>('bp');
  const config = CHART_CONFIGS[activeTab];

  const trend = getTrend(history, config.keys[0]);
  const trendDisplay =
    trend === 'up'   ? { text: 'Trending up ↑',   color: '#f97316' } :
    trend === 'down' ? { text: 'Trending down ↓', color: '#22c55e' } :
                       { text: 'Stable →',         color: '#94a3b8' };

  const latest = history[history.length - 1] ?? null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 96,
        right: 0,
        width: 480,
        height: 'calc(100vh - 96px)',
        background: 'var(--bg-card)',
        borderLeft: '1px solid var(--border)',
        boxShadow: '-6px 0 32px rgba(0,0,0,0.12)',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.25s ease',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '16px 20px 12px',
        borderBottom: '1px solid var(--border-light)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-heading)', letterSpacing: '-0.2px' }}>
            Vital Trends
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{patientName}</div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', padding: 6, borderRadius: 6, display: 'flex', alignItems: 'center',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >
          <X size={16} />
        </button>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex', borderBottom: '1px solid var(--border-light)',
        padding: '0 14px', overflowX: 'auto', flexShrink: 0,
      }}>
        {(Object.entries(CHART_CONFIGS) as [ChartKey, typeof CHART_CONFIGS[ChartKey]][]).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            style={{
              padding: '10px 12px 8px', border: 'none', background: 'transparent',
              borderBottom: `2px solid ${activeTab === key ? '#c0392b' : 'transparent'}`,
              color: activeTab === key ? '#c0392b' : 'var(--text-muted)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
              transition: 'color 0.15s',
            }}
          >
            {cfg.label}
          </button>
        ))}
      </div>

      {/* Chart + trend body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 20px' }}>
        {history.length < 2 ? (
          <div style={{ textAlign: 'center', paddingTop: 60, color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>📈</div>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-heading)', marginBottom: 4 }}>
              Not enough data
            </p>
            <p style={{ fontSize: 12 }}>At least 2 readings are needed to show trends.</p>
          </div>
        ) : (
          <>
            {/* Legend row */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
              {config.keys.map((k, i) => (
                <span key={String(k)} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-body2)' }}>
                  <span style={{ width: 12, height: 3, borderRadius: 2, background: config.colors[i], display: 'inline-block' }} />
                  <span>{k === 'systolic' ? 'Systolic' : k === 'diastolic' ? 'Diastolic' : config.label}</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-heading)' }}>{latest?.[k] ?? '—'}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{config.unit}</span>
                </span>
              ))}
            </div>

            {/* Chart */}
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history} margin={{ top: 5, right: 10, bottom: 10, left: -15 }}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 9, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    angle={-35}
                    textAnchor="end"
                    height={50}
                    interval={0}
                  />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<PanelTooltip unit={config.unit} />} />
                  {config.refs.map((r, i) => (
                    <ReferenceLine key={i} y={r.y} stroke={r.color} strokeDasharray={r.dash} strokeWidth={1} />
                  ))}
                  {config.keys.map((k, i) => (
                    <Line
                      key={String(k)}
                      type="linear"
                      dataKey={String(k)}
                      stroke={config.colors[i]}
                      strokeWidth={2}
                      dot={{ r: 3, fill: config.colors[i], strokeWidth: 0 }}
                      activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
                      connectNulls={false}
                      name={k === 'systolic' ? 'Systolic' : k === 'diastolic' ? 'Diastolic' : config.label}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Reference lines legend */}
            {config.refs.length > 0 && (
              <div style={{ display: 'flex', gap: 10, marginTop: 6, padding: '6px 10px', background: 'var(--bg-surface)', borderRadius: 7 }}>
                {config.refs.map((r, i) => (
                  <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-body2)' }}>
                    <span style={{ width: 14, height: 2, background: r.color, display: 'inline-block', opacity: 0.8 }} />
                    Ref: {r.y} {config.unit}
                  </span>
                ))}
              </div>
            )}

            {/* Trend summary */}
            <div style={{
              marginTop: 14, padding: '10px 14px',
              background: 'var(--bg-surface)', borderRadius: 8,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 11, color: 'var(--text-body2)' }}>Trend (last 2 readings):</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: trendDisplay.color }}>
                {trendDisplay.text}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
