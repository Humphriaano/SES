import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { audit, fromCents, startOfToday, summarize, toCents, userNames } from '../lib/billingOps';

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// What the drawer should hold: the opening float plus cash received in the session (voided receipts leave).
async function sessionFigures(sessionId: string, openingFloat: number) {
  const pays = await prisma.payment.findMany({ where: { sessionId }, select: { method: true, amount: true, status: true } });
  const byMethod: Record<string, number> = {};
  let voided = 0;
  for (const p of pays) {
    if (p.status !== 'ACTIVE') { voided++; continue; }
    byMethod[p.method] = (byMethod[p.method] ?? 0) + toCents(p.amount);
  }
  const cash = byMethod['CASH'] ?? 0;
  return {
    receipts: pays.length - voided, voided,
    byMethod: Object.fromEntries(Object.entries(byMethod).map(([k, v]) => [k, fromCents(v)])),
    collected: fromCents(Object.values(byMethod).reduce((a, b) => a + b, 0)),
    expectedCash: fromCents(toCents(openingFloat) + cash),
  };
}

// GET /cashier/session — my open session, if any
export async function mySession(req: AuthRequest, res: Response): Promise<void> {
  const s = await prisma.cashierSession.findFirst({ where: { userId: req.userId!, closedAt: null } });
  if (!s) { res.json(null); return; }
  res.json({ ...s, openingFloat: Number(s.openingFloat), ...(await sessionFigures(s.id, Number(s.openingFloat))) });
}

// POST /cashier/session/open { openingFloat }
export async function openSession(req: AuthRequest, res: Response): Promise<void> {
  const float = num(req.body?.openingFloat ?? 0);
  if (float === null || float < 0 || float > 1_000_000) { res.status(400).json({ error: 'Enter the cash in the drawer, 0 or more.' }); return; }
  try {
    const s = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'cashier:' + req.userId}))`;
      if (await tx.cashierSession.findFirst({ where: { userId: req.userId!, closedAt: null } })) throw new Error('You already have a session open.');
      const created = await tx.cashierSession.create({ data: { userId: req.userId!, openingFloat: Math.round(float * 100) / 100 } });
      await audit(tx, { userId: req.userId, action: 'SESSION_OPENED', entity: 'CashierSession', entityId: created.id, after: { openingFloat: float } });
      return created;
    });
    res.status(201).json({ ...s, openingFloat: Number(s.openingFloat), ...(await sessionFigures(s.id, Number(s.openingFloat))) });
  } catch (e: any) { res.status(409).json({ error: e?.message ?? 'Couldn’t open the session.' }); }
}

// POST /cashier/session/close { countedCash, note? } — expected against counted; a difference needs a note
export async function closeSession(req: AuthRequest, res: Response): Promise<void> {
  const counted = num(req.body?.countedCash);
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 300) : '';
  if (counted === null || counted < 0 || counted > 100_000_000) { res.status(400).json({ error: 'Enter the cash you counted.' }); return; }
  try {
    const out = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'cashier:' + req.userId}))`;
      const s = await tx.cashierSession.findFirst({ where: { userId: req.userId!, closedAt: null } });
      if (!s) throw new Error('You don’t have a session open.');
      const fig = await sessionFigures(s.id, Number(s.openingFloat));
      const variance = fromCents(Math.round(counted * 100) - toCents(fig.expectedCash));
      if (variance !== 0 && !note) throw new Error(`The count is ${variance < 0 ? 'short' : 'over'} by ZMW ${Math.abs(variance).toFixed(2)}. Add a note to explain it.`);
      const closed = await tx.cashierSession.update({ where: { id: s.id }, data: { closedAt: new Date(), countedCash: Math.round(counted * 100) / 100, expectedCash: fig.expectedCash, note: note || null } });
      await audit(tx, { userId: req.userId, action: 'SESSION_CLOSED', entity: 'CashierSession', entityId: s.id, after: { expected: fig.expectedCash, counted, variance }, reason: note || undefined });
      return { closed, variance, fig };
    });
    res.json({ expectedCash: out.fig.expectedCash, countedCash: counted, variance: out.variance, collected: out.fig.collected, byMethod: out.fig.byMethod });
  } catch (e: any) { res.status(409).json({ error: e?.message ?? 'Couldn’t close the session.' }); }
}

// GET /cashier/sessions?days=14 — recent sessions with any shortfall (billing / admin)
export async function listSessions(req: AuthRequest, res: Response): Promise<void> {
  const days = Math.min(Math.max(Number(req.query['days']) || 14, 1), 120);
  const rows = await prisma.cashierSession.findMany({ where: { openedAt: { gte: new Date(Date.now() - days * 86_400_000) } }, orderBy: { openedAt: 'desc' }, take: 300 });
  const names = await userNames(rows.map((r) => r.userId));
  const out = [];
  for (const r of rows) {
    const fig = r.closedAt ? null : await sessionFigures(r.id, Number(r.openingFloat));
    const expected = r.expectedCash !== null ? Number(r.expectedCash) : fig!.expectedCash;
    out.push({
      id: r.id, cashier: names[r.userId] ?? 'Unknown', openedAt: r.openedAt, closedAt: r.closedAt, openingFloat: Number(r.openingFloat),
      expectedCash: expected, countedCash: r.countedCash === null ? null : Number(r.countedCash),
      variance: r.countedCash === null ? null : fromCents(toCents(r.countedCash) - toCents(expected)), note: r.note,
    });
  }
  res.json(out);
}

// GET /billing/desk — today's takings and who still owes
export async function deskOverview(req: AuthRequest, res: Response): Promise<void> {
  const [pays, open] = await Promise.all([
    prisma.payment.findMany({ where: { createdAt: { gte: startOfToday() }, status: 'ACTIVE' }, select: { method: true, amount: true } }),
    prisma.invoice.findMany({ where: { status: { in: ['OPEN', 'PART_PAID'] } }, include: { lines: true, payments: true, patient: { select: { id: true, firstName: true, lastName: true, phone: true } } }, take: 1000 }),
  ]);
  const today: Record<string, number> = {};
  for (const p of pays) today[p.method] = (today[p.method] ?? 0) + toCents(p.amount);

  const byPatient = new Map<string, { patientId: string; name: string; phone: string | null; balanceC: number; overdue: boolean; since: Date; invoices: number; emergency: boolean }>();
  for (const inv of open) {
    const s = summarize(inv);
    if (s.balance <= 0) continue;
    const cur = byPatient.get(inv.patientId) ?? { patientId: inv.patientId, name: `${inv.patient.firstName} ${inv.patient.lastName}`, phone: inv.patient.phone, balanceC: 0, overdue: false, since: inv.createdAt, invoices: 0, emergency: false };
    cur.balanceC += toCents(s.balance); cur.overdue ||= s.overdue; cur.invoices++; cur.emergency ||= inv.emergency;
    if (inv.createdAt < cur.since) cur.since = inv.createdAt;
    byPatient.set(inv.patientId, cur);
  }
  const owing = [...byPatient.values()].sort((a, b) => b.balanceC - a.balanceC);
  res.json({
    today: { byMethod: Object.fromEntries(Object.entries(today).map(([k, v]) => [k, fromCents(v)])), total: fromCents(Object.values(today).reduce((a, b) => a + b, 0)), receipts: pays.length },
    owing: owing.slice(0, 100).map((o) => ({ ...o, balance: fromCents(o.balanceC) })),
    owingTotal: fromCents(owing.reduce((s, o) => s + o.balanceC, 0)),
    owingCount: owing.length,
  });
}
