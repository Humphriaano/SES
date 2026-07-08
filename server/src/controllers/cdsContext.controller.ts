import { Request, Response } from 'express';
import prisma from '../lib/prisma';

/**
 * Server-side assembly of the guideline-CDS payload. The frontend sends only
 * the patient id plus current-canvas data (unsaved diagnoses/prescriptions/
 * notes); everything committed — investigation results, past medical history,
 * vitals history, dispensing history — is aggregated here from PostgreSQL so
 * the CDS always sees the full record regardless of what the canvas loaded.
 *
 * This is strictly the guideline-CDS context. The chronic-disease risk ML
 * pipeline (risk.controller.ts) has a fixed XGBoost input schema and is
 * deliberately untouched.
 */

// Character budget for the four record-history sections combined. Qwen 3.6
// runs at num_ctx 32768 in Ollama; this keeps the patient record well under
// ~1.5k tokens so guideline chunks + generation always fit comfortably.
const PATIENT_CONTEXT_CHAR_BUDGET = 6000;

const INVESTIGATION_WINDOW_MONTHS = 12;
const INVESTIGATION_MAX_COUNT = 20;
const DISPENSING_WINDOW_MONTHS = 6;
const VITALS_HISTORY_COUNT = 5;

interface CanvasDiagnosis { icd_code: string; label: string; status?: string }
interface CanvasPayload {
  diagnoses?: CanvasDiagnosis[];
  medications?: string[];
  pending_investigations?: string[];
  encounter_notes?: string;
}

interface ResultLine { text: string; date: Date; abnormal: boolean }

const ABNORMAL_STATUSES = new Set(['high', 'low', 'abnormal', 'critical', 'positive']);

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function calcAge(dob: Date): number {
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  if (today < new Date(today.getFullYear(), dob.getMonth(), dob.getDate())) age--;
  return age;
}

function monthsAgo(n: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
}

