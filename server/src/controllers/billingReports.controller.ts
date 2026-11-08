import { Response } from 'express';
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { fromCents, summarize, toCents, userNames, lineCents } from '../lib/billingOps';

// One query layer feeds the screens, the Excel export and the local AI, so they always show the same numbers.

type ColType = 'text' | 'money' | 'int' | 'number' | 'date';
interface Col { key: string; header: string; type: ColType; width: number }
export interface Report {
  name: string; title: string; period: string; columns: Col[]; rows: Record<string, unknown>[];
  totals: Record<string, unknown> | null; summary: { label: string; value: number | string; money?: boolean }[];
  groups?: { label: string; from: string; to: string }[];   // headings over runs of columns, by first and last column key, e.g. "New attendance" over its male, female and total
}

const SERVICES = ['CONSULTATION', 'PRESCRIPTION', 'INVESTIGATION', 'PROCEDURE', 'MANUAL'] as const;
const SERVICE_LABEL: Record<string, string> = { CONSULTATION: 'Consultation', PRESCRIPTION: 'Drugs', INVESTIGATION: 'Investigations', PROCEDURE: 'Procedures', MANUAL: 'Other charges' };
const METHOD_LABEL: Record<string, string> = { CASH: 'Cash', MOBILE_MONEY: 'Mobile money', CARD: 'Card', CREDIT: 'Account credit' };

function parseRange(q: Record<string, unknown>): { from: Date; to: Date; label: string } | { error: string } {
  const day = (v: unknown, fallback: Date) => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return fallback;
    const d = new Date(`${v}T00:00:00`);
    return Number.isNaN(d.getTime()) ? fallback : d;
  };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const from = day(q['from'], today);
  const last = day(q['to'], from);
  if (last < from) return { error: 'The end date is before the start date.' };
  if ((last.getTime() - from.getTime()) / 86_400_000 > 366) return { error: 'Choose a range of one year or less.' };
  const to = new Date(last.getTime() + 86_400_000);
  const f = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return { from, to, label: from.getTime() === last.getTime() ? f(from) : `${f(from)} to ${f(last)}` };
}

