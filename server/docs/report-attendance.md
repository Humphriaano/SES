# Attendance reports (Reports Hub, stage 3)

Attendance by age and sex, split into new and re-attendance, with the records behind every number. It is the first report with a line list, so it is also where the rules for line lists are set: who may open them, how names are hidden, and how exports are logged.

## What counts

- **Attendance**: one check-in at a service point in the period (`QueueEntry`). An entry with status `Removed` (taken off the queue unseen: wrong room, left, duplicate) is not counted, and does not make a later visit a return. Entries are never deleted, so the history is complete from the first check-in.
- **New attendance**: the patient's first visit to this facility: no earlier check-in (not Removed) and no earlier consultation (`Encounter`) on record. Older history, from before the period, counts. A second check-in the same day is a re-attendance.
- **Re-attendance**: every later visit.
- **Age**: completed years on the day of the check-in. Bands, as in the design (**placeholders until the HIA2 template is confirmed**): Under 1, 1 to 4, 5 to 14, 15 to 24, 25 to 49, 50 and over. They are in `AGE_BANDS` in `lib/attendanceReports.ts` and again on the client in `lib/attendanceReport.ts`; change both together.
- **Service point**: the room on the check-in (the last one, if the patient was moved).
- **Primary diagnosis** (line list): from the patient's first consultation on or after the check-in, before their next check-in and within a day; its primary diagnosis, else its first.
- **Seen by**: the staff member who started the visit in the queue, else the consultation's clinician.

The matrix and the line list are built from the same rows, so each number equals the records behind it. The test checks every cell of the matrix against its line list.

## Endpoints

- `GET /api/reports/attendance/attendance`: the counts. Filters: `from`/`to`, `servicePoint` (a room id), `sex` (`MALE`, `FEMALE`, `OTHER`), `ageBand` (`u1`, `1-4`, `5-14`, `15-24`, `25-49`, `50plus`), `groupBy` (`period`, `day`, `week`, `month`). Grouped rows carry the days they cover, so a row can open its own records. The Other columns appear only when someone is counted there, so the totals always add up.
- `GET /api/reports/attendance/attendance/lines`: the records. The same filters, plus `visit` (`new`, `re`) and `names=1`. The newest 5,000 are returned; the summary says how many older ones are not.
- Either, with `format=xlsx`: **Summary, Line list, Definitions** for a person who may open line lists; **Summary, Definitions** for one who may not. `/lines?format=xlsx` is the line list and Definitions.

## Who sees what

| | Counts | Records | Names | Excel |
|---|---|---|---|---|
| Admin, clinical roles (clinician, doctor, nurse, pharmacist, lab tech, paramedic) | Yes | Yes | Yes, when asked for | Yes |
| Receptionist | Yes | No | No | Counts only |
| Billing | No | No | No | No |

The roles are in `lib/reportDefinitions.ts` and follow the design's note "line lists name patients, so they open only for clinical roles". There is no manager role yet; when there is, it is one line there.

**Names are off by default.** A line list shows a patient ID and a masked NRC (every character but the last). A clinical role can switch names on for the view; it must be asked for each time, is not remembered, and is recorded in the export log.

**Patient ID** is `SES-` plus the first eight characters of the patient's record id. The design shows `SES-0412`, but patients have no such number in the data. A short code from the record is stable for ever; a sequence number would shift if a patient record were ever deleted. A real patient number would be a separate piece of work.

## The export log

Every export is logged before the file is sent (stage 2). A workbook that contains the line list, or a line list on its own, is logged as `LINE_LIST`; a counts-only workbook as `AGGREGATE`. The filters are stored, including `names`.

## The screen

A new **Attendance** tab on the Reports page, shown only to people the server says may open it (`GET /reports/registry`). It follows the design's attendance board: service point, sex, age band and group-by filters; the age-by-sex matrix with new and re-attendance side by side; any number opens its line list beside it, ten rows a page, with "Export these N rows to Excel"; a names checkbox for clinical roles; and the written definitions. Numbers are plain text, not buttons, for a role that cannot open line lists. The chosen tab is remembered.

## Checks

- `npm run test:attendance` (server, 8 groups): the new/re rule (history from before the period, a Removed check-in, an earlier consultation with no check-in), counts by age and sex, the Other columns, filters, day/week/month grouping and its limits, every matrix cell against its line list, the line list's fields (newest first, masked NRC, diagnosis from the right consultation, who saw them), names (who may ask), bad requests, the workbook sheets for each role, and the log.
- `npm run test:attendance-report` (client): what is asked for, what each clicked number opens, headings, cell values, paging.
- The screen was driven in a browser against sample answers, in both themes and at phone width.

## Not built

- Workload (by service point and clinician, with waiting times), OPD diagnoses, the HIA2 return, and the charts in the design (weekly trend, busy times heat map, who attends). Each is a picture of, or a further report on, the same rows.
- A facility name in the Excel header (there is no facility setting), and merged "New" / "Re-attendance" group headers in the Excel summary: it has flat headings such as "New male".
- Service points no longer in use are not offered in the filter, though their old check-ins are still counted.
