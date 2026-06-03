import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import api from '../api/client';
import { usePatient } from '../context/PatientContext';
import { useAuth } from '../context/AuthContext';
import { Vital } from '../types';
import {
  DisplayRecord, toDisplay,
  StatusKey, getStatus, STATUS,
  ChartKey, CHART_CONFIGS,
  getTrend, bmiLabel, calcBmi as calcBmiShared,
} from '../lib/vitalsConfig';

interface FieldConfig { name: keyof FormState; label: string; unit: string; statusKey: string; hint: string; step: string }

const FIELD_CONFIG: FieldConfig[] = [
  { name: 'systolic',  label: 'Systolic BP',  unit: 'mmHg',   statusKey: 'systolic',  hint: '90–120',    step: '1'   },
  { name: 'diastolic', label: 'Diastolic BP', unit: 'mmHg',   statusKey: 'diastolic', hint: '60–80',     step: '1'   },
  { name: 'hr',        label: 'Heart Rate',   unit: 'bpm',    statusKey: 'hr',        hint: '60–100',    step: '1'   },
  { name: 'temp',      label: 'Temperature',  unit: '°C',     statusKey: 'temp',      hint: '36.1–37.2', step: '0.1' },
  { name: 'spo2',      label: 'SpO₂',         unit: '%',      statusKey: 'spo2',      hint: '95–100',    step: '1'   },
  { name: 'glucose',   label: 'Glucose',      unit: 'mmol/L', statusKey: 'glucose',   hint: '3.9–7.8',   step: '0.1' },
  { name: 'weight',    label: 'Weight',       unit: 'kg',     statusKey: 'neutral',   hint: '',          step: '0.1' },
  { name: 'height',    label: 'Height',       unit: 'cm',     statusKey: 'neutral',   hint: '',          step: '0.1' },
];

const CARD_VITALS = [
  { chartKey: 'bp' as ChartKey,      summaryKey: 'systolic' as keyof DisplayRecord,  label: 'Blood Pressure', format: (r: DisplayRecord) => r.systolic && r.diastolic ? `${r.systolic}/${r.diastolic}` : '—', unit: 'mmHg'   },
  { chartKey: 'hr' as ChartKey,      summaryKey: 'hr' as keyof DisplayRecord,        label: 'Heart Rate',     format: (r: DisplayRecord) => r.hr != null ? String(r.hr) : '—',                               unit: 'bpm'    },
  { chartKey: 'temp' as ChartKey,    summaryKey: 'temp' as keyof DisplayRecord,      label: 'Temperature',    format: (r: DisplayRecord) => r.temp != null ? String(r.temp) : '—',                           unit: '°C'     },
  { chartKey: 'spo2' as ChartKey,    summaryKey: 'spo2' as keyof DisplayRecord,      label: 'SpO₂',           format: (r: DisplayRecord) => r.spo2 != null ? `${r.spo2}%` : '—',                             unit: ''       },
  { chartKey: 'glucose' as ChartKey, summaryKey: 'glucose' as keyof DisplayRecord,   label: 'Glucose',        format: (r: DisplayRecord) => r.glucose != null ? String(r.glucose) : '—',                     unit: 'mmol/L' },
  { chartKey: null,                  summaryKey: 'bmi' as keyof DisplayRecord,       label: 'BMI',            format: (r: DisplayRecord) => r.bmi != null ? String(r.bmi) : '—',                             unit: ''       },
];

// ─── Form state ───────────────────────────────────────────────────────────────

interface FormState {
  systolic: string; diastolic: string; hr: string; temp: string;
  spo2: string; glucose: string; weight: string; height: string;
}
const EMPTY_FORM: FormState = { systolic: '', diastolic: '', hr: '', temp: '', spo2: '', glucose: '', weight: '', height: '' };

