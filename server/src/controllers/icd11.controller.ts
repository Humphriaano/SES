import { Request, Response } from 'express';
import prisma from '../lib/prisma';

const WHO_CLIENT_ID     = process.env.WHO_ICD11_CLIENT_ID;
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
        client_id:     WHO_CLIENT_ID,
        client_secret: WHO_CLIENT_SECRET,
        scope:         'icdapi_access',
        grant_type:    'client_credentials',
      }),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    tokenCache = { token: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000 };
    return tokenCache.token;
  } catch { return null; }
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
      id:          e.stemId ?? e.id ?? e.theCode,
      code:        e.theCode ?? '',
      description: stripHtml(e.title ?? ''),
      category:    chapterLabel(e.chapter ?? ''),
    }));
  } catch { return null; }
}

function stripHtml(s: string): string { return s.replace(/<[^>]*>/g, ''); }

function chapterLabel(chapter: string): string {
  const map: Record<string, string> = {
    '01': 'Infectious/Parasitic', '02': 'Neoplasms', '03': 'Blood/Immune',
    '04': 'Immune System',        '05': 'Endocrine/Metabolic', '06': 'Mental/Behavioural',
    '07': 'Sleep/Wake',           '08': 'Nervous System', '09': 'Visual System',
    '10': 'Ear/Mastoid',          '11': 'Circulatory', '12': 'Respiratory',
    '13': 'Digestive',            '14': 'Skin', '15': 'Musculoskeletal',
    '16': 'Genitourinary',        '17': 'Sexual Health', '18': 'Pregnancy/Childbirth',
    '19': 'Perinatal',            '20': 'Developmental', '21': 'Congenital',
    '22': 'Symptoms/Signs',       '23': 'Injury/Poisoning', '24': 'External Causes',
  };
  const num = chapter.replace(/\D/g, '').slice(0, 2).padStart(2, '0');
  return map[num] ?? chapter;
}

// ── Bundled seed dataset (150+ common ICD-11 codes) ─────────────────────────