async function daybook(range: { from: Date; to: Date; label: string }, q: Record<string, unknown>): Promise<Report> {
  const method = typeof q['method'] === 'string' && q['method'] in METHOD_LABEL ? q['method'] as string : undefined;
  const service = typeof q['service'] === 'string' && (SERVICES as readonly string[]).includes(q['service']) ? q['service'] as (typeof SERVICES)[number] : undefined;
  const cashier = typeof q['cashier'] === 'string' && q['cashier'] ? q['cashier'] : undefined;
  const pays = await prisma.payment.findMany({
    where: {
      createdAt: { gte: range.from, lt: range.to }, ...(method ? { method } : {}), ...(cashier ? { receivedById: cashier } : {}),
      ...(service ? { invoice: { lines: { some: { sourceType: service, status: 'ACTIVE' } } } } : {}),
    },
    include: { invoice: { include: { lines: true, payments: true } } }, orderBy: { createdAt: 'asc' }, take: 5000,
  });
  // Every invoice raised in the period is a line too (the sale), paid or not. A method or cashier filter is about money taken, so it leaves these out.
  const invs = method || cashier ? [] : await prisma.invoice.findMany({
    where: { createdAt: { gte: range.from, lt: range.to }, ...(service ? { lines: { some: { sourceType: service, status: 'ACTIVE' as const } } } : {}) },
    include: { lines: true, payments: true }, orderBy: { createdAt: 'asc' }, take: 5000,
  });
  const patients = await prisma.patient.findMany({ where: { id: { in: [...new Set([...pays.map((p) => p.invoice.patientId), ...invs.map((i) => i.patientId)])] } }, select: { id: true, firstName: true, lastName: true } });
  const pname = new Map(patients.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));
  const names = await userNames(pays.map((p) => p.receivedById));
  // Money in is cash, mobile money or card actually received. Account credit being used up is shown, but isn't new money.
  const isMoneyIn = (p: { status: string; method: string }) => p.status === 'ACTIVE' && p.method !== 'CREDIT';
  const saleRows = invs.map((i) => {
    const s = summarize(i);
    const closed = i.status === 'VOID' || i.status === 'WAIVED';
    return {
      id: null as string | null, patientId: i.patientId, time: i.createdAt, patient: pname.get(i.patientId) ?? '', receipt: '', invoice: i.number, type: 'Invoice', method: '', reference: '', payer: '', cashier: '',
      status: i.status === 'VOID' ? 'Void' : i.status === 'WAIVED' ? 'Waived' : 'Billed', total: closed ? s.total : s.payable, moneyIn: null as number | null, balance: s.balance,
    };
  });
  const payRows = pays.map((p) => {
    const s = summarize(p.invoice);
    return {
      id: p.id, patientId: p.invoice.patientId, time: p.createdAt, patient: pname.get(p.invoice.patientId) ?? '', receipt: p.receiptNumber, invoice: p.invoice.number,
      type: p.status !== 'ACTIVE' ? 'Void receipt' : p.method === 'CREDIT' ? 'Credit used' : 'Payment',
      method: METHOD_LABEL[p.method] ?? p.method, reference: p.reference ?? '', payer: [p.payerName, p.payerPhone].filter(Boolean).join(' · '),
      cashier: names[p.receivedById] ?? '', status: p.status === 'ACTIVE' ? 'Paid' : 'Void',
      total: s.payable, moneyIn: isMoneyIn(p) ? Number(p.amount) : null, balance: s.balance,
    };
  });
  const rows = [...saleRows, ...payRows].sort((a, b) => a.time.getTime() - b.time.getTime());
  const billedC = invs.filter((i) => i.status !== 'VOID' && i.status !== 'WAIVED').reduce((c, i) => c + toCents(summarize(i).payable), 0);
  const active = pays.filter(isMoneyIn);
  const byMethod = new Map<string, number>();
  for (const p of active) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + toCents(p.amount));
  const inC = active.reduce((s, p) => s + toCents(p.amount), 0);
  const creditC = pays.filter((p) => p.status === 'ACTIVE' && p.method === 'CREDIT').reduce((s, p) => s + toCents(p.amount), 0);
  return {
    name: 'daybook', title: 'Day book', period: range.label,
    columns: [
      { key: 'time', header: 'Time', type: 'date', width: 18 }, { key: 'patient', header: 'Name', type: 'text', width: 26 }, { key: 'receipt', header: 'Receipt no.', type: 'text', width: 18 },
      { key: 'invoice', header: 'Invoice no.', type: 'text', width: 18 }, { key: 'type', header: 'Type', type: 'text', width: 14 }, { key: 'method', header: 'Payment type', type: 'text', width: 15 },
      { key: 'reference', header: 'Reference', type: 'text', width: 18 }, { key: 'payer', header: 'Paid by', type: 'text', width: 24 }, { key: 'cashier', header: 'Cashier', type: 'text', width: 18 },
      { key: 'total', header: 'Invoice total', type: 'money', width: 15 }, { key: 'moneyIn', header: 'Money in', type: 'money', width: 15 }, { key: 'balance', header: 'Balance now', type: 'money', width: 15 },
    ],
    rows, totals: { receipt: 'Total money in', moneyIn: fromCents(inC) },
    summary: [
      { label: 'Billed', value: fromCents(billedC), money: true }, { label: 'Invoices', value: invs.length },
      { label: 'Money in', value: fromCents(inC), money: true },
      ...[...byMethod.entries()].map(([m, c]) => ({ label: METHOD_LABEL[m] ?? m, value: fromCents(c), money: true })),
      ...(creditC > 0 ? [{ label: 'Account credit used (not new money)', value: fromCents(creditC), money: true }] : []),
      { label: 'Receipts', value: active.length }, { label: 'Voided', value: pays.filter((p) => p.status !== 'ACTIVE').length },
    ],
  };
}

