import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { parsePeriod, sqlWithin, type Period } from './reportPeriod';
import { userNames } from './billingOps';
import { patientCode, maskNrc, LINE_LIMIT } from './attendanceReports';
import type { Report } from '../controllers/billingReports.controller';

// Pharmacy reports (Reports Hub stage 6): medicines dispensed, and prescriptions against what was dispensed. The stock reports
// (on hand, expiry, movements, adjustments, reorder) already have their own screens in Pharmacy and are not repeated here.
// Counts and line lists come from the same rows, so every number can be traced to the records behind it.

export const PHARMACY_DEFINITIONS = [
  'A dispensing is one record of medicine given out, counted on the day it was dispensed. A prescription is one medicine on a consultation, counted on the day it was written.',
  'Quantity is the amount supplied, in the unit it was supplied in (tablets, bottles, mL). Quantities are only added together for the same item in the same unit, so a total across different items is not shown.',
  'Type: on prescription (the medicine that was prescribed), substituted (a different medicine given in its place) and without prescription (dispensed directly, with no prescription behind it).',
  'Brand comes from the stock batch the medicine was taken from. Medicines dispensed before stock was tracked by batch have no brand on record and are grouped as "Not recorded". A dispensing taken from batches of two brands is counted under each, so brand rows can add up to more than the total.',
  'A prescription is Dispensed once the pharmacy has dispensed it, Not available when the pharmacy has marked it as out of stock (the patient is not charged), and Waiting when it is neither. Waiting includes prescriptions that were never collected, however old.',
  'Items are the catalogue item where there is one; a medicine typed in by hand is grouped by its own wording.',
  `A line list shows at most ${LINE_LIMIT.toLocaleString()} records; the counts always cover all of them. It shows a patient ID and a masked NRC unless a clinical role asks for names.`,
];