function toApiPayload(form: FormState, encounterId?: string | null) {
  const p: Record<string, number | string> = {};
  if (encounterId) p.encounterId = encounterId;
  if (form.systolic)  p.bloodPressureSystolic  = parseInt(form.systolic);
  if (form.diastolic) p.bloodPressureDiastolic = parseInt(form.diastolic);
  if (form.hr)        p.heartRate              = parseInt(form.hr);
  if (form.temp)      p.temperature            = parseFloat(form.temp);
  if (form.spo2)      p.oxygenSat              = parseFloat(form.spo2);
  if (form.glucose)   p.glucose                = parseFloat(form.glucose);
  if (form.weight)    p.weight                 = parseFloat(form.weight);
  if (form.height)    p.height                 = parseFloat(form.height);
  return p;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TrendArrow({ history, dataKey, positiveDown = false }: { history: DisplayRecord[]; dataKey: keyof DisplayRecord; positiveDown?: boolean }) {
  const trend = getTrend(history, dataKey);
  let color = '#94a3b8';
  if (trend === 'up')   color = positiveDown ? '#22c55e' : '#ef4444';
  if (trend === 'down') color = positiveDown ? '#ef4444' : '#22c55e';
  return <span style={{ fontSize: 13, fontWeight: 600, color, marginLeft: 4 }}>{trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}</span>;
}

function CustomTooltip({ active, payload, label, unit }: { active?: boolean; payload?: any[]; label?: string; unit: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#1e293b', borderRadius: 8, padding: '8px 12px' }}>
      <p style={{ color: '#64748b', fontSize: 10, margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
        Recorded
      </p>
      <p style={{ color: '#f1f5f9', fontSize: 12, fontWeight: 600, margin: '0 0 6px' }}>
        {label}
      </p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color, fontSize: 13, fontWeight: 600, margin: 0 }}>
          {p.name}: {p.value} {unit}
        </p>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function VitalsPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const { activeEncounterId, setActivePatient } = usePatient();
  const { user } = useAuth();

  const [history, setHistory] = useState<DisplayRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [activeChart, setActiveChart] = useState<ChartKey>('bp');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!patientId) return;
    api.get(`/patients/${patientId}`)
      .then(r => setActivePatient(r.data))
      .catch(() => {});
    setLoading(true);
    api.get(`/patients/${patientId}/vitals`)
      .then(r => setHistory((r.data as any[]).map(toDisplay)))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [patientId]);

  function previewBmi(): number | null {
    return calcBmiShared(parseFloat(form.weight) || null, parseFloat(form.height) || null);
  }

  async function handleSave() {
    if (!patientId) return;
    setSaving(true);
    try {
      const { data } = await api.post(`/patients/${patientId}/vitals`, toApiPayload(form, activeEncounterId));
      setHistory(prev => [...prev, toDisplay(data)]);
      setForm(EMPTY_FORM);
      setSaved(true);
      setShowForm(false);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      // save failed — toast is shown by axios interceptor
    } finally {
      setSaving(false);
    }
  }

  const canRecord = ['admin', 'nurse', 'doctor', 'clinician', 'paramedic'].includes(user?.role ?? '');
  const latest = history[history.length - 1] ?? null;
  const chartConfig = CHART_CONFIGS[activeChart];

  // ── Loading ──
  if (loading) {
    return (
      <div style={{ padding: '20px 24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 16 }}>
          {[...Array(6)].map((_, i) => (
            <div key={i} style={{ background: 'var(--border)', borderRadius: 10, height: 88, opacity: 0.6 }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ margin: '20px 24px', padding: '14px 18px', background: 'var(--chip-red-bg)', border: '1px solid var(--chip-red-border)', borderRadius: 10, color: '#b91c1c', fontSize: 13 }}>
        Failed to load vitals: {error}
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--bg-page)', minHeight: '100%', fontFamily: "'Segoe UI', system-ui, sans-serif" }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'clamp(12px, 2vw, 20px) clamp(14px, 3vw, 24px) 16px', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-heading)', letterSpacing: '-0.3px' }}>Vitals</h2>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            {latest ? `Last recorded: ${latest.dateTime}` : 'No vitals recorded yet'}
          </p>
        </div>
        {canRecord && (
          <button
            onClick={() => { setShowForm(v => !v); setSaved(false); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px',
              background: showForm ? '#e2e8f0' : '#c0392b', color: showForm ? '#475569' : '#fff',
              border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>{showForm ? '✕' : '+'}</span>
            {showForm ? 'Cancel' : 'Record Vitals'}
          </button>
        )}
      </div>

      {/* ── Summary Cards ── */}
      {latest && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, padding: '0 clamp(14px, 3vw, 24px) 16px' }}>
          {CARD_VITALS.map(v => {
            const stKey = v.summaryKey === 'bmi' ? 'neutral' : getStatus(v.summaryKey as string, latest[v.summaryKey] as number | null);
            const st = STATUS[stKey];
            const bmiInfo = v.summaryKey === 'bmi' ? bmiLabel(latest.bmi) : null;
            return (
              <div
                key={v.label}
                onClick={() => v.chartKey && setActiveChart(v.chartKey)}
                style={{
                  background: 'var(--bg-card)', borderRadius: 10, padding: '14px 14px 12px',
                  border: `1.5px solid ${activeChart === v.chartKey ? '#c0392b' : 'var(--border)'}`,
                  cursor: v.chartKey ? 'pointer' : 'default',
                  boxShadow: activeChart === v.chartKey ? '0 0 0 3px rgba(192,57,43,0.1)' : '0 1px 3px var(--shadow-sm)',
                  transition: 'border-color 0.15s, box-shadow 0.15s, background-color 0.2s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{v.label}</span>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: bmiInfo ? bmiInfo.color : st.dot, display: 'inline-block', marginTop: 2 }} />
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-heading)', lineHeight: 1.1 }}>
                  {v.format(latest)}
                  {v.chartKey && (
                    <TrendArrow
                      history={history}
                      dataKey={v.summaryKey}
                      positiveDown={v.summaryKey === 'glucose'}
                    />
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
                  {v.unit}
                  {bmiInfo && <span style={{ color: bmiInfo.color, fontWeight: 600, marginLeft: 4 }}>{bmiInfo.text}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Empty state ── */}
      {!latest && !showForm && (
        <div style={{ textAlign: 'center', padding: '60px 24px', color: '#94a3b8' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <p style={{ fontSize: 15, fontWeight: 600, color: '#374151', marginBottom: 6 }}>No vitals recorded yet</p>
          <p style={{ fontSize: 13, marginBottom: 20 }}>Record the first set of vitals to start tracking trends.</p>
          {canRecord && (
            <button
              onClick={() => setShowForm(true)}
              style={{ background: '#c0392b', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              + Record First Vitals
            </button>
          )}
        </div>
      )}

      {/* ── Entry Form ── */}
      {showForm && (
        <div style={{ margin: '0 24px 16px', background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-input)', overflow: 'hidden' }}>
          <div style={{ background: 'var(--bg-nav)', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#c0392b', display: 'inline-block' }} />
            <span style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 600, letterSpacing: '0.3px' }}>NEW VITALS ENTRY</span>
          </div>
          <div style={{ padding: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14 }}>
              {FIELD_CONFIG.map(f => {
                const val = form[f.name];
                const stKey = val !== '' ? getStatus(f.statusKey, parseFloat(val)) : 'neutral';
                const st = STATUS[stKey];
                const hasValue = val !== '';
                return (
                  <div key={f.name}>
                    <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{f.label}</span>
                      {hasValue && f.statusKey !== 'neutral' && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: st.badge, color: st.badgeText }}>
                          {st.label}
                        </span>
                      )}
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type="number"
                        name={f.name}
                        value={val}
                        onChange={e => setForm(p => ({ ...p, [f.name]: e.target.value }))}
                        step={f.step}
                        placeholder={f.hint || '—'}
                        style={{
                          width: '100%', boxSizing: 'border-box',
                          padding: '9px 40px 9px 11px', borderRadius: 7, fontSize: 14,
                          border: `1.5px solid ${hasValue && f.statusKey !== 'neutral' ? st.border : 'var(--border-input)'}`,
                          background: hasValue && f.statusKey !== 'neutral' ? st.bg : 'var(--bg-input)',
                          color: 'var(--text-heading)', outline: 'none',
                          transition: 'border-color 0.15s, background 0.15s',
                        }}
                      />
                      <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#94a3b8', fontWeight: 500, pointerEvents: 'none' }}>
                        {f.unit}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* BMI preview */}
            {form.weight && form.height && (() => {
              const bmi = previewBmi();
              const info = bmiLabel(bmi);
              return (
                <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: '#64748b' }}>Calculated BMI:</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: info?.color || '#0f172a' }}>{bmi}</span>
                  {info && <span style={{ fontSize: 12, color: info.color, fontWeight: 600 }}>({info.text})</span>}
                </div>
              );
            })()}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setShowForm(false)} style={{ padding: '8px 18px', borderRadius: 7, border: '1px solid var(--border-input)', background: 'var(--bg-card)', color: 'var(--text-body2)', fontSize: 13, cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{ padding: '8px 22px', borderRadius: 7, border: 'none', background: saving ? '#e2e8f0' : '#c0392b', color: saving ? '#94a3b8' : '#fff', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}
              >
                {saving ? 'Saving…' : 'Save Vitals'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success banner */}
      {saved && (
        <div style={{ margin: '-8px 24px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 16px', color: '#15803d', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
          ✓ Vitals recorded successfully
        </div>
      )}

      {/* ── History + Chart ── */}
      {history.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, padding: '0 24px 24px' }}>

          {/* History table */}
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px 10px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-heading)' }}>Vitals History</span>
              <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{history.length} records</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-surface)' }}>
                    {['Date', 'BP', 'HR', 'Temp', 'SpO₂', 'Glucose', 'BMI'].map(h => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--text-subtle)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...history].reverse().map((row, i) => {
                    const bpSt   = STATUS[getStatus('systolic',  row.systolic)];
                    const hrSt   = STATUS[getStatus('hr',        row.hr)];
                    const tempSt = STATUS[getStatus('temp',      row.temp)];
                    const spo2St = STATUS[getStatus('spo2',      row.spo2)];
                    const bmiInfo = bmiLabel(row.bmi);
                    return (
                      <tr key={row.id} style={{ borderTop: '1px solid var(--border-light)', background: i === 0 ? 'var(--bg-surface)' : 'transparent' }}>
                        <td style={{ padding: '9px 10px', color: 'var(--text-body2)', whiteSpace: 'nowrap', fontWeight: i === 0 ? 600 : 400 }}>
                          {row.date}
                          {i === 0 && <span style={{ marginLeft: 5, fontSize: 9, background: '#c0392b', color: '#fff', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>NEW</span>}
                        </td>
                        <td style={{ padding: '9px 10px' }}>
                          <span style={{ color: bpSt.text, fontWeight: 600 }}>
                            {row.systolic && row.diastolic ? `${row.systolic}/${row.diastolic}` : '—'}
                          </span>
                        </td>
                        <td style={{ padding: '9px 10px' }}>
                          <span style={{ color: hrSt.text, fontWeight: 600 }}>{row.hr ?? '—'}</span>
                        </td>
                        <td style={{ padding: '9px 10px' }}>
                          <span style={{ color: tempSt.text, fontWeight: 600 }}>{row.temp ?? '—'}</span>
                        </td>
                        <td style={{ padding: '9px 10px' }}>
                          <span style={{ color: spo2St.text, fontWeight: 600 }}>{row.spo2 != null ? `${row.spo2}%` : '—'}</span>
                        </td>
                        <td style={{ padding: '9px 10px', color: 'var(--text-body2)' }}>{row.glucose ?? '—'}</td>
                        <td style={{ padding: '9px 10px' }}>
                          <span style={{ color: bmiInfo?.color ?? '#475569', fontWeight: bmiInfo ? 600 : 400 }}>{row.bmi ?? '—'}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Chart panel */}
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
            {/* Tab bar */}
            <div style={{ borderBottom: '1px solid var(--border-light)', padding: '0 14px', display: 'flex', gap: 2, overflowX: 'auto' }}>
              {(Object.entries(CHART_CONFIGS) as [ChartKey, typeof CHART_CONFIGS[ChartKey]][]).map(([key, cfg]) => (
                <button
                  key={key}
                  onClick={() => setActiveChart(key)}
                  style={{
                    padding: '12px 12px 10px', border: 'none', background: 'transparent',
                    borderBottom: `2px solid ${activeChart === key ? '#c0392b' : 'transparent'}`,
                    color: activeChart === key ? '#c0392b' : 'var(--text-subtle)',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                    transition: 'color 0.15s',
                  }}
                >
                  {cfg.label}
                </button>
              ))}
            </div>

            <div style={{ padding: '16px 16px 12px' }}>
              {/* Legend */}
              <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                {chartConfig.keys.map((k, i) => (
                  <span key={String(k)} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}>
                    <span style={{ width: 12, height: 3, borderRadius: 2, background: chartConfig.colors[i], display: 'inline-block' }} />
                    {k === 'systolic' ? 'Systolic' : k === 'diastolic' ? 'Diastolic' : chartConfig.label}
                    <span style={{ fontWeight: 600, color: 'var(--text-heading)' }}>
                      {latest ? (latest[k] ?? '—') : '—'}
                    </span>
                    <span style={{ color: 'var(--text-subtle)' }}>{chartConfig.unit}</span>
                  </span>
                ))}
              </div>

              <div style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history} margin={{ top: 5, right: 10, bottom: 10, left: -15 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} angle={-35} textAnchor="end" height={50} interval={0} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip unit={chartConfig.unit} />} />
                    {chartConfig.refs.map((r, i) => (
                      <ReferenceLine key={i} y={r.y} stroke={r.color} strokeDasharray={r.dash} strokeWidth={1} />
                    ))}
                    {chartConfig.keys.map((k, i) => (
                      <Line
                        key={String(k)}
                        type="monotone"
                        dataKey={String(k)}
                        stroke={chartConfig.colors[i]}
                        strokeWidth={2}
                        dot={{ r: 4, fill: chartConfig.colors[i], strokeWidth: 0 }}
                        activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
                        connectNulls={false}
                        name={k === 'systolic' ? 'Systolic' : k === 'diastolic' ? 'Diastolic' : chartConfig.label}
                        type="linear"
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Reference legend */}
              <div style={{ display: 'flex', gap: 10, marginTop: 8, padding: '8px 10px', background: 'var(--bg-surface)', borderRadius: 7 }}>
                {chartConfig.refs.map((r, i) => (
                  <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-muted)' }}>
                    <span style={{ width: 16, height: 2, background: r.color, display: 'inline-block', opacity: 0.7 }} />
                    Ref: {r.y} {chartConfig.unit}
                  </span>
                ))}
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
