import catalogJson from './investigationsCatalogue.json';
import supplementJson from './investigationsSupplement.json';
import aliasesJson from './investigationsAliases.json';
import { catalogueSearchRank } from '../lib/catalogueSearch';
import { getCustomCatalogue, CustomTest } from '../lib/customCatalogue';

export interface CatalogueComponent {
  loinc?: string | null;
  loincName?: string;
  loincSource?: string;
  method?: string;
  searchNames?: string[];
  id: number;
  name: string;
  abbr: string;
  specimen: string;
  dataType: string;
  units: string | null;
  referenceRange: string | null;
  options?: string[];
}

export interface CataloguePanel {
  loinc?: string | null;
  loincName?: string;
  loincSource?: string;
  id: string;
  panelName: string;
  searchNames: string[];
  specimen: string;
  components: CatalogueComponent[];
}

export interface CatalogueSingle {
  loincName?: string;
  loincSource?: string;
  method?: string;
  searchNames?: string[];
  id: number;
  name: string;
  abbr: string;
  specimen: string;
  dataType: string;
  units: string | null;
  referenceRange: string | null;
  options?: string[];
  subType?: string;
  loinc?: string | null;
}

export type CatalogueResult =
  | { kind: 'panel'; item: CataloguePanel }
  | { kind: 'single'; item: CatalogueSingle };

const catalogue = {
  panels: [...catalogJson.panels, ...supplementJson.panels] as CataloguePanel[],
  singles: [...catalogJson.singles, ...supplementJson.singles] as CatalogueSingle[],
};
const panelAliases = aliasesJson.panels as Record<string, string[]>;
const singleAliases = aliasesJson.singles as Record<string, string[]>;

const asSingle = (t: CustomTest): CatalogueSingle => ({
  id: t.id, name: t.name, abbr: t.abbr ?? '', specimen: t.specimen, dataType: t.dataType, units: t.units,
  referenceRange: t.referenceRange, options: t.options.length ? t.options : undefined, subType: t.subType ?? undefined, loinc: t.loinc, searchNames: t.searchNames,
});

const allSingles = (): CatalogueSingle[] => [
  ...catalogue.singles,
  ...getCustomCatalogue().tests.filter(t => t.kind === 'SINGLE' && t.active).map(asSingle),
];

// A custom panel is built from single tests (built-in or added), so its components follow those tests.
function customPanels(): CataloguePanel[] {
  const singles = allSingles();
  return getCustomCatalogue().tests.filter(t => t.kind === 'PANEL' && t.active).map(t => ({
    id: t.panelId ?? `cpanel_${t.seq}`,
    panelName: t.name,
    searchNames: [t.name, ...(t.abbr ? [t.abbr] : []), ...t.searchNames],
    specimen: t.specimen,
    loinc: t.loinc,
    components: t.componentIds.map(id => singles.find(s => s.id === id)).filter((s): s is CatalogueSingle => !!s)
      .map(s => ({ id: s.id, name: s.name, abbr: s.abbr, specimen: s.specimen, dataType: s.dataType, units: s.units, referenceRange: s.referenceRange, options: s.options, loinc: s.loinc })),
  }));
}

export const allPanels = (): CataloguePanel[] => [...catalogue.panels, ...customPanels()];
export { allSingles };

export function searchCatalogue(query: string, limit = 15): CatalogueResult[] {
  if (!query || query.trim().length < 2 || limit <= 0) return [];
  const ranked: { rank: number; result: CatalogueResult }[] = [];
  for (const panel of allPanels()) {
    const rank = catalogueSearchRank(query, [panel.panelName, panel.loinc, ...panel.searchNames, ...(panelAliases[panel.id] ?? [])]);
    if (rank !== null) ranked.push({ rank, result: { kind: 'panel', item: panel } });
  }
  for (const single of allSingles()) {
    if (single.id === 0 || single.name === 'Unspecified') continue;
    const rank = catalogueSearchRank(query, [single.name, single.abbr, single.loinc, single.specimen, ...(single.searchNames ?? []), ...(singleAliases[single.id] ?? [])]);
    if (rank !== null) ranked.push({ rank, result: { kind: 'single', item: single } });
  }
  return ranked.sort((a, b) => a.rank - b.rank).slice(0, limit).map(r => r.result);
}

export function getPanelById(id: string): CataloguePanel | undefined {
  return allPanels().find(p => p.id === id);
}

export function getSingleById(id: number): CatalogueSingle | undefined {
  return allSingles().find(s => s.id === id);
}