async function revenue(range: { from: Date; to: Date; label: string }, q: Record<string, unknown>): Promise<Report> {
  const service = typeof q['service'] === 'string' && (SERVICES as readonly string[]).includes(q['service']) ? q['service'] as (typeof SERVICES)[number] : undefined;
  const lines = await prisma.chargeLine.findMany({
    where: { status: 'ACTIVE', createdAt: { gte: range.from, lt: range.to }, invoice: { status: { notIn: ['VOID', 'WAIVED'] } }, ...(service ? { sourceType: service } : {}) },
    select: { sourceType: true, quantity: true, unitPrice: true },
  });
  const by = new Map<string, { items: number; c: number }>();
  for (const l of lines) { const e = by.get(l.sourceType) ?? { items: 0, c: 0 }; e.items++; e.c += lineCents(l); by.set(l.sourceType, e); }
  const rows = SERVICES.filter((s) => by.has(s)).map((s) => ({ service: SERVICE_LABEL[s], items: by.get(s)!.items, charged: fromCents(by.get(s)!.c) }));
  const grossC = [...by.values()].reduce((s, e) => s + e.c, 0);

  const [disc, waived, paid] = await Promise.all([
    prisma.invoice.aggregate({ where: { createdAt: { gte: range.from, lt: range.to }, status: { notIn: ['VOID', 'WAIVED'] } }, _sum: { discountAmount: true } }),
    prisma.invoice.findMany({ where: { createdAt: { gte: range.from, lt: range.to }, status: 'WAIVED' }, include: { lines: true } }),
    prisma.payment.aggregate({ where: { createdAt: { gte: range.from, lt: range.to }, status: 'ACTIVE', method: { not: 'CREDIT' } }, _sum: { amount: true } }),
  ]);
  const waivedC = waived.reduce((s, i) => s + i.lines.filter((l) => l.status === 'ACTIVE').reduce((a, l) => a + lineCents(l), 0), 0);
  return {
    name: 'revenue', title: 'Revenue by service', period: range.label,
    columns: [{ key: 'service', header: 'Service', type: 'text', width: 28 }, { key: 'items', header: 'Items', type: 'int', width: 12 }, { key: 'charged', header: 'Charged (ZMW)', type: 'money', width: 18 }],
    rows, totals: { service: 'Total charged', items: lines.length, charged: fromCents(grossC) },
    summary: [
      { label: 'Charged', value: fromCents(grossC), money: true }, { label: 'Discounts given', value: Number(disc._sum.discountAmount ?? 0), money: true },
      { label: 'Waived (free / exempt)', value: fromCents(waivedC), money: true }, { label: 'Money collected', value: Number(paid._sum.amount ?? 0), money: true },
    ],
  };
}

