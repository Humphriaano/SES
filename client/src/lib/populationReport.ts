// What the server's /reports/population/overview sends, and a small saved copy so the page still shows figures when the connection fails.
export interface ChronicRow {
  key: string; label: string; active: number; newInPeriod: number;
  female: number; male: number; other: number; under18: number; adults: number; older: number;
  seenRecently: number; notSeenRecently: number;
  bpControl: { controlled: number; notControlled: number; noRecentReading: number } | null;
}
export interface AgeSexRow { band: string; female: number; male: number; other: number; total: number }

export interface Overview {
  generatedAt: string;
  period: { from: string | null; to: string | null; label: string; allTime: boolean };
  patients: { total: number; newInPeriod: number | null; female: number; male: number; other: number; byAge: AgeSexRow[] };
  diagnoses: { total: number; top: { description: string; code: string; count: number }[] };
  medications: { prescriptions: number; dispensed: number; dispensedToday: number; top: { name: string; count: number }[] };
  investigations: {
    byStatus: { status: string; count: number }[]; byTest: { name: string; count: number }[];
    waiting: { pending: number; inProgress: number };
  };
  procedures: {
    done: number; doneViaRoom: number; medianWaitMinutes: number | null; sentToRoom: number; returned: number;
    waiting: { total: number; urgent: number; oldestOrderedAt: string | null };
    top: { name: string; count: number }[];
  };
  chronic: { rows: ChronicRow[]; patientsWithAny: number; patientsWithSeveral: number; seenDays: number; bp: { systolic: number; diastolic: number; recentDays: number } };
}

interface Saved { savedAt: string; data: Overview }
const key = (userId: string | undefined, id: string) => `ses.reports.overview.${userId ?? 'anon'}.${id}`;

// Saved figures are counts only, kept in this browser for this user. Every storage call can fail (private windows, blocked storage).
export function readSaved(userId: string | undefined, id: string): Saved | null {
  try {
    const raw = localStorage.getItem(key(userId, id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Saved;
    return parsed && typeof parsed.savedAt === 'string' && parsed.data && Array.isArray(parsed.data.chronic?.rows) ? parsed : null;
  } catch { return null; }
}
const KEEP = 8;   // saved periods kept per user; the oldest go first so custom ranges never fill the browser's storage
export function writeSaved(userId: string | undefined, id: string, data: Overview): void {
  try {
    localStorage.setItem(key(userId, id), JSON.stringify({ savedAt: new Date().toISOString(), data } satisfies Saved));
    const prefix = key(userId, ''), mine: { k: string; at: string }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(prefix)) continue;
      let at = '';
      try { at = (JSON.parse(localStorage.getItem(k) ?? 'null') as Saved | null)?.savedAt ?? ''; } catch { /* unreadable: treated as oldest */ }
      mine.push({ k, at });
    }
    mine.sort((a, b) => a.at.localeCompare(b.at)).slice(0, Math.max(0, mine.length - KEEP)).forEach(x => localStorage.removeItem(x.k));
  } catch { /* storage full or blocked: the page works without it */ }
}
