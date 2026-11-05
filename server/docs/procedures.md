# Procedures on the consultation note

The **Proc** block on the consultation canvas now has a searchable, billable list of procedures (cannulation, suturing, catheterisation and so on). The block's free-text note stays exactly as it was, below the list, so notes written before this change are untouched.

## What a doctor sees

- Common procedures as one-tap chips, and a search box that understands everyday words (`cannulation`, `cannula`, `drip`, `iv access`, `stitches`, `foley`, `plaster`).
- Pick one, add the site or side and a short note if wanted, then **Record procedure**. The procedure is added to the note and its charge is created in the same step.
- The price comes from the price list and shows beside the name. A missing price can be typed in right there, as for investigations.
- **Another procedure**: anything not on the list can be recorded by name. It has no charge; the billing desk adds one by hand if needed.
- **Remove** takes a procedure back. The person who recorded it (or an admin) can do this while its charge is still on an open invoice with no payments. After that the billing desk voids the charge, with a reason and an audit entry, as for any charge. A block that still holds recorded procedures cannot be deleted; they are removed one by one.
- Later visits and imported encounters show the recorded procedures as lines above the note, and decision support reads them as part of the note.

## The list

`client/src/data/proceduresCatalogue.json` holds 62 starter procedures in nine groups, each with the alternative names used for searching. The same procedures are in `server/data/builtin-price-items.json` as unpriced `PROCEDURE` price-list items, which the server loads at start-up without touching any existing item. References use the same scheme as a procedure an admin adds by hand on the price list (`procedure_<name>`), so a price already entered for, say, "Peripheral IV cannulation" is kept. Procedures an admin adds to the price list appear in the picker too.

**This is a starter list for clinical review**, written for this app, not copied from a classification. Add, rename or switch off procedures from the price list screen; set prices there.

## API

`POST /api/encounters/:encounterId/procedures` `{ clientId, catalogueRef?, name?, site?, note? }` records a procedure and its charge. Repeating the same `clientId` returns the same record and never charges twice. A `catalogueRef` must be an active `PROCEDURE` price-list item (the price list's name is the one recorded); without one, `name` is required and no charge is made. Only an open encounter accepts procedures.

`DELETE /api/encounters/:encounterId/procedures/:id` takes it back, under the rules above. Both sit behind the clinical-role guard on `/encounters`.

## Data

One additive migration (`20261105010000_encounter_procedures`) adds the `EncounterProcedure` table. Charges are ordinary `ChargeLine` rows with `sourceType = PROCEDURE` and `sourceId` = the procedure's id. The price lookup used by the ordering screens now also answers for procedures.

## Verification

- `npm run test:procedures` (server, 10 groups, disposable schema): priced and unpriced list items, repeat and concurrent requests charging once, hand-typed procedures with no charge, bad input refused, who may remove one and when, the audit entry, and that loading the catalogue never overwrites an existing price.
- `npm run test:procedure-search` (client): the search words above, any-order matching, ranking, custom procedures, and the shipped list.
- The block was driven in a browser against sample server answers: search, record, a failed save and retry with the same entry id, removal, a hand-typed procedure, and the read-only view.

## Not built

- Recording while offline. A procedure needs the server to create its charge, so with no connection the screen says so and keeps the form for a retry.
- Quantity above one (for example several injections): record each, or set the quantity at the billing desk.
- Procedures carried into reports or the patient's procedure history beyond the encounter note.
- A standard classification (ICHI, ICD-10-PCS or SNOMED CT). These carry licence terms to confirm first.
