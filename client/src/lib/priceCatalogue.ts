import drugJson from '../data/drugCatalog.json';
import drugSupplement from '../data/drugSupplement.json';
import invJson from '../data/investigationsCatalogue.json';
import invSupplement from '../data/investigationsSupplement.json';

export interface CatalogueSeed {
  itemType: 'DRUG' | 'INVESTIGATION';
  catalogueRef: string;
  name: string;
  detail: string;
  unit: string;
}

interface DrugVariant { dose: string; form: string; route: string; sku: string }
interface Panel { id: string; panelName: string; specimen: string; loinc?: string }
interface Single { id: number; name: string; specimen: string; subType?: string; loinc?: string }

// Every drug and test the app can order, in the shape the price list stores them.
// Investigation keys match what the consultation saves on an order (e.g. "single_31", "panel_panel_0"),
// so a charge can look its price up directly later.
export function catalogueSeeds(): CatalogueSeed[] {
  const out: CatalogueSeed[] = [];

  for (const [name, variants] of Object.entries({ ...drugJson, ...drugSupplement.drugs } as Record<string, DrugVariant[]>)) {
    for (const v of variants) {
      out.push({
        itemType: 'DRUG', catalogueRef: v.sku, name,
        detail: [v.dose, v.form, v.route].filter(Boolean).join(' · '), unit: 'per unit',
      });
    }
  }

  const inv = { panels: [...invJson.panels, ...invSupplement.panels], singles: [...invJson.singles, ...invSupplement.singles] } as unknown as { panels: Panel[]; singles: Single[] };
  for (const p of inv.panels) {
    out.push({ itemType: 'INVESTIGATION', catalogueRef: `panel_${p.id}`, name: p.panelName, detail: [`Panel · ${p.specimen}`, p.loinc ? `LOINC ${p.loinc}` : ''].filter(Boolean).join(' · '), unit: 'per panel' });
  }
  for (const s of inv.singles) {
    if (s.id === 0 || s.name === 'Unspecified') continue;   // placeholder entry, not a real test
    out.push({ itemType: 'INVESTIGATION', catalogueRef: `single_${s.id}`, name: s.name, detail: [s.specimen, s.subType, s.loinc ? `LOINC ${s.loinc}` : ''].filter(Boolean).join(' · '), unit: 'per test' });
  }
  return out;
}
