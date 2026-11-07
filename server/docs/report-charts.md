# The charts (the visual plan)

The Reports Hub design mockup (`SES EHR — Reports Hub Design.html`) shows pictures as well as tables. This page records which ones are built, where they sit, and the rules they follow (section 6a of the scoped plan).

## The rules

- **A picture of a report, not a new report.** Every chart asks a registered report for the same figures as that report's own screen, for the same period, so its numbers equal the table and the Excel export. The one new query, busy times, is itself a registered report with its own line list and export.
- **Numbers are readable.** Every chart shows its values on the chart or has a table beside it ("View as table" on the attendance chart). A tooltip is never the only way to read a number.
- **Plain SVG and HTML.** No chart library was added; the existing dependencies were enough.
- **Colour.** One blue pair for new and re-attendance, one for female (blue) and male (orange), with a legend each time. No brand red. No pie or donut charts, no dual axes, no dashed gridlines.
- **Follow the screen.** The pictures follow the period bar, and on the Attendance tab also its filters, and say how many records they cover.
- **Readable at any width.** A picture measures the card it sits in and is drawn at true size; below about 560 px wide it scrolls inside its card rather than shrinking its text.

## What is built

| Picture | Where | Report behind it | New data? |
|---|---|---|---|
| Attendance per day, week or month, new and re-attendance stacked, with Day / Week / Month and "View as table" | Overview | `attendance/attendance` grouped by day, week or month | No |
| Busy times: weekday by hour of check-in, every cell numbered, busiest hour named | Overview | `attendance/busy-times` | **Yes**, a new registered report |
| Who attends: female and male per age band | Overview | `attendance/attendance` for the period | No |
| Lab turnaround: median time per test, slowest first | Overview | `lab/turnaround` | No |
| Weekly trend: new and re-attendance per week, every point valued | Attendance tab | `attendance/attendance` grouped by week | No |
| By service point: attendances per service point, busiest first; selecting one filters the page | Attendance tab | `attendance/attendance` grouped by service point | **Yes**, a new grouping |
| Billing summary (collected by payment method, revenue, outstanding) | Overview | Billing reports | Built in stage 8 |
| Follow-up by condition, blood pressure control, how overdue | Chronic disease tab | Chronic register and overdue | Built in stage 4 |

The Attendance tab's "Group by" now also offers **By service point**, which is the Workload view of the design (service point only): a row opens that service point's attendances.

## Choices

- **Grouping by period length.** Days are offered for a period of up to about three months, weeks up to a year, months always; "All time" is by month only. The chart starts on days for up to 45 days, weeks up to about six months, and months beyond that, so a bar never gets thinner than it can be read.
- **Weeks cut by the period** count only the days inside it (as in the Attendance report), so the first and last weekly points can be low. The screen says so.
- **Age bands** are those of the Attendance report (under 1, 1 to 4, 5 to 14, 15 to 24, 25 to 49, 50 and over). Two of them add up to the HIA2 form's 15 and over. Patients recorded as another sex have no bar; the number is written beside the legend.
- **Busy times** uses the hour of check-in in the facility's local time. The weekdays in a period add up, so three Mondays make one Monday row. The hours shown are the working day (8 to 16), widened by any attendance outside it.

## Not built

- **Workload by clinician and median waiting time**: the design shows service point only, and the plan holds clinician and waiting time until the queue timestamps are verified.
- **OPD diagnoses**: a sub-tab in the design, but the HIA2 form has no diagnosis groups, so there is nothing to group them for. The Overview already lists the top diagnoses.
- The design's **Reports list** panel (a menu of every report): the tabs and their report lists do that job.
- Charts for the Lab and Pharmacy tabs beyond the turnaround bars: their tables with labelled bars were chosen over more pictures.

## Checks

- `npm run test:attendance-charts` (server, 5 groups, disposable schema, real router and signed tokens): service point rows, busiest first, adding up and matching the age and sex total; the busy-times matrix from fixed dates (the 10:59 check-in in the 10 o'clock hour, the same weekday in two weeks adding, a removed check-in not counted); every weekday, hour and cell equal to the attendances behind it; bad requests; roles; the workbook and its log; the registry. Two rules were broken on purpose (hours rounded to the nearest, weekdays shifted by one) to confirm the test notices.
- `npm run test:charts` (client): axis ticks, bar and line positions, heat levels, the hours shown, the sex split and which groupings a period allows.
- The pictures were driven in a browser against sample server answers: all six, the Day, Week and Month toggle, the table twin, the service point drill-down, light and dark themes, and a phone width (checked by measurement that cards stay inside the screen and charts scroll inside them).
- Not tried against real data or a real login.
