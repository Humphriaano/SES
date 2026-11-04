import { Prisma, ChargeSource, PriceItemType } from '@prisma/client';
import prisma from './prisma';
import { pricingUnit, PriceBasis } from './prescriptionSupply';
import { initialPrescriptionStock } from './stockAvailability';

type Tx = Prisma.TransactionClient;

// ── Numbering ────────────────────────────────────────────────────────────────
// Sequential per series and year. Call inside the transaction that creates the document:
// the counter row is locked by the update, so two cashiers never get the same number,
// and if the save fails the increment rolls back with it, so no number is ever skipped.
export async function nextDocumentNumber(tx: Tx, prefix: 'INV' | 'RCT'): Promise<string> {
  const year = new Date().getFullYear();
  const name = `${prefix}-${year}`;
  const row = await tx.documentCounter.upsert({
    where: { name }, create: { name, lastValue: 1 }, update: { lastValue: { increment: 1 } },
  });
  return `${prefix}-${year}-${String(row.lastValue).padStart(6, '0')}`;
}

// ── Invoices ─────────────────────────────────────────────────────────────────
// A patient has one OPEN invoice at a time; charges pile onto it as care happens. Once a payment
// locks it, the next charge starts a new invoice.
export async function openInvoice(tx: Tx, patientId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'invoice:' + patientId}))`;   // two charges at once must not create two invoices
  const existing = await tx.invoice.findFirst({ where: { patientId, status: 'OPEN' }, orderBy: { createdAt: 'desc' } });
  if (existing) return existing;
  const emergency = !!(await tx.queueEntry.findFirst({
    where: { patientId, priority: 'Emergency', checkedInAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
    select: { id: true },
  }));
  return tx.invoice.create({ data: { number: await nextDocumentNumber(tx, 'INV'), patientId, emergency } });
}

// ── Pricing ──────────────────────────────────────────────────────────────────
type PriceRow = Awaited<ReturnType<Tx['priceListItem']['findUnique']>>;

async function priceByRef(tx: Tx, itemType: PriceItemType, catalogueRef: string): Promise<PriceRow> {
  const p = await tx.priceListItem.findUnique({ where: { itemType_catalogueRef: { itemType, catalogueRef } } });
  return p && p.active ? p : null;
}

interface ChargeInput {
  patientId: string; encounterId?: string | null; sourceType: ChargeSource; sourceId: string;
  description: string; detail?: string | null; quantity?: number;
  price: { itemType: PriceItemType; catalogueRef: string } | { match: (tx: Tx) => Promise<PriceRow> } | { manual: number };
  needsReview?: boolean; quantityUnsure?: boolean; createdById?: string;
}

// Adds a charge once per source (a retry or a second save of the same prescription is a no-op).
// The price is copied onto the line here, so later price-list changes never touch it.
async function addCharge(input: ChargeInput) {
  return prisma.$transaction(tx => addChargeInTransaction(tx, input));
}
async function addChargeInTransaction(tx: Tx, input: ChargeInput) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'invoice:' + input.patientId}))`;   // one charge at a time per patient, so the duplicate check below is reliable
  const dup = await tx.chargeLine.findUnique({ where: { sourceType_sourceId: { sourceType: input.sourceType, sourceId: input.sourceId } } });
  if (dup) return dup;
  const priced = 'manual' in input.price ? { id: null, unitPrice: new Prisma.Decimal(input.price.manual) } : 'match' in input.price ? await input.price.match(tx) : await priceByRef(tx, input.price.itemType, input.price.catalogueRef);
  const invoice = await openInvoice(tx, input.patientId);
  return tx.chargeLine.create({
    data: {
      invoiceId: invoice.id, patientId: input.patientId, encounterId: input.encounterId ?? null,
      sourceType: input.sourceType, sourceId: input.sourceId, description: input.description, detail: input.detail ?? null,
      quantity: input.quantity ?? 1, unitPrice: priced?.unitPrice ?? null, priceItemId: priced?.id ?? null,
      needsReview: !!input.needsReview || !priced || priced.unitPrice === null, quantityUnsure: !!input.quantityUnsure, createdById: input.createdById,
    },
  });
}

// Billing must never get in the way of care: a failure here is logged and the clinical save still succeeds.
// The charge can be added by hand at the billing desk.
async function safely(what: string, fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); } catch (e) { console.error(`[billing] could not add ${what}:`, e); }
}

// ── Quantity from a prescription ─────────────────────────────────────────────
const PER_DAY: Record<string, number> = { od: 1, bd: 2, tds: 3, qds: 4, weekly: 1 / 7, monthly: 1 / 30 };

