# Pharmacy stock reports (Stage 8)

Stage 8 adds four read-only reports under **Pharmacy → Stock reports**, for admin and pharmacist users, with Excel export and print. They use the same `Report` shape and Excel layout as the billing reports (SES header block, red rule, frozen header row, summary block), so a stock report looks like a billing report. Nothing here writes to the ledger, creates charges or changes billing.

## Reports

| Report | Rows | Filters |
| --- | --- | --- |
| Stock on hand | One per product and base unit: available, expired, quarantined, inactive, physical | `q`, `level=ALL\|AVAILABLE\|OUT_OF_STOCK\|HAS_EXPIRED` |
| Batches by expiry | Batches holding stock, soonest expiry first, days left (negative when expired) | `q`, `state=ALL\|USABLE\|EXPIRED\|QUARANTINED\|INACTIVE`, optional `within` (1–3650 days) |
| Stock movements | Every ledger line in the period: stock in, stock out, reference, reason, handler | `from`, `to`, `type=ALL\|RECEIVED\|ISSUED\|LOSS\|ADJUSTMENT\|REVERSAL`, `q` |
| Losses and adjustments | Each request line: change, reason, status, who prepared it and who reviewed it | `from`, `to`, `status=ALL\|PENDING\|POSTED\|REJECTED\|CANCELLED`, `q` |

`GET /api/pharmacy-stock/reports/:name` returns JSON; add `format=xlsx` for the workbook. Names: `on-hand`, `expiry`, `movements`, `adjustments`. Routes sit behind the existing stock router guard (`admin`, `pharmacist`); billing and other roles receive 403.

## Rules the reports follow

- **One source of numbers.** Stock on hand and expiry reuse the stock views' `batchTotals()` query, so a report row equals the matching Stock-tab row. Nothing is stored or typed in.
- **Units are never mixed.** Rows are per base unit and there is no grand total; summary cards count products or batches, not quantities.
- **Dates are Lusaka days.** `from` and `to` are calendar days (maximum one year), converted to UTC clock boundaries the same way the stock card does.
- **Wildcards are literal** in `q`; invalid filters return 400 rather than being guessed.
- **Patient data is not included.** Movements show the reference and handler, not patient names.
- Reports are capped at 20,000 rows per request; Excel and screen use the same query.

## Verification

- Server: `npm run test:stock-reports` (15 groups, disposable schema): units kept separate, expired excluded from available, expiry window, Lusaka period boundaries, loss shown as stock out, approved versus awaiting requests with reviewer names, bad input rejected, a real workbook parsed back, billing role refused, read-only (ledger counts unchanged).
- Client: `npm run build` (type-check). The earlier stock suites still pass.

No database migration or dependency is added. `/health` now reports `pharmacyStockStage: 8`.

## Not built (by design)

Stock value at cost, reorder suggestions and fast-moving analysis (Stage 10 in the approach notes), multi-store transfers, and low-stock alerts remain for a later conversation.
