# Pharmacy stock reorder suggestions (Stage 9)

Stage 9 adds a fifth read-only report, **Pharmacy → Stock reports → Reorder suggestions**, for admin and pharmacist users. It compares how fast each medicine is dispensed with the stock that can still be used, and says what to reorder. It uses the same `Report` shape, Excel export and print as the stage 8 reports. Nothing here writes to the ledger, creates charges or changes billing, and no migration or dependency is added.

`GET /api/pharmacy-stock/reports/reorder` returns JSON; add `format=xlsx` for the workbook. It sits behind the existing stock router guard (`admin`, `pharmacist`).

## How a row is worked out

| Column | Meaning |
| --- | --- |
| Item, Unit | One row per catalogue item and base unit. Brands of the same item and unit are added together, because they substitute for each other when ordering. Inactive products are left out. |
| Usable now | Stock that is in date, not quarantined and on an active product (the same figure as the stock views and prescribing availability). |
| Used, last N days | Dispensed quantity from the ledger: issues, less any issue that was reversed. Losses, expiry write-offs, counts and corrections are **not** use. |
| Used per day | Use divided by the days actually observed. A medicine first received last week is measured over that week, not the whole window, so a new product is not understated. |
| Days of stock left | Usable now divided by used per day. Blank when nothing was used. |
| Expires within N days | Usable stock that expires within delivery time plus cover days, so the pharmacist can see how much of the stock may go out of date before it is used. Information only; it does not reduce "Usable now". |
| Suggested order | Only for Out of stock and Reorder now: `ceil(used per day x (delivery + cover days) - usable now)`, in base units, never below zero. |
| Status | **Out of stock** (used in the window, nothing usable); **Reorder now** (days left is no more than the delivery time, so it would run out before a new order arrived); **OK**; **No recent use** (nothing dispensed in the window). |

## Settings

Three settings are chosen on the screen, with these defaults, and are repeated in the report heading and the Excel file so a printed report is self-explanatory.

| Setting | Query | Default | Range |
| --- | --- | --- | --- |
| Use measured over | `days` | 90 | 7 to 365 |
| Delivery takes | `lead` | 14 | 0 to 120 |
| Order enough for | `cover` | 30 | 1 to 365 |
| Show | `status` | all (screen starts on "Needs action") | `ALL`, `ACTION` (out or reorder), `OUT`, `REORDER`, `OK`, `NO_USE` |
| Search | `q` | none | item name or detail; wildcards are literal |

Invalid values return 400 rather than being guessed. Rows are ordered most urgent first: out of stock, then reorder now, then OK, then no recent use, each by days left and then by use.

## Rules the report follows

- **Units are never mixed.** Rows are per base unit and there is no grand total.
- **Dates are Lusaka days.** The window ends today and counts back N days, converted to UTC clock boundaries the same way the stock card and stage 8 reports do.
- **One source of numbers.** Usable stock reuses the stock views' `batchTotals()` query.
- **No patient data.** Only item names and quantities appear.

## Verification

- Server: `npm run test:stock-reports` now has 25 groups (10 new, on a disposable schema): use counted from issues, a reversed issue and a loss not counted, brands combined, a new product measured over its own history, the suggested order arithmetic, the window changing the rate, status ordering and filters, search, invalid input rejected, the Excel file, billing role refused, and no ledger writes. The ledger's immutability guard is switched off only inside the test schema, to move receipt dates back.
- Client: type-check clean, and the tab was rendered in a browser against sample data.

`/health` now reports `pharmacyStockStage: 9`.

## Not built (by design)

- **Stock value at cost.** Needs a cost price at receiving, which the ledger does not hold today.
- **Minimum stock level per item.** An open question in the approach notes (section 11); the reorder report works from actual use instead. The in-app alerts strip below covers low stock; a scheduled email digest is not built.
- **Rounding the order to whole packs, and per-supplier ordering.** The suggestion is in base units.
- **Seasonal patterns, and multi-store transfers.**
- **A safety stock on top of delivery time.** The default is delivery time only; increase "Delivery takes" to build in a margin.

## Alerts strip (stage 9 addition)

A slim strip at the top of **Pharmacy**, shown to admin and pharmacist users on every tab, says what needs doing now and links to the matching report:

- medicines **out of stock** or **to reorder** (the reorder report's "Needs action" rows, default settings);
- usable batches **expiring within 90 days**;
- **expired batches that still hold stock**.

`GET /api/pharmacy-stock/alerts` returns the counts and the top few items (same guard as the reports; billing gets 403). It calls the reorder and expiry calculations directly, so its counts equal the report rows; a test checks this. It is read-only.

- Nothing shows when nothing needs attention, or if the call fails (the strip is informational; the reports remain the record).
- It loads when the page opens and when the window regains focus (at most every 30 seconds), not on a timer, to spare batteries and weak networks.
- The 90 day expiry window is a default; the approach notes left the near-expiry window as an open question.
- A scheduled email or SMS digest was not built: it needs recipients chosen and an outbound service switched on, which is a decision for the owner.

`npm run test:stock-reports` now has 27 groups.
