// Pharmacy reports: medicines dispensed (by item and by brand) and prescriptions against what was dispensed. The type and status rules, brands from stock
// batches, units that are never added together, that every number can be traced to its records, who may open what, and the Excel workbooks.
// Disposable schema, real router, real tokens.
const assert = require('node:assert/strict'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'); require(root + '/node_modules/dotenv').config({ path: root + '/.env', quiet: true });
if (process.env.STOCK_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.STOCK_TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'pharmacy-test-secret';
require(root + '/node_modules/ts-node').register({ project: root + '/tsconfig.json', transpileOnly: true });
const { PrismaClient } = require(root + '/node_modules/@prisma/client');
const appPrisma = require(root + '/src/lib/prisma.ts'); // modules read `.default` at call time, so swapping it points every loaded module at the test schema
main().catch(e => { console.error(e); process.exitCode = 1; });

async function main() {
  const schema = 'ses_pharmacy_test_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  assert.match(schema, /^ses_pharmacy_test_\d+_[a-f0-9]{8}$/);
  const url = new URL(process.env.DATABASE_URL); url.searchParams.set('schema', schema);
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  let db, server, created = false, checks = 0; const ok = () => { checks++; };
  try {
    await admin.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"'); created = true;
    const r = spawnSync(process.execPath, [root + '/node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: root, env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8', windowsHide: true });
    if (r.status) throw Error(r.stdout + '\n' + r.stderr);
    db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    Object.defineProperty(appPrisma, 'default', { value: db, configurable: true });

    const now = new Date(), ago = (days, minutes = 0) => new Date(now.getTime() - days * 86400000 - minutes * 60000);
    const dayText = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const mk = (name, role) => db.user.create({ data: { name, email: name.toLowerCase().replace(/\s/g, '.') + '@example.test', password: 'x', role, status: 'active' } });
    const boss = await mk('Synthetic admin', 'admin'), dr = await mk('Synthetic doctor', 'clinician'), nurse = await mk('Synthetic nurse', 'nurse'), pharm = await mk('Synthetic pharmacist', 'pharmacist'), desk = await mk('Synthetic reception', 'receptionist'), biller = await mk('Synthetic biller', 'billing');
    const patient = (firstName, lastName, nationalId = null) => db.patient.create({ data: { firstName, lastName, dateOfBirth: new Date(1990, 5, 15), gender: 'FEMALE', nationalId } });
    const P1 = await patient('Mary', 'Phiri', '123456/78/1'), P2 = await patient('John', 'Banda', '222222/22/2'), P3 = await patient('Peter', 'Zulu');

    // Stock: two brands of amoxicillin, so a dispensing can be taken from both.
    await db.priceListItem.create({ data: { itemType: 'DRUG', catalogueRef: 'AMX', name: 'Amoxicillin', unit: 'per capsule', unitPrice: 1 } });
    const op = await db.stockOperation.create({ data: { actorId: pharm.id, key: crypto.randomUUID(), kind: 'FIXTURE', requestHash: 'fixture' } });
    const batchOf = async (brand) => {
      const product = await db.pharmacyProduct.create({ data: { catalogueRef: 'AMX', brand, brandKey: brand.toLowerCase(), baseUnit: 'capsule', packSize: 100, packLabel: 'Box of 100', createdById: pharm.id } });
      return db.stockBatch.create({ data: { productId: product.id, lotNumber: 'L-' + brand, expiryDate: new Date(now.getFullYear() + 2, 0, 1), createdById: pharm.id } });
    };
    const amoxil = await batchOf('Amoxil'), generic = await batchOf('Generic Pharma');
    // The stock ledger refuses an issue with nothing received; these rows are fixtures for the report, so the ledger's own triggers are off for them (in this disposable schema only).
    const allocate = async (dispensing, batch, quantity) => {
      await db.$executeRawUnsafe('ALTER TABLE "' + schema + '"."StockMovement" DISABLE TRIGGER USER');
      const movement = await db.stockMovement.create({ data: { operationId: op.id, batchId: batch.id, type: 'ISSUED', quantity: -quantity, baseUnit: 'capsule', reference: 'DISPENSE:' + dispensing.id, actorId: pharm.id } });
      return db.stockDispensingAllocation.create({ data: { dispensingId: dispensing.id, batchId: batch.id, movementId: movement.id, quantity, baseUnit: 'capsule' } });
    };

    const encounterFor = {}; for (const p of [P1, P2, P3]) encounterFor[p.id] = await db.encounter.create({ data: { patientId: p.id, clinicianId: dr.id } });
    const rx = async (p, name, catalogueCode, createdAt, flags = {}) => {
      const medication = await db.medication.create({ data: { patientId: p.id, name, catalogueCode, dosage: '500mg', frequency: 'TDS', duration: '7 days', quantity: 21, quantityUnit: 'capsule', startDate: createdAt } });
      return db.prescription.create({ data: { encounterId: encounterFor[p.id].id, medicationId: medication.id, createdAt, ...flags } });
    };
    const dispense = (p, prescription, dispensedDrug, catalogueCode, quantity, quantityUnit, dispensedAt, type) => db.dispensing.create({
      data: { patientId: p.id, prescriptionId: prescription?.id ?? null, type, dispensedDrug, dispensedDose: '500mg', catalogueCode, quantity, quantityUnit, dispensedBy: pharm.id, dispensedAt },
    });

    // In the last 30 days: six prescriptions and five dispensings.
    const rx1 = await rx(P1, 'Amoxicillin', 'AMX', ago(5), { dispensed: true, dispensedAt: ago(5) });
    const rx2 = await rx(P2, 'Amoxicillin', 'AMX', ago(4), { dispensed: true, dispensedAt: ago(4), notAvailable: true });   // marked unavailable earlier, then dispensed: it was dispensed
    await rx(P3, 'Amoxicillin', 'AMX', ago(3), { notAvailable: true });
    await rx(P1, 'Paracetamol', 'PCM', ago(2));
    const rx5 = await rx(P2, 'Paracetamol', 'PCM', ago(2), { dispensed: true, dispensedAt: ago(2) });
    await rx(P3, 'Herbal tea', null, ago(1));
    const rxOld = await rx(P3, 'Amoxicillin', 'AMX', ago(60), { dispensed: true, dispensedAt: ago(59) });
    const d1 = await dispense(P1, rx1, 'Amoxicillin', 'AMX', 28, 'capsule', ago(5), 'prescription'); await allocate(d1, amoxil, 28);
    const d2 = await dispense(P2, rx2, 'Amoxicillin', 'AMX', 21, 'capsule', ago(4), 'prescription'); await allocate(d2, amoxil, 14); await allocate(d2, generic, 7);   // taken from two batches of two brands
    await dispense(P2, rx5, 'Ibuprofen', 'IBU', 10, 'tablet', ago(2), 'substitution');
    await dispense(P3, null, 'Paracetamol', 'PCM', 20, 'tablet', ago(1), 'direct');
    await dispense(P1, null, 'Paracetamol', 'PCM', null, 'tablet', ago(1, 30), 'direct');   // an older record with no quantity
    await dispense(P3, rxOld, 'Amoxicillin', 'AMX', 21, 'capsule', ago(59), 'prescription');

    const express = require(root + '/node_modules/express'), jwt = require(root + '/node_modules/jsonwebtoken'), ExcelJS = require(root + '/node_modules/exceljs');
    const app = express(); app.use(express.json()); app.use('/api', require(root + '/src/routes/index').default);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const get = (p, user) => fetch(origin + '/api' + p, { headers: user ? { authorization: 'Bearer ' + jwt.sign({ userId: user.id }, process.env.JWT_SECRET) } : {} });
    const json = async (p, user) => { const res = await get(p, user); assert.equal(res.status, 200, p); return res.json(); };
    const range = `from=${dayText(ago(30))}&to=${dayText(now)}`, D = '/reports/pharmacy/dispensed', RX = '/reports/pharmacy/prescriptions', enc = encodeURIComponent;

    // Dispensed by item: units are never added together, and the three types add up.
    let rep = await json(`${D}?${range}`, desk);
    assert.equal(rep.title, 'Medicines dispensed by item'); assert.deepEqual(rep.columns.map(c => c.key), ['label', 'unit', 'dispensings', 'patients', 'quantity', 'prescription', 'substitution', 'direct']);
    assert.deepEqual(rep.rows.map(x => [x.label, x.unit, x.dispensings, x.patients, x.quantity, x.prescription, x.substitution, x.direct]), [
      ['Amoxicillin', 'capsule', 2, 2, 49, 2, 0, 0], ['Paracetamol', 'tablet', 2, 2, 20, 0, 0, 2], ['Ibuprofen', 'tablet', 1, 1, 10, 0, 1, 0],
    ], 'most dispensed first; a record with no quantity is counted, not added');
    for (const row of rep.rows) assert.equal(row.dispensings, row.prescription + row.substitution + row.direct);
    assert.deepEqual([rep.totals.dispensings, rep.totals.patients, rep.totals.prescription, rep.totals.substitution, rep.totals.direct], [5, 3, 2, 1, 2]);
    assert.deepEqual(rep.summary.map(s => [s.label, s.value]), [['Dispensings', 5], ['Patients', 3], ['Items', 3], ['Substituted', 1], ['Dispensings with no quantity recorded', 1]]);
    assert.equal((await json(`${D}?${range}&type=substitution`, desk)).totals.dispensings, 1); assert.equal((await json(`${D}?${range}&type=direct`, desk)).totals.dispensings, 2);
    const allTime = await json(D, desk); assert.equal(allTime.totals.dispensings, 6, 'all time adds the old dispensing'); assert.equal(allTime.period, 'All time');
    assert.deepEqual((await json(`${D}?from=${dayText(ago(0))}&to=${dayText(ago(0))}`, desk)).rows, [], 'an empty day has no rows'); ok();

    // Dispensed by brand: from the stock batch. A dispensing from two brands is under each; older ones have no brand.
    const brand = await json(`${D}?${range}&groupBy=brand`, desk);
    assert.equal(brand.title, 'Medicines dispensed by brand'); assert.deepEqual(brand.columns.map(c => c.key), ['label', 'dispensings', 'patients', 'items']);
    assert.deepEqual(brand.rows.map(x => [x.label, x.dispensings, x.patients, x.items]), [['Not recorded', 3, 3, 2], ['Amoxil', 2, 2, 1], ['Generic Pharma', 1, 1, 1]]);
    assert.equal(brand.totals.dispensings, 5, 'the total counts each dispensing once, so the brand rows add up to more'); assert.equal(brand.totals.items, 3);
    const one = await json(`${D}?${range}&groupBy=brand&item=${enc('AMX|capsule')}`, desk);
    assert.deepEqual(one.columns.map(c => c.key), ['label', 'dispensings', 'patients', 'items', 'quantity'], 'a quantity is shown once there is one item');
    assert.deepEqual(one.rows.map(x => [x.label, x.dispensings, x.quantity]), [['Amoxil', 2, 42], ['Generic Pharma', 1, 7]], 'the batch quantities, not the whole dispensing');
    assert.equal(one.period, `${one.period.split(' · ')[0]} · one item`); ok();

    // Every number can be traced: each row equals the rows of its line list.
    const dl = async q => (await json(`${D}/lines?${range}${q}`, dr)).rows;
    for (const row of rep.rows) { assert.equal((await dl(`&item=${enc(row.key)}`)).length, row.dispensings, row.label); for (const t of ['prescription', 'substitution', 'direct']) assert.equal((await dl(`&item=${enc(row.key)}&type=${t}`)).length, row[t], row.label + ' ' + t); }
    for (const row of brand.rows) assert.equal((await dl(`&brand=${enc(row.label)}`)).length, row.dispensings, row.label);
    assert.equal((await dl('')).length, 5); assert.equal((await dl(`&brand=${enc('Generic Pharma')}&item=${enc('AMX|capsule')}`)).length, 1); ok();

    // The line list: newest first, names hidden, NRC masked, quantity with its unit, the prescribed item for a substitution, brands from the batches.
    let list = await json(`${D}/lines?${range}`, dr);
    assert.equal(list.title, 'Medicines dispensed line list'); assert.deepEqual(list.columns.map(c => c.key), ['at', 'patientCode', 'nrc', 'item', 'dose', 'quantity', 'type', 'prescribed', 'brand', 'by', 'collectedAt']); assert.equal(list.columns.find(c => c.key === 'nrc').header, 'NRC (masked)');
    assert.deepEqual(list.rows.map(x => Date.parse(x.at)), list.rows.map(x => Date.parse(x.at)).sort((a, b) => b - a));
    const two = list.rows.find(x => x.quantity === '21 capsule'), sub = list.rows.find(x => x.item === 'Ibuprofen'), none = list.rows.find(x => x.quantity === '');
    assert.deepEqual([two.brand, two.type, two.nrc, two.by, two.name], ['Amoxil, Generic Pharma', 'On prescription', '••••••/••/2', 'Synthetic pharmacist', '']);
    assert.deepEqual([sub.type, sub.prescribed, sub.brand, sub.quantity], ['Substituted', 'Paracetamol', 'Not recorded', '10 tablet']); assert.equal(none.item, 'Paracetamol', 'a record with no quantity shows blank');
    assert.ok(list.rows.every(x => x.name === '' && !/[0-9]{3}/.test(x.nrc)), 'no names and no NRC digits'); assert.equal(list.rows.find(x => x.nrc === '').item, 'Paracetamol', 'no NRC on record is blank');
    list = await json(`${D}/lines?${range}&names=1`, pharm); assert.equal(list.rows.find(x => x.item === 'Ibuprofen').name, 'John Banda'); assert.equal(list.rows.find(x => x.item === 'Ibuprofen').nrc, '222222/22/2'); ok();

    // Prescriptions against dispensed: dispensed wins over a stale not-available flag; the gaps come first.
    rep = await json(`${RX}?${range}`, desk);
    assert.equal(rep.title, 'Prescriptions and dispensed by item'); assert.deepEqual(rep.columns.map(c => c.key), ['label', 'written', 'dispensed', 'notAvailable', 'waiting']);
    assert.deepEqual(rep.rows.map(x => [x.label, x.written, x.dispensed, x.notAvailable, x.waiting]), [['Amoxicillin', 3, 2, 1, 0], ['Paracetamol', 2, 1, 0, 1], ['Herbal tea', 1, 0, 0, 1]], 'a medicine typed by hand is its own item');
    for (const row of rep.rows) assert.equal(row.written, row.dispensed + row.notAvailable + row.waiting);
    assert.deepEqual([rep.totals.written, rep.totals.dispensed, rep.totals.notAvailable, rep.totals.waiting], [6, 3, 1, 2]);
    assert.deepEqual(rep.summary.map(s => [s.label, s.value]), [['Prescriptions written', 6], ['Dispensed', 3], ['Not available', 1], ['Waiting', 2], ['Dispensed share (%)', 50]]);
    assert.equal((await json(RX, desk)).totals.written, 7, 'all time adds the old prescription'); assert.equal((await json(`${RX}?${range}&item=PCM`, desk)).totals.written, 2); ok();
    const rl = async q => (await json(`${RX}/lines?${range}${q}`, dr)).rows;
    for (const row of rep.rows) { assert.equal((await rl(`&item=${enc(row.key)}`)).length, row.written, row.label); for (const s of ['dispensed', 'notAvailable', 'waiting']) assert.equal((await rl(`&item=${enc(row.key)}&status=${s}`)).length, row[s], row.label + ' ' + s); }
    assert.equal((await rl('')).length, 6); assert.equal((await rl('&status=waiting')).length, 2); ok();
    list = await json(`${RX}/lines?${range}`, dr);
    assert.deepEqual(list.columns.map(c => c.key), ['at', 'patientCode', 'nrc', 'item', 'dose', 'frequency', 'duration', 'quantity', 'by', 'status', 'dispensedAt', 'dispensedBy', 'dispensedItem']);
    const unavailable = list.rows.find(x => x.status === 'Not available'), swapped = list.rows.find(x => x.dispensedItem), stale = list.rows.filter(x => x.status === 'Dispensed');
    assert.deepEqual([unavailable.item, unavailable.dispensedAt, unavailable.dispensedBy, unavailable.by, unavailable.quantity, unavailable.dose], ['Amoxicillin', null, '', 'Synthetic doctor', '21 capsule', '500mg']);
    assert.deepEqual([swapped.item, swapped.dispensedItem, swapped.dispensedBy], ['Paracetamol', 'Ibuprofen', 'Synthetic pharmacist']); assert.equal(stale.length, 3);
    assert.ok(list.rows.every(x => x.name === '')); ok();

    // Who may open what.
    for (const [url, who, status] of [
      [`${D}?${range}`, desk, 200], [`${D}?${range}`, biller, 403], [`${D}?${range}`, undefined, 401], [`${RX}?${range}`, desk, 200], [`${RX}?${range}`, biller, 403], [`${RX}?${range}`, undefined, 401],
      [`${D}/lines?${range}`, desk, 403], [`${RX}/lines?${range}`, desk, 403], [`${D}/lines?${range}`, biller, 403], [`${D}/lines?${range}&names=1`, desk, 403],
      [`${D}/lines?${range}`, nurse, 200], [`${D}/lines?${range}&names=1`, pharm, 200], [`${RX}/lines?${range}&names=1`, boss, 200], [`${D}/lines?${range}`, undefined, 401],
    ]) assert.equal((await get(url, who)).status, status, url + ' ' + (who ? who.name : 'no login'));
    ok();

    // A bad request is a readable 400 on every endpoint.
    for (const bad of ['groupBy=year', 'type=maybe', 'status=gone', 'from=2026-03-01', 'from=2026-03-02&to=2026-03-01']) {
      for (const url of [`${D}?${bad}`, `${D}/lines?${bad}`, `${RX}?${bad}`, `${RX}/lines?${bad}`]) {
        const res = await get(url, dr);
        if ((url.startsWith(D) && bad === 'status=gone') || (url.startsWith(RX) && (bad === 'groupBy=year' || bad === 'type=maybe'))) { assert.equal(res.status, 200, url + ' ignores a filter it does not have'); continue; }
        assert.equal(res.status, 400, url); assert.ok((await res.json()).error.length > 10);
      }
    }
    ok();

    // Excel: counts, line list and definitions, logged, and the roles' limits.
    const sheets = async (url, user) => { const res = await get(url, user); assert.equal(res.status, 200, url); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer())); return wb; };
    assert.equal(await db.reportExportLog.count(), 0);
    let wb = await sheets(`${D}?${range}&format=xlsx`, desk); assert.deepEqual(wb.worksheets.map(w => w.name), ['Summary', 'Definitions'], 'reception has the counts only');
    wb = await sheets(`${RX}?${range}&format=xlsx`, dr); assert.deepEqual(wb.worksheets.map(w => w.name), ['Summary', 'Line list', 'Definitions']);
    const header = wb.getWorksheet('Line list').getRow(6).values.slice(1); assert.ok(header.includes('NRC (masked)') && header.includes('Dispensed as') && !header.includes('Name'));
    assert.match(JSON.stringify(wb.getWorksheet('Definitions').getSheetValues()), /Waiting includes prescriptions that were never collected/);
    wb = await sheets(`${D}/lines?${range}&format=xlsx&brand=${enc('Generic Pharma')}`, pharm); assert.deepEqual(wb.worksheets.map(w => w.name), ['Line list', 'Definitions']);
    const logged = await db.reportExportLog.findMany({ orderBy: { at: 'asc' } });
    assert.deepEqual(logged.map(x => [x.area, x.kind, x.rowCount]), [['pharmacy', 'AGGREGATE', 3], ['pharmacy', 'LINE_LIST', 6], ['pharmacy', 'LINE_LIST', 1]]); assert.equal(logged[2].userId, pharm.id); assert.equal(logged[2].filters.brand, 'Generic Pharma');
    assert.equal((await get(`${D}/lines?${range}&format=xlsx`, desk)).status, 403); assert.equal((await get(`${RX}?${range}&format=xlsx`, biller)).status, 403); ok();

    // The registry tells the screen what this person can do.
    const area = async user => (await json('/reports/registry', user)).reports.filter(x => x.area === 'pharmacy').map(x => [x.name, x.lineList, x.canSeeNames, x.canExport]);
    assert.deepEqual(await area(desk), [['dispensed', false, false, true], ['prescriptions', false, false, true]]);
    assert.deepEqual(await area(pharm), [['dispensed', true, true, true], ['prescriptions', true, true, true]]); assert.deepEqual(await area(biller), []); ok();

    console.log(checks + '/' + checks + ' pharmacy report check groups passed. All writes used a disposable schema.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.$disconnect();
    if (created) { assert.match(schema, /^ses_pharmacy_test_\d+_[a-f0-9]{8}$/); await admin.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE'); }
    await admin.$disconnect();
  }
}