export async function buildCdsPayload(req: Request, res: Response): Promise<void> {
  const patientId = String(req.params.patientId);
  const canvas = ((req.body as { canvas?: CanvasPayload })?.canvas ?? {});

  const invWindow = monthsAgo(INVESTIGATION_WINDOW_MONTHS);
  const dispWindow = monthsAgo(DISPENSING_WINDOW_MONTHS);

  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    include: {
      diagnoses: { include: { icd11: true } }, // all — resolved ones feed PMH
      medications: true,
      vitals: { orderBy: { recordedAt: 'desc' }, take: VITALS_HISTORY_COUNT },
      labResults: { where: { recordedAt: { gte: invWindow } }, orderBy: { recordedAt: 'desc' } },
      dispensings: { where: { dispensedAt: { gte: dispWindow } }, orderBy: { dispensedAt: 'desc' } },
    },
  });
  if (!patient) { res.status(404).json({ error: 'Patient not found' }); return; }

  const v2Items = await prisma.investigationOrderItem.findMany({
    where: {
      order: { patientId },
      status: { in: ['Resulted', 'Amended'] },
    },
    include: { results: { orderBy: { resultedAt: 'desc' }, take: 1 } },
  });

  // ── Active diagnoses: committed unresolved ∪ canvas (dedup by ICD code) ──
  const dbActive = patient.diagnoses.filter((d) => !d.resolvedAt);
  const activeDiagnoses: { icd_code: string; label: string }[] = dbActive.map((d) => ({
    icd_code: d.icd11.code, label: d.icd11.description,
  }));
  const seenCodes = new Set(activeDiagnoses.map((d) => d.icd_code.toUpperCase()));
  for (const cd of canvas.diagnoses ?? []) {
    if (!cd.icd_code || cd.status === 'RESOLVED') continue;
    if (seenCodes.has(cd.icd_code.toUpperCase())) continue;
    seenCodes.add(cd.icd_code.toUpperCase());
    activeDiagnoses.push({ icd_code: cd.icd_code, label: cd.label });
  }

  // ── Current medications: committed active ∪ canvas prescriptions ──────────
  const now = new Date();
  const meds = patient.medications
    .filter((m) => !m.endDate || m.endDate >= now)
    .map((m) => `${m.name}${m.dosage ? ` ${m.dosage}` : ''}${m.frequency ? ` ${m.frequency}` : ''}`);
  for (const cm of canvas.medications ?? []) {
    if (!meds.some((m) => m.toLowerCase() === cm.toLowerCase())) meds.push(cm);
  }

  // ── Latest vitals (committed) ──────────────────────────────────────────────
  const latest = patient.vitals[0] ?? null;
  const latestVitals = latest ? {
    bp_systolic: latest.bloodPressureSystolic,
    bp_diastolic: latest.bloodPressureDiastolic,
    heart_rate: latest.heartRate,
    temperature_c: latest.temperature,
    spo2_pct: latest.oxygenSat,
  } : null;

  // ── Investigation results: V2 + legacy labs, 12mo window, newest-first ────
  // Cap at 20 but always keep abnormal-flagged results within the window.
  const resultLines: ResultLine[] = [];

  for (const lr of patient.labResults) {
    const ref = lr.referenceRange ? ` (ref ${lr.referenceRange})` : '';
    resultLines.push({
      date: lr.recordedAt,
      abnormal: lr.isAbnormal,
      text: `${fmtDate(lr.recordedAt)}: ${lr.testName} ${lr.result}${lr.unit ? ` ${lr.unit}` : ''}${ref}${lr.isAbnormal ? ' [ABNORMAL]' : ''}`,
    });
  }

  for (const item of v2Items) {
    const result = item.results[0];
    if (!result) continue;
    const date = result.amendedAt ?? result.resultedAt;
    if (date < invWindow) continue;
    let rows: { componentName?: string; value?: string; units?: string; referenceRange?: string; status?: string }[] = [];
    try { rows = JSON.parse(result.resultsJson); } catch { continue; }
    for (const row of rows) {
      if (!row.componentName && !row.value) continue;
      const abnormal = ABNORMAL_STATUSES.has((row.status ?? '').toLowerCase());
      const ref = row.referenceRange ? ` (ref ${row.referenceRange})` : '';
      resultLines.push({
        date, abnormal,
        text: `${fmtDate(date)}: ${row.componentName ?? item.name} ${row.value ?? '—'}${row.units ? ` ${row.units}` : ''}${ref}${abnormal ? ' [ABNORMAL]' : ''}`,
      });
    }
  }

  resultLines.sort((a, b) => b.date.getTime() - a.date.getTime());
  const cappedResults = resultLines.slice(0, INVESTIGATION_MAX_COUNT);
  for (const line of resultLines.slice(INVESTIGATION_MAX_COUNT)) {
    if (line.abnormal) cappedResults.push(line); // abnormal always included in-window
  }

  // ── Past medical history: resolved (DB + canvas) and chronic (canvas) ─────
  // The DB schema has no lifecycle column — resolvedAt is the only committed
  // lifecycle signal; Suspected/Chronic live in canvas block data.
  const pmh: string[] = [];
  for (const d of patient.diagnoses.filter((x) => x.resolvedAt)) {
    pmh.push(`Resolved: ${d.icd11.description} (${d.icd11.code}) — resolved ${fmtDate(d.resolvedAt as Date)}`);
  }
  for (const cd of canvas.diagnoses ?? []) {
    if (!cd.icd_code) continue;
    if (cd.status === 'CHRONIC') pmh.push(`Chronic: ${cd.label} (${cd.icd_code})`);
    else if (cd.status === 'RESOLVED') pmh.push(`Resolved: ${cd.label} (${cd.icd_code}) — resolved this encounter`);
    else if (cd.status === 'SUSPECTED') pmh.push(`Suspected: ${cd.label} (${cd.icd_code}) — this encounter, unconfirmed`);
  }

  // ── Vitals history: last 5 sets, newest-first ─────────────────────────────
  const vitalsHistory = patient.vitals.map((vt) => {
    const parts: string[] = [];
    if (vt.bloodPressureSystolic != null && vt.bloodPressureDiastolic != null) parts.push(`BP ${vt.bloodPressureSystolic}/${vt.bloodPressureDiastolic}`);
    if (vt.heartRate != null) parts.push(`HR ${vt.heartRate}`);
    if (vt.temperature != null) parts.push(`Temp ${vt.temperature}°C`);
    if (vt.oxygenSat != null) parts.push(`SpO2 ${vt.oxygenSat}%`);
    if (vt.glucose != null) parts.push(`Glu ${vt.glucose} mmol/L`);
    if (vt.weight != null) parts.push(`Wt ${vt.weight}kg`);
    return `${fmtDate(vt.recordedAt)}: ${parts.join(', ')}`;
  });

  // ── Dispensing history: last 6 months, newest-first ───────────────────────
  const dispensingHistory = patient.dispensings.map((dp) =>
    `${fmtDate(dp.dispensedAt)}: ${dp.dispensedDrug}${dp.dispensedDose ? ` ${dp.dispensedDose}` : ''}${dp.dispensedFrequency ? ` ${dp.dispensedFrequency}` : ''} (dispensed)`);

  // ── Enforce the character budget across the four record sections ──────────
  // Trim oldest-first (lists are newest-first, so pop from the end), least
  // clinically critical category first. Active diagnoses and abnormal results
  // are never the first to go; abnormal results only as an absolute last resort.
  let investigationResults = cappedResults.map((l) => l.text);
  const sectionsSize = () =>
    investigationResults.join('\n').length + pmh.join('\n').length +
    vitalsHistory.join('\n').length + dispensingHistory.join('\n').length;

  const abnormalTexts = new Set(cappedResults.filter((l) => l.abnormal).map((l) => l.text));
  let guard = 500;
  while (sectionsSize() > PATIENT_CONTEXT_CHAR_BUDGET && guard-- > 0) {
    if (dispensingHistory.length > 0) { dispensingHistory.pop(); continue; }
    if (vitalsHistory.length > 2) { vitalsHistory.pop(); continue; }
    if (pmh.length > 0) { pmh.pop(); continue; }
    const lastNormalIdx = investigationResults.map((t) => !abnormalTexts.has(t)).lastIndexOf(true);
    if (lastNormalIdx !== -1) { investigationResults.splice(lastNormalIdx, 1); continue; }
    if (investigationResults.length > 0) { investigationResults.pop(); continue; } // abnormal, last resort
    break;
  }

  res.json({
    age: calcAge(patient.dateOfBirth),
    sex: patient.gender,
    patient_id: patient.id,
    active_diagnoses: activeDiagnoses,
    current_medications: meds,
    allergies: [], // no committed allergy field in the schema yet
    latest_vitals: latestVitals,
    pending_investigations: canvas.pending_investigations ?? [],
    encounter_notes: canvas.encounter_notes ?? '',
    investigation_results: investigationResults,
    past_medical_history: pmh,
    vitals_history: vitalsHistory,
    dispensing_history: dispensingHistory,
  });
}

