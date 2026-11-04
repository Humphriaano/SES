import catalogJson from './drugCatalog.json';
import supplementJson from './drugSupplement.json';
import terminologyJson from './drugTerminology.json';
import { getCustomCatalogue } from '../lib/customCatalogue';
import { catalogueSearchRank } from '../lib/catalogueSearch';

export interface DrugVariant {
  rxCui?: string;
  rxnormName?: string;
  rxnormType?: string;
  codingScope?: string;
  atcCode?: string;
  dose: string;
  form: string;
  route: string;
  sku: string;
}

export interface DrugEntry extends DrugVariant {
  name: string;
  dose: string;
  form: string;
  route: string;
  sku: string;
  brand?: string;
  pendingReview?: boolean;
}

const catalog = { ...catalogJson, ...supplementJson.drugs } as Record<string, DrugVariant[]>;
const terminology = terminologyJson.mappings as Record<string, { rxCui: string; rxnormName: string; rxnormType: string; codingScope: string }>;

function aliases(name: string): string[] {
  const pairs = [
    ['paracetamol', 'acetaminophen'], ['adrenaline', 'epinephrine'],
    ['noradrenaline', 'norepinephrine'], ['salbutamol', 'albuterol'],
    ['lignocaine', 'lidocaine'], ['frusemide', 'furosemide'],
    ['amoxycillin', 'amoxicillin'], ['glibenclamide', 'glyburide'],
    ['hydroxycarbamide', 'hydroxyurea'], ['cefalexin', 'cephalexin'],
  ];
  const result: string[] = [];
  for (const [a, b] of pairs) {
    if (name.toLowerCase().includes(a)) result.push(name.replace(new RegExp(a, 'ig'), b));
    if (name.toLowerCase().includes(b)) result.push(name.replace(new RegExp(b, 'ig'), a));
  }
  if (/oral rehydration salts/i.test(name)) result.push('ORS');
  if (/co[ -]?trimoxazole/i.test(name)) result.push('trimethoprim sulfamethoxazole', 'TMP SMX');
  result.push(name.replace(/sulph/ig, 'sulf'));
  return result;
}

/** Match generic names, aliases, strength and verified identifiers; preserve dose/route/SKU. */
export function searchCatalog(query: string, limit = 12): DrugEntry[] {
  if (!query || query.length < 2) return [];
  const ranked: { rank: number; item: DrugEntry }[] = [];

  for (const [name, variants] of Object.entries(catalog)) {
    for (const v of variants) {
      const entry = { name, ...terminology[name], ...v };
      const rank = catalogueSearchRank(query, [name, ...aliases(name), `${name} ${v.dose} ${v.form}`, entry.rxCui, entry.rxnormName, entry.atcCode]);
      if (rank !== null) ranked.push({ rank, item: entry });
    }
  }
  // Drugs added by staff: found by generic or brand name
  for (const d of getCustomCatalogue().drugs) {
    if (!d.active) continue;
    const rank = catalogueSearchRank(query, [d.generic, d.brand, ...aliases(d.generic), `${d.generic} ${d.strength} ${d.form}`, d.atcCode, ...(d.ingredients ?? []).map(ingredient => ingredient.name)]);
    if (rank !== null) ranked.push({ rank, item: { name: d.generic, dose: d.strength, form: d.form, route: d.route, sku: d.code, brand: d.brand ?? undefined, atcCode: d.atcCode ?? undefined, pendingReview: d.pendingReview } });
  }
  return ranked.sort((a, b) => a.rank - b.rank).slice(0, Math.max(0, limit)).map(r => r.item);
}

/** Return all dose variants for an exact drug name. */
export function getDrugVariants(name: string): DrugVariant[] {
  const extra = getCustomCatalogue().drugs.filter(d => d.active && d.generic === name).map(d => ({ dose: d.strength, form: d.form, route: d.route, sku: d.code }));
  return [...(catalog[name] ?? []).map(variant => ({ ...terminology[name], ...variant })), ...extra];
}
