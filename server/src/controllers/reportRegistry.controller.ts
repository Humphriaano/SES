import { Response } from 'express';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { userNames } from '../lib/billingOps';
import { addReportSheet, type Report } from './billingReports.controller';
import { addDefinitionsSheet, appliedFilters, canOpen, findReport, mayUse, reportsFor, type ReportDefinition } from '../lib/reportRegistry';
import '../lib/reportDefinitions';

const denied = (res: Response, what: string) => { res.status(403).json({ error: `You don’t have permission to ${what}.` }); };
const wantsNames = (req: AuthRequest) => req.query['names'] === '1' || req.query['names'] === 'true';

// GET /reports/registry: the reports the signed-in person may open, for building the hub's tabs.
export function listRegisteredReports(req: AuthRequest, res: Response): void {
  res.json({
    reports: reportsFor(req.userRole).map(d => ({
      area: d.area, name: d.name, title: d.title, description: d.description, definitions: d.definitions, filters: d.filters,
      canExport: mayUse(req.userRole, d.roles.export),
      lineList: !!d.lineList && mayUse(req.userRole, d.roles.lineList ?? []), canSeeNames: mayUse(req.userRole, d.roles.names ?? []),
    })),
  });
}

// Every export is logged before the file is sent; if the log cannot be written, nothing is sent.
async function sendWorkbook(req: AuthRequest, res: Response, def: ReportDefinition, sheets: { report: Report; name?: string }[], kind: 'AGGREGATE' | 'LINE_LIST', rowCount: number) {
  const filters = appliedFilters(def, req.query as Record<string, unknown>);
  await prisma.reportExportLog.create({
    data: { userId: req.userId ?? '', role: req.userRole ?? null, area: def.area, report: def.name, kind, filters: filters as Prisma.InputJsonValue, rowCount },
  });
  const by = (await userNames([req.userId]))[req.userId ?? ''] ?? 'staff';
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SES EHR';
  for (const s of sheets) addReportSheet(wb, s.report, by, s.name);
  addDefinitionsSheet(wb, def, sheets[0]!.report, filters, by);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="ses-${def.area}-${def.name}${kind === 'LINE_LIST' && sheets.length === 1 ? '-line-list' : ''}-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}

// GET /reports/:area/:name?...&format=xlsx: one report, as JSON or as an Excel workbook. Who may open and export it comes from its definition.
// A report with a line list exports as Summary, Line list and Definitions when the person may open the line list, and as Summary and Definitions when not.
export async function runRegisteredReport(req: AuthRequest, res: Response): Promise<void> {
  const def = findReport(String(req.params['area']), String(req.params['name']));
  if (!def) { res.status(404).json({ error: 'Unknown report.' }); return; }
  if (!canOpen(req.userRole, def)) { denied(res, 'open this report'); return; }
  const excel = req.query['format'] === 'xlsx';
  if (excel && !mayUse(req.userRole, def.roles.export)) { denied(res, 'export this report'); return; }
  if (!mayUse(req.userRole, def.roles.aggregate)) { denied(res, 'open the counts in this report'); return; }

  const report = await def.run(req.query as Record<string, unknown>);
  if ('error' in report) { res.status(400).json({ error: report.error }); return; }
  if (!excel) { res.json({ ...report, definitions: def.definitions, filters: appliedFilters(def, req.query as Record<string, unknown>) }); return; }

  const withLines = !!def.lineList && mayUse(req.userRole, def.roles.lineList ?? []);
  if (withLines && wantsNames(req) && !mayUse(req.userRole, def.roles.names ?? [])) { denied(res, 'see patient names in this report'); return; }
  if (!withLines) { await sendWorkbook(req, res, def, [{ report, name: def.lineList ? 'Summary' : undefined }], 'AGGREGATE', report.rows.length); return; }
  const lines = await def.lineList!.run(req.query as Record<string, unknown>, { names: wantsNames(req) });
  if ('error' in lines) { res.status(400).json({ error: lines.error }); return; }
  await sendWorkbook(req, res, def, [{ report, name: 'Summary' }, { report: lines, name: 'Line list' }], 'LINE_LIST', lines.rows.length);
}

// GET /reports/:area/:name/lines?...&names=1&format=xlsx: the records behind a report's numbers. Opening one takes the line-list role;
// patient names take the names role and have to be asked for. Exporting one is logged as a line list export.
export async function runRegisteredLines(req: AuthRequest, res: Response): Promise<void> {
  const def = findReport(String(req.params['area']), String(req.params['name']));
  if (!def || !def.lineList) { res.status(404).json({ error: 'Unknown report.' }); return; }
  if (!mayUse(req.userRole, def.roles.lineList ?? [])) { denied(res, 'open the records behind this report'); return; }
  const names = wantsNames(req);
  if (names && !mayUse(req.userRole, def.roles.names ?? [])) { denied(res, 'see patient names in this report'); return; }
  const excel = req.query['format'] === 'xlsx';
  if (excel && !mayUse(req.userRole, def.roles.export)) { denied(res, 'export this report'); return; }

  const lines = await def.lineList.run(req.query as Record<string, unknown>, { names });
  if ('error' in lines) { res.status(400).json({ error: lines.error }); return; }
  if (!excel) { res.json({ ...lines, definitions: def.definitions, filters: appliedFilters(def, req.query as Record<string, unknown>) }); return; }
  await sendWorkbook(req, res, def, [{ report: lines, name: 'Line list' }], 'LINE_LIST', lines.rows.length);
}
