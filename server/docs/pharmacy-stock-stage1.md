# Pharmacy stock foundation

Stage 2 receiving is now described in [Stock receiving and opening counts](pharmacy-stock-stage2.md). This file records the Stage 1 foundation and its original boundary.

Stage 1 adds products, batches, durable stock operations, receipt records, immutable movements and future dispensing allocation records. Existing `DrugInventory`, prescribing, dispensing, invoices, prices, payments and UI are unchanged. No stock is imported from the old counters, and the new stock tables start empty.

## Setup and verification

Use the existing server dependencies. Generate the Prisma client with `npm run db:generate`, then apply the additive migration with `npm run db:deploy`. On Windows a running API can lock the unchanged Prisma engine DLL; generate with the API stopped if necessary. Restart the API after generating the client.

Run `npm run test:stock` from the server directory. It uses `STOCK_TEST_DATABASE_URL` when supplied, otherwise the server `.env` database. The database role needs permission to create disposable schemas. The test creates two uniquely named `ses_stock_test_*` schemas, migrates an empty schema and an existing-data fixture, and removes only those schemas in cleanup. It never seeds or modifies existing application rows. It also runs the actual HTTP router on a temporary loopback port and verifies a receipt replay in a fresh Node process.

## Foundation APIs

All routes are under `/api/pharmacy-stock`, authenticate the staff user against current database roles, and require `admin` or `pharmacist`. No client navigation entry is added in Stage 1.

| Method | Route | Input |
| --- | --- | --- |
| GET | `/products?catalogueRef=CODE` | Exact clinical variant code; at most 100 products returned. |
| POST | `/products` | `catalogueRef`, `brand`, optional `manufacturer`, `baseUnit`, `packSize`, `packLabel`. |
| GET | `/batches?productId=ID` | Product ID; at most 100 batches returned, ordered by expiry. |
| POST | `/batches` | `productId`, `lotNumber`, full ISO `expiryDate`, optional `status` (`USABLE` or `QUARANTINED`). Creates batch identity only, with zero stock. |
| GET | `/balances?catalogueRef=CODE` | Derived product balances and a `tracked` marker; unknown/untracked differs from tracked with zero quantity. |

Every POST requires a stable `Idempotency-Key` of 8–128 letters, digits or `. _ : -`. Keep the same key for retries of the same operation. The database stores the caller, operation kind, normalized payload hash and response. A retry returns the original response with `Idempotent-Replay: true`; a changed payload with the same key returns 409, even after restart. This namespace bypasses the older in-memory response cache so its durable payload validation always runs. A new key is a new operation, not a retry.

Product references must resolve to an active built-in SKU or custom drug code and an active DRUG price-list row. An unset selling price is accepted. The composite price-list reference anchors identity without copying clinical definitions or selling prices into stock records. No product price override exists in this stage.

## Ledger services

`src/lib/stock.ts` provides `postStockReceipt`, `postStockIssue` and `reverseStockMovement` for subsequent workflow integration. They are intentionally not exposed as receipt/issue/adjustment HTTP routes in Stage 1.

- Receipt lines snapshot entered pack count, product pack size/label, converted base quantity and optional cost per pack. Conversions must be exact to two decimal places; excessive precision is rejected, never rounded silently.
- Issues specify an exact catalogue variant, physical base unit and batch allocations. Batch locks are acquired in sorted order before stock checks and movement creation. Insufficient, inactive, quarantined, expired or mismatched stock fails the complete operation.
- Reversals append the exact opposite quantity with a required reason and a unique reference to the source movement. They cannot overdraw stock, repeat, reverse another reversal or independently reverse an allocation tied to dispensing. They are corrections, not a patient-return workflow.
- All writes and their audit events occur in one transaction. Audit failure rolls the operation back. Read balances sum ledger quantities rather than reading a mutable counter.
- SQL constraints/triggers enforce movement signs, source and unit consistency, receipt conversion consistency, valid reversals and nonnegative batch balances. Posted receipts, receipt lines, ledger movements and dispensing allocations reject UPDATE and DELETE.

Physical quantities and invoice quantities remain separate. `course` is never a stock unit. Bottles, sachets, tablets and mL are explicit physical units, independent of their selling price. Balances are returned as decimal strings to preserve precision.

Dates are full calendar dates evaluated in Africa/Lusaka. The recorded expiry date is treated as the final usable day: it is excluded once earlier than the facility's current date. Month-only labels, opened/reconstituted expiry rules and near-expiry warning policy still need agreement before the dispensing stage is released. Expired and quarantined quantities remain in physical balance, while available excludes them and inactive products. Expired/quarantined subtotals can overlap; they are diagnostic categories, not additive parts of the physical total.

## Next stages

Receiving UI and verified opening stock, stock views, atomic integration with current dispensing and first-expiry selection, prescriber brand availability, approved adjustments/counts, availability/billing integration, then reports and Excel exports. Approval thresholds, patient returns, legacy opening stock mapping and automatic charge availability rules remain decisions for those stages. Brand pricing, transfers, purchasing, scanning and forecasting are outside this build.
