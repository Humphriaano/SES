// Facility settings: the facility's name and district on every report export, and the facility's choice whether report line lists may show
// patient names. Who may read and change them, validation, the audit trail, the single row, and that the names setting is enforced by the server.
// Disposable schema, real router, real tokens.
const assert = require('node:assert/strict'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'); require(root + '/node_modules/dotenv').config({ path: root + '/.env', quiet: true });
if (process.env.STOCK_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.STOCK_TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'facility-test-secret';
require(root + '/node_modules/ts-node').register({ project: root + '/tsconfig.json', transpileOnly: true });
const { PrismaClient } = require(root + '/node_modules/@prisma/client');
const appPrisma = require(root + '/src/lib/prisma.ts'); // modules read `.default` at call time, so swapping it points every loaded module at the test schema
main().catch(e => { console.error(e); process.exitCode = 1; });

async function main() {
  const schema = 'ses_facility_test_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  assert.match(schema, /^ses_facility_test_\d+_[a-f0-9]{8}$/);
  const url = new URL(process.env.DATABASE_URL); url.searchParams.set('schema', schema);
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  let db, server, created = false, checks = 0; const ok = () => { checks++; };
  try {
    await admin.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"'); created = true;
    const r = spawnSync(process.execPath, [root + '/node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: root, env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8', windowsHide: true });
    if (r.status) throw Error(r.stdout + '\n' + r.stderr);
    db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    Object.defineProperty(appPrisma, 'default', { value: db, configurable: true });

    const mk = (name, role) => db.user.create({ data: { name, email: name.toLowerCase().replace(/\s/g, '.') + '@example.test', password: 'x', role, status: 'active' } });
    const boss = await mk('Synthetic admin', 'admin'), dr = await mk('Synthetic doctor', 'clinician'), desk = await mk('Synthetic reception', 'receptionist');
    const p = await db.patient.create({ data: { firstName: 'Mary', lastName: 'Phiri', dateOfBirth: new Date(1990, 5, 15), gender: 'FEMALE', nationalId: '123456/78/1' } });
    const room = await db.facilityRoom.create({ data: { name: 'Consultation Room 1', tag: 'CR1' } });
    await db.queueEntry.create({ data: { queueNumber: 1, patientId: p.id, patientName: 'Mary', roomId: room.id, status: 'Done', checkedInAt: new Date(Date.now() - 86400000) } });

    const express = require(root + '/node_modules/express'), jwt = require(root + '/node_modules/jsonwebtoken'), ExcelJS = require(root + '/node_modules/exceljs');
    const app = express(); app.use(express.json()); app.use('/api', require(root + '/src/routes/index').default);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const call = (method, p, user, body) => fetch(origin + '/api' + p, { method, headers: { 'content-type': 'application/json', ...(user ? { authorization: 'Bearer ' + jwt.sign({ userId: user.id }, process.env.JWT_SECRET) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const get = (p, user) => call('GET', p, user), patch = (body, user) => call('PATCH', '/facility-settings', user, body);
    const json = async res => { const b = await res.json(); return { status: res.status, body: b }; };

    // The one row exists from the start, with names on line lists allowed as before the setting existed. Anyone signed in may read it.
    assert.deepEqual(await json(await get('/facility-settings', desk)), { status: 200, body: { name: '', district: '', lineListNames: true } });
    assert.equal((await get('/facility-settings')).status, 401);
    await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "${schema}"."FacilitySetting" ("id","updatedAt") VALUES (2, now())`), /FacilitySetting_single_row|check constraint/i, 'there is only ever one row'); ok();

    // Only an admin changes it, and what they send is checked.
    assert.equal((await patch({ name: 'X' }, dr)).status, 403); assert.equal((await patch({ name: 'X' }, desk)).status, 403); assert.equal((await patch({ name: 'X' })).status, 401);
    for (const [bad, why] of [[{ name: 'x'.repeat(121) }, /120 characters/], [{ district: 'y'.repeat(81) }, /80 characters/], [{ name: 5 }, /text/], [{ lineListNames: 'yes' }, /yes or no/], [{}, /Nothing to change/], [{ other: 1 }, /Nothing to change/]]) {
      const res = await json(await patch(bad, boss)); assert.equal(res.status, 400, JSON.stringify(bad)); assert.match(res.body.error, why);
    }
    assert.equal(await db.billingAudit.count({ where: { action: 'FACILITY_SETTINGS_CHANGED' } }), 0, 'a refused change is not recorded');
    let res = await json(await patch({ name: '  Mtendere   Clinic ', district: 'Lusaka' }, boss));
    assert.deepEqual(res, { status: 200, body: { name: 'Mtendere Clinic', district: 'Lusaka', lineListNames: true } }, 'spaces tidied');
    const trail = await db.billingAudit.findMany({ where: { action: 'FACILITY_SETTINGS_CHANGED' } });
    assert.equal(trail.length, 1); assert.deepEqual([trail[0].userId, trail[0].before.name, trail[0].after.name, trail[0].after.district], [boss.id, '', 'Mtendere Clinic', 'Lusaka']);
    assert.equal((await db.facilitySetting.findUnique({ where: { id: 1 } })).updatedById, boss.id); ok();

    // Every export carries the facility: beside "Generated" on the report sheet, and on its own row of the Definitions sheet.
    const sheets = async (p, user) => { const r = await get(p, user); assert.equal(r.status, 200, p); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await r.arrayBuffer())); return wb; };
    let wb = await sheets('/reports/attendance/attendance?format=xlsx', desk);
    assert.match(String(wb.getWorksheet('Summary').getCell(5, 1).value), /^Mtendere Clinic · Lusaka · Generated /);
    assert.deepEqual([wb.getWorksheet('Definitions').getCell(5, 1).value, wb.getWorksheet('Definitions').getCell(5, 2).value], ['Facility', 'Mtendere Clinic · Lusaka']);
    wb = await sheets('/reports/population/export', desk); assert.match(String(wb.worksheets[0].getCell(5, 1).value), /^Mtendere Clinic · Lusaka · Generated /, 'the overview export too');
    await patch({ name: '', district: '' }, boss);
    wb = await sheets('/reports/attendance/attendance?format=xlsx', desk);
    assert.match(String(wb.getWorksheet('Summary').getCell(5, 1).value), /^Generated /, 'nothing set: no facility, no stray separator');
    assert.match(String(wb.getWorksheet('Definitions').getCell(5, 2).value), /^Not set/); ok();

    // Names on line lists: switched off, nobody gets them, whatever their role, and the screen is told so.
    const A = '/reports/attendance/attendance';
    assert.equal((await get(`${A}/lines?names=1`, dr)).status, 200, 'allowed by default for a clinical role');
    await patch({ lineListNames: false }, boss);
    const listing = (await json(await get('/reports/registry', dr))).body.reports.find(x => x.area === 'attendance' && x.name === 'attendance');
    assert.deepEqual([listing.lineList, listing.canSeeNames], [true, false], 'the line list stays, the names go');
    res = await json(await get(`${A}/lines?names=1`, dr)); assert.equal(res.status, 403); assert.match(res.body.error, /switched off for this facility/);
    assert.equal((await get(`${A}/lines?names=1`, boss)).status, 403, 'an admin too');
    assert.equal((await get(`${A}?format=xlsx&names=1`, dr)).status, 403, 'and the Excel file');
    const plain = await json(await get(`${A}/lines`, dr)); assert.equal(plain.status, 200); assert.equal(plain.body.rows[0].name, ''); assert.equal(plain.body.rows[0].nrc, '••••••/••/1');
    assert.equal((await get(`${A}/lines?names=1`, desk)).status, 403, 'reception never could');
    res = await json(await get(`${A}/lines?names=1`, desk)); assert.match(res.body.error, /open the records/, 'a role without the line list is told that, not about the setting');
    await patch({ lineListNames: true }, boss);
    assert.equal((await get(`${A}/lines?names=1`, dr)).status, 200, 'switched back on');
    assert.equal(await db.billingAudit.count({ where: { action: 'FACILITY_SETTINGS_CHANGED' } }), 4, 'every change is recorded'); ok();

    console.log(checks + '/' + checks + ' facility settings check groups passed. All writes used a disposable schema.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.$disconnect();
    if (created) { assert.match(schema, /^ses_facility_test_\d+_[a-f0-9]{8}$/); await admin.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE'); }
    await admin.$disconnect();
  }
}