// Units to dispense = doses per day × days. We cannot know tablets per dose, so one unit per dose is assumed;
// anything we cannot work out is flagged for review rather than guessed.
export function dispenseQuantity(frequency?: string | null, duration?: string | null): { quantity: number; certain: boolean } {
  const f = (frequency ?? '').trim().toLowerCase();
  if (f === 'stat') return { quantity: 1, certain: true };
  const perDay = PER_DAY[f];
  const m = (duration ?? '').trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(d|day|days|w|wk|wks|week|weeks|m|mo|month|months)\b/);
  if (!perDay || !m) return { quantity: 1, certain: false };
  const n = Number(m[1]);
  const unit = m[2] ?? 'd';
  const days = unit.startsWith('d') ? n : unit.startsWith('w') ? n * 7 : n * 30;
  return { quantity: Math.max(1, Math.ceil(perDay * days)), certain: true };
}

// ── Triggers ─────────────────────────────────────────────────────────────────
// Consultation fee: charged once per patient per day, when the visit starts (vitals taken).
export function chargeConsultationFee(patientId: string, encounterId: string | null | undefined, userId?: string) {
  const day = new Date().toISOString().slice(0, 10);
  return safely('the consultation fee', () => addCharge({
    patientId, encounterId, sourceType: 'CONSULTATION', sourceId: `${patientId}:${day}`,
    description: 'Consultation fee', detail: 'Per visit', price: { itemType: 'CONSULTATION', catalogueRef: 'consultation_fee' }, createdById: userId,
  }));
}

export function chargePrescription(prescriptionId: string, userId?: string) {
  return safely('a prescription', () => prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'dispense:' + prescriptionId}))`;
    const rx = await tx.prescription.findUnique({ where: { id: prescriptionId }, include: { medication: true, encounter: { select: { patientId: true } } } });
    if (!rx) return;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'invoice:' + rx.encounter.patientId}))`;
    const existing = await tx.chargeLine.findUnique({ where: { sourceType_sourceId: { sourceType: 'PRESCRIPTION', sourceId: rx.id } } });
    if (existing) return;
    const m = rx.medication;
    const { quantity, certain } = m.billingQuantity != null || m.priceBasis === 'COURSE' || m.quantity != null
      ? { quantity: m.priceBasis === 'COURSE' ? 1 : Number(m.billingQuantity ?? m.quantity), certain: true }
      : dispenseQuantity(m.frequency, m.duration);
    await addChargeInTransaction(tx, {
      patientId: rx.encounter.patientId, encounterId: rx.encounterId, sourceType: 'PRESCRIPTION', sourceId: rx.id,
      description: [m.name, m.dosage].filter(Boolean).join(' '),
      detail: [m.frequency, m.duration, m.priceBasis ? pricingUnit(m.priceBasis as PriceBasis, m.doseUnit || 'unit') : null, m.priceBasis && m.quantity != null ? `Supply ${Number(m.quantity)} ${m.quantityUnit || 'items'}` : null].filter(Boolean).join(' · ') || null,
      quantity, needsReview: !certain, quantityUnsure: !certain, createdById: userId,
      price: !m.catalogueCode && m.unitPrice != null ? { manual: Number(m.unitPrice) } : {
        match: async (tx) => {
          if (m.catalogueCode) {
            const row = await priceByRef(tx, 'DRUG', m.catalogueCode);
            if (!row) return null;
            if (m.unitPrice != null) return { ...row, unitPrice: m.unitPrice };
            if (m.priceBasis && row.unit !== pricingUnit(m.priceBasis as PriceBasis, m.doseUnit || 'unit')) return null;
            return row;
          }
          // Typed by hand: use the price list only if the name (and dose, when there are several) points to one item
          const named = await tx.priceListItem.findMany({ where: { itemType: 'DRUG', active: true, name: { equals: m.name, mode: 'insensitive' } }, take: 50 });
          if (named.length === 1) return named[0] ?? null;
          const dose = m.dosage?.toLowerCase();
          const byDose = dose ? named.filter((n) => n.detail?.toLowerCase().startsWith(dose)) : [];
          return byDose.length === 1 ? byDose[0] ?? null : null;
        },
      },
    });
    await initialPrescriptionStock(tx, rx, userId);
  }, { timeout: 20000 }));
}

export function chargeInvestigationOrder(orderId: string, userId?: string) {
  return safely('investigations', async () => {
    const order = await prisma.investigationOrder.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) return;
    for (const item of order.items) {
      await addCharge({
        patientId: order.patientId, encounterId: order.encounterId, sourceType: 'INVESTIGATION', sourceId: item.id,
        description: item.name, detail: item.type === 'panel' ? 'Panel' : item.specimen,
        price: { itemType: 'INVESTIGATION', catalogueRef: `${item.type === 'panel' ? 'panel' : 'single'}_${item.catalogueId}` }, createdById: userId,
      });
    }
  });
}

// Totals are worked out from the lines every time, never stored.
export function invoiceTotals(lines: { status: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal | null; needsReview: boolean }[]) {
  const active = lines.filter((l) => l.status === 'ACTIVE');
  const total = active.reduce((sum, l) => sum + (l.unitPrice === null ? 0 : Math.round(Number(l.quantity) * Number(l.unitPrice) * 100)), 0) / 100;
  return { total, unpriced: active.filter((l) => l.unitPrice === null).length, review: active.filter((l) => l.needsReview).length };
}
