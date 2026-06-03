import catalogJson from './drugCatalog.json';

export interface DrugVariant {
  dose: string;
  form: string;
  route: string;
  sku: string;
}

export interface DrugEntry {
  name: string;
  dose: string;
  form: string;
  route: string;
  sku: string;
}

const catalog = catalogJson as Record<string, DrugVariant[]>;

/** Search catalog by prefix, returns up to `limit` entries with dose/route pre-filled. */
export function searchCatalog(query: string, limit = 12): DrugEntry[] {
  if (!query || query.length < 2) return [];
  const q = query.toLowerCase();
  const results: DrugEntry[] = [];

  for (const [name, variants] of Object.entries(catalog)) {
    if (results.length >= limit) break;
    if (!name.toLowerCase().includes(q)) continue;
    for (const v of variants) {
      if (results.length >= limit) break;
      results.push({ name, ...v });
    }
  }
  return results;
}

/** Return all dose variants for an exact drug name. */
export function getDrugVariants(name: string): DrugVariant[] {
  return catalog[name] ?? [];
}
