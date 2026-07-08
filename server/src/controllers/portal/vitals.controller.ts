import { Response } from 'express';
import prisma from '../../lib/prisma';
import { PortalRequest } from '../../middleware/portalAuth';
import { matchConditions } from '../../services/conditionContent.service';
import { trendSentence } from '../../services/checkInEmail.service';

interface Point { at: string; value: number; }
interface TrendMetric {
  key: string;
  label: string;
  unit: string;
  targetRange: { min: number; max: number } | null;
  points: Point[];
  secondaryPoints?: Point[]; // diastolic, plotted alongside systolic
  sentence: string;
}

/**
 * Time-series per metric for the Trends screen, filtered to what's relevant
 * to the patient's active conditions (BP for hypertension, HbA1c/glucose for
 * diabetes, weight always) plus any other vital with at least two readings.
 */
export async function getVitalsHistory(req: PortalRequest, res: Response): Promise<void> {
  const [diagnoses, vitals, labResults] = await Promise.all([
    prisma.patientDiagnosis.findMany({ where: { patientId: req.patientId, resolvedAt: null }, include: { icd11: true } }),
    prisma.vital.findMany({ where: { patientId: req.patientId }, orderBy: { recordedAt: 'asc' } }),
    prisma.labResult.findMany({ where: { patientId: req.patientId }, orderBy: { recordedAt: 'asc' } }),
  ]);

  const conditions = await matchConditions(diagnoses);
  const keys = new Set(conditions.map((c) => c.conditionKey).filter(Boolean) as string[]);
  const hasHtn = keys.has('hypertension') || keys.has('heart-failure');
  const hasDm = keys.has('diabetes-type-2') || keys.has('diabetes-type-1');

  const systolic = vitals.filter((v) => v.bloodPressureSystolic != null)
    .map((v) => ({ at: v.recordedAt.toISOString(), value: v.bloodPressureSystolic as number }));
  const diastolic = vitals.filter((v) => v.bloodPressureDiastolic != null)
    .map((v) => ({ at: v.recordedAt.toISOString(), value: v.bloodPressureDiastolic as number }));
  const weight = vitals.filter((v) => v.weight != null)
    .map((v) => ({ at: v.recordedAt.toISOString(), value: v.weight as number }));
  const glucose = vitals.filter((v) => v.glucose != null)
    .map((v) => ({ at: v.recordedAt.toISOString(), value: v.glucose as number }));
  const heartRate = vitals.filter((v) => v.heartRate != null)
    .map((v) => ({ at: v.recordedAt.toISOString(), value: v.heartRate as number }));
  const oxygenSat = vitals.filter((v) => v.oxygenSat != null)
    .map((v) => ({ at: v.recordedAt.toISOString(), value: v.oxygenSat as number }));
  const temperature = vitals.filter((v) => v.temperature != null)
    .map((v) => ({ at: v.recordedAt.toISOString(), value: v.temperature as number }));
  const hba1c = labResults.filter((r) => /hba1c|glycated/i.test(r.testName) && !isNaN(parseFloat(r.result)))
    .map((r) => ({ at: r.recordedAt.toISOString(), value: parseFloat(r.result) }));

  const toReadings = (pts: Point[]) => pts.map((p) => ({ value: p.value, at: new Date(p.at) }));

  const metrics: TrendMetric[] = [];

  if ((hasHtn || systolic.length > 0) && systolic.length > 0) {
    metrics.push({
      key: 'bp', label: 'Blood pressure', unit: 'mmHg',
      targetRange: { min: 90, max: 130 },
      points: systolic, secondaryPoints: diastolic,
      sentence: trendSentence('blood pressure', toReadings(systolic), true),
    });
  }

  if (hasDm && hba1c.length > 0) {
    metrics.push({
      key: 'hba1c', label: 'HbA1c (3-month sugar)', unit: '%',
      targetRange: { min: 4, max: 6.5 },
      points: hba1c,
      sentence: trendSentence('HbA1c', toReadings(hba1c), true),
    });
  } else if (hasDm && glucose.length > 0) {
    metrics.push({
      key: 'glucose', label: 'Blood sugar', unit: 'mmol/L',
      targetRange: { min: 3.9, max: 7.8 },
      points: glucose,
      sentence: trendSentence('blood sugar', toReadings(glucose), true),
    });
  }

  if (weight.length > 0) {
    metrics.push({
      key: 'weight', label: 'Weight', unit: 'kg',
      targetRange: null,
      points: weight,
      sentence: trendSentence('weight', toReadings(weight), true),
    });
  }

  // Bonus vitals: shown once there are at least two readings, regardless of
  // condition relevance, so patients see everything being tracked over time.
  if (!hasDm && glucose.length >= 2) {
    metrics.push({
      key: 'glucose', label: 'Blood sugar', unit: 'mmol/L',
      targetRange: { min: 3.9, max: 7.8 }, points: glucose,
      sentence: trendSentence('blood sugar', toReadings(glucose), true),
    });
  }
  if (heartRate.length >= 2) {
    metrics.push({
      key: 'heartRate', label: 'Heart rate', unit: 'bpm',
      targetRange: { min: 60, max: 100 }, points: heartRate,
      sentence: trendSentence('heart rate', toReadings(heartRate), true),
    });
  }
  if (oxygenSat.length >= 2) {
    metrics.push({
      key: 'oxygenSat', label: 'Oxygen level', unit: '%',
      targetRange: { min: 95, max: 100 }, points: oxygenSat,
      sentence: trendSentence('oxygen level', toReadings(oxygenSat), false),
    });
  }
  if (temperature.length >= 2) {
    metrics.push({
      key: 'temperature', label: 'Temperature', unit: '°C',
      targetRange: { min: 36.1, max: 37.5 }, points: temperature,
      sentence: trendSentence('temperature', toReadings(temperature), true),
    });
  }

  res.json({ metrics });
}
