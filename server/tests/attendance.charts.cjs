// The data behind the attendance charts: attendance by service point, and busy times (weekday by hour of check-in). Exact cells from fixed dates,
// equality with the Attendance report, every cell equal to the attendances behind it, bad requests, who may open what, and the Excel workbook.
// Disposable schema, real router, real tokens.
const assert = require('node:assert/strict'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'); require(root + '/node_modules/dotenv').config({ path: root + '/.env', quiet: true });
if (process.env.STOCK_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.STOCK_TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'charts-test-secret';
require(root + '/node_modules/ts-node').register({ project: root + '/tsconfig.json', transpileOnly: true });
const { PrismaClient } = require(root + '/node_modules/@prisma/client');
const appPrisma = require(root + '/src/lib/prisma.ts'); // modules read `.default` at call time, so swapping it points every loaded module at the test schema
main().catch(e => { console.error(e); process.exitCode = 1; });

async function main() {
  const schema = 'ses_charts_test_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  assert.match(schema, /^ses_charts_test_\d+_[a-f0-9]{8}$/);
  const url = new URL(process.env.DATABASE_URL); url.searchParams.set('schema', schema);
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  let db, server, created = false, checks = 0; const ok = () => { checks++; };
  try {
    await admin.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"'); created = true;
    const r = spawnSync(process.execPath, [root + '/node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: root, env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8', windowsHide: true });
    if (r.status) throw Error(r.stdout + '\n' + r.stderr);
    db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    Object.defineProperty(appPrisma, 'default', { value: db, configurable: true });

    const now = new Date(), first = new Date(now.getFullYear(), now.getMonth() - 1, 1), y = first.getFullYear(), m = first.getMonth();
    const at = (d, h, min = 0) => new Date(y, m, d, h, min), iso = d => (new Date(y, m, d).getDay() + 6) % 7 + 1, DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const mk = (name, role) => db.user.create({ data: { name, email: name.toLowerCase().replace(/\s/g, '.') + '@example.test', password: 'x', role, status: 'active' } });
    const boss = await mk('Synthetic admin', 'admin'), dr = await mk('Synthetic doctor', 'clinician'), nurse = await mk('Synthetic nurse', 'nurse'), desk = await mk('Synthetic reception', 'receptionist'), biller = await mk('Synthetic biller', 'billing');
    const patient = (firstName, lastName) => db.patient.create({ data: { firstName, lastName, dateOfBirth: new Date(1985, 5, 15), gender: 'FEMALE' } });
    const P1 = await patient('Mary', 'Phiri'), P2 = await patient('John', 'Banda'), P3 = await patient('Peter', 'Zulu');
    const roomA = await db.facilityRoom.create({ data: { name: 'Consultation Room 1', tag: 'CR1' } }), roomB = await db.facilityRoom.create({ data: { name: 'Treatment room', tag: 'TR' } });
    let n = 0; const visit = (p, room, checkedInAt, status = 'Done') => db.queueEntry.create({ data: { queueNumber: ++n, patientId: p.id, patientName: p.firstName, roomId: room.id, status, checkedInAt } });
    // Days 3 and 10 fall on the same weekday, day 4 on the next. Two in the 10:00 hour, 10:59 included in it.
    await visit(P1, roomA, at(3, 10, 15)); await visit(P2, roomA, at(3, 10, 59)); await visit(P3, roomB, at(3, 14, 5));
    await visit(P1, roomA, at(4, 9, 30)); await visit(P2, roomB, at(10, 10, 20)); await visit(P3, roomA, at(10, 16, 59));
    await visit(P1, roomA, at(4, 9, 0), 'Removed');   // taken off the queue unseen: not an attendance

    const express = require(root + '/node_modules/express'), jwt = require(root + '/node_modules/jsonwebtoken'), ExcelJS = require(root + '/node_modules/exceljs');
    const app = express(); app.use(express.json()); app.use('/api', require(root + '/src/routes/index').default);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const get = (p, user) => fetch(origin + '/api' + p, { headers: user ? { authorization: 'Bearer ' + jwt.sign({ userId: user.id }, process.env.JWT_SECRET) } : {} });
    const json = async (p, user) => { const res = await get(p, user); assert.equal(res.status, 200, p); return res.json(); };
    const mm = String(m + 1).padStart(2, '0'), range = `from=${y}-${mm}-01&to=${y}-${mm}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, '0')}`;
    const A = '/reports/attendance/attendance', B = '/reports/attendance/busy-times', W3 = iso(3), W4 = iso(4);

    // By service point: busiest first, and the rows add up to the total.
    let rep = await json(`${A}?${range}&groupBy=servicePoint`, desk);
    assert.equal(rep.title, 'Attendance by service point'); assert.equal(rep.columns[0].header, 'Service point');
    assert.deepEqual(rep.rows.map(x => [x.label, x.key, x.all, x.newTotal, x.reTotal]), [['Consultation Room 1', roomA.id, 4, 2, 2], ['Treatment room', roomB.id, 2, 1, 1]]);
    assert.equal(rep.totals.all, 6); assert.equal(rep.rows.reduce((s, x) => s + x.all, 0), 6);
    assert.equal((await json(`${A}?${range}`, desk)).totals.all, 6, 'the same total as the age and sex view');
    for (const row of rep.rows) assert.equal((await json(`${A}/lines?${range}&servicePoint=${row.key}`, dr)).rows.length, row.all, row.label);
    assert.equal((await json(`${A}?${range}&groupBy=servicePoint&sex=MALE`, desk)).rows.length, 0, 'filters still narrow it');
    assert.equal((await get(`${A}?groupBy=year`, dr)).status, 400); ok();

    // Busy times: seven weekdays by 24 hours, from the hour of check-in.
    rep = await json(`${B}?${range}`, desk);
    assert.equal(rep.title, 'Busy times'); assert.deepEqual(rep.columns.map(c => c.key), ['label', ...Array.from({ length: 24 }, (_, h) => 'h' + String(h).padStart(2, '0')), 'total']);
    assert.deepEqual(rep.columns.slice(9, 12).map(c => c.header), ['08:00', '09:00', '10:00']);
    assert.deepEqual(rep.rows.map(x => [x.label, x.key]), [['Mon', '1'], ['Tue', '2'], ['Wed', '3'], ['Thu', '4'], ['Fri', '5'], ['Sat', '6'], ['Sun', '7']]);
    const row = w => rep.rows.find(x => x.key === String(w));
    assert.deepEqual([row(W3).h10, row(W3).h14, row(W3).h16, row(W3).total], [3, 1, 1, 5], 'the 10:59 check-in is in the 10 o\'clock hour; two Mondays-or-whatever add up');
    assert.deepEqual([row(W4).h09, row(W4).total], [1, 1], 'the removed check-in is not counted');
    assert.equal(rep.rows.reduce((s, x) => s + x.total, 0), 6); assert.equal(rep.totals.total, 6); assert.deepEqual([rep.totals.h09, rep.totals.h10, rep.totals.h14, rep.totals.h16, rep.totals.label], [1, 3, 1, 1, 'All days']);
    for (let h = 0; h < 24; h++) { const k = 'h' + String(h).padStart(2, '0'); assert.equal(rep.rows.reduce((s, x) => s + x[k], 0), rep.totals[k], k); }
    assert.deepEqual(rep.summary.map(s => [s.label, s.value]), [['Attendances', 6], ['Busiest hour', `${DAY[W3]} 10:00 (3)`]]);
    assert.equal(rep.rows.reduce((s, x) => s + x.total, 0), (await json(`${A}?${range}`, desk)).totals.all, 'the same total as the Attendance report');
    const inA = await json(`${B}?${range}&servicePoint=${roomA.id}`, desk); assert.deepEqual([inA.totals.total, inA.rows.find(x => x.key === String(W3)).h10], [4, 2]); assert.match(inA.period, /one service point/);
    const empty = await json(`${B}?from=${y - 3}-01-01&to=${y - 3}-01-31`, desk); assert.equal(empty.totals.total, 0); assert.deepEqual(empty.summary, [{ label: 'Attendances', value: 0 }], 'no busiest hour when there is nothing'); ok();

    // Every cell equals the attendances behind it; a weekday or an hour alone opens its whole row or column.
    const lines = async q => (await json(`${B}/lines?${range}${q}`, dr)).rows;
    for (let w = 1; w <= 7; w++) { assert.equal((await lines(`&weekday=${w}`)).length, row(w).total, 'weekday ' + w); for (let h = 0; h < 24; h++) { const v = row(w)['h' + String(h).padStart(2, '0')]; if (v) assert.equal((await lines(`&weekday=${w}&hour=${h}`)).length, v, `weekday ${w} hour ${h}`); } }
    for (let h = 0; h < 24; h++) assert.equal((await lines(`&hour=${h}`)).length, rep.totals['h' + String(h).padStart(2, '0')], 'hour ' + h);
    assert.equal((await lines('')).length, 6); assert.equal((await lines(`&weekday=${W3}&hour=0`)).length, 0, 'hour 0 is a valid hour with nothing in it');
    assert.equal((await lines(`&weekday=${W3}&hour=10&servicePoint=${roomA.id}`)).length, 2);
    const list = await json(`${B}/lines?${range}&weekday=${W3}&hour=10`, dr);
    assert.equal(list.title, 'Attendance line list'); assert.match(list.period, new RegExp(`${DAY[W3]} 10:00`)); assert.ok(list.rows.every(x => x.name === '' && !/[0-9]{3}/.test(x.nrc)), 'names hidden by default');
    assert.equal((await json(`${B}/lines?${range}&weekday=${W3}&hour=10&names=1`, nurse)).rows.length, 3); ok();

    // Bad requests, who may open what.
    for (const bad of ['weekday=0', 'weekday=8', 'weekday=x', 'hour=24', 'hour=-1', 'hour=ab', 'servicePoint=nope', 'from=2026-03-01', 'from=2026-03-02&to=2026-03-01']) for (const url of [`${B}?${bad}`, `${B}/lines?${bad}`]) { const res = await get(url, dr); assert.equal(res.status, 400, url); assert.ok((await res.json()).error.length > 10); }
    for (const [url, who, status] of [[`${B}?${range}`, desk, 200], [`${B}?${range}`, biller, 403], [`${B}?${range}`, undefined, 401], [`${B}/lines?${range}`, desk, 403], [`${B}/lines?${range}&names=1`, desk, 403], [`${B}/lines?${range}`, biller, 403], [`${B}/lines?${range}&names=1`, boss, 200], [`${B}/lines?${range}`, undefined, 401]]) assert.equal((await get(url, who)).status, status, url + ' ' + (who ? who.name : 'no login'));
    ok();

    // Excel, and the registry.
    const sheets = async (url, user) => { const res = await get(url, user); assert.equal(res.status, 200, url); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer())); return wb; };
    assert.equal(await db.reportExportLog.count(), 0);
    let wb = await sheets(`${B}?${range}&format=xlsx`, desk); assert.deepEqual(wb.worksheets.map(w => w.name), ['Summary', 'Definitions']);
    wb = await sheets(`${B}?${range}&format=xlsx`, dr); assert.deepEqual(wb.worksheets.map(w => w.name), ['Summary', 'Line list', 'Definitions']);
    const logged = await db.reportExportLog.findMany({ orderBy: { at: 'asc' } }); assert.deepEqual(logged.map(x => [x.area, x.report, x.kind, x.rowCount]), [['attendance', 'busy-times', 'AGGREGATE', 7], ['attendance', 'busy-times', 'LINE_LIST', 6]]);
    assert.equal((await get(`${B}/lines?${range}&format=xlsx`, desk)).status, 403);
    const att = async user => (await json('/reports/registry', user)).reports.filter(x => x.area === 'attendance').map(x => [x.name, x.lineList]);
    assert.deepEqual(await att(desk), [['attendance', false], ['busy-times', false]]); assert.deepEqual(await att(dr), [['attendance', true], ['busy-times', true]]); assert.deepEqual(await att(biller), []); ok();

    console.log(checks + '/' + checks + ' attendance chart data check groups passed. All writes used a disposable schema.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.$disconnect();
    if (created) { assert.match(schema, /^ses_charts_test_\d+_[a-f0-9]{8}$/); await admin.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE'); }
    await admin.$disconnect();
  }
}
