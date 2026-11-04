// Search aliases only. The selected result always retains its official WHO code and title.
const ALIASES: Record<string, string> = {
  'h pylori': 'helicobacter pylori', hpylori: 'helicobacter pylori',
  htn: 'hypertension', t2dm: 'type 2 diabetes', t1dm: 'type 1 diabetes',
  dm: 'diabetes mellitus', uti: 'urinary tract infection',
  urti: 'upper respiratory', copd: 'chronic obstructive pulmonary',
  ckd: 'chronic kidney disease', aki: 'acute kidney failure',
  gerd: 'gastro oesophageal reflux', gord: 'gastro oesophageal reflux',
  pud: 'peptic ulcer', tb: 'tuberculosis', mi: 'myocardial infarction',
  bph: 'prostatic hyperplasia', pcos: 'polycystic ovary',
};

export function diagnosisSearchTerm(raw: string): string {
  const term = raw.trim().replace(/\s+/g, ' ');
  // Keep dots in a code search, e.g. DA42.1.
  if (/^[a-z0-9]{2}\d[a-z0-9](?:\.[a-z0-9]*)?$/i.test(term) && /\d/.test(term)) return term;
  const normalized = term.toLowerCase().replace(/[.\-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!/[a-z0-9]/i.test(normalized)) return '';
  return ALIASES[normalized] ?? normalized;
}