async function fastMoving(range: { from: Date; to: Date; label: string }, q: Record<string, unknown>): Promise<Report> {
  const service = typeof q['service'] === 'string' && (SERVICES as readonly string[]).includes(q['service']) ? q['service'] as (typeof SERVICES)[number] : undefined;
  const rankBy = q['sort'] === 'quantity' || q['sort'] === 'value' ? q['sort'] : 'charges';
  const lines = await prisma.chargeLine.findMany({
    where: { status: 'ACTIVE', createdAt: { gte: range.from, lt: range.to }, invoice: { status: { notIn: ['VOID', 'WAIVED'] } }, ...(service ? { sourceType: service } : {}) },
    select: { sourceType: true, priceItemId: true, description: true, detail: true, quantity: true, unitPrice: true },
  });
  const priceIds = [...new Set(lines.map(line => line.priceItemId).filter((id): id is string => !!id))];
  const prices = priceIds.length ? await prisma.priceListItem.findMany({ where: { id: { in: priceIds } }, select: { id: true, name: true, detail: true, unit: true } }) : [];
  const priceById = new Map(prices.map(item => [item.id, item]));
  const by = new Map<string, { item: string; service: string; unit: string; charges: number; quantityC: number; chargedC: number; unpriced: number }>();
  for (const line of lines) {
    const priceItem = line.priceItemId ? priceById.get(line.priceItemId) : undefined;
    const detail = priceItem?.detail ?? line.detail;
    const item = [priceItem?.name ?? line.description, detail].filter(Boolean).join(' · ');
    // Catalogue identity keeps different strengths/forms separate while grouping
    // the same item across invoices. Freehand charges retain their own detail.
    const key = JSON.stringify([line.sourceType, line.priceItemId ?? [line.description, line.detail ?? ''].map(s => s.trim().replace(/\s+/g, ' ').toLowerCase())]);
    const entry = by.get(key) ?? { item, service: SERVICE_LABEL[line.sourceType] ?? line.sourceType, unit: priceItem?.unit ?? '—', charges: 0, quantityC: 0, chargedC: 0, unpriced: 0 };
    entry.charges++;
    entry.quantityC += toCents(line.quantity);
    entry.chargedC += lineCents(line);
    if (line.unitPrice === null) entry.unpriced++;
    by.set(key, entry);
  }
  const entries = [...by.values()].sort((a, b) =>
    (rankBy === 'quantity' ? b.quantityC - a.quantityC : rankBy === 'value' ? b.chargedC - a.chargedC : b.charges - a.charges)
    || b.charges - a.charges || b.chargedC - a.chargedC || a.item.localeCompare(b.item) || a.service.localeCompare(b.service));
  const charged = fromCents(entries.reduce((sum, item) => sum + item.chargedC, 0));
  const unpriced = entries.reduce((sum, item) => sum + item.unpriced, 0);
  return {
    name: 'fast-moving', title: 'Fast-moving items and services', period: range.label,
    columns: [
      { key: 'rank', header: 'Rank', type: 'int', width: 8 }, { key: 'item', header: 'Item / service', type: 'text', width: 52 },
      { key: 'service', header: 'Service type', type: 'text', width: 19 }, { key: 'unit', header: 'Priced per', type: 'text', width: 16 },
      { key: 'charges', header: 'Times charged', type: 'int', width: 17 }, { key: 'quantity', header: 'Quantity charged', type: 'number', width: 19 },
      { key: 'charged', header: 'Charged (ZMW)', type: 'money', width: 19 }, { key: 'unpriced', header: 'Unpriced charges', type: 'int', width: 19 },
    ],
    rows: entries.map((item, index) => ({ rank: index + 1, item: item.item, service: item.service, unit: item.unit, charges: item.charges, quantity: fromCents(item.quantityC), charged: fromCents(item.chargedC), unpriced: item.unpriced })),
    totals: { item: 'Total', charges: lines.length, charged, unpriced },
    summary: [
      { label: 'Ranked by', value: rankBy === 'quantity' ? 'Quantity charged' : rankBy === 'value' ? 'Billed value' : 'Times charged' },
      { label: 'Items / services', value: entries.length }, { label: 'Times charged', value: lines.length },
      { label: 'Charged before discounts', value: charged, money: true }, { label: 'Unpriced charges', value: unpriced },
    ],
  };
}

