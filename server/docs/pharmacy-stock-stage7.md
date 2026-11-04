# Verified stock availability and prescription billing

Stage 7 connects the existing prescription availability operation to the verified stock ledger. The owner chose these rules on 4 November 2026:

- Automatically remove a **new** prescription's charge only when its exact tracked medicine and physical supply unit have **zero usable stock**.
- Partial stock remains for pharmacist review. It does not automatically remove a charge or restore a previously unavailable course.
- Existing prescriptions change only through individual pharmacy review. Receipts, dispensing, adjustments, expiry and stock reads never mass-update existing invoices.
- Untracked medicines keep the existing manual availability workflow. Missing catalogue codes, mismatched/missing physical units or unknown quantities are not guessed into an automatic financial decision.

## New prescriptions

The clinical prescription is saved first. Its existing once-per-source charge then runs under the prescription and patient-invoice locks. Price and invoice quantity still come from the existing catalogue/snapshot/course logic. The stock check uses physical supply quantity and unit, so one billed course is not treated as one tablet or bottle.

When verified usable stock is zero, the same transaction sets `Prescription.notAvailable`, voids only that prescription's charge with the existing reason **Not available at the pharmacy**, records the audit and recalculates the invoice using the existing paid/credit rules. The original charge, price and quantity remain on record. The response waits for this billing attempt and reloads the prescription, so a successful automatic check is reflected in its returned availability flag.

An existing charge is a no-op for delayed billing retries; stock changes cannot make such retries change old invoices. A manual unavailable decision made before delayed charge creation is also honoured. Charge creation and manual availability now acquire locks in the same prescription → patient-invoice order, closing the earlier race in which an unavailable prescription could receive a new active charge.

Billing failure remains separate from the saved clinical prescription: the billing transaction rolls back and logs its failure; the prescription still saves. As before, billing staff must resolve a charge that could not be created. No reservation or stock deduction occurs at prescribing or availability review.

## Individual pharmacy review

In **Pharmacy → Queue**, **Check stock** checks one prescription. The existing **Not here / In stock** controls remain for staff decisions and untracked stock. The queue displays exact catalogue/unit balances separately; a missing or unmatched supply unit is labelled unverified, rather than displayed as verified zero. Different bottle/mL quantities for one SKU cannot overwrite one another in the queue cache.

| Verified result | Individual review outcome |
| --- | --- |
| Zero usable stock | Mark unavailable and remove its active prescription charge |
| Enough usable stock for the known course | Mark available; restore a line only if its void reason was the pharmacy unavailability reason |
| Positive stock below the physical course quantity | Leave availability and charge unchanged for pharmacist review |
| Untracked / unknown unit / unknown positive-stock course quantity | Leave availability and charge unchanged |
| Already dispensed | Reject the review; supplied medicine cannot be unbilled by a later stock check |

Expired, quarantined and inactive stock is excluded using the same stock candidates as dispensing. The expiry date itself remains usable in Africa/Lusaka. Bottle and mL quantities are never converted implicitly. Brand preference does not restrict the exact medicine's total usable supply.

Availability reuses the original unique `PRESCRIPTION` source. Restoring a charge preserves its captured price and quantity, even if the price list has since changed. Payments, receipts, discounts and unrelated services are retained. Existing invoice recalculation reconciles surplus patient credit. An unrelated void reason is never restored; automatic/review changes leave charge lines on void or waived invoices untouched. The availability flag can still describe the medicine's stock while the invoice decision remains protected. Manual availability retains its prior API and behaviour.

Substitution continues to replace/reprice the original source in the existing atomic dispensing transaction. A stocked substitute can replace an unavailable original without creating a second charge. Last-batch dispensing does not remove the supplied medicine's charge or silently alter another waiting prescription.

## API, transactions and retries

`POST /api/pharmacy-stock/prescription-availability`

Body: `{ "prescriptionId": "..." }`. A stable `Idempotency-Key` is required. The route and service require a current active admin or pharmacist; clinician-only, nurse-only, billing and lab users cannot invoke this stock-management write. Actor, stock quantities and availability cannot be supplied by the caller.

The durable StockOperation kind is `CHECK_PRESCRIPTION_STOCK`. Its retained response contains `id`, `tracked`, `state`, `baseUnit`, `available`, `required`, `notAvailable` and `billingChange`. States are AVAILABLE/PARTIAL/UNAVAILABLE/UNTRACKED/UNKNOWN/REVIEW; billing changes are VOIDED/RESTORED/UNCHANGED/PROTECTED. Same-key/same-intent retries return the original result across processes, without reapplying credit or audit. Changed intent conflicts. A new individual check uses a new operation key and current stock.

The review locks the prescription, patient invoice namespace, catalogue and eligible batches, then uses the existing invoice edit lock. Availability, charge, credit reconciliation, audit and retained response succeed or roll back together. Actual dispensing still rechecks stock and allocates batches atomically; a review is advisory and does not reserve it.

The browser retains one pending review per user before sending it. A lost response locks further queue actions and exposes **Retry stock review**, including after reload. It sends the same original body/key. Corrupt pending storage blocks new requests instead of replacing the uncertain action. Stock and queue GETs remain read-only. There is no polling job, migration backfill or open-invoice rewrite.

## Verification and deployment

No new database migration, generated client or dependency is needed. Existing applied migrations remain unchanged. `/health` reports `pharmacyStockStage: 7` in the running API.

- Server: `npm run test:stock-availability` — 20 PostgreSQL groups, all writes confined to a disposable schema.
- Earlier stage commands: `test:stock`, `test:receiving`, `test:stock-views`, `test:stock-dispensing`, `test:prescribing-stock`, `test:stock-adjustments`.
- Client: `npm run test:stock-availability`, previous stock client suites and `npm run build`.

Checks cover exact variant/unit transition, zero/partial/unknown stock, course versus physical quantities, expiry day, paid credit and original snapshots, unrelated voids, void/waived invoices, no mass updates, durable HTTP/new-process replay, changed intent, current roles and revocation, audit rollback, clinical-save survival, manual/billing races, review/last-stock dispensing races, substitution and read-only GETs. The prior prescribing test now explicitly expects the one new availability audit while still asserting no reservation, movement or price change.

Stage 8 stock reports and Excel exports remain outside this delivery. Brand pricing, insurance, transfers, returns and dispensing reversal/correction are not added.
