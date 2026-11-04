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

export const DEFAULT_ICD11_FILE = path.join(__dirname, '..', '..', 'data', 'icd11-mms-2026-01.xlsx');

let sourceCache: { file: string; modified: number; records: { code: string; description: string; category: string }[]; codes: Set<string> } | null = null;

// Read the official WHO simple tabulation, with compatibility for the older two-column import.
export function readIcd11Records(file: string = DEFAULT_ICD11_FILE): { code: string; description: string; category: string }[] {
  const modified = fs.statSync(file).mtimeMs;
  if (sourceCache?.file === file && sourceCache.modified === modified) return sourceCache.records;
  const wb = XLSX.readFile(file);
  const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  const headers = (rows[0] ?? []).map(value => String(value).trim().toLowerCase());
  const official = headers.includes('classkind');
  const codeCol = official ? headers.indexOf('code') : 0;
  const titleCol = headers.indexOf('title') >= 0 ? headers.indexOf('title') : 1;
  const kindCol = headers.indexOf('classkind');
  const chapterCol = headers.indexOf('chapterno');
  const chapters = new Map<string, string>();
  if (official) for (const row of rows.slice(1)) {
    if (row[kindCol] === 'chapter') chapters.set(String(row[chapterCol]), String(row[titleCol]).trim());
  }

  const byCode = new Map<string, { code: string; description: string; category: string }>();
  for (const r of rows.slice(1)) {
    if (!r[codeCol] || !r[titleCol]) continue;
    const code = String(r[codeCol]).trim();
    if (official && (r[kindCol] !== 'category' || ['X', 'V', '26'].includes(String(r[chapterCol])))) continue;
    // Titles carry hierarchy indentation (tabs / leading dashes) from the WHO browser — strip it.
    const description = String(r[titleCol]).replace(/^[\s\-–—]+/, '').trim();
    if (!code || !description || byCode.has(code)) continue;
    byCode.set(code, { code, description, category: official ? chapters.get(String(r[chapterCol])) ?? 'Other' : CHAPTERS[code[0].toUpperCase()] ?? 'Other' });
  }

  const records = [...byCode.values()];
  sourceCache = { file, modified, records, codes: new Set(byCode.keys()) };
  return records;
}

export function selectableIcd11Codes(): Set<string> | null {
  if (!fs.existsSync(DEFAULT_ICD11_FILE)) return null;
  readIcd11Records();
  return sourceCache!.codes;
}

export async function seedIcd11FromFile(file: string = DEFAULT_ICD11_FILE): Promise<{ parsed: number; inserted: number }> {
  const records = readIcd11Records(file);
  let inserted = 0;
  for (let i = 0; i < records.length; i += 1000) {
    const res = await prisma.iCD11Code.createMany({ data: records.slice(i, i + 1000), skipDuplicates: true });
    inserted += res.count;
  }
  return { parsed: records.length, inserted };
}

// Reconcile missing official terms on startup; retain existing IDs, labels and clinical references.
export async function ensureIcd11Seeded(): Promise<void> {
  try {
    if (!fs.existsSync(DEFAULT_ICD11_FILE)) {
      console.warn(`[icd11] No condition list loaded and ${DEFAULT_ICD11_FILE} is missing — condition search will be empty.`);
      return;
    }
    const { parsed, inserted } = await seedIcd11FromFile();
    if (inserted) console.log(`[icd11] Added ${inserted} missing terms from ${parsed} ICD-11 MMS 2026-01 conditions.`);
  } catch (err: any) {
    console.error('[icd11] Could not load the ICD-11 condition list:', err?.message ?? err);
  }
}