async function outstanding(): Promise<Report> {
  const invs = await prisma.invoice.findMany({
    where: { status: { in: ['OPEN', 'PART_PAID'] } }, include: { lines: true, payments: true, patient: { select: { id: true, firstName: true, lastName: true, phone: true } } }, take: 2000,
  });
  const now = Date.now();
  const rows = invs.map((i) => ({ i, s: summarize(i) })).filter((x) => x.s.balance > 0).map(({ i, s }) => {
    const age = Math.floor((now - i.createdAt.getTime()) / 86_400_000);
    return {
      patientId: i.patient.id, invoice: i.number, patient: `${i.patient.firstName} ${i.patient.lastName}`, phone: i.patient.phone ?? '', created: i.createdAt, age,
      bucket: age <= 7 ? '0–7 days' : age <= 30 ? '8–30 days' : age <= 60 ? '31–60 days' : 'Over 60 days',
      due: i.dueDate ?? '', status: s.overdue ? 'Overdue' : i.status === 'OPEN' ? 'Not yet paid' : 'Part paid', charged: s.payable, paid: s.paid, balance: s.balance,
    };
  }).sort((a, b) => b.balance - a.balance);
  const totalC = rows.reduce((s, r) => s + toCents(r.balance), 0);
  const bucket = (b: string) => fromCents(rows.filter((r) => r.bucket === b).reduce((s, r) => s + toCents(r.balance), 0));
  return {
    name: 'outstanding', title: 'Outstanding balances', period: `As at ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`,
    columns: [
      { key: 'invoice', header: 'Invoice', type: 'text', width: 18 }, { key: 'patient', header: 'Patient', type: 'text', width: 26 }, { key: 'phone', header: 'Phone', type: 'text', width: 15 },
      { key: 'created', header: 'Invoiced', type: 'date', width: 18 }, { key: 'age', header: 'Age (days)', type: 'int', width: 11 }, { key: 'bucket', header: 'Ageing', type: 'text', width: 15 },
      { key: 'due', header: 'Due', type: 'date', width: 18 }, { key: 'status', header: 'Status', type: 'text', width: 14 },
      { key: 'charged', header: 'Charged (ZMW)', type: 'money', width: 15 }, { key: 'paid', header: 'Paid (ZMW)', type: 'money', width: 15 }, { key: 'balance', header: 'Balance (ZMW)', type: 'money', width: 15 },
    ],
    rows, totals: { invoice: 'Total outstanding', balance: fromCents(totalC) },
    summary: [
      { label: 'Outstanding', value: fromCents(totalC), money: true }, { label: 'Invoices', value: rows.length },
      { label: '0–7 days', value: bucket('0–7 days'), money: true }, { label: '8–30 days', value: bucket('8–30 days'), money: true },
      { label: '31–60 days', value: bucket('31–60 days'), money: true }, { label: 'Over 60 days', value: bucket('Over 60 days'), money: true },
      { label: 'Overdue', value: rows.filter((r) => r.status === 'Overdue').length },
    ],
  };
}

async function collections(range: { from: Date; to: Date; label: string }): Promise<Report> {
  const pays = await prisma.payment.findMany({ where: { createdAt: { gte: range.from, lt: range.to } }, select: { receivedById: true, method: true, amount: true, status: true } });
  const names = await userNames(pays.map((p) => p.receivedById));
  const by = new Map<string, { receipts: number; voided: number; c: Record<string, number> }>();
  for (const p of pays) {
    const e = by.get(p.receivedById) ?? { receipts: 0, voided: 0, c: {} };
    if (p.status === 'ACTIVE') { e.receipts++; e.c[p.method] = (e.c[p.method] ?? 0) + toCents(p.amount); } else e.voided++;
    by.set(p.receivedById, e);
  }
  const rows = [...by.entries()].map(([id, e]) => {
    const total = (e.c['CASH'] ?? 0) + (e.c['MOBILE_MONEY'] ?? 0) + (e.c['CARD'] ?? 0);   // account credit used isn't new money
    return { cashier: names[id] ?? 'Unknown', receipts: e.receipts, voided: e.voided, cash: fromCents(e.c['CASH'] ?? 0), mobile: fromCents(e.c['MOBILE_MONEY'] ?? 0), card: fromCents(e.c['CARD'] ?? 0), credit: fromCents(e.c['CREDIT'] ?? 0), total: fromCents(total) };
  }).sort((a, b) => b.total - a.total);
  const sum = (k: 'cash' | 'mobile' | 'card' | 'credit' | 'total') => fromCents(rows.reduce((s, r) => s + toCents(r[k]), 0));
  return {
    name: 'collections', title: 'Collections by staff member', period: range.label,
    columns: [
      { key: 'cashier', header: 'Cashier', type: 'text', width: 26 }, { key: 'receipts', header: 'Receipts', type: 'int', width: 11 }, { key: 'voided', header: 'Voided', type: 'int', width: 10 },
      { key: 'cash', header: 'Cash (ZMW)', type: 'money', width: 15 }, { key: 'mobile', header: 'Mobile money (ZMW)', type: 'money', width: 19 }, { key: 'card', header: 'Card (ZMW)', type: 'money', width: 15 },
      { key: 'credit', header: 'Credit (ZMW)', type: 'money', width: 15 }, { key: 'total', header: 'Total (ZMW)', type: 'money', width: 15 },
    ],
    rows, totals: { cashier: 'Total', receipts: rows.reduce((s, r) => s + r.receipts, 0), voided: rows.reduce((s, r) => s + r.voided, 0), cash: sum('cash'), mobile: sum('mobile'), card: sum('card'), credit: sum('credit'), total: sum('total') },
    summary: [{ label: 'Collected', value: sum('total'), money: true }, { label: 'Staff', value: rows.length }],
  };
}

