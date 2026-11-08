// Workload (by service point and staff member, seen and not seen, waits) and OPD diagnoses (ICD-11 codes on consultations). Exact values from fixed
// times, equality with the Attendance report, every number equal to the records behind it, bad requests, who may open what, and the Excel workbook.
// Disposable schema, real router, real tokens.
const assert = require('node:assert/strict'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'); require(root + '/node_modules/dotenv').config({ path: root + '/.env', quiet: true });
if (process.env.STOCK_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.STOCK_TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'workload-test-secret';
require(root + '/node_modules/ts-node').register({ project: root + '/tsconfig.json', transpileOnly: true });
const { PrismaClient } = require(root + '/node_modules/@prisma/client');
const appPrisma = require(root + '/src/lib/prisma.ts'); // modules read `.default` at call time, so swapping it points every loaded module at the test schema
main().catch(e => { console.error(e); process.exitCode = 1; });

async function main() {
  const schema = 'ses_workload_test_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  assert.match(schema, /^ses_workload_test_\d+_[a-f0-9]{8}$/);
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
    const at = (d, h, min = 0) => new Date(y, m, d, h, min);
    const mk = (name, role) => db.user.create({ data: { name, email: name.toLowerCase().replace(/\s/g, '.') + '@example.test', password: 'x', role, status: 'active' } });
    const boss = await mk('Synthetic admin', 'admin'), dr = await mk('Synthetic doctor', 'clinician'), nurse = await mk('Synthetic nurse', 'nurse'), desk = await mk('Synthetic reception', 'receptionist'), biller = await mk('Synthetic biller', 'billing');
    const patient = (firstName, lastName, dateOfBirth, gender, nationalId = null) => db.patient.create({ data: { firstName, lastName, dateOfBirth, gender, nationalId } });
    const P1 = await patient('Mary', 'Phiri', new Date(1990, 0, 15), 'FEMALE', '123456/78/1'), P2 = await patient('John', 'Banda', new Date(y - 6, m - 3, 15), 'MALE'), P3 = await patient('Grace', 'Tembo', new Date(1950, 0, 15), 'FEMALE');
    const roomA = await db.facilityRoom.create({ data: { name: 'Consultation Room 1', tag: 'CR1' } }), roomB = await db.facilityRoom.create({ data: { name: 'Treatment room', tag: 'TR' } });
    let n = 0; const visit = (p, room, checkedInAt, startedAt = null, by = null, status = 'Done') => db.queueEntry.create({ data: { queueNumber: ++n, patientId: p.id, patientName: p.firstName, roomId: room.id, status, checkedInAt, startedAt, startedById: by?.id ?? null } });
    await visit(P1, roomA, at(3, 9), at(3, 9, 20), dr);          // waited 20 minutes
    await visit(P2, roomA, at(3, 9, 10), at(3, 9, 50), dr);      // 40
    await visit(P3, roomB, at(3, 10), at(3, 10, 5), nurse);      // 5
    await visit(P1, roomB, at(4, 11), null, null, 'Waiting');     // never started
    await visit(P2, roomA, at(5, 8), at(5, 7, 55), dr);          // started before check-in: a recording error
    await visit(P3, roomA, at(5, 8, 30), null, null, 'Removed');  // taken off the queue: not an attendance

    const code = {}; for (const [c, d] of [['BA00', 'Essential hypertension'], ['CA40', 'Pneumonia'], ['1F40', 'Malaria due to Plasmodium falciparum']]) code[c] = await db.iCD11Code.create({ data: { code: c, description: d } });
    const consult = async (p, createdAt, dx) => { const e = await db.encounter.create({ data: { patientId: p.id, clinicianId: dr.id, createdAt } }); for (const [c, isPrimary] of dx) await db.encounterDiagnosis.create({ data: { encounterId: e.id, icd11Id: code[c].id, isPrimary } }); return e; };
    await consult(P1, at(3, 9, 30), [['BA00', true], ['CA40', false]]);
    await consult(P2, at(3, 10), [['CA40', true]]);
    await consult(P3, at(4, 12), [['CA40', true], ['CA40', false]]);   // the same code twice on one consultation counts once, as the main diagnosis
    await consult(P1, at(5, 9), [['1F40', true]]);
    await consult(P2, new Date(y, m - 2, 10), [['BA00', true]]);         // the month before: not in the period

    const express = require(root + '/node_modules/express'), jwt = require(root + '/node_modules/jsonwebtoken'), ExcelJS = require(root + '/node_modules/exceljs');
    const app = express(); app.use(express.json()); app.use('/api', require(root + '/src/routes/index').default);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const get = (p, user) => fetch(origin + '/api' + p, { headers: user ? { authorization: 'Bearer ' + jwt.sign({ userId: user.id }, process.env.JWT_SECRET) } : {} });
    const json = async (p, user) => { const res = await get(p, user); assert.equal(res.status, 200, p); return res.json(); };
    const mm = String(m + 1).padStart(2, '0'), range = `from=${y}-${mm}-01&to=${y}-${mm}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, '0')}`;
    const W = '/reports/attendance/workload', D = '/reports/attendance/diagnoses';

    // Workload by service point: busiest first, seen and not seen, median and longest wait; the bad start is seen but its wait is left out.
    let rep = await json(`${W}?${range}`, desk);
    assert.equal(rep.title, 'Workload by service point'); assert.deepEqual(rep.columns.map(c => c.key), ['label', 'attendances', 'seen', 'notSeen', 'medianMin', 'longestMin']);
    assert.deepEqual(rep.rows.map(x => [x.label, x.key, x.attendances, x.seen, x.notSeen, x.medianMin, x.longestMin]), [['Consultation Room 1', roomA.id, 3, 3, 0, 30, 40], ['Treatment room', roomB.id, 2, 1, 1, 5, 5]]);
    assert.deepEqual([rep.totals.attendances, rep.totals.seen, rep.totals.notSeen, rep.totals.medianMin, rep.totals.longestMin], [5, 4, 1, 20, 40]);
    assert.deepEqual(rep.summary.map(s => [s.label, s.value]), [['Attendances', 5], ['Seen', 4], ['Median wait', '20 min'], ['Longest wait', '40 min'], ['Left out: started before check-in', 1]]);
    assert.equal((await json(`/reports/attendance/attendance?${range}`, desk)).totals.all, rep.totals.attendances, 'the same attendances as the Attendance report'); ok();

    // By staff member: whoever started the visit; nobody is its own row, last.
    const staff = await json(`${W}?${range}&groupBy=staff`, desk);
    assert.equal(staff.title, 'Workload by staff member'); assert.equal(staff.columns[0].header, 'Staff member');
    assert.deepEqual(staff.rows.map(x => [x.label, x.attendances, x.seen, x.notSeen, x.medianMin]), [['Synthetic doctor', 3, 3, 0, 30], ['Synthetic nurse', 1, 1, 0, 5], ['Not seen yet', 1, 0, 1, null]]);
    assert.deepEqual(staff.rows.map(x => x.key), [dr.id, nurse.id, 'none']); assert.equal(staff.rows.reduce((s, x) => s + x.attendances, 0), 5); ok();

    // Every number opens the attendances behind it.
    const wl = async q => (await json(`${W}/lines?${range}${q}`, dr)).rows;
    for (const row of rep.rows) { assert.equal((await wl(`&servicePoint=${row.key}`)).length, row.attendances); assert.equal((await wl(`&servicePoint=${row.key}&seen=yes`)).length, row.seen); assert.equal((await wl(`&servicePoint=${row.key}&seen=no`)).length, row.notSeen); }
    for (const row of staff.rows) { assert.equal((await wl(`&staff=${row.key}`)).length, row.attendances, row.label); assert.equal((await wl(`&staff=${row.key}&seen=no`)).length, row.notSeen); }
    assert.equal((await wl('')).length, 5); assert.equal((await wl('&seen=yes')).length, 4);
    const lines = await json(`${W}/lines?${range}`, dr);
    assert.deepEqual(lines.columns.map(c => c.key), ['at', 'patientCode', 'nrc', 'servicePoint', 'seenBy', 'startedAt', 'waitMin', 'wait']);
    assert.deepEqual(lines.rows.map(x => [x.servicePoint, x.seenBy, x.waitMin, x.wait]), [
      ['Consultation Room 1', 'Synthetic doctor', null, 'Recording error'], ['Treatment room', 'Not seen yet', null, ''], ['Treatment room', 'Synthetic nurse', 5, '5 min'],
      ['Consultation Room 1', 'Synthetic doctor', 40, '40 min'], ['Consultation Room 1', 'Synthetic doctor', 20, '20 min'],
    ], 'newest first');
    assert.ok(lines.rows.every(x => x.name === '' && !/[0-9]{3}/.test(x.nrc))); ok();

    // OPD diagnoses: by ICD-11 code, most common first; the code twice on one consultation counts once, as the main diagnosis.
    rep = await json(`${D}?${range}`, desk);
    assert.equal(rep.title, 'OPD diagnoses'); assert.deepEqual(rep.columns.map(c => c.key), ['code', 'label', 'consultations', 'patients', 'main', 'female', 'male']);
    assert.deepEqual(rep.rows.map(x => [x.code, x.consultations, x.patients, x.main, x.female, x.male]), [['CA40', 3, 3, 2, 2, 1], ['1F40', 1, 1, 1, 1, 0], ['BA00', 1, 1, 1, 1, 0]]);
    assert.equal(rep.rows[0].label, 'Pneumonia');
    assert.deepEqual(rep.summary.map(s => [s.label, s.value]), [['Diagnoses recorded', 5], ['Consultations with a diagnosis', 4], ['Patients', 3], ['Different diagnoses', 3]]);
    assert.deepEqual((await json(`${D}?${range}&sex=MALE`, desk)).rows.map(x => [x.code, x.consultations]), [['CA40', 1]]);
    assert.deepEqual((await json(`${D}?${range}&ageBand=5-14`, desk)).rows.map(x => [x.code, x.consultations]), [['CA40', 1]], 'age on the day of the consultation');
    assert.deepEqual((await json(`${D}?${range}&main=yes`, desk)).rows.map(x => [x.code, x.consultations]), [['CA40', 2], ['1F40', 1], ['BA00', 1]]);
    assert.equal((await json(D, desk)).summary[0].value, 6, 'all time adds the consultation from the month before'); ok();

    const dl = async q => (await json(`${D}/lines?${range}${q}`, dr)).rows;
    for (const row of rep.rows) {
      assert.equal((await dl(`&code=${row.code}`)).length, row.consultations, row.code); assert.equal((await dl(`&code=${row.code}&main=yes`)).length, row.main);
      assert.equal((await dl(`&code=${row.code}&sex=FEMALE`)).length, row.female); assert.equal((await dl(`&code=${row.code}&sex=MALE`)).length, row.male);
    }
    const dlines = await json(`${D}/lines?${range}&code=CA40`, dr);
    assert.deepEqual(dlines.columns.map(c => c.key), ['at', 'patientCode', 'nrc', 'sex', 'age', 'code', 'diagnosis', 'main', 'clinician']);
    assert.deepEqual(dlines.rows.map(x => [x.sex, x.main, x.clinician]), [['Female', 'Yes', 'Synthetic doctor'], ['Male', 'Yes', 'Synthetic doctor'], ['Female', 'No', 'Synthetic doctor']], 'newest first; the twice-recorded code is one main diagnosis');
    assert.equal((await json(`${D}/lines?${range}&code=CA40&names=1`, nurse)).rows[0].name, 'Grace Tembo'); ok();

    // Bad requests and who may open what.
    for (const [base, bad] of [[W, 'groupBy=year'], [W, 'seen=maybe'], [W, 'staff=not-an-id'], [W, 'servicePoint=x'], [D, 'code=bad code!'], [D, 'sex=X'], [D, 'ageBand=zz'], [D, 'main=no'], [D, 'from=2026-03-01']]) {
      for (const url of [`${base}?${bad}`, `${base}/lines?${bad}`]) { const res = await get(url, dr); assert.equal(res.status, 400, url); assert.ok((await res.json()).error.length > 10); }
    }
    for (const base of [W, D]) for (const [url, who, status] of [[`${base}?${range}`, desk, 200], [`${base}?${range}`, biller, 403], [`${base}?${range}`, undefined, 401], [`${base}/lines?${range}`, desk, 403], [`${base}/lines?${range}&names=1`, boss, 200], [`${base}/lines?${range}`, undefined, 401]]) assert.equal((await get(url, who)).status, status, url + ' ' + (who ? who.name : 'no login'));
    ok();

    // Excel and the registry.
    const sheets = async (url, user) => { const res = await get(url, user); assert.equal(res.status, 200, url); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer())); return wb; };
    let wb = await sheets(`${W}?${range}&format=xlsx`, desk); assert.deepEqual(wb.worksheets.map(w => w.name), ['Summary', 'Definitions']);
    wb = await sheets(`${D}?${range}&format=xlsx`, dr); assert.deepEqual(wb.worksheets.map(w => w.name), ['Summary', 'Line list', 'Definitions']);
    const logged = await db.reportExportLog.findMany({ orderBy: { at: 'asc' } }); assert.deepEqual(logged.map(x => [x.area, x.report, x.kind, x.rowCount]), [['attendance', 'workload', 'AGGREGATE', 2], ['attendance', 'diagnoses', 'LINE_LIST', 5]]);
    const att = async user => (await json('/reports/registry', user)).reports.filter(x => x.area === 'attendance').map(x => [x.name, x.lineList]);
    assert.deepEqual(await att(desk), [['attendance', false], ['busy-times', false], ['workload', false], ['diagnoses', false]]); assert.deepEqual(await att(biller), []); ok();

    console.log(checks + '/' + checks + ' workload and OPD diagnosis check groups passed. All writes used a disposable schema.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.$disconnect();
    if (created) { assert.match(schema, /^ses_workload_test_\d+_[a-f0-9]{8}$/); await admin.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE'); }
    await admin.$disconnect();
  }
}
