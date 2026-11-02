import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import prisma from './prisma';

// ICD-11 MMS chapters are identified by the first character of the code.
const CHAPTERS: Record<string, string> = {
  '1': 'Infectious / Parasitic Diseases', '2': 'Neoplasms', '3': 'Blood & Blood-Forming Organs', '4': 'Immune System',
  '5': 'Endocrine / Nutritional / Metabolic', '6': 'Mental & Behavioural Disorders', '7': 'Sleep-Wake Disorders',
  '8': 'Nervous System', '9': 'Visual System', A: 'Ear & Mastoid', B: 'Circulatory System', C: 'Respiratory System',
  D: 'Digestive System', E: 'Skin & Subcutaneous Tissue', F: 'Musculoskeletal & Connective Tissue', G: 'Genitourinary System',
  H: 'Sexual Health', J: 'Pregnancy, Childbirth & Puerperium', K: 'Perinatal Conditions', L: 'Developmental Anomalies',
  M: 'Symptoms, Signs & Clinical Findings', N: 'Injury & Poisoning', P: 'External Causes', Q: 'Factors Influencing Health Status',
  R: 'Special Purposes', S: 'Traditional Medicine', X: 'Extension Codes',
};

export const DEFAULT_ICD11_FILE = path.join(__dirname, '..', '..', 'data', 'icd11-codes.xlsx');

// Reads a two-column sheet ("ICD11 CODE", "Title") and inserts every code that isn't already there.
export async function seedIcd11FromFile(file: string = DEFAULT_ICD11_FILE): Promise<{ parsed: number; inserted: number }> {
  const wb = XLSX.readFile(file);
  const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });

  const byCode = new Map<string, { code: string; description: string; category: string }>();
  for (const r of rows.slice(1)) {
    if (!r[0] || !r[1]) continue;
    const code = String(r[0]).trim();
    // Titles carry hierarchy indentation (tabs / leading dashes) from the WHO browser — strip it.
    const description = String(r[1]).replace(/^[\s\-–—]+/, '').trim();
    if (!code || !description || byCode.has(code)) continue;
    byCode.set(code, { code, description, category: CHAPTERS[code[0].toUpperCase()] ?? 'Other' });
  }

  const records = [...byCode.values()];
  let inserted = 0;
  for (let i = 0; i < records.length; i += 1000) {
    const res = await prisma.iCD11Code.createMany({ data: records.slice(i, i + 1000), skipDuplicates: true });
    inserted += res.count;
  }
  return { parsed: records.length, inserted };
}

// Called on server start: a brand-new database has no conditions to search, which breaks
// diagnosis and past-medical-history lookups. Fill it automatically if it is empty.
export async function ensureIcd11Seeded(): Promise<void> {
  try {
    if ((await prisma.iCD11Code.count()) > 0) return;
    if (!fs.existsSync(DEFAULT_ICD11_FILE)) {
      console.warn(`[icd11] No condition list loaded and ${DEFAULT_ICD11_FILE} is missing — condition search will be empty.`);
      return;
    }
    const { parsed, inserted } = await seedIcd11FromFile();
    console.log(`[icd11] Loaded ${inserted} of ${parsed} ICD-11 conditions into the empty database.`);
  } catch (err: any) {
    console.error('[icd11] Could not load the ICD-11 condition list:', err?.message ?? err);
  }
}
