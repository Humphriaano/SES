import { Request, Response } from 'express';
import prisma from '../lib/prisma';

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
    const url = new URL('https://id.who.int/icd/release/11/2024-01/mms/search');
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
  if (!q || q.length < 2) { res.json([]); return; }

  const whoResults = await whoSearch(q);
  if (whoResults) { res.json(whoResults); return; }

  // Fallback: local seeded codes
  const codes = await prisma.iCD11Code.findMany({
    where: {
      OR: [
        { code: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ],
    },
    take: 15,
  });
  res.json(codes);
}

export async function seedICD11(req: Request, res: Response): Promise<void> {
  const commonCodes = [
    { code: '1C62.Z', description: 'HIV disease, unspecified', category: 'Infectious diseases' },
    { code: 'BA80',   description: 'Essential hypertension', category: 'Cardiovascular' },
    { code: '5A11',   description: 'Type 2 diabetes mellitus', category: 'Endocrine' },
    { code: '5A10',   description: 'Type 1 diabetes mellitus', category: 'Endocrine' },
    { code: 'BA41',   description: 'Heart failure, unspecified', category: 'Cardiovascular' },
    { code: 'CB41',   description: 'Asthma', category: 'Respiratory' },
    { code: 'DB94.Z', description: 'Chronic kidney disease, unspecified stage', category: 'Renal' },
    { code: 'DC10',   description: 'Peptic ulcer disease', category: 'Gastrointestinal' },
    { code: 'FA24.Z', description: 'Rheumatoid arthritis, unspecified', category: 'Musculoskeletal' },
    { code: '6A70',   description: 'Depression, single episode', category: 'Mental health' },
    { code: '8A00.0', description: 'Ischaemic stroke, unspecified', category: 'Neurological' },
    { code: 'BA81',   description: 'Secondary hypertension', category: 'Cardiovascular' },
    { code: '5A20',   description: 'Obesity', category: 'Endocrine' },
    { code: 'KB21',   description: 'Malaria due to Plasmodium falciparum', category: 'Infectious diseases' },
    { code: '1B10',   description: 'Pulmonary tuberculosis', category: 'Infectious diseases' },
    { code: 'DB93',   description: 'Chronic hepatitis B', category: 'Hepatic' },
    { code: 'DB94',   description: 'Chronic hepatitis C', category: 'Hepatic' },
    { code: '5A71',   description: 'Hypothyroidism', category: 'Endocrine' },
    { code: 'BA90',   description: 'Atrial fibrillation', category: 'Cardiovascular' },
    { code: 'CB00',   description: 'COPD', category: 'Respiratory' },
  ];
  await prisma.iCD11Code.createMany({ data: commonCodes, skipDuplicates: true });
  res.json({ message: `Seeded ${commonCodes.length} ICD-11 codes` });
}
