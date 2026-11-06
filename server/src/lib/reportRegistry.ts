import ExcelJS from 'exceljs';
import type { Report } from '../controllers/billingReports.controller';

// The one place a report is declared. A report cannot be added without saying what it is, how it counts and who may open and export it.

export interface ReportDefinition {
  area: string;                        // the tab it belongs to, e.g. 'billing', 'stock'
  name: string;                        // its address within the area: GET /reports/:area/:name
  title: string;
  description: string;
  definitions: readonly string[];      // written metric definitions: shown under the numbers and on the Excel Definitions sheet
  filters: readonly string[];          // the query parameters it reads
  roles: {
    aggregate: readonly string[];      // who may open the counts and totals
    lineList?: readonly string[];      // who may open the records behind them (none for a report that has no line list)
    export: readonly string[];         // who may export to Excel; each must also be able to open the report
  };
  run: (query: Record<string, unknown>) => Promise<Report | { error: string }>;
}

const registry = new Map<string, ReportDefinition>();
const key = (area: string, name: string) => `${area}/${name}`;
const SLUG = /^[a-z][a-z0-9-]*$/;

export function registerReport(def: ReportDefinition): void {
  const where = key(def.area, def.name);
  if (!SLUG.test(def.area) || !SLUG.test(def.name)) throw new Error(`Report ${where}: area and name must be lower-case words.`);
  if (registry.has(where)) throw new Error(`Report ${where} is already registered.`);
  if (!def.title.trim() || !def.description.trim()) throw new Error(`Report ${where}: a title and a description are required.`);
  if (def.definitions.length === 0 || def.definitions.some(d => !d.trim())) throw new Error(`Report ${where}: write down how it counts.`);
  if (def.roles.aggregate.length === 0) throw new Error(`Report ${where}: say who may open it.`);
  const may = new Set([...def.roles.aggregate, ...(def.roles.lineList ?? [])]);
  if (def.roles.export.some(r => !may.has(r))) throw new Error(`Report ${where}: only a role that can open the report can export it.`);
  registry.set(where, def);
}

export const findReport = (area: string, name: string) => registry.get(key(area, name));
export const roleList = (role: string | null | undefined) => (role ?? '').split(',').map(r => r.trim()).filter(Boolean);
export const mayUse = (role: string | null | undefined, allowed: readonly string[]) => roleList(role).some(r => allowed.includes(r));
// Opening a report takes the aggregate role or the line-list role.
export const canOpen = (role: string | null | undefined, d: ReportDefinition) => mayUse(role, d.roles.aggregate) || mayUse(role, d.roles.lineList ?? []);
export const reportsFor = (role: string | null | undefined) => [...registry.values()].filter(d => canOpen(role, d));

// The filters a request actually used, in the order the report declares them, for the log and the Definitions sheet.
export function appliedFilters(def: ReportDefinition, query: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of def.filters) {
    const value = query[name];
    if (typeof value === 'string' && value.trim()) out[name] = value.trim().slice(0, 160);
  }
  return out;
}

const BLUE = 'FF1F5F96';
// A sheet beside the numbers that says what they mean, who asked for them and when.
export function addDefinitionsSheet(wb: ExcelJS.Workbook, def: ReportDefinition, report: Report, filters: Record<string, string>, by: string): void {
  const ws = wb.addWorksheet('Definitions', { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 24 }, { width: 100 }];
  const heading = (row: number, text: string) => { const c = ws.getCell(row, 1); c.value = text; c.font = { name: 'Calibri', bold: true, size: 12, color: { argb: BLUE } }; };
  const put = (row: number, label: string, value: string) => {
    const a = ws.getCell(row, 1), b = ws.getCell(row, 2);
    a.value = label; a.font = { name: 'Calibri', bold: true, size: 11 }; a.alignment = { vertical: 'top' };
    b.value = value; b.font = { name: 'Calibri', size: 11 }; b.alignment = { vertical: 'top', wrapText: true };
  };
  ws.getCell(1, 1).value = def.title; ws.getCell(1, 1).font = { name: 'Calibri', bold: true, size: 16 };
  ws.getCell(2, 1).value = def.description; ws.getCell(2, 1).font = { name: 'Calibri', size: 11, color: { argb: 'FF6B7280' } };
  heading(4, 'About this file');
  put(5, 'Period', report.period);
  const used = Object.entries(filters);
  put(6, 'Filters applied', used.length ? used.map(([k, v]) => `${k}: ${v}`).join('; ') : 'None');
  put(7, 'Generated', `${new Date().toLocaleString('en-GB')} by ${by}`);
  put(8, 'Rows', String(report.rows.length));
  heading(10, 'How it counts');
  def.definitions.forEach((text, i) => put(11 + i, `${i + 1}`, text));
}
