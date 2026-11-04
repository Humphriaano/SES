# Pharmacy stock views

The later dispensing integration is described in [Stock-ledger dispensing](pharmacy-stock-stage4.md). This file records the Stage 3 delivery and its original boundary.

Stage 3 adds **Pharmacy → Stock** for users whose current database roles include admin or pharmacist. The three views are stock on hand, a product stock card and batches ordered by expiry. They are read-only and do not create ledger entries, charges or audit events. The receiving and patient workflows remain available in their existing tabs.

## Quantities and availability

All quantities come from the batch movement ledger. A clinical catalogue item can have several brands, manufacturers and stock units. Stock on hand groups by catalogue item **and base unit**; bottles, tablets, sachets and mL are never added into one quantity. Expanding a row shows its products and opens their stock cards. Exact decimal strings are retained through the API and display.

Physical stock is divided into mutually exclusive categories, in this precedence:

1. Expired: expiry date is before the facility's current date, including expired quarantined batches.
2. Quarantined: non-expired stock in a quarantined batch.
3. Inactive: remaining stock whose product or clinical price-list entry is inactive.
4. Available: remaining usable stock.

The expiry date itself remains usable. Facility calendar days use Africa/Lusaka. Physical equals available plus expired plus quarantined plus inactive. A tracked product without movements displays zero; a catalogue item with no stock product displays **Untracked** and unknown quantities. The older balances endpoint uses the same availability rule, while its diagnostic expired/quarantined fields retain their earlier semantics.

## Stock cards

A card can cover a product or one of its batches, with date and movement filters. It includes opening counts, receipts, issues and signed loss/adjustment/reversal entries, with reference, batch, expiry, recorded source/recipient and authenticated handler. Recipient names appear only where a dispensing allocation actually records that link; older unlinked issues do not get invented recipients. No patient identifiers or clinical chart data are returned.

Movement order follows the new unique `postingOrder` sequence, rather than transaction-start timestamps or random IDs. Running balances are calculated across the complete selected product/batch ledger **before** date, movement-type and page filters. Consequently, a filtered row's balance includes hidden movements. Opening balance is all movements before the selected From day; closing balance is all movements through the To day; current physical includes all posted movements. Without date filters, opening is zero and closing equals current physical. Full calendar days use Lusaka boundaries converted explicitly to the UTC timestamps stored by Prisma.

## Batches by expiry

The default shows positive remaining physical stock in expiry order, including expired, quarantined and inactive batches. Filters support status, item/brand/batch search, optional expiry window and inclusion of zero-stock batches. A chosen expiry window covers today through the selected number of days; expired batches are outside that window. There is no assumed facility warning threshold. Each batch opens its own stock card.

## Read APIs

All paths are under `/api/pharmacy-stock`, with current-role authentication. Lists accept `page` (default 1) and `pageSize` (default 20, maximum 100). Search treats wildcard characters literally. Counts and rows share a repeatable-read transaction.

| GET endpoint | Filters |
| --- | --- |
| `/on-hand` | `q`, `tracking=TRACKED\|UNTRACKED\|ALL`, `level=ALL\|AVAILABLE\|UNAVAILABLE\|OUT_OF_STOCK` |
| `/product-stock` | `q`, exact `catalogueRef`, `baseUnit` |
| `/expiry-batches` | `q`, `state=ALL\|USABLE\|EXPIRED\|QUARANTINED\|INACTIVE`, `includeZero=true\|false`, optional `expiresWithin` (1–3650 days) |
| `/products/:id/card` | optional owned `batchId`, `from`, `to` (ISO calendar dates), `type=ALL\|RECEIVED\|ISSUED\|LOSS\|ADJUSTMENT\|REVERSAL` |

Apply `20261104030000_stock_views` and generate the Prisma client. The additive migration introduces `StockMovement.postingOrder` and indexes; existing movement values are preserved. Do not regenerate applied migrations. Stock JSON snapshots serialize the new BigInt as a string, including nested movements in receiving responses.

## Verification

- Server: `npm run test:stock-views`, `npm run test:stock`, `npm run test:receiving`. These use disposable PostgreSQL schemas and clean them up.
- Client: `npm run test:stock-views`, `npm run test:stock-receiving`, `npm run build`.

Current live dispensing still uses the legacy inventory counter. Connecting dispensing and substitution to batch allocation and earliest-expiry selection is **Stage 4**, not part of these views. No stock import, selling-price override, transfer, new loss/count workflow or automatic billing change is included here.
