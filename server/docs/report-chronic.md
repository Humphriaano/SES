# Chronic disease reports (Reports Hub, stage 4)

The chronic disease register, overdue and defaulters, and the condition list kept as reviewed data. They share one set of rows (one per patient and condition, `lib/chronic.ts`) and one table of named measures, so a count and the patients behind it cannot disagree.

## The condition list is data

`ChronicCondition` holds each condition: a name, ICD-11 code prefixes, optional exclusions, on or off, and who last reviewed it and when. The migration seeds the ten starter conditions from the earlier version (hypertension, diabetes, HIV, asthma, COPD, epilepsy, heart failure, kidney disease, sickle cell disease, depression) **none marked reviewed**. A diagnosis belongs to a condition when its ICD-11 code starts with a prefix and none of the exclusions. Diagnoses entered without an ICD-11 code are not matched.

- `GET /api/chronic-conditions`: the list. Clinical roles.
- `POST /api/chronic-conditions` and `PATCH /api/chronic-conditions/:id`: add, rename, change codes, switch on or off, or `{ "reviewed": true }`. **Admin only** (`CONDITION_EDITORS`; there is no separate clinical lead role yet). Every code must start at least one ICD-11 code in the system, so a typo cannot quietly make a condition count nobody. Changing a condition **clears its review**: the definition changed, so it needs confirming again.
- `ChronicConditionHistory` keeps every create, edit and review (who, when, before and after). A database trigger refuses any change to or removal of a row.
- Switched off, a condition leaves every report, including the Overview panel and its Excel sheet. The Overview and Reports tab show how many conditions have been reviewed.

## What is counted

`Seen` is any visit in the last 90 days, as of today: a queue check-in that was not removed, or a consultation. (The Overview used consultations only before; it now uses this definition too.) A patient is active for a condition while any matching diagnosis is unresolved.

| Measure | Counts |
|---|---|
| active, female, male, other | active patients, and the same by sex |
| new | first recorded in the period (every entry when the period is all time) |
| resolved | all matching diagnoses resolved, the last in the period |
| seen / overdue | active and seen in the last 90 days / not (or never) |
| controlled, notControlled, noReading | hypertension only: latest reading in the last 90 days under 140/90, at or above it, or none recent |

Overdue patients are grouped by days since their last visit: 91 to 120, 121 to 180, 181 to 365, over a year, and no visit on record. Overdue patients with an appointment booked (scheduled or confirmed, from now on; a cancelled one does not count) are counted too. Diabetes and the other conditions have **no control rule yet**: the glucose readings do not record whether they were fasting, so a rule needs a clinical decision.

## Endpoints

- `GET /api/reports/chronic/register` and `/chronic/overdue`: the counts per condition. Filters: `from`/`to`, `condition` (a key).
- `.../lines` on each: the patients. Filters: `condition`, `measure` (any of the measures above), `status` (`active`, `resolved`, `any`), `seen`, `control`, `names=1`. The overdue list is always the overdue patients, longest first (never seen first). One row per patient and condition, so someone with two conditions appears twice, as the register's rows say.
- Either, with `format=xlsx`: Summary, Line list and Definitions (the line list only for roles that may open it). Exports are logged as in stage 2.

Line list columns: patient ID, name (only if asked), NRC (masked unless names are asked for), sex, age, condition, status, year diagnosed, last visit, days since, last blood pressure (hypertension; in words: "under" or "at or above 140/90", or when it was taken if older than 90 days), current medicines (started and not ended), follow-up, next appointment.

## Who sees what

As attendance: counts for every role that may open Reports; the patients behind them, names (when asked for) and their export for the clinical roles; billing none. Reading the condition list is for clinical roles; changing it is for an admin.

## The screen

A **Chronic disease** tab with **Register** and **Overdue and defaulters** views, following the design board: condition, status, last-seen and control filters; the register table with clickable numbers; follow-up by condition; blood pressure control (the alert colour with the words, never brand red); how overdue; the line list; a names checkbox; and **Review condition list** (clinical roles read it; an admin can edit it, mark reviewed, add and switch conditions). Status, last-seen and control narrow the patients you open, not the counts, and the screen says so.

## Differences from the design

- The design's blood pressure control is among patients with a recent reading (71 of 118, 60%). This one is among all active hypertension patients, with "no recent reading" shown as its own group, so a missing reading is never hidden inside a percentage.
- The design's "Rule not defined yet" is kept for conditions other than hypertension.

## Checks

- `npm run test:chronic` (server, 10 groups): the register's counts, all-time, overdue groups, **every register cell against its line list for every condition and measure**, the line list's fields (a removed check-in is not a visit, a cancelled appointment is not one, an ended or not-yet-started medicine is not current, only the latest reading counts), names and roles, bad requests, the Overview agreeing, the Excel sheets and log, and the condition list (roles, validation, review cleared by an edit, a switched-off condition leaving the reports, the history and its protection).
- `npm run test:chronic-report` (client): what is asked for, what a clicked number opens, headings, bars.
- The screen was driven in a browser against sample answers, including the condition review as admin, clinician and reception, the dark theme and phone width.

## Not built

- A control rule for diabetes (glucose or HbA1c) or any condition but hypertension.
- A clinical lead role: until there is one, an admin reviews the list.
- Charts beyond the labelled bars; HIA2 and OPD diagnoses (next stages).
