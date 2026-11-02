import 'dotenv/config';
import prisma from '../lib/prisma';
import { seedIcd11FromFile, DEFAULT_ICD11_FILE } from '../lib/icd11Seed';

// Usage: npx ts-node --transpile-only src/scripts/seedICD11.ts [path/to/codes.xlsx]
// Defaults to server/data/icd11-codes.xlsx. Safe to re-run — existing codes are skipped.
async function main() {
  const file = process.argv[2] ?? DEFAULT_ICD11_FILE;
  console.log('Reading:', file);
  const { parsed, inserted } = await seedIcd11FromFile(file);
  console.log(`Done — ${inserted} new codes inserted (${parsed - inserted} already existed).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
