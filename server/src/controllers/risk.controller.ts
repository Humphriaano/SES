import { Request, Response } from 'express';
import prisma from '../lib/prisma';

const CDS_BASE = process.env['CDS_URL'] ?? 'http://localhost:8000';

// ── Component ID → feature mapping ────────────────────────────────────────────
// Each entry maps a catalogue componentId to its risk model feature name.
// convert() is applied when the catalogue unit differs from the model's expected unit.
//
// Unit conversions applied:
//   Creatinine (id 31): catalogue mmol/L → model μmol/L  ×1000
//   Uric Acid  (id 60): catalogue mg/dL  → model μmol/L  ×59.48
//   All others: units are identical between catalogue and model

type ComponentMapping = {
  feature: string;
  convert?: (v: number) => number;
};

const COMPONENT_MAP: Record<number, ComponentMapping> = {
  53: { feature: 'fasting_glucose_mmol' },
  54: { feature: 'rbs_mmol' },
  62: { feature: 'hba1c_pct' },                               // HbA1c % — preferred over id 61
  61: { feature: 'hba1c_pct' },                               // Total Glycated Hb — fallback
  55: { feature: 'total_cholesterol_mmol' },
  56: { feature: 'hdl_mmol' },
  57: { feature: 'ldl_mmol' },
  58: { feature: 'triglycerides_mmol' },
  31: { feature: 'creatinine_umol', convert: (v) => v * 1000 }, // mmol/L → μmol/L
  32: { feature: 'egfr' },                                    // Creatinine Clearance ml/min (CKD-EPI preferred below)
  33: { feature: 'urea_mmol' },
  34: { feature: 'sodium_mmol' },
  35: { feature: 'potassium_mmol' },
  48: { feature: 'ast_u_l' },
  49: { feature: 'alt_u_l' },
  51: { feature: 'ggt_u_l' },
  76: { feature: 'crp_mg_l' },
  10: { feature: 'esr_mm_hr' },
  2:  { feature: 'haemoglobin_g_dl' },
  11: { feature: 'wbc_x10_9' },
  9:  { feature: 'platelets_x10_9' },
  82: { feature: 'tsh_miu_l' },
  60: { feature: 'uric_acid_umol', convert: (v) => v * 59.48 }, // mg/dL → μmol/L
};

// ── ART detection via medication names ────────────────────────────────────────
// If a HIV-positive patient has any medication matching these substrings,
// they are flagged as on_art = 1.
const ART_KEYWORDS = [
  'efavirenz', 'tenofovir', 'lamivudine', 'atazanavir', 'lopinavir',
  'ritonavir', 'dolutegravir', 'emtricitabine', 'abacavir', 'nevirapine',
  'zidovudine', 'stavudine', 'antiretroviral', 'arvs', 'truvada',
  'biktarvy', 'triumeq', 'kaletra',
];

// ── Maths helpers ─────────────────────────────────────────────────────────────

function ageYears(dob: Date): number {
  return Math.floor((Date.now() - dob.getTime()) / (365.25 * 86_400_000));
}

function avg(vals: number[]): number | null {
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function stddev(vals: number[]): number | null {
  if (vals.length < 2) return null;
  const m = avg(vals) as number;
  return Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length);
}

// Linear regression slope across equally-spaced x = 0,1,2,…
function linSlope(ys: number[]): number | null {
  const n = ys.length;
  if (n < 2) return null;
  const xMean = (n - 1) / 2;
  const yMean = avg(ys) as number;
  const num = ys.reduce((s, y, i) => s + (i - xMean) * (y - yMean), 0);
  const den = ys.reduce((s, _, i) => s + (i - xMean) ** 2, 0);
  return den === 0 ? null : num / den;
}

function bmi(weight?: number | null, height?: number | null): number | null {
  if (!weight || !height || height <= 0) return null;
  return parseFloat((weight / (height / 100) ** 2).toFixed(1));
}

