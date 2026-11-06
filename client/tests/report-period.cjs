const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const out = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/reportPeriod.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: out, Date, Math, Number, String, Number });
const { periodFor, periodProblem, periodId, minutesText, percent, barFraction, dayText, PERIOD_PRESETS, DEFAULT_PERIOD } = out;
const plain = o => JSON.parse(JSON.stringify(o));
const today = new Date(2026, 2, 3);   // 3 March 2026

// What each preset stands for, including across a month and year boundary.
assert.deepEqual(plain(periodFor('today', today)), { key: 'today', from: '2026-03-03', to: '2026-03-03' });
assert.deepEqual(plain(periodFor('7d', today)), { key: '7d', from: '2026-02-25', to: '2026-03-03' });
assert.deepEqual(plain(periodFor('30d', today)), { key: '30d', from: '2026-02-02', to: '2026-03-03' });
assert.deepEqual(plain(periodFor('90d', today)), { key: '90d', from: '2025-12-04', to: '2026-03-03' });
assert.deepEqual(plain(periodFor('month', today)), { key: 'month', from: '2026-03-01', to: '2026-03-03' });
assert.deepEqual(plain(periodFor('year', today)), { key: 'year', from: '2026-01-01', to: '2026-03-03' });
assert.deepEqual(plain(periodFor('all', today)), { key: 'all', from: '', to: '' }, 'all time sends no dates');
assert.deepEqual(plain(periodFor('custom', today, { from: '2026-01-05', to: '2026-01-09' })), { key: 'custom', from: '2026-01-05', to: '2026-01-09' });
assert.deepEqual(plain(periodFor('custom', today)), { key: 'custom', from: '', to: '' });
assert.equal(periodFor('7d', new Date(2024, 2, 1)).from, '2024-02-24', 'leap year');
assert.equal(DEFAULT_PERIOD, '30d'); assert.equal(PERIOD_PRESETS.length, 8); assert.equal(new Set(PERIOD_PRESETS.map(p => p.key)).size, 8);
assert.equal(dayText(new Date(2026, 0, 9)), '2026-01-09', 'zero padded');

// A custom range is only sent when it can work.
assert.equal(periodProblem('2026-01-05', '2026-01-09'), ''); assert.equal(periodProblem('2026-01-05', '2026-01-05'), '', 'one day is fine');
assert.match(periodProblem('', '2026-01-09'), /both/); assert.match(periodProblem('2026-01-05', ''), /both/);
assert.match(periodProblem('2026-02-31', '2026-03-01'), /real dates/); assert.match(periodProblem('05/01/2026', '2026-01-09'), /real dates/);
assert.match(periodProblem('2026-03-02', '2026-03-01'), /before the start/);
assert.notEqual(periodId({ from: '', to: '' }), periodId({ from: '2026-01-01', to: '2026-01-02' }));

// Waiting times and shares.
assert.equal(minutesText(null), '—'); assert.equal(minutesText(undefined), '—'); assert.equal(minutesText(0), 'Under 1 min'); assert.equal(minutesText(75), '1 h 15 min'); assert.equal(minutesText(59.6), '1 h'); assert.equal(minutesText(180), '3 h'); assert.equal(minutesText(1500), '1 day'); assert.equal(minutesText(NaN), '—');
assert.equal(percent(2, 3), '67%'); assert.equal(percent(0, 5), '0%'); assert.equal(percent(1, 0), '—'); assert.equal(percent(3, 3), '100%');
assert.equal(barFraction(5, 10), 0.5); assert.equal(barFraction(0, 10), 0); assert.equal(barFraction(1, 1000), 0.02, 'a small value still shows'); assert.equal(barFraction(7, 0), 0); assert.equal(barFraction(20, 10), 1);

console.log('Passed report period checks: presets across month and year ends, custom range problems, waiting times and shares.');
