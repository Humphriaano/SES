// HIA2 return, section 6.1 OPD: the form's cells and codes, first attendances against revisits, the age groups and sexes, that the return equals the
// Attendance report, that every cell equals the attendances behind it, the month rules, who may open what, and the Excel workbook.
// Disposable schema, real router, real tokens.
const assert = require('node:assert/strict'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'); require(root + '/node_modules/dotenv').config({ path: root + '/.env', quiet: true });
if (process.env.STOCK_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.STOCK_TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'hia2-test-secret';
require(root + '/node_modules/ts-node').register({ project: root + '/tsconfig.json', transpileOnly: true });
const { PrismaClient } = require(root + '/node_modules/@prisma/client');
const appPrisma = require(root + '/src/lib/prisma.ts'); // modules read `.default` at call time, so swapping it points every loaded module at the test schema
main().catch(e => { console.error(e); process.exitCode = 1; });

async function main() {
  const schema = 'ses_hia2_test_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  assert.match(schema, /^ses_hia2_test_\d+_[a-f0-9]{8}$/);
  const url = new URL(process.env.DATABASE_URL); url.searchParams.set('schema', schema);
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  let db, server, created = false, checks = 0; const ok = () => { checks++; };
  try {
    await admin.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"'); created = true;
    const r = spawnSync(process.execPath, [root + '/node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: root, env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8', windowsHide: true });
    if (r.status) throw Error(r.stdout + '\n' + r.stderr);
    db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    Object.defineProperty(appPrisma, 'default', { value: db, configurable: true });

    // The return is for last month, so the dates are fixed. Dates of birth leave three months of margin, so no birthday falls inside the month.
    const now = new Date(), y = new Date(now.getFullYear(), now.getMonth() - 1, 1).getFullYear(), m = new Date(now.getFullYear(), now.getMonth() - 1, 1).getMonth();
    const monthText = `${y}-${String(m + 1).padStart(2, '0')}`, day = (d, h = 10) => new Date(y, m, d, h);
    const dob = (age, extraMonths = 0) => new Date(y - age, m - 3 - extraMonths, 15);
    const mk = (name, role) => db.user.create({ data: { name, email: name.toLowerCase().replace(/\s/g, '.') + '@example.test', password: 'x', role, status: 'active' } });
    const boss = await mk('Synthetic admin', 'admin'), dr = await mk('Synthetic doctor', 'clinician'), nurse = await mk('Synthetic nurse', 'nurse'), desk = await mk('Synthetic reception', 'receptionist'), biller = await mk('Synthetic biller', 'billing');
    const patient = (firstName, lastName, dateOfBirth, gender, nationalId = null) => db.patient.create({ data: { firstName, lastName, dateOfBirth, gender, nationalId } });
    const A = await patient('Baby', 'Mwale', dob(0, 2), 'MALE'), B = await patient('Tina', 'Zulu', dob(3), 'FEMALE'), C = await patient('Chola', 'Banda', dob(10), 'MALE');
    const D = await patient('Mary', 'Phiri', dob(30), 'FEMALE', '123456/78/1'), E = await patient('Joseph', 'Lungu', dob(30), 'MALE'), F = await patient('Alex', 'Tembo', dob(20), 'OTHER'), G = await patient('Grace', 'Tembo', dob(70), 'FEMALE'), H = await patient('Henry', 'Sata', dob(20), 'MALE');
    const room = await db.facilityRoom.create({ data: { name: 'Consultation Room 1', tag: 'CR1' } });
    let n = 0; const visit = (p, checkedInAt, status = 'Done') => db.queueEntry.create({ data: { queueNumber: ++n, patientId: p.id, patientName: p.firstName, roomId: room.id, status, checkedInAt } });
    await visit(A, day(2)); await visit(B, day(3)); await visit(B, day(15)); await visit(C, day(4)); await visit(D, day(5)); await visit(D, day(20)); await visit(D, day(25));
    await visit(E, new Date(y, m - 14, 5)); await visit(E, day(6));          // seen over a year before: the visit this month is a revisit
    await visit(F, day(7)); await visit(G, day(8)); await visit(G, day(9), 'Removed');   // taken off the queue unseen: not an attendance
    await visit(H, new Date(y, m + 1, 2));                                   // the month after: not in this return

    const express = require(root + '/node_modules/express'), jwt = require(root + '/node_modules/jsonwebtoken'), ExcelJS = require(root + '/node_modules/exceljs');
    const app = express(); app.use(express.json()); app.use('/api', require(root + '/src/routes/index').default);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const get = (p, user) => fetch(origin + '/api' + p, { headers: user ? { authorization: 'Bearer ' + jwt.sign({ userId: user.id }, process.env.JWT_SECRET) } : {} });
    const json = async (p, user) => { const res = await get(p, user); assert.equal(res.status, 200, p); return res.json(); };
    const H2 = '/reports/hia2/opd', month = `month=${monthText}`;

    // The form's cells and codes: 33 of them, in the order of the form.
    let rep = await json(`${H2}?${month}`, desk);
    assert.equal(rep.title, 'HIA2 OPD attendances (6.1)'); assert.deepEqual(rep.columns.map(c => c.key), ['code', 'section', 'age', 'sex', 'value']);
    assert.equal(rep.rows.length, 33); assert.equal(new Set(rep.rows.map(x => x.code)).size, 33);
    assert.deepEqual(rep.rows.slice(0, 6).map(x => [x.code, x.section, x.age, x.sex]), [['OPD1-005', 'First attendances', '<1 year', 'Male'], ['OPD1-010', 'First attendances', '<1 year', 'Female'], ['OPD1-015', 'First attendances', '<1 year', 'Total'], ['OPD1-020', 'First attendances', '1-4 years', 'Male'], ['OPD1-025', 'First attendances', '1-4 years', 'Female'], ['OPD1-030', 'First attendances', '1-4 years', 'Total']]);
    assert.deepEqual(rep.rows.filter(x => x.age === 'Total').map(x => [x.code, x.section, x.sex]), [['OPD1-065', 'First attendances', 'Male'], ['OPD1-070', 'First attendances', 'Female'], ['OPD1-075', 'First attendances', 'Total'], ['OPD1-140', 'Revisits', 'Male'], ['OPD1-145', 'Revisits', 'Female'], ['OPD1-150', 'Revisits', 'Total'], ['OPD1-155', 'Total OPD attendances', 'Male'], ['OPD1-160', 'Total OPD attendances', 'Female'], ['OPD1-165', 'Total OPD attendances', 'Total']], 'the codes of the form');
    assert.deepEqual(rep.rows.filter(x => x.section === 'Revisits').map(x => x.code), ['OPD1-080', 'OPD1-085', 'OPD1-090', 'OPD1-095', 'OPD1-100', 'OPD1-105', 'OPD1-110', 'OPD1-115', 'OPD1-120', 'OPD1-125', 'OPD1-130', 'OPD1-135', 'OPD1-140', 'OPD1-145', 'OPD1-150']);
    assert.equal(rep.period, new Date(y, m, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })); ok();

    // The values: ten attendances, six first visits and four revisits; the patient recorded as another sex is in the Total column only.
    const v = {}; for (const x of rep.rows) v[x.code] = x.value;
    const expected = {
      'OPD1-005': 1, 'OPD1-010': 0, 'OPD1-015': 1, 'OPD1-020': 0, 'OPD1-025': 1, 'OPD1-030': 1, 'OPD1-035': 1, 'OPD1-040': 0, 'OPD1-045': 1, 'OPD1-050': 0, 'OPD1-055': 2, 'OPD1-060': 3, 'OPD1-065': 2, 'OPD1-070': 3, 'OPD1-075': 6,
      'OPD1-080': 0, 'OPD1-085': 0, 'OPD1-090': 0, 'OPD1-095': 0, 'OPD1-100': 1, 'OPD1-105': 1, 'OPD1-110': 0, 'OPD1-115': 0, 'OPD1-120': 0, 'OPD1-125': 1, 'OPD1-130': 2, 'OPD1-135': 3, 'OPD1-140': 1, 'OPD1-145': 3, 'OPD1-150': 4,
      'OPD1-155': 3, 'OPD1-160': 6, 'OPD1-165': 10,
    };
    assert.deepEqual(v, expected);
    assert.deepEqual(rep.summary.map(s => [s.label, s.value]), [['First attendances', 6], ['Revisits', 4], ['Total OPD attendances', 10], ['Sex recorded as other (in the Total column only)', 1]]);
    // The form adds up: first plus revisits is the total, and the Total row is the four age groups.
    for (const [first, revisit, total] of [['OPD1-065', 'OPD1-140', 'OPD1-155'], ['OPD1-070', 'OPD1-145', 'OPD1-160'], ['OPD1-075', 'OPD1-150', 'OPD1-165']]) assert.equal(v[first] + v[revisit], v[total], first);
    for (const [row, bands] of [['OPD1-075', ['OPD1-015', 'OPD1-030', 'OPD1-045', 'OPD1-060']], ['OPD1-150', ['OPD1-090', 'OPD1-105', 'OPD1-120', 'OPD1-135']]]) assert.equal(bands.reduce((s, c) => s + v[c], 0), v[row]);
    ok();

    // The return equals the Attendance report for the same month.
    const range = `from=${monthText}-01&to=${monthText}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, '0')}`;
    const att = await json(`/reports/attendance/attendance?${range}`, desk), band = label => att.rows.find(x => x.label === label);
    assert.deepEqual([att.totals.all, att.totals.newTotal, att.totals.reTotal], [v['OPD1-165'], v['OPD1-075'], v['OPD1-150']]);
    assert.deepEqual([band('Under 1').newTotal, band('1 to 4').newTotal, band('5 to 14').newTotal, ['15 to 24', '25 to 49', '50 and over'].reduce((s, l) => s + band(l).newTotal, 0)], [v['OPD1-015'], v['OPD1-030'], v['OPD1-045'], v['OPD1-060']], 'new, by age group');
    assert.equal(['15 to 24', '25 to 49', '50 and over'].reduce((s, l) => s + band(l).reTotal, 0), v['OPD1-135'], 'revisits, 15 and over'); ok();

    // Every cell equals the attendances behind it.
    const lines = async (q, user = dr) => (await json(`${H2}/lines?${month}${q}`, user)).rows;
    for (const [c, value] of Object.entries(expected)) assert.equal((await lines(`&code=${c}`)).length, value, c);
    assert.equal((await lines('')).length, 10, 'no code: every attendance of the month');
    const women = await lines('&code=OPD1-055'); assert.deepEqual(women.map(x => [x.sex, x.age, x.visit]).sort(), [['Female', 30, 'New attendance'], ['Female', 70, 'New attendance']]);
    const list = await json(`${H2}/lines?${month}&code=OPD1-125`, dr);
    assert.equal(list.title, 'Attendance line list'); assert.match(list.period, /OPD1-125 revisits, 15\+ years, male/); assert.deepEqual(list.rows.map(x => [x.sex, x.age, x.visit]), [['Male', 30, 'Re-attendance']]);
    assert.ok(list.rows.every(x => x.name === '' && !/[0-9]{3}/.test(x.nrc)), 'names hidden by default');
    assert.equal((await json(`${H2}/lines?${month}&code=OPD1-055&names=1`, nurse)).rows[0].name, 'Grace Tembo'); ok();

    // The month: a month that has started, written YYYY-MM. A month with nothing in it is all zeros.
    for (const bad of ['', 'month=2026-13', 'month=2026-00', 'month=abc', 'month=1999-05', `month=${now.getFullYear() + 1}-01`, 'from=2026-03-01&to=2026-03-31']) for (const url of [`${H2}?${bad}`, `${H2}/lines?${bad}`]) { const res = await get(url, dr); assert.equal(res.status, 400, url); assert.ok((await res.json()).error.length > 10); }
    const code400 = await get(`${H2}/lines?${month}&code=OPD1-001`, dr); assert.equal(code400.status, 400); assert.match((await code400.json()).error, /code from the form/);
    const empty = await json(`${H2}?month=${y - 3}-01`, desk); assert.equal(empty.rows.length, 33); assert.ok(empty.rows.every(x => x.value === 0)); assert.deepEqual(empty.summary.map(s => s.value), [0, 0, 0]);
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; assert.equal((await get(`${H2}?month=${thisMonth}`, desk)).status, 200, 'the month in progress is allowed'); ok();

    // Who may open what.
    for (const [url, who, status] of [
      [`${H2}?${month}`, desk, 200], [`${H2}?${month}`, nurse, 200], [`${H2}?${month}`, biller, 403], [`${H2}?${month}`, undefined, 401],
      [`${H2}/lines?${month}`, desk, 403], [`${H2}/lines?${month}&names=1`, desk, 403], [`${H2}/lines?${month}`, biller, 403], [`${H2}/lines?${month}`, nurse, 200], [`${H2}/lines?${month}&names=1`, boss, 200], [`${H2}/lines?${month}`, undefined, 401],
    ]) assert.equal((await get(url, who)).status, status, url + ' ' + (who ? who.name : 'no login'));
    ok();

    // Excel: the form's codes and values, the line list for those who may, the definitions, logged.
    const sheets = async (url, user) => { const res = await get(url, user); assert.equal(res.status, 200, url); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer())); return wb; };
    assert.equal(await db.reportExportLog.count(), 0);
    let wb = await sheets(`${H2}?${month}&format=xlsx`, desk); assert.deepEqual(wb.worksheets.map(w => w.name), ['Summary', 'Definitions'], 'reception has the counts only');
    const flat = JSON.stringify(wb.getWorksheet('Summary').getSheetValues()); assert.match(flat, /OPD1-165/); assert.match(flat, /Total OPD attendances/);
    assert.match(JSON.stringify(wb.getWorksheet('Definitions').getSheetValues()), /version February 2023/);
    wb = await sheets(`${H2}?${month}&format=xlsx`, dr); assert.deepEqual(wb.worksheets.map(w => w.name), ['Summary', 'Line list', 'Definitions']);
    wb = await sheets(`${H2}/lines?${month}&code=OPD1-055&format=xlsx`, dr); assert.deepEqual(wb.worksheets.map(w => w.name), ['Line list', 'Definitions']);
    const logged = await db.reportExportLog.findMany({ orderBy: { at: 'asc' } });
    assert.deepEqual(logged.map(x => [x.area, x.report, x.kind, x.rowCount]), [['hia2', 'opd', 'AGGREGATE', 33], ['hia2', 'opd', 'LINE_LIST', 10], ['hia2', 'opd', 'LINE_LIST', 2]]); assert.equal(logged[2].filters.code, 'OPD1-055'); assert.equal(logged[2].filters.month, monthText);
    assert.equal((await get(`${H2}/lines?${month}&format=xlsx`, desk)).status, 403); assert.equal((await get(`${H2}?${month}&format=xlsx`, biller)).status, 403); ok();

    // The registry tells the screen what this person can do.
    const hia2 = async user => (await json('/reports/registry', user)).reports.filter(x => x.area === 'hia2').map(x => [x.name, x.lineList, x.canSeeNames, x.canExport]);
    assert.deepEqual(await hia2(desk), [['opd', false, false, true]]); assert.deepEqual(await hia2(dr), [['opd', true, true, true]]); assert.deepEqual(await hia2(biller), []); ok();

    console.log(checks + '/' + checks + ' HIA2 report check groups passed. All writes used a disposable schema.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.$disconnect();
    if (created) { assert.match(schema, /^ses_hia2_test_\d+_[a-f0-9]{8}$/); await admin.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE'); }
    await admin.$disconnect();
  }
}
