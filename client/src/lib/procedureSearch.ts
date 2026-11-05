// Searching the procedure list. Pure and offline: every word you type must start a word of the procedure's name
// or of its alternative names (cannula, drip, IV access), in any order, so "iv cann" and "cannulation" both find it.
export interface ProcedureOption { code: string; name: string; category: string; aliases?: string }

const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9&]+/g, ' ').trim().split(/\s+/).filter(Boolean);

export function searchProcedures(options: ProcedureOption[], query: string, limit = 8): ProcedureOption[] {
  const typed = words(query);
  if (!typed.length || typed.join('').length < 2) return [];
  const scored: { option: ProcedureOption; score: number }[] = [];
  for (const option of options) {
    const nameWords = words(option.name), otherWords = words(option.aliases ?? '');
    const every = typed.every(t => nameWords.some(w => w.startsWith(t)) || otherWords.some(w => w.startsWith(t)));
    if (!every) continue;
    // Best first: the name starts with what was typed, then every word is in the name, then only via an alternative name.
    const name = nameWords.join(' ');
    const score = name.startsWith(typed.join(' ')) ? 3 : typed.every(t => nameWords.some(w => w.startsWith(t))) ? 2 : 1;
    scored.push({ option, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.option.name.length - b.option.name.length || a.option.name.localeCompare(b.option.name)).slice(0, limit).map(x => x.option);
}

// Procedures an admin added by hand on the price list also appear, after the built-in ones.
export function mergeProcedures(builtin: ProcedureOption[], custom: ProcedureOption[]): ProcedureOption[] {
  const known = new Set(builtin.map(o => o.code));
  return [...builtin, ...custom.filter(o => !known.has(o.code))];
}

// What the doctor reaches for most, shown before anything is typed (by price-list reference).
export const QUICK_PICKS = [
  'procedure_peripheral_iv_cannulation', 'procedure_wound_dressing', 'procedure_suturing_of_wound', 'procedure_intramuscular_injection',
  'procedure_nebulisation', 'procedure_urinary_catheterisation', 'procedure_12_lead_ecg_recording', 'procedure_venepuncture_blood_draw',
];
