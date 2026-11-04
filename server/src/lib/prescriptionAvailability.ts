import { Prisma } from '@prisma/client';
import { audit, lockInvoice, recalcInvoice } from './billingOps';

type Tx = Prisma.TransactionClient;
export const PHARMACY_UNAVAILABLE_REASON = 'Not available at the pharmacy';

// Callers lock the prescription first, then its patient's invoice namespace.
// Keep the one existing prescription charge and its original price snapshot.
export async function applyPrescriptionAvailability(tx: Tx, rx: { id: string; encounter: { patientId: string } }, notAvailable: boolean, userId?: string, protectClosed = false) {
  await tx.prescription.update({ where: { id: rx.id }, data: { notAvailable } });
  const line = await tx.chargeLine.findUnique({ where: { sourceType_sourceId: { sourceType: 'PRESCRIPTION', sourceId: rx.id } } });
  let billingChange: 'VOIDED'|'RESTORED'|'UNCHANGED'|'PROTECTED' = 'UNCHANGED';
  if (line && protectClosed) {
    await lockInvoice(tx, line.invoiceId);
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: line.invoiceId }, select: { status: true } });
    if (invoice.status === 'VOID' || invoice.status === 'WAIVED') return { notAvailable, billingChange: 'PROTECTED' as const };
  }
  if (line && line.status === 'ACTIVE' && notAvailable) {
    await lockInvoice(tx, line.invoiceId);
    await tx.chargeLine.update({ where: { id: line.id }, data: { status: 'VOIDED', voidedAt: new Date(), voidReason: PHARMACY_UNAVAILABLE_REASON } });
    await audit(tx, { userId, action: 'LINE_VOIDED', entity: 'ChargeLine', entityId: line.id, invoiceId: line.invoiceId, patientId: rx.encounter.patientId, reason: PHARMACY_UNAVAILABLE_REASON });
    await recalcInvoice(tx, line.invoiceId, userId);
    billingChange = 'VOIDED';
  } else if (line && line.status === 'VOIDED' && !notAvailable && line.voidReason === PHARMACY_UNAVAILABLE_REASON) {
    await lockInvoice(tx, line.invoiceId);
    await tx.chargeLine.update({ where: { id: line.id }, data: { status: 'ACTIVE', voidedAt: null, voidReason: null } });
    await audit(tx, { userId, action: 'LINE_RESTORED', entity: 'ChargeLine', entityId: line.id, invoiceId: line.invoiceId, patientId: rx.encounter.patientId, reason: 'Back in stock' });
    await recalcInvoice(tx, line.invoiceId, userId);
    billingChange = 'RESTORED';
  }
  return { notAvailable, billingChange };
}
