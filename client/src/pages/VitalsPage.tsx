import { useState, useEffect, useCallback, useMemo, FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from 'recharts';
import toast from 'react-hot-toast';
import api from '../api/client';
import { usePatient } from '../context/PatientContext';
import { useAuth } from '../context/AuthContext';
import { DisplayRecord, toDisplay, StatusKey, getStatus, calcBmi } from '../lib/vitalsConfig';

// ── Form fields ──────────────────────────────────────────────────────────────

interface FormState {
  systolic: string; diastolic: string; hr: string; temp: string;
  spo2: string; glucose: string; weight: string; height: string;
}
type FieldKey = keyof FormState;
const EMPTY: FormState = { systolic: '', diastolic: '', hr: '', temp: '', spo2: '', glucose: '', weight: '', height: '' };

// Possible-value bounds (mirror server/src/controllers/vitals.controller.ts) and input shape.
const FIELDS: Record<FieldKey, { label: string; min: number; max: number; decimals: number; maxLen: number }> = {
  systolic:  { label: 'Systolic',    min: 50,  max: 280, decimals: 0, maxLen: 3 },
  diastolic: { label: 'Diastolic',   min: 20,  max: 180, decimals: 0, maxLen: 3 },
  hr:        { label: 'Heart rate',  min: 20,  max: 260, decimals: 0, maxLen: 3 },
  temp:      { label: 'Temperature', min: 30,  max: 45,  decimals: 1, maxLen: 4 },
  spo2:      { label: 'SpO₂',        min: 50,  max: 100, decimals: 0, maxLen: 3 },
  glucose:   { label: 'Glucose',     min: 1,   max: 45,  decimals: 1, maxLen: 4 },
  weight:    { label: 'Weight',      min: 0.5, max: 400, decimals: 1, maxLen: 5 },
  height:    { label: 'Height',      min: 30,  max: 250, decimals: 1, maxLen: 5 },
};

// Keeps only digits and (where allowed) one decimal point with limited places.
function sanitize(raw: string, key: FieldKey) {
  const { decimals, maxLen } = FIELDS[key];
  let v = raw.replace(decimals ? /[^\d.]/g : /\D/g, '');
  if (decimals) {
    const [int, ...rest] = v.split('.');
    v = rest.length ? `${int}.${rest.join('').slice(0, decimals)}` : int;
  }
  return v.slice(0, maxLen + (v.includes('.') ? 1 : 0));
}

// ── Clinical status: ok / borderline / high-or-low ───────────────────────────

type Tone = 'ok' | 'warn' | 'bad' | 'none';
interface Verdict { tone: Tone; label: string; up: boolean }

const LOW_BOUND: Record<string, number> = { systolic: 90, diastolic: 60, hr: 60, temp: 36.1, spo2: 95, glucose: 3.9 };
const SEVERITY: Record<StatusKey, number> = { neutral: 0, normal: 1, caution: 2, warning: 3, danger: 4 };
const TONE_COLOR: Record<Tone, string> = { ok: 'var(--st-ok)', warn: 'var(--st-warn)', bad: 'var(--st-bad)', none: 'var(--text-heading)' };

function verdict(key: string, v: number | null): Verdict {
  if (v == null) return { tone: 'none', label: '', up: true };
  if (key === 'bmi') {
    if (v < 18.5) return { tone: 'warn', label: 'Low', up: false };
    if (v < 25) return { tone: 'ok', label: 'Normal', up: true };
    if (v < 30) return { tone: 'warn', label: 'Borderline', up: true };
    return { tone: 'bad', label: 'High', up: true };
  }
  const st = getStatus(key, v);
  const up = !(v < (LOW_BOUND[key] ?? -Infinity));
  if (st === 'neutral') return { tone: 'none', label: '', up };
  if (st === 'normal') return { tone: 'ok', label: 'Normal', up };
  if (st === 'caution') return { tone: 'warn', label: 'Borderline', up };
  const dir = up ? 'high' : 'low';
  return { tone: 'bad', label: st === 'danger' ? `Very ${dir}` : dir === 'high' ? 'High' : 'Low', up };
}

// BP is judged by whichever of systolic/diastolic is further out of range.
function bpVerdict(sys: number, dia: number): Verdict {
  return SEVERITY[getStatus('diastolic', dia)] > SEVERITY[getStatus('systolic', sys)]
    ? verdict('diastolic', dia) : verdict('systolic', sys);
}

function Tag({ v }: { v: Verdict }) {
  if (v.tone !== 'warn' && v.tone !== 'bad') return null;
  return <span className={`vp-tag vp-tag-${v.tone}`}>{v.up ? '▲' : '▼'} {v.label}</span>;
}

function Val({ v, children }: { v: Verdict; children: React.ReactNode }) {
  return <><span className="vp-st" style={{ color: TONE_COLOR[v.tone] }}>{children}</span><Tag v={v} /></>;
}

function Hint({ v, normal }: { v: Verdict | null; normal: string }) {
  if (!v || v.tone === 'none') return <span className="v-h">Normal {normal}</span>;
  return (
    <span className="v-h" style={{ color: TONE_COLOR[v.tone], fontWeight: v.tone === 'ok' ? 500 : 700 }}>
      {v.tone === 'ok' ? 'Normal' : `${v.up ? '▲' : '▼'} ${v.label}`} · normal {normal}
    </span>
  );
}

// ── Trend chart config ───────────────────────────────────────────────────────

type TrendKey = 'bp' | 'hr' | 'temp' | 'spo2' | 'glucose' | 'weight';
const TRENDS: Record<TrendKey, {
  label: string; unit: string;
  series: { key: keyof DisplayRecord; name: string; color: string }[];
  limits: { y: number; label: string }[];
  limitKind: 'Upper' | 'Lower' | null;
}> = {
  bp:      { label: 'Blood pressure', unit: 'mmHg',   series: [{ key: 'systolic', name: 'Systolic', color: 'var(--s1)' }, { key: 'diastolic', name: 'Diastolic', color: 'var(--s2)' }],
             limits: [{ y: 140, label: 'Sys. limit 140' }, { y: 90, label: 'Dia. limit 90' }], limitKind: 'Upper' },
  hr:      { label: 'Heart rate',  unit: 'bpm',    series: [{ key: 'hr', name: 'Heart rate', color: 'var(--s1)' }],       limits: [{ y: 100, label: 'Limit 100' }],  limitKind: 'Upper' },
  temp:    { label: 'Temperature', unit: '°C',     series: [{ key: 'temp', name: 'Temperature', color: 'var(--s1)' }],    limits: [{ y: 37.5, label: 'Limit 37.5' }], limitKind: 'Upper' },
  spo2:    { label: 'SpO₂',        unit: '%',      series: [{ key: 'spo2', name: 'SpO₂', color: 'var(--s1)' }],           limits: [{ y: 95, label: 'Limit 95' }],    limitKind: 'Lower' },
  glucose: { label: 'Glucose',     unit: 'mmol/L', series: [{ key: 'glucose', name: 'Glucose', color: 'var(--s1)' }],     limits: [{ y: 7.8, label: 'Limit 7.8' }],  limitKind: 'Upper' },
  weight:  { label: 'Weight',      unit: 'kg',     series: [{ key: 'weight', name: 'Weight', color: 'var(--s1)' }],       limits: [],                                limitKind: null },
};

function niceDomain(values: number[]): [number, number] {
  const min = Math.min(...values), max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const step = span > 60 ? 20 : span > 20 ? 10 : span > 5 ? 2 : span > 2 ? 1 : 0.5;
  return [Math.floor((min - span * 0.15) / step) * step, Math.ceil((max + span * 0.15) / step) * step];
}

function ChartTooltip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="vp-tip">
      <div className="vp-tip-h">{payload[0]?.payload?.date ?? label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="vp-tip-row">
          <span style={{ width: 10, height: 2, background: p.color, display: 'inline-block' }} />
          <span style={{ flex: 1, color: 'var(--text-muted)' }}>{p.name}</span>
          <strong>{p.value}</strong>
        </div>
      ))}
      <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>{unit}</div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function VitalsPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const { activePatient, activeEncounterId, setActivePatient } = usePatient();
  const { user } = useAuth();

  const [history, setHistory] = useState<DisplayRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<FieldKey | 'bp' | 'form', string>>>({});
  const [saving, setSaving] = useState(false);
  const [trend, setTrend] = useState<TrendKey>('bp');

  const roles = (user?.role ?? '').split(',').map((r) => r.trim());
  const canRecord = roles.some((r) => ['admin', 'nurse', 'clinician', 'doctor', 'paramedic'].includes(r));

  const load = useCallback(() => {
    if (!patientId) return;
    setLoading(true);
    setLoadError(false);
    api.get(`/patients/${patientId}/vitals`)
      .then((r) => setHistory((r.data as any[]).map(toDisplay)))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [patientId]);

  useEffect(() => {
    if (patientId && activePatient?.id !== patientId) {
      api.get(`/patients/${patientId}`).then((r) => setActivePatient(r.data)).catch(() => {});
    }
    load();
  }, [patientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: FieldKey) => (e: { target: { value: string } }) => {
    setForm((p) => ({ ...p, [k]: sanitize(e.target.value, k) }));
    setErrors((p) => ({ ...p, [k]: undefined, bp: undefined, form: undefined }));
  };

  const isEmpty = Object.values(form).every((v) => v === '');
  const bmi = calcBmi(parseFloat(form.weight) || null, parseFloat(form.height) || null);
  const bmiV = verdict('bmi', bmi);
  const num = (v: string) => (v === '' || Number.isNaN(parseFloat(v)) ? null : parseFloat(v));

  function validate() {
    const next: typeof errors = {};
    (Object.keys(FIELDS) as FieldKey[]).forEach((k) => {
      if (form[k] === '') return;
      const n = Number(form[k]);
      const f = FIELDS[k];
      if (!Number.isFinite(n) || n < f.min || n > f.max) next[k] = `${f.min}–${f.max}`;
    });
    if ((form.systolic === '') !== (form.diastolic === '')) next.bp = 'Enter both systolic and diastolic';
    else if (form.systolic && form.diastolic && Number(form.systolic) <= Number(form.diastolic)) next.bp = 'Systolic must be higher than diastolic';
    else if (next.systolic || next.diastolic) next.bp = `Systolic ${FIELDS.systolic.min}–${FIELDS.systolic.max}, diastolic ${FIELDS.diastolic.min}–${FIELDS.diastolic.max}`;
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!patientId || isEmpty || saving || !validate()) return;
    const n = (v: string) => (v === '' ? undefined : Number(v));
    setSaving(true);
    try {
      const { data } = await api.post(`/patients/${patientId}/vitals`, {
        encounterId: activeEncounterId ?? undefined,
        bloodPressureSystolic: n(form.systolic), bloodPressureDiastolic: n(form.diastolic),
        heartRate: n(form.hr), temperature: n(form.temp), oxygenSat: n(form.spo2),
        glucose: n(form.glucose), weight: n(form.weight), height: n(form.height),
      });
      setHistory((prev) => [...prev, toDisplay(data)]);
      setForm(EMPTY);
      toast.success('Vitals saved');
    } catch (err: any) {
      if (err?.response?.status === 400) setErrors({ form: err.response.data?.error ?? 'Check the values and try again.' });
    } finally {
      setSaving(false);
    }
  }

  const latest = history[history.length - 1];

  // Chart: only readings that contain this measure; time-only axis labels when all on one day.
  const cfg = TRENDS[trend];
  const chartData = useMemo(() => {
    const rows = history.filter((h) => cfg.series.some((s) => h[s.key] != null));
    const sameDay = rows.length > 0 && rows.every((r) => r.recordedAt.slice(0, 10) === rows[0].recordedAt.slice(0, 10));
    return rows.map((r) => ({
      ...r,
      x: new Date(r.recordedAt).toLocaleString('en-GB', sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' }),
    }));
  }, [history, cfg]);
  const domain = useMemo(() => {
    const vals = chartData.flatMap((r) => cfg.series.map((s) => r[s.key] as number | null)).filter((v): v is number => v != null);
    return vals.length ? niceDomain([...vals, ...cfg.limits.map((l) => l.y)]) : [0, 1];
  }, [chartData, cfg]);

  const input = (k: FieldKey, extra?: { id?: string; label?: string; width?: string }) => (
    <input
      id={extra?.id} aria-label={extra?.label} type="text" inputMode={FIELDS[k].decimals ? 'decimal' : 'numeric'}
      value={form[k]} onChange={set(k)} disabled={!canRecord} aria-invalid={!!errors[k]}
      style={extra?.width ? { width: extra.width } : undefined}
    />
  );

  const sys = num(form.systolic), dia = num(form.diastolic);

  return (
    <div className="vp">
      <div className="vp-title">
        <div>
          <h1 className="vp-h1">Vitals</h1>
          <p className="vp-muted" style={{ fontSize: 13 }}>
            {loading ? 'Loading…' : latest
              ? `${history.length} reading${history.length === 1 ? '' : 's'} · latest ${latest.date}`
              : 'No readings recorded yet'}
          </p>
        </div>
      </div>

      {/* ── New reading ── */}
      <section aria-labelledby="v-new" className="vp-card" style={{ marginBottom: 20 }}>
        <div className="vp-head">
          <h2 id="v-new" className="vp-h2">New reading</h2>
          <span className="vp-faint" style={{ fontSize: 12 }}>
            {canRecord ? `Today · recorded by ${user?.name ?? ''}` : 'View only — your role cannot record vitals'}
          </span>
        </div>
        <form onSubmit={save} noValidate style={{ padding: 20 }}>
          <div className="v-grid">
            <div>
              <span className="v-l" id="v-bp-l">Blood pressure</span>
              <div className={`v-in${errors.bp ? ' err' : ''}`} role="group" aria-labelledby="v-bp-l">
                {input('systolic', { label: 'Systolic', width: '46%' })}
                <span aria-hidden="true" className="vp-faint" style={{ padding: '0 2px' }}>/</span>
                {input('diastolic', { label: 'Diastolic', width: '46%' })}
                <span className="v-u">mmHg</span>
              </div>
              {errors.bp
                ? <span className="v-h v-err">{errors.bp}</span>
                : <Hint v={sys != null && dia != null ? bpVerdict(sys, dia) : null} normal="90–120 / 60–80" />}
            </div>
            <VField k="hr" label="Heart rate" unit="bpm" normal="60–100" form={form} errors={errors} input={input} />
            <VField k="temp" label="Temperature" unit="°C" normal="36.1–37.2" form={form} errors={errors} input={input} />
            <VField k="spo2" label="SpO₂" unit="%" normal="95–100" form={form} errors={errors} input={input} />
            <VField k="glucose" label="Glucose" unit="mmol/L" normal="3.9–7.8" form={form} errors={errors} input={input} />
            <VField k="weight" label="Weight" unit="kg" form={form} errors={errors} input={input} />
            <VField k="height" label="Height" unit="cm" form={form} errors={errors} input={input} />
            <div>
              <span className="v-l">BMI</span>
              <div className="v-in v-ro">
                <span style={{ flex: 1, fontWeight: 500, color: bmi ? TONE_COLOR[bmiV.tone] : 'var(--text-subtle)' }}>{bmi ?? '—'}</span>
                <span className="v-u">kg/m²</span>
              </div>
              {bmi
                ? <span className="v-h" style={{ color: TONE_COLOR[bmiV.tone], fontWeight: 500 }}>
                    {bmiV.tone === 'ok' ? 'Normal' : `${bmiV.up ? '▲' : '▼'} ${bmiV.label}`} · normal 18.5–24.9
                  </span>
                : <span className="v-h">Calculated from weight and height</span>}
            </div>
          </div>

          {errors.form && <p role="alert" className="vp-alert">{errors.form}</p>}

          <div className="vp-actions">
            <button type="button" className="vp-btn2" onClick={() => { setForm(EMPTY); setErrors({}); }} disabled={isEmpty || saving}>Clear</button>
            <button type="submit" className="vp-btn" disabled={!canRecord || isEmpty || saving}>
              {saving ? 'Saving…' : 'Save vitals'}
            </button>
          </div>
        </form>
      </section>

      {/* ── Trends (two or more readings) ── */}
      {history.length >= 2 && (
        <section aria-labelledby="v-tr" className="vp-card" style={{ marginBottom: 20 }}>
          <div className="vp-head" style={{ flexWrap: 'wrap', gap: 12, padding: '12px 20px' }}>
            <h2 id="v-tr" className="vp-h2">Trends</h2>
            <div role="tablist" aria-label="Trend measure" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {(Object.keys(TRENDS) as TrendKey[]).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={trend === k}
                  className={`vp-tab${trend === k ? ' on' : ''}`} onClick={() => setTrend(k)}>
                  {TRENDS[k].label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ padding: '14px 20px 18px' }}>
            {chartData.length >= 2 ? (
              <>
                <div className="vp-legend">
                  {cfg.series.map((s) => (
                    <span key={String(s.key)}><span aria-hidden="true" style={{ width: 14, height: 2, borderRadius: 1, background: s.color }} />{s.name} ({cfg.unit})</span>
                  ))}
                  {cfg.limitKind && (
                    <span><span aria-hidden="true" style={{ width: 14, height: 0, borderTop: '1px dashed var(--text-subtle)' }} />{cfg.limitKind} normal limit</span>
                  )}
                </div>
                <div style={{ width: '100%', height: 280 }}
                  role="img"
                  aria-label={`${cfg.label} trend: ${chartData.map((r) => `${cfg.series.map((s) => r[s.key] ?? '—').join('/')} at ${r.x}`).join(', ')}`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 16, right: cfg.limits.length ? 104 : 40, bottom: 4, left: 0 }}>
                      <CartesianGrid stroke="var(--border-light)" vertical={false} />
                      <XAxis dataKey="x" tick={{ fontSize: 12, fill: 'var(--text-subtle)' }} axisLine={{ stroke: 'var(--border)' }}
                        tickLine={false} padding={{ left: 24, right: 24 }} minTickGap={16} />
                      <YAxis tick={{ fontSize: 12, fill: 'var(--text-subtle)' }} axisLine={false} tickLine={false} width={44} domain={domain} />
                      <Tooltip content={<ChartTooltip unit={cfg.unit} />} cursor={{ stroke: 'var(--text-muted)', strokeOpacity: 0.5 }} isAnimationActive={false} />
                      {cfg.limits.map((l) => (
                        <ReferenceLine key={l.y} y={l.y} stroke="var(--text-subtle)" strokeDasharray="4 4" strokeOpacity={0.8}
                          label={{ value: l.label, position: 'right', fill: 'var(--text-subtle)', fontSize: 11 }} />
                      ))}
                      {cfg.series.map((s) => (
                        <Line key={String(s.key)} dataKey={String(s.key)} name={s.name}
                          type="linear" stroke={s.color} strokeWidth={2} strokeLinejoin="miter" strokeLinecap="square"
                          dot={{ r: 4.5, fill: s.color, stroke: 'var(--bg-card)', strokeWidth: 2 }}
                          activeDot={{ r: 6, fill: s.color, stroke: 'var(--bg-card)', strokeWidth: 2 }}
                          connectNulls isAnimationActive={false}
                          label={(p: any) => p.index === chartData.length - 1 && p.value != null
                            ? <text key={`end-${String(s.key)}`} x={p.x + 10} y={p.y + 4} fontSize={12} fontWeight={600} fill="var(--text-heading)">{p.value}</text>
                            : <g key={`n-${String(s.key)}-${p.index}`} />}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            ) : (
              <p className="vp-muted" style={{ textAlign: 'center', padding: '40px 0' }}>
                Fewer than two {cfg.label.toLowerCase()} readings — record more to see a trend.
              </p>
            )}
          </div>
        </section>
      )}

      {/* ── History ── */}
      <section aria-labelledby="v-hist" className="vp-card">
        <div className="vp-head">
          <h2 id="v-hist" className="vp-h2">History</h2>
          {history.length > 0 && <span className="vp-faint" style={{ fontSize: 12 }}>{history.length} reading{history.length === 1 ? '' : 's'}</span>}
        </div>
        {loading ? (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[0, 1, 2].map((i) => <div key={i} className="vp-skel" />)}
          </div>
        ) : loadError ? (
          <div style={{ padding: '36px 20px 40px', textAlign: 'center' }}>
            <p style={{ fontWeight: 500, marginBottom: 4, color: 'var(--text-heading)' }}>Couldn't load readings</p>
            <p className="vp-muted" style={{ marginBottom: 14 }}>Check your connection, then try again.</p>
            <button type="button" className="vp-btn2" onClick={load}>Try again</button>
          </div>
        ) : history.length === 0 ? (
          <div style={{ padding: '36px 20px 40px', textAlign: 'center' }}>
            <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 500, color: 'var(--text-heading)' }}>No previous readings</p>
            <p className="vp-muted">Saved readings appear here as a table, with trends once there are two or more.</p>
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="vp-table">
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 20 }}>Date</th>
                    <th>BP <span className="vp-unit">mmHg</span></th>
                    <th>HR <span className="vp-unit">bpm</span></th>
                    <th>Temp <span className="vp-unit">°C</span></th>
                    <th>SpO₂</th>
                    <th>Glucose <span className="vp-unit">mmol/L</span></th>
                    <th>Weight <span className="vp-unit">kg</span></th>
                    <th>Height <span className="vp-unit">cm</span></th>
                    <th>BMI</th>
                    <th style={{ paddingRight: 20 }}>Recorded by</th>
                  </tr>
                </thead>
                <tbody>
                  {[...history].reverse().map((r) => (
                    <tr key={r.id}>
                      <td style={{ paddingLeft: 20, whiteSpace: 'nowrap' }}>{r.date}</td>
                      <td>{r.systolic != null && r.diastolic != null
                        ? <Val v={bpVerdict(r.systolic, r.diastolic)}>{r.systolic}/{r.diastolic}</Val> : <Dash />}</td>
                      <td>{r.hr != null ? <Val v={verdict('hr', r.hr)}>{r.hr}</Val> : <Dash />}</td>
                      <td>{r.temp != null ? <Val v={verdict('temp', r.temp)}>{r.temp.toFixed(1)}</Val> : <Dash />}</td>
                      <td>{r.spo2 != null ? <Val v={verdict('spo2', r.spo2)}>{r.spo2}%</Val> : <Dash />}</td>
                      <td>{r.glucose != null ? <Val v={verdict('glucose', r.glucose)}>{r.glucose}</Val> : <Dash />}</td>
                      <td>{r.weight ?? <Dash />}</td>
                      <td>{r.height ?? <Dash />}</td>
                      <td>{r.bmi != null ? <Val v={verdict('bmi', r.bmi)}>{r.bmi}</Val> : <Dash />}</td>
                      <td style={{ paddingRight: 20 }}>{r.recordedBy ?? <Dash />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="vp-key">
              <span><span className="vp-st" style={{ color: 'var(--st-ok)' }} aria-hidden="true">●</span> Normal</span>
              <span><span className="vp-st" style={{ color: 'var(--st-warn)' }} aria-hidden="true">▲</span> Borderline</span>
              <span><span className="vp-st" style={{ color: 'var(--st-bad)' }} aria-hidden="true">▲</span> High / abnormal</span>
            </div>
          </>
        )}
      </section>

      <style>{CSS}</style>
    </div>
  );
}

function Dash() {
  return <span style={{ color: 'var(--text-subtle)' }}>—</span>;
}

function VField({ k, label, unit, normal, form, errors, input }: {
  k: FieldKey; label: string; unit: string; normal?: string;
  form: FormState; errors: Partial<Record<string, string>>;
  input: (k: FieldKey, extra?: { id?: string; label?: string }) => React.ReactNode;
}) {
  const id = `v-${k}`;
  const n = form[k] === '' ? null : parseFloat(form[k]);
  return (
    <div>
      <label className="v-l" htmlFor={id}>{label}</label>
      <div className={`v-in${errors[k] ? ' err' : ''}`}>{input(k, { id })}<span className="v-u">{unit}</span></div>
      {errors[k]
        ? <span className="v-h v-err">Enter a value between {errors[k]}</span>
        : normal ? <Hint v={n != null && !Number.isNaN(n) ? verdict(k, n) : null} normal={normal} /> : null}
    </div>
  );
}

const CSS = `
.vp { position: relative; padding: 24px 24px 40px; max-width: 1600px; margin: 0 auto; font-size: 14px; color: var(--text-body);
  --vp-field: #FFFFFF; --vp-line2: #D5D9DE; }
[data-theme="dark"] .vp { --vp-field: #1F2326; --vp-line2: #33383D; }
.vp-title { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.vp-h1 { margin: 0 0 4px; font-weight:500; font-size: 22px; letter-spacing: -0.2px; color: var(--text-heading); }
.vp-h2 { margin: 0; font-family: var(--font-heading); font-size: 15px; font-weight:500; color: var(--text-heading); }
.vp-muted { margin: 0; color: var(--text-muted); }
.vp-faint { color: var(--text-subtle); }
.vp-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
.vp-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-bottom: 1px solid var(--border-light); }
.v-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px 20px; }
.v-l { display: block; font-size: 13px; font-weight:500; color: var(--text-heading); margin-bottom: 6px; }
.v-in { display: flex; align-items: center; gap: 6px; height: 44px; padding: 0 12px; border: 1px solid var(--vp-line2); border-radius: 10px;
  background: var(--vp-field); transition: border-color .15s, box-shadow .15s; }
.v-in:focus-within { border-color: var(--ring); box-shadow: 0 0 0 4px var(--ring-glow); }
.v-in.err { border-color: var(--st-bad); }
.v-in input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; font-size: 15px; font-weight:500; color: var(--text-heading); font-variant-numeric: tabular-nums; }
.v-in input:disabled { cursor: not-allowed; }
.v-ro { background: var(--ws-chip); border-color: transparent; }
.v-u { flex: none; font-size: 12px; font-weight:500; color: var(--text-subtle); }
.v-h { display: block; margin-top: 6px; font-size: 12px; color: var(--text-subtle); }
.v-err { color: var(--st-bad); font-weight:500; }
.vp-alert { margin: 18px 0 0; padding: 10px 14px; border-radius: 10px; background: var(--st-bad-bg); color: var(--st-bad); font-size: 13px; font-weight:500; }
.vp-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--border-light); }
.vp-btn { height: 40px; padding: 0 18px; border: 0; border-radius: 10px; background: var(--btn-accent); color: #fff; font: inherit; font-size: 13px; font-weight:500; cursor: pointer; transition: filter .15s, opacity .15s; }
.vp-btn:hover:not(:disabled) { filter: brightness(1.06); }
.vp-btn:disabled { opacity: .5; cursor: not-allowed; }
.vp-btn2 { height: 40px; padding: 0 16px; border: 1px solid var(--vp-line2); border-radius: 10px; background: var(--vp-field); color: var(--text-heading); font: inherit; font-size: 13px; font-weight:500; cursor: pointer; }
.vp-btn2:hover:not(:disabled) { background: var(--ws-chip); }
.vp-btn2:disabled { opacity: .5; cursor: not-allowed; }
.vp-tab { height: 30px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; color: var(--text-muted); font: inherit; font-size: 12px; font-weight:500; cursor: pointer; }
.vp-tab:hover { background: var(--ws-chip); }
.vp-tab.on { background: var(--ws-chip-on); color: var(--ws-chip-on-text); }
.vp-legend { display: flex; gap: 18px; flex-wrap: wrap; margin-bottom: 6px; font-size: 12px; color: var(--text-muted); }
.vp-legend > span { display: flex; align-items: center; gap: 6px; }
.vp-legend > span > span { display: inline-block; }
.vp-tip { min-width: 168px; padding: 10px 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,.12); font-size: 12px; }
.vp-tip-h { font-weight:500; color: var(--text-heading); margin-bottom: 6px; }
.vp-tip-row { display: flex; align-items: center; gap: 6px; margin-top: 3px; color: var(--text-heading); }
.vp-table { width: 100%; min-width: 900px; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
.vp-table th { padding: 10px 12px; text-align: left; background: var(--ws-head);
  font-size: 11px; font-weight:500; letter-spacing: 1px; text-transform: uppercase; color: var(--text-subtle); white-space: nowrap; }
.vp-unit { text-transform: none; letter-spacing: 0; font-weight: 400; }
.vp-table td { padding: 12px; border-top: 1px solid var(--border-light); color: var(--text-heading); white-space: nowrap; }
.vp-table tbody tr:hover { background: var(--ws-chip); }
.vp-st { font-weight:500; }
.vp-tag { display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight:500; white-space: nowrap; }
.vp-tag-warn { color: var(--st-warn); background: var(--st-warn-bg); }
.vp-tag-bad { color: var(--st-bad); background: var(--st-bad-bg); }
.vp-key { display: flex; gap: 18px; flex-wrap: wrap; padding: 12px 20px; border-top: 1px solid var(--border-light); font-size: 12px; color: var(--text-muted); }
.vp-skel { height: 18px; border-radius: 6px; background: var(--ws-chip); animation: vp-pulse 1.2s ease-in-out infinite; }
@keyframes vp-pulse { 50% { opacity: .5; } }
@media (max-width: 1000px) { .v-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { .v-grid { grid-template-columns: 1fr; } .vp { padding: 16px 14px 32px; } }
`;
