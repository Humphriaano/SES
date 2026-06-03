import 'dotenv/config';
import * as path from 'path';
import * as XLSX from 'xlsx';
import prisma from '../lib/prisma';

const CHAPTER_NAMES: Record<string, string> = {
  '01': 'Infectious / Parasitic Diseases',
  '02': 'Neoplasms',
  '03': 'Blood & Blood-Forming Organs',
  '04': 'Immune System',
  '05': 'Endocrine / Nutritional / Metabolic',
  '06': 'Mental & Behavioural Disorders',
  '07': 'Sleep-Wake Disorders',
  '08': 'Nervous System',
  '09': 'Visual System',
  '10': 'Ear & Mastoid',
  '11': 'Circulatory System',
  '12': 'Respiratory System',
  '13': 'Digestive System',
  '14': 'Skin & Subcutaneous Tissue',
  '15': 'Musculoskeletal & Connective Tissue',
  '16': 'Genitourinary System',
  '17': 'Sexual Health',
  '18': 'Pregnancy, Childbirth & Puerperium',
  '19': 'Perinatal Conditions',
  '20': 'Developmental Anomalies',
  '21': 'Symptoms, Signs & Clinical Findings',
  '22': 'Injury & Poisoning',
  '23': 'External Causes',
  '24': 'Factors Influencing Health Status',
  '25': 'Special Purposes',
  'X':  'Extension Codes',
};

async function main() {
  const filePath = 'C:\\Users\\Hp\\Documents\\Projects\\SES\\Reference documents\\ICD 11.xlsx';
  console.log('Reading:', filePath);

  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Skip header row, filter rows that have both code and title
  const records = rows.slice(1)
    .filter(r => r[1] && r[3])
    .map(r => ({
      code:        String(r[1]).trim(),
      description: String(r[3]).trim(),
      category:    CHAPTER_NAMES[String(r[2]).trim()] ?? String(r[2]).trim(),
    }));

  console.log(`Parsed ${records.length} valid codes. Seeding in batches…`);

  const BATCH = 500;
  let inserted = 0;

  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const result = await prisma.iCD11Code.createMany({
      data: batch,
      skipDuplicates: true,
    });
    inserted += result.count;
    process.stdout.write(`\r  ${Math.min(i + BATCH, records.length)} / ${records.length} processed…`);
  }

  console.log(`\nDone — ${inserted} new codes inserted (${records.length - inserted} already existed).`);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
