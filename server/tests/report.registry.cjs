// The report registry: what a report must declare, who sees which report, that the registered billing and stock reports give the same
// figures as their own builders, and that every Excel export carries a Definitions sheet and is logged first. Disposable schema, real router, real tokens.
const assert = require('node:assert/strict'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'); require(root + '/node_modules/dotenv').config({ path: root + '/.env', quiet: true });
if (process.env.STOCK_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.STOCK_TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'report-registry-test-secret';
require(root + '/node_modules/ts-node').register({ project: root + '/tsconfig.json', transpileOnly: true });
const { PrismaClient } = require(root + '/node_modules/@prisma/client');
const appPrisma = require(root + '/src/lib/prisma.ts'); // modules read `.default` at call time, so swapping it points every loaded module at the test schema
main().catch(e => { console.error(e); process.exitCode = 1; });

async function main() {
  const schema = 'ses_registry_test_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  assert.match(schema, /^ses_registry_test_\d+_[a-f0-9]{8}$/);
  const url = new URL(process.env.DATABASE_URL); url.searchParams.set('schema', schema);
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  let db, server, created = false, checks = 0; const ok = () => { checks++; };
  try {
    await admin.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"'); created = true;
    const r = spawnSync(process.execPath, [root + '/node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: root, env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8', windowsHide: true });
    if (r.status) throw Error(r.stdout + '\n' + r.stderr);
    db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    Object.defineProperty(appPrisma, 'default', { value: db, configurable: true });

    const registry = require(root + '/src/lib/reportRegistry'); require(root + '/src/lib/reportDefinitions');
    const { buildReport } = require(root + '/src/controllers/billingReports.controller'), { buildStockReport } = require(root + '/src/controllers/stockReports.controller');
    const express = require(root + '/node_modules/express'), jwt = require(root + '/node_modules/jsonwebtoken'), ExcelJS = require(root + '/node_modules/exceljs');
    const mk = (name, role) => db.user.create({ data: { name, email: name.toLowerCase().replace(/\s/g, '.') + '@example.test', password: 'x', role, status: 'active' } });
    const boss = await mk('Synthetic admin', 'admin'), biller = await mk('Synthetic biller', 'billing'), pharm = await mk('Synthetic pharmacist', 'pharmacist'), desk = await mk('Synthetic reception', 'receptionist');
    const nurse = await mk('Synthetic nurse', 'nurse'), dr = await mk('Synthetic doctor', 'clinician'), both = await mk('Synthetic both', 'clinician,billing');

    // A report cannot be added without saying what it is, how it counts and who may open it.
    const good = { area: 'testing', name: 'sample', title: 'Sample', description: 'A sample.', definitions: ['It counts one thing.'], filters: ['from'], roles: { aggregate: ['nurse'], export: [] }, run: async () => ({ name: 'sample', title: 'Sample', period: 'Today', columns: [{ key: 'a', header: 'A', type: 'int', width: 8 }], rows: [{ a: 1 }, { a: 2 }], totals: null, summary: [] }) };
    const refused = (change, pattern) => assert.throws(() => registry.registerReport({ ...good, name: 'other', ...change }), pattern);
    refused({ roles: { aggregate: [], export: [] } }, /who may open/); refused({ definitions: [] }, /how it counts/); refused({ definitions: ['  '] }, /how it counts/);
    refused({ title: ' ' }, /title and a description/); refused({ description: '' }, /title and a description/); refused({ name: 'Bad Name' }, /lower-case/); refused({ area: '9x' }, /lower-case/);
    refused({ roles: { aggregate: ['nurse'], export: ['admin'] } }, /can open the report can export/);
    const lineList = { run: async (_q, o) => ({ name: 'sample-lines', title: 'Sample lines', period: 'Today', columns: [{ key: 'a', header: 'A', type: 'int', width: 8 }], rows: [{ a: o.names ? 100 : 1 }], totals: null, summary: [] }) };
    refused({ lineList }, /go together/); refused({ roles: { aggregate: ['nurse'], lineList: ['clinician'], export: [] } }, /go together/);
    refused({ lineList, roles: { aggregate: ['nurse'], lineList: ['clinician'], names: ['nurse'], export: [] } }, /see names/);
    registry.registerReport({ ...good, name: 'lines', lineList, roles: { aggregate: ['nurse'], lineList: ['clinician'], names: ['clinician'], export: ['clinician'] } });   // a line-list role may export even without the counts
    registry.registerReport(good);
    assert.throws(() => registry.registerReport(good), /already registered/);
    for (const d of registry.reportsFor('admin,billing,pharmacist,nurse,clinician')) {
      assert.ok(d.title && d.description && d.definitions.length > 0 && d.roles.aggregate.length > 0, d.area + '/' + d.name + ' is fully declared');
    }
    ok();

    const app = express(); app.use(express.json()); app.use('/api', require(root + '/src/routes/index').default);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const get = (p, user) => fetch(origin + '/api' + p, { headers: user ? { authorization: 'Bearer ' + jwt.sign({ userId: user.id }, process.env.JWT_SECRET) } : {} });
    const list = async user => (await (await get('/reports/registry', user)).json()).reports.map(x => x.area + '/' + x.name).filter(x => !x.startsWith('testing/'));
    const BILL = ['billing/daybook', 'billing/revenue', 'billing/fast-moving', 'billing/outstanding', 'billing/collections'], ATT = ['attendance/attendance', 'attendance/busy-times', 'chronic/register', 'chronic/overdue'], PHARM = ['pharmacy/dispensed', 'pharmacy/prescriptions'], LAB = ['lab/tests', 'lab/turnaround', 'lab/abnormal'], LAB_COUNTS = ['lab/tests', 'lab/turnaround'], STOCK = ['stock/on-hand', 'stock/expiry', 'stock/movements', 'stock/adjustments', 'stock/reorder'];

    // Who sees what: the same roles as the screens these reports already have.
    assert.equal((await get('/reports/registry')).status, 401); assert.equal((await get('/reports/billing/collections')).status, 401); assert.equal((await get('/reports/billing/collections?format=xlsx')).status, 401);
    assert.deepEqual((await list(biller)).sort(), [...BILL].sort()); assert.deepEqual((await list(pharm)).sort(), [...STOCK, ...ATT, ...LAB, ...PHARM].sort());
    assert.deepEqual((await list(boss)).sort(), [...BILL, ...STOCK, ...ATT, ...LAB, ...PHARM].sort()); assert.deepEqual((await list(both)).sort(), [...BILL, ...ATT, ...LAB, ...PHARM].sort(), 'a person with several roles gets the union');
    assert.deepEqual((await list(desk)).sort(), [...ATT, ...LAB_COUNTS, ...PHARM].sort(), 'reception: attendance, chronic and lab counts, never abnormal results');
    for (const clinical of [nurse, dr]) assert.deepEqual((await list(clinical)).sort(), [...ATT, ...LAB, ...PHARM].sort(), 'no billing or stock reports');
    assert.equal((await get('/reports/attendance/attendance', biller)).status, 403, 'billing has no attendance');
    for (const [who, other] of [[biller, STOCK], [pharm, BILL], [desk, BILL], [dr, STOCK]]) for (const rep of other) assert.equal((await get('/reports/' + rep, who)).status, 403, rep);
    assert.equal((await get('/reports/billing/nothing', boss)).status, 404); assert.equal((await get('/reports/nothing/nothing', boss)).status, 404);
    const listing = (await (await get('/reports/registry', biller)).json()).reports[0]; assert.ok(listing.canExport === true && Array.isArray(listing.definitions) && Array.isArray(listing.filters)); ok();

    // The population routes keep their own paths and their own guard.
    assert.equal((await get('/reports/population/kpis', dr)).status, 200); assert.equal(typeof (await (await get('/reports/population/kpis', dr)).json()).totalPatients, 'number');
    assert.equal((await get('/reports/population/kpis', biller)).status, 403); assert.equal((await get('/reports/population/kpis')).status, 401); ok();

    // The same figures as the report's own builder, with the written definitions added.
    const day = new Date().toISOString().slice(0, 10), range = `from=${day}&to=${day}`;
    const strip = o => { const { period, definitions, filters, ...rest } = JSON.parse(JSON.stringify(o)); return rest; };
    for (const rep of BILL) {
      const name = rep.split('/')[1], q = name === 'outstanding' ? {} : { from: day, to: day }, res = await get(`/reports/${rep}?${name === 'outstanding' ? '' : range}`, boss);
      assert.equal(res.status, 200, rep); const body = await res.json();
      assert.deepEqual(strip(body), strip(await buildReport(name, q)), rep + ' matches its own builder'); assert.ok(body.period && body.definitions.length > 0);
    }
    for (const rep of STOCK) {
      const name = rep.split('/')[1], q = ['on-hand', 'expiry', 'reorder'].includes(name) ? {} : { from: day, to: day }, res = await get(`/reports/${rep}?${Object.keys(q).length ? range : ''}`, boss);
      assert.equal(res.status, 200, rep); const body = await res.json();
      assert.deepEqual(strip(body), strip(await buildStockReport(name, q)), rep + ' matches its own builder'); assert.ok(body.period && body.definitions.length > 0);
    }
    const filtered = await (await get('/reports/billing/daybook?' + range + '&method=CASH&junk=1', boss)).json();
    assert.deepEqual(filtered.filters, { from: day, to: day, method: 'CASH' }, 'only filters the report declares are echoed'); ok();

    // A bad request is a readable 400, never a 500.
    let res = await get('/reports/billing/revenue?from=2026-03-02&to=2026-03-01', boss); assert.equal(res.status, 400); assert.match((await res.json()).error, /before the start/);
    res = await get('/reports/stock/reorder?status=nonsense', boss); assert.equal(res.status, 400); assert.match((await res.json()).error, /valid report filter/); ok();

    // Excel: the report, then a Definitions sheet; logged first.
    assert.equal(await db.reportExportLog.count(), 0, 'opening a report as JSON is not logged');
    res = await get('/reports/billing/collections?' + range, biller);
    assert.equal(res.status, 200); assert.equal(await db.reportExportLog.count(), 0);
    res = await get(`/reports/billing/collections?${range}&format=xlsx`, biller);
    assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /spreadsheetml/); assert.match(res.headers.get('content-disposition'), new RegExp(`ses-billing-collections-${day}\\.xlsx`));
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
    assert.deepEqual(wb.worksheets.map(w => w.name), ['Collections by staff member', 'Definitions']);
    const text = ws => { const out = []; ws.eachRow(row => out.push(row.values.slice(1).map(v => String(v ?? '')).join(' | '))); return out.join('\n'); };
    const defs = text(wb.getWorksheet('Definitions'));
    assert.match(defs, /Collections by staff member/); assert.match(defs, new RegExp(`from: ${day}; to: ${day}`)); assert.match(defs, /Synthetic biller/); assert.match(defs, /Account credit used is shown separately/); assert.match(defs, /Rows \| 0/);
    const logged = await db.reportExportLog.findMany(); assert.equal(logged.length, 1);
    assert.deepEqual([logged[0].userId, logged[0].role, logged[0].area, logged[0].report, logged[0].kind, logged[0].rowCount], [biller.id, 'billing', 'billing', 'collections', 'AGGREGATE', 0]);
    assert.deepEqual(logged[0].filters, { from: day, to: day }); assert.ok(Math.abs(logged[0].at.getTime() - Date.now()) < 60000);
    assert.equal((await get('/reports/stock/on-hand?format=xlsx', pharm)).status, 200); assert.equal((await get('/reports/stock/reorder?format=xlsx&days=30', boss)).status, 200);
    assert.deepEqual((await db.reportExportLog.findMany({ orderBy: { at: 'asc' } })).map(x => x.area + '/' + x.report), ['billing/collections', 'stock/on-hand', 'stock/reorder']); ok();

    // A role that may open a report but not export it gets a 403 and leaves no log row; a line-list-only role may export.
    const before = await db.reportExportLog.count();
    assert.equal((await get('/reports/testing/sample', nurse)).status, 200); assert.equal((await get('/reports/testing/sample?format=xlsx', nurse)).status, 403);
    assert.equal((await get('/reports/testing/sample', dr)).status, 403, 'a clinician has no access to the sample'); assert.equal((await get('/reports/testing/lines?format=xlsx', dr)).status, 403, 'the counts need the aggregate role'); assert.equal((await get('/reports/testing/lines/lines?format=xlsx', dr)).status, 200);
    assert.equal(await db.reportExportLog.count(), before + 1); ok();

    // The log can be added to and read, never changed or removed.
    const row = (await db.reportExportLog.findMany())[0];
    await assert.rejects(db.reportExportLog.update({ where: { id: row.id }, data: { rowCount: 99 } }), /cannot be changed or deleted/);
    await assert.rejects(db.reportExportLog.delete({ where: { id: row.id } }), /cannot be changed or deleted/);
    await assert.rejects(db.reportExportLog.deleteMany({}), /cannot be changed or deleted/);
    assert.equal(await db.reportExportLog.count(), before + 1); ok();

    // If the log cannot be written, no file is sent.
    await db.$executeRawUnsafe('DROP TABLE "ReportExportLog"');
    res = await get(`/reports/billing/collections?${range}&format=xlsx`, biller);
    assert.equal(res.status, 500); assert.doesNotMatch(res.headers.get('content-type') ?? '', /spreadsheetml/); ok();

    console.log(checks + '/' + checks + ' report registry check groups passed. All writes used a disposable schema.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.$disconnect();
    if (created) { assert.match(schema, /^ses_registry_test_\d+_[a-f0-9]{8}$/); await admin.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE'); }
    await admin.$disconnect();
  }
}
