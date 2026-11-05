// Recorded procedures and their charges. Everything runs in a disposable schema that is dropped afterwards.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'); require(root + '/node_modules/dotenv').config({ path: root + '/.env', quiet: true });
if (process.env.STOCK_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.STOCK_TEST_DATABASE_URL;
require(root + '/node_modules/ts-node').register({ project: root + '/tsconfig.json', transpileOnly: true });
const { PrismaClient } = require(root + '/node_modules/@prisma/client');
const appPrisma = require(root + '/src/lib/prisma.ts'); // modules read `.default` at call time, so swapping it points every loaded module at the test schema
main().catch(e => { console.error(e); process.exitCode = 1; });

async function main() {
  const schema = 'ses_procedures_test_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  assert.match(schema, /^ses_procedures_test_\d+_[a-f0-9]{8}$/);
  const url = new URL(process.env.DATABASE_URL); url.searchParams.set('schema', schema);
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  let db, server, created = false, checks = 0; const ok = () => { checks++; };
  try {
    await admin.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"'); created = true;
    const r = spawnSync(process.execPath, [root + '/node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: root, env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8', windowsHide: true });
    if (r.status) throw Error(r.stdout + '\n' + r.stderr);
    db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    Object.defineProperty(appPrisma, 'default', { value: db, configurable: true });

    const dr = await db.user.create({ data: { name: 'Synthetic doctor', email: 'proc-dr@example.test', password: 'x', role: 'clinician' } });
    const other = await db.user.create({ data: { name: 'Other doctor', email: 'proc-other@example.test', password: 'x', role: 'clinician' } });
    const boss = await db.user.create({ data: { name: 'Synthetic admin', email: 'proc-admin@example.test', password: 'x', role: 'admin' } });
    const nurse = await db.user.create({ data: { name: 'Synthetic nurse', email: 'proc-nurse@example.test', password: 'x', role: 'nurse' } });
    const pharm = await db.user.create({ data: { name: 'Synthetic pharmacist', email: 'proc-pharm@example.test', password: 'x', role: 'pharmacist' } });
    const patient = await db.patient.create({ data: { firstName: 'Test', lastName: 'Patient', dateOfBirth: new Date('1990-01-01'), gender: 'FEMALE' } });
    const enc = await db.encounter.create({ data: { patientId: patient.id, clinicianId: dr.id } });
    const closed = await db.encounter.create({ data: { patientId: patient.id, clinicianId: dr.id, status: 'CLOSED' } });
    const cannula = 'procedure_peripheral_iv_cannulation', suture = 'procedure_suturing_of_wound';
    await db.priceListItem.createMany({ data: [
      { itemType: 'PROCEDURE', catalogueRef: cannula, name: 'Peripheral IV cannulation', detail: 'Vascular access and injections', unit: 'each', unitPrice: 50 },
      { itemType: 'PROCEDURE', catalogueRef: suture, name: 'Suturing of wound', unit: 'each' },
      { itemType: 'PROCEDURE', catalogueRef: 'procedure_old_thing', name: 'Old thing', unit: 'each', unitPrice: 10, active: false },
      { itemType: 'DRUG', catalogueRef: 'DRUG_X', name: 'Some drug', unit: 'per unit', unitPrice: 5 },
    ] });

    const express = require(root + '/node_modules/express');
    const { recordProcedure, removeProcedure, listProcedures } = require(root + '/src/controllers/procedures.controller');
    const { listTreatmentProcedures, completeTreatmentProcedure, returnTreatmentProcedure } = require(root + '/src/controllers/treatmentRoom.controller');
    const { requireRoles } = require(root + '/src/middleware/auth');
    const { lookupPrices } = require(root + '/src/controllers/price.controller');
    const users = Object.fromEntries([dr, other, boss, nurse, pharm].map(u => [u.id, u]));
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { const u = users[req.header('x-user')]; if (u) { req.userId = u.id; req.userRole = u.role; } next(); });
    app.post('/encounters/:encounterId/procedures', recordProcedure);
    app.delete('/encounters/:encounterId/procedures/:id', removeProcedure);
    app.get('/price-list/lookup', lookupPrices);
    app.get('/encounters/:encounterId/procedures', listProcedures);
    const room = requireRoles('admin', 'clinician', 'doctor', 'nurse', 'paramedic');   // the same guard the real routes use
    app.get('/treatment-room/procedures', room, listTreatmentProcedures);
    app.post('/treatment-room/procedures/:id/complete', room, completeTreatmentProcedure);
    app.post('/treatment-room/procedures/:id/return', room, returnTreatmentProcedure);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const call = (method, p, body, user = dr) => fetch(origin + p, { method, headers: { 'content-type': 'application/json', 'x-user': user.id }, body: body ? JSON.stringify(body) : undefined });
    const post = (body, encId = enc.id, user = dr) => call('POST', `/encounters/${encId}/procedures`, body, user);
    const lines = () => db.chargeLine.findMany({ where: { sourceType: 'PROCEDURE' }, orderBy: { createdAt: 'asc' } });

    // A procedure picked from the price list: named and priced by the list, charged once, on one open invoice.
    let res = await post({ clientId: 'c1', catalogueRef: cannula, name: 'Anything the browser sent', site: 'Left forearm', note: 'Easy first attempt' });
    assert.equal(res.status, 201); const first = await res.json();
    assert.equal(first.name, 'Peripheral IV cannulation', 'the price list wording is the one recorded'); assert.equal(first.site, 'Left forearm'); assert.equal(first.charged, true); assert.equal(first.price, 50); assert.equal(first.replayed, false);
    let all = await lines(); assert.equal(all.length, 1);
    assert.equal(all[0].sourceId, first.id); assert.equal(all[0].description, 'Peripheral IV cannulation'); assert.equal(all[0].detail, 'Left forearm'); assert.equal(Number(all[0].unitPrice), 50); assert.equal(Number(all[0].quantity), 1);
    assert.equal(all[0].encounterId, enc.id); assert.equal(all[0].patientId, patient.id); assert.equal(all[0].createdById, dr.id); assert.equal(all[0].needsReview, false);
    const invoices = await db.invoice.findMany({ where: { patientId: patient.id } }); assert.equal(invoices.length, 1); assert.equal(invoices[0].status, 'OPEN'); ok();

    // Repeating the request, even many at once, records and charges once.
    res = await post({ clientId: 'c1', catalogueRef: cannula }); assert.equal(res.status, 200); const again = await res.json(); assert.equal(again.id, first.id); assert.equal(again.replayed, true);
    const race = await Promise.all(Array.from({ length: 6 }, () => post({ clientId: 'c-race', catalogueRef: suture, site: 'Chin' })));
    assert.ok(race.every(x => [200, 201].includes(x.status))); const ids = new Set((await Promise.all(race.map(x => x.json()))).map(x => x.id)); assert.equal(ids.size, 1);
    assert.equal(await db.encounterProcedure.count(), 2); all = await lines(); assert.equal(all.length, 2, 'one charge per procedure'); ok();

    // Unpriced list item: charge line exists, flagged for the billing desk, no price shown.
    const unpriced = all.find(l => l.description === 'Suturing of wound'); assert.equal(unpriced.unitPrice, null); assert.equal(unpriced.needsReview, true);
    assert.equal((await (await post({ clientId: 'c-race', catalogueRef: suture })).json()).price, null); ok();

    // Typed by hand: recorded, no charge (the billing desk adds those).
    res = await post({ clientId: 'c-hand', name: '  Removal of a fish hook  ', site: 'Thumb' }); assert.equal(res.status, 201); const hand = await res.json();
    assert.equal(hand.name, 'Removal of a fish hook'); assert.equal(hand.charged, false); assert.equal(hand.catalogueRef, null); assert.equal((await lines()).length, 2); ok();

    // Bad input is refused, not guessed.
    const refuse = async (body, status, encId = enc.id) => { const x = await post(body, encId); assert.equal(x.status, status, JSON.stringify(body) + ' -> ' + x.status); };
    await refuse({ catalogueRef: cannula }, 400);                                  // no client id
    await refuse({ clientId: 'x1', catalogueRef: 'DRUG_X' }, 400);                  // a drug is not a procedure
    await refuse({ clientId: 'x2', catalogueRef: 'procedure_not_on_list' }, 400);   // unknown reference
    await refuse({ clientId: 'x3', catalogueRef: 'procedure_old_thing' }, 400);     // switched off
    await refuse({ clientId: 'x4' }, 400);                                          // no name
    await refuse({ clientId: 'x5', name: 'a' }, 400);                               // too short
    await refuse({ clientId: 'x6', catalogueRef: cannula }, 404, '00000000-0000-0000-0000-000000000000');
    await refuse({ clientId: 'x7', catalogueRef: cannula }, 409, closed.id);        // closed encounter
    assert.equal(await db.encounterProcedure.count(), 3); assert.equal((await lines()).length, 2); ok();

    // Taking one back: only the person who recorded it (or an admin), while the invoice is still open.
    let del = await call('DELETE', `/encounters/${enc.id}/procedures/${first.id}`, { reason: 'Wrong patient' }, other); assert.equal(del.status, 403);
    del = await call('DELETE', `/encounters/${closed.id}/procedures/${first.id}`, {}, dr); assert.equal(del.status, 404, 'wrong encounter');
    del = await call('DELETE', `/encounters/${enc.id}/procedures/${first.id}`, { reason: 'Wrong patient' }, dr); assert.equal(del.status, 200);
    let row = await db.encounterProcedure.findUnique({ where: { id: first.id } }); assert.equal(row.status, 'REMOVED'); assert.equal(row.removedById, dr.id); assert.equal(row.removeReason, 'Wrong patient');
    let line = await db.chargeLine.findFirst({ where: { sourceId: first.id } }); assert.equal(line.status, 'VOIDED'); assert.equal(line.voidReason, 'Wrong patient');
    const audits = await db.billingAudit.findMany({ where: { entityId: line.id } }); assert.equal(audits.length, 1); assert.equal(audits[0].action, 'LINE_VOIDED'); assert.equal(audits[0].userId, dr.id);
    del = await call('DELETE', `/encounters/${enc.id}/procedures/${first.id}`, {}, dr); assert.equal((await del.json()).alreadyRemoved, true, 'removing twice is harmless');
    // A removed procedure can be recorded again afresh under a new entry id and is charged again.
    res = await post({ clientId: 'c1b', catalogueRef: cannula }); assert.equal(res.status, 201); assert.equal((await res.json()).charged, true); assert.equal((await lines()).length, 3); ok();

    // Once the invoice has a payment, the doctor cannot remove the charge; the billing desk does.
    const live = await db.encounterProcedure.findFirst({ where: { clientId: 'c1b' } });
    await db.invoice.update({ where: { id: invoices[0].id }, data: { status: 'PART_PAID', lockedAt: new Date() } });
    del = await call('DELETE', `/encounters/${enc.id}/procedures/${live.id}`, {}, dr); assert.equal(del.status, 409); assert.match((await del.json()).error, /billing desk/);
    del = await call('DELETE', `/encounters/${enc.id}/procedures/${live.id}`, {}, boss); assert.equal(del.status, 409, 'the same rule applies to an admin');
    assert.equal((await db.encounterProcedure.findUnique({ where: { id: live.id } })).status, 'ACTIVE');
    assert.equal((await db.chargeLine.findFirst({ where: { sourceId: live.id } })).status, 'ACTIVE'); ok();

    // A hand-typed procedure has no charge, so it can always be taken back (an admin may too).
    del = await call('DELETE', `/encounters/${enc.id}/procedures/${hand.id}`, {}, boss); assert.equal(del.status, 200);
    assert.equal((await db.encounterProcedure.findUnique({ where: { id: hand.id } })).status, 'REMOVED'); ok();

    // The price lookup used by the ordering screens now knows procedures.
    const found = await (await call('GET', `/price-list/lookup?refs=${cannula},${suture},DRUG_X,procedure_old_thing`)).json();
    assert.equal(found[cannula], 50); assert.equal(found[suture], null); assert.equal(found['DRUG_X'], 5); assert.ok(!('procedure_old_thing' in found), 'switched off items are absent'); ok();

    // ── Sent to the treatment room ────────────────────────────────────────────────────────────────────────────────
    // Nothing is charged when a doctor only orders a procedure; the nurse's "done" creates the charge.
    const enc2 = await db.encounter.create({ data: { patientId: patient.id, clinicianId: dr.id } });
    const order = (clientId, extra = {}, encId = enc.id, user = dr) => post({ clientId, mode: 'ORDER', ...extra }, encId, user);
    const chargesBefore = (await lines()).length;
    res = await order('o1', { catalogueRef: cannula, site: 'Right hand', instructions: 'Use a small cannula', priority: 'URGENT' }); assert.equal(res.status, 201); const o1 = await res.json();
    assert.equal(o1.status, 'ORDERED'); assert.equal(o1.charged, false); assert.equal(o1.price, null); assert.equal(o1.expectedPrice, 50, 'the expected price is shown, not charged'); assert.equal(o1.priority, 'URGENT'); assert.equal(o1.instructions, 'Use a small cannula');
    assert.match(o1.orderedBy, /Synthetic doctor/); assert.equal(o1.performedAt, null); assert.equal(o1.performedBy, null);
    assert.equal((await lines()).length, chargesBefore, 'ordering creates no charge');
    res = await order('o1', { catalogueRef: cannula }); assert.equal(res.status, 200); assert.equal((await res.json()).replayed, true); assert.equal(await db.encounterProcedure.count({ where: { clientId: 'o1' } }), 1);
    res = await order('o2', { catalogueRef: suture, site: 'Chin' }); const o2 = await res.json();        // routine, ordered after o1
    res = await order('o3', { name: 'Ear piercing removal' }); const o3 = await res.json();                  // typed in by hand: no price list item
    assert.equal((await order('o9', { catalogueRef: cannula }, closed.id)).status, 409, 'a closed encounter takes no new orders');
    assert.equal((await order('o9', { catalogueRef: 'DRUG_X' })).status, 400); ok();

    // The nurse's worklist: urgent first, then oldest first, with who and why.
    const roomGet = async (query = '', user = nurse) => { const x = await call('GET', '/treatment-room/procedures' + query, undefined, user); return { status: x.status, body: await x.json() }; };
    let wl = await roomGet(); assert.equal(wl.status, 200);
    assert.deepEqual(wl.body.items.map(x => x.id), [o1.id, o2.id, o3.id], 'urgent first, then in the order they were sent');
    assert.equal(wl.body.counts.waiting, 3); assert.equal(wl.body.counts.urgent, 1);
    assert.equal(wl.body.items[0].patient.name, 'Test Patient'); assert.equal(wl.body.items[0].patient.gender, 'FEMALE'); assert.equal(wl.body.items[0].instructions, 'Use a small cannula'); assert.equal(wl.body.items[0].expectedPrice, 50);
    assert.equal((await roomGet('', pharm)).status, 403, 'pharmacy staff do not see the treatment room'); assert.equal((await roomGet('', dr)).status, 200);
    const counted = await roomGet('?view=count'); assert.deepEqual(counted.body, { counts: { waiting: 3, urgent: 1 } }, 'the badge needs only the numbers'); ok();

    // The doctor's note can ask what has happened to each procedure.
    const mine = await (await call('GET', '/encounters/' + enc.id + '/procedures')).json();
    assert.equal(mine.find(x => x.id === o1.id).status, 'ORDERED'); assert.ok(mine.find(x => x.id === first.id) === undefined, 'a procedure that was taken back is not listed'); ok();

    // Only the ordering doctor (or an admin) can withdraw a waiting order; once withdrawn the nurse cannot do it.
    const o4 = await (await order('o4', { catalogueRef: suture })).json();
    del = await call('DELETE', '/encounters/' + enc.id + '/procedures/' + o4.id, {}, other); assert.equal(del.status, 403);
    del = await call('DELETE', '/encounters/' + enc.id + '/procedures/' + o4.id, {}, dr); assert.equal(del.status, 200);
    assert.equal((await db.encounterProcedure.findUnique({ where: { id: o4.id } })).status, 'CANCELLED');
    res = await call('POST', '/treatment-room/procedures/' + o4.id + '/complete', {}, nurse); assert.equal(res.status, 409);
    assert.equal((await roomGet()).body.counts.waiting, 3); assert.equal((await lines()).length, chargesBefore); ok();

    // The nurse records it done: charged once, at the price list's price, to the nurse's name, on the patient's open invoice.
    res = await call('POST', '/treatment-room/procedures/' + o1.id + '/complete', { site: 'Right hand, dorsum', note: 'Flushed well' }, nurse); assert.equal(res.status, 200); const d1 = await res.json();
    assert.equal(d1.status, 'ACTIVE'); assert.equal(d1.charged, true); assert.equal(d1.price, 50); assert.equal(d1.site, 'Right hand, dorsum'); assert.equal(d1.note, 'Flushed well'); assert.match(d1.performedBy, /Synthetic nurse/); assert.match(d1.orderedBy, /Synthetic doctor/); assert.equal(d1.replayed, false);
    let line1 = await db.chargeLine.findFirst({ where: { sourceId: o1.id } }); assert.equal(Number(line1.unitPrice), 50); assert.equal(line1.createdById, nurse.id); assert.equal(line1.detail, 'Right hand, dorsum'); assert.equal(line1.encounterId, enc.id); assert.equal(line1.patientId, patient.id);
    res = await call('POST', '/treatment-room/procedures/' + o1.id + '/complete', {}, nurse); assert.equal((await res.json()).replayed, true); assert.equal(await db.chargeLine.count({ where: { sourceId: o1.id } }), 1, 'pressing done twice charges once');
    // Two nurses pressing done at the same moment: one record, one charge.
    const racing = await Promise.all([nurse, boss, dr, nurse, boss].map(u => call('POST', '/treatment-room/procedures/' + o2.id + '/complete', { site: 'Chin' }, u)));
    assert.ok(racing.every(x => x.status === 200)); assert.equal(await db.chargeLine.count({ where: { sourceId: o2.id } }), 1);
    const performers = new Set((await Promise.all(racing.map(x => x.json()))).map(x => x.performedBy)); assert.equal(performers.size, 1, 'everyone sees the same person did it');
    // A hand-typed order has no price list item, so doing it creates no charge.
    res = await call('POST', '/treatment-room/procedures/' + o3.id + '/complete', {}, nurse); assert.equal((await res.json()).charged, false); assert.equal(await db.chargeLine.count({ where: { sourceId: o3.id } }), 0);
    assert.equal((await roomGet()).body.counts.waiting, 0); ok();

    // The doctor sees the result on the note; the nurse's work can be removed only by the nurse (or an admin), not the doctor.
    const after = await (await call('GET', '/encounters/' + enc.id + '/procedures')).json();
    assert.equal(after.find(x => x.id === o1.id).status, 'ACTIVE'); assert.match(after.find(x => x.id === o1.id).performedBy, /Synthetic nurse/);
    del = await call('DELETE', '/encounters/' + enc.id + '/procedures/' + o1.id, {}, dr); assert.equal(del.status, 403); ok();
    // Done today: only procedures that came through the treatment room.
    const doneToday = await roomGet('?view=done'); assert.deepEqual(new Set(doneToday.body.items.map(x => x.id)), new Set([o1.id, o2.id, o3.id]), 'what the doctor recorded directly is not in the nurse list');
    assert.ok(doneToday.body.items.every(x => x.status === 'ACTIVE' && x.performedAt)); ok();

    // Sent back: needs a reason, is never charged, and the doctor sees why.
    const o5 = await (await order('o5', { catalogueRef: cannula })).json();
    res = await call('POST', '/treatment-room/procedures/' + o5.id + '/return', {}, nurse); assert.equal(res.status, 400); res = await call('POST', '/treatment-room/procedures/' + o5.id + '/return', { reason: 'ok' }, nurse); assert.equal(res.status, 400, 'a reason of a couple of letters is not enough');
    res = await call('POST', '/treatment-room/procedures/' + o5.id + '/return', { reason: 'Patient refused; needs a doctor to explain' }, nurse); assert.equal(res.status, 200); const r5 = await res.json();
    assert.equal(r5.status, 'RETURNED'); assert.equal(r5.returnReason, 'Patient refused; needs a doctor to explain'); assert.equal(await db.chargeLine.count({ where: { sourceId: o5.id } }), 0);
    assert.equal((await (await call('POST', '/treatment-room/procedures/' + o5.id + '/return', { reason: 'Patient refused again' }, nurse)).json()).replayed, true);
    res = await call('POST', '/treatment-room/procedures/' + o5.id + '/complete', {}, nurse); assert.equal(res.status, 409, 'a returned procedure cannot be done');
    const seen = (await (await call('GET', '/encounters/' + enc.id + '/procedures')).json()).find(x => x.id === o5.id); assert.equal(seen.status, 'RETURNED'); assert.equal(seen.returnReason, 'Patient refused; needs a doctor to explain');
    del = await call('DELETE', '/encounters/' + enc.id + '/procedures/' + o5.id, {}, dr); assert.equal((await del.json()).dismissed, true, 'the doctor can dismiss a returned order');
    assert.equal((await roomGet()).body.counts.waiting, 0); ok();

    // Done after the doctor has closed the encounter: still charged to the patient, but the doctor can no longer change it.
    const o6 = await (await order('o6', { catalogueRef: cannula }, enc2.id)).json();
    await db.encounter.update({ where: { id: enc2.id }, data: { status: 'CLOSED' } });
    res = await call('POST', '/treatment-room/procedures/' + o6.id + '/complete', { site: 'Left hand' }, nurse); assert.equal(res.status, 200); assert.equal((await res.json()).charged, true);
    assert.equal((await db.chargeLine.findFirst({ where: { sourceId: o6.id } })).encounterId, enc2.id);
    del = await call('DELETE', '/encounters/' + enc2.id + '/procedures/' + o6.id, {}, nurse); assert.equal(del.status, 409); ok();

    // The starter catalogue: loads as unpriced price-list items and never touches a price an admin already set.
    const builtin = JSON.parse(fs.readFileSync(root + '/data/builtin-price-items.json', 'utf8')).filter(x => x.itemType === 'PROCEDURE');
    const catalogue = JSON.parse(fs.readFileSync(root + '/../client/src/data/proceduresCatalogue.json', 'utf8')).procedures;
    assert.ok(builtin.length >= 50); assert.equal(builtin.length, catalogue.length, 'the app list and the price list entries match');
    assert.equal(new Set(builtin.map(x => x.catalogueRef)).size, builtin.length, 'no duplicate references');
    for (const x of builtin) { assert.match(x.catalogueRef, /^procedure_[a-z0-9_]+$/); assert.ok(x.name.length >= 2 && x.name.length <= 120); assert.equal(x.unit, 'each'); }
    assert.deepEqual(builtin.map(x => x.catalogueRef).sort(), catalogue.map(x => x.code).sort());
    assert.ok(builtin.some(x => x.catalogueRef === cannula && x.name === 'Peripheral IV cannulation'), 'cannulation is on the list');
    await require(root + '/src/lib/builtinPrices').ensureBuiltinPrices();
    assert.equal(await db.priceListItem.count({ where: { itemType: 'PROCEDURE', catalogueRef: { in: builtin.map(x => x.catalogueRef) } } }), builtin.length);
    assert.equal(Number((await db.priceListItem.findUnique({ where: { itemType_catalogueRef: { itemType: 'PROCEDURE', catalogueRef: cannula } } })).unitPrice), 50, 'an existing price survives');
    assert.equal((await db.priceListItem.findUnique({ where: { itemType_catalogueRef: { itemType: 'PROCEDURE', catalogueRef: builtin.find(x => x.catalogueRef !== cannula && x.catalogueRef !== suture).catalogueRef } } })).unitPrice, null, 'new entries start unpriced'); ok();

    console.log(checks + '/' + checks + ' procedure check groups passed. All writes used a disposable schema.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.$disconnect();
    if (created) { assert.match(schema, /^ses_procedures_test_\d+_[a-f0-9]{8}$/); await admin.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE'); }
    await admin.$disconnect();
  }
}
