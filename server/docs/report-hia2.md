# HIA2 monthly return: section 6.1 OPD (Reports Hub stage 7)

The **HIA2 return** tab lays out section 6.1 Out patients (OPD) of the Ministry of Health Service Delivery Reporting Form, **version February 2023** (`HIA2_2023_Printed.pdf`), for one calendar month. Every number sits beside the code of the form, so it can be copied across cell by cell.

`GET /reports/hia2/opd?month=YYYY-MM` returns the 33 cells; `/lines?month=YYYY-MM&code=OPD1-055` returns the attendances behind one cell (or the whole month with no code). Counts are open to the Reports roles (reception sees counts only); the attendances behind them, and names, are for the clinical roles, as in the Attendance report. Excel export and the export log work as in the other reports.

## What the form needs, and what SES has

I read all seven pages of the form. Only section 6.1 is a fit for what SES records today.

| Section of the form | In SES? |
|---|---|
| **6.1 Out patients (OPD)**: first attendances, revisits, total OPD attendances, by age and sex (OPD1-005 to OPD1-165) | **Yes, built.** It comes from check-ins on the queue |
| 5.1 Malaria testing, positives and treatment (RDT or microscopy, by age, pregnant women) | Partly: malaria tests and their results are lab orders, but they would need a **reviewed list of which lab tests count** (as the chronic condition list), pregnancy status, and a rule for treated cases. Not built |
| 4.1 HIV testing and positive results by age and sex | Partly: the same lab-test list issue. The rest of section 4 (ART, PMTCT, VMMC, PrEP, GBV) needs registers SES does not have |
| 6.2 Inpatient care, 6.3 inpatient use, 6.4 cancer screening and diagnosis | No inpatient or screening records |
| 1.0 Child health and nutrition, vaccination, 3.0 maternal and newborn care, family planning, 2.0 other vaccinations | No such modules |

The form has **no diagnosis groups**, so the ICD-11 to HIA2 mapping the plan expected is not needed for this form. The age groups on the form (under 1, 1 to 4, 5 to 14, 15 and over) are used as they are, which settles the placeholder age bands for this return.

## How it counts

- **An OPD attendance** is one check-in at a service point in the month, as in the Attendance report; a check-in taken off the queue unseen is not counted. The return is the Attendance report for that month regrouped, and a test checks that its totals and age groups equal that report.
- **First attendance:** the patient's first visit to this facility, with no earlier check-in and no earlier consultation on record. **Revisit:** any later visit. **This is the one definition to confirm against the Ministry's guidance:** if HIA2 means the first visit of the year, or of an illness episode, only the `isNew` rule in `lib/attendanceReports.ts` changes and both reports follow.
- **Age** is in completed years on the day of the check-in.
- **Sex:** the form has Male and Female only. A patient recorded as another sex is counted in the **Total** column and in neither Male nor Female, and the screen says how many, so Male plus Female can be less than Total.
- **Total OPD attendances** (OPD1-155 to 165) is first attendances plus revisits. The Total row is the four age groups. Tests check both.
- The month in progress can be chosen (it is marked), but the return is for the last whole month, which is the default. A future month is refused.

## On the screen and on paper

The tab has its own month list (the period bar is hidden there, because the return is for one month) and remembers the month chosen. Printing shows the form's heading (Ministry of Health, version, month, facility and district to write in) and the "Compiled by" and "Delivered by" signature lines. The facility and district are not stored in SES.

## Checks

- `npm run test:hia2` (server, 8 groups, disposable schema, real router and signed tokens): the 33 codes in the order of the form; every value from sample attendances across all age groups and sexes (including a revisit by a patient last seen over a year earlier, a removed check-in, a patient of another sex and a check-in in the following month); first plus revisits equals the total and the rows add up; equality with the Attendance report; every one of the 33 cells equals the rows of its line list; bad months and codes; who may open what; the workbook and its log rows; the registry per role. Two rules were broken on purpose (first and revisit swapped, the 15 and over cut) to confirm the test notices.
- `npm run test:hia2-report` (client): the month list across year ends, the default month, what is asked for, and the layout of the form.
- The tab was driven in a browser against sample server answers: opening cells, every attendance of the month, names, both exports, changing month, reception and clinician views, light and dark themes and a phone width. The print layout was checked by measurement (heading, signature lines, hidden controls, widths), not by producing a PDF.
- Not tried against real data or a real login.

## Not built

- Malaria (5.1) and HIV testing (4.1), pending a reviewed list of the lab tests that count and, for malaria, pregnancy status and the treatment rule.
- Every other section of the form, until SES records the underlying care.
- Facility and district on the form, until SES stores them.
