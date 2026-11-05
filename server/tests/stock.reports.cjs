// Stock reports (Stage 8). Everything runs in a disposable schema that is dropped afterwards.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'); require(root + '/node_modules/dotenv').config({ path: root + '/.env', quiet: true });
if (process.env.STOCK_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.STOCK_TEST_DATABASE_URL;
require(root + '/node_modules/ts-node').register({ project: root + '/tsconfig.json', transpileOnly: true });
const { PrismaClient } = require(root + '/node_modules/@prisma/client');
const appPrisma = require(root + '/src/lib/prisma.ts'); // modules read `.default` at call time, so swapping it points every loaded module at the test schema
const receiving = require(root + '/src/lib/stockReceiving'), adjustments = require(root + '/src/lib/stockAdjustments');
const today = require(root + '/src/lib/prescriptionCourse').todayInput();
main().catch(e => { console.error(e); process.exitCode = 1; });

async function main() {
  const schema = 'ses_stock_reports_test_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  assert.match(schema, /^ses_stock_reports_test_\d+_[a-f0-9]{8}$/);
  const url = new URL(process.env.DATABASE_URL); url.searchParams.set('schema', schema);
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  let db, server, created = false, checks = 0; const ok = () => { checks++; };
  const expiry = days => new Date(new Date(today + 'T00:00:00Z').getTime() + days * 86400000).toISOString().slice(0, 10);
  try {
    await admin.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"'); created = true;
    const r = spawnSync(process.execPath, [root + '/node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: root, env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8', windowsHide: true });
    if (r.status) throw Error(r.stdout + '\n' + r.stderr);
    db = new PrismaClient({ datasources: { db: { url: url.toString() } } });

    const staff = await db.user.create({ data: { name: 'Synthetic pharmacist', email: 'rep-pharm@example.test', password: 'x', role: 'pharmacist', designation: 'Pharmacist' } });
    const boss = await db.user.create({ data: { name: 'Synthetic admin', email: 'rep-admin@example.test', password: 'x', role: 'admin' } });
    const billing = await db.user.create({ data: { name: 'Synthetic billing', email: 'rep-bill@example.test', password: 'x', role: 'billing' } });
    const actor = { userId: staff.id, role: 'pharmacist' }, bossActor = { userId: boss.id, role: 'admin' };
    const catalogue = JSON.parse(fs.readFileSync(root + '/data/builtin-price-items.json', 'utf8'));
    const ors = catalogue.find(x => x.catalogueRef === 'STD_ATC_A07CA_205'), tablet = catalogue.find(x => x.itemType === 'DRUG' && x.name === 'Paracetamol' && /^500mg.*Tablet/.test(x.detail));
    await db.priceListItem.createMany({ data: [{ ...ors, unitPrice: null }, { ...tablet, unitPrice: 2 }] });

    const orsBrand = { catalogueRef: ors.catalogueRef, brand: 'ORS brand', manufacturer: 'Fixture maker', baseUnit: 'sachet', packSize: 100, packLabel: 'box' };
    const receipt = await receiving.receiveStock(db, actor, 'rep-receive', { kind: 'DELIVERY', receivedDate: today, reference: 'REP-DN-1', source: 'Fixture supplier', lines: [
      { newProduct: orsBrand, lotNumber: 'SOON', expiryDate: expiry(20), packCount: '1' },
      { newProduct: orsBrand, lotNumber: 'LATER', expiryDate: expiry(400), packCount: '2' },
      { newProduct: orsBrand, lotNumber: 'GONE', expiryDate: expiry(5), packCount: '1' },
      { newProduct: { catalogueRef: tablet.catalogueRef, brand: 'Para brand', baseUnit: 'tablet', packSize: 10, packLabel: 'strip' }, lotNumber: 'PARA1', expiryDate: expiry(300), packCount: '5' },
    ] });
    const lot = Object.fromEntries(receipt.result.lines.map(l => [l.batch.lotNumber, l.batch]));
    await db.stockBatch.update({ where: { id: lot.GONE.id }, data: { expiryDate: new Date(expiry(-5)) } });

    // One approved loss (4 sachets damaged from SOON) and one still awaiting approval (1 from LATER).
    const line = async (batch, quantity) => { const d = (await adjustments.adjustmentBatches(db, actor, { ids: batch.id, kind: 'COUNT' })).rows[0];
      return { batchId: batch.id, baseUnit: 'sachet', expectedQuantity: d.physical, expectedPostingOrder: d.postingOrder, quantity }; };
    const approved = await adjustments.submitAdjustment(db, actor, 'rep-loss-1', { kind: 'LOSS', reference: 'REP-LOSS-1', reasonCode: 'DAMAGE', reason: 'Wet box', lines: [await line(lot.SOON, '4')] });
    await adjustments.reviewAdjustment(db, bossActor, 'rep-loss-1-ok', approved.result.id, 'APPROVE', {});
    await adjustments.submitAdjustment(db, actor, 'rep-loss-2', { kind: 'LOSS', reference: 'REP-LOSS-2', reasonCode: 'BREAKAGE', lines: [await line(lot.LATER, '1')] });

    // Run the real routes with a stubbed prisma client, as the other stock tests do.
    Object.defineProperty(appPrisma, 'default', { value: db, configurable: true });
    const express = require(root + '/node_modules/express'), jwt = require(root + '/node_modules/jsonwebtoken');
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(40);
    const app = express(); app.use(express.json()); app.use('/api/pharmacy-stock', require(root + '/src/routes/stock.routes').default);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const get = (p, user = staff) => fetch(origin + '/api/pharmacy-stock/reports/' + p, { headers: { Authorization: 'Bearer ' + jwt.sign({ userId: user.id }, process.env.JWT_SECRET) } });
    const json = async (p, user) => { const res = await get(p, user); assert.equal(res.status, 200, p); return res.json(); };

    // Stock on hand: units stay separate, expired is not available, totals are not summed across units.
    let rep = await json('on-hand');
    const orsRow = rep.rows.find(x => x.brand === 'ORS brand');
    assert.equal(orsRow.unit, 'sachet'); assert.equal(orsRow.batches, 3);
    assert.equal(orsRow.physical, 396); assert.equal(orsRow.expired, 100); assert.equal(orsRow.available, 296);
    assert.equal(rep.rows.find(x => x.brand === 'Para brand').physical, 50);
    assert.equal(rep.totals, null); assert.equal(rep.summary.find(x => x.label.startsWith('Products holding expired')).value, 1); ok();
    rep = await json('on-hand?level=HAS_EXPIRED'); assert.deepEqual(rep.rows.map(x => x.brand), ['ORS brand']); ok();
    rep = await json('on-hand?q=para'); assert.deepEqual(rep.rows.map(x => x.brand), ['Para brand']); ok();
    rep = await json('on-hand?q=' + encodeURIComponent('100%')); assert.equal(rep.rows.length, 0); ok(); // wildcards are literal

    // Expiry: soonest first, expired flagged with negative days, window excludes expired and far dates.
    rep = await json('expiry');
    assert.deepEqual(rep.rows.map(x => x.lot), ['GONE', 'SOON', 'PARA1', 'LATER']);
    assert.equal(rep.rows[0].state, 'Expired'); assert.ok(rep.rows[0].days < 0); assert.equal(rep.rows[1].days, 20); ok();
    rep = await json('expiry?within=30'); assert.deepEqual(rep.rows.map(x => x.lot), ['SOON']); ok();
    rep = await json('expiry?state=EXPIRED'); assert.deepEqual(rep.rows.map(x => x.lot), ['GONE']); ok();

    // Movements: receipts are stock in; the date range uses Lusaka days.
    rep = await json('movements?from=' + today + '&to=' + today);
    assert.equal(rep.rows.length, 5); assert.equal(rep.rows.filter(x => x.type === 'Received').length, 4); assert.ok(rep.rows.filter(x => x.type === 'Received').every(x => x.qin > 0 && x.qout === null && x.by === 'Synthetic pharmacist'));
    const loss = rep.rows.find(x => x.type === 'Loss'); assert.equal(loss.qout, 4); assert.equal(loss.qin, null); assert.equal(loss.lot, 'SOON');
    assert.equal(rep.rows.find(x => x.lot === 'PARA1').qin, 50); ok();
    rep = await json('movements?from=2020-01-01&to=2020-01-02'); assert.equal(rep.rows.length, 0); ok();
    rep = await json('movements?type=ISSUED'); assert.equal(rep.rows.length, 0); ok();

    // Adjustments: pending request shows its change, prepared-by name and awaiting status.
    rep = await json('adjustments?from=' + today + '&to=' + today);
    assert.equal(rep.rows.length, 2); const a = rep.rows.find(x => x.reference === 'REP-LOSS-1'), p = rep.rows.find(x => x.reference === 'REP-LOSS-2');
    assert.equal(a.change, -4); assert.equal(a.status, 'Approved'); assert.equal(a.preparedBy, 'Synthetic pharmacist'); assert.equal(a.reviewedBy, 'Synthetic admin'); assert.match(a.reason, /Damaged stock · Wet box/);
    assert.equal(p.change, -1); assert.equal(p.status, 'Awaiting approval'); assert.equal(p.reviewedBy, ''); assert.equal(p.reason, 'Breakage');
    assert.equal(rep.summary.find(x => x.label === 'Awaiting approval').value, 1); assert.equal(rep.summary.find(x => x.label === 'Approved').value, 1); ok();
    rep = await json('adjustments?from=' + today + '&to=' + today + '&status=PENDING'); assert.deepEqual(rep.rows.map(x => x.reference), ['REP-LOSS-2']); ok();

    // Bad input is rejected, not guessed.
    for (const bad of ['on-hand?level=NOPE', 'expiry?within=abc', 'expiry?within=99999', 'movements?from=2026-13-40', 'movements?from=2026-02-02&to=2026-01-01', 'movements?from=2020-01-01&to=2022-01-01', 'unknown']) {
      const res = await get(bad); assert.ok([400, 404].includes(res.status), bad + ' -> ' + res.status);
    }
    ok();

    // Excel export: a real workbook with the SES header block and the same rows.
    const xl = await get('expiry?format=xlsx'); assert.equal(xl.status, 200);
    assert.match(xl.headers.get('content-type'), /spreadsheetml/); assert.match(xl.headers.get('content-disposition'), /ses-stock-expiry-\d{4}-\d{2}-\d{2}\.xlsx/);
    const ExcelJS = require(root + '/node_modules/exceljs'), wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await xl.arrayBuffer()));
    const ws = wb.worksheets[0]; assert.equal(ws.getCell(2, 2).value, 'Batches by expiry'); assert.equal(ws.getCell(6, 1).value, 'Item');
    assert.equal(ws.getCell(7, 3).value, 'GONE'); assert.equal(ws.getCell(10, 3).value, 'LATER'); ok();

    // Role guard: billing cannot read stock reports; reading changes nothing.
    const counts = () => db.$queryRawUnsafe('SELECT (SELECT count(*) FROM "StockMovement")::text m,(SELECT count(*) FROM "StockOperation")::text o,(SELECT count(*) FROM "StockAdjustment")::text a');
    const c0 = await counts();
    assert.equal((await get('on-hand', billing)).status, 403);
    assert.equal((await get('on-hand', boss)).status, 200);
    assert.equal((await fetch(origin + '/api/pharmacy-stock/reports/on-hand')).status, 401);
    assert.deepEqual(await counts(), c0); ok();

    // Reorder suggestions (stage nine). Fixtures are written after the earlier groups so those stay untouched. The ledger
    // is immutable, so receipt dates are moved back by switching its guard off briefly, in this disposable schema only.
    const dayAt = n => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d; };
    const idleItem = catalogue.find(x => x.itemType === 'DRUG' && ![ors.catalogueRef, tablet.catalogueRef].includes(x.catalogueRef));
    await db.priceListItem.create({ data: { ...idleItem, unitPrice: null } });
    await receiving.receiveStock(db, actor, 'rep-receive-idle', { kind: 'DELIVERY', receivedDate: today, reference: 'REP-DN-2', source: 'Fixture supplier', lines: [
      { newProduct: { catalogueRef: idleItem.catalogueRef, brand: 'Idle brand', baseUnit: 'tablet', packSize: 10, packLabel: 'strip' }, lotNumber: 'IDLE1', expiryDate: expiry(200), packCount: '3' }] });
    await db.$executeRawUnsafe('ALTER TABLE "StockMovement" DISABLE TRIGGER "StockMovement_immutable"');
    await db.$executeRawUnsafe(`UPDATE "StockMovement" SET "createdAt" = '${dayAt(100).toISOString().replace('Z', '')}'::timestamp WHERE "type" = 'RECEIVED' AND "batchId" IN ('${lot.SOON.id}', '${lot.LATER.id}', '${lot.GONE.id}')`);
    await db.$executeRawUnsafe('ALTER TABLE "StockMovement" ENABLE TRIGGER "StockMovement_immutable"');
    const op = await db.stockOperation.create({ data: { actorId: staff.id, key: 'rep-fixture-use', kind: 'FIXTURE', requestHash: 'x' } });
    const issue = (batch, quantity, ago, unit) => db.stockMovement.create({ data: { operationId: op.id, batchId: batch.id, type: 'ISSUED', quantity: -quantity, baseUnit: unit, reference: 'REP-USE', actorId: staff.id, createdAt: dayAt(ago) } });
    await issue(lot.LATER, 60, 10, 'sachet'); await issue(lot.SOON, 30, 5, 'sachet');
    const cancelled = await issue(lot.SOON, 20, 3, 'sachet'); // issued then reversed: not use
    await db.stockMovement.create({ data: { operationId: op.id, batchId: lot.SOON.id, type: 'REVERSAL', quantity: 20, baseUnit: 'sachet', reference: 'REP-USE', reason: 'Fixture correction', actorId: staff.id, reversalOfId: cancelled.id, createdAt: dayAt(2) } });
    await issue(lot.PARA1, 50, 0, 'tablet');
    const movementCount = async () => (await db.$queryRawUnsafe('SELECT count(*)::text AS n FROM "StockMovement"'))[0].n;
    const before = await movementCount();

    rep = await json('reorder');
    assert.deepEqual(rep.rows.map(x => x.status), ['Out of stock', 'OK', 'No recent use'], 'out of stock first, then by days left, no-use last');
    const sachets = rep.rows.find(x => x.unit === 'sachet'), outRow = rep.rows[0], idleRow = rep.rows[2];
    assert.equal(sachets.available, 206); assert.equal(sachets.used, 90, 'a reversed issue and the 4 lost sachets are not use');
    assert.equal(sachets.perDay, 1); assert.equal(sachets.coverDays, 206); assert.equal(sachets.expiring, 66, 'usable stock expiring within delivery plus cover days');
    assert.equal(sachets.suggested, null, 'no suggestion while there is enough');
    assert.equal(outRow.unit, 'tablet'); assert.equal(outRow.available, 0); assert.equal(outRow.used, 50);
    assert.equal(outRow.perDay, 50, 'first received today, so one day of history and not the whole window');
    assert.equal(outRow.suggested, 2200, 'rate x (delivery + cover days) less usable stock');
    assert.equal(idleRow.available, 30); assert.equal(idleRow.used, 0); assert.equal(idleRow.coverDays, null); assert.equal(idleRow.suggested, null);
    assert.equal(rep.totals, null);
    assert.equal(rep.summary.find(x => x.label.startsWith('Out of stock')).value, 1); assert.equal(rep.summary.find(x => x.label === 'Reorder now').value, 0); assert.equal(rep.summary.find(x => x.label === 'No recent use').value, 1);
    assert.match(rep.period, /last 90 days/); ok();

    rep = await json('reorder?days=7&lead=60');
    const late = rep.rows.find(x => x.unit === 'sachet'); assert.equal(late.status, 'Reorder now', 'about 48 days left is under a 60 day delivery'); assert.equal(late.suggested, 180, 'ceil(30/7 x (60 + 30) - 206)'); ok();
    rep = await json('reorder?days=7');
    const week = rep.rows.find(x => x.unit === 'sachet'); assert.equal(week.used, 30, 'only the last 7 days are counted'); assert.equal(week.perDay, 4.29); assert.equal(week.coverDays, 48.1); ok();
    rep = await json('reorder?status=ACTION'); assert.deepEqual(rep.rows.map(x => x.status), ['Out of stock']); ok();
    rep = await json('reorder?status=ACTION&days=7&lead=60'); assert.deepEqual(rep.rows.map(x => x.status), ['Out of stock', 'Reorder now'], 'action lists both, most urgent first'); ok();
    rep = await json('reorder?status=NO_USE'); assert.equal(rep.rows.length, 1); assert.equal(rep.rows[0].available, 30); ok();
    rep = await json('reorder?q=nothing-matches-this'); assert.equal(rep.rows.length, 0); ok();

    for (const bad of ['reorder?days=3', 'reorder?days=abc', 'reorder?days=9999', 'reorder?lead=-1', 'reorder?cover=0', 'reorder?status=NOPE']) {
      const res = await get(bad); assert.equal(res.status, 400, bad + ' -> ' + res.status);
    }
    ok();
    const rx = await get('reorder?format=xlsx'); assert.equal(rx.status, 200); assert.match(rx.headers.get('content-disposition'), /ses-stock-reorder-\d{4}-\d{2}-\d{2}\.xlsx/);
    const rwb = new ExcelJS.Workbook(); await rwb.xlsx.load(Buffer.from(await rx.arrayBuffer()));
    assert.equal(rwb.worksheets[0].getCell(2, 2).value, 'Reorder suggestions'); ok();
    assert.equal((await get('reorder', billing)).status, 403); assert.equal(await movementCount(), before, 'reading reorder suggestions writes nothing'); ok();

    // Alerts strip: the same calculations as the reports, summarised.
    const alertGet = (user = staff) => fetch(origin + '/api/pharmacy-stock/alerts', { headers: { Authorization: 'Bearer ' + jwt.sign({ userId: user.id }, process.env.JWT_SECRET) } });
    const beforeAlerts = await movementCount();
    const alertRes = await alertGet(); assert.equal(alertRes.status, 200); const al = await alertRes.json();
    assert.equal(al.attention, true);
    assert.equal(al.reorder.out, 1); assert.equal(al.reorder.reorderNow, 0);
    assert.equal(al.reorder.items.length, 1); assert.equal(al.reorder.items[0].status, 'Out of stock'); assert.equal(al.reorder.items[0].unit, 'tablet'); assert.equal(al.reorder.items[0].suggested, 2200);
    assert.equal(al.expiry.withinDays, 90); assert.equal(al.expiry.batches, 1, 'only the usable batch expiring within 90 days'); assert.equal(al.expiry.soonest[0].lot, 'SOON'); assert.equal(al.expiry.soonest[0].days, 20);
    assert.equal(al.expiry.expiredWithStock, 1, 'the expired batch that still holds stock');
    const expiryReport = await json('expiry?state=USABLE&within=90'), actionReport = await json('reorder?status=ACTION');
    assert.equal(al.expiry.batches, expiryReport.rows.length, 'counts match the report rows'); assert.equal(al.reorder.out + al.reorder.reorderNow, actionReport.rows.length); ok();
    assert.equal((await alertGet(billing)).status, 403); assert.equal((await alertGet(boss)).status, 200);
    assert.equal((await fetch(origin + '/api/pharmacy-stock/alerts')).status, 401);
    assert.equal(await movementCount(), beforeAlerts, 'reading alerts writes nothing'); ok();

    console.log(checks + '/' + checks + ' stock report check groups passed. All writes used a disposable schema.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.$disconnect();
    if (created) { assert.match(schema, /^ses_stock_reports_test_\d+_[a-f0-9]{8}$/); await admin.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE'); }
    await admin.$disconnect();
  }
}
