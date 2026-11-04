import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { readDrug, readDrugIngredients } from '../lib/drugCatalogueInput';
import { audit } from '../lib/billingOps';

const TEST_ID_BASE = 100000;                       // built-in test ids are below this
const DATA_TYPES = ['float', 'integer', 'enum', 'free text', 'date'];

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim().slice(0, max);
  return s || null;
};
const key = (...parts: (string | null | undefined)[]) => parts.map((p) => (p ?? '').toLowerCase().replace(/\s+/g, ' ').trim()).join('|');
const list = (v: unknown, maxItems: number, maxLen: number): string[] =>
  Array.isArray(v) ? [...new Set(v.map((x) => str(x, maxLen)).filter((x): x is string => !!x))].slice(0, maxItems) : [];

type Drug = Awaited<ReturnType<typeof prisma.catalogueDrug.findFirstOrThrow>>;
type Test = Awaited<ReturnType<typeof prisma.catalogueTest.findFirstOrThrow>>;

const testDto = (t: Test) => ({
  ...t,
  rowId: t.id,                                   // the database row, used to edit it
  id: TEST_ID_BASE + t.seq,
  panelId: t.kind === 'PANEL' ? `cpanel_${t.seq}` : null,
  options: Array.isArray(t.options) ? t.options : [],
  searchNames: Array.isArray(t.searchNames) ? t.searchNames : [],
  componentIds: Array.isArray(t.componentIds) ? t.componentIds : [],
});

// Keep the price list in step so a new item can be priced straight away (price stays blank until set).
async function upsertPriceRow(itemType: 'DRUG' | 'INVESTIGATION', catalogueRef: string, name: string, detail: string | null, unit: string, userId?: string) {
  await prisma.priceListItem.upsert({
    where: { itemType_catalogueRef: { itemType, catalogueRef } },
    create: { itemType, catalogueRef, name, detail, unit, updatedById: userId },
    update: { name, detail },
  });
}

// GET /catalogue/custom — everything staff have added (the app merges this with its built-in catalogues)
export async function listCustom(_req: AuthRequest, res: Response): Promise<void> {
  const [drugs, tests, diagnoses] = await Promise.all([
    prisma.catalogueDrug.findMany({ orderBy: { generic: 'asc' } }),
    prisma.catalogueTest.findMany({ orderBy: { name: 'asc' } }),
    prisma.iCD11Code.findMany({ where: { isCustom: true }, orderBy: { description: 'asc' } }),
  ]);
  res.json({ drugs, tests: tests.map(testDto), diagnoses });
}

// ── Drugs ───────────────────────────────────────────────────────────────────

const drugDetail = (d: { strength: string; form: string; route: string }) => [d.strength, d.form, d.route].join(' · ');
const drugName = (d: { generic: string; brand: string | null }) => (d.brand ? `${d.generic} (${d.brand})` : d.generic);

export async function createDrug(req: AuthRequest, res: Response): Promise<void> {
  const r = readDrug(req.body ?? {});
  if (!r.data) { res.status(400).json({ error: r.error }); return; }
  const k = key(r.data.generic, r.data.brand, r.data.strength, r.data.form, r.data.route);
  const existing = await prisma.catalogueDrug.findMany({ where: { generic: { equals: r.data.generic, mode: 'insensitive' } } });
  if (existing.some((e) => key(e.generic, e.brand, e.strength, e.form, e.route) === k)) {
    res.status(409).json({ error: 'That drug (same strength, form and route) has already been added.' }); return;
  }
  const count = await prisma.catalogueDrug.count();
  let drug: Drug | null = null;
  for (let n = count + 1; !drug && n < count + 20; n++) {   // retry if two people add at once and codes collide
    try { drug = await prisma.catalogueDrug.create({ data: { ...r.data, code: `CUS${String(n).padStart(4, '0')}`, createdById: req.userId } }); }
    catch (e: any) { if (e?.code !== 'P2002') throw e; }
  }
  if (!drug) { res.status(500).json({ error: 'Couldn’t assign a code. Try again.' }); return; }
  await upsertPriceRow('DRUG', drug.code, drugName(drug), drugDetail(drug), 'per unit', req.userId);
  res.status(201).json(drug);
}

