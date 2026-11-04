import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { openInvoice } from './billing';
import { audit, lockInvoice, recalcInvoice } from './billingOps';
import { parseMedicationDraft } from './medicationDraft';
import { pricingUnit, PriceBasis } from './prescriptionSupply';
import { StockActor, stockPrimitives as s } from './stock';
import { issueDispensingStock, stockSelection, dispensingStockInclude } from './stockDispensing';

export class DispensingError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// The original order stays on record. Its single billing source is repriced in place.
export async function saveDispensing(body: any, actor: StockActor, key: unknown) {
  const userId = s.authorize(actor);
  if (!body.patientId || !body.dispensedDrug?.trim()) throw new DispensingError(400, 'Patient and drug are required.');
  const substitution = body.type === 'substitution';
  if (substitution && !body.prescriptionId) throw new DispensingError(400, 'A prescription is required.');
  const substitutionType = String(body.substitution?.substituteType || 'generic_equivalent');
  const substitutionReason = String(body.substitution?.reason || '').trim() || ({ generic_equivalent: 'Generic equivalent', therapeutic_alternative: 'Therapeutic alternative', out_of_stock: 'Out of stock' } as Record<string, string>)[substitutionType] || 'Drug substitution';
  const parsed = body.medication ? parseMedicationDraft(body.medication) : null;
  if (substitution && !parsed) throw new DispensingError(400, 'Enter substitute prescription details.');
  if (parsed && 'error' in parsed) throw new DispensingError(400, parsed.error);
  if (parsed && 'data' in parsed && !parsed.data.dosage) throw new DispensingError(400, 'Dosage is required.');
  if (parsed && 'data' in parsed && parsed.data.quantity == null) throw new DispensingError(400, 'Enter the substitute quantity.');
  const selection = stockSelection(body.stock);
  return s.write(prisma, actor, key, 'DISPENSE', s.snapshot(body), async (tx, operationId) => {
    const staff = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
    if (body.prescriptionId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'dispense:' + body.prescriptionId}))`;
    const rx = body.prescriptionId ? await tx.prescription.findUnique({ where: { id: body.prescriptionId }, include: { medication: true, encounter: true } }) : null;
    if (body.prescriptionId && (!rx || rx.encounter.patientId !== body.patientId)) throw new DispensingError(404, 'Prescription not found for this patient.');
    if (rx?.dispensed) throw new DispensingError(409, 'This prescription has already been dispensed.');
    if (rx?.notAvailable && !substitution) throw new DispensingError(409, 'Mark the drug in stock before dispensing it.');
    let med = rx?.medication;
    let price: number | null = null, priceItemId: string | null = null;
    let substitutionRecord: Prisma.InputJsonValue | undefined;
    if (rx) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'invoice:' + body.patientId}))`;
      const draft = parsed && 'data' in parsed ? parsed.data : null;
      const code = draft?.catalogueCode ?? (substitution ? null : med?.catalogueCode);
      if (code) {
        const item = await tx.priceListItem.findUnique({ where: { itemType_catalogueRef: { itemType: 'DRUG', catalogueRef: code } } });
        if (draft?.priceBasis && (!item?.active || item.unit !== pricingUnit(draft.priceBasis, draft.doseUnit || 'unit') || (draft.priceBasis === 'BOTTLE' && draft.bottleSizeMl != null && Number(item.bottleSizeMl) !== draft.bottleSizeMl))) throw new DispensingError(409, 'The pricing unit or bottle size changed. Refresh before dispensing.');
        if (item?.active && item.unitPrice != null) { price = Number(item.unitPrice); priceItemId = item.id; }
      } else {
        const raw = draft?.unitPrice ?? body.unitPrice ?? med?.unitPrice;
        if (raw != null && raw !== '') {
          const value = Number(raw);
          if (!Number.isFinite(value) || value < 0 || value > 10000000) throw new DispensingError(400, 'Enter a valid unit price in ZMW.');
          price = new Prisma.Decimal(value).toDecimalPlaces(2).toNumber();
        }
      }
      if (substitution && price === null) throw new DispensingError(400, 'Set the substitute unit price before dispensing.');
      if (draft && substitution) {
        med = await tx.medication.create({ data: { patientId: body.patientId, ...draft, ...(price != null ? { unitPrice: price } : {}) } });
        const stop = new Date(Math.max(rx.medication.startDate.getTime(), med.startDate.getTime() - 1));
        if (!rx.medication.endDate || rx.medication.endDate > stop) await tx.medication.update({ where: { id: rx.medicationId }, data: { endDate: stop } });
        substitutionRecord = { originalMedicationId: rx.medicationId, originalDrug: rx.medication.name, originalCourse: JSON.parse(JSON.stringify(rx.medication)), substituteMedicationId: med.id, substituteType: substitutionType, reason: substitutionReason };
      } else if (draft) {
        if (draft.name !== rx.medication.name || draft.catalogueCode !== (rx.medication.catalogueCode ?? undefined)) throw new DispensingError(400, 'Use Substitute Drug to change the medicine.');
        med = await tx.medication.update({ where: { id: rx.medicationId }, data: { ...draft, endDate: draft.endDate ?? null, durationDays: draft.durationDays ?? null, durationCount: draft.durationCount ?? null, durationUnit: draft.durationUnit ?? null, unitsPerDose: draft.unitsPerDose ?? null, ...(draft.priceBasis ? { courseQuantity: draft.courseQuantity ?? null, bottleSizeMl: draft.bottleSizeMl ?? null, billingQuantity: draft.billingQuantity ?? null, frequency: draft.frequency ?? null, route: draft.route ?? null, duration: draft.duration ?? null, notes: draft.notes ?? null } : {}) } });
      } else if (!code && body.unitPrice != null && price != null) {
        med = await tx.medication.update({ where: { id: rx.medicationId }, data: { unitPrice: price } });
      }
      const line = await tx.chargeLine.findUnique({ where: { sourceType_sourceId: { sourceType: 'PRESCRIPTION', sourceId: rx.id } } });
      if (!substitution && line?.unitPrice != null && body.unitPrice == null && !(draft && !code && draft.unitPrice != null) && (!draft?.priceBasis || draft.priceBasis === rx.medication.priceBasis)) { price = Number(line.unitPrice); priceItemId = line.priceItemId; }
      if (!substitution && med && price != null) med = await tx.medication.update({ where: { id: med.id }, data: { unitPrice: price } });
      // A substitution deliberately replaces even a paid line: payments are retained and
      // recalcInvoice turns any reduction into credit, or the increase into a balance.
      if (substitution || draft || (price !== null && (!line || line.unitPrice === null || body.unitPrice != null))) {
        const inv = line ? await tx.invoice.findUniqueOrThrow({ where: { id: line.invoiceId } }) : await openInvoice(tx, body.patientId);
        await lockInvoice(tx, inv.id);
        const current = await tx.invoice.findUniqueOrThrow({ where: { id: inv.id } });
        if (current.status === 'VOID') throw new DispensingError(409, 'The invoice is void. Resolve it with billing before dispensing.');
        if (substitution && line?.status === 'VOIDED' && line.voidReason !== 'Not available at the pharmacy') throw new DispensingError(409, 'The original charge was voided. Resolve it with billing before substitution.');
        if (!substitution && line?.status === 'VOIDED') throw new DispensingError(409, 'The prescription charge was removed. Resolve it with billing before dispensing.');
        const quantity = med?.priceBasis === 'COURSE' ? 1 : med?.billingQuantity != null ? Number(med.billingQuantity) : med?.quantity != null ? Number(med.quantity) : line ? Number(line.quantity) : 1;
        const data = { description: [med!.name, med!.dosage].filter(Boolean).join(' '), detail: [med!.frequency, med!.duration, med!.priceBasis ? pricingUnit(med!.priceBasis as PriceBasis, med!.doseUnit || 'unit') : null, med!.priceBasis && med!.quantity != null ? `Supply ${Number(med!.quantity)} ${med!.quantityUnit || 'items'}` : null, substitution ? `Substituted for ${rx.medication.name}` : null].filter(Boolean).join(' · '), quantity, unitPrice: price, priceItemId, needsReview: price === null || med!.quantity == null, quantityUnsure: med!.quantity == null, ...(substitution ? { status: 'ACTIVE', voidedAt: null, voidReason: null } : {}) };
        const changed = line ? await tx.chargeLine.update({ where: { id: line.id }, data }) : await tx.chargeLine.create({ data: { ...data, patientId: body.patientId, encounterId: rx.encounterId, invoiceId: inv.id, sourceType: 'PRESCRIPTION', sourceId: rx.id, createdById: userId } });
        await audit(tx, { userId, action: substitution ? 'SUBSTITUTE_PRESCRIPTION' : 'PRICE_AT_DISPENSING', entity: 'ChargeLine', entityId: changed.id, invoiceId: inv.id, patientId: body.patientId, before: line, after: changed, reason: substitution ? substitutionReason : 'Unit price set during dispensing' });
        await recalcInvoice(tx, inv.id, userId);
      }
      await tx.prescription.update({ where: { id: rx.id }, data: { dispensed: true, dispensedAt: new Date(), ...(substitution ? { substituteMedicationId: med!.id, notAvailable: false } : {}) } });
    } else if (parsed && 'data' in parsed) {
      med = await tx.medication.create({ data: { patientId: body.patientId, ...parsed.data } });
      if (med.catalogueCode) {
        const item = await tx.priceListItem.findUnique({ where: { itemType_catalogueRef: { itemType: 'DRUG', catalogueRef: med.catalogueCode } } });
        if (med.priceBasis && (!item?.active || item.unit !== pricingUnit(med.priceBasis as PriceBasis, med.doseUnit || 'unit') || (med.priceBasis === 'BOTTLE' && med.bottleSizeMl != null && Number(item.bottleSizeMl) !== Number(med.bottleSizeMl)))) throw new DispensingError(409, 'The drug pricing unit or bottle size changed. Refresh before dispensing.');
        if (item?.active && item.unitPrice != null) price = Number(item.unitPrice);
      } else if (med.unitPrice != null) price = Number(med.unitPrice);
      if (price != null) med = await tx.medication.update({ where: { id: med.id }, data: { unitPrice: price } });
    }
    const dispensing = await tx.dispensing.create({ data: {
      prescriptionId: rx?.id ?? null, patientId: body.patientId, type: body.type ?? 'direct',
      dispensedDrug: med?.name ?? body.dispensedDrug.trim(),
      dispensedDose: med?.dosage ?? body.dispensedDose ?? null,
      dispensedFrequency: med?.frequency ?? body.dispensedFrequency ?? null,
      dispensedDuration: med?.duration ?? body.dispensedDuration ?? null,
      quantity: med?.quantity ?? null, unitPrice: price, catalogueCode: med?.catalogueCode ?? null,
      quantityUnit: med?.quantityUnit, priceBasis: med?.priceBasis, billingQuantity: med?.priceBasis === 'COURSE' ? 1 : med?.billingQuantity ?? med?.quantity,
      dispensedBy: staff.name, substitution: substitutionRecord,
      modifications: parsed && rx && !substitution ? { original: JSON.parse(JSON.stringify(rx.medication)), dispensed: JSON.parse(JSON.stringify(med)) } : body.modifications ?? undefined,
    }, include: { patient: { select: { firstName: true, lastName: true, nationalId: true } } } });
    // Inventory uses whole units; never round a fractional clinical quantity into stock.
    const quantity = med?.quantity != null ? Number(med.quantity) : 1;
    const tracked = await issueDispensingStock(tx, operationId, userId, dispensing, selection);
    if (!tracked && Number.isInteger(quantity)) await tx.drugInventory.updateMany({ where: { drugName: { equals: dispensing.dispensedDrug, mode: 'insensitive' }, ...(med?.doseUnit === 'mL' && med?.quantityUnit !== 'bottle' ? { unit: { in: ['mL', 'ml'] } } : {}) }, data: { quantity: { decrement: quantity } } });
    const stockAllocations = await tx.stockDispensingAllocation.findMany({ where: { dispensingId: dispensing.id }, include: dispensingStockInclude });
    return { ...dispensing, stockAllocations };
  });
}
