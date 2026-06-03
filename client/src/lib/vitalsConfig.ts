import { Vital } from '../types';

// ── Display record ────────────────────────────────────────────────────────────

export interface DisplayRecord {
  id: string;
  recordedAt: string; // raw ISO string from API — always safe to pass to new Date()
  date: string;       // "02 May, 09:00" — used as chart x-axis label
  dateTime: string;   // full locale string — used in history table
  systolic: number | null;
  diastolic: number | null;
  hr: number | null;
  temp: number | null;
  spo2: number | null;
  glucose: number | null;
  weight: number | null;
  height: number | null;
  bmi: number | null;
}

export function toDisplay(v: Vital & { bmi?: number | null }): DisplayRecord {
  const dt = new Date(v.recordedAt);
  return {
    id: v.id,
    recordedAt: v.recordedAt,
    date: dt.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }),
    dateTime: dt.toLocaleString('en-GB'),
    systolic:  v.bloodPressureSystolic  ?? null,
    diastolic: v.bloodPressureDiastolic ?? null,
    hr:        v.heartRate              ?? null,
    temp:      v.temperature            ?? null,
    spo2:      v.oxygenSat              ?? null,
    glucose:   v.glucose                ?? null,
    weight:    v.weight                 ?? null,
    height:    v.height                 ?? null,
    bmi:       v.bmi                    ?? null,
  };
}

// ── Status logic ──────────────────────────────────────────────────────────────

export type StatusKey = 'normal' | 'caution' | 'warning' | 'danger' | 'neutral';

export function getStatus(key: string, value: number | null | undefined): StatusKey {
  if (value === null || value === undefined) return 'neutral';
  const v = value;
  switch (key) {
    case 'systolic':  return v < 90 || v >= 180 ? 'danger' : v >= 140 ? 'warning' : v >= 130 ? 'caution' : 'normal';
    case 'diastolic': return v < 60 || v >= 120 ? 'danger' : v >= 90  ? 'warning' : 'normal';
    case 'hr':        return v < 40 || v > 150  ? 'danger' : v < 60  || v > 100  ? 'warning' : 'normal';
    case 'temp':      return v < 35 || v >= 39  ? 'danger' : v < 36.1 || v >= 37.5 ? 'warning' : 'normal';
    case 'spo2':      return v < 90  ? 'danger' : v < 95  ? 'warning' : 'normal';
    case 'glucose':   return v < 2.5 || v > 15  ? 'danger' : v < 3.9 || v > 7.8  ? 'warning' : 'normal';
    default:          return 'neutral';
  }
}

export const STATUS: Record<StatusKey, {
  bg: string; border: string; text: string;
  badge: string; badgeText: string; dot: string; label: string;
}> = {
  normal:  { bg: '#f0fdf4', border: '#bbf7d0', text: '#15803d', badge: '#dcfce7', badgeText: '#166534', dot: '#22c55e', label: 'Normal'   },
  caution: { bg: '#fefce8', border: '#fef08a', text: '#a16207', badge: '#fef9c3', badgeText: '#854d0e', dot: '#eab308', label: 'Elevated' },
  warning: { bg: '#fff7ed', border: '#fed7aa', text: '#c2410c', badge: '#ffedd5', badgeText: '#9a3412', dot: '#f97316', label: 'High'     },
  danger:  { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c', badge: '#fee2e2', badgeText: '#991b1b', dot: '#ef4444', label: 'Critical' },
  neutral: { bg: '#f8fafc', border: '#e2e8f0', text: '#475569', badge: '#f1f5f9', badgeText: '#475569', dot: '#94a3b8', label: '—'        },
};

// ── Chart config ──────────────────────────────────────────────────────────────

export type ChartKey = 'bp' | 'hr' | 'temp' | 'spo2' | 'glucose';

export const CHART_CONFIGS: Record<ChartKey, {
  label: string;
  keys: (keyof DisplayRecord)[];
  colors: string[];
  unit: string;
  refs: { y: number; color: string; dash: string }[];
}> = {
  bp:      { label: 'Blood Pressure', keys: ['systolic', 'diastolic'], colors: ['#c0392b', '#e67e22'], unit: 'mmHg',   refs: [{ y: 130, color: '#f97316', dash: '4 2' }, { y: 140, color: '#ef4444', dash: '4 2' }] },
  hr:      { label: 'Heart Rate',     keys: ['hr'],                    colors: ['#8b5cf6'],            unit: 'bpm',    refs: [{ y: 60,  color: '#94a3b8', dash: '3 3' }, { y: 100, color: '#f97316', dash: '4 2' }] },
  temp:    { label: 'Temperature',    keys: ['temp'],                   colors: ['#ef4444'],            unit: '°C',     refs: [{ y: 37.2, color: '#f97316', dash: '4 2' }, { y: 37.5, color: '#ef4444', dash: '4 2' }] },
  spo2:    { label: 'SpO₂',           keys: ['spo2'],                   colors: ['#3b82f6'],            unit: '%',      refs: [{ y: 95,  color: '#f97316', dash: '4 2' }] },
  glucose: { label: 'Glucose',        keys: ['glucose'],                colors: ['#10b981'],            unit: 'mmol/L', refs: [{ y: 3.9, color: '#94a3b8', dash: '3 3' }, { y: 7.8, color: '#f97316', dash: '4 2' }] },
};

// ── Utilities ─────────────────────────────────────────────────────────────────

export function getTrend(history: DisplayRecord[], key: keyof DisplayRecord): 'up' | 'down' | 'stable' {
  const vals = history.map(d => d[key]).filter(v => v !== null && v !== undefined) as number[];
  if (vals.length < 2) return 'stable';
  const last = vals[vals.length - 1];
  const prev = vals[vals.length - 2];
  if (last > prev * 1.015) return 'up';
  if (last < prev * 0.985) return 'down';
  return 'stable';
}

export function bmiLabel(bmi: number | null): { text: string; color: string } | null {
  if (!bmi) return null;
  if (bmi < 18.5) return { text: 'Underweight', color: '#3b82f6' };
  if (bmi < 25)   return { text: 'Normal',      color: '#22c55e' };
  if (bmi < 30)   return { text: 'Overweight',  color: '#f97316' };
  return                  { text: 'Obese',       color: '#ef4444' };
}

export function calcBmi(weight?: number | null, height?: number | null): number | null {
  if (!weight || !height || height <= 0) return null;
  return parseFloat((weight / ((height / 100) ** 2)).toFixed(1));
}
