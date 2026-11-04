# Stock-ledger dispensing

Prescriber availability and preference are described in [Stage 5](pharmacy-stock-stage5.md). This file records the Stage 4 integration and its original boundary.

Stage 4 connects the existing pharmacy dispensing actions to batch stock. It applies to normal, edited, direct and substitute dispensing. Users still need a current database role of admin or pharmacist. There is no new print or collection step.

## Tracked versus legacy stock

A catalogue variant is tracked when it has any `PharmacyProduct`, including an inactive or zero-stock product. Tracked dispensing uses the exact catalogue code, physical supply quantity and stock unit. It never falls back to the old name-based counter when stock is zero, mismatched, inactive, quarantined or expired. Receive a delivery or verified opening count before supplying a newly tracked item. Stock from different units is never combined, and no conversion between bottles and mL is inferred.

Items without stock products, and legacy/free-text medicines without catalogue codes, retain their previous inventory workflow during transition. The old inventory is not imported. For tracked items, the legacy counter is **not** also decremented. Product creation, receiving and dispensing coordinate the switch with a catalogue lock.

## Batch selection

The default uses the earliest-expiring usable stock, with batch ID as a stable tie-breaker. It can draw from several batches or brands of the same exact clinical variant and physical unit. The form shows the suggested brand, batch, expiry, available quantity and quantity to supply without requiring an additional confirmation click.

The pharmacist can restrict the supply to a brand/product or enter batch quantities. A choice that differs from the default earliest-expiry allocation requires a reason. That reason is recorded on the immutable issue movements and audit. This override changes eligible batch selection; it cannot permit expired, quarantined or inactive stock. The expiry date remains the final usable day in Africa/Lusaka.

All allocations must total the canonical physical supply quantity, not the invoice quantity. Whole bottles remain whole bottles; mL can be decimal. A K35 per-bottle price is multiplied by supplied bottles, while a per-course price is charged once even when several physical items are supplied. The existing course and supply calculations remain authoritative on the server. A same-item brand choice retains the original clinical medication; a drug substitution retains the original order and records its substitute as before.

## Atomic posting and concurrency

The server recalculates stock at submit time. An item-level lock and sorted batch locks serialize competing requests, including different patients and pharmacists. The existing prescription and invoice locks remain in use. Creating the dispensing, changing the medication/prescription and its existing charge, issuing stock, linking allocations, writing audit records and saving the durable response happen in one transaction. A shortage or any failure rolls all of it back.

Allocations link the supplied product/batch to an immutable negative `ISSUED` movement. The original prescription charge remains the billing source for substitution, preserving payments and credit reconciliation. A shortage does not automatically mark the drug unavailable or void a charge. Brand-specific selling prices, patient returns and dispensing corrections are outside this stage.

The recorded dispenser comes from the authenticated user's database name. The client `dispensedBy` value is accepted for compatibility but is not trusted as the handler identity. Dispensing/history responses include `stockAllocations`, with batch, product brand/manufacturer, physical quantity/unit and override reason. Existing stock cards can now display the recipient linked through those allocations.

## API and retry contract

`GET /api/pharmacy-stock/dispense-plan` accepts exact `catalogueRef`, physical `baseUnit`, positive `quantity` and optional `productId`. It returns tracked status, available quantity, sufficiency, eligible batches, suggested allocation and the unrestricted default suggestion. This read does not reserve stock. It requires admin/pharmacist access; prescriber availability remains Stage 5.

`POST /api/dispensing` and `POST /api/prescriptions/:id/dispense` now require a stable `Idempotency-Key`. Their existing payloads remain supported, with optional:

```json
{
  "stock": {
    "productId": "optional-product-id",
    "allocations": [{ "batchId": "batch-id", "quantity": "9.00" }],
    "overrideReason": "Reason when allocation differs from earliest expiry"
  }
}
```

Omit `stock` or send `{}` for automatic selection. When allocations are omitted, a supplied product ID restricts automatic selection to that product. Explicit allocations must be distinct, eligible and total the full supply quantity. An expired batch is never selectable.

The `StockOperation` table retains the actor, key, request hash and result for **all** dispensing, including untracked direct dispensing. A repeated key and identical payload returns the original result with `Idempotent-Replay: true`; changed payload returns 409. A new key cannot dispense an already dispensed prescription again. The older memory cache bypasses these endpoints so it cannot mask a changed-payload conflict. A direct dispense is a new operation when it has a new key, so clients must preserve keys during uncertain retries.

The staff client saves the exact pending body/key under a per-user browser-storage key before sending it. Unknown/network/5xx outcomes retain the pending request, including across reloads, and block a new dispensing until resolved. Retry is available inside the form and on Pharmacy. Definite validation rejections permit correction; operation-key conflicts stay pending. Storage failure prevents the write rather than permitting an unsafe retry. Returning the original result never prints a label automatically.

## Deployment and validation

No new schema migration or dependency is required. Stage 1–3 migrations must already be applied and the generated Prisma client must include those models. Do not regenerate or modify applied migrations. The health endpoint reports `pharmacyStockStage: 4` when the updated API is loaded.

- Server: `npm run test:stock-dispensing`, `npm run test:stock`, `npm run test:receiving`, `npm run test:stock-views`. Each uses disposable PostgreSQL schemas and cleans up its fixtures.
- Client: `npm run test:stock-dispensing`, `npm run test:stock-receiving`, `npm run test:stock-views`, `npm run build`.

The new database checks cover stock and invoice quantities, actual substitution, payments/credit, concurrent issues by different patients/staff, fresh-process replay, blocked stock, zero versus untracked, audit rollback and actual HTTP authorization/payload checks. Existing dispensing and billing regression checks also remain applicable.