export async function updateDrug(req: AuthRequest, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const current = await prisma.catalogueDrug.findUnique({ where: { id } });
  if (!current) { res.status(404).json({ error: 'That drug no longer exists. Refresh the list.' }); return; }
  const body = req.body ?? {};
  const data: Record<string, unknown> = {};
  if (body.pendingReview !== undefined) {
    if (typeof body.pendingReview !== 'boolean') { res.status(400).json({ error: 'Choose a valid review status.' }); return; }
    if (!(req.userRole ?? '').split(',').some(role => role.trim() === 'admin')) { res.status(403).json({ error: 'Only an administrator can mark a catalogue item reviewed.' }); return; }
    data['pendingReview'] = body.pendingReview;
  }
  if (typeof body.active === 'boolean') data['active'] = body.active;
  if (body.ingredients !== undefined) {
    const ingredients = readDrugIngredients(body.ingredients);
    if (ingredients.error) { res.status(400).json({ error: ingredients.error }); return; }
    body.strength = ingredients.strength;
    data['ingredients'] = ingredients.data;
    data['pendingReview'] = body.pendingReview === false ? false : true;
  } else if (current.ingredients && body.strength !== undefined && body.strength !== current.strength) {
    res.status(400).json({ error: 'Edit the active ingredients to change this item’s strength.' }); return;
  }
  if (body.generic !== undefined || body.ingredients !== undefined) {
    const r = readDrug({ ...current, ...body });
    if (!r.data) { res.status(400).json({ error: r.error }); return; }
    Object.assign(data, r.data);
  }
  const drug = await prisma.$transaction(async tx => {
    const updated = await tx.catalogueDrug.update({ where: { id }, data });
    await tx.priceListItem.updateMany({
      where: { itemType: 'DRUG', catalogueRef: updated.code },
      data: { name: drugName(updated), detail: drugDetail(updated), ...(typeof body.active === 'boolean' ? { active: updated.active } : {}) },
    });
    if (body.pendingReview !== undefined && body.pendingReview !== current.pendingReview) await audit(tx, { userId: req.userId, action: 'CATALOGUE_DRUG_REVIEWED', entity: 'CatalogueDrug', entityId: updated.id, before: { pendingReview: current.pendingReview }, after: { pendingReview: updated.pendingReview } });
    if (body.ingredients !== undefined) await audit(tx, { userId: req.userId, action: 'CATALOGUE_DRUG_INGREDIENTS_UPDATED', entity: 'CatalogueDrug', entityId: updated.id, before: { ingredients: current.ingredients, strength: current.strength }, after: { ingredients: updated.ingredients, strength: updated.strength } });
    return updated;
  });
  res.json(drug);
}

// ── Investigations ──────────────────────────────────────────────────────────
function readTest(body: any, kind: 'SINGLE' | 'PANEL') {
  const name = str(body.name, 160), specimen = str(body.specimen, 80);
  if (!name) return { error: 'Enter the test name.' };
  if (!specimen) return { error: 'Enter the specimen (blood, urine, X-ray…).' };
  const loinc = str(body.loinc, 12);
  if (loinc && !/^\d{1,7}-\d$/.test(loinc)) return { error: 'The LOINC code should look like 2160-0 (digits, a dash, one check digit).' };
  const base = { name, specimen, loinc, abbr: str(body.abbr, 60), subType: str(body.subType, 60) };
  if (kind === 'PANEL') {
    const ids = [...new Set<number>((Array.isArray(body.componentIds) ? body.componentIds : []).map((x: unknown) => Number(x)))].filter((n) => Number.isInteger(n) && n >= 0);
    if (ids.length < 2) return { error: 'Add at least two single tests to a panel.' };
    if (ids.length > 60) return { error: 'A panel can hold at most 60 tests.' };
    return { data: { ...base, dataType: 'float', units: null, referenceRange: null, options: undefined, searchNames: list(body.searchNames, 12, 80), componentIds: ids } };
  }
  const dataType = DATA_TYPES.includes(body.dataType) ? (body.dataType as string) : null;
  if (!dataType) return { error: 'Choose how the result is recorded.' };
  const options = list(body.options, 60, 60);
  if (dataType === 'enum' && options.length < 2) return { error: 'List at least two possible results (e.g. Positive, Negative).' };
  const numeric = dataType === 'float' || dataType === 'integer';
  return { data: { ...base, dataType, units: numeric ? str(body.units, 30) : null, referenceRange: str(body.referenceRange, 120), options: dataType === 'enum' ? options : undefined, searchNames: undefined, componentIds: undefined } };
}

