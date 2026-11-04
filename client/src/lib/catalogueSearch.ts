export function normalizeCatalogueSearch(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

// Match names, abbreviations and identifiers; punctuation must not hide H. pylori.
export function catalogueSearchRank(query: string, fields: (string | null | undefined)[]): number | null {
  const term = normalizeCatalogueSearch(query);
  if (term.length < 2) return null;
  const names = fields.filter((s): s is string => !!s).map(normalizeCatalogueSearch);
  if (names.some(name => name === term)) return 0;
  if (names.some(name => name.startsWith(term))) return 1;
  const combined = names.join(' ');
  if (term.split(' ').every(word => combined.includes(word))) return 2;
  const compact = term.replace(/ /g, '');
  if (compact.length >= 3 && names.some(name => name.replace(/ /g, '').includes(compact))) return 3;
  return null;
}
