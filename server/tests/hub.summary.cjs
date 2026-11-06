// The hub's overview summary: every tile figure equals the same figure in the report it opens, each role gets only the tiles it may open,
// billing figures only for billing roles and only for a period, one failing report leaves the rest, and no report filter leaks into a tile.
// Disposable schema, real router, real tokens.
const assert = require('node:assert/strict'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'); require(root + '/node_modules/dotenv').config({ path: root + '/.env', quiet: true });
if (process.env.STOCK_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.STOCK_TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'hub-test-secret';
require(root + '/node_modules/ts-node').register({ project: root + '/tsconfig.json', transpileOnly: true });
const { PrismaClient } = require(root + '/node_modules/@prisma/client');
const appPrisma = require(root + '/src/lib/prisma.ts'); // modules read `.default` at call time, so swapping it points every loaded module at the test schema
main().catch(e => { console.error(e); process.exitCode = 1; });

async function main() {
  const schema = 'ses_hub_test_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  assert.match(schema, /^ses_hub_test_\d+_[a-f0-9]{8}$/);
  const url = new URL(process.env.DATABASE_URL); url.searchParams.set('schema', schema);
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  let db, server, created = false, checks = 0; const ok = () => { checks++; };
  try {
    await admin.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"'); created = true;
    const r = spawnSync(process.execPath, [root + '/node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: root, env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8', windowsHide: true });
    if (r.status) throw Error(r.stdout + '\n' + r.stderr);
    db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    Object.defineProperty(appPrisma, 'default', { value: db, configurable: true });

    const now = new Date(), ago = (days, minutes = 0) => new Date(now.getTime() - days * 86400000 - minutes * 60000), plus = (d, minutes) => new Date(d.getTime() + minutes * 60000);
    const dayText = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const mk = (name, role) => db.user.create({ data: { name, email: name.toLowerCase().replace(/\s/g, '.') + '@example.test', password: 'x', role, status: 'active' } });
    const boss = await mk('Synthetic admin', 'admin'), dr = await mk('Synthetic doctor', 'clinician'), nurse = await mk('Synthetic nurse', 'nurse'), pharm = await mk('Synthetic pharmacist', 'pharmacist'), desk = await mk('Synthetic reception', 'receptionist'), biller = await mk('Synthetic biller', 'billing');
    const patient = (firstName, lastName) => db.patient.create({ data: { firstName, lastName, dateOfBirth: new Date(1985, 5, 15), gender: 'FEMALE' } });
    const P1 = await patient('Mary', 'Phiri'), P2 = await patient('John', 'Banda'), P3 = await patient('Peter', 'Zulu');

    // Attendance: three check-ins, two first visits and one return.
    const room = await db.facilityRoom.create({ data: { name: 'Consultation Room 1', tag: 'CR1' } });
    let n = 0; const checkin = (p, checkedInAt) => db.queueEntry.create({ data: { queueNumber: ++n, patientId: p.id, patientName: p.firstName, roomId: room.id, status: 'Done', checkedInAt } });
    await checkin(P1, ago(3)); await checkin(P1, ago(1)); await checkin(P2, ago(2));
    // Chronic: three with hypertension, two seen in the last 90 days (by a check-in), one not.
    const code = await db.iCD11Code.create({ data: { code: 'BA00', description: 'Essential hypertension' } });
    for (const p of [P1, P2, P3]) await db.patientDiagnosis.create({ data: { patientId: p.id, icd11Id: code.id, createdAt: ago(120) } });
    // Lab: two resulted (30 and 90 minutes), one waiting.
    const test = async (p, name, orderedAt, status, resultMin) => {
      const o = await db.investigationOrder.create({ data: { patientId: p.id, orderedById: dr.id, orderedAt } });
      const item = await db.investigationOrderItem.create({ data: { orderId: o.id, type: 'single', catalogueId: 'c-' + name, name, specimen: 'Blood', status } });
      if (resultMin !== undefined) await db.investigationResult.create({ data: { itemId: item.id, resultedById: nurse.id, resultedAt: plus(orderedAt, resultMin), resultsJson: JSON.stringify([{ componentName: name, value: '1', status: 'Normal' }]) } });
    };
    await test(P1, 'Malaria RDT', ago(2), 'Resulted', 30); await test(P2, 'FBC', ago(2), 'Resulted', 90); await test(P3, 'Urinalysis', ago(1), 'Pending');
    // Pharmacy: two dispensings; one prescription not available, one waiting.
    const encounter = await db.encounter.create({ data: { patientId: P1.id, clinicianId: dr.id } });
    const rx = async (name, flags) => { const m = await db.medication.create({ data: { patientId: P1.id, name, catalogueCode: name.slice(0, 3).toUpperCase(), startDate: ago(2) } }); return db.prescription.create({ data: { encounterId: encounter.id, medicationId: m.id, createdAt: ago(2), ...flags } }); };
    await rx('Amoxicillin', { notAvailable: true }); await rx('Paracetamol', {});
    for (const [p, drug] of [[P1, 'Amoxicillin'], [P2, 'Ibuprofen']]) await db.dispensing.create({ data: { patientId: p.id, type: 'direct', dispensedDrug: drug, quantity: 10, quantityUnit: 'tablet', dispensedBy: dr.id, dispensedAt: ago(1) } });
    // Billing: one invoice of 100, paid 40 cash and 10 mobile money.
    const invoice = await db.invoice.create({ data: { number: 'INV-TEST-000001', patientId: P1.id } });
    await db.chargeLine.create({ data: { invoiceId: invoice.id, patientId: P1.id, sourceType: 'CONSULTATION', sourceId: 'c1', description: 'Consultation', quantity: 1, unitPrice: 100 } });
    for (const [k, method, amount] of [[1, 'CASH', 40], [2, 'MOBILE_MONEY', 10]]) await db.payment.create({ data: { receiptNumber: 'RCT-TEST-00000' + k, invoiceId: invoice.id, amount, method, receivedById: biller.id } });

    const express = require(root + '/node_modules/express'), jwt = require(root + '/node_modules/jsonwebtoken');
    const app = express(); app.use(express.json()); app.use('/api', require(root + '/src/routes/index').default);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const get = (p, user) => fetch(origin + '/api' + p, { headers: user ? { authorization: 'Bearer ' + jwt.sign({ userId: user.id }, process.env.JWT_SECRET) } : {} });
    const json = async (p, user) => { const res = await get(p, user); assert.equal(res.status, 200, p); return res.json(); };
    const range = `from=${dayText(ago(30))}&to=${dayText(now)}`, S = '/reports/hub/summary';
    const value = (tile, label) => tile.figures.find(f => f.label === label)?.value;

    // The tiles, for someone who may open everything but billing, and their exact figures.
    let hub = await json(`${S}?${range}`, dr);
    assert.deepEqual(hub.tiles.map(t => [t.id, t.title, t.opens]), [['attendance', 'Attendance', 'attendance'], ['chronic', 'Chronic disease', 'chronic'], ['lab', 'Laboratory', 'lab'], ['pharmacy', 'Pharmacy', 'pharmacy']]);
    assert.equal(hub.billing, null, 'a clinician has no billing figures'); assert.ok(hub.period.includes(' to '));
    const tile = id => hub.tiles.find(t => t.id === id);
    assert.deepEqual(tile('attendance').figures.map(f => [f.label, f.value]), [['Attendances', 3], ['New attendance', 2], ['Re-attendance', 1]]);
    assert.deepEqual(tile('chronic').figures.map(f => [f.label, f.value]), [['Patients with an active chronic condition', 3], ['Seen in the last 90 days (all conditions)', 2], ['Overdue (all conditions)', 1]]);
    assert.deepEqual(tile('lab').figures.map(f => [f.label, f.value]), [['Tests resulted', 2], ['Median, order to result', '1 h'], ['Longest, order to result', '1 h 30 min'], ['Waiting (pending or in progress)', 1]]);
    assert.deepEqual(tile('pharmacy').figures.map(f => [f.label, f.value]), [['Dispensings', 2], ['Patients', 2], ['Not available', 1], ['Waiting', 1]]);
    assert.ok(hub.tiles.every(t => !t.error)); ok();

    // Every figure equals the same figure in the report the tile opens.
    const sources = { attendance: ['/reports/attendance/attendance'], chronic: ['/reports/chronic/register'], lab: ['/reports/lab/turnaround', '/reports/lab/tests'], pharmacy: ['/reports/pharmacy/dispensed', '/reports/pharmacy/prescriptions'] };
    for (const [id, paths] of Object.entries(sources)) {
      const summaries = (await Promise.all(paths.map(p => json(`${p}?${range}`, dr)))).flatMap(rep => rep.summary);
      for (const f of tile(id).figures) assert.deepEqual(summaries.find(s => s.label === f.label)?.value, f.value, id + ': ' + f.label);
    }
    ok();

    // Billing, for the billing roles only: collected by method, revenue by service, outstanding by age. Each equals its own report.
    hub = await json(`${S}?${range}`, biller);
    assert.deepEqual(hub.tiles, [], 'billing has no clinical tiles'); const b = hub.billing;
    assert.deepEqual(b.collected, [{ label: 'Cash', value: 40 }, { label: 'Mobile money', value: 10 }, { label: 'Card', value: 0 }]); assert.deepEqual([b.collectedTotal, b.creditUsed], [50, 0]);
    assert.deepEqual(b.revenue, [{ label: 'Consultation', value: 100 }]); assert.deepEqual([b.charged, b.discounts, b.waived], [100, 0, 0]);
    assert.deepEqual(b.outstanding, [{ label: '0–7 days', value: 50 }, { label: '8–30 days', value: 0 }, { label: '31–60 days', value: 0 }, { label: 'Over 60 days', value: 0 }]); assert.deepEqual([b.outstandingTotal, b.invoices, b.overdue], [50, 1, 0]);
    const revenue = await json(`/reports/billing/revenue?${range}`, biller), collections = await json(`/reports/billing/collections?${range}`, biller), outstanding = await json('/reports/billing/outstanding', biller);
    assert.equal(b.charged, revenue.summary.find(s => s.label === 'Charged').value); assert.equal(b.collectedTotal, collections.summary.find(s => s.label === 'Collected').value);
    assert.equal(b.outstandingTotal, outstanding.summary.find(s => s.label === 'Outstanding').value); assert.equal(b.collected[0].value, collections.totals.cash);
    const bossHub = await json(`${S}?${range}`, boss); assert.equal(bossHub.tiles.length, 4); assert.deepEqual(bossHub.billing, b, 'an admin sees both'); ok();

    // Who gets what.
    for (const [who, tiles, billing] of [[desk, 4, false], [nurse, 4, false], [pharm, 4, false], [dr, 4, false], [boss, 4, true], [biller, 0, true]]) {
      const h = await json(`${S}?${range}`, who); assert.deepEqual([h.tiles.length, !!h.billing], [tiles, billing], who.name);
    }
    assert.equal((await get(`${S}?${range}`)).status, 401); ok();

    // The period: all time has no billing figures but every tile; more than a year has no billing figures; a bad period is a 400.
    hub = await json(S, boss); assert.equal(hub.period, 'All time'); assert.equal(hub.tiles.length, 4); assert.match(hub.billing.error, /Choose a period/); assert.equal(hub.billing.collected, undefined);
    assert.equal((await json(S, dr)).billing, null, 'no billing message for someone who has no billing');
    hub = await json(`${S}?from=${dayText(ago(800))}&to=${dayText(now)}`, boss); assert.equal(hub.tiles.length, 4); assert.match(hub.billing.error, /one year or less/);
    for (const bad of ['from=2026-03-01', 'from=2026-03-02&to=2026-03-01', 'from=2026-02-31&to=2026-03-01']) { const res = await get(`${S}?${bad}`, dr); assert.equal(res.status, 400, bad); assert.ok((await res.json()).error.length > 10); }
    ok();

    // A tile never carries a report's own filters.
    const noisy = await json(`${S}?${range}&sex=MALE&groupBy=brand&type=direct&condition=hiv&names=1&status=waiting`, dr);
    assert.deepEqual(noisy.tiles, (await json(`${S}?${range}`, dr)).tiles); ok();

    // One report failing leaves the rest.
    const { findReport } = require(root + '/src/lib/reportRegistry.ts'), def = findReport('lab', 'turnaround'), original = def.run;
    def.run = async () => { throw new Error('boom'); };
    const realError = console.error; console.error = () => {};
    try {
      hub = await json(`${S}?${range}`, dr);
      assert.deepEqual(hub.tiles.map(t => [t.id, !!t.error]), [['attendance', false], ['chronic', false], ['lab', true], ['pharmacy', false]]); assert.equal(hub.tiles.find(t => t.id === 'lab').error, 'Could not load this. Try again.');
      assert.ok(!JSON.stringify(hub).includes('boom'), 'the error text is not passed to the screen');
    } finally { def.run = original; console.error = realError; }
    assert.ok((await json(`${S}?${range}`, dr)).tiles.every(t => !t.error)); ok();

    console.log(checks + '/' + checks + ' hub summary check groups passed. All writes used a disposable schema.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.$disconnect();
    if (created) { assert.match(schema, /^ses_hub_test_\d+_[a-f0-9]{8}$/); await admin.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE'); }
    await admin.$disconnect();
  }
}
