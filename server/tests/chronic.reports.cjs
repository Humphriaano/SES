// Chronic diseases: the register, overdue and defaulters, the line lists behind every number, the condition list as reviewed data, and the Excel
// workbook. Disposable schema, real router, real tokens.
const assert = require('node:assert/strict'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'); require(root + '/node_modules/dotenv').config({ path: root + '/.env', quiet: true });
if (process.env.STOCK_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.STOCK_TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chronic-test-secret';
require(root + '/node_modules/ts-node').register({ project: root + '/tsconfig.json', transpileOnly: true });
const { PrismaClient } = require(root + '/node_modules/@prisma/client');
const appPrisma = require(root + '/src/lib/prisma.ts'); // modules read `.default` at call time, so swapping it points every loaded module at the test schema
main().catch(e => { console.error(e); process.exitCode = 1; });

async function main() {
  const schema = 'ses_chronic_test_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  assert.match(schema, /^ses_chronic_test_\d+_[a-f0-9]{8}$/);
  const url = new URL(process.env.DATABASE_URL); url.searchParams.set('schema', schema);
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  let db, server, created = false, checks = 0; const ok = () => { checks++; };
  try {
    await admin.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"'); created = true;
    const r = spawnSync(process.execPath, [root + '/node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: root, env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8', windowsHide: true });
    if (r.status) throw Error(r.stdout + '\n' + r.stderr);
    db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    Object.defineProperty(appPrisma, 'default', { value: db, configurable: true });

    const now = new Date(), ago = (days, minutes = 0) => new Date(now.getTime() - days * 86400000 - minutes * 60000), ahead = days => new Date(now.getTime() + days * 86400000);
    const dayText = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const born = years => new Date(now.getFullYear() - years, now.getMonth() - 3, 15);
    const mk = (name, role) => db.user.create({ data: { name, email: name.toLowerCase().replace(/\s/g, '.') + '@example.test', password: 'x', role, status: 'active' } });
    const boss = await mk('Synthetic admin', 'admin'), dr = await mk('Synthetic doctor', 'clinician'), nurse = await mk('Synthetic nurse', 'nurse'), desk = await mk('Synthetic reception', 'receptionist'), biller = await mk('Synthetic biller', 'billing');
    const room = await db.facilityRoom.create({ data: { name: 'Consultation Room 1', tag: 'CR1' } });
    const patient = (firstName, dateOfBirth, gender, nationalId = null) => db.patient.create({ data: { firstName, lastName: 'Chronic', dateOfBirth, gender, nationalId } });
    const A = await patient('Anna', born(50), 'FEMALE', '111111/11/1'), B = await patient('Bwalya', born(70), 'MALE', '222222/22/2'), C = await patient('Chola', born(3), 'FEMALE'), D = await patient('Daka', born(45), 'MALE'), E = await patient('Esther', born(30), 'FEMALE'), F = await patient('Felix', born(60), 'MALE');
    const code = {}; for (const [c, d] of [['BA00', 'Essential hypertension'], ['5A11', 'Type 2 diabetes mellitus'], ['CA23.3', 'Unspecified asthma'], ['3A51.0', 'Sickle cell trait'], ['3A51.1', 'Sickle cell disease without crisis'], ['DA22.Z', 'Reflux disease'], ['FA25', 'Gout']]) code[c] = await db.iCD11Code.create({ data: { code: c, description: d } });
    const dx = (p, c, createdAt, extra = {}) => db.patientDiagnosis.create({ data: { patientId: p.id, icd11Id: code[c].id, createdAt, ...extra } });
    await dx(A, 'BA00', ago(400), { diagnosedAt: new Date('2016-03-01') }); await dx(A, '5A11', ago(300)); await dx(B, 'BA00', ago(400)); await dx(B, '3A51.1', ago(400));
    await dx(C, 'CA23.3', ago(10), { resolvedAt: ago(10) }); await dx(C, '3A51.0', ago(10)); await dx(D, 'BA00', ago(3)); await dx(E, 'BA00', ago(20)); await dx(F, 'BA00', ago(500), { resolvedAt: ago(400) });
    let n = 0; const checkin = (p, checkedInAt, status = 'Done') => db.queueEntry.create({ data: { queueNumber: ++n, patientId: p.id, patientName: p.firstName, roomId: room.id, status, checkedInAt } });
    await checkin(A, ago(10)); await checkin(D, ago(100)); await checkin(D, ago(5), 'Removed');                        // a removed check-in is not a visit
    await db.encounter.create({ data: { patientId: B.id, clinicianId: dr.id, createdAt: ago(200) } });              // a consultation is a visit too
    const bp = (p, s, d, at) => db.vital.create({ data: { patientId: p.id, bloodPressureSystolic: s, bloodPressureDiastolic: d, recordedAt: at } });
    await bp(A, 170, 100, ago(50)); await bp(A, 130, 80, ago(1)); await bp(B, 160, 100, ago(100)); await bp(D, 150, 95, ago(2));
    const appt = (p, scheduledAt, status) => db.appointment.create({ data: { patientId: p.id, scheduledAt, status } });
    await appt(A, ahead(10), 'SCHEDULED'); await appt(B, ahead(5), 'CANCELLED'); await appt(D, ahead(7), 'CONFIRMED'); await appt(E, ago(5), 'SCHEDULED');   // cancelled and past ones do not count
    const med = (p, name, dosage, startDate, endDate = null) => db.medication.create({ data: { patientId: p.id, name, dosage, startDate, endDate } });
    await med(A, 'Amlodipine', '5 mg', ago(100)); await med(A, 'Old drug', '1 mg', ago(300), ago(100)); await med(A, 'Metformin', '500 mg', ago(90)); await med(B, 'Not yet', '1 mg', ahead(5));

    const express = require(root + '/node_modules/express'), jwt = require(root + '/node_modules/jsonwebtoken'), ExcelJS = require(root + '/node_modules/exceljs');
    const app = express(); app.use(express.json()); app.use('/api', require(root + '/src/routes/index').default);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const call = (method, p, user, body) => fetch(origin + '/api' + p, { method, headers: { ...(user ? { authorization: 'Bearer ' + jwt.sign({ userId: user.id }, process.env.JWT_SECRET) } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const get = (p, user) => call('GET', p, user);
    const json = async (p, user) => { const res = await get(p, user); assert.equal(res.status, 200, p); return res.json(); };
    const month = `from=${dayText(ago(30))}&to=${dayText(now)}`, REG = '/reports/chronic/register', OVD = '/reports/chronic/overdue';

    // The register: counts per condition from the stored list.
    const reg = await json(`${REG}?${month}`, desk), row = k => reg.rows.find(x => x.key === k);
    assert.equal(reg.title, 'Chronic disease register'); assert.equal(reg.rows.length, 10); assert.deepEqual(reg.columns.map(c => c.key), ['label', 'active', 'female', 'male', 'new', 'resolved', 'seen', 'overdue', 'controlled', 'notControlled', 'noReading']);
    const h = row('hypertension');
    assert.deepEqual(['active', 'female', 'male', 'new', 'resolved', 'seen', 'overdue', 'controlled', 'notControlled', 'noReading'].map(k => h[k]), [4, 2, 2, 2, 0, 1, 3, 1, 1, 2], 'hypertension');
    assert.deepEqual([h.booked, h.never, h.b120, h.b365], [1, 1, 1, 1], 'appointments, no visit, and how long overdue');
    assert.deepEqual([row('diabetes').active, row('diabetes').seen, row('diabetes').overdue, row('diabetes').controlled], [1, 1, 0, 0], 'no control rule for diabetes');
    assert.deepEqual([row('asthma').active, row('asthma').resolved, row('asthma').new], [0, 1, 1]); assert.deepEqual([row('sickle_cell').active, row('sickle_cell').overdue], [1, 1], 'the trait is excluded'); assert.equal(row('copd').active, 0);
    assert.deepEqual([reg.totals.active, reg.totals.overdue, reg.totals.label], [6, 4, 'All conditions']);
    assert.deepEqual(reg.summary.map(s => s.value), [4, 2, 2, 4]); ok();

    // All time counts every entry, a visit means a check-in that was not removed or a consultation, and an old reading is not a control.
    const all = await json(REG, desk); assert.equal(all.rows.find(x => x.key === 'hypertension').new, 5); assert.equal(all.rows.find(x => x.key === 'hypertension').resolved, 1); assert.equal(all.columns.find(c => c.key === 'new').header, 'Recorded');
    assert.equal((await json(`${REG}?condition=hypertension`, desk)).rows.length, 1); ok();

    // Overdue and defaulters.
    const ovd = await json(OVD, desk), oh = ovd.rows.find(x => x.key === 'hypertension');
    assert.deepEqual(['active', 'overdue', 'booked', 'b120', 'b180', 'b365', 'over', 'never'].map(k => oh[k]), [4, 3, 1, 1, 0, 1, 0, 1]);
    assert.equal(oh.b120 + oh.b180 + oh.b365 + oh.over + oh.never, oh.overdue, 'every overdue patient is in a group');
    assert.deepEqual(ovd.summary.map(s => [s.label, s.value]), [['Active patient-conditions', 6], ['Overdue', 4], ['Overdue (%)', 67], ['Overdue with an appointment booked', 1]]); assert.equal(ovd.period, 'As at today'); ok();

    // Every number can be traced to its records: each register cell equals its line list, for every condition and measure.
    const lines = q => json(`${REG}/lines?${month}${q}`, dr);
    const keys = reg.rows.map(x => x.key), measures = ['active', 'female', 'male', 'new', 'resolved', 'seen', 'overdue', 'controlled', 'notControlled', 'noReading'];
    for (const key of keys) for (const m of measures) assert.equal((await lines(`&condition=${key}&measure=${m}`)).rows.length, row(key)[m], `${key} ${m}`);
    for (const m of ['active', 'overdue', 'seen']) assert.equal((await lines(`&measure=${m}`)).rows.length, reg.totals[m]);
    assert.equal((await lines('&measure=other')).rows.length, 0);
    for (const key of keys) assert.equal((await json(`${OVD}/lines?condition=${key}`, dr)).rows.length, ovd.rows.find(x => x.key === key).overdue, 'overdue ' + key);
    assert.equal((await lines('&status=active')).rows.length, 6); assert.equal((await lines('&status=resolved')).rows.length, 2); assert.equal((await lines('&status=any')).rows.length, 8);
    assert.equal((await lines('&condition=hypertension&seen=overdue')).rows.length, 3); assert.equal((await lines('&condition=hypertension&control=notControlled')).rows.length, 1); ok();

    // The overdue line list: longest first, what each person needs to be followed up.
    let list = await json(`${OVD}/lines`, dr);
    assert.deepEqual(list.rows.map(x => [x.condition, x.daysSince]), [['Hypertension', null], ['Hypertension', 200], ['Sickle cell disease', 200], ['Hypertension', 100]], 'never seen first, then longest, ties by condition');
    assert.deepEqual(list.columns.map(c => c.key), ['patientCode', 'nrc', 'sex', 'age', 'condition', 'status', 'diagnosed', 'lastVisit', 'daysSince', 'lastBp', 'medicines', 'followUp', 'nextAppointment']);
    const [e, b, , d] = list.rows;
    assert.deepEqual([e.lastVisit, e.lastBp, e.nextAppointment, e.followUp, e.sex, e.nrc], ['No visit on record', 'No reading on record', 'None booked', 'Overdue', 'Female', ''], 'never seen');
    assert.match(b.lastBp, /^160\/100, taken .* \(over 90 days ago\)$/); assert.equal(b.nextAppointment, 'None booked', 'a cancelled appointment is not one'); assert.equal(b.nrc, '••••••/••/2'); assert.equal(b.medicines, '', 'a medicine that has not started is not current');
    assert.equal(d.lastBp, '150/95 at or above 140/90'); assert.notEqual(d.nextAppointment, 'None booked', 'a confirmed future appointment is shown');
    assert.deepEqual(list.rows.map(x => x.name), ['', '', '', ''], 'no names unless asked');
    list = await lines('&condition=hypertension&measure=active');
    const anna = list.rows.find(x => x.age === 50);
    assert.deepEqual([anna.diagnosed, anna.lastBp, anna.medicines, anna.followUp, anna.status], ['2016', '130/80 under 140/90', 'Amlodipine 5 mg; Metformin 500 mg', 'Seen', 'Active'], 'the old medicine and the older reading are left out');
    assert.equal(list.rows.find(x => x.age === 30).diagnosed, String(ago(20).getFullYear()), 'recorded year when no diagnosis year is known'); ok();

    // Names have to be asked for, and only by a clinical role.
    list = await json(`${OVD}/lines?names=1`, dr); assert.ok(list.columns.some(c => c.key === 'name') && list.rows.some(x => x.name === 'Bwalya Chronic' && x.nrc === '222222/22/2'));
    assert.equal((await get(`${OVD}/lines?names=1`, nurse)).status, 200);
    for (const who of [desk, biller]) { assert.equal((await get(`${REG}/lines`, who)).status, 403); assert.equal((await get(`${OVD}/lines?names=1`, who)).status, 403); }
    assert.equal((await get(`${REG}?${month}`, biller)).status, 403); assert.equal((await get(`${REG}/lines`)).status, 401);
    for (const bad of ['condition=nothing', 'measure=zzz', 'status=x', 'seen=maybe', 'control=zzz', 'from=2026-03-01']) for (const u of [REG, OVD, `${REG}/lines`, `${OVD}/lines`]) assert.equal((await get(`${u}?${bad}`, dr)).status, 400, `${u}?${bad}`); ok();

    // The overview uses the same figures.
    const ov = await json(`/reports/population/overview?${month}`, dr), oc = ov.chronic.rows.find(x => x.key === 'hypertension');
    assert.deepEqual([oc.active, oc.seenRecently, oc.notSeenRecently, oc.bpControl.controlled, oc.bpControl.noRecentReading], [4, 1, 3, 1, 2]); assert.deepEqual([ov.chronic.patientsWithAny, ov.chronic.patientsWithSeveral], [4, 2]); assert.deepEqual(ov.chronic.reviewed, { done: 0, total: 10 }); ok();

    // Excel: the counts, the records and the definitions; line list exports are logged as such.
    const book = async (u, user) => { const res = await get(u, user); assert.equal(res.status, 200, u); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer())); return wb; };
    let wb = await book(`${REG}?${month}&format=xlsx`, dr);
    assert.deepEqual(wb.worksheets.map(w => w.name), ['Summary', 'Line list', 'Definitions']); assert.match(JSON.stringify(wb.getWorksheet('Definitions').getSheetValues()), /Overdue: active and not seen in 90 days/);
    assert.equal(wb.getWorksheet('Summary').getRow(7).getCell(1).value, 'Hypertension'); assert.equal(wb.getWorksheet('Summary').getRow(7).getCell(2).value, 4);
    wb = await book(`${OVD}?format=xlsx`, desk); assert.deepEqual(wb.worksheets.map(w => w.name), ['Summary', 'Definitions']);
    wb = await book(`${OVD}/lines?format=xlsx&condition=hypertension`, dr); assert.deepEqual(wb.worksheets.map(w => w.name), ['Line list', 'Definitions']);
    assert.deepEqual((await db.reportExportLog.findMany({ orderBy: { at: 'asc' } })).map(x => [x.area, x.report, x.kind]), [['chronic', 'register', 'LINE_LIST'], ['chronic', 'overdue', 'AGGREGATE'], ['chronic', 'overdue', 'LINE_LIST']]); ok();

    // The condition list is data: anyone clinical reads it, only an admin changes it, and a change clears the review and is written to a history.
    let res = await get('/chronic-conditions', dr); const listed = (await res.json()).conditions;
    assert.equal(listed.length, 10); assert.ok(listed.every(c => c.reviewedAt === null)); assert.deepEqual(listed.find(c => c.key === 'sickle_cell').exclude, ['3A51.0']);
    for (const who of [desk, biller]) assert.equal((await get('/chronic-conditions', who)).status, 403);
    const copd = listed.find(c => c.key === 'copd'), asthma = listed.find(c => c.key === 'asthma');
    for (const who of [dr, nurse, desk]) { assert.equal((await call('PATCH', '/chronic-conditions/' + copd.id, who, { active: false })).status, 403); assert.equal((await call('POST', '/chronic-conditions', who, { label: 'Gout', prefixes: ['FA25'] })).status, 403); }
    res = await call('PATCH', '/chronic-conditions/' + copd.id, boss, { reviewed: true }); const reviewed = await res.json();
    assert.equal(res.status, 200); assert.ok(reviewed.reviewedAt); assert.equal(reviewed.reviewedBy, 'Synthetic admin');
    assert.deepEqual((await json(`/reports/population/overview?${month}`, dr)).chronic.reviewed, { done: 1, total: 10 });
    res = await call('PATCH', '/chronic-conditions/' + copd.id, boss, { prefixes: ['DA22'] }); const edited = await res.json();
    assert.equal(res.status, 200); assert.deepEqual(edited.prefixes, ['DA22']); assert.equal(edited.reviewedAt, null, 'changing a definition clears its review');
    await db.patientDiagnosis.create({ data: { patientId: A.id, icd11Id: code['DA22.Z'].id } });
    assert.equal((await json(`${REG}?${month}`, desk)).rows.find(x => x.key === 'copd').active, 1, 'the report follows the stored list');
    for (const bad of [{ prefixes: ['zz!'] }, { prefixes: ['QQ99'] }, { prefixes: [] }, { prefixes: 'BA00' }, { label: 'x' }, { exclude: ['QQ99'] }, {}]) assert.equal((await call('PATCH', '/chronic-conditions/' + copd.id, boss, bad)).status, 400, JSON.stringify(bad));
    assert.equal((await call('PATCH', '/chronic-conditions/00000000-0000-0000-0000-000000000000', boss, { active: false })).status, 404);
    await call('PATCH', '/chronic-conditions/' + copd.id, boss, { active: false });
    assert.equal((await json(`${REG}?${month}`, desk)).rows.some(x => x.key === 'copd'), false, 'a switched-off condition leaves every report'); assert.equal((await get(`${REG}?condition=copd`, dr)).status, 400);
    res = await call('POST', '/chronic-conditions', boss, { label: 'Gout', prefixes: ['fa25'] }); const gout = await res.json();
    assert.equal(res.status, 201); assert.deepEqual([gout.key, gout.prefixes, gout.reviewedAt], ['gout', ['FA25'], null]);
    assert.equal((await call('POST', '/chronic-conditions', boss, { label: 'Gout', prefixes: ['FA25'] })).status, 409); assert.equal((await call('POST', '/chronic-conditions', boss, { label: 'No codes', prefixes: [] })).status, 400);
    assert.equal((await json(`${REG}?${month}`, desk)).rows.find(x => x.key === 'gout').active, 0);
    await call('PATCH', '/chronic-conditions/' + asthma.id, boss, { label: 'Asthma (all ages)' }); assert.equal((await json(`${REG}?${month}`, desk)).rows.find(x => x.key === 'asthma').label, 'Asthma (all ages)'); ok();

    // The history keeps every change, and cannot itself be changed.
    const history = await db.chronicConditionHistory.findMany({ where: { conditionId: copd.id }, orderBy: { at: 'asc' } });
    assert.deepEqual(history.map(x => x.action), ['REVIEW', 'UPDATE', 'UPDATE']); assert.deepEqual(history[1].before.prefixes, ['CA22']); assert.deepEqual(history[1].after.prefixes, ['DA22']); assert.equal(history[1].userId, boss.id);
    assert.equal((await db.chronicConditionHistory.findMany({ where: { conditionId: gout.id } })).map(x => x.action).join(), 'CREATE');
    await assert.rejects(db.chronicConditionHistory.update({ where: { id: history[0].id }, data: { action: 'UPDATE' } }), /cannot be changed or deleted/);
    await assert.rejects(db.chronicConditionHistory.deleteMany({}), /cannot be changed or deleted/); ok();

    console.log(checks + '/' + checks + ' chronic report check groups passed. All writes used a disposable schema.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.$disconnect();
    if (created) { assert.match(schema, /^ses_chronic_test_\d+_[a-f0-9]{8}$/); await admin.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE'); }
    await admin.$disconnect();
  }
}
