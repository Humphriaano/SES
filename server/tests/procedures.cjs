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
    const { recordProcedure, removeProcedure } = require(root + '/src/controllers/procedures.controller');
    const { lookupPrices } = require(root + '/src/controllers/price.controller');
    const users = Object.fromEntries([dr, other, boss].map(u => [u.id, u]));
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { const u = users[req.header('x-user')]; if (u) { req.userId = u.id; req.userRole = u.role; } next(); });
    app.post('/encounters/:encounterId/procedures', recordProcedure);
    app.delete('/encounters/:encounterId/procedures/:id', removeProcedure);
    app.get('/price-list/lookup', lookupPrices);
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
