import catalogJson from './investigationsCatalogue.json';

export interface CatalogueComponent {
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
  id: string;
  panelName: string;
  searchNames: string[];
  specimen: string;
  components: CatalogueComponent[];
}

export interface CatalogueSingle {
  id: number;
  name: string;
  abbr: string;
  specimen: string;
  dataType: string;
  units: string | null;
  referenceRange: string | null;
  options?: string[];
  subType?: string;
}

export type CatalogueResult =
  | { kind: 'panel'; item: CataloguePanel }
  | { kind: 'single'; item: CatalogueSingle };

const catalogue = catalogJson as { panels: CataloguePanel[]; singles: CatalogueSingle[] };

export function searchCatalogue(query: string, limit = 15): CatalogueResult[] {
  if (!query || query.length < 2) return [];
  const q = query.toLowerCase();
  const results: CatalogueResult[] = [];

  for (const panel of catalogue.panels) {
    if (results.length >= limit) break;
    const matches =
      panel.searchNames.some(s => s.toLowerCase().includes(q)) ||
      panel.panelName.toLowerCase().includes(q);
    if (matches) results.push({ kind: 'panel', item: panel });
  }

  for (const single of catalogue.singles) {
    if (results.length >= limit) break;
    if (
      single.name.toLowerCase().includes(q) ||
      (single.abbr && single.abbr.toLowerCase().includes(q))
    ) {
      results.push({ kind: 'single', item: single });
    }
  }
  return results;
}

export function getPanelById(id: string): CataloguePanel | undefined {
  return catalogue.panels.find(p => p.id === id);
}

export function getSingleById(id: number): CatalogueSingle | undefined {
  return catalogue.singles.find(s => s.id === id);
}
