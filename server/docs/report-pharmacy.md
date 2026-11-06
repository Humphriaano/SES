# Pharmacy reports (Reports Hub stage 6)

The **Pharmacy** tab on the Reports page has two reports. The stock reports (on hand, expiry, movements, adjustments, reorder) already have their own screens in Pharmacy and are not repeated; the tab links to them.

| Report | Address | Counts | Who may open | Line list |
|---|---|---|---|---|
| Medicines dispensed | `GET /reports/pharmacy/dispensed` | Dispensings in the period, by item or by brand | Reports roles (clinical roles and reception) | Clinical roles |
| Prescriptions and dispensed | `GET /reports/pharmacy/prescriptions` | Prescriptions written in the period: dispensed, not available, waiting, by item | Reports roles | Clinical roles |

Each has `/lines` for the records, `format=xlsx` for Excel (Summary, Line list, Definitions) and the same export log, names rule and period as the other reports. Reception sees counts only; billing sees neither.

## How it counts

- **A dispensing** is one `Dispensing` record, counted on the day it was dispensed. **A prescription** is one `Prescription` (one medicine on a consultation), counted on the day it was written.
- **Items** are the catalogue item (`catalogueCode`) where there is one; a medicine typed in by hand is grouped by its own wording.
- **Quantity is never added across units.** The item view has one row per item and unit (tablet, capsule, bottle, mL), and the total row shows no quantity. A dispensing with no quantity recorded is counted but adds nothing; the number of those is shown.
- **Type:** on prescription, substituted (a different medicine given in its place; the line list shows what was prescribed) and without prescription (dispensed directly). The three always add up to the dispensings.
- **Brand** comes from the stock batch the medicine was taken from (`StockDispensingAllocation` → batch → product). Dispensings from before stock was tracked by batch have no brand and are grouped as "Not recorded" (7 of the 9 in the live data today). A dispensing taken from two brands is counted under each, so brand rows can add up to more than the total; with one item chosen, a brand's quantity is what came from its batches.
- **Prescription status.** Dispensed (the pharmacy dispensed it), Not available (the pharmacy marked it out of stock; the patient is not charged), Waiting (neither). **Dispensed wins**: a prescription that was marked unavailable and later dispensed is not a gap. Waiting includes prescriptions that were never collected, however old, so it grows with age; it is not the same as "waiting at the counter now".
- The items with the most gaps (not available plus waiting) come first in the prescriptions report.
- **Line lists** show the newest 5,000 records; the counts cover all of them. A patient ID and a masked NRC are shown unless a clinical role asks for names.

## Filters

`from`, `to`, `item` (the item's key, which for dispensings includes the unit), and for dispensed `groupBy` (`item` or `brand`), `brand`, `type` (`prescription`, `substitution`, `direct`); for prescriptions `status` (`dispensed`, `notAvailable`, `waiting`). A clicked number on the screen sends the same filters as its row and column, and a test checks that for every row and column.

## On the screen

The item list in the filter is always every item in the period, so a chosen item can be changed. The table reuses that same request unless a filter narrows it. Choosing a brand grouping and one item shows how much of that item came from each brand.

## Also changed

Every tab was asking the server for its figures again each time the Reports page redrew, because the page passed it a fresh date-range object each time. The page now passes one object for as long as the dates are the same. (In development the browser still shows two requests because React runs effects twice there; production asks once.)

## Checks

- `npm run test:pharmacy-reports` (server, 11 groups, disposable schema, real router and signed tokens): types adding up; units kept apart; a record with no quantity; brands from batches including a dispensing from two brands; dispensed winning over a stale not-available flag; items typed by hand; every row of both reports equals the rows of its line list; who may open what; bad requests; workbooks and log rows; the registry per role. Two rules were broken on purpose to confirm the test notices.
- `npm run test:pharmacy-report` (client): what each clicked number asks for, what it is called, and how quantities are written.
- The tab was driven in a browser against sample server answers: both reports, grouping by brand, an item inside a brand, the type filter, opening lists, names, both exports, reception and clinician views, light and dark themes and a phone width.
- Not tried against real data or a real login.

## Not built

- Trends over time (by day, week or month), top prescribers, and charts.
- Dispensing time (how long from prescription to dispensing).
- Returns or reversals of a dispensing: the system has none to report.
