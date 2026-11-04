import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { staffDisplayName } from './staffNames';

type Tx = Prisma.TransactionClient;

// All money is worked out in whole ngwee (integers) so totals never drift by a fraction.
export const toCents = (v: Prisma.Decimal | number | string | null | undefined): number =>
  v === null || v === undefined ? 0 : Math.round(Number(v) * 100);
export const fromCents = (c: number): number => c / 100;

export const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'CARD', 'CREDIT'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

interface LineLike { status: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal | null; needsReview: boolean }
interface PaymentLike { status: string; amount: Prisma.Decimal; method: string }
interface InvoiceLike {
  status: string; discountAmount: Prisma.Decimal; dueDate: Date | null; waivedAt?: Date | null;
  lines: LineLike[]; payments: PaymentLike[];
}

export const lineCents = (l: { quantity: Prisma.Decimal; unitPrice: Prisma.Decimal | null }): number =>
  l.unitPrice === null ? 0 : Math.round(Number(l.quantity) * Number(l.unitPrice) * 100);

// Everything the screens show about an invoice, derived from its lines and payments every time (never stored).
export function summarize(inv: InvoiceLike) {
  const active = inv.lines.filter((l) => l.status === 'ACTIVE');
  const totalC = active.reduce((s, l) => s + lineCents(l), 0);
  const discountC = Math.min(toCents(inv.discountAmount), totalC);
  const payableC = inv.status === 'VOID' || inv.status === 'WAIVED' ? 0 : totalC - discountC;
  const paidC = inv.payments.filter((p) => p.status === 'ACTIVE').reduce((s, p) => s + toCents(p.amount), 0);
  const balanceC = inv.status === 'VOID' || inv.status === 'WAIVED' ? 0 : payableC - paidC;
  return {
    total: fromCents(totalC), discount: fromCents(discountC), payable: fromCents(payableC), paid: fromCents(paidC),
    balance: fromCents(balanceC), unpriced: active.filter((l) => l.unitPrice === null).length, review: active.filter((l) => l.needsReview).length,
    overdue: balanceC > 0 && !!inv.dueDate && inv.dueDate.getTime() < Date.now(),
  };
}

export async function audit(db: Tx | typeof prisma, e: {
  userId?: string; action: string; entity: string; entityId?: string; invoiceId?: string; patientId?: string;
  before?: unknown; after?: unknown; reason?: string; approvedById?: string;
}) {
  await db.billingAudit.create({
    data: { ...e, before: (e.before ?? undefined) as Prisma.InputJsonValue | undefined, after: (e.after ?? undefined) as Prisma.InputJsonValue | undefined },
  });
}

export async function lockInvoice(tx: Tx, invoiceId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'inv-edit:' + invoiceId}))`;
}

export async function creditBalanceC(db: Tx | typeof prisma, patientId: string): Promise<number> {
  const r = await db.patientCredit.aggregate({ where: { patientId }, _sum: { amount: true } });
  return toCents(r._sum.amount);
}

// Brings an invoice's status, lock and credit back in line with its lines and payments.
// Call inside the transaction after any change. Money paid beyond the new total becomes patient credit.
export async function recalcInvoice(tx: Tx, invoiceId: string, userId?: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: true, payments: true } });
  if (inv.status === 'VOID' || inv.status === 'WAIVED') return summarize(inv);
  const s = summarize(inv);
  const paidC = toCents(s.paid), payableC = toCents(s.payable);

  let status: 'OPEN' | 'PART_PAID' | 'PAID' = 'OPEN';
  if (paidC > 0) status = paidC >= payableC ? 'PAID' : 'PART_PAID';
  else if (payableC === 0 && toCents(s.discount) > 0) status = 'PAID';

  const lockedAt = paidC > 0 || status === 'PAID' ? inv.lockedAt ?? new Date() : null;   // the first payment locks the invoice
  if (status !== inv.status || (lockedAt === null) !== (inv.lockedAt === null)) {
    await tx.invoice.update({ where: { id: invoiceId }, data: { status, lockedAt } });
  }

  // Overpayment (e.g. after a line was removed from a paid invoice) is kept as credit for the patient.
  const issued = await tx.patientCredit.aggregate({ where: { invoiceId, kind: 'SURPLUS' }, _sum: { amount: true } });
  let diff = Math.max(paidC - payableC, 0) - toCents(issued._sum.amount);
  if (diff < 0) diff = -Math.min(-diff, Math.max(await creditBalanceC(tx, inv.patientId), 0));
  if (diff !== 0) {
    await tx.patientCredit.create({
      data: { patientId: inv.patientId, amount: fromCents(diff), kind: 'SURPLUS', invoiceId, createdById: userId,
        reason: diff > 0 ? `Overpaid on ${inv.number}` : `Correction on ${inv.number}` },
    });
  }
  return { ...s, status };
}

export async function userNames(ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (uniq.length === 0) return {};
  const users = await prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true, designation: true } });
  return Object.fromEntries(users.map((u) => [u.id, staffDisplayName(u.name, u.designation)]));
}

export const isAdmin = (role?: string) => (role ?? '').split(',').map((r) => r.trim()).includes('admin');
export const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
