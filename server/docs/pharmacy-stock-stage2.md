# Stock receiving and opening counts

Stage 2 adds **Pharmacy → Receive stock**. Pharmacy is also available at `/pharmacy` without selecting a patient. Stock writes require the current database role to include admin or pharmacist. Clinical staff with pharmacy read access retain their existing queue/patient views; they do not gain receiving access.

## Receiving workflow

Choose Delivery or Opening stock count. The facility date defaults to today and can be changed. Enter the delivery/count reference and supplier/count location. Search an exact catalogue variant, choose an existing product or add its brand/manufacturer and pack structure, then enter the lot, full expiry date, number of packs and optional cost per pack. A conversion preview shows the base stock quantity before posting. Saved products are ordered by receiving frequency; existing lots reuse their saved expiry.

Post once. New product identities, batches, receipt lines, converted stock movements and audit events are committed together. The receiver always comes from the authenticated user. Missing selling prices do not block receiving. Cost per pack does not update the selling price.

Opening counts are ledger entries based on a physical count, not imports of the legacy inventory counter. A batch with unreversed posted stock cannot receive another opening entry. Correcting a fully reversed opening receipt permits a replacement count. Existing dispensing and the old counter are not connected to the new ledger until the later dispensing stage.

## Safe retry and corrections

The browser retains the draft and any unresolved POST under a user-specific local-storage key. It keeps the original operation key and request body if a response is lost, including across reloads. Inputs remain locked until the request is resolved, preventing an ambiguous receipt from becoming a second entry. Validation failures allow the draft to be corrected. Browser storage must be available before a stock write is sent.

Recent receipts show source, receiver, products, packs, batches, expiry and converted quantities. **Correct receipt** requires a reason and posts reversing movements; it never edits the original receipt. A correction fails atomically when the required stock is no longer available. This correction workflow is separate from losses, write-offs, stock-count adjustments or patient returns, whose policies remain for later stages.

## Missing clinical catalogue items

The receiving search checks names and ingredient matches before offering a missing-item form. New entries require a generic name, form, route and 1–10 structured active ingredients, each with name, positive amount and unit. Combined strength is derived from those ingredients. ATC is optional; no global terminology code is invented or automatically verified.

New entries are immediately active, have an unpriced standard DRUG price-list row, and are marked pending review. Administration's existing catalogue shows ingredients and the review label. Administrators can mark an item reviewed; pharmacists cannot clear that flag. Editing structured ingredients updates strength and returns the entry to pending review, with an audit event. Existing non-structured catalogue entry and editing remain supported.

## APIs

All endpoints are under `/api/pharmacy-stock` and share current-role authentication plus durable, payload-checked `Idempotency-Key` handling.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/receipts` | Atomic delivery/opening entry, including new products and batches when needed. |
| GET | `/receipts` | Latest 20 receipts with line details, status and receiver. |
| POST | `/receipts/:id/reverse` | Correct a receipt with a required reason. |
| POST | `/catalogue-drugs` | Add an immediately usable, pending-review clinical catalogue entry with structured ingredients. |

`POST /receipts` accepts `kind` (`DELIVERY` or `OPENING`), `receivedDate`, `reference`, `source` and up to 50 lines. Each line contains either `productId` or `newProduct`, plus `lotNumber`, `expiryDate`, `packCount` and optional `costPerPack`. `newProduct` has the same fields as the Stage 1 product API. A lot that already exists for the product must retain its saved expiry. Decimal pack conversions are exact to two places; precision loss is rejected.

Apply migration `20261104020000_stock_receiving` with the normal Prisma deployment workflow and generate the client. It adds `StockReceipt.kind` and optional structured ingredients plus a pending-review flag on CatalogueDrug. Existing rows keep their previous field values; legacy catalogue entries are not newly labelled pending, and old receipts default to Delivery.

## Verification commands

- Server: `npm run test:stock` and `npm run test:receiving`. Both use disposable schemas and clean them up. `STOCK_TEST_DATABASE_URL` can override the configured database.
- Client: `npm run test:stock-receiving` and `npm run build`.

No supplier management, transfers, product selling-price override, automatic charge voiding, stock-driven dispensing or forecasting is included. Stock-on-hand, stock-card and expiry views are the next stage.