// CKD-EPI 2021 (race-free). Scr must be in mg/dL; returns mL/min/1.73m².
// gender: 1 = male, 0 = female
function ckdEpiEgfr(creatinine_umol: number, age: number, gender: number): number {
  const scr = creatinine_umol / 88.4;          // μmol/L → mg/dL
  const kappa = gender === 1 ? 0.9 : 0.7;
  const alpha = gender === 1 ? -0.302 : -0.241;
  const sexFactor = gender === 1 ? 1.0 : 1.012;
  const ratio = scr / kappa;
  const egfr =
    142 *
    Math.pow(Math.min(ratio, 1), alpha) *
    Math.pow(Math.max(ratio, 1), -1.2) *
    Math.pow(0.9938, age) *
    sexFactor;
  return parseFloat(egfr.toFixed(1));
}

// ── Controller ────────────────────────────────────────────────────────────────

export async function getRiskPrediction(req: Request, res: Response): Promise<void> {
  const patientId = String(req.params['patientId']);
  console.log(`[risk] GET /patients/${patientId}/risk-predict`);

  try {
    const now = new Date();
    const ago6m  = new Date(now.getTime() - 180 * 86_400_000);
    const ago12m = new Date(now.getTime() - 365 * 86_400_000);

    // ── 1. Patient record ──────────────────────────────────────────────────────
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: {
        dateOfBirth: true,
        gender: true,
        hivStatus: true,
        medications: { select: { name: true } },
      },
    });

    if (!patient) {
      res.status(404).json({ error: 'Patient not found' });
      return;
    }

    const age = ageYears(patient.dateOfBirth);

    // Gender encoded: MALE=1, FEMALE=0, OTHER=null (model treats as missing)
    const gender: number | null =
      patient.gender === 'MALE' ? 1 : patient.gender === 'FEMALE' ? 0 : null;

    // HIV encoded: POSITIVE=1, NEGATIVE=0, UNKNOWN=null
    const hiv_status: number | null =
      patient.hivStatus === 'POSITIVE' ? 1 :
      patient.hivStatus === 'NEGATIVE' ? 0 : null;

    // ART: only flag if HIV+ and an ARV medication is present
    const medNames = ((patient as any).medications as Array<{ name: string }> ?? []).map((m) => m.name.toLowerCase());
    const on_art: number | null =
      hiv_status === 1 && medNames.some((n) => ART_KEYWORDS.some((kw) => n.includes(kw)))
        ? 1 : null;

    // ── 2. Vitals ──────────────────────────────────────────────────────────────
    // All vitals ordered oldest→newest to build time-series features correctly
    const vitals = await prisma.vital.findMany({
      where: { patientId },
      orderBy: { recordedAt: 'asc' },
    });

    const systolics  = vitals.map((v) => v.bloodPressureSystolic).filter((v): v is number => v != null);
    const sys6m      = vitals.filter((v) => v.recordedAt >= ago6m  && v.bloodPressureSystolic != null).map((v) => v.bloodPressureSystolic as number);
    const sys12m     = vitals.filter((v) => v.recordedAt >= ago12m && v.bloodPressureSystolic != null).map((v) => v.bloodPressureSystolic as number);
    const sysLast3   = systolics.slice(-3);

    const bp_reading1       = systolics.at(-1) ?? null;
    const bp_reading2       = vitals.at(-1)?.bloodPressureDiastolic ?? null; // diastolic of most recent visit
    const bp_visit_avg      = avg(systolics);
    const bp_3visit_avg     = avg(sysLast3);
    const bp_6month_avg     = avg(sys6m);
    const bp_12month_max    = sys12m.length ? Math.max(...sys12m) : null;
    const bp_trend          = linSlope(systolics);
    const bp_variability    = stddev(systolics);
    const elevated_visit_count = systolics.filter((s) => s >= 140).length || null;

    // BMI — walk backward to find the most recent record with both weight and height
    let patientBmi: number | null = null;
    for (let i = vitals.length - 1; i >= 0; i--) {
      const b = bmi(vitals[i].weight, vitals[i].height);
      if (b !== null) { patientBmi = b; break; }
    }

    // Random blood sugar from vitals glucose field (most recent non-null)
    let rbs_from_vitals: number | null = null;
    for (let i = vitals.length - 1; i >= 0; i--) {
      if (vitals[i].glucose != null) { rbs_from_vitals = vitals[i].glucose as number; break; }
    }

    // ── 3. Encounter count (12-month consultation rate) ────────────────────────
    const consult_count_12m = await prisma.encounter.count({
      where: { patientId, createdAt: { gte: ago12m } },
    });

    // ── 4. Investigation results ───────────────────────────────────────────────
    // Pull every order/item/result for this patient in a single query.
    // We take the most recent resulted value for each componentId across all orders,
    // using resultedAt as the tiebreaker (amendments overwrite originals naturally).
    const orders = await prisma.investigationOrder.findMany({
      where: { patientId },
      include: {
        items: {
          include: {
            results: { orderBy: { resultedAt: 'asc' } },  // asc so last item = most recent
          },
        },
      },
    });

    // Flatten to (componentId → most recent numeric value), newest timestamp wins
    type Reading = { raw: number; ts: Date };
    const latestByComponentId = new Map<number, Reading>();

    for (const order of orders) {
      for (const item of (order as any).items ?? []) {
        for (const result of item.results) {
          let components: Array<{ componentId: number | string; value: string }>;
          try {
            components = JSON.parse(result.resultsJson);
          } catch {
            continue;
          }
          for (const comp of components) {
            const cid = Number(comp.componentId);
            if (!COMPONENT_MAP[cid]) continue;
            const raw = parseFloat(String(comp.value));
            if (!isFinite(raw)) continue;
            const existing = latestByComponentId.get(cid);
            if (!existing || result.resultedAt > existing.ts) {
              latestByComponentId.set(cid, { raw, ts: result.resultedAt });
            }
          }
        }
      }
    }

    // ── 5. Build lab feature map ───────────────────────────────────────────────
    // HbA1c: prefer componentId 62 (HbA1c%) over 61 (Total Glycated Hb)
    const labFeatures: Record<string, number> = {};

    const hba1c62 = latestByComponentId.get(62);
    const hba1c61 = latestByComponentId.get(61);
    if (hba1c62) labFeatures['hba1c_pct'] = hba1c62.raw;
    else if (hba1c61) labFeatures['hba1c_pct'] = hba1c61.raw;

    for (const [cidStr, mapping] of Object.entries(COMPONENT_MAP)) {
      const cid = Number(cidStr);
      if (cid === 61 || cid === 62) continue;               // handled above
      if (labFeatures[mapping.feature] != null) continue;   // don't overwrite with lower-priority
      const reading = latestByComponentId.get(cid);
      if (!reading) continue;
      const converted = mapping.convert ? mapping.convert(reading.raw) : reading.raw;
      labFeatures[mapping.feature] = parseFloat(converted.toFixed(4));
    }

    // ── 6. Derived features ────────────────────────────────────────────────────
    const tc  = labFeatures['total_cholesterol_mmol'] ?? null;
    const hdl = labFeatures['hdl_mmol'] ?? null;
    const tg  = labFeatures['triglycerides_mmol'] ?? null;

    if (tc != null && hdl != null && hdl > 0) {
      labFeatures['non_hdl_mmol']  ??= parseFloat((tc - hdl).toFixed(4));
      labFeatures['tc_hdl_ratio']  ??= parseFloat((tc / hdl).toFixed(4));
    }
    if (tg != null && hdl != null && hdl > 0) {
      labFeatures['tg_hdl_ratio'] ??= parseFloat((tg / hdl).toFixed(4));
    }

    // eGFR: CKD-EPI from creatinine (preferred) or creatinine clearance (fallback)
    const creatinine_umol = labFeatures['creatinine_umol'] ?? null;
    let egfr: number | null = labFeatures['egfr'] ?? null;    // creatinine clearance fallback
    if (creatinine_umol != null && age > 0 && gender != null) {
      egfr = ckdEpiEgfr(creatinine_umol, age, gender);
    }

    // rbs: lab result overrides vitals glucose field
    const rbs_mmol: number | null = labFeatures['rbs_mmol'] ?? rbs_from_vitals;

    // ── 7. Final feature vector ────────────────────────────────────────────────
    const features: Record<string, number | null> = {
      // Demographics
      age,
      gender,
      bmi:                        patientBmi,
      waist_cm:                   null,

      // Lifestyle — not captured in this EHR
      smoking_status:             null,
      pack_years:                 null,
      alcohol_units_per_week:     null,
      physical_activity_hrs_week: null,
      dietary_quality:            null,

      // Family history — not captured in this EHR
      fhx_hypertension:           null,
      fhx_diabetes:               null,
      fhx_cvd:                    null,
      fhx_ckd:                    null,
      fhx_cancer:                 null,

      // Clinical history
      hiv_status,
      on_art,
      prev_cvd_event:             null,
      gestational_diabetes:       null,

      // Blood pressure
      bp_reading1,
      bp_reading2,
      bp_visit_avg,
      bp_3visit_avg,
      bp_6month_avg,
      bp_12month_max,
      bp_trend,
      bp_variability,
      elevated_visit_count,

      // Glucose
      fasting_glucose_mmol:       labFeatures['fasting_glucose_mmol'] ?? null,
      rbs_mmol,
      hba1c_pct:                  labFeatures['hba1c_pct'] ?? null,

      // Lipids
      total_cholesterol_mmol:     labFeatures['total_cholesterol_mmol'] ?? null,
      ldl_mmol:                   labFeatures['ldl_mmol'] ?? null,
      hdl_mmol:                   labFeatures['hdl_mmol'] ?? null,
      triglycerides_mmol:         labFeatures['triglycerides_mmol'] ?? null,
      non_hdl_mmol:               labFeatures['non_hdl_mmol'] ?? null,
      tc_hdl_ratio:               labFeatures['tc_hdl_ratio'] ?? null,
      tg_hdl_ratio:               labFeatures['tg_hdl_ratio'] ?? null,

      // Kidney
      creatinine_umol,
      egfr,
      urea_mmol:                  labFeatures['urea_mmol'] ?? null,
      microalbumin_mg_l:          null,   // not in investigation catalogue
      sodium_mmol:                labFeatures['sodium_mmol'] ?? null,
      potassium_mmol:             labFeatures['potassium_mmol'] ?? null,

      // Liver
      alt_u_l:                    labFeatures['alt_u_l'] ?? null,
      ast_u_l:                    labFeatures['ast_u_l'] ?? null,
      ggt_u_l:                    labFeatures['ggt_u_l'] ?? null,

      // Inflammatory
      crp_mg_l:                   labFeatures['crp_mg_l'] ?? null,
      esr_mm_hr:                  labFeatures['esr_mm_hr'] ?? null,

      // Full blood count
      haemoglobin_g_dl:           labFeatures['haemoglobin_g_dl'] ?? null,
      wbc_x10_9:                  labFeatures['wbc_x10_9'] ?? null,
      platelets_x10_9:            labFeatures['platelets_x10_9'] ?? null,

      // Thyroid
      tsh_miu_l:                  labFeatures['tsh_miu_l'] ?? null,

      // Other
      uric_acid_umol:             labFeatures['uric_acid_umol'] ?? null,
      consult_count_12m,
    };

    // ── 8. Forward to FastAPI ──────────────────────────────────────────────────
    console.log(`[risk] DB stage complete for ${patientId}, forwarding to FastAPI`);
    console.log('[risk] features:', JSON.stringify(features, null, 2));
    let cdsResponse: Response | globalThis.Response;
    try {
      cdsResponse = await fetch(`${CDS_BASE}/cds/risk-predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(features),
      });
    } catch (fetchErr: any) {
      res.status(502).json({ error: `Risk prediction service unreachable: ${fetchErr.message}` });
      return;
    }

    if (!cdsResponse.ok) {
      const body = await cdsResponse.text();
      res.status(502).json({ error: `Risk prediction service error (${cdsResponse.status}): ${body}` });
      return;
    }

    const prediction = await (cdsResponse as globalThis.Response).json() as {
      status: string;
      predictions: Record<string, unknown>;
    };

    res.json({
      patientId,
      status:      prediction.status,
      predictions: prediction.predictions,
      features,     // returned for transparency — frontend can display which data was used
    });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.error('[risk] unhandled error:', msg, err?.stack ?? '');
    res.status(500).json({ error: msg });
  }
}
