import { Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { userNames } from '../lib/billingOps';

// The chronic condition list the reports count, kept as data. Anyone clinical may read it; only these roles may change it. A change clears the
// condition's review (the definition has changed, so it needs confirming again) and is written to an append-only history.
export const CONDITION_EDITORS = ['admin'] as const;

const CODE = /^[0-9A-Z]{2,6}(\.[0-9A-Z]{1,6})*$/;   // an ICD-11 code or the start of one: BA00, CA23.3, 3A51.0
const view = (c: { id: string; key: string; label: string; prefixes: string[]; exclude: string[]; active: boolean; sortOrder: number; reviewedAt: Date | null; reviewedById: string | null; updatedAt: Date }, names: Record<string, string>) =>
  ({ id: c.id, key: c.key, label: c.label, prefixes: c.prefixes, exclude: c.exclude, active: c.active, sortOrder: c.sortOrder, reviewedAt: c.reviewedAt, reviewedBy: c.reviewedById ? names[c.reviewedById] ?? '' : null, updatedAt: c.updatedAt });
const snapshot = (c: { label: string; prefixes: string[]; exclude: string[]; active: boolean }) => ({ label: c.label, prefixes: c.prefixes, exclude: c.exclude, active: c.active });

// Prefixes must be real: each has to start at least one ICD-11 code in the system, so a typo cannot quietly make a condition count nobody.
async function codes(value: unknown, what: string): Promise<string[] | { error: string }> {
  if (!Array.isArray(value)) return { error: `${what} must be a list of ICD-11 codes.` };
  const list = [...new Set(value.map(v => (typeof v === 'string' ? v.trim().toUpperCase() : '')))];
  if (list.length > 30) return { error: `Give at most 30 ${what.toLowerCase()}.` };
  for (const code of list) {
    if (!CODE.test(code)) return { error: `“${code}” is not an ICD-11 code. Examples: BA00, CA23.3.` };
    if ((await prisma.iCD11Code.count({ where: { code: { startsWith: code } } })) === 0) return { error: `No ICD-11 code in the system starts with “${code}”.` };
  }
  return list;
}

// GET /chronic-conditions
export async function listChronicConditions(_req: AuthRequest, res: Response): Promise<void> {
  const rows = await prisma.chronicCondition.findMany({ orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] });
  const names = await userNames(rows.map(r => r.reviewedById));
  res.json({ conditions: rows.map(r => view(r, names)) });
}

// POST /chronic-conditions { label, prefixes, exclude? }
export async function createChronicCondition(req: AuthRequest, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>, label = typeof body['label'] === 'string' ? body['label'].trim() : '';
  if (label.length < 2 || label.length > 80) { res.status(400).json({ error: 'Give the condition a name of 2 to 80 characters.' }); return; }
  const prefixes = await codes(body['prefixes'], 'Codes');
  if (!Array.isArray(prefixes)) { res.status(400).json(prefixes); return; }
  if (prefixes.length === 0) { res.status(400).json({ error: 'Give at least one ICD-11 code.' }); return; }
  const exclude = await codes(body['exclude'] ?? [], 'Exclusions');
  if (!Array.isArray(exclude)) { res.status(400).json(exclude); return; }
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^([0-9])/, 'c_$1').slice(0, 40);
  if (!key) { res.status(400).json({ error: 'Give the condition a name with letters in it.' }); return; }
  if (await prisma.chronicCondition.findUnique({ where: { key } })) { res.status(409).json({ error: 'A condition with that name already exists.' }); return; }
  const last = await prisma.chronicCondition.aggregate({ _max: { sortOrder: true } });
  const created = await prisma.$transaction(async tx => {
    const c = await tx.chronicCondition.create({ data: { key, label, prefixes, exclude, sortOrder: (last._max.sortOrder ?? 0) + 10, updatedById: req.userId } });
    await tx.chronicConditionHistory.create({ data: { conditionId: c.id, userId: req.userId ?? '', action: 'CREATE', after: snapshot(c) as Prisma.InputJsonValue } });
    return c;
  });
  res.status(201).json(view(created, {}));
}

// PATCH /chronic-conditions/:id { label?, prefixes?, exclude?, active? } or { reviewed: true }
export async function updateChronicCondition(req: AuthRequest, res: Response): Promise<void> {
  const id = String(req.params['id']), body = (req.body ?? {}) as Record<string, unknown>;
  const current = await prisma.chronicCondition.findUnique({ where: { id } });
  if (!current) { res.status(404).json({ error: 'Condition not found.' }); return; }
  const data: Prisma.ChronicConditionUpdateInput = { updatedById: req.userId };
  if (body['reviewed'] === true) {
    await prisma.$transaction(async tx => {
      await tx.chronicCondition.update({ where: { id }, data: { reviewedAt: new Date(), reviewedById: req.userId, updatedById: req.userId } });
      await tx.chronicConditionHistory.create({ data: { conditionId: id, userId: req.userId ?? '', action: 'REVIEW', before: snapshot(current) as Prisma.InputJsonValue, after: snapshot(current) as Prisma.InputJsonValue } });
    });
  } else {
    if (typeof body['label'] === 'string') { const label = body['label'].trim(); if (label.length < 2 || label.length > 80) { res.status(400).json({ error: 'Give the condition a name of 2 to 80 characters.' }); return; } data.label = label; }
    if (body['prefixes'] !== undefined) { const p = await codes(body['prefixes'], 'Codes'); if (!Array.isArray(p)) { res.status(400).json(p); return; } if (p.length === 0) { res.status(400).json({ error: 'Give at least one ICD-11 code.' }); return; } data.prefixes = p; }
    if (body['exclude'] !== undefined) { const x = await codes(body['exclude'], 'Exclusions'); if (!Array.isArray(x)) { res.status(400).json(x); return; } data.exclude = x; }
    if (typeof body['active'] === 'boolean') data.active = body['active'];
    if (Object.keys(data).length === 1) { res.status(400).json({ error: 'Nothing to change.' }); return; }
    data.reviewedAt = null; data.reviewedById = null;   // changed, so it needs confirming again
    await prisma.$transaction(async tx => {
      const updated = await tx.chronicCondition.update({ where: { id }, data });
      await tx.chronicConditionHistory.create({ data: { conditionId: id, userId: req.userId ?? '', action: 'UPDATE', before: snapshot(current) as Prisma.InputJsonValue, after: snapshot(updated) as Prisma.InputJsonValue } });
    });
  }
  const fresh = await prisma.chronicCondition.findUniqueOrThrow({ where: { id } });
  res.json(view(fresh, await userNames([fresh.reviewedById])));
}
