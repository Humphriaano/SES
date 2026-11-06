# Overview summary (Reports Hub stage 8)

The top of the Reports page's Overview tab has a row of tiles and, for people who may open billing, a billing snapshot. They follow the period bar.

`GET /reports/hub/summary?from=&to=` answers both in one request. It needs a login only: what comes back depends on the person's role.

## Where the numbers come from

Nothing is calculated for the summary. `lib/hubSummary.ts` runs the registered report for the same period and copies the figures it already states, so a tile cannot disagree with the report it opens. A test compares every tile figure with the same figure from the report's own endpoint.

| Tile | Opens | Figures (from) |
|---|---|---|
| Attendance | Attendance tab | Attendances, new attendance, re-attendance (`attendance/attendance`) |
| Chronic disease | Chronic disease tab | Patients with an active chronic condition, seen in the last 90 days, overdue (`chronic/register`) |
| Laboratory | Lab tab | Tests resulted, median and longest order to result (`lab/turnaround`), waiting (`lab/tests`) |
| Pharmacy | Pharmacy tab | Dispensings, patients (`pharmacy/dispensed`), not available, waiting (`pharmacy/prescriptions`) |

Only the period is passed on. A report's own filters never reach a tile.

A tile appears only when the person's role may open that report's counts, so reception sees the four tiles (counts only) and nobody else's data is added. If one report fails, its tile says so and the others still show; the error text is not passed to the screen.

## Billing snapshot

For roles that may open the billing reports (admin and billing). Billing keeps its own reports and screens; the snapshot only summarises them and links to them.

- **Collected by payment method:** cash, mobile money and card, and the total collected. Account credit used is shown as a note because it is not new money (`billing/collections`).
- **Revenue by service:** what was charged, with discounts and waived amounts (`billing/revenue`).
- **Outstanding by age of invoice:** 0 to 7, 8 to 30, 31 to 60 and over 60 days, the total, and the number of invoices. These are **as at today**, whatever the period (`billing/outstanding`).
- The billing reports cover **one date range of up to a year**. For "All time", or a range over a year, the snapshot says to choose a period instead of showing figures for the wrong days. The tiles are unaffected.
- Only an admin sees the snapshot on this page today, because the billing role cannot open the Reports page (it is not a reports role). Billing staff use Billing reports.

## What was not done

- **Top diagnoses** stay in the Overview's existing panel; they are not repeated in a tile.
- **Charts** (attendance per day, busy times, weekday by hour) are not built. They need new queries or a design decision; the screens use labelled lists with bars.
- **A manager role** does not exist yet. When it is added, the summary follows from the roles in each report's definition, with no change here.

## Checks

- `npm run test:hub-summary` (server, 7 groups, disposable schema, real router and signed tokens): the exact figures from sample records in all four areas and billing; every tile figure equals its report's own figure; billing collected by method, revenue and outstanding equal their reports; who gets which tiles; no login; all time and over a year have no billing figures but keep the tiles; bad periods; report filters ignored; one report failing leaves the rest. Two rules were broken on purpose (a tile that drifts, and the role check removed) to confirm the test notices.
- The overview was driven in a browser against sample server answers: tiles, the billing snapshot, all time, a tile opening its tab, a failed summary, light and dark themes and a phone width.
- Not tried against real data or a real login.
