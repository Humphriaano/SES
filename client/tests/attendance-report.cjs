const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const out = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/attendanceReport.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: out, Math, Number, Boolean });
const { attendanceParams, cellParams, cellLabel, cellValue, pageText, lastPage, DEFAULT_FILTERS, AGE_BANDS } = out;
const plain = o => JSON.parse(JSON.stringify(o));
const month = { from: '2026-10-08', to: '2026-11-06' }, none = { from: '', to: '' };
const band = { label: '25 to 49', key: '25-49', newMale: 13, newFemale: 28, newOther: 0, newTotal: 41, reMale: 54, reFemale: 121, reOther: 0, reTotal: 175, all: 216 };

// What is asked for: only what was chosen.
assert.deepEqual(plain(attendanceParams(month, DEFAULT_FILTERS)), { from: '2026-10-08', to: '2026-11-06' });
assert.deepEqual(plain(attendanceParams(none, DEFAULT_FILTERS)), {}, 'all time sends no dates');
assert.deepEqual(plain(attendanceParams(month, { servicePoint: 'room-1', sex: 'FEMALE', ageBand: '25-49', groupBy: 'week', names: true })), { from: '2026-10-08', to: '2026-11-06', servicePoint: 'room-1', sex: 'FEMALE', ageBand: '25-49', groupBy: 'week', names: '1' });

// A clicked number asks for the records behind it, with the screen's filters kept.
assert.deepEqual(plain(cellParams(month, DEFAULT_FILTERS, { row: band, visit: 're', sex: 'FEMALE' })), { from: '2026-10-08', to: '2026-11-06', ageBand: '25-49', visit: 're', sex: 'FEMALE' });
assert.deepEqual(plain(cellParams(month, DEFAULT_FILTERS, { row: band, visit: null, sex: null })), { from: '2026-10-08', to: '2026-11-06', ageBand: '25-49' }, 'the all-attendances cell');
assert.deepEqual(plain(cellParams(month, { ...DEFAULT_FILTERS, servicePoint: 'room-1' }, { row: null, visit: 'new', sex: null })), { from: '2026-10-08', to: '2026-11-06', servicePoint: 'room-1', visit: 'new' }, 'the totals row keeps the service point filter');
assert.equal(cellParams(month, { ...DEFAULT_FILTERS, groupBy: 'week' }, { row: null, visit: null, sex: null })['groupBy'], undefined, 'records are never grouped');
const weekRow = { ...band, label: 'Week of 3 Nov 2026', key: '2026-11-03', from: '2026-11-03', to: '2026-11-06' };
assert.deepEqual(plain(cellParams(month, { ...DEFAULT_FILTERS, groupBy: 'week', ageBand: '5-14' }, { row: weekRow, visit: 'new', sex: 'MALE' })), { from: '2026-11-03', to: '2026-11-06', ageBand: '5-14', visit: 'new', sex: 'MALE' }, 'a week row opens its own days and keeps the age filter');
assert.equal(cellParams(none, DEFAULT_FILTERS, { row: band, visit: null, sex: null })['from'], undefined);
assert.deepEqual(plain(cellParams(none, { ...DEFAULT_FILTERS, groupBy: 'day' }, { row: { ...weekRow, from: '2026-11-03', to: '2026-11-03' }, visit: null, sex: null })), { from: '2026-11-03', to: '2026-11-03' }, 'a day row narrows even all time');
assert.equal(cellParams(month, { ...DEFAULT_FILTERS, names: true }, { row: band, visit: null, sex: null })['names'], '1', 'names stay on while looking at the records');

// The heading over the line list.
assert.equal(cellLabel({ row: band, visit: 're', sex: 'FEMALE' }, 'period'), 'Re-attendance · Female · 25 to 49');
assert.equal(cellLabel({ row: null, visit: null, sex: null }, 'period'), 'All attendances · All ages');
assert.equal(cellLabel({ row: weekRow, visit: 'new', sex: null }, 'week'), 'New attendance · Week of 3 Nov 2026');
assert.equal(cellLabel({ row: null, visit: null, sex: 'MALE' }, 'month'), 'All attendances · Male · All periods');

// The number shown is the number the records will add up to.
assert.equal(cellValue(band, 're', 'FEMALE'), 121); assert.equal(cellValue(band, 'new', null), 41); assert.equal(cellValue(band, null, null), 216);
assert.equal(cellValue(band, null, 'MALE'), 67); assert.equal(cellValue(band, null, 'FEMALE'), 149); assert.equal(cellValue(band, 'new', 'OTHER'), 0);
assert.equal(cellValue({ ...band, newOther: 2, reOther: 1 }, null, 'OTHER'), 3);

// Paging.
assert.equal(pageText(0, 10, 121), 'Showing 1–10 of 121'); assert.equal(pageText(12, 10, 121), 'Showing 121–121 of 121'); assert.equal(pageText(0, 10, 0), 'Nothing to show'); assert.equal(pageText(0, 10, 5), 'Showing 1–5 of 5');
assert.equal(lastPage(10, 121), 12); assert.equal(lastPage(10, 120), 11); assert.equal(lastPage(10, 0), 0);
assert.deepEqual(plain(AGE_BANDS.map(b => b.key)), ['u1', '1-4', '5-14', '15-24', '25-49', '50plus']); assert.ok(AGE_BANDS.every(b => !/[+&=#%\s]/.test(b.key)), 'keys are safe in a URL');

// By service point: a row opens that service point's attendances, and the totals row keeps the filters.
assert.deepEqual(plain(cellParams(month, { ...DEFAULT_FILTERS, groupBy: 'servicePoint', sex: 'FEMALE' }, { row: { ...weekRow, key: 'room-9', label: 'Treatment room', from: undefined, to: undefined }, visit: 'new', sex: null })), { from: '2026-10-08', to: '2026-11-06', servicePoint: 'room-9', sex: 'FEMALE', visit: 'new' });
assert.equal(plain(cellParams(month, { ...DEFAULT_FILTERS, groupBy: 'servicePoint' }, { row: null, visit: null, sex: null }))['servicePoint'], undefined);
assert.equal(cellLabel({ row: null, visit: null, sex: null }, 'servicePoint'), 'All attendances · All service points');
console.log('Passed attendance report checks: what is asked for, what a clicked number opens, the line list heading, cell values and paging.');
