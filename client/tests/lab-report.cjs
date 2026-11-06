const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const out = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/labReport.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: out, Math, Number });
const { countParams, listParams, listLabel, duration, DEFAULT_FILTERS } = out;
const plain = o => JSON.parse(JSON.stringify(o));
const month = { from: '2026-10-08', to: '2026-11-06' }, none = { from: '', to: '' }, spec = { ...DEFAULT_FILTERS, groupBy: 'specimen' };

// The counts ask for the period and how to group, nothing else.
assert.deepEqual(plain(countParams(month, DEFAULT_FILTERS)), { from: '2026-10-08', to: '2026-11-06' });
assert.deepEqual(plain(countParams(none, spec)), { groupBy: 'specimen' });
assert.deepEqual(plain(countParams(none, { ...DEFAULT_FILTERS, names: true })), {}, 'names belong to the records');

// Tests ordered and done: a status cell names its status; "ordered" is every status.
assert.deepEqual(plain(listParams('tests', month, DEFAULT_FILTERS, { key: 'FBC', measure: 'pending' })), { from: '2026-10-08', to: '2026-11-06', test: 'FBC', status: 'pending' });
assert.deepEqual(plain(listParams('tests', month, DEFAULT_FILTERS, { key: 'FBC', measure: 'ordered' })), { from: '2026-10-08', to: '2026-11-06', test: 'FBC' });
assert.deepEqual(plain(listParams('tests', none, DEFAULT_FILTERS, { key: null, measure: 'inProgress' })), { status: 'inProgress' }, 'the totals row names no test');
assert.deepEqual(plain(listParams('tests', none, spec, { key: 'Not recorded', measure: 'other' })), { specimen: 'Not recorded', status: 'other' }, 'a specimen row filters by specimen');

// Turnaround opens the tests behind the row, with no status.
assert.deepEqual(plain(listParams('turnaround', none, DEFAULT_FILTERS, { key: 'Malaria RDT', measure: 'resulted' })), { test: 'Malaria RDT' });

// Abnormal and positive: a flag cell names its flag; "resulted" is all of them.
assert.deepEqual(plain(listParams('abnormal', none, DEFAULT_FILTERS, { key: 'Glucose', measure: 'critical' })), { test: 'Glucose', flag: 'critical' });
assert.deepEqual(plain(listParams('abnormal', none, DEFAULT_FILTERS, { key: null, measure: 'resulted' })), { flag: 'all' });
assert.deepEqual(plain(listParams('abnormal', none, DEFAULT_FILTERS, { key: null, measure: 'none' })), { flag: 'none' });
assert.deepEqual(plain(listParams('tests', none, { ...DEFAULT_FILTERS, names: true }, { key: null, measure: 'ordered' })), { names: '1' });

// What a clicked number is called.
assert.equal(listLabel(DEFAULT_FILTERS, { key: 'FBC', measure: 'inProgress' }, 'tests'), 'FBC · In progress');
assert.equal(listLabel(DEFAULT_FILTERS, { key: null, measure: 'completed' }, 'tests'), 'All tests · Completed');
assert.equal(listLabel(spec, { key: null, measure: 'ordered' }, 'tests'), 'All specimens · Ordered');
assert.equal(listLabel(DEFAULT_FILTERS, { key: 'Culture', measure: 'resulted' }, 'turnaround'), 'Culture · Slowest first');
assert.equal(listLabel(DEFAULT_FILTERS, { key: 'Glucose', measure: 'none' }, 'abnormal'), 'Glucose · No flag recorded');

// Durations read the same as the server's summary: minutes, hours and minutes, then days from two days on.
for (const [m, text] of [[0, '0 min'], [25, '25 min'], [59, '59 min'], [60, '1 h'], [90, '1 h 30 min'], [135, '2 h 15 min'], [1500, '25 h'], [2879, '47 h 59 min'], [2880, '2 days'], [4320, '3 days'], [4500, '3 days 3 h'], [-5, '0 min']]) assert.equal(duration(m), text, String(m));
assert.equal(duration(null), '—'); assert.equal(duration(undefined), '—'); assert.equal(duration(NaN), '—');
console.log('lab report logic: all checks passed');
