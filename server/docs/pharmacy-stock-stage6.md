# Stock losses, expiry write-offs and physical counts

Stage 6 adds **Pharmacy → Adjust stock**. The facility policy is: a pharmacist prepares the request and a different administrator approves every stock change. There is no quantity or value threshold that bypasses approval. Administrators retain their existing pharmacy-management permissions to prepare a request, but cannot review their own request; another active administrator is required. Current database roles are checked on every HTTP request and again when writing. Billing, reception, clinician-only and lab-only users cannot access stock management.

## Workflow

1. Choose **Physical count**, **Loss or damage**, or **Expiry write-off**.
2. Enter a reference and choose a reason. Notes are optional unless the reason is Other.
3. Find medicine batches and add up to 50. The screen shows each batch's actual stock unit and recorded physical quantity. Enter a count, or the quantity lost/written off. The signed difference is calculated.
4. **Submit for review** creates a pending request without changing the stock ledger.
5. A different administrator opens **Requests**, inspects the original balance, count, difference and current balance, then chooses **Approve & post** or **Reject**. Rejection requires a note. Approval notes are optional.

Only approval posts movements. Both people, timestamps, reference, reason, original balance, count/difference and outcome remain in the immutable request history. The preparer or an administrator can cancel a pending request; another pharmacist cannot. Posted, rejected and cancelled requests cannot be edited or deleted. Correct a posted count with a new independently approved count/correction, not by rewriting or reversing its history.

Physical counts may increase, decrease or confirm stock. A zero physical count is valid. A count identical to the recorded balance is retained as a reviewed count without creating a zero movement. Losses and write-offs must be positive quantities no greater than physical stock. Expiry write-offs are allowed only after the expiry date's final day in Africa/Lusaka. The expiry date itself remains usable. Physical counts include zero, inactive, quarantined and expired batches so their quantities can still be reconciled.

Quantities use exact two-decimal strings and explicit physical units. Enter whole bottle counts or losses; mL-tracked stock accepts decimal volume. A historical fractional bottle balance can be corrected by entering a whole-bottle physical count. No bottle-to-mL conversion is inferred. Pack purchasing conversions remain in receiving.

## Stock changes while awaiting review

Every line retains both its recorded quantity and latest ledger posting order. Submission and approval lock batches in stable order and recheck both. A dispense or receipt invalidates the pending snapshot, including an issue followed by a reversal that returns stock to the same numerical balance. The administrator must cancel or reject the stale request; pharmacy must recount and submit a fresh request. The system never silently rebases an old physical count onto a changed balance.

The screen highlights stale pending requests and disables approval. The server enforces the same rule if a change occurs after the screen's read. **Refresh balances** in an unsubmitted draft clears entered quantities whenever the balance, posting order or unit changes, requiring a fresh count.

## API and recovery

The existing `/api/pharmacy-stock` router requires current admin/pharmacist access:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/adjustment-batches` | Paged batch balances and posting tokens; `kind`, `q`, `page`, `pageSize`, or up to 50 comma-separated `ids` |
| GET | `/adjustments` | Paged request history; `status` defaults to PENDING, or POSTED/REJECTED/CANCELLED/ALL |
| GET | `/adjustments/:id` | Retained request, actors, line deltas and current/stale quantities |
| POST | `/adjustments` | Submit a request with kind, reference, reasonCode, optional reason and lines |
| POST | `/adjustments/:id/approve` | Independent active administrator posts stock |
| POST | `/adjustments/:id/reject` | Independent active administrator rejects with reviewNote |
| POST | `/adjustments/:id/cancel` | Preparer or administrator cancels pending request |

Submission lines contain `batchId`, `baseUnit`, `expectedQuantity`, `expectedPostingOrder` and either `countedQuantity` (COUNT) or `quantity` (LOSS/WRITE_OFF). Review bodies contain only optional `reviewNote` (required to reject). Actor, approver and status are derived on the server; forged fields are rejected.

Every POST requires a stable `Idempotency-Key`. The durable StockOperation records exact intent and the retained response. Replaying the same key/body returns the original result across processes; changing intent under a key returns a conflict. A second new-key approval cannot post an already reviewed request. The client stores per-user drafts and pending key/body before sending. If the outcome is uncertain, new writes are locked and **Retry original request** remains available after reload. Keep browser data until that request is resolved. Corrupt pending storage blocks new writes rather than inventing a replacement operation.

Transactions include header state, movements, line links, operation response and audit event. All succeed or roll back together. SQL triggers enforce independent approval, immutable payload/history, exact movements and complete approved requests. The stock writer explicitly sets deferred constraints to IMMEDIATE after recording the operation response for the four adjustment operation kinds, so a failed completeness check is surfaced inside the transaction rather than relying only on the driver's commit error handling.

## Migration and verification

`20261104060000_stock_adjustments` adds StockAdjustment and StockAdjustmentLine, foreign keys, constraints and enforcement triggers. It adds no physical columns to old tables. It is applied locally. **Never regenerate or overwrite an applied migration.** The local upgrade verified identical values and row counts for every old column across all 48 existing application tables. The generated Prisma client includes the new models. `/health` reports `pharmacyStockStage: 6` when this service is running.

- Server: `npm run test:stock-adjustments` — 17 PostgreSQL check groups in disposable schemas.
- Earlier stages: `npm run test:stock`, `npm run test:receiving`, `npm run test:stock-views`, `npm run test:stock-dispensing`, `npm run test:prescribing-stock`.
- Client: `npm run test:stock-adjustments` and `npm run build`.

Coverage includes populated upgrades, historical loss preservation, roles and revocation, self-approval denial, real actors, positive/negative/zero counts, expiry-day rules, whole bottles/mL, immutable records, incomplete/unapproved posting denial, cancellation/rejection, lost-response/new-process replay, changed intent, two-reviewer races, dispensing-versus-count races, stale snapshots with unchanged totals, and full rollback on audit failure. Tests do not change real clinical, financial or stock records.

Stage 2 receipt corrections remain available under their existing rules. This stage does not add patient returns, transfers, dispensing reversal/correction, automatic invoice voiding or price changes. Stage 7 automatic availability/billing integration and Stage 8 reports/Excel remain separate stages.

Stage 7 is now documented in [pharmacy-stock-stage7.md](pharmacy-stock-stage7.md).