/**
 * Lightweight signature inputs for the frontend CDS cache: a new resulted
 * investigation or a new dispense event must invalidate the cached CDS run.
 */
export async function getCdsSignature(req: Request, res: Response): Promise<void> {
  const patientId = String(req.params.patientId);

  const [latestLab, latestV2, latestDispense] = await Promise.all([
    prisma.labResult.findFirst({ where: { patientId }, orderBy: { recordedAt: 'desc' }, select: { recordedAt: true } }),
    prisma.investigationResult.findFirst({
      where: { item: { order: { patientId } } },
      orderBy: { resultedAt: 'desc' },
      select: { resultedAt: true, amendedAt: true },
    }),
    prisma.dispensing.findFirst({ where: { patientId }, orderBy: { dispensedAt: 'desc' }, select: { dispensedAt: true } }),
  ]);

  const v2Time = latestV2 ? (latestV2.amendedAt ?? latestV2.resultedAt) : null;
  const labTime = latestLab?.recordedAt ?? null;
  const latestResulted =
    v2Time && labTime ? (v2Time > labTime ? v2Time : labTime) : (v2Time ?? labTime);

  res.json({
    latestResultedInvestigation: latestResulted ? latestResulted.toISOString() : null,
    latestDispense: latestDispense ? latestDispense.dispensedAt.toISOString() : null,
  });
}
