# Prescriber stock availability and brand preference

Stage 5 adds usable-stock information to the existing consultation drug search and an optional **Preferred brand** field after choosing an exact medicine. It does not reserve stock, change the clinical medicine or its catalogue price, or issue stock while prescribing.

## Availability

Search rows show availability for their exact catalogue SKU, so different strengths, forms and routes are not matched by generic name. Selecting a medicine shows the available quantity in the physical supply unit and offers its stocked products/brands. Bottle and mL quantities are kept separate. Counts use decimal strings and exact display arithmetic.

Availability excludes expired or quarantined batches and inactive products or price-list entries. The expiry date itself remains usable in Africa/Lusaka. A variant with products but no usable stock is distinguished from an untracked variant. No legacy counter is represented as verified ledger stock. An unavailable stock read is shown as unavailable information rather than zero stock; it does not block an otherwise valid clinical prescription.

Reads refresh when the selection/search changes, on window focus and every 30 seconds. Search requests are debounced. Late responses from an older request or selection cannot overwrite the latest result. Displayed figures are advisory; pharmacy rechecks stock at dispensing.

## Preference and pharmacy handoff

No preference is the default. Selecting a brand records its product ID on the Prescription, separate from Medication. The server requires that product to match the medication's exact catalogue code and physical supply unit. No reservation or stock operation is created. The preference does not change the medicine's name, dose, quantity, selling price or invoice source.

Changing the medicine or physical supply unit clears the form's preference; changing the course quantity preserves it. A preference can remain recorded if its stock is subsequently depleted or the product is deactivated. The form labels an unconfirmed retained preference accordingly. Product deletion is restricted once a prescription references it, preserving historical identity.

The saved preference is visible on the consultation prescription, in Pharmacy's queue and beside its dispensing allocation controls. It is advisory. Earliest-expiry selection remains the pharmacy default; staff can choose another eligible product/batch with the existing reasoned override. There is no new prescriber approval or patient confirmation step. Actual supplied products/batches remain recorded in immutable dispensing allocations, independently of the preference. Substitution retains the original order's preference without applying it to the replacement medicine.

## API and access

`GET /api/prescribing-stock/availability?refs=CODE1,CODE2` accepts up to 20 unique exact catalogue references. It returns:

```json
{
  "asOf": "ISO timestamp",
  "items": [{
    "catalogueRef": "CODE1",
    "tracked": true,
    "products": [{
      "id": "product-id",
      "brand": "Brand",
      "manufacturer": "Manufacturer or null",
      "baseUnit": "tablet",
      "available": "10.00"
    }]
  }]
}
```

Only positive usable product quantities are listed. An empty products list with `tracked: true` means no usable ledger stock; `tracked: false` means there is no stock product for that variant. Quantities are never summed across physical units.

Current database roles admin, clinician, doctor, pharmacist and nurse can read this limited endpoint. It returns no supplier costs, receipt sources, batch/expiry details, recipients or audit data. It does not grant access to pharmacy stock-management routes. Billing, reception and lab-only users remain denied.

The existing `POST /api/encounters/:encounterId/prescriptions` accepts optional `preferredStockProductId` along with `medicationId`. Ownership and preference validation and prescription creation run in one transaction. Existing billing still uses the ordinary prescription charge. Encounter-prescription and pharmacy queue reads return `preferredStockProduct` with ID, brand, manufacturer, physical unit and active state. The consultation draft retains a display label alongside the canonical ID for its saved note.

## Migration and verification

Apply `20261104050000_prescriber_stock` and generate the Prisma client. It adds a nullable Prescription field, index and restrictive foreign key to PharmacyProduct. Existing orders default to no preference. Never regenerate or overwrite applied migrations. Health reports `pharmacyStockStage: 5` when the updated service is running.

- Server: `npm run test:prescribing-stock`, plus the existing `test:stock`, `test:receiving`, `test:stock-views` and `test:stock-dispensing`.
- Client: `npm run test:prescribing-stock` and `npm run build`.

Database checks use disposable schemas. They cover migration over existing prescriptions, exact variant/unit eligibility, expiry and active-state rules, minimal response fields, no reservation, unchanged pricing, persisted/reloaded preference, actual pharmacy allocation distinct from preference, and current-role HTTP authorization. Client checks cover the actual form's preference selection/payload, exact quantity summaries, selection/unit changes, depletion/read failures and preservation of pharmacy's separate controls.

Stage 6 adjustments/counts are documented in [pharmacy-stock-stage6.md](pharmacy-stock-stage6.md). Stage 7 automatic availability/billing integration remains outside this delivery.