const priceFields = (t: Test) => ({
  ref: t.kind === 'PANEL' ? `panel_cpanel_${t.seq}` : `single_${TEST_ID_BASE + t.seq}`,
  detail: t.kind === 'PANEL' ? `Panel · ${t.specimen}` : [t.specimen, t.subType].filter(Boolean).join(' · '),
  unit: t.kind === 'PANEL' ? 'per panel' : 'per test',
});

export async function createTest(req: AuthRequest, res: Response): Promise<void> {
  const kind = req.body?.kind === 'PANEL' ? 'PANEL' : 'SINGLE';
  const r = readTest(req.body ?? {}, kind);
  if (!r.data) { res.status(400).json({ error: r.error }); return; }
  const same = await prisma.catalogueTest.findFirst({ where: { kind, name: { equals: r.data.name, mode: 'insensitive' }, specimen: { equals: r.data.specimen, mode: 'insensitive' } } });
  if (same) { res.status(409).json({ error: `“${r.data.name}” has already been added.` }); return; }
  const test = await prisma.catalogueTest.create({ data: { ...r.data, kind, createdById: req.userId } as any });
  const p = priceFields(test);
  await upsertPriceRow('INVESTIGATION', p.ref, test.name, p.detail, p.unit, req.userId);
  res.status(201).json(testDto(test));
}

export async function updateTest(req: AuthRequest, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const current = await prisma.catalogueTest.findUnique({ where: { id } });
  if (!current) { res.status(404).json({ error: 'That test no longer exists. Refresh the list.' }); return; }
  const body = req.body ?? {};
  const data: Record<string, unknown> = {};
  if (typeof body.active === 'boolean') data['active'] = body.active;
  if (body.name !== undefined) {
    const r = readTest({ ...testDto(current), ...body }, current.kind as 'SINGLE' | 'PANEL');
    if (!r.data) { res.status(400).json({ error: r.error }); return; }
    Object.assign(data, r.data);
  }
  const test = await prisma.catalogueTest.update({ where: { id }, data: data as any });
  const p = priceFields(test);
  await prisma.priceListItem.updateMany({
    where: { itemType: 'INVESTIGATION', catalogueRef: p.ref },
    data: { name: test.name, detail: p.detail, ...(typeof body.active === 'boolean' ? { active: test.active } : {}) },
  });
  res.json(testDto(test));
}

// ── Diagnoses (added to the ICD-11 list the diagnosis search uses) ───────────
function readDiagnosis(body: any) {
  const code = str(body.code, 24)?.toUpperCase().replace(/\s/g, '') ?? null;
  const description = str(body.description, 240);
  if (!code) return { error: 'Enter the ICD-11 code.' };
  if (!/^[A-Z0-9][A-Z0-9.\-/&]*$/.test(code)) return { error: 'The code can only use letters, digits and . - / &' };
  if (!description) return { error: 'Enter the diagnosis name.' };
  return { data: { code, description, category: str(body.category, 60) } };
}

export async function createDiagnosis(req: AuthRequest, res: Response): Promise<void> {
  const r = readDiagnosis(req.body ?? {});
  if (!r.data) { res.status(400).json({ error: r.error }); return; }
  const clash = await prisma.iCD11Code.findUnique({ where: { code: r.data.code } });
  if (clash) { res.status(409).json({ error: `${r.data.code} is already on the list as “${clash.description}”.` }); return; }
  res.status(201).json(await prisma.iCD11Code.create({ data: { ...r.data, isCustom: true } }));
}

export async function updateDiagnosis(req: AuthRequest, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const current = await prisma.iCD11Code.findUnique({ where: { id } });
  if (!current || !current.isCustom) { res.status(404).json({ error: 'Only diagnoses you added can be edited.' }); return; }
  const r = readDiagnosis({ ...current, ...(req.body ?? {}) });
  if (!r.data) { res.status(400).json({ error: r.error }); return; }
  if (r.data.code !== current.code) {
    const clash = await prisma.iCD11Code.findUnique({ where: { code: r.data.code } });
    if (clash) { res.status(409).json({ error: `${r.data.code} is already on the list as “${clash.description}”.` }); return; }
  }
  res.json(await prisma.iCD11Code.update({ where: { id }, data: r.data }));
}
