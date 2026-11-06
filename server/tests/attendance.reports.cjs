// Attendance: the new / re-attendance rule, the age and sex counts, grouping, the filters, the line list (names hidden by default),
// that every number can be traced to its records, and the Excel workbook with its log row. Disposable schema, real router, real tokens.
const assert = require('node:assert/strict'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'); require(root + '/node_modules/dotenv').config({ path: root + '/.env', quiet: true });
if (process.env.STOCK_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.STOCK_TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'attendance-test-secret';
require(root + '/node_modules/ts-node').register({ project: root + '/tsconfig.json', transpileOnly: true });
const { PrismaClient } = require(root + '/node_modules/@prisma/client');
const appPrisma = require(root + '/src/lib/prisma.ts'); // modules read `.default` at call time, so swapping it points every loaded module at the test schema
main().catch(e => { console.error(e); process.exitCode = 1; });

async function main() {
  const schema = 'ses_attendance_test_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  assert.match(schema, /^ses_attendance_test_\d+_[a-f0-9]{8}$/);
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
    const yearsAgo = (n, extraMonths = 0) => new Date(now.getFullYear() - n, now.getMonth() - extraMonths - 3, 15);   // three months of margin, so no birthday falls inside the test window
    const mk = (name, role) => db.user.create({ data: { name, email: name.toLowerCase().replace(/\s/g, '.') + '@example.test', password: 'x', role, status: 'active' } });
    const boss = await mk('Synthetic admin', 'admin'), dr = await mk('Synthetic doctor', 'clinician'), nurse = await mk('Synthetic nurse', 'nurse'), desk = await mk('Synthetic reception', 'receptionist'), biller = await mk('Synthetic biller', 'billing');
    const roomA = await db.facilityRoom.create({ data: { name: 'Consultation Room 1', tag: 'CR1' } }), roomB = await db.facilityRoom.create({ data: { name: 'Treatment room', tag: 'TR' } });
    const patient = (firstName, lastName, dateOfBirth, gender, nationalId = null) => db.patient.create({ data: { firstName, lastName, dateOfBirth, gender, nationalId } });
    const P1 = await patient('Mary', 'Phiri', yearsAgo(30), 'FEMALE', '123456/78/1'), P2 = await patient('John', 'Banda', yearsAgo(3), 'MALE', '222222/22/2'), P3 = await patient('Peter', 'Zulu', yearsAgo(70), 'MALE');
    const P4 = await patient('Baby', 'Mwale', yearsAgo(0, 6), 'FEMALE'), P5 = await patient('Alex', 'Tembo', yearsAgo(20), 'OTHER'), P6 = await patient('Joseph', 'Lungu', yearsAgo(40), 'MALE');
    let n = 0;
    const visit = (p, checkedInAt, room = roomA, extra = {}) => db.queueEntry.create({ data: { queueNumber: ++n, patientId: p.id, patientName: p.firstName + ' ' + p.lastName, roomId: room.id, status: 'Done', checkedInAt, ...extra } });
    const e1 = await visit(P1, ago(20)), e2 = await visit(P1, ago(5), roomB, { startedAt: ago(5, -10), startedById: nurse.id });
    await visit(P2, ago(3)); const e3 = await visit(P3, ago(2)); await visit(P4, ago(1)); await visit(P5, ago(4), roomB);
    await visit(P6, ago(400)); await visit(P6, ago(2), roomA);                         // history from before the period still makes the second visit a return
    await visit(P4, ago(10), roomA, { status: 'Removed' });                            // taken off the queue unseen: not an attendance, and not a first visit either
    await db.encounter.create({ data: { patientId: P3.id, clinicianId: dr.id, createdAt: ago(200) } });   // P3 was seen before, with no check-in on record

    const icd = await db.iCD11Code.create({ data: { code: 'BA00', description: 'Essential hypertension' } }), other = await db.iCD11Code.create({ data: { code: 'DA22.Z', description: 'Reflux disease' } });
    const enc = await db.encounter.create({ data: { patientId: P1.id, clinicianId: dr.id, createdAt: ago(5, -20) } });
    await db.encounterDiagnosis.create({ data: { encounterId: enc.id, icd11Id: other.id, isPrimary: false } }); await db.encounterDiagnosis.create({ data: { encounterId: enc.id, icd11Id: icd.id, isPrimary: true } });
    await db.encounter.create({ data: { patientId: P1.id, clinicianId: dr.id, createdAt: ago(5, -2000) } });   // a later day's consultation does not belong to the 5-days-ago visit

    const express = require(root + '/node_modules/express'), jwt = require(root + '/node_modules/jsonwebtoken'), ExcelJS = require(root + '/node_modules/exceljs');
    const app = express(); app.use(express.json()); app.use('/api', require(root + '/src/routes/index').default);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const get = (p, user) => fetch(origin + '/api' + p, { headers: user ? { authorization: 'Bearer ' + jwt.sign({ userId: user.id }, process.env.JWT_SECRET) } : {} });
    const json = async (p, user) => { const res = await get(p, user); assert.equal(res.status, 200, p); return res.json(); };
    const range = `from=${dayText(ago(30))}&to=${dayText(now)}`, A = '/reports/attendance/attendance';

    // The counts: 7 check-ins in the period, 4 first visits and 3 returns.
    let rep = await json(`${A}?${range}`, desk);
    assert.equal(rep.title, 'Attendance by age and sex'); assert.deepEqual(rep.columns.map(c => c.key), ['label', 'newMale', 'newFemale', 'newOther', 'newTotal', 'reMale', 'reFemale', 'reOther', 'reTotal', 'all'], 'the Other columns appear because someone is counted there');
    assert.deepEqual(rep.rows.map(x => x.label), ['Under 1', '1 to 4', '5 to 14', '15 to 24', '25 to 49', '50 and over']);
    const cell = (label, key) => rep.rows.find(x => x.label === label)[key];
    assert.deepEqual(rep.totals && [rep.totals.all, rep.totals.newTotal, rep.totals.reTotal], [7, 4, 3]);
    assert.deepEqual([cell('Under 1', 'newFemale'), cell('1 to 4', 'newMale'), cell('15 to 24', 'newOther'), cell('50 and over', 'reMale')], [1, 1, 1, 1]);
    assert.deepEqual(['newFemale', 'newTotal', 'reFemale', 'reMale', 'reTotal', 'all'].map(k => cell('25 to 49', k)), [1, 1, 1, 1, 2, 3], 'P1 new then returning, and P6 returning on history from before the period');
    for (const row of rep.rows) assert.equal(row.all, row.newTotal + row.reTotal), assert.equal(row.newTotal, row.newMale + row.newFemale + row.newOther);
    assert.deepEqual(rep.summary.map(s => [s.label, s.value]), [['Attendances', 7], ['New attendance', 4], ['Re-attendance', 3], ['New share (%)', 57]]); ok();

    // Filters narrow the counts; groupBy changes the rows.
    const total = async q => (await json(`${A}?${range}${q}`, desk)).totals.all;
    assert.equal(await total('&sex=FEMALE'), 3); assert.equal(await total('&sex=MALE'), 3); assert.equal(await total('&ageBand=25-49'), 3); assert.equal(await total(`&servicePoint=${roomB.id}`), 2); assert.equal(await total(`&servicePoint=${roomB.id}&sex=FEMALE`), 1);
    const day = await json(`${A}?${range}&groupBy=day`, desk);
    assert.equal(day.title, 'Attendance by day'); assert.equal(day.rows.length, 6, 'six different days'); assert.deepEqual(day.rows.map(x => x.key), [...day.rows.map(x => x.key)].sort()); assert.equal(day.totals.all, 7); assert.ok(day.rows.every(x => x.from === x.to));
    const week = await json(`${A}?${range}&groupBy=week`, desk), month = await json(`${A}?${range}&groupBy=month`, desk);
    assert.equal(week.rows.reduce((s, x) => s + x.all, 0), 7); assert.equal(month.rows.reduce((s, x) => s + x.all, 0), 7);
    assert.ok(week.rows.every(x => x.from >= dayText(ago(30)) && x.to <= dayText(now)), 'a week cut by the period only reaches as far as the period'); assert.match(week.rows[0].label, /^Week of /);
    const allTime = await json(A, desk); assert.equal(allTime.totals.all, 8, 'all time adds the visit 400 days ago'); assert.equal(allTime.period, 'All time'); ok();

    // Every number can be traced to its records: each cell of the matrix equals the rows of its line list.
    const lines = async q => json(`${A}/lines?${range}${q}`, dr);
    for (const band of ['u1', '1-4', '5-14', '15-24', '25-49', '50plus']) {
      const label = { u1: 'Under 1', '1-4': '1 to 4', '5-14': '5 to 14', '15-24': '15 to 24', '25-49': '25 to 49', '50plus': '50 and over' }[band];
      for (const [visit, prefix] of [['new', 'new'], ['re', 're']]) {
        for (const [sex, suffix] of [['MALE', 'Male'], ['FEMALE', 'Female'], ['OTHER', 'Other']]) assert.equal((await lines(`&ageBand=${band}&visit=${visit}&sex=${sex}`)).rows.length, cell(label, prefix + suffix), `${label} ${visit} ${sex}`);
        assert.equal((await lines(`&ageBand=${band}&visit=${visit}`)).rows.length, cell(label, prefix + 'Total'));
      }
    }
    assert.equal((await lines('')).rows.length, 7);
    const dayRow = day.rows[0]; assert.equal((await json(`${A}/lines?from=${dayRow.from}&to=${dayRow.to}`, dr)).rows.length, dayRow.all, 'a day row opens the records of that day'); ok();

    // The line list: newest first, names hidden, NRC masked, the first consultation's primary diagnosis, who saw them.
    let list = await lines('');
    assert.deepEqual(list.columns.map(c => c.key), ['time', 'patientCode', 'nrc', 'sex', 'age', 'visit', 'servicePoint', 'clinician', 'diagnosis']); assert.equal(list.columns.find(c => c.key === 'nrc').header, 'NRC (masked)');
    assert.deepEqual(list.rows.map(x => Date.parse(x.time)), list.rows.map(x => Date.parse(x.time)).sort((a, b) => b - a)); assert.equal(list.title, 'Attendance line list');
    const mary = list.rows.find(x => x.patientCode === 'SES-' + P1.id.replace(/-/g, '').slice(0, 8).toUpperCase() && x.visit === 'Re-attendance');
    assert.ok(mary); assert.deepEqual([mary.nrc, mary.sex, mary.age, mary.servicePoint, mary.clinician, mary.diagnosis], ['••••••/••/1', 'Female', 30, 'Treatment room', 'Synthetic nurse', 'Essential hypertension'], 'a later day\'s consultation is not used');
    assert.ok(list.rows.every(x => x.name === '' && !/[0-9]{3}/.test(x.nrc)), 'no names and no NRC digits');
    assert.equal(list.rows.find(x => x.visit === 'New attendance' && x.age === 3).nrc, '••••••/••/2'); assert.equal(list.rows.find(x => x.age === 70).nrc, '', 'no NRC on record is shown as blank');
    const first = list.rows.find(x => x.visit === 'New attendance' && x.sex === 'Female' && x.age === 30); assert.equal(first.diagnosis, '', 'the first visit had no consultation'); ok();

    // Names have to be asked for, and only by a clinical role.
    list = await json(`${A}/lines?${range}&names=1`, dr);
    assert.equal(list.columns.find(c => c.key === 'name').header, 'Name'); assert.equal(list.columns.find(c => c.key === 'nrc').header, 'NRC');
    assert.equal(list.rows.find(x => x.age === 3).name, 'John Banda'); assert.equal(list.rows.find(x => x.age === 3).nrc, '222222/22/2'); assert.deepEqual(list.filters.names, '1');
    assert.equal((await get(`${A}/lines?${range}&names=1`, nurse)).status, 200); assert.equal((await get(`${A}/lines?${range}&names=1`, boss)).status, 200);
    for (const who of [desk, biller]) { assert.equal((await get(`${A}/lines?${range}`, who)).status, 403, 'no line list'); assert.equal((await get(`${A}/lines?${range}&names=1`, who)).status, 403); }
    assert.equal((await get(`${A}/lines?${range}`)).status, 401); assert.equal((await get(`${A}?${range}`, biller)).status, 403, 'billing has no attendance counts'); ok();

    // A bad request is a readable 400 on both endpoints.
    for (const bad of ['sex=X', 'ageBand=zzz', 'groupBy=year', 'visit=maybe', 'servicePoint=not-an-id', 'from=2026-03-01', 'from=2026-03-02&to=2026-03-01']) {
      for (const url of [`${A}?${bad}`, `${A}/lines?${bad}`]) { const res = await get(url, dr); assert.equal(res.status, 400, url); assert.ok((await res.json()).error.length > 10); }
    }
    ok();

    // Excel: the counts, the line list and the definitions, and what each person may take.
    const sheets = async (url, user) => { const res = await get(url, user); assert.equal(res.status, 200, url); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer())); return wb; };
    assert.equal(await db.reportExportLog.count(), 0);
    let wb = await sheets(`${A}?${range}&format=xlsx`, desk);
    assert.deepEqual(wb.worksheets.map(w => w.name), ['Summary', 'Definitions'], 'reception has the counts only');
    let logged = await db.reportExportLog.findMany(); assert.deepEqual([logged.length, logged[0].kind, logged[0].area], [1, 'AGGREGATE', 'attendance']);
    wb = await sheets(`${A}?${range}&format=xlsx`, dr);
    assert.deepEqual(wb.worksheets.map(w => w.name), ['Summary', 'Line list', 'Definitions']);
    const header = wb.getWorksheet('Line list').getRow(6).values.slice(1); assert.ok(header.includes('NRC (masked)') && !header.includes('Name'));
    assert.match(JSON.stringify(wb.getWorksheet('Definitions').getSheetValues()), /first visit to this facility/); assert.equal(wb.getWorksheet('Summary').getRow(7).getCell(1).value, 'Under 1');
    wb = await sheets(`${A}?${range}&format=xlsx&names=1`, dr); assert.ok(wb.getWorksheet('Line list').getRow(6).values.includes('Name'));
    wb = await sheets(`${A}/lines?${range}&format=xlsx&visit=re`, dr); assert.deepEqual(wb.worksheets.map(w => w.name), ['Line list', 'Definitions']); assert.equal(wb.getWorksheet('Line list').rowCount > 6, true);
    logged = await db.reportExportLog.findMany({ orderBy: { at: 'asc' } });
    assert.deepEqual(logged.map(x => [x.kind, x.rowCount]), [['AGGREGATE', 6], ['LINE_LIST', 7], ['LINE_LIST', 7], ['LINE_LIST', 3]]);
    assert.deepEqual(logged[2].filters.names, '1'); assert.deepEqual(logged[3].filters.visit, 're'); assert.equal(logged[3].userId, dr.id);
    assert.equal((await get(`${A}?${range}&format=xlsx&names=1`, desk)).status, 200, 'reception asking for names only gets the counts');
    assert.equal((await get(`${A}/lines?${range}&format=xlsx`, desk)).status, 403); assert.equal((await get(`${A}?${range}&format=xlsx`, biller)).status, 403); ok();

    // The registry tells the screen what this person can do.
    const reports = list => list.reports.find(x => x.area === 'attendance');
    assert.deepEqual([reports(await json('/reports/registry', desk)).lineList, reports(await json('/reports/registry', desk)).canSeeNames], [false, false]);
    assert.deepEqual([reports(await json('/reports/registry', dr)).lineList, reports(await json('/reports/registry', dr)).canSeeNames, reports(await json('/reports/registry', dr)).canExport], [true, true, true]); ok();

    console.log(checks + '/' + checks + ' attendance report check groups passed. All writes used a disposable schema.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.$disconnect();
    if (created) { assert.match(schema, /^ses_attendance_test_\d+_[a-f0-9]{8}$/); await admin.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE'); }
    await admin.$disconnect();
  }
}
