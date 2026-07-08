import prisma from '../lib/prisma';
import { matchConditions, MatchedCondition } from './conditionContent.service';

export type MetricTag = 'improving' | 'stable' | 'needs-attention';

export interface MetricCard {
  key: string;            // 'bp' | 'glucose' | 'hba1c' | 'weight' | 'heartRate' | 'oxygenSat'
  label: string;          // plain-language name
  value: string;          // display value, e.g. "128/82"
  unit: string;           // e.g. "mmHg", "mmol/L", "kg"
  tag: MetricTag;
  changeText: string;     // e.g. "Down 6 since May"
  recordedAt: string;     // ISO date of the latest reading
}

export interface CheckInEmailData {
  patient: { id: string; name: string; firstName: string };
  metrics: MetricCard[];
  focus: string;
  nextAppointment: {
    id: string; scheduledAt: string; clinicianName: string | null;
    clinicName: string; status: string; confirmedVia: string | null;
  } | null;
  conditions: {
    plainName: string; patientStatus: string; tip: string | null;
    mythBuster: { myth: string; truth: string } | null;
  }[];
  generatedAt: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function monthOf(d: Date): string { return MONTHS[d.getMonth()] ?? ''; }

function round1(n: number): number { return Math.round(n * 10) / 10; }

interface Reading { value: number; at: Date }

function tagAndChange(
  latest: Reading, previous: Reading | null,
  opts: { highIsBad: boolean; attentionAbove?: number; attentionBelow?: number; improveDelta: number; unit: string },
): { tag: MetricTag; changeText: string } {
  const v = latest.value;
  const needsAttention =
    (opts.attentionAbove !== undefined && v >= opts.attentionAbove) ||
    (opts.attentionBelow !== undefined && v <= opts.attentionBelow);

  if (!previous) {
    return {
      tag: needsAttention ? 'needs-attention' : 'stable',
      changeText: `First reading — ${monthOf(latest.at)}`,
    };
  }
  const delta = v - previous.value;
  const goodMove = opts.highIsBad ? -delta : delta;
  const deltaText = delta === 0
    ? `Steady since ${monthOf(previous.at)}`
    : `${delta < 0 ? 'Down' : 'Up'} ${round1(Math.abs(delta))}${opts.unit ? opts.unit : ''} since ${monthOf(previous.at)}`;

  if (needsAttention) return { tag: 'needs-attention', changeText: deltaText };
  if (goodMove >= opts.improveDelta) return { tag: 'improving', changeText: deltaText };
  return { tag: 'stable', changeText: deltaText };
}

/**
 * Aggregate a patient's chronic-care summary: the "Your numbers" stat cards
 * with improving/stable/needs-attention tags, the one-focus nudge, the next
 * appointment, and condition-matched education content. This is the single
 * source of threshold logic shared by the monthly check-in email and the
 * patient portal dashboard — do not duplicate it elsewhere.
 */
export async function buildCheckInEmailData(patientId: string): Promise<CheckInEmailData | null> {
  const now = new Date();
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    include: {
      diagnoses: { where: { resolvedAt: null }, include: { icd11: true } },
      vitals: { orderBy: { recordedAt: 'asc' } },
      labResults: { orderBy: { recordedAt: 'asc' } },
      appointments: {
        where: { scheduledAt: { gte: now }, status: { in: ['SCHEDULED', 'CONFIRMED'] } },
        orderBy: { scheduledAt: 'asc' },
        take: 1,
      },
    },
  });
  if (!patient) return null;

  const conditions = await matchConditions(patient.diagnoses, now);
  const keys = new Set(conditions.map((c) => c.conditionKey).filter(Boolean) as string[]);
  const hasHtn = keys.has('hypertension') || keys.has('heart-failure');
  const hasDm = keys.has('diabetes-type-2') || keys.has('diabetes-type-1');

  const series = {
    systolic: patient.vitals.filter((v) => v.bloodPressureSystolic != null)
      .map((v) => ({ value: v.bloodPressureSystolic as number, at: v.recordedAt })),
    diastolic: patient.vitals.filter((v) => v.bloodPressureDiastolic != null)
      .map((v) => ({ value: v.bloodPressureDiastolic as number, at: v.recordedAt })),
    weight: patient.vitals.filter((v) => v.weight != null)
      .map((v) => ({ value: v.weight as number, at: v.recordedAt })),
    glucose: patient.vitals.filter((v) => v.glucose != null)
      .map((v) => ({ value: v.glucose as number, at: v.recordedAt })),
    hba1c: patient.labResults.filter((r) => /hba1c|glycated/i.test(r.testName) && !isNaN(parseFloat(r.result)))
      .map((r) => ({ value: parseFloat(r.result), at: r.recordedAt })),
  };

  const metrics: MetricCard[] = [];

  // Blood pressure — one card combining systolic/diastolic, tagged on systolic.
  const sys = series.systolic;
  const dia = series.diastolic;
  if (sys.length > 0) {
    const latest = sys[sys.length - 1]!;
    const prev = sys.length > 1 ? sys[sys.length - 2]! : null;
    const latestDia = dia.length > 0 ? dia[dia.length - 1]!.value : null;
    const { tag, changeText } = tagAndChange(latest, prev,
      { highIsBad: true, attentionAbove: 140, improveDelta: 5, unit: '' });
    const diaAttention = latestDia != null && latestDia >= 90;
    metrics.push({
      key: 'bp', label: 'Blood pressure',
      value: latestDia != null ? `${latest.value}/${latestDia}` : `${latest.value}`,
      unit: 'mmHg',
      tag: diaAttention && tag !== 'needs-attention' ? 'needs-attention' : tag,
      changeText, recordedAt: latest.at.toISOString(),
    });
  }

  // HbA1c preferred over spot glucose when available.
  if (series.hba1c.length > 0) {
    const latest = series.hba1c[series.hba1c.length - 1]!;
    const prev = series.hba1c.length > 1 ? series.hba1c[series.hba1c.length - 2]! : null;
    const { tag, changeText } = tagAndChange(latest, prev,
      { highIsBad: true, attentionAbove: 8, improveDelta: 0.5, unit: '' });
    metrics.push({
      key: 'hba1c', label: 'HbA1c (3-month sugar)', value: `${round1(latest.value)}`, unit: '%',
      tag, changeText, recordedAt: latest.at.toISOString(),
    });
  } else if (series.glucose.length > 0) {
    const latest = series.glucose[series.glucose.length - 1]!;
    const prev = series.glucose.length > 1 ? series.glucose[series.glucose.length - 2]! : null;
    const { tag, changeText } = tagAndChange(latest, prev,
      { highIsBad: true, attentionAbove: 11.1, attentionBelow: 3.9, improveDelta: 1.5, unit: '' });
    metrics.push({
      key: 'glucose', label: 'Blood sugar', value: `${round1(latest.value)}`, unit: 'mmol/L',
      tag, changeText, recordedAt: latest.at.toISOString(),
    });
  }

  // Weight.
  if (series.weight.length > 0) {
    const latest = series.weight[series.weight.length - 1]!;
    const prev = series.weight.length > 1 ? series.weight[series.weight.length - 2]! : null;
    const { tag, changeText } = tagAndChange(latest, prev,
      { highIsBad: true, improveDelta: 1, unit: 'kg' });
    metrics.push({
      key: 'weight', label: 'Weight', value: `${round1(latest.value)}`, unit: 'kg',
      tag: prev != null && latest.value - prev.value >= 2 ? 'needs-attention' : tag,
      changeText, recordedAt: latest.at.toISOString(),
    });
  }

  // Order condition-relevant cards first, cap at three.
  metrics.sort((a, b) => {
    const rank = (m: MetricCard) =>
      (m.key === 'bp' && hasHtn) || ((m.key === 'glucose' || m.key === 'hba1c') && hasDm) ? 0 : 1;
    return rank(a) - rank(b);
  });
  const cards = metrics.slice(0, 3);

  // One focus this month: the first needs-attention metric, else a condition
  // tip, else a gentle keep-it-up line. Templated sentences only — never
  // generated clinical claims.
  const attention = cards.find((m) => m.tag === 'needs-attention');
  const improving = cards.find((m) => m.tag === 'improving');
  let focus: string;
  if (attention) {
    const focusLines: Record<string, string> = {
      bp: "Let's work on bringing your blood pressure down — small steps count.",
      glucose: "Let's focus on steadying your blood sugar this month.",
      hba1c: "Let's focus on bringing your 3-month sugar level down, one meal at a time.",
      weight: "Let's keep an eye on your weight this month — small changes add up.",
    };
    focus = focusLines[attention.key] ?? "Let's work on this together, one step at a time.";
  } else if (improving) {
    const improvingLines: Record<string, string> = {
      bp: "Your blood pressure is moving in the right direction — keep doing what you're doing.",
      glucose: "Your blood sugar is moving in the right direction — keep doing what you're doing.",
      hba1c: "Your 3-month sugar level is moving in the right direction — keep doing what you're doing.",
      weight: "Your weight is moving in the right direction — keep doing what you're doing.",
    };
    focus = improvingLines[improving.key] ?? "You're moving in the right direction — keep doing what you're doing.";
  } else {
    const tip = conditions.find((c) => c.tip)?.tip;
    focus = tip ?? 'Keep taking your medication as prescribed — steady is strong.';
  }

  const appt = patient.appointments[0] ?? null;

  return {
    patient: {
      id: patient.id,
      name: patient.preferredName || patient.firstName,
      firstName: patient.firstName,
    },
    metrics: cards,
    focus,
    nextAppointment: appt ? {
      id: appt.id,
      scheduledAt: appt.scheduledAt.toISOString(),
      clinicianName: appt.clinicianName,
      clinicName: appt.clinicName,
      status: appt.status,
      confirmedVia: appt.confirmedVia,
    } : null,
    conditions: conditions.map((c: MatchedCondition) => ({
      plainName: c.plainName,
      patientStatus: c.patientStatus,
      tip: c.tip,
      mythBuster: c.mythBuster,
    })),
    generatedAt: now.toISOString(),
  };
}

// ── Trend sentences (templated, shared with the portal Trends screen) ────────

// label should already be in the casing wanted mid-sentence (e.g. "blood
// pressure", "HbA1c") — callers control this since acronyms can't be
// blanket-lowercased.
export function trendSentence(label: string, readings: Reading[], highIsBad: boolean): string {
  if (readings.length < 2) return `We'll show your ${label} trend once you have a couple of readings.`;
  const first = readings[0]!;
  const latest = readings[readings.length - 1]!;
  const delta = latest.value - first.value;
  const since = monthOf(first.at);
  if (Math.abs(delta) < 0.01 * Math.abs(first.value) || delta === 0) {
    return `Your ${label} has held steady since ${since}.`;
  }
  const down = delta < 0;
  const goodMove = highIsBad ? down : !down;
  if (goodMove) return `Your ${label} has ${down ? 'come down' : 'come up'} since ${since} — good progress.`;
  return `Your ${label.toLowerCase()} has ${down ? 'gone down' : 'gone up'} since ${since} — something to talk about at your next visit.`;
}
