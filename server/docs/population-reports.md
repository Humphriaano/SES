# Reports page: population figures

The **Reports & Analytics** page shows exact counts for all patients, for a chosen period, with an Excel export. Aggregates only: no patient is named anywhere on this page or in its export.

## Who can see it

`/api/reports/population/*` needs a signed-in user with a reports role (`REPORT_ROLES` in `lib/clinicalAccess.ts`: the clinical roles plus `receptionist`, the same list as the client's `reports` module). Before this change these routes answered anyone who could reach the server.

The CDS chat service reads the same endpoints, so it now forwards the asker's own login (`cds-service/main.py`, `fetch_population_data`). If the person has no access it says so instead of answering from nothing.

## The period

`?from=YYYY-MM-DD&to=YYYY-MM-DD`, whole local days, both ends included. Both or neither: no dates means all time. A missing end, a day that does not exist (31 February) or an end before the start is refused with a 400 and a plain message. The page offers Today, 7 days, 30 days, This month, 90 days, This year, All time and a custom range, and remembers the choice in the browser.

Some figures are about **now**, not the period, and say so on screen: labs waiting, procedures waiting in the treatment room, "seen in the last 90 days", and the latest blood pressure.

## What is counted

| Section | Counted |
|---|---|
| Patients | total on record; registered in the period; by age band and sex (calendar ages: 0-4, 5-17, 18-35, 36-50, 51-64, 65+) |
| Diagnoses recorded | patient diagnosis entries created in the period, top by ICD-11 code |
| Medicines | dispensings in the period (top), prescriptions written in the period, dispensed today |
| Investigations | items on orders placed in the period, by status and by test; waiting now |
| Procedures and treatment room | done in the period, how many through the treatment room, sent back, median wait from order to done, waiting now (urgent, longest wait), most done |
| Chronic diseases | see below |

All of these come from one request, `GET /reports/population/overview`, so a slow connection makes one round trip. The page keeps the last good copy for each period in the browser (up to 8, counts only) and shows it, labelled with when it was saved, if a refresh fails.

## Chronic diseases

A patient counts under a condition when they have an **active** (not resolved) diagnosis whose ICD-11 code starts with one of the condition's prefixes. Resolved entries are not counted as active. Diagnoses added as custom entries without an ICD-11 code are not matched.

This is a **starter list for clinical review**, defined in `CHRONIC_CONDITIONS` in `lib/populationReports.ts`:

| Condition | ICD-11 prefixes |
|---|---|
| Hypertension | BA00, BA01, BA02, BA04 |
| Diabetes mellitus | 5A10, 5A11, 5A13, 5A14 |
| HIV disease | 1C60, 1C61, 1C62 |
| Asthma | CA23 |
| COPD | CA22 |
| Epilepsy | 8A60, 8A61, 8A62 (not febrile or single seizures, not status epilepticus) |
| Heart failure | BD10, BD11 |
| Chronic kidney disease | GB61 |
| Sickle cell disease | 3A51, except 3A51.0 (the trait) |
| Depression | 6A70, 6A71 |

For each condition: active patients, new in the period (first recorded then; every entry when the period is all time), female/male/other, under 18, 18 to 64, 65 and over, and **seen in the last 90 days** (any encounter) against not seen. For hypertension there is also blood pressure control: patients whose **latest** reading, taken in the last 90 days, is under 140/90, those at or above it, and those with no reading in 90 days. The thresholds are `BP_LIMITS` in the same file. Patients with more than one chronic condition are counted once in the total and again in "with more than one".

Diabetes control is not reported: the glucose readings do not record whether they were fasting, so no single limit is right.

## The Excel export

`GET /reports/population/export?from=&to=` returns one workbook, one branded sheet per section (Summary, Diagnoses, Medicines dispensed, Investigations, Patients by age and sex, Procedures, Chronic diseases), up to 100 rows in each list. It uses the same sheet builder as the billing and stock exports (`addReportSheet`). The Chronic diseases sheet has the age and sex splits and the blood pressure columns that the page leaves out.

## Older endpoints

`kpis`, `diagnoses`, `vitals`, `medications`, `investigations` and `patients` keep their shape for the chat service, now behind the same login. `patients` now counts calendar ages in the new bands (it used to divide days by 365.25 and loaded every patient into memory). A new `chronic` endpoint gives the chat the chronic register.

## Checks

- `npm run test:population-reports` (server, 13 groups, disposable schema, real router and signed tokens): every endpoint refuses no login, the billing role and unknown roles; bad dates; the period against all time; empty ranges; every chronic rule above (trait, resolved, latest reading, seen recently, more than one condition); older endpoint shapes; and the workbook's sheets and values.
- `npm run test:report-period` (client): period presets across month and year ends, custom range problems, waiting times and shares.
- The page was driven in a browser against sample server answers: period changes, an incomplete custom range sending nothing, a failed refresh showing the saved copy with a way to retry, the export asking for the same period, both themes and a phone width.

_Stage 4 moved the chronic disease figures into `lib/chronic.ts` and the condition list into the database; see [report-chronic.md](report-chronic.md). The text above describes how the Overview first defined them._

_Stage 5 added the Lab tab, see [report-lab.md](report-lab.md). The Overview's investigations panel now lists tests by name (it listed `single` and `panel`), and the export sheet's "Test type" rows are now "Test"._

_Stage 6 added the Pharmacy tab, see [report-pharmacy.md](report-pharmacy.md). Stage 8 added the overview tiles and billing snapshot, see [report-overview.md](report-overview.md). Stage 7 added the HIA2 return (section 6.1 OPD), see [report-hia2.md](report-hia2.md)._

## Not built

- Comparison with the previous period, trends over time, or outbreak alerts.
- Filtering by facility, clinician or department.
- Click-through from a figure to the patients behind it. KPI cards link to the Pharmacy, Treatment room and Patients screens, which apply their own access rules; they do not filter.
- Diabetes control, and chronic conditions beyond the starter list.
- The chat's own charts and its address (`http://localhost:8000`) are unchanged apart from colour; that address is still fixed in the code.
