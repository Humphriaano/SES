import prisma from '../lib/prisma';

export interface MatchedCondition {
  diagnosisId: string;
  icdCode: string;
  icdDescription: string;
  firstRecordedAt: Date;
  resolvedAt: Date | null;
  conditionKey: string | null;
  plainName: string;
  plainDescription: string | null;
  patientStatus: string; // patient-friendly wording
  tip: string | null;
  mythBuster: { myth: string; truth: string } | null;
}

interface DiagnosisWithIcd {
  id: string;
  createdAt: Date;
  resolvedAt: Date | null;
  icd11: { code: string; description: string };
}

// Conditions we treat as chronic / long-term for patient-friendly status wording.
const CHRONIC_KEYS = new Set([
  'hypertension', 'diabetes-type-2', 'diabetes-type-1', 'asthma', 'hiv',
  'chronic-kidney-disease', 'heart-failure', 'epilepsy', 'copd', 'obesity',
]);

function patientStatusFor(conditionKey: string | null, resolvedAt: Date | null): string {
  if (resolvedAt) return 'Resolved';
  if (conditionKey && CHRONIC_KEYS.has(conditionKey)) return 'Ongoing — being managed with your care team';
  return 'Confirmed — under review by your care team';
}

// Rotate education content month-by-month so repeat visits see fresh tips.
function rotate<T>(items: T[], seed: number): T | null {
  if (!items || items.length === 0) return null;
  return items[seed % items.length] ?? null;
}

/**
 * Match a patient's active diagnoses against the ConditionContent library
 * (by ICD-11 code prefix or description term) and attach plain-language
 * naming, status wording, and month-rotated education content.
 */
export async function matchConditions(diagnoses: DiagnosisWithIcd[], now = new Date()): Promise<MatchedCondition[]> {
  const library = await prisma.conditionContent.findMany();
  const monthSeed = now.getFullYear() * 12 + now.getMonth();

  return diagnoses.map((d) => {
    const code = d.icd11.code.toUpperCase();
    const desc = d.icd11.description.toLowerCase();
    const entry = library.find((c) => {
      const prefixes = c.icdPrefixes.split(',').map((p) => p.trim().toUpperCase()).filter(Boolean);
      const terms = c.matchTerms.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
      return prefixes.some((p) => code.startsWith(p)) || terms.some((t) => t && desc.includes(t));
    });

    const tips = (entry?.tips as string[] | undefined) ?? [];
    const myths = (entry?.mythBusters as { myth: string; truth: string }[] | undefined) ?? [];

    return {
      diagnosisId: d.id,
      icdCode: d.icd11.code,
      icdDescription: d.icd11.description,
      firstRecordedAt: d.createdAt,
      resolvedAt: d.resolvedAt,
      conditionKey: entry?.conditionKey ?? null,
      plainName: entry?.plainName ?? d.icd11.description,
      plainDescription: entry?.plainDescription ?? null,
      patientStatus: patientStatusFor(entry?.conditionKey ?? null, d.resolvedAt),
      tip: rotate(tips, monthSeed),
      mythBuster: rotate(myths, monthSeed),
    };
  });
}