export async function buildReport(name: string, q: Record<string, unknown>): Promise<Report | { error: string }> {
  if (name === 'outstanding') return outstanding();
  const range = parseRange(q);
  if ('error' in range) return range;
  if (name === 'daybook') return daybook(range, q);
  if (name === 'revenue') return revenue(range, q);
  if (name === 'fast-moving') return fastMoving(range, q);
  if (name === 'collections') return collections(range);
  return { error: 'Unknown report.' };
}

// ── Excel ────────────────────────────────────────────────────────────────────
const BLUE = 'FF1F5F96';
const RED = 'FFC41E25';

function logoPng(): Buffer | null {
  try {
    const { Resvg } = require('@resvg/resvg-js');
    const svg = fs.readFileSync(path.resolve(__dirname, '../../../client/public/ses-mark.svg'), 'utf8');
    return Buffer.from(new Resvg(svg, { fitTo: { mode: 'height', value: 120 } }).render().asPng());
  } catch { return null; }
}

export async function toWorkbook(r: Report, by: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SES EHR';
  addReportSheet(wb, r, by);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// One branded sheet per report, so a workbook can hold several (the reports page export).
// `facility` is the facility's name and district, written beside who generated the sheet.
export function addReportSheet(wb: ExcelJS.Workbook, r: Report, by: string, sheetName?: string, facility?: string): void {
  const top = r.groups?.length ? 7 : 6;   // the row of column headings, one lower when group headings sit above them
  const ws = wb.addWorksheet((sheetName ?? r.title).slice(0, 30), { views: [{ state: 'frozen', ySplit: top, showGridLines: false }] });
  const n = r.columns.length;
  ws.columns = r.columns.map((c) => ({ key: c.key, width: c.width }));

  for (let row = 1; row <= 3; row++) for (let c = 1; c <= n; c++) ws.getCell(row, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
  ws.getRow(1).height = 22; ws.getRow(2).height = 22; ws.getRow(3).height = 22;
  const png = logoPng();
  if (png) {
    const id = wb.addImage({ buffer: png as unknown as ExcelJS.Buffer, extension: 'png' });
    ws.addImage(id, { tl: { col: 0.15, row: 0.15 }, ext: { width: 62, height: 58 } });
  }
  ws.mergeCells(1, 2, 1, n); ws.mergeCells(2, 2, 2, n); ws.mergeCells(3, 2, 3, n);
  ws.getCell(1, 2).value = 'SES EHR'; ws.getCell(1, 2).font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFCFE0F0' } };
  ws.getCell(2, 2).value = r.title; ws.getCell(2, 2).font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getCell(3, 2).value = r.period; ws.getCell(3, 2).font = { name: 'Calibri', size: 11, color: { argb: 'FFFFFFFF' } };
  for (let c = 1; c <= n; c++) ws.getCell(4, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
  ws.getRow(4).height = 4;
  ws.getCell(5, 1).value = `${facility ? facility + ' · ' : ''}Generated ${new Date().toLocaleString('en-GB')} by ${by}`;
  ws.getCell(5, 1).font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF6B7280' } };

  for (const g of r.groups ?? []) {
    const from = r.columns.findIndex(c => c.key === g.from) + 1, to = r.columns.findIndex(c => c.key === g.to) + 1;
    if (from < 1 || to < from) continue;   // a group whose columns are not all on this sheet is left out rather than drawn wrong
    if (to > from) ws.mergeCells(top - 1, from, top - 1, to);
    const cell = ws.getCell(top - 1, from);
    cell.value = g.label;
    cell.font = { name: 'Calibri', bold: true, size: 11, color: { argb: BLUE } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0F8' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  }
  const head = ws.getRow(top);
  r.columns.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: 'Calibri', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B3036' } };
    cell.alignment = { vertical: 'middle', horizontal: c.type === 'money' || c.type === 'int' || c.type === 'number' ? 'right' : 'left', wrapText: true };
  });
  head.height = 24;

  const fmt = (c: Col) => (c.type === 'money' ? '#,##0.00' : c.type === 'int' ? '#,##0' : c.type === 'number' ? '#,##0.##' : c.type === 'date' ? 'dd mmm yyyy hh:mm' : '@');
  r.rows.forEach((row, ri) => {
    const wr = ws.getRow(top + 1 + ri);
    r.columns.forEach((c, i) => {
      const v = row[c.key];
      const cell = wr.getCell(i + 1);
      cell.value = c.type === 'date' ? (v ? new Date(v as string) : null) : (v as ExcelJS.CellValue);
      cell.numFmt = fmt(c);
      cell.alignment = { vertical: 'middle', horizontal: c.type === 'money' || c.type === 'int' || c.type === 'number' ? 'right' : 'left' };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFD1D5DB' } } };
      if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F6F8' } };
    });
  });

  const end = top + r.rows.length;
  if (r.totals) {
    const tr = ws.getRow(end + 1);
    r.columns.forEach((c, i) => {
      const cell = tr.getCell(i + 1);
      cell.value = (r.totals as Record<string, ExcelJS.CellValue>)[c.key] ?? null;
      cell.numFmt = fmt(c);
      cell.font = { name: 'Calibri', bold: true, size: 11 };
      cell.alignment = { horizontal: c.type === 'money' || c.type === 'int' || c.type === 'number' ? 'right' : 'left' };
      cell.border = { top: { style: 'medium', color: { argb: BLUE } } };
    });
  }
  if (r.rows.length === 0) ws.getCell(top + 1, 1).value = 'Nothing to show for this period.';
  if (r.rows.length > 0) ws.autoFilter = { from: { row: top, column: 1 }, to: { row: end, column: n } };

  let sr = end + 4;
  ws.getCell(sr - 1, 1).value = 'Summary'; ws.getCell(sr - 1, 1).font = { name: 'Calibri', bold: true, size: 12, color: { argb: BLUE } };
  for (const s of r.summary) {
    ws.getCell(sr, 1).value = s.label; ws.getCell(sr, 1).font = { name: 'Calibri', size: 11 };
    const v = ws.getCell(sr, 2); v.value = s.value; v.numFmt = s.money ? '#,##0.00' : '#,##0'; v.font = { name: 'Calibri', size: 11, bold: true }; v.alignment = { horizontal: 'right' };
    sr++;
  }
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

// GET /billing/reports/:name?from=&to=&method=&service=&cashier=&format=xlsx
export async function runReport(req: AuthRequest, res: Response): Promise<void> {
  const report = await buildReport(String(req.params['name']), req.query as Record<string, unknown>);
  if ('error' in report) { res.status(400).json(report); return; }
  if (req.query['format'] === 'xlsx') {
    const who = (await userNames([req.userId]))[req.userId ?? ''] ?? 'staff';
    const file = `ses-${report.name}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.send(await toWorkbook(report, who));
    return;
  }
  res.json(report);
}

// GET /billing/reports/cashiers — who can be filtered on
export async function reportCashiers(_req: AuthRequest, res: Response): Promise<void> {
  const ids = await prisma.payment.findMany({ distinct: ['receivedById'], select: { receivedById: true } });
  const names = await userNames(ids.map((i) => i.receivedById));
  res.json(ids.map((i) => ({ id: i.receivedById, name: names[i.receivedById] ?? 'Unknown' })));
}
