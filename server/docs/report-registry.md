# Report registry (Reports Hub, stage 2)

One place where a report is declared, one endpoint family to run it, and one audit log for Excel exports. Billing and pharmacy stock reports are registered as they are; nothing about their own screens or routes has changed.

## Declaring a report

`registerReport()` in `src/lib/reportRegistry.ts` refuses a report that does not say:

- its **area** and **name** (lower-case words; they become the address `GET /api/reports/:area/:name`),
- a **title** and **description**,
- **definitions**: written sentences on how it counts. They are returned with the figures and printed on the Excel Definitions sheet,
- the **filters** (query parameters) it reads,
- **roles**: who may open the aggregate, who may open the line list (optional), and who may export. An exporting role must be able to open the report.

A duplicate area and name is refused too. The registered reports are in `src/lib/reportDefinitions.ts`; importing that file registers them.

## Endpoints

- `GET /api/reports/registry`: the reports the signed-in person may open (title, description, definitions, filters, and whether they can export). It is the basis for role-based tabs.
- `GET /api/reports/:area/:name?...`: the report. The figures are the report's own builder's, unchanged, plus `definitions` and `filters` (the declared filters the request used). A bad filter or date is a 400 with a readable message.
- `GET /api/reports/:area/:name?...&format=xlsx`: an Excel workbook. The report's own sheet, then a **Definitions** sheet: title, period, filters applied, who generated it and when, the row count, and how the report counts.

Opening needs the aggregate role or the line-list role; exporting needs the export role. A person with several roles (e.g. `clinician,billing`) gets the union. `/reports/population/*` keeps its own paths and its own guard (stage 1).

## Registered reports

| Area | Reports | Who |
|---|---|---|
| billing | daybook, revenue, fast-moving, outstanding, collections | admin, billing |
| stock | on-hand, expiry, movements, adjustments, reorder | admin, pharmacist |

These are the same roles as the screens these reports already have. The old routes (`/billing/reports/:name`, `/pharmacy-stock/reports/:name`) still work and are still what the screens call.

## The export log

Every Excel export through the registry writes one row to `ReportExportLog` (user, role, area, report, filters, row count, time) **before** the file is sent. If the row cannot be written, nothing is sent. A database trigger refuses any update or delete of a row. `kind` is `AGGREGATE` today; it is `LINE_LIST` for line list exports when those exist.

The new migration is `20261106010000_report_export_log` (one new table, additive). Until it is applied, and the server restarted so it loads the new table, registry exports fail with a 500; opening reports as JSON is unaffected.

## Client

- `PeriodBar` (`components/reports/PeriodBar.tsx`): the period presets and custom range as a shared component; the Reports page uses it.
- **Print** beside Export to Excel. The printed page leaves out the navigation, the controls and the chat, and lets the panels flow over as many sheets as needed.

## Checks

`npm run test:report-registry` (server, 9 groups, disposable schema, real router and tokens): what a registration must declare; who sees which report (including multi-role users and roles with none); every billing and stock report's registry output equals its own builder's; the filters echoed; readable 400s; the Definitions sheet; the log row; no row for a refused export; the log refusing changes and deletes; and no file when the log cannot be written.

## Not yet done (later stages)

- The billing and stock screens still call their old routes. Switching them to the registry, and with it getting the export log and Definitions sheet on those screens, comes once this stage is reviewed.
- Population figures (the Reports page overview, the chronic register) are not registered as reports yet, so the hub does not list them. They are the next to move.
- No line lists, so `lineList` roles are declared but unused. There is no manager role yet.
