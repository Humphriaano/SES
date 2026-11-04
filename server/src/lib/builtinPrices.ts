import fs from 'fs';
import path from 'path';
import { PriceItemType } from '@prisma/client';
import prisma from './prisma';

// Metadata only: clinical staff can initialize an unpriced catalogue item without
// needing administration to load the same built-in catalogue first.
export async function ensureBuiltinPrices(): Promise<void> {
  try {
    const file = path.join(__dirname, '..', '..', 'data', 'builtin-price-items.json');
    if (!fs.existsSync(file)) return;
    const rows = JSON.parse(fs.readFileSync(file, 'utf8')) as { itemType: PriceItemType; catalogueRef: string; name: string; detail: string; unit: string }[];
    for (let i = 0; i < rows.length; i += 500) {
      await prisma.priceListItem.createMany({ data: rows.slice(i, i + 500), skipDuplicates: true });
    }
  } catch (err: any) { console.error('[price] Could not initialize catalogue metadata:', err?.message ?? err); }
}
