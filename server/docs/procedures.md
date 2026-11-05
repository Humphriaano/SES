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

- `npm run test:procedures` (server, 19 groups, disposable schema): priced and unpriced list items, repeat and concurrent requests charging once, hand-typed procedures with no charge, bad input refused, who may remove one and when, the audit entry, and that loading the catalogue never overwrites an existing price.
- `npm run test:procedure-search` (client): the search words above, any-order matching, ranking, custom procedures, and the shipped list.
- The block was driven in a browser against sample server answers: search, record, a failed save and retry with the same entry id, removal, a hand-typed procedure, and the read-only view.

## Not built

- Recording while offline. A procedure needs the server to create its charge, so with no connection the screen says so and keeps the form for a retry.
- Quantity above one (for example several injections): record each, or set the quantity at the billing desk.
- Procedures carried into reports or the patient's procedure history beyond the encounter note.
- A standard classification (ICHI, ICD-10-PCS or SNOMED CT). These carry licence terms to confirm first.

## Sending a procedure to the treatment room

A doctor does not always do a procedure; often the patient is sent to the nurse in the treatment room. When the doctor picks a procedure there are two choices, remembered for next time:

- **I did it**: recorded and charged at once, as above.
- **Send to treatment room**: the doctor adds the site, instructions for the nurse and an urgent flag if needed. **Nothing is charged yet.** The note shows it as "Waiting in treatment room" with the price expected "when done".

### The nurse's screen (Treatment room)

A new **Treatment** screen for nurses, paramedics, clinicians and admins (`/treatment-room`), with a count of waiting procedures on its navigation link (the count turns red when any is urgent).

- **Waiting**: urgent first, then oldest first. Each card shows the patient (name, sex, age), the procedure, site, the doctor's instructions, who sent it, how long it has waited and the expected price.
- **Record done**: the nurse confirms the site and adds a note. The procedure is recorded as done by that nurse and **its charge is created then**, at the price list's price, on the patient's open invoice. A procedure never done is never billed, so nothing has to be voided.
- **Send back to doctor**: needs a reason. Nothing is charged; the doctor sees "Sent back by the nurse: …" on the note and can dismiss it or send a new order.
- **Done in the last 24 hours**: what has been recorded from this list, and by whom.
- The list refreshes when opened, every 30 seconds while the tab is visible, and when the connection returns.

### What the doctor sees

While any procedure is waiting, the note checks the treatment room every 30 seconds and updates by itself: **Done by Nurse …** with the time and the nurse's site and note, or the reason it was sent back. A waiting order can be **withdrawn** by the doctor who sent it, until a nurse has dealt with it.

### Rules

- Only an open encounter takes new orders. A nurse can still record one done after the doctor has closed the encounter; the charge is added to the patient's invoice, and from then on only the nurse who did it, an admin, or the billing desk can change it.
- Two nurses pressing done together record it once and charge once. Pressing it twice does the same.
- A procedure typed in by hand (not on the price list) can be ordered and done, with no charge.

### API

`POST /api/encounters/:encounterId/procedures` takes `mode: "ORDER"` with optional `instructions` and `priority` (`ROUTINE` or `URGENT`). `GET /api/encounters/:encounterId/procedures` returns the live state of the encounter's procedures. For the treatment room (roles `nurse`, `paramedic`, `clinician`, `doctor`, `admin`): `GET /api/treatment-room/procedures?view=waiting|done|count`, `POST /api/treatment-room/procedures/:id/complete` `{ site?, note? }` and `POST /api/treatment-room/procedures/:id/return` `{ reason }`.

### Data

A second additive migration (`20261105020000_procedure_orders`) lets a procedure be ordered before it is done: it adds who ordered it and when, the instructions and priority, makes the performer and time optional until it is done, and widens the status to `ORDERED`, `ACTIVE` (done), `RETURNED`, `CANCELLED` and `REMOVED`, with database checks that keep each status consistent. Existing rows are unchanged.

### Not built

- Sending a procedure to a specific nurse or room; the list is shared.
- Notifying the nurse beyond the count on the navigation link and the list itself.
- Quantity above one.
- Asking for payment before the procedure is done.
