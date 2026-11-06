// Lab reports: tests ordered and done, turnaround, abnormal and positive results. The status rules, the two period anchors, amended results,
// imported documents, bad times, that every number can be traced to its records, who may open what, and the Excel workbooks.
// Disposable schema, real router, real tokens.
const assert = require('node:assert/strict'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'); require(root + '/node_modules/dotenv').config({ path: root + '/.env', quiet: true });
if (process.env.STOCK_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.STOCK_TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'lab-test-secret';
require(root + '/node_modules/ts-node').register({ project: root + '/tsconfig.json', transpileOnly: true });
const { PrismaClient } = require(root + '/node_modules/@prisma/client');
const appPrisma = require(root + '/src/lib/prisma.ts'); // modules read `.default` at call time, so swapping it points every loaded module at the test schema
main().catch(e => { console.error(e); process.exitCode = 1; });

async function main() {
  const schema = 'ses_lab_test_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  assert.match(schema, /^ses_lab_test_\d+_[a-f0-9]{8}$/);
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
    const boss = await mk('Synthetic admin', 'admin'), dr = await mk('Synthetic doctor', 'clinician'), nurse = await mk('Synthetic nurse', 'nurse'), tech = await mk('Synthetic lab tech', 'lab_tech'), desk = await mk('Synthetic reception', 'receptionist'), biller = await mk('Synthetic biller', 'billing');
    const patient = (firstName, lastName, nationalId = null) => db.patient.create({ data: { firstName, lastName, dateOfBirth: new Date(1990, 5, 15), gender: 'FEMALE', nationalId } });
    const P1 = await patient('Mary', 'Phiri', '123456/78/1'), P2 = await patient('John', 'Banda', '222222/22/2'), P3 = await patient('Peter', 'Zulu');

    let seq = 0;
    const comp = (componentName, value, status, units = null) => ({ componentName, value, units, status });
    const test = async ({ patient: p, name, specimen = null, orderedAt, status, sampleMin, resultMin, comps, catalogueId, type = 'single' }) => {
      const o = await db.investigationOrder.create({ data: { patientId: p.id, orderedById: dr.id, orderedAt } });
      const item = await db.investigationOrderItem.create({ data: { orderId: o.id, type, catalogueId: catalogueId ?? 'c' + (++seq), name, specimen, status, sampleReceivedAt: sampleMin == null ? null : plus(orderedAt, sampleMin) } });
      if (comps) await db.investigationResult.create({ data: { itemId: item.id, resultedById: tech.id, resultedAt: plus(orderedAt, resultMin), resultsJson: JSON.stringify(comps) } });
      return item;
    };
    // In the last 30 days: nine tests ordered. Resulted in the last 30 days: seven (the Culture was ordered before the period).
    await test({ patient: P1, name: 'Malaria RDT', specimen: 'Blood', orderedAt: ago(3), status: 'Resulted', sampleMin: 10, resultMin: 30, comps: [comp('Malaria RDT', 'Positive', 'Positive')] });
    await test({ patient: P2, name: 'Malaria RDT', specimen: 'Blood', orderedAt: ago(2), status: 'Resulted', resultMin: 25, comps: [comp('Malaria RDT', 'Negative', 'Negative')] });
    await test({ patient: P1, name: 'FBC', specimen: 'Blood', type: 'panel', orderedAt: ago(2), status: 'Resulted', sampleMin: 20, resultMin: 180, comps: [comp('Haemoglobin', '7.2', 'Low', 'g/dL'), comp('White cell count', '6', 'Normal', 'x10^9/L')] });
    await test({ patient: P3, name: 'FBC', specimen: 'Blood', type: 'panel', orderedAt: ago(1), status: 'Pending' });
    await test({ patient: P3, name: 'Urinalysis', specimen: 'Urine', orderedAt: ago(1), status: 'In Progress', sampleMin: 15 });
    await test({ patient: P2, name: 'Glucose', orderedAt: ago(6), status: 'Resulted', resultMin: 2880, comps: [comp('Glucose', '28', 'Critical', 'mmol/L')] });
    const creat = await test({ patient: P3, name: 'Creatinine', specimen: 'Serum', orderedAt: ago(4), status: 'Amended', resultMin: 90, comps: [comp('Creatinine', '80', 'Normal', 'umol/L')] });
    await db.investigationResult.create({ data: { itemId: creat.id, resultedById: tech.id, resultedAt: plus(ago(4), 90), amendedById: boss.id, amendedAt: ago(3), resultsJson: JSON.stringify([comp('Creatinine', '190', 'High', 'umol/L')]) } });   // a correction keeps the first result time
    await test({ patient: P1, name: 'Stool microscopy', specimen: 'Stool', orderedAt: ago(1), status: 'Resulted', resultMin: -60, comps: [comp('Stool microscopy', 'No ova', 'Normal')] });   // resulted an hour before it was ordered: a recording error
    await test({ patient: P2, name: 'Lipid profile', specimen: 'Serum', orderedAt: ago(1), status: 'Cancelled' });
    await test({ patient: P1, name: 'Haemoglobin', orderedAt: ago(1), status: 'Resulted', resultMin: 0, catalogueId: 'imported:haemoglobin', comps: [comp('Haemoglobin', '12', 'Normal')] });   // typed in from a scanned document
    await test({ patient: P2, name: 'Culture', specimen: 'Blood', orderedAt: ago(32), status: 'Resulted', resultMin: 4320, comps: [{ componentName: 'Culture', value: 'Growth' }] });   // ordered before the period, resulted in it, no flag chosen
    await test({ patient: P3, name: 'Old test', specimen: 'Blood', orderedAt: ago(60), status: 'Resulted', resultMin: 100, comps: [comp('Old test', '1', 'Normal')] });

    const express = require(root + '/node_modules/express'), jwt = require(root + '/node_modules/jsonwebtoken'), ExcelJS = require(root + '/node_modules/exceljs');
    const app = express(); app.use(express.json()); app.use('/api', require(root + '/src/routes/index').default);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const get = (p, user) => fetch(origin + '/api' + p, { headers: user ? { authorization: 'Bearer ' + jwt.sign({ userId: user.id }, process.env.JWT_SECRET) } : {} });
    const json = async (p, user) => { const res = await get(p, user); assert.equal(res.status, 200, p); return res.json(); };
    const range = `from=${dayText(ago(30))}&to=${dayText(now)}`, T = '/reports/lab/tests', TA = '/reports/lab/turnaround', AB = '/reports/lab/abnormal', enc = encodeURIComponent;

    // Tests ordered and done: nine ordered in the period, by test, with the statuses adding up. Imported documents are left out and said so.
    let rep = await json(`${T}?${range}`, desk);
    assert.equal(rep.title, 'Tests ordered and done by test'); assert.deepEqual(rep.columns.map(c => c.key), ['label', 'ordered', 'pending', 'inProgress', 'completed', 'other'], 'the Other status column appears because a test has one');
    assert.deepEqual(rep.rows.map(x => [x.label, x.ordered, x.pending, x.inProgress, x.completed, x.other]), [
      ['FBC', 2, 1, 0, 1, 0], ['Malaria RDT', 2, 0, 0, 2, 0], ['Creatinine', 1, 0, 0, 1, 0], ['Glucose', 1, 0, 0, 1, 0], ['Lipid profile', 1, 0, 0, 0, 1], ['Stool microscopy', 1, 0, 0, 1, 0], ['Urinalysis', 1, 0, 1, 0, 0],
    ], 'an amended result is completed; most ordered first, then by name');
    assert.deepEqual([rep.totals.ordered, rep.totals.pending, rep.totals.inProgress, rep.totals.completed, rep.totals.other], [9, 1, 1, 6, 1]);
    for (const row of rep.rows) assert.equal(row.ordered, row.pending + row.inProgress + row.completed + row.other);
    assert.deepEqual(rep.summary.map(s => [s.label, s.value]), [['Tests ordered', 9], ['Completed', 6], ['Waiting (pending or in progress)', 2], ['Completed share (%)', 67], ['Imported documents left out', 1]]);
    assert.ok(!rep.rows.some(x => x.label === 'Haemoglobin' || x.label === 'Culture' || x.label === 'Old test'), 'imported, ordered before the period and ordered long ago');
    const spec = await json(`${T}?${range}&groupBy=specimen`, desk);
    assert.equal(spec.title, 'Tests ordered and done by specimen'); assert.deepEqual(spec.rows.map(x => [x.label, x.ordered]), [['Blood', 4], ['Serum', 2], ['Not recorded', 1], ['Stool', 1], ['Urine', 1]]); assert.equal(spec.totals.ordered, 9);
    assert.equal((await json(`${T}?${range}&specimen=Blood`, desk)).totals.ordered, 4); assert.equal((await json(`${T}?${range}&test=FBC&specimen=Urine`, desk)).totals.ordered, 0);
    const allTime = await json(T, desk); assert.equal(allTime.totals.ordered, 11, 'all time adds the Culture and the old test'); assert.equal(allTime.period, 'All time'); ok();

    // Every number can be traced: each cell equals the rows of its line list.
    const tl = async q => (await json(`${T}/lines?${range}${q}`, dr)).rows;
    for (const row of rep.rows) {
      assert.equal((await tl(`&test=${enc(row.label)}`)).length, row.ordered, row.label);
      for (const [status, key] of [['pending', 'pending'], ['inProgress', 'inProgress'], ['completed', 'completed'], ['other', 'other']]) assert.equal((await tl(`&test=${enc(row.label)}&status=${status}`)).length, row[key], row.label + ' ' + status);
    }
    for (const row of spec.rows) assert.equal((await tl(`&specimen=${enc(row.label)}`)).length, row.ordered, row.label);
    assert.equal((await tl('')).length, 9); assert.equal((await tl('&status=completed')).length, 6); ok();

    // The line list: newest first, names hidden, NRC masked, status in words.
    let list = await json(`${T}/lines?${range}`, dr);
    assert.equal(list.title, 'Tests ordered line list'); assert.deepEqual(list.columns.map(c => c.key), ['orderedAt', 'patientCode', 'nrc', 'test', 'specimen', 'status', 'sampleAt', 'resultedAt', 'orderedBy', 'resultedBy']); assert.equal(list.columns.find(c => c.key === 'nrc').header, 'NRC (masked)');
    assert.deepEqual(list.rows.map(x => Date.parse(x.orderedAt)), list.rows.map(x => Date.parse(x.orderedAt)).sort((a, b) => b - a));
    const malaria = list.rows.find(x => x.test === 'Malaria RDT' && x.nrc === '••••••/••/1');
    assert.deepEqual([malaria.patientCode, malaria.specimen, malaria.status, malaria.orderedBy, malaria.resultedBy, malaria.name], ['SES-' + P1.id.replace(/-/g, '').slice(0, 8).toUpperCase(), 'Blood', 'Completed', 'Synthetic doctor', 'Synthetic lab tech', '']);
    assert.deepEqual(list.rows.map(x => x.status).sort(), ['Completed', 'Completed', 'Completed', 'Completed', 'Completed', 'Completed', 'In progress', 'Other', 'Pending']);
    assert.ok(list.rows.every(x => x.name === '' && !/[0-9]{3}/.test(x.nrc)), 'no names and no NRC digits'); assert.equal(list.rows.find(x => x.test === 'Creatinine').nrc, '', 'no NRC on record is shown as blank');
    list = await json(`${T}/lines?${range}&names=1`, dr);
    assert.equal(list.rows.find(x => x.test === 'Glucose').name, 'John Banda'); assert.equal(list.rows.find(x => x.test === 'Glucose').nrc, '222222/22/2'); assert.equal(list.columns.find(c => c.key === 'name').header, 'Name'); ok();

    // Turnaround: counted by the day the result was first entered. A correction does not change it; an imported document and a result before its order are left out.
    rep = await json(`${TA}?${range}`, desk);
    assert.equal(rep.title, 'Lab turnaround by test');
    assert.deepEqual(rep.rows.map(x => [x.label, x.resulted, x.medianHours, x.longestHours, x.withSample, x.medianSampleHours]), [
      ['Culture', 1, 72, 72, 0, null], ['Glucose', 1, 48, 48, 0, null], ['FBC', 1, 3, 3, 1, 2.7], ['Creatinine', 1, 1.5, 1.5, 0, null], ['Malaria RDT', 2, 0.5, 0.5, 1, 0.3],
    ], 'slowest first; the Culture counts because its result is in the period even though the order is not');
    assert.deepEqual([rep.totals.resulted, rep.totals.medianMin, rep.totals.longestMin, rep.totals.withSample, rep.totals.medianSampleMin], [6, 135, 4320, 2, 90]);
    assert.deepEqual(rep.summary.map(s => [s.label, s.value]), [['Tests resulted', 6], ['Median, order to result', '2 h 15 min'], ['Longest, order to result', '3 days'], ['Median, sample to result', '1 h 30 min'], ['Left out: result time before order time', 1], ['Imported documents left out', 1]]);
    const ta = async q => (await json(`${TA}/lines?${range}${q}`, dr)).rows;
    for (const row of rep.rows) assert.equal((await ta(`&test=${enc(row.label)}`)).length, row.resulted, row.label);
    assert.equal((await ta('')).length, 6); assert.equal((await json(`${TA}?${range}&specimen=Blood`, desk)).totals.resulted, 4);
    const slow = await json(`${TA}/lines?${range}`, dr);
    assert.deepEqual(slow.rows.map(x => [x.test, x.hours, x.time]), [['Culture', 72, '3 days'], ['Glucose', 48, '2 days'], ['FBC', 3, '3 h'], ['Creatinine', 1.5, '1 h 30 min'], ['Malaria RDT', 0.5, '30 min'], ['Malaria RDT', 0.4, '25 min']]);
    assert.ok(slow.rows.every(x => x.name === '')); ok();

    // Abnormal and positive: the worst flag among a result's components, using the current (corrected) result.
    rep = await json(`${AB}?${range}`, dr);
    assert.equal(rep.title, 'Abnormal and positive results by test'); assert.deepEqual(rep.columns.map(c => c.key), ['label', 'resulted', 'normal', 'abnormal', 'positive', 'critical', 'none']);
    assert.deepEqual(rep.rows.map(x => [x.label, x.resulted, x.normal, x.abnormal, x.positive, x.critical, x.none]), [
      ['Malaria RDT', 2, 1, 0, 1, 0, 0], ['Creatinine', 1, 0, 1, 0, 0, 0], ['FBC', 1, 0, 1, 0, 0, 0], ['Glucose', 1, 0, 0, 0, 1, 0], ['Culture', 1, 0, 0, 0, 0, 1], ['Stool microscopy', 1, 1, 0, 0, 0, 0],
    ], 'Creatinine uses the corrected value; the Culture had no flag chosen');
    for (const row of rep.rows) assert.equal(row.resulted, row.normal + row.abnormal + row.positive + row.critical + row.none);
    assert.deepEqual([rep.totals.resulted, rep.totals.normal, rep.totals.abnormal, rep.totals.positive, rep.totals.critical, rep.totals.none], [7, 2, 2, 1, 1, 1]);
    assert.deepEqual(rep.summary.map(s => [s.label, s.value]), [['Tests resulted', 7], ['Flagged (abnormal, positive or critical)', 4], ['Critical', 1], ['Flagged share (%)', 57], ['Imported documents left out', 1]]);
    const ab = async q => (await json(`${AB}/lines?${range}${q}`, dr)).rows;
    for (const row of rep.rows) for (const flag of ['abnormal', 'positive', 'critical', 'normal', 'none']) assert.equal((await ab(`&test=${enc(row.label)}&flag=${flag}`)).length, row[flag], row.label + ' ' + flag);
    assert.equal((await ab('&flag=all')).length, 7, 'every resulted test'); for (const row of rep.rows) assert.equal((await ab(`&test=${enc(row.label)}&flag=all`)).length, row.resulted, row.label);
    assert.equal((await ab('')).length, 4, 'with no flag chosen the list is the flagged results'); assert.equal((await ab('&flag=flagged&test=Malaria%20RDT')).length, 1);
    const flagged = await ab('');
    assert.deepEqual(flagged.map(x => [x.test, x.flag]).sort((a, b) => a[0].localeCompare(b[0])), [['Creatinine', 'Abnormal'], ['FBC', 'Abnormal'], ['Glucose', 'Critical'], ['Malaria RDT', 'Positive']]);
    assert.equal(flagged.find(x => x.test === 'FBC').detail, 'Haemoglobin 7.2 g/dL (Low)', 'only the flagged component is named'); assert.equal(flagged.find(x => x.test === 'Creatinine').detail, 'Creatinine 190 umol/L (High)');
    assert.equal(flagged.find(x => x.test === 'Glucose').detail, 'Glucose 28 mmol/L (Critical)'); assert.ok(flagged.every(x => x.name === ''));
    assert.deepEqual(flagged.map(x => Date.parse(x.resultedAt)), flagged.map(x => Date.parse(x.resultedAt)).sort((a, b) => b - a)); ok();

    // Who may open what: counts of tests and times are for the Reports roles, the patients behind them and abnormal results are clinical.
    for (const [url, who, status] of [
      [`${T}?${range}`, desk, 200], [`${T}?${range}`, biller, 403], [`${T}?${range}`, undefined, 401], [`${TA}?${range}`, desk, 200], [`${TA}?${range}`, biller, 403],
      [`${T}/lines?${range}`, desk, 403], [`${TA}/lines?${range}`, desk, 403], [`${T}/lines?${range}&names=1`, desk, 403], [`${T}/lines?${range}&names=1`, nurse, 200], [`${T}/lines?${range}&names=1`, tech, 200],
      [`${AB}?${range}`, desk, 403], [`${AB}?${range}`, biller, 403], [`${AB}?${range}`, undefined, 401], [`${AB}?${range}`, nurse, 200], [`${AB}?${range}`, tech, 200], [`${AB}/lines?${range}`, desk, 403], [`${AB}/lines?${range}`, boss, 200],
    ]) assert.equal((await get(url, who)).status, status, url + ' ' + (who ? who.name : 'no login'));
    ok();

    // A bad request is a readable 400 on every endpoint.
    for (const bad of ['groupBy=year', 'status=done', 'flag=bad', 'from=2026-03-01', 'from=2026-03-02&to=2026-03-01']) {
      for (const url of [`${T}?${bad}`, `${T}/lines?${bad}`, `${TA}?${bad}`, `${AB}?${bad}`, `${AB}/lines?${bad}`]) { const res = await get(url, dr); assert.equal(res.status, 400, url); assert.ok((await res.json()).error.length > 10); }
    }
    ok();

    // Excel: counts, line list and definitions, logged, and the roles' limits.
    const sheets = async (url, user) => { const res = await get(url, user); assert.equal(res.status, 200, url); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer())); return wb; };
    assert.equal(await db.reportExportLog.count(), 0);
    let wb = await sheets(`${T}?${range}&format=xlsx`, desk); assert.deepEqual(wb.worksheets.map(w => w.name), ['Summary', 'Definitions'], 'reception has the counts only');
    wb = await sheets(`${AB}?${range}&format=xlsx`, dr); assert.deepEqual(wb.worksheets.map(w => w.name), ['Summary', 'Line list', 'Definitions']);
    const header = wb.getWorksheet('Line list').getRow(6).values.slice(1); assert.ok(header.includes('NRC (masked)') && header.includes('Flagged results') && !header.includes('Name'));
    assert.match(JSON.stringify(wb.getWorksheet('Definitions').getSheetValues()), /Rejected samples are not recorded/); assert.match(JSON.stringify(wb.getWorksheet('Definitions').getSheetValues()), /Imported documents are left out/);
    wb = await sheets(`${TA}/lines?${range}&format=xlsx`, dr); assert.deepEqual(wb.worksheets.map(w => w.name), ['Line list', 'Definitions']);
    const logged = await db.reportExportLog.findMany({ orderBy: { at: 'asc' } });
    assert.deepEqual(logged.map(x => [x.area, x.kind, x.rowCount]), [['lab', 'AGGREGATE', 7], ['lab', 'LINE_LIST', 4], ['lab', 'LINE_LIST', 6]]); assert.equal(logged[1].userId, dr.id);
    assert.equal((await get(`${AB}?${range}&format=xlsx`, desk)).status, 403); assert.equal((await get(`${TA}/lines?${range}&format=xlsx`, desk)).status, 403); assert.equal((await get(`${T}?${range}&format=xlsx`, biller)).status, 403); ok();

    // The registry tells the screen what this person can do.
    const lab = async user => (await json('/reports/registry', user)).reports.filter(x => x.area === 'lab').map(x => [x.name, x.lineList, x.canSeeNames, x.canExport]);
    assert.deepEqual(await lab(desk), [['tests', false, false, true], ['turnaround', false, false, true]], 'reception sees no abnormal results');
    assert.deepEqual((await lab(dr)).sort(), [['abnormal', true, true, true], ['tests', true, true, true], ['turnaround', true, true, true]]);
    assert.deepEqual(await lab(biller), []); ok();

    console.log(checks + '/' + checks + ' lab report check groups passed. All writes used a disposable schema.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.$disconnect();
    if (created) { assert.match(schema, /^ses_lab_test_\d+_[a-f0-9]{8}$/); await admin.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE'); }
    await admin.$disconnect();
  }
}
