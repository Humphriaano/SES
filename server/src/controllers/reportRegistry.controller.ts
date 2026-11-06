import { Response } from 'express';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { userNames } from '../lib/billingOps';
import { addReportSheet } from './billingReports.controller';
import { addDefinitionsSheet, appliedFilters, canOpen, findReport, mayUse, reportsFor } from '../lib/reportRegistry';
import '../lib/reportDefinitions';

// GET /reports/registry: the reports the signed-in person may open, for building the hub's tabs.
export function listRegisteredReports(req: AuthRequest, res: Response): void {
  res.json({
    reports: reportsFor(req.userRole).map(d => ({
      area: d.area, name: d.name, title: d.title, description: d.description, definitions: d.definitions, filters: d.filters,
      canExport: mayUse(req.userRole, d.roles.export),
    })),
  });
}

// GET /reports/:area/:name?...&format=xlsx: one report, as JSON or as an Excel workbook (the report, then a Definitions sheet).
// Who may open and export it comes from its definition. Every export is logged before the file is sent; if the log cannot be written, nothing is sent.
export async function runRegisteredReport(req: AuthRequest, res: Response): Promise<void> {
  const def = findReport(String(req.params['area']), String(req.params['name']));
  if (!def) { res.status(404).json({ error: 'Unknown report.' }); return; }
  if (!canOpen(req.userRole, def)) { res.status(403).json({ error: 'You don’t have permission to open this report.' }); return; }
  const excel = req.query['format'] === 'xlsx';
  if (excel && !mayUse(req.userRole, def.roles.export)) { res.status(403).json({ error: 'You don’t have permission to export this report.' }); return; }

  const report = await def.run(req.query as Record<string, unknown>);
  if ('error' in report) { res.status(400).json({ error: report.error }); return; }
  const filters = appliedFilters(def, req.query as Record<string, unknown>);
  if (!excel) { res.json({ ...report, definitions: def.definitions, filters }); return; }

  await prisma.reportExportLog.create({
    data: { userId: req.userId ?? '', role: req.userRole ?? null, area: def.area, report: def.name, kind: 'AGGREGATE', filters: filters as Prisma.InputJsonValue, rowCount: report.rows.length },
  });
  const by = (await userNames([req.userId]))[req.userId ?? ''] ?? 'staff';
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SES EHR';
  addReportSheet(wb, report, by);
  addDefinitionsSheet(wb, def, report, filters, by);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="ses-${def.area}-${def.name}-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}
