// Population reports: who may open them, the date range, the exact figures, the chronic disease register and the Excel export.
// Everything runs in a disposable schema that is dropped afterwards, through the real router and real signed tokens.
const assert = require('node:assert/strict'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'); require(root + '/node_modules/dotenv').config({ path: root + '/.env', quiet: true });
if (process.env.STOCK_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.STOCK_TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'population-reports-test-secret';
require(root + '/node_modules/ts-node').register({ project: root + '/tsconfig.json', transpileOnly: true });
const { PrismaClient } = require(root + '/node_modules/@prisma/client');
const appPrisma = require(root + '/src/lib/prisma.ts'); // modules read `.default` at call time, so swapping it points every loaded module at the test schema
main().catch(e => { console.error(e); process.exitCode = 1; });

async function main() {
  const schema = 'ses_population_test_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  assert.match(schema, /^ses_population_test_\d+_[a-f0-9]{8}$/);
  const url = new URL(process.env.DATABASE_URL); url.searchParams.set('schema', schema);
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  let db, server, created = false, checks = 0; const ok = () => { checks++; };
  try {
    await admin.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"'); created = true;
    const r = spawnSync(process.execPath, [root + '/node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: root, env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8', windowsHide: true });
    if (r.status) throw Error(r.stdout + '\n' + r.stderr);
    db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    Object.defineProperty(appPrisma, 'default', { value: db, configurable: true });

    const now = new Date(), ago = (days, hours = 0) => new Date(now.getTime() - days * 86400000 - hours * 3600000);
    const dayText = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const years = n => new Date(now.getFullYear() - n, now.getMonth(), Math.min(now.getDate(), 28));
    const mk = (name, role) => db.user.create({ data: { name, email: name.toLowerCase().replace(/\s/g, '.') + '@example.test', password: 'x', role, status: 'active' } });
    const dr = await mk('Synthetic doctor', 'clinician'), billing = await mk('Synthetic biller', 'billing'), desk = await mk('Synthetic reception', 'receptionist'), nobody = await mk('Synthetic visitor', 'visitor');
    const jwt = require(root + '/node_modules/jsonwebtoken'), token = u => jwt.sign({ userId: u.id }, process.env.JWT_SECRET);

    // Four patients: A (30, F) and D (45, M) are seen recently, B (70, M) was last seen long ago, C (3, F) has only a resolved asthma entry.
    const mkPatient = (firstName, dateOfBirth, gender) => db.patient.create({ data: { firstName, lastName: 'Report', dateOfBirth, gender } });
    const A = await mkPatient('A', years(30), 'FEMALE'), B = await mkPatient('B', years(70), 'MALE'), C = await mkPatient('C', years(3), 'FEMALE'), D = await mkPatient('D', years(45), 'MALE');
    const icd = {};
    for (const [code, description] of [['BA00', 'Essential hypertension'], ['5A11', 'Type 2 diabetes mellitus'], ['CA23.3', 'Unspecified asthma'], ['3A51.0', 'Sickle cell trait'], ['3A51.1', 'Sickle cell disease without crisis'], ['DA22.Z', 'Gastro-oesophageal reflux disease']]) icd[code] = await db.iCD11Code.create({ data: { code, description } });
    const dx = (patient, code, createdAt, resolvedAt = null) => db.patientDiagnosis.create({ data: { patientId: patient.id, icd11Id: icd[code].id, createdAt, resolvedAt } });
    await dx(A, 'BA00', ago(40)); await dx(A, '5A11', ago(5)); await dx(B, 'BA00', ago(200)); await dx(B, '3A51.1', ago(2));
    await dx(C, 'CA23.3', ago(10), ago(1)); await dx(C, '3A51.0', ago(10)); await dx(D, 'BA00', ago(3)); await dx(D, 'DA22.Z', ago(3));
    const visit = (patient, createdAt) => db.encounter.create({ data: { patientId: patient.id, clinicianId: dr.id, createdAt } });
    const encA = await visit(A, ago(10)), encB = await visit(B, ago(200)), encD = await visit(D, ago(2));
    const bp = (patient, bloodPressureSystolic, bloodPressureDiastolic, recordedAt) => db.vital.create({ data: { patientId: patient.id, bloodPressureSystolic, bloodPressureDiastolic, recordedAt } });
    await bp(A, 170, 100, ago(50)); await bp(A, 130, 80, ago(1));   // the latest reading counts, not the worst
    await bp(B, 160, 100, ago(100));                                  // older than 90 days: no recent reading
    await bp(D, 150, 95, ago(2));

    const proc = (data) => db.encounterProcedure.create({ data: { encounterId: encA.id, patientId: A.id, name: 'Suturing', ...data } });
    let n = 0; const cid = () => 'c' + (++n);
    await proc({ clientId: cid(), name: 'Suturing', performedById: dr.id, performedAt: ago(1) });                                                                           // done directly
    await proc({ clientId: cid(), name: 'Cannulation', orderedById: dr.id, orderedAt: ago(1, 0.5), performedById: dr.id, performedAt: ago(1) });                            // waited 30 min
    await proc({ clientId: cid(), name: 'Cannulation', orderedById: dr.id, orderedAt: ago(1, 2), performedById: dr.id, performedAt: ago(1) });                              // waited 120 min
    await proc({ clientId: cid(), name: 'Dressing', status: 'ORDERED', priority: 'URGENT', orderedById: dr.id, orderedAt: ago(0, 3) });
    await proc({ clientId: cid(), name: 'Dressing', status: 'ORDERED', orderedById: dr.id, orderedAt: ago(0, 1) });
    await proc({ clientId: cid(), name: 'Catheter', status: 'RETURNED', orderedById: dr.id, orderedAt: ago(2), removedAt: ago(1), removedById: dr.id, removeReason: 'Patient refused' });
    await proc({ clientId: cid(), name: 'Suturing', performedById: dr.id, performedAt: ago(100) });                                                                          // done long ago
    const order = (patient, orderedAt, items) => db.investigationOrder.create({ data: { patientId: patient.id, orderedById: dr.id, orderedAt, items: { create: items.map(([type, status]) => ({ type, catalogueId: type, name: type, status })) } } });
    await order(A, ago(2), [['FBC', 'Pending'], ['Malaria RDT', 'Resulted']]); await order(B, ago(300), [['FBC', 'Resulted']]);
    const drug = (dispensedDrug, dispensedAt, patient) => db.dispensing.create({ data: { patientId: patient.id, dispensedDrug, dispensedBy: dr.id, dispensedAt } });
    await drug('Paracetamol', ago(1), A); await drug('Paracetamol', ago(1), D); await drug('Amoxicillin', ago(200), B);

    const express = require(root + '/node_modules/express');
    const app = express(); app.use(express.json()); app.use('/api', require(root + '/src/routes/index').default);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const get = (p, user) => fetch(origin + '/api' + p, { headers: user ? { authorization: 'Bearer ' + token(user) } : {} });
    const month = `from=${dayText(ago(30))}&to=${dayText(now)}`;

    // Only a signed-in person with a reports role gets any figure, including the older endpoints the chat service reads.
    for (const p of ['/overview', '/export', '/chronic', '/kpis', '/diagnoses', '/vitals', '/medications', '/investigations', '/patients']) {
      assert.equal((await get('/reports/population' + p)).status, 401, p + ' needs a login');
      assert.equal((await get('/reports/population' + p, billing)).status, 403, p + ' is closed to the billing role');
      assert.equal((await get('/reports/population' + p, nobody)).status, 403, p + ' is closed to a role the page does not offer reports to');
    }
    assert.equal((await get('/reports/population/overview', desk)).status, 200); assert.equal((await get('/reports/population/kpis', dr)).status, 200); ok();

    // Dates: whole days, both ends given, a real calendar day, in order.
    for (const bad of ['from=2026-01-01', 'to=2026-01-01', 'from=2026-13-01&to=2026-12-01', 'from=2026-02-31&to=2026-03-01', 'from=abc&to=def', 'from=2026-03-02&to=2026-03-01']) {
      const res = await get('/reports/population/overview?' + bad, dr); assert.equal(res.status, 400, bad); assert.ok((await res.json()).error.length > 10);
      assert.equal((await get('/reports/population/export?' + bad, dr)).status, 400, 'export: ' + bad);
    }
    ok();

    // The last 30 days.
    let o = await (await get('/reports/population/overview?' + month, dr)).json();
    assert.equal(o.period.allTime, false); assert.equal(o.period.from, dayText(ago(30))); assert.equal(o.period.to, dayText(now));
    assert.equal(o.patients.total, 4); assert.equal(o.patients.newInPeriod, 4); assert.equal(o.patients.female, 2); assert.equal(o.patients.male, 2);
    assert.deepEqual(o.patients.byAge.map(b => [b.band, b.total]), [['0-4', 1], ['5-17', 0], ['18-35', 1], ['36-50', 1], ['51-64', 0], ['65+', 1]]);
    assert.deepEqual(o.patients.byAge.find(b => b.band === '65+'), { band: '65+', female: 0, male: 1, other: 0, total: 1 }); ok();
    assert.equal(o.diagnoses.total, 6, 'the older hypertension entries fall outside the period'); assert.equal(o.diagnoses.top.length, 6);
    assert.ok(o.diagnoses.top.every(d => d.count === 1) && o.diagnoses.top.some(d => d.code === '5A11' && d.description === 'Type 2 diabetes mellitus')); ok();
    assert.equal(o.medications.dispensed, 2); assert.deepEqual(o.medications.top, [{ name: 'Paracetamol', count: 2 }]); assert.equal(o.medications.dispensedToday, 0); ok();
    assert.deepEqual(o.investigations.byStatus.map(s => [s.status, s.count]).sort(), [['Pending', 1], ['Resulted', 1]]);
    assert.deepEqual(o.investigations.waiting, { pending: 1, inProgress: 0 }, 'what is waiting now ignores the period'); ok();
    assert.equal(o.procedures.done, 3); assert.equal(o.procedures.doneViaRoom, 2); assert.equal(o.procedures.medianWaitMinutes, 75);
    assert.equal(o.procedures.sentToRoom, 5); assert.equal(o.procedures.returned, 1);
    assert.equal(o.procedures.waiting.total, 2); assert.equal(o.procedures.waiting.urgent, 1); assert.ok(Math.abs(Date.parse(o.procedures.waiting.oldestOrderedAt) - ago(0, 3).getTime()) < 5000);
    assert.deepEqual(o.procedures.top, [{ name: 'Cannulation', count: 2 }, { name: 'Suturing', count: 1 }]); ok();

    // The same questions over all time.
    const all = await (await get('/reports/population/overview', dr)).json();
    assert.equal(all.period.allTime, true); assert.equal(all.period.label, 'All time'); assert.equal(all.patients.newInPeriod, null);
    assert.equal(all.diagnoses.total, 8); assert.equal(all.medications.dispensed, 3); assert.equal(all.procedures.done, 4);
    assert.deepEqual(all.investigations.byStatus.map(s => [s.status, s.count]).sort(), [['Pending', 1], ['Resulted', 2]]); ok();

    // A range with nothing in it is zeros, not an error.
    const empty = await (await get(`/reports/population/overview?from=${dayText(ago(400))}&to=${dayText(ago(300))}`, dr)).json();
    assert.equal(empty.diagnoses.total, 0); assert.equal(empty.patients.newInPeriod, 0); assert.equal(empty.medications.dispensed, 0); assert.equal(empty.procedures.done, 0); assert.equal(empty.procedures.medianWaitMinutes, null);
    assert.deepEqual(empty.procedures.top, []); ok();

    // Chronic diseases: counted from ICD-11 codes; the trait is not the disease; a resolved entry is not active; the latest reading decides control.
    const row = key => o.chronic.rows.find(x => x.key === key);
    assert.equal(o.chronic.rows.length, 10); assert.equal(o.chronic.patientsWithAny, 3); assert.equal(o.chronic.patientsWithSeveral, 2);
    const htn = row('hypertension');
    assert.deepEqual([htn.active, htn.newInPeriod, htn.female, htn.male, htn.under18, htn.adults, htn.older], [3, 1, 1, 2, 0, 2, 1]);
    assert.deepEqual([htn.seenRecently, htn.notSeenRecently], [2, 1]);
    assert.deepEqual(htn.bpControl, { controlled: 1, notControlled: 1, noRecentReading: 1 });
    assert.equal(row('diabetes').active, 1); assert.equal(row('diabetes').bpControl, null);
    assert.equal(row('asthma').active, 0, 'resolved'); assert.equal(row('asthma').newInPeriod, 1);
    assert.deepEqual([row('sickle_cell').active, row('sickle_cell').male, row('sickle_cell').newInPeriod], [1, 1, 1], 'the trait is not counted'); assert.equal(row('copd').active, 0);
    assert.equal(all.chronic.rows.find(x => x.key === 'hypertension').newInPeriod, 3, 'all time counts every hypertension entry');
    const legacy = await (await get('/reports/population/chronic', dr)).json(); assert.equal(legacy.patientsWithAny, 3); ok();

    // The older endpoints keep their shape; the age bands are now calendar ages.
    const patients = await (await get('/reports/population/patients', dr)).json();
    assert.equal(patients.total, 4); assert.deepEqual(patients.byAgeGroup.map(g => g.group), ['0-4', '5-17', '18-35', '36-50', '51-64', '65+']); assert.equal(patients.byAgeGroup.reduce((s, g) => s + g.count, 0), 4);
    const kpis = await (await get('/reports/population/kpis', dr)).json(); assert.equal(kpis.totalPatients, 4); assert.equal(typeof kpis.dispensedThisMonth, 'number');
    const active = await (await get('/reports/population/diagnoses', dr)).json(); assert.equal(active.length, 5, 'without dates, active diagnoses as before'); assert.deepEqual([active[0].code, active[0].count], ['BA00', 3]); ok();

    // The Excel export: one sheet per section, carrying the same figures.
    const res = await get('/reports/population/export?' + month, dr);
    assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /spreadsheetml/); assert.match(res.headers.get('content-disposition'), new RegExp(`ses-reports-${dayText(ago(30))}_to_${dayText(now)}\\.xlsx`));
    const ExcelJS = require(root + '/node_modules/exceljs'), wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
    assert.deepEqual(wb.worksheets.map(w => w.name), ['Summary', 'Diagnoses', 'Medicines dispensed', 'Investigations', 'Patients by age and sex', 'Procedures', 'Chronic diseases']);
    const find = (sheet, label) => { let hit; wb.getWorksheet(sheet).eachRow(rw => { if (rw.getCell(1).value === label || rw.getCell(2).value === label) hit = rw; }); return hit; };
    assert.equal(find('Chronic diseases', 'Hypertension').getCell(2).value, 3);
    assert.equal(find('Summary', 'Patients on record').getCell(2).value, 4);
    assert.equal(find('Procedures', 'Cannulation').getCell(3).value, 2);
    assert.equal(find('Patients by age and sex', '65+').getCell(5).value, 1); ok();
    assert.equal((await get('/reports/population/export', dr)).status, 200, 'all time works too'); ok();

    console.log(checks + '/' + checks + ' population report check groups passed. All writes used a disposable schema.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.$disconnect();
    if (created) { assert.match(schema, /^ses_population_test_\d+_[a-f0-9]{8}$/); await admin.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE'); }
    await admin.$disconnect();
  }
}