const COMMON_CODES = [
  // Infectious / Parasitic
  { code: '1C62.Z', description: 'HIV disease, unspecified',                          category: 'Infectious/Parasitic' },
  { code: '1B10',   description: 'Pulmonary tuberculosis',                             category: 'Infectious/Parasitic' },
  { code: 'KB21',   description: 'Malaria due to Plasmodium falciparum',               category: 'Infectious/Parasitic' },
  { code: '1C81',   description: 'COVID-19',                                           category: 'Infectious/Parasitic' },
  { code: '1D00',   description: 'Cholera',                                            category: 'Infectious/Parasitic' },
  { code: '1A00',   description: 'Typhoid fever',                                      category: 'Infectious/Parasitic' },
  { code: '1C32',   description: 'Hepatitis B',                                        category: 'Infectious/Parasitic' },
  { code: '1E50',   description: 'Dengue fever',                                       category: 'Infectious/Parasitic' },
  { code: 'DB93',   description: 'Chronic hepatitis B',                                category: 'Infectious/Parasitic' },
  { code: 'DB94',   description: 'Chronic hepatitis C',                                category: 'Infectious/Parasitic' },
  { code: '1B11',   description: 'Extrapulmonary tuberculosis',                        category: 'Infectious/Parasitic' },
  { code: '1G40',   description: 'Sepsis',                                             category: 'Infectious/Parasitic' },
  { code: '1C60',   description: 'Symptomatic HIV disease',                            category: 'Infectious/Parasitic' },
  { code: '1A96',   description: 'Urinary tract infection',                            category: 'Infectious/Parasitic' },
  { code: 'CA08',   description: 'Pneumonia, unspecified',                             category: 'Infectious/Parasitic' },

  // Neoplasms
  { code: '2C10',   description: 'Carcinoma of breast',                                category: 'Neoplasms' },
  { code: '2C83',   description: 'Carcinoma of cervix uteri',                          category: 'Neoplasms' },
  { code: '2C25',   description: 'Carcinoma of prostate',                              category: 'Neoplasms' },
  { code: '2C18',   description: 'Carcinoma of colon',                                 category: 'Neoplasms' },
  { code: '2C20',   description: 'Carcinoma of rectum',                                category: 'Neoplasms' },
  { code: '2C73',   description: 'Carcinoma of lung, unspecified',                     category: 'Neoplasms' },
  { code: '2C90',   description: 'Carcinoma of liver',                                 category: 'Neoplasms' },
  { code: '2B52',   description: 'Non-Hodgkin lymphoma',                               category: 'Neoplasms' },
  { code: '2B33',   description: 'Chronic lymphocytic leukaemia',                      category: 'Neoplasms' },

  // Blood / Haematological
  { code: '3A00',   description: 'Iron deficiency anaemia',                            category: 'Blood/Haematological' },
  { code: '3A51',   description: 'Sickle cell disease',                                category: 'Blood/Haematological' },
  { code: '3B10',   description: 'Haemophilia A',                                      category: 'Blood/Haematological' },
  { code: '3B64',   description: 'Immune thrombocytopenia',                            category: 'Blood/Haematological' },
  { code: '3A30',   description: 'Vitamin B12 deficiency anaemia',                     category: 'Blood/Haematological' },
  { code: '3A70',   description: 'Aplastic anaemia',                                   category: 'Blood/Haematological' },

  // Endocrine / Metabolic
  { code: '5A10',   description: 'Type 1 diabetes mellitus',                           category: 'Endocrine/Metabolic' },
  { code: '5A11',   description: 'Type 2 diabetes mellitus',                           category: 'Endocrine/Metabolic' },
  { code: '5A20',   description: 'Obesity',                                            category: 'Endocrine/Metabolic' },
  { code: '5A71',   description: 'Hypothyroidism',                                     category: 'Endocrine/Metabolic' },
  { code: '5A00',   description: 'Hyperthyroidism',                                    category: 'Endocrine/Metabolic' },
  { code: '5C50',   description: 'Hyperlipidaemia, unspecified',                       category: 'Endocrine/Metabolic' },
  { code: '5C57',   description: 'Mixed hyperlipidaemia',                              category: 'Endocrine/Metabolic' },
  { code: '5A21',   description: 'Overweight',                                         category: 'Endocrine/Metabolic' },
  { code: '5D41',   description: 'Gout',                                               category: 'Endocrine/Metabolic' },
  { code: '5A72',   description: 'Subclinical hypothyroidism',                         category: 'Endocrine/Metabolic' },
  { code: '5A40',   description: 'Adrenal insufficiency',                              category: 'Endocrine/Metabolic' },

  // Mental / Behavioural
  { code: '6A70',   description: 'Depression, single episode',                         category: 'Mental/Behavioural' },
  { code: '6A71',   description: 'Depression, recurrent',                              category: 'Mental/Behavioural' },
  { code: '6A80',   description: 'Generalised anxiety disorder',                       category: 'Mental/Behavioural' },
  { code: '6A00',   description: 'Schizophrenia',                                      category: 'Mental/Behavioural' },
  { code: '6A60',   description: 'Bipolar type I disorder',                            category: 'Mental/Behavioural' },
  { code: '6C40',   description: 'Alcohol dependence',                                 category: 'Mental/Behavioural' },
  { code: '6A40',   description: 'Attention deficit hyperactivity disorder',           category: 'Mental/Behavioural' },
  { code: '6B00',   description: 'Post-traumatic stress disorder',                     category: 'Mental/Behavioural' },
  { code: '6B81',   description: 'Panic disorder',                                     category: 'Mental/Behavioural' },

  // Nervous System
  { code: '8A00.0', description: 'Ischaemic stroke, unspecified',                      category: 'Nervous System' },
  { code: '8A80',   description: 'Epilepsy',                                           category: 'Nervous System' },
  { code: '8A60',   description: 'Migraine',                                           category: 'Nervous System' },
  { code: '8A20',   description: 'Parkinson disease',                                  category: 'Nervous System' },
  { code: '8A25',   description: 'Alzheimer disease',                                  category: 'Nervous System' },
  { code: '8A65',   description: 'Tension-type headache',                              category: 'Nervous System' },
  { code: '8B80',   description: 'Peripheral neuropathy',                              category: 'Nervous System' },
  { code: '8A41',   description: 'Subarachnoid haemorrhage',                           category: 'Nervous System' },
  { code: '8A40',   description: 'Intracerebral haemorrhage',                          category: 'Nervous System' },
  { code: 'BA01',   description: 'Transient ischaemic attack',                         category: 'Nervous System' },
  { code: '8E43',   description: 'Carpal tunnel syndrome',                             category: 'Nervous System' },

  // Cardiovascular
  { code: 'BA80',   description: 'Essential hypertension',                             category: 'Cardiovascular' },
  { code: 'BA81',   description: 'Secondary hypertension',                             category: 'Cardiovascular' },
  { code: 'BA41',   description: 'Heart failure, unspecified',                         category: 'Cardiovascular' },
  { code: 'BA90',   description: 'Atrial fibrillation',                                category: 'Cardiovascular' },
  { code: 'BA80.1', description: 'Hypertensive heart disease',                         category: 'Cardiovascular' },
  { code: 'BA41.0', description: 'Systolic heart failure',                             category: 'Cardiovascular' },
  { code: 'BA41.1', description: 'Diastolic heart failure',                            category: 'Cardiovascular' },
  { code: 'BA84',   description: 'Coronary artery disease',                            category: 'Cardiovascular' },
  { code: 'BA41.Z', description: 'Heart failure, unspecified',                         category: 'Cardiovascular' },
  { code: 'BB10',   description: 'Rheumatic fever with heart involvement',             category: 'Cardiovascular' },
  { code: 'BB84',   description: 'Mitral valve stenosis',                              category: 'Cardiovascular' },
  { code: 'BA00',   description: 'Acute myocardial infarction',                        category: 'Cardiovascular' },
  { code: 'BA84.1', description: 'Stable angina pectoris',                             category: 'Cardiovascular' },
  { code: 'BD10',   description: 'Pulmonary embolism',                                 category: 'Cardiovascular' },
  { code: 'BD40',   description: 'Deep vein thrombosis',                               category: 'Cardiovascular' },

  // Respiratory
  { code: 'CB41',   description: 'Asthma',                                             category: 'Respiratory' },
  { code: 'CB00',   description: 'Chronic obstructive pulmonary disease',              category: 'Respiratory' },
  { code: 'CA22',   description: 'Community-acquired pneumonia',                       category: 'Respiratory' },
  { code: 'CB90',   description: 'Bronchiectasis',                                     category: 'Respiratory' },
  { code: 'CA40',   description: 'Upper respiratory infection, unspecified',           category: 'Respiratory' },
  { code: 'CA41',   description: 'Sinusitis, acute',                                   category: 'Respiratory' },
  { code: 'CA26',   description: 'Aspiration pneumonia',                               category: 'Respiratory' },
  { code: 'CB20',   description: 'Pulmonary fibrosis',                                 category: 'Respiratory' },
  { code: 'CB42',   description: 'Status asthmaticus',                                 category: 'Respiratory' },
  { code: 'CB02',   description: 'Emphysema',                                          category: 'Respiratory' },

  // Digestive
  { code: 'DA92',   description: 'Gastro-oesophageal reflux disease',                  category: 'Digestive' },
  { code: 'DC10',   description: 'Peptic ulcer disease',                               category: 'Digestive' },
  { code: 'DD90',   description: 'Irritable bowel syndrome',                           category: 'Digestive' },
  { code: 'DD71',   description: "Crohn disease",                                      category: 'Digestive' },
  { code: 'DD70',   description: 'Ulcerative colitis',                                 category: 'Digestive' },
  { code: 'DB94.Z', description: 'Chronic kidney disease, unspecified stage',          category: 'Digestive' },
  { code: 'DB95',   description: 'Liver cirrhosis, unspecified',                       category: 'Digestive' },
  { code: 'DC30',   description: 'Appendicitis',                                       category: 'Digestive' },
  { code: 'DB35',   description: 'Non-alcoholic fatty liver disease',                  category: 'Digestive' },
  { code: 'DC93',   description: 'Diverticular disease of colon',                      category: 'Digestive' },
  { code: 'DE12',   description: 'Haemorrhoids',                                       category: 'Digestive' },

  // Genitourinary / Renal
  { code: 'GB60',   description: 'Chronic kidney disease, stage 3',                    category: 'Genitourinary' },
  { code: 'GB61',   description: 'Chronic kidney disease, stage 4',                    category: 'Genitourinary' },
  { code: 'GB62',   description: 'Chronic kidney disease, stage 5',                    category: 'Genitourinary' },
  { code: 'GB61.Z', description: 'Chronic kidney disease, unspecified',                category: 'Genitourinary' },
  { code: 'GB40',   description: 'Nephrotic syndrome',                                 category: 'Genitourinary' },
  { code: 'GC00',   description: 'Benign prostatic hyperplasia',                       category: 'Genitourinary' },
  { code: 'GC01',   description: 'Urinary incontinence',                               category: 'Genitourinary' },
  { code: 'GA10',   description: 'Urolithiasis (kidney stones)',                       category: 'Genitourinary' },
  { code: 'GC80',   description: 'Erectile dysfunction',                               category: 'Genitourinary' },

  // Musculoskeletal
  { code: 'FA24.Z', description: 'Rheumatoid arthritis, unspecified',                  category: 'Musculoskeletal' },
  { code: 'FA20',   description: 'Osteoarthritis of knee',                             category: 'Musculoskeletal' },
  { code: 'FA21',   description: 'Osteoarthritis of hip',                              category: 'Musculoskeletal' },
  { code: 'FA90',   description: 'Systemic lupus erythematosus',                       category: 'Musculoskeletal' },
  { code: 'FB81',   description: 'Osteoporosis',                                       category: 'Musculoskeletal' },
  { code: 'FA80',   description: 'Ankylosing spondylitis',                             category: 'Musculoskeletal' },
  { code: 'FB56',   description: 'Low back pain',                                      category: 'Musculoskeletal' },
  { code: 'FB57',   description: 'Cervical pain',                                      category: 'Musculoskeletal' },
  { code: 'FB60',   description: 'Fibromyalgia',                                       category: 'Musculoskeletal' },

  // Skin
  { code: 'EA80',   description: 'Atopic dermatitis',                                  category: 'Skin' },
  { code: 'EA90',   description: 'Psoriasis',                                          category: 'Skin' },
  { code: 'EA20',   description: 'Urticaria',                                          category: 'Skin' },
  { code: 'EA84',   description: 'Contact dermatitis',                                 category: 'Skin' },
  { code: '1G00',   description: 'Cellulitis',                                         category: 'Skin' },
  { code: 'EK50',   description: 'Tinea pedis (athlete\'s foot)',                      category: 'Skin' },
  { code: '1F02',   description: 'Herpes zoster',                                      category: 'Skin' },

  // Eye
  { code: '9B10',   description: 'Diabetic retinopathy',                               category: 'Eye' },
  { code: '9C61',   description: 'Glaucoma',                                           category: 'Eye' },
  { code: '9B80',   description: 'Cataract',                                           category: 'Eye' },
  { code: '9B77',   description: 'Age-related macular degeneration',                   category: 'Eye' },
  { code: 'AA06',   description: 'Conjunctivitis',                                     category: 'Eye' },

  // Ear / ENT
  { code: 'AA40',   description: 'Acute otitis media',                                 category: 'Ear/ENT' },
  { code: 'AB10',   description: 'Hearing loss, unspecified',                          category: 'Ear/ENT' },
  { code: 'AB02',   description: 'Tinnitus',                                           category: 'Ear/ENT' },
  { code: 'CA20',   description: 'Pharyngitis',                                        category: 'Ear/ENT' },
  { code: 'CA00',   description: 'Tonsillitis',                                        category: 'Ear/ENT' },

  // Obstetric / Gynaecological
  { code: 'JA60',   description: 'Gestational hypertension',                           category: 'Obstetric' },
  { code: 'JA61',   description: 'Pre-eclampsia',                                      category: 'Obstetric' },
  { code: 'GA30',   description: 'Endometriosis',                                      category: 'Gynaecological' },
  { code: 'GA31',   description: 'Uterine fibroids',                                   category: 'Gynaecological' },
  { code: 'GA20',   description: 'Polycystic ovary syndrome',                          category: 'Gynaecological' },
  { code: 'GA32',   description: 'Dysfunctional uterine bleeding',                     category: 'Gynaecological' },

  // Symptoms / Signs
  { code: 'MG22',   description: 'Chest pain, unspecified',                            category: 'Symptoms/Signs' },
  { code: 'MD11',   description: 'Headache',                                           category: 'Symptoms/Signs' },
  { code: 'MG30',   description: 'Abdominal pain',                                     category: 'Symptoms/Signs' },
  { code: 'MB23',   description: 'Fever',                                              category: 'Symptoms/Signs' },
  { code: 'MD50',   description: 'Dizziness',                                          category: 'Symptoms/Signs' },
  { code: 'ME14',   description: 'Fatigue',                                            category: 'Symptoms/Signs' },
  { code: 'MD90',   description: 'Syncope',                                            category: 'Symptoms/Signs' },
  { code: 'MA00',   description: 'Cough',                                              category: 'Symptoms/Signs' },
  { code: 'MA23',   description: 'Dyspnoea',                                           category: 'Symptoms/Signs' },
  { code: 'ME86',   description: 'Weight loss, unintentional',                         category: 'Symptoms/Signs' },
  { code: 'MA21',   description: 'Oedema',                                             category: 'Symptoms/Signs' },
  { code: 'MD80',   description: 'Numbness / tingling',                                category: 'Symptoms/Signs' },
];