const DISPENSED_GROUPS = ['item', 'brand'] as const;
const TYPES = ['prescription', 'substitution', 'direct'] as const;
const STATUSES = ['dispensed', 'notAvailable', 'waiting'] as const;
const NOT_RECORDED = 'Not recorded';
const TYPE_LABEL: Record<string, string> = { prescription: 'On prescription', substitution: 'Substituted', direct: 'Without prescription' };
const STATUS_LABEL: Record<(typeof STATUSES)[number], string> = { dispensed: 'Dispensed', notAvailable: 'Not available', waiting: 'Waiting' };

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (key: string, header: string, width = 13) => ({ key, header, type: 'int' as const, width });
const txt = (key: string, header: string, width: number) => ({ key, header, type: 'text' as const, width });
const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
const itemKey = (code: string | null, name: string) => code?.trim() || 'n:' + name.trim().toLowerCase();
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Patients and staff for a line list ──────────────────────────────────────
async function people(rows: { patientId: string; staffIds: (string | null)[] }[], names: boolean) {
  const ids = [...new Set(rows.map(r => r.patientId))];
  const patients = ids.length ? await prisma.patient.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, nationalId: true } }) : [];
  const byId = new Map(patients.map(p => [p.id, p]));
  const staff = await userNames(rows.flatMap(r => r.staffIds));
  return {
    patient: (patientId: string) => {
      const p = byId.get(patientId);
      return { patientCode: patientCode(patientId), name: names ? `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim() : '', nrc: names ? p?.nationalId ?? '' : maskNrc(p?.nationalId) };
    },
    staff: (id: string | null) => staff[id ?? ''] ?? '',
  };
}
const patientColumns = (names: boolean) => [txt('patientCode', 'Patient ID', 16), ...(names ? [txt('name', 'Name', 26)] : []), txt('nrc', names ? 'NRC' : 'NRC (masked)', 16)];
const quantityText = (q: number | null, unit: string | null) => (q === null ? '' : `${q}${unit ? ' ' + unit : ''}`);

// ── Medicines dispensed ─────────────────────────────────────────────────────
interface DFilters { period: Period; groupBy: (typeof DISPENSED_GROUPS)[number]; item?: string; brand?: string; type?: (typeof TYPES)[number] }
interface Dispensing {
  id: string; at: Date; patientId: string; type: string; name: string; dose: string | null; code: string | null; quantity: number | null; unit: string | null;
  dispensedBy: string; collectedAt: Date | null; prescribedName: string | null; brands: string[]; brandQuantity: Map<string, number>;
}

function parseDispensed(q: Record<string, unknown>): DFilters | { error: string } {
  const period = parsePeriod(q);
  if ('error' in period) return period;
  const groupBy = text(q['groupBy']) ?? 'item', type = text(q['type']);
  if (!(DISPENSED_GROUPS as readonly string[]).includes(groupBy)) return { error: 'Group by item or by brand.' };
  if (type && !(TYPES as readonly string[]).includes(type)) return { error: 'Choose on prescription, substituted or without prescription.' };
  return { period, groupBy: groupBy as DFilters['groupBy'], item: text(q['item']), brand: text(q['brand']), type: type as DFilters['type'] };
}

async function loadDispensings(p: Period): Promise<Dispensing[]> {
  const rows = await prisma.$queryRaw<(Omit<Dispensing, 'brands' | 'brandQuantity'>)[]>`
    SELECT d.id, d."dispensedAt" AS at, d."patientId", d.type, d."dispensedDrug" AS name, d."dispensedDose" AS dose, d."catalogueCode" AS code,
      d.quantity::float8 AS quantity, d."quantityUnit" AS unit, d."dispensedBy", d."collectedAt", pm.name AS "prescribedName"
    FROM "Dispensing" d
    LEFT JOIN "Prescription" rx ON rx.id = d."prescriptionId"
    LEFT JOIN "Medication" pm ON pm.id = rx."medicationId"
    WHERE TRUE ${sqlWithin('d."dispensedAt"', p)}
    ORDER BY d."dispensedAt", d.id`;
  const allocations = rows.length === 0 ? [] : await prisma.$queryRaw<{ dispensingId: string; brand: string; quantity: number }[]>`
    SELECT a."dispensingId", pr.brand, a.quantity::float8 AS quantity
    FROM "StockDispensingAllocation" a JOIN "StockBatch" b ON b.id = a."batchId" JOIN "PharmacyProduct" pr ON pr.id = b."productId"
    WHERE a."dispensingId" IN (${Prisma.join(rows.map(r => r.id))})`;
  const by = new Map<string, Map<string, number>>();
  for (const a of allocations) { const m = by.get(a.dispensingId) ?? new Map<string, number>(); m.set(a.brand, round2((m.get(a.brand) ?? 0) + a.quantity)); by.set(a.dispensingId, m); }
  return rows.map(r => { const m = by.get(r.id) ?? new Map<string, number>(); return { ...r, brands: m.size ? [...m.keys()].sort() : [NOT_RECORDED], brandQuantity: m }; });
}

const dispensingKey = (r: Dispensing) => itemKey(r.code, r.name) + '|' + (r.unit?.trim() ?? '');
const keepDispensed = (rows: Dispensing[], f: DFilters) => rows.filter(r => (!f.item || dispensingKey(r) === f.item) && (!f.type || r.type === f.type) && (!f.brand || r.brands.includes(f.brand)));
const typeOf = (r: Dispensing): (typeof TYPES)[number] => (r.type === 'substitution' ? 'substitution' : r.type === 'prescription' ? 'prescription' : 'direct');

export async function pharmacyDispensed(q: Record<string, unknown>): Promise<Report | { error: string }> {
  const f = parseDispensed(q);
  if ('error' in f) return f;
  const rows = keepDispensed(await loadDispensings(f.period), f);

  type Acc = { key: string; label: string; unit: string; ids: Set<string>; patients: Set<string>; items: Set<string>; quantity: number; unknown: number; prescription: number; substitution: number; direct: number };
  const blank = (key: string, label: string, unit: string): Acc => ({ key, label, unit, ids: new Set(), patients: new Set(), items: new Set(), quantity: 0, unknown: 0, prescription: 0, substitution: 0, direct: 0 });
  const groups = new Map<string, Acc>();
  const add = (a: Acc, r: Dispensing, quantity: number | null) => {
    if (!a.ids.has(r.id)) { a.ids.add(r.id); a[typeOf(r)]++; if (r.quantity === null) a.unknown++; }
    a.patients.add(r.patientId); a.items.add(itemKey(r.code, r.name));
    if (quantity !== null) a.quantity = round2(a.quantity + quantity);
  };
  for (const r of rows) {
    if (f.groupBy === 'item') { const k = dispensingKey(r), g = groups.get(k) ?? blank(k, r.name.trim(), r.unit?.trim() ?? ''); add(g, r, r.quantity); groups.set(k, g); }
    else for (const b of r.brands) { const g = groups.get(b) ?? blank(b, b, ''); add(g, r, r.brandQuantity.size ? r.brandQuantity.get(b) ?? 0 : r.quantity); groups.set(b, g); }
  }
  const body = [...groups.values()].sort((a, b) => b.ids.size - a.ids.size || byLabel(a, b)).map(g => ({
    label: g.label, key: g.key, unit: g.unit, dispensings: g.ids.size, patients: g.patients.size, items: g.items.size, quantity: g.quantity,
    prescription: g.prescription, substitution: g.substitution, direct: g.direct,
  }));
  const total = { dispensings: rows.length, patients: new Set(rows.map(r => r.patientId)).size, prescription: 0, substitution: 0, direct: 0 };
  for (const r of rows) total[typeOf(r)]++;
  const oneItem = !!f.item;   // a quantity only means something for one item in one unit
  const noQuantity = rows.filter(r => r.quantity === null).length;
  const filters = [f.item && 'one item', f.brand && `brand ${f.brand}`, f.type && TYPE_LABEL[f.type].toLowerCase()].filter(Boolean).join(', ');
  const columns = f.groupBy === 'item'
    ? [txt('label', 'Item', 36), txt('unit', 'Unit', 10), num('dispensings', 'Dispensings'), num('patients', 'Patients'), { key: 'quantity', header: 'Quantity', type: 'number' as const, width: 12 }, num('prescription', 'On prescription', 16), num('substitution', 'Substituted'), num('direct', 'Without prescription', 20)]
    : [txt('label', 'Brand', 36), num('dispensings', 'Dispensings'), num('patients', 'Patients'), num('items', 'Items'), ...(oneItem ? [{ key: 'quantity', header: 'Quantity', type: 'number' as const, width: 12 }] : [])];
  return {
    name: 'pharmacy-dispensed', title: f.groupBy === 'brand' ? 'Medicines dispensed by brand' : 'Medicines dispensed by item', period: filters ? `${f.period.label} · ${filters}` : f.period.label,
    columns, rows: body,
    totals: { label: 'All', ...total, ...(f.groupBy === 'brand' ? { items: new Set(rows.map(r => itemKey(r.code, r.name))).size } : {}) },
    summary: [
      { label: 'Dispensings', value: total.dispensings }, { label: 'Patients', value: total.patients }, { label: 'Items', value: new Set(rows.map(r => itemKey(r.code, r.name))).size },
      { label: 'Substituted', value: total.substitution }, ...(noQuantity ? [{ label: 'Dispensings with no quantity recorded', value: noQuantity }] : []),
    ],
  };
}

export async function pharmacyDispensedLines(q: Record<string, unknown>, options: { names: boolean }): Promise<Report | { error: string }> {
  const f = parseDispensed(q);
  if ('error' in f) return f;
  const all = keepDispensed(await loadDispensings(f.period), f).sort((a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id));
  const rows = all.slice(0, LINE_LIMIT), who = await people(rows.map(r => ({ patientId: r.patientId, staffIds: [r.dispensedBy] })), options.names);
  return {
    name: 'pharmacy-dispensed-lines', title: 'Medicines dispensed line list', period: f.period.label,
    columns: [
      { key: 'at', header: 'Dispensed', type: 'date', width: 18 }, ...patientColumns(options.names), txt('item', 'Item', 32), txt('dose', 'Dose', 14), txt('quantity', 'Quantity', 14), txt('type', 'Type', 20),
      txt('prescribed', 'Prescribed item', 28), txt('brand', 'Brand', 24), txt('by', 'Dispensed by', 22), { key: 'collectedAt', header: 'Collected', type: 'date', width: 18 },
    ],
    rows: rows.map(r => ({
      at: r.at, ...who.patient(r.patientId), item: r.name, dose: r.dose ?? '', quantity: quantityText(r.quantity, r.unit), type: TYPE_LABEL[typeOf(r)],
      prescribed: r.type === 'substitution' ? r.prescribedName ?? '' : '', brand: r.brands.join(', '), by: who.staff(r.dispensedBy), collectedAt: r.collectedAt,
    })),
    totals: null,
    summary: [{ label: 'Dispensings', value: all.length }, ...(all.length > rows.length ? [{ label: `Not shown (the list holds the newest ${LINE_LIMIT})`, value: all.length - rows.length }] : [])],
  };
}

// ── Prescriptions against dispensed ─────────────────────────────────────────
interface PFilters { period: Period; item?: string; status?: (typeof STATUSES)[number] }
interface Prescription {
  id: string; at: Date; dispensed: boolean; notAvailable: boolean; dispensedAt: Date | null; patientId: string; clinicianId: string; name: string; code: string | null;
  dose: string | null; frequency: string | null; duration: string | null; quantity: number | null; unit: string | null; dispensedBy: string | null; dispensedDrug: string | null;
}

function parsePrescriptions(q: Record<string, unknown>): PFilters | { error: string } {
  const period = parsePeriod(q);
  if ('error' in period) return period;
  const status = text(q['status']);
  if (status && !(STATUSES as readonly string[]).includes(status)) return { error: 'Choose dispensed, not available or waiting.' };
  return { period, item: text(q['item']), status: status as PFilters['status'] };
}

const loadPrescriptions = (p: Period) => prisma.$queryRaw<Prescription[]>`
  SELECT r.id, r."createdAt" AS at, r.dispensed, r."notAvailable", r."dispensedAt", e."patientId", e."clinicianId", m.name, m."catalogueCode" AS code,
    m.dosage AS dose, m.frequency, m.duration, m.quantity::float8 AS quantity, m."quantityUnit" AS unit, d."dispensedBy", d."dispensedDrug"
  FROM "Prescription" r
  JOIN "Encounter" e ON e.id = r."encounterId"
  JOIN "Medication" m ON m.id = r."medicationId"
  LEFT JOIN LATERAL (SELECT x."dispensedBy", x."dispensedDrug" FROM "Dispensing" x WHERE x."prescriptionId" = r.id ORDER BY x."dispensedAt" DESC, x.id LIMIT 1) d ON TRUE
  WHERE TRUE ${sqlWithin('r."createdAt"', p)}
  ORDER BY r."createdAt", r.id`;

// Dispensed wins over not available: a prescription that was dispensed is not a gap, whatever its availability flag says now.
const statusOf = (r: Prescription): (typeof STATUSES)[number] => (r.dispensed ? 'dispensed' : r.notAvailable ? 'notAvailable' : 'waiting');
const prescriptionKey = (r: Prescription) => itemKey(r.code, r.name);
const keepPrescriptions = (rows: Prescription[], f: PFilters) => rows.filter(r => (!f.item || prescriptionKey(r) === f.item) && (!f.status || statusOf(r) === f.status));

export async function pharmacyPrescriptions(q: Record<string, unknown>): Promise<Report | { error: string }> {
  const f = parsePrescriptions(q);
  if ('error' in f) return f;
  const rows = (await loadPrescriptions(f.period)).filter(r => !f.item || prescriptionKey(r) === f.item);

  const groups = new Map<string, { key: string; label: string; written: number; dispensed: number; notAvailable: number; waiting: number }>();
  for (const r of rows) {
    const k = prescriptionKey(r), g = groups.get(k) ?? { key: k, label: r.name.trim(), written: 0, dispensed: 0, notAvailable: 0, waiting: 0 };
    g.written++; g[statusOf(r)]++; groups.set(k, g);
  }
  const gap = (g: { notAvailable: number; waiting: number }) => g.notAvailable + g.waiting;
  const body = [...groups.values()].sort((a, b) => gap(b) - gap(a) || b.written - a.written || byLabel(a, b));   // the gaps first
  const total = body.reduce((t, g) => ({ written: t.written + g.written, dispensed: t.dispensed + g.dispensed, notAvailable: t.notAvailable + g.notAvailable, waiting: t.waiting + g.waiting }), { written: 0, dispensed: 0, notAvailable: 0, waiting: 0 });
  return {
    name: 'pharmacy-prescriptions', title: 'Prescriptions and dispensed by item', period: f.item ? `${f.period.label} · one item` : f.period.label,
    columns: [txt('label', 'Item', 36), num('written', 'Written'), num('dispensed', 'Dispensed'), num('notAvailable', 'Not available', 15), num('waiting', 'Waiting')],
    rows: body, totals: { label: 'All', ...total },
    summary: [
      { label: 'Prescriptions written', value: total.written }, { label: 'Dispensed', value: total.dispensed }, { label: 'Not available', value: total.notAvailable }, { label: 'Waiting', value: total.waiting },
      { label: 'Dispensed share (%)', value: total.written ? Math.round((total.dispensed / total.written) * 100) : 0 },
    ],
  };
}

export async function pharmacyPrescriptionLines(q: Record<string, unknown>, options: { names: boolean }): Promise<Report | { error: string }> {
  const f = parsePrescriptions(q);
  if ('error' in f) return f;
  const all = keepPrescriptions(await loadPrescriptions(f.period), f).sort((a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id));
  const rows = all.slice(0, LINE_LIMIT), who = await people(rows.map(r => ({ patientId: r.patientId, staffIds: [r.clinicianId, r.dispensedBy] })), options.names);
  return {
    name: 'pharmacy-prescriptions-lines', title: 'Prescriptions line list', period: f.period.label,
    columns: [
      { key: 'at', header: 'Written', type: 'date', width: 18 }, ...patientColumns(options.names), txt('item', 'Item', 32), txt('dose', 'Dose', 14), txt('frequency', 'Frequency', 12), txt('duration', 'Duration', 12), txt('quantity', 'Quantity', 14),
      txt('by', 'Prescribed by', 22), txt('status', 'Status', 15), { key: 'dispensedAt', header: 'Dispensed', type: 'date', width: 18 }, txt('dispensedBy', 'Dispensed by', 22), txt('dispensedItem', 'Dispensed as', 28),
    ],
    rows: rows.map(r => ({
      at: r.at, ...who.patient(r.patientId), item: r.name, dose: r.dose ?? '', frequency: r.frequency ?? '', duration: r.duration ?? '', quantity: quantityText(r.quantity, r.unit),
      by: who.staff(r.clinicianId), status: STATUS_LABEL[statusOf(r)], dispensedAt: r.dispensed ? r.dispensedAt : null, dispensedBy: r.dispensed ? who.staff(r.dispensedBy) : '',
      dispensedItem: r.dispensed && r.dispensedDrug && r.dispensedDrug.trim().toLowerCase() !== r.name.trim().toLowerCase() ? r.dispensedDrug : '',
    })),
    totals: null,
    summary: [{ label: 'Prescriptions', value: all.length }, ...(all.length > rows.length ? [{ label: `Not shown (the list holds the newest ${LINE_LIMIT})`, value: all.length - rows.length }] : [])],
  };
}
