export interface RecentPatient { id: string; firstName: string; lastName: string; nationalId?: string | null; }

const KEY = 'ses-recent-patients';
const MAX = 5;

export function getRecent(): RecentPatient[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}

export function addRecent(p: RecentPatient) {
  const next = [
    { id: p.id, firstName: p.firstName, lastName: p.lastName, nationalId: p.nationalId ?? null },
    ...getRecent().filter((r) => r.id !== p.id),
  ].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
}
