import { Response } from 'express';
import prisma from '../lib/prisma';
import { staffDisplayName } from '../lib/staffNames';
import { canReadClinical } from '../lib/clinicalAccess';
import { AuthRequest } from '../middleware/auth';
import { applyPrescriptionAvailability } from '../lib/prescriptionAvailability';
import { nextDocumentNumber, openInvoice } from '../lib/billing';
import {
  PAYMENT_METHODS, PaymentMethod, audit, creditBalanceC, fromCents, isAdmin, lineCents, lockInvoice,
  recalcInvoice, summarize, toCents, userNames,
} from '../lib/billingOps';

const MAX_MONEY = 10_000_000;
const include = { lines: { orderBy: { createdAt: 'asc' as const } }, payments: { orderBy: { createdAt: 'asc' as const } } };

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null);
const fail = (res: Response, code: number, error: string): void => { res.status(code).json({ error }); };
const zmw = (c: number) => `ZMW ${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Shaping ──────────────────────────────────────────────────────────────────
async function shape(invoices: any[]) {
  const names = await userNames(invoices.flatMap((i) => [
    ...i.payments.flatMap((p: any) => [p.receivedById, p.voidedById]), ...i.lines.map((l: any) => l.createdById),
    i.discountById, i.waivedById, i.releasedById, i.voidedById,
  ]));
  return invoices.map((inv) => ({
    ...inv,
    discountAmount: Number(inv.discountAmount),
    discountByName: inv.discountById ? names[inv.discountById] ?? null : null,
    waivedByName: inv.waivedById ? names[inv.waivedById] ?? null : null,
    releasedByName: inv.releasedById ? names[inv.releasedById] ?? null : null,
    lines: inv.lines.map((l: any) => ({
      ...l, quantity: Number(l.quantity), unitPrice: l.unitPrice === null ? null : Number(l.unitPrice),
      lineTotal: l.unitPrice === null ? null : fromCents(lineCents(l)), createdByName: l.createdById ? names[l.createdById] ?? null : null,
    })),
    payments: inv.payments.map((p: any) => ({
      ...p, amount: Number(p.amount), receivedByName: names[p.receivedById] ?? null, voidedByName: p.voidedById ? names[p.voidedById] ?? null : null,
    })),
    ...summarize(inv),
  }));
}

// ── Reading ──────────────────────────────────────────────────────────────────
// GET /patients/:patientId/invoices — newest first, each with lines, payments and totals
export async function listPatientInvoices(req: AuthRequest, res: Response): Promise<void> {
  const patientId = String(req.params['patientId']);
  const invoices = await prisma.invoice.findMany({ where: { patientId }, include, orderBy: { createdAt: 'desc' }, take: 100 });
  const credit = fromCents(await creditBalanceC(prisma, patientId));
  res.json({ invoices: await shape(invoices), credit });
}

// GET /patients/:patientId/billing-summary — what the patient banner shows
export async function patientBillingSummary(req: AuthRequest, res: Response): Promise<void> {
  const patientId = String(req.params['patientId']);
  const invoices = await prisma.invoice.findMany({ where: { patientId, status: { in: ['OPEN', 'PART_PAID', 'PAID'] } }, include });
  let owedC = 0, overdueC = 0;
  for (const inv of invoices) {
    const s = summarize(inv);
    if (s.balance > 0) { owedC += toCents(s.balance); if (s.overdue) overdueC += toCents(s.balance); }
  }
  res.json({ outstanding: fromCents(owedC), overdue: fromCents(overdueC), credit: fromCents(await creditBalanceC(prisma, patientId)) });
}

// GET /invoices/:id
export async function getInvoice(req: AuthRequest, res: Response): Promise<void> {
  const inv = await prisma.invoice.findUnique({ where: { id: String(req.params['id']) }, include });
  if (!inv) return fail(res, 404, 'That invoice doesn’t exist.');
  const patient = await prisma.patient.findUnique({ where: { id: inv.patientId }, select: { id: true, firstName: true, lastName: true, nationalId: true, phone: true } });
  res.json({ ...(await shape([inv]))[0], patient });
}

// GET /patients/:patientId/visit-history — each visit with what it was for, what was charged, and the invoices those charges sit on.
// Payments belong to an invoice (which may cover more than one visit), so they are shown per invoice, not split across visits.
export async function patientVisitHistory(req: AuthRequest, res: Response): Promise<void> {
  const patientId = String(req.params['patientId']);
  const [encounters, lines, invoices] = await Promise.all([
    canReadClinical(req.userRole) ? prisma.encounter.findMany({
      where: { patientId }, orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, createdAt: true, status: true, chiefComplaint: true, clinician: { select: { name: true, designation: true } }, diagnoses: { select: { isPrimary: true, icd11: { select: { description: true } } } } },
    }) : Promise.resolve([]),
    prisma.chargeLine.findMany({ where: { patientId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } }),
    prisma.invoice.findMany({ where: { patientId }, include }),
  ]);
  const invoiceById = new Map(invoices.map((i) => [i.id, { inv: i, s: summarize(i) }]));

  const group = (ls: typeof lines) => {
    const ids = [...new Set(ls.map((l) => l.invoiceId))];
    return {
      charged: fromCents(ls.reduce((c, l) => c + lineCents(l), 0)),
      unpriced: ls.filter((l) => l.unitPrice === null).length,
      items: ls.map((l) => ({ id: l.id, description: l.description, sourceType: l.sourceType, quantity: Number(l.quantity), unitPrice: l.unitPrice === null ? null : Number(l.unitPrice), lineTotal: l.unitPrice === null ? null : fromCents(lineCents(l)) })),
      invoices: ids.flatMap((id) => {
        const e = invoiceById.get(id);
        return e ? [{ id, number: e.inv.number, status: e.inv.status, payable: e.s.payable, paid: e.s.paid, balance: e.s.balance, overdue: e.s.overdue }] : [];
      }),
    };
  };

  const visits = encounters.map((e) => ({
    id: e.id, date: e.createdAt, status: e.status, reason: e.chiefComplaint, clinician: e.clinician ? staffDisplayName(e.clinician.name, e.clinician.designation) : null,
    diagnoses: [...e.diagnoses].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).map((d) => d.icd11.description),
    ...group(lines.filter((l) => l.encounterId === e.id)),
  }));
  const known = new Set(encounters.map((e) => e.id));
  const other = lines.filter((l) => !l.encounterId || !known.has(l.encounterId));
  res.json({ visits, other: other.length ? group(other) : null });
}

// GET /payments/:id/receipt — everything a printed receipt needs
export async function getReceipt(req: AuthRequest, res: Response): Promise<void> {
  const pay = await prisma.payment.findUnique({ where: { id: String(req.params['id']) }, include: { invoice: { include } } });
  if (!pay) return fail(res, 404, 'That receipt doesn’t exist.');
  const patient = await prisma.patient.findUnique({ where: { id: pay.invoice.patientId }, select: { id: true, firstName: true, lastName: true, nationalId: true, phone: true } });
  const [inv] = await shape([pay.invoice]);
  const payment = inv.payments.find((p: any) => p.id === pay.id);
  res.json({ payment, invoice: inv, patient });
}

// ── Charges ──────────────────────────────────────────────────────────────────
// POST /patients/:patientId/invoice-lines — the clerk adds a charge that wasn't picked up automatically.
export async function addManualLine(req: AuthRequest, res: Response): Promise<void> {
  const patientId = String(req.params['patientId']);
  const { description, quantity, unitPrice, priceItemId, invoiceId } = req.body ?? {};
  if (invoiceId !== undefined && (typeof invoiceId !== 'string' || !invoiceId || invoiceId.length > 100)) return fail(res, 400, 'Choose an invoice.');
  const label = text(description, 200);
  const qty = num(quantity ?? 1);
  if (!label) return fail(res, 400, 'Enter what the charge is for.');
  if (qty === null || qty <= 0 || qty > 10000) return fail(res, 400, 'Quantity must be more than 0.');
  const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } });
  if (!patient) return fail(res, 404, 'That patient doesn’t exist.');

  let price: number | null = null;
  let itemId: string | null = null;
  if (priceItemId) {
    const item = await prisma.priceListItem.findUnique({ where: { id: String(priceItemId) } });
    if (!item || !item.active) return fail(res, 400, 'That price list item is no longer available.');
    price = item.unitPrice === null ? null : Number(item.unitPrice);
    itemId = item.id;
  }
  const typed = num(unitPrice);
  if (unitPrice !== undefined && unitPrice !== null && unitPrice !== '') {
    if (typed === null || typed < 0 || typed > MAX_MONEY) return fail(res, 400, 'Price must be a number of 0 or more.');
    price = Math.round(typed * 100) / 100;
  }
  if (price === null) return fail(res, 400, 'Enter a price, or pick an item that has one.');

  try {
    const line = await prisma.$transaction(async (tx) => {
      const targetId = invoiceId ?? (await openInvoice(tx, patientId)).id;
      await lockInvoice(tx, targetId);
      const invoice = await tx.invoice.findUnique({ where: { id: targetId } });
      if (!invoice || invoice.patientId !== patientId) throw Object.assign(new Error('That invoice is not available for this patient.'), { status: 404 });
      if (invoice.status !== 'OPEN' || invoice.lockedAt) throw Object.assign(new Error('This invoice is no longer open for charges. Refresh the invoices and add the charge to a new invoice.'), { status: 409 });
      const l = await tx.chargeLine.create({
        data: { invoiceId: invoice.id, patientId, sourceType: 'MANUAL', description: label, quantity: Math.round(qty * 100) / 100, unitPrice: price, priceItemId: itemId, auto: false, createdById: req.userId },
      });
      await audit(tx, { userId: req.userId, action: 'LINE_ADDED', entity: 'ChargeLine', entityId: l.id, invoiceId: invoice.id, patientId, after: { description: label, quantity: qty, unitPrice: price } });
      return l;
    });
    res.status(201).json({ ...line, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice) });
  } catch (err: any) {
    if (err.status) return fail(res, err.status, err.message);
    throw err;
  }
}

// Who may change a line. Clinical lines (prescriptions, investigations, the fee) belong to the clinician:
// the clerk may only give an unpriced one its price, or confirm a quantity that couldn't be worked out.
function editRule(line: { auto: boolean; unitPrice: unknown; quantityUnsure: boolean }, locked: boolean, admin: boolean, field: 'quantity' | 'unitPrice' | 'void'): string | null {
  if (locked && !admin) return 'This invoice already has a payment, so it can’t be changed here. Ask an administrator to adjust it.';
  if (!line.auto || admin) return null;
  if (field === 'void') return 'This was ordered by the clinician and can’t be removed here. Send the client back to the prescriber to change the order.';
  if (field === 'unitPrice' && line.unitPrice === null) return null;
  if (field === 'quantity' && line.quantityUnsure) return null;
  return 'This was ordered by the clinician and can’t be changed here. Send the client back to the prescriber.';
}

// PATCH /charge-lines/:id { quantity?, unitPrice?, reason? }
export async function editLine(req: AuthRequest, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const { quantity, unitPrice } = req.body ?? {};
  const reason = text(req.body?.reason, 300);
  const qty = quantity === undefined ? undefined : num(quantity);
  const price = unitPrice === undefined ? undefined : num(unitPrice);
  if (qty !== undefined && (qty === null || qty <= 0 || qty > 10000)) return fail(res, 400, 'Quantity must be more than 0.');
  if (price !== undefined && (price === null || price < 0 || price > MAX_MONEY)) return fail(res, 400, 'Price must be a number of 0 or more.');
  if (qty === undefined && price === undefined) return fail(res, 400, 'Nothing to change.');

  const found = await prisma.chargeLine.findUnique({ where: { id }, include: { invoice: true } });
  if (!found) return fail(res, 404, 'That charge no longer exists. Refresh the page.');
  const admin = isAdmin(req.userRole);

  try {
    const out = await prisma.$transaction(async (tx) => {
      await lockInvoice(tx, found.invoiceId);
      const line = await tx.chargeLine.findUniqueOrThrow({ where: { id }, include: { invoice: true } });
      const locked = line.invoice.status !== 'OPEN';
      if (line.invoice.status === 'VOID' || line.invoice.status === 'WAIVED') throw new Error('This invoice is closed.');
      if (line.status !== 'ACTIVE') throw new Error('That charge was removed.');
      for (const [field, v] of [['quantity', qty], ['unitPrice', price]] as const) {
        if (v === undefined) continue;
        const why = editRule(line, locked, admin, field);
        if (why) throw new Error(why);
      }
      if (locked && !reason) throw new Error('Give a reason for changing a paid invoice.');
      const data: Record<string, unknown> = {};
      if (qty !== undefined && qty !== null) data['quantity'] = Math.round(qty * 100) / 100;
      if (price !== undefined && price !== null) data['unitPrice'] = Math.round(price * 100) / 100;
      const nextPrice = (data['unitPrice'] ?? line.unitPrice) as unknown;
      if (data['quantity'] !== undefined) data['quantityUnsure'] = false;   // the desk has confirmed the quantity
      data['needsReview'] = nextPrice === null || ((data['quantityUnsure'] ?? line.quantityUnsure) as boolean);
      const updated = await tx.chargeLine.update({ where: { id }, data });
      await audit(tx, {
        userId: req.userId, action: locked ? 'LINE_ADJUSTED' : 'LINE_EDITED', entity: 'ChargeLine', entityId: id, invoiceId: line.invoiceId, patientId: line.patientId,
        before: { quantity: Number(line.quantity), unitPrice: line.unitPrice === null ? null : Number(line.unitPrice) },
        after: { quantity: Number(updated.quantity), unitPrice: updated.unitPrice === null ? null : Number(updated.unitPrice) },
        reason: reason ?? undefined, approvedById: locked ? req.userId : undefined,
      });
      await recalcInvoice(tx, line.invoiceId, req.userId);
      return updated;
    });
    res.json({ ...out, quantity: Number(out.quantity), unitPrice: out.unitPrice === null ? null : Number(out.unitPrice) });
  } catch (e: any) { fail(res, 409, e?.message ?? 'Couldn’t save that change.'); }
}

// POST /charge-lines/:id/void { reason }
export async function voidLine(req: AuthRequest, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const reason = text(req.body?.reason, 300);
  if (!reason) return fail(res, 400, 'Give a reason for removing this charge.');
  const found = await prisma.chargeLine.findUnique({ where: { id } });
  if (!found) return fail(res, 404, 'That charge no longer exists. Refresh the page.');
  const admin = isAdmin(req.userRole);
  try {
    await prisma.$transaction(async (tx) => {
      await lockInvoice(tx, found.invoiceId);
      const line = await tx.chargeLine.findUniqueOrThrow({ where: { id }, include: { invoice: true } });
      if (line.invoice.status === 'VOID' || line.invoice.status === 'WAIVED') throw new Error('This invoice is closed.');
      if (line.status !== 'ACTIVE') throw new Error('That charge was already removed.');
      const why = editRule(line, line.invoice.status !== 'OPEN', admin, 'void');
      if (why) throw new Error(why);
      await tx.chargeLine.update({ where: { id }, data: { status: 'VOIDED', voidedAt: new Date(), voidReason: reason } });
      await audit(tx, { userId: req.userId, action: line.invoice.status === 'OPEN' ? 'LINE_VOIDED' : 'LINE_ADJUSTED', entity: 'ChargeLine', entityId: id, invoiceId: line.invoiceId, patientId: line.patientId,
        before: { description: line.description, quantity: Number(line.quantity), unitPrice: line.unitPrice === null ? null : Number(line.unitPrice) }, after: { status: 'VOIDED' }, reason, approvedById: line.invoice.status === 'OPEN' ? undefined : req.userId });
      await recalcInvoice(tx, line.invoiceId, req.userId);
    });
    res.json({ ok: true });
  } catch (e: any) { fail(res, 409, e?.message ?? 'Couldn’t remove that charge.'); }
}

// ── Payments ─────────────────────────────────────────────────────────────────
// POST /invoices/:id/payments { amount, method, reference?, payerName?, payerPhone?, dueDate? }
export async function takePayment(req: AuthRequest, res: Response): Promise<void> {
  const invoiceId = String(req.params['id']);
  const b = req.body ?? {};
  const amount = num(b.amount);
  const method = String(b.method ?? '').toUpperCase() as PaymentMethod;
  if (!PAYMENT_METHODS.includes(method)) return fail(res, 400, 'Choose how the client is paying.');
  if (amount === null || amount <= 0 || amount > MAX_MONEY) return fail(res, 400, 'Enter an amount of more than 0.');
  const amountC = Math.round(amount * 100);
  const reference = text(b.reference, 40);
  if ((method === 'MOBILE_MONEY' || method === 'CARD') && (!reference || reference.length < 4)) {
    return fail(res, 400, method === 'CARD' ? 'Enter the card slip or approval number.' : 'Enter the mobile money reference so it can be matched to the statement.');
  }
  const payerName = text(b.payerName, 100);
  const payerPhone = text(b.payerPhone, 20);
  if (payerPhone && !/^[+\d][\d\s-]{6,18}$/.test(payerPhone)) return fail(res, 400, 'The payer’s phone number doesn’t look right.');
  let dueDate: Date | null = null;
  if (b.dueDate) {
    dueDate = new Date(String(b.dueDate));
    if (Number.isNaN(dueDate.getTime()) || dueDate.getTime() < Date.now() - 86_400_000 || dueDate.getTime() > Date.now() + 366 * 86_400_000) {
      return fail(res, 400, 'Choose a due date within the next year.');
    }
  }

  try {
    const out = await prisma.$transaction(async (tx) => {
      await lockInvoice(tx, invoiceId);
      const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, include });
      if (!inv) throw Object.assign(new Error('That invoice doesn’t exist.'), { code: 404 });
      if (inv.status !== 'OPEN' && inv.status !== 'PART_PAID') throw new Error(inv.status === 'PAID' ? 'This invoice is already paid.' : 'This invoice is closed.');

      const session = await tx.cashierSession.findFirst({ where: { userId: req.userId!, closedAt: null } });
      if (!session) throw new Error('Open your cashier session before taking payment.');

      const s = summarize(inv);
      if (s.unpriced > 0) throw new Error(`${s.unpriced} charge${s.unpriced === 1 ? ' has' : 's have'} no price yet. Set the price first, or send the client back to the prescriber.`);
      const balanceC = toCents(s.balance);
      if (balanceC <= 0) throw new Error('There is nothing left to pay on this invoice.');
      if (amountC > balanceC) throw new Error(`That is more than the balance (${zmw(balanceC)}).`);

      if (method === 'CREDIT' && amountC > (await creditBalanceC(tx, inv.patientId))) throw new Error('The patient doesn’t have that much credit.');
      if (reference && method !== 'CREDIT') {
        const dupe = await tx.payment.findFirst({ where: { method, reference: { equals: reference, mode: 'insensitive' }, status: 'ACTIVE' } });
        if (dupe) throw new Error(`That reference was already used on receipt ${dupe.receiptNumber}.`);
      }

      const pay = await tx.payment.create({
        data: { receiptNumber: await nextDocumentNumber(tx, 'RCT'), invoiceId, amount: amountC / 100, method, reference, payerName, payerPhone, receivedById: req.userId!, sessionId: session.id },
      });
      if (method === 'CREDIT') {
        await tx.patientCredit.create({ data: { patientId: inv.patientId, amount: -amountC / 100, kind: 'APPLIED', reason: `Used on ${inv.number}`, invoiceId, paymentId: pay.id, createdById: req.userId } });
      }
      const after = await recalcInvoice(tx, invoiceId, req.userId);
      if (toCents(after.balance) > 0) {
        await tx.invoice.update({ where: { id: invoiceId }, data: { dueDate: dueDate ?? inv.dueDate ?? new Date(Date.now() + 7 * 86_400_000) } });
      }
      await audit(tx, { userId: req.userId, action: 'PAYMENT', entity: 'Payment', entityId: pay.id, invoiceId, patientId: inv.patientId, after: { receipt: pay.receiptNumber, amount: amountC / 100, method } });
      return pay;
    });
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include });
    res.status(201).json({ paymentId: out.id, receiptNumber: out.receiptNumber, invoice: (await shape([inv]))[0] });
  } catch (e: any) { fail(res, e?.code === 404 ? 404 : 409, e?.message ?? 'Couldn’t record that payment.'); }
}

// POST /payments/:id/void { reason } — administrator only; the receipt stays on record, marked void
export async function voidPayment(req: AuthRequest, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const reason = text(req.body?.reason, 300);
  if (!reason) return fail(res, 400, 'Give a reason for voiding this receipt.');
  const found = await prisma.payment.findUnique({ where: { id } });
  if (!found) return fail(res, 404, 'That receipt doesn’t exist.');
  try {
    await prisma.$transaction(async (tx) => {
      await lockInvoice(tx, found.invoiceId);
      const pay = await tx.payment.findUniqueOrThrow({ where: { id }, include: { invoice: true } });
      if (pay.status !== 'ACTIVE') throw new Error('That receipt is already void.');
      await tx.payment.update({ where: { id }, data: { status: 'VOID', voidedAt: new Date(), voidReason: reason, voidedById: req.userId } });
      if (pay.method === 'CREDIT') {
        await tx.patientCredit.create({ data: { patientId: pay.invoice.patientId, amount: pay.amount, kind: 'APPLIED', reason: `Receipt ${pay.receiptNumber} voided`, invoiceId: pay.invoiceId, paymentId: pay.id, createdById: req.userId } });
      }
      await recalcInvoice(tx, pay.invoiceId, req.userId);
      await audit(tx, { userId: req.userId, action: 'PAYMENT_VOIDED', entity: 'Payment', entityId: id, invoiceId: pay.invoiceId, patientId: pay.invoice.patientId, before: { receipt: pay.receiptNumber, amount: Number(pay.amount), method: pay.method }, reason, approvedById: req.userId });
    });
    res.json({ ok: true });
  } catch (e: any) { fail(res, 409, e?.message ?? 'Couldn’t void that receipt.'); }
}

// ── Invoice-level decisions (administrator) ──────────────────────────────────
async function withInvoice(req: AuthRequest, res: Response, fn: (tx: any, inv: any) => Promise<void>): Promise<void> {
  const id = String(req.params['id']);
  try {
    await prisma.$transaction(async (tx) => {
      await lockInvoice(tx, id);
      const inv = await tx.invoice.findUnique({ where: { id }, include });
      if (!inv) throw Object.assign(new Error('That invoice doesn’t exist.'), { code: 404 });
      await fn(tx, inv);
    });
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id }, include });
    res.json((await shape([inv]))[0]);
  } catch (e: any) { fail(res, e?.code === 404 ? 404 : 409, e?.message ?? 'Couldn’t save that.'); }
}

// POST /invoices/:id/discount { type: percent|amount|clear, value?, reason }
export async function setDiscount(req: AuthRequest, res: Response): Promise<void> {
  const type = String(req.body?.type ?? '');
  const reason = text(req.body?.reason, 300);
  const value = num(req.body?.value);
  if (!['percent', 'amount', 'clear'].includes(type)) return fail(res, 400, 'Choose a percentage or an amount.');
  if (!reason || reason.length < 3) return fail(res, 400, 'Give the reason for the discount.');
  if (type !== 'clear' && (value === null || value <= 0)) return fail(res, 400, 'Enter the discount.');
  if (type === 'percent' && value! > 100) return fail(res, 400, 'A percentage can’t be more than 100.');
  await withInvoice(req, res, async (tx, inv) => {
    if (inv.status === 'VOID' || inv.status === 'WAIVED') throw new Error('This invoice is closed.');
    const totalC = summarize(inv).total * 100;
    const cents = type === 'clear' ? 0 : type === 'percent' ? Math.round(totalC * value! / 100) : Math.round(value! * 100);
    if (cents > Math.round(totalC)) throw new Error('The discount is more than the invoice total.');
    await tx.invoice.update({ where: { id: inv.id }, data: { discountAmount: cents / 100, discountReason: type === 'clear' ? null : reason, discountById: type === 'clear' ? null : req.userId } });
    await audit(tx, { userId: req.userId, action: type === 'clear' ? 'DISCOUNT_REMOVED' : 'DISCOUNT', entity: 'Invoice', entityId: inv.id, invoiceId: inv.id, patientId: inv.patientId,
      before: { discount: Number(inv.discountAmount) }, after: { discount: cents / 100, type, value }, reason, approvedById: req.userId });
    await recalcInvoice(tx, inv.id, req.userId);
  });
}

// POST /invoices/:id/waive { reason } — a free or exempt visit; only if nothing has been paid
export async function waiveInvoice(req: AuthRequest, res: Response): Promise<void> {
  const reason = text(req.body?.reason, 300);
  if (!reason || reason.length < 3) return fail(res, 400, 'Give the reason this visit is free or exempt.');
  await withInvoice(req, res, async (tx, inv) => {
    if (inv.status !== 'OPEN') throw new Error(inv.status === 'WAIVED' ? 'This invoice is already waived.' : 'Only an invoice with no payments can be waived.');
    await tx.invoice.update({ where: { id: inv.id }, data: { status: 'WAIVED', waivedAt: new Date(), waivedReason: reason, waivedById: req.userId, lockedAt: new Date() } });
    await audit(tx, { userId: req.userId, action: 'WAIVED', entity: 'Invoice', entityId: inv.id, invoiceId: inv.id, patientId: inv.patientId, after: { total: summarize(inv).total }, reason, approvedById: req.userId });
  });
}

// POST /invoices/:id/void { reason } — number stays on record
export async function voidInvoice(req: AuthRequest, res: Response): Promise<void> {
  const reason = text(req.body?.reason, 300);
  if (!reason || reason.length < 3) return fail(res, 400, 'Give a reason for voiding this invoice.');
  await withInvoice(req, res, async (tx, inv) => {
    if (inv.status === 'VOID') throw new Error('This invoice is already void.');
    if (inv.payments.some((p: any) => p.status === 'ACTIVE')) throw new Error('This invoice has payments. Void those receipts first.');
    await tx.invoice.update({ where: { id: inv.id }, data: { status: 'VOID', voidedAt: new Date(), voidReason: reason, voidedById: req.userId, lockedAt: new Date() } });
    await audit(tx, { userId: req.userId, action: 'INVOICE_VOIDED', entity: 'Invoice', entityId: inv.id, invoiceId: inv.id, patientId: inv.patientId, reason, approvedById: req.userId });
  });
}

// POST /invoices/:id/release { reason } — allow the client to leave with a balance (approver recorded)
export async function releaseWithBalance(req: AuthRequest, res: Response): Promise<void> {
  const reason = text(req.body?.reason, 300);
  if (!reason || reason.length < 3) return fail(res, 400, 'Give the reason the client may leave with a balance.');
  await withInvoice(req, res, async (tx, inv) => {
    if (summarize(inv).balance <= 0) throw new Error('There is no balance on this invoice.');
    await tx.invoice.update({ where: { id: inv.id }, data: { releasedAt: new Date(), releasedById: req.userId, releaseReason: reason } });
    await audit(tx, { userId: req.userId, action: 'RELEASED_WITH_BALANCE', entity: 'Invoice', entityId: inv.id, invoiceId: inv.id, patientId: inv.patientId, after: { balance: summarize(inv).balance }, reason, approvedById: req.userId });
  });
}

// GET /invoices/:id/audit — administrator
export async function invoiceAudit(req: AuthRequest, res: Response): Promise<void> {
  const rows = await prisma.billingAudit.findMany({ where: { invoiceId: String(req.params['id']) }, orderBy: { at: 'asc' }, take: 300 });
  const names = await userNames(rows.flatMap((r) => [r.userId, r.approvedById]));
  res.json(rows.map((r) => ({ ...r, userName: r.userId ? names[r.userId] ?? null : null, approvedByName: r.approvedById ? names[r.approvedById] ?? null : null })));
}

// PATCH /prescriptions/:id/availability { notAvailable, reason? } — pharmacy is out of stock; the charge is dropped
export async function setPrescriptionAvailability(req: AuthRequest, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const notAvailable = req.body?.notAvailable === true;
  const rx = await prisma.prescription.findUnique({ where: { id }, include: { encounter: { select: { patientId: true } } } });
  if (!rx) return fail(res, 404, 'That prescription doesn’t exist.');
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'dispense:' + id}))`;
      const current = await tx.prescription.findUniqueOrThrow({ where: { id } });
      if (current.dispensed) throw new Error('This prescription has already been dispensed.');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'invoice:' + rx.encounter.patientId}))`;
      await applyPrescriptionAvailability(tx, rx, notAvailable, req.userId);
    });
    res.json({ ok: true, notAvailable });
  } catch (e: any) { fail(res, 409, e?.message ?? 'Couldn’t save that.'); }
}
