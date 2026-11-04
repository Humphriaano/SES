import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { commonCodes } from '../lib/icd11Common';
import { seedIcd11FromFile, selectableIcd11Codes } from '../lib/icd11Seed';
import { diagnosisSearchTerm } from '../lib/diagnosisSearch';

const WHO_CLIENT_ID = process.env.WHO_ICD11_CLIENT_ID;
const WHO_CLIENT_SECRET = process.env.WHO_ICD11_CLIENT_SECRET;

let tokenCache: { token: string; expires: number } | null = null;

async function getWHOToken(): Promise<string | null> {
  if (!WHO_CLIENT_ID || !WHO_CLIENT_SECRET) return null;
  if (tokenCache && Date.now() < tokenCache.expires) return tokenCache.token;

  try {
    const res = await fetch('https://icdaccessmanagement.who.int/connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: WHO_CLIENT_ID,
        client_secret: WHO_CLIENT_SECRET,
        scope: 'icdapi_access',
        grant_type: 'client_credentials',
      }),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    tokenCache = {
      token: data.access_token,
      expires: Date.now() + (data.expires_in - 60) * 1000,
    };
    return tokenCache.token;
  } catch {
    return null;
  }
}

async function whoSearch(q: string): Promise<any[] | null> {
  const token = await getWHOToken();
  if (!token) return null;

  try {
    const url = new URL('https://id.who.int/icd/release/11/2026-01/mms/search');
    url.searchParams.set('q', q);
    url.searchParams.set('flatResults', 'true');
    url.searchParams.set('highlightingEnabled', 'false');

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        'API-Version': 'v2',
        'Accept-Language': 'en',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const data: any = await res.json();

    return (data.destinationEntities ?? []).slice(0, 15).map((e: any) => ({
      id: e.stemId ?? e.id ?? e.theCode,
      code: e.theCode ?? '',
      description: stripHtml(e.title ?? ''),
      category: chapterLabel(e.chapter ?? ''),
    }));
  } catch {
    return null;
  }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

function chapterLabel(chapter: string): string {
  const map: Record<string, string> = {
    '01': 'Infectious/Parasitic', '02': 'Neoplasms', '03': 'Blood/Immune',
    '04': 'Immune System', '05': 'Endocrine/Metabolic', '06': 'Mental/Behavioural',
    '07': 'Sleep/Wake', '08': 'Nervous System', '09': 'Visual System',
    '10': 'Ear/Mastoid', '11': 'Circulatory', '12': 'Respiratory',
    '13': 'Digestive', '14': 'Skin', '15': 'Musculoskeletal',
    '16': 'Genitourinary', '17': 'Sexual Health', '18': 'Pregnancy/Childbirth',
    '19': 'Perinatal', '20': 'Developmental', '21': 'Congenital',
    '22': 'Symptoms/Signs', '23': 'Injury/Poisoning', '24': 'External Causes',
  };
  const num = chapter.replace(/\D/g, '').slice(0, 2).padStart(2, '0');
  return map[num] ?? chapter;
}

export async function searchICD11(req: Request, res: Response): Promise<void> {
  const { q } = req.query as { q?: string };
  if (!q || q.trim().length < 2) { res.json([]); return; }

  const expanded = diagnosisSearchTerm(q);
  if (!expanded) { res.json([]); return; }
  const whoResults = await whoSearch(expanded);
  if (whoResults?.length) {
    // Diagnoses staff added aren't in the WHO list, so put any that match first.
    const mine = await prisma.iCD11Code.findMany({
      where: { isCustom: true, OR: [{ code: { contains: q.trim(), mode: 'insensitive' } }, { description: { contains: q.trim(), mode: 'insensitive' } }] },
      take: 5,
    });
    // WHO entity URIs are not database IDs. Resolve verified codes to local rows before selection.
    const selectable = selectableIcd11Codes();
    const canonical = await Promise.all(whoResults.filter(c => c.code && !/^[XV]/.test(c.code) && (!selectable || selectable.has(c.code))).map(c => prisma.iCD11Code.upsert({
      where: { code: c.code }, create: { code: c.code, description: c.description, category: c.category }, update: {},
    })));
    const unique = new Map([...mine, ...canonical].map(c => [c.code, c]));
    res.json([...unique.values()].slice(0, 15)); return;
  }

  // Local catalogue: every word must appear (in any order) in the code or the name,
  // so "diabetes type 2" finds "Type 2 diabetes mellitus".
  const term = expanded.toLowerCase();
  const words = term.split(/\s+/).filter(Boolean);
  const found = await prisma.iCD11Code.findMany({
    where: {
      NOT: [{ code: { startsWith: 'X' } }, { code: { startsWith: 'V' } }],
      AND: words.map((w) => ({
        OR: [
          { code: { contains: w, mode: 'insensitive' as const } },
          { description: { contains: w, mode: 'insensitive' as const } },
        ],
      })),
    },
    take: 150,
  });

  // Rank: exact code, then code prefix, then names starting with the search, then names with a word starting with it.
  const rank = (c: { code: string; description: string }) => {
    const code = c.code.toLowerCase();
    const name = c.description.toLowerCase();
    if (code === term) return 0;
    if (code.startsWith(term)) return 1;
    if (name.startsWith(term)) return 2;
    if (words.every((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(name))) return 3;
    return 4;
  };
  const selectable = selectableIcd11Codes();
  // Retired/historical and extension codes remain in the database for old notes,
  // while new selections use the current conventional-care MMS catalogue.
  const current = selectable ? found.filter(c => c.isCustom || selectable.has(c.code)) : found;
  res.json(current.sort((a, b) => rank(a) - rank(b) || a.description.length - b.description.length).slice(0, 15));
}

// Local fallback catalogue used whenever the WHO ICD-11 API isn't reachable
// (no WHO_ICD11_CLIENT_ID/SECRET configured, or the API call fails) — see
// whoSearch() above. Kept broad enough to cover common outpatient/ED
// presentations so search stays usable without live WHO credentials.
export { commonCodes } from '../lib/icd11Common';

export async function seedICD11(_req: Request, res: Response): Promise<void> {
  try {
    const { parsed, inserted } = await seedIcd11FromFile();
    res.json({ message: `Loaded ${inserted} new ICD-11 codes (${parsed} in the list)` });
  } catch {
    // The full list file is missing — fall back to the built-in common conditions.
    await prisma.iCD11Code.createMany({ data: commonCodes, skipDuplicates: true });
    res.json({ message: `Seeded ${commonCodes.length} common ICD-11 codes` });
  }
}
