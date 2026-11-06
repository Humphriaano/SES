// The HIA2 return screen's logic: which months can be chosen, what to ask for, and how the rows the server sends are laid out as the form lays them out.
// Apart from the screen so it can be tested.

export interface Row { code: string; section: string; age: string; sex: string; value: number }
export interface GridCell { code: string; sex: string; value: number }
export interface GridRow { age: string; cells: GridCell[] }
export interface GridSection { label: string; rows: GridRow[] }

const MONTHS = 24;
const pad = (n: number) => String(n).padStart(2, '0');
export const monthId = (year: number, monthIndex: number) => `${year}-${pad(monthIndex + 1)}`;
export const monthText = (id: string): string => {
  const m = /^(\d{4})-(\d{2})$/.exec(id);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '';
};

// The months of the return: this month and the 23 before it, newest first. The month in progress is allowed but the one to report is the last whole month.
export function monthChoices(today: Date = new Date()): { id: string; label: string }[] {
  return Array.from({ length: MONTHS }, (_, i) => { const d = new Date(today.getFullYear(), today.getMonth() - i, 1); const id = monthId(d.getFullYear(), d.getMonth()); return { id, label: monthText(id) }; });
}
export const defaultMonth = (today: Date = new Date()): string => monthChoices(today)[1]!.id;
export const isMonth = (id: string, today: Date = new Date()) => monthChoices(today).some(m => m.id === id);

export function countParams(month: string): Record<string, string> { return { month }; }
// The attendances behind one cell of the form, or all of the month's when no code is given.
export function listParams(month: string, code: string | null, names: boolean): Record<string, string> {
  return { month, ...(code ? { code } : {}), ...(names ? { names: '1' } : {}) };
}

// The server's rows in the order of the form, grouped as the form groups them: a section, its age rows, and Male, Female, Total across.
export function buildGrid(rows: Row[]): GridSection[] {
  const sections: GridSection[] = [];
  for (const r of rows) {
    let section = sections.find(s => s.label === r.section);
    if (!section) { section = { label: r.section, rows: [] }; sections.push(section); }
    let line = section.rows.find(x => x.age === r.age);
    if (!line) { line = { age: r.age, cells: [] }; section.rows.push(line); }
    line.cells.push({ code: r.code, sex: r.sex, value: r.value });
  }
  return sections;
}

// "OPD1-055: First attendances, 15+ years, Female".
export function cellLabel(rows: Row[], code: string): string {
  const r = rows.find(x => x.code === code);
  return r ? `${r.code}: ${r.section}, ${r.age === 'Total' ? 'all ages' : r.age}, ${r.sex}` : code;
}