let seeding = false;

async function ensureSeeded(): Promise<void> {
  if (seeding) return;
  const count = await prisma.iCD11Code.count();
  if (count > 0) return;
  seeding = true;
  try {
    await prisma.iCD11Code.createMany({ data: COMMON_CODES, skipDuplicates: true });
  } finally {
    seeding = false;
  }
}

// ── Controllers ──────────────────────────────────────────────────────────────

export async function searchICD11(req: Request, res: Response): Promise<void> {
  const { q } = req.query as { q?: string };
  if (!q || q.length < 2) { res.json([]); return; }

  // Try WHO API first (only if credentials are configured)
  const whoResults = await whoSearch(q);
  if (whoResults) { res.json(whoResults); return; }

  // Local fallback — auto-seed on first call if table is empty
  await ensureSeeded();

  const codes = await prisma.iCD11Code.findMany({
    where: {
      OR: [
        { code:        { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { category:    { contains: q, mode: 'insensitive' } },
      ],
    },
    take: 15,
  });
  res.json(codes);
}

export async function seedICD11(req: Request, res: Response): Promise<void> {
  await prisma.iCD11Code.createMany({ data: COMMON_CODES, skipDuplicates: true });
  res.json({ message: `Seeded ${COMMON_CODES.length} ICD-11 codes` });
}
