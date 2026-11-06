# Lab reports (Reports Hub stage 5)

The **Lab** tab on the Reports page has three reports. All three are built from the investigation order items and their results, and every number can be opened to the tests behind it.

| Report | Address | Counts | Who may open | Line list |
|---|---|---|---|---|
| Tests ordered and done | `GET /reports/lab/tests` | Tests **ordered** in the period, by test or by specimen: pending, in progress, completed, other | Reports roles (clinical roles and reception) | Clinical roles |
| Turnaround | `GET /reports/lab/turnaround` | Tests **resulted** in the period: median and longest time from order to result, and from sample received to result | Reports roles | Clinical roles |
| Abnormal and positive results | `GET /reports/lab/abnormal` | Tests **resulted** in the period, by the most serious flag | **Clinical roles only** | Clinical roles |

Each has `/lines` for the records, `format=xlsx` for Excel (Summary, Line list, Definitions) and the same export log, names rule and period as the other reports. Reception sees the first two as counts only; abnormal and positive results are for the clinical roles because a positive result says something about a patient's health.

## What the data allows

This is what is stored, and so what can and cannot be reported:

- **Test group and ward or department are not stored.** The reports group by **test name** and by **specimen** (blood, serum, urine and so on). A test with no specimen is grouped as "Not recorded".
- **Rejected samples are not stored**, so there is no rejection report.
- **Flags are typed by the lab** when the result is entered (Normal, High, Low, Abnormal, Positive, Negative, Critical). The system does not judge the value. A positive Widal entered with the flag Normal is counted as normal.
- **Imported documents are left out.** Results typed in from scanned papers (`catalogueId` starting `imported:`) were not ordered or done here, and their times are the day they were imported, so they would make turnaround look instant. Each report says how many were left out.
- A panel (for example a full blood count) is **one test**, not one per component.

## How it counts

- **Tests ordered and done** use the day the test was ordered. **Turnaround and abnormal results** use the day the result was *first entered*, so a test ordered last month and resulted today appears in today's turnaround but not in today's orders.
- **Status.** Pending (no sample marked received yet), In progress, Completed (Resulted or Amended). Any other status is shown as "Other status" so counts always add up.
- **Turnaround** is the order time to the first result time. A later correction keeps the first result time, so it does not change turnaround. Sample to result is shown only for tests where the lab marked the sample received, and only when that time falls between the order and the result.
- **A result dated before its order** is a recording error. It is left out of turnaround and counted in a note above the table, not hidden.
- **Abnormal and positive.** A result's flag is the most serious among its components: critical, then positive, then abnormal (which includes high and low), then normal, then no flag recorded. The current result is used, so a corrected result replaces the first. The columns add up to the number resulted.
- **Line lists** show the newest 5,000 tests (the slowest 5,000 for turnaround); the counts cover all of them. With no flag chosen, the abnormal line list shows the flagged results; `flag=all` shows every resulted test.
- Patient ID is a short code and the NRC is masked unless a clinical role asks for names.

## Filters

`from`, `to`, `groupBy` (`test` or `specimen`), `test`, `specimen`, `names`, and for lists `status` (`pending`, `inProgress`, `completed`, `other`) on tests and `flag` (`flagged`, `all`, `abnormal`, `positive`, `critical`, `normal`, `none`) on abnormal results. A clicked number on the screen sends the same filters as its row and column, and a test checks that for every row and every column.

## Also changed

The Overview's investigations panel said "By test" but listed `single` and `panel`. It now lists the tests themselves (`byTest` in the overview answer).

## Checks

- `npm run test:lab` (server, 9 groups, disposable schema, real router and signed tokens): the status rules; the two period anchors; an amended result; imported documents; a result before its order; every cell equals the rows of its line list, for every row and column of all three reports; who may open what; bad requests; the workbooks and their log rows; the registry listing per role.
- `npm run test:lab-report` (client): what each clicked number asks for, what it is called, and how durations are written.
- The tab was driven in a browser against sample server answers: all three reports, grouping by specimen, opening lists, names, both exports, reception and clinician views, light and dark themes and a phone width.
- Not tried against real data or a real login.

## Not built

- Test group, ward or department views, and rejected samples (not stored).
- Turnaround targets or a "within target" share: no target is defined yet.
- Trends over time and charts.
