const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const out = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/chronicReport.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: out, Math, Number });
const { countParams, listParams, listLabel, cellValue, splitBar, splitByUse, DEFAULT_FILTERS, OVERDUE_GROUPS } = out;
const plain = o => JSON.parse(JSON.stringify(o));
const month = { from: '2026-10-08', to: '2026-11-06' }, none = { from: '', to: '' };

// The counts are narrowed by the period and the condition only.
assert.deepEqual(plain(countParams(month, DEFAULT_FILTERS)), { from: '2026-10-08', to: '2026-11-06' });
assert.deepEqual(plain(countParams(none, { ...DEFAULT_FILTERS, condition: 'hypertension', seen: 'overdue', control: 'notControlled', status: 'resolved' })), { condition: 'hypertension' }, 'status, last seen and control belong to the records');

// A clicked number opens the records behind it.
assert.deepEqual(plain(listParams(month, DEFAULT_FILTERS, { condition: 'hypertension', measure: 'overdue' })), { from: '2026-10-08', to: '2026-11-06', condition: 'hypertension', measure: 'overdue' });
assert.deepEqual(plain(listParams(month, DEFAULT_FILTERS, { condition: null, measure: 'active' })), { from: '2026-10-08', to: '2026-11-06', measure: 'active' }, 'the totals row names no condition');
assert.deepEqual(plain(listParams(month, { ...DEFAULT_FILTERS, condition: 'diabetes' }, { condition: null, measure: 'seen' })), { from: '2026-10-08', to: '2026-11-06', condition: 'diabetes', measure: 'seen' }, 'the totals row keeps the condition filter');
assert.equal(listParams(month, { ...DEFAULT_FILTERS, condition: 'diabetes' }, { condition: 'hiv', measure: 'active' })['condition'], 'hiv', 'a clicked row wins over the filter');
assert.deepEqual(plain(listParams(none, { ...DEFAULT_FILTERS, status: 'resolved' }, { condition: 'asthma', measure: null })), { condition: 'asthma', status: 'resolved' }, 'with no measure the status filter applies');
assert.equal(listParams(none, { ...DEFAULT_FILTERS, status: 'resolved' }, { condition: 'asthma', measure: 'resolved' })['status'], undefined, 'a measure names its own status');
assert.deepEqual(plain(listParams(none, { ...DEFAULT_FILTERS, seen: 'overdue', control: 'noReading', names: true }, { condition: 'hypertension', measure: 'active' })), { condition: 'hypertension', measure: 'active', seen: 'overdue', control: 'noReading', names: '1' }, 'the other filters narrow the records');
assert.deepEqual(plain(listParams(none, DEFAULT_FILTERS, { condition: null, measure: null })), {}, 'everything, all time');

// The heading over the records.
const labels = { hypertension: 'Hypertension' };
assert.equal(listLabel({ condition: 'hypertension', measure: 'overdue' }, labels), 'Hypertension · Overdue');
assert.equal(listLabel({ condition: null, measure: 'seen' }, labels), 'All conditions · Seen in the last 90 days');
assert.equal(listLabel({ condition: 'copd', measure: null }, {}), 'copd · Everyone behind the filters');
assert.equal(cellValue({ active: 4, other: undefined, female: 2 }, 'female'), 2); assert.equal(cellValue({ active: 4 }, 'other'), 0, 'a column that is not there is zero');

// Bars: they add up, and a small part stays visible.
const total = a => a.reduce((s, x) => s + x, 0), close = (a, b) => Math.abs(a - b) < 1e-9;
assert.ok(close(total(splitBar([71, 47, 0])), 100)); assert.deepEqual(plain(splitBar([0, 0])), [0, 0]); assert.deepEqual(plain(splitBar([-3, 0])), [0, 0]);
const thin = splitBar([1, 999]); assert.ok(thin[0] >= 1.9 && close(total(thin), 100)); assert.equal(splitBar([5, 0, 5])[1], 0, 'nothing is drawn for nobody');
assert.ok(close(splitBar([1])[0], 100));

// Conditions with nobody to show are set aside.
const row = (key, active, n = 0, r = 0) => ({ key, label: key, active, new: n, resolved: r });
const split = splitByUse([row('a', 3), row('b', 0), row('c', 0, 1), row('d', 0, 0, 2)]);
assert.deepEqual(plain(split.used.map(x => x.key)), ['a', 'c', 'd']); assert.deepEqual(plain(split.quiet.map(x => x.key)), ['b']);
assert.deepEqual(plain(OVERDUE_GROUPS.map(g => g.key)), ['b120', 'b180', 'b365', 'over', 'never']);

console.log('Passed chronic report checks: what is asked for, what a clicked number opens, headings, bars and unused conditions.');
