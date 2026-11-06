const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const out = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/charts.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: out, Math, Number, Array, Set });
const { grains, daysIn, niceAxis, yFor, stackHeights, labelIndexes, heatLevel, hourWindow, linePoints, bandSplit, sideWidth } = out;
const plain = o => JSON.parse(JSON.stringify(o));

// Axes read in round steps and always reach the largest value.
for (const [max, top, ticks] of [[25, 30, [0, 10, 20, 30]], [19, 20, [0, 10, 20]], [7, 10, [0, 5, 10]], [3, 3, [0, 1, 2, 3]], [120, 150, [0, 50, 100, 150]], [0, 1, [0, 1]], [1, 1, [0, 1]], [1284, 1500, [0, 500, 1000, 1500]]]) {
  const a = plain(niceAxis(max)); assert.equal(a.max, top, 'axis for ' + max); assert.deepEqual(a.ticks, ticks, 'ticks for ' + max);
  assert.ok(a.max >= max); assert.equal(a.ticks.at(-1), a.max); assert.equal(a.ticks[0], 0);
}
assert.equal(niceAxis(2.2).max >= 2.2, true); assert.equal(plain(niceAxis(-5)).max, 1, 'a negative maximum still gives an axis');
assert.equal(yFor(0, 20, 100), 100); assert.equal(yFor(20, 20, 100), 0); assert.equal(yFor(10, 20, 100), 50); assert.equal(yFor(5, 0, 100), 100, 'no maximum draws at the bottom'); assert.equal(yFor(-3, 20, 100), 100);

// A stacked bar keeps its parts in proportion, and a part that exists is never invisible.
assert.deepEqual(plain(stackHeights(10, 10, 20, 100)), { a: 50, b: 50 });
assert.deepEqual(plain(stackHeights(1, 100, 100, 200)), { a: 2, b: 200 }, 'a tiny part keeps a minimum');
assert.deepEqual(plain(stackHeights(0, 5, 10, 100)), { a: 0, b: 50 }); assert.deepEqual(plain(stackHeights(0, 0, 10, 100)), { a: 0, b: 0 }); assert.deepEqual(plain(stackHeights(5, 5, 0, 100)), { a: 0, b: 0 });

// Axis labels: a handful, evenly spaced, first and last always there.
assert.deepEqual(plain(labelIndexes(0)), []); assert.deepEqual(plain(labelIndexes(3)), [0, 1, 2]); assert.deepEqual(plain(labelIndexes(30)), [0, 7, 15, 22, 29]); assert.deepEqual(plain(labelIndexes(6)), [0, 1, 3, 4, 5]);
for (const n of [1, 2, 5, 6, 7, 28, 31, 366]) { const idx = plain(labelIndexes(n)); assert.equal(idx[0], 0); assert.equal(idx.at(-1), n - 1); assert.ok(idx.length <= 5); assert.deepEqual(idx, [...idx].sort((a, b) => a - b)); assert.equal(new Set(idx).size, idx.length); }

// Heat: nothing is blank, something is never faint to the point of invisible, the busiest is full.
assert.equal(heatLevel(0, 19), 0); assert.equal(heatLevel(19, 19), 1); assert.ok(heatLevel(1, 19) >= 0.15 && heatLevel(1, 19) < 0.25); assert.equal(heatLevel(5, 0), 0); assert.equal(heatLevel(30, 19), 1, 'never beyond full');
assert.ok(heatLevel(10, 19) > heatLevel(5, 19));

// The hours shown: the working day, widened by any attendance outside it.
const hours = n => Array.from({ length: 24 }, (_, h) => n[h] ?? 0);
assert.deepEqual(plain(hourWindow(hours({}))), { from: 8, to: 16 }, 'nothing: the working day'); assert.deepEqual(plain(hourWindow(hours({ 10: 5 }))), { from: 8, to: 16 });
assert.deepEqual(plain(hourWindow(hours({ 6: 1, 10: 5, 19: 2 }))), { from: 6, to: 19 }, 'early and late attendances are shown'); assert.deepEqual(plain(hourWindow(hours({ 0: 1, 23: 1 }))), { from: 0, to: 23 });

// A line: evenly spaced, the largest at the top, zero at the bottom, one point in the middle.
assert.deepEqual(plain(linePoints([0, 10, 20], 20, 200, 100)), [{ x: 0, y: 100 }, { x: 100, y: 50 }, { x: 200, y: 0 }]); assert.deepEqual(plain(linePoints([7], 10, 200, 100)), [{ x: 100, y: 30 }]); assert.deepEqual(plain(linePoints([], 10, 200, 100)), []);

// Female and male per age band add new and re-attendance; other is not a bar.
assert.deepEqual(plain(bandSplit([{ label: 'Under 1', newMale: 3, newFemale: 4, reMale: 2, reFemale: 1 }, { label: '1 to 4' }])), [{ label: 'Under 1', female: 5, male: 5 }, { label: '1 to 4', female: 0, male: 0 }]);
assert.equal(sideWidth(50, 100), 50); assert.equal(sideWidth(100, 100), 100); assert.equal(sideWidth(0, 100), 0); assert.equal(sideWidth(1, 1000), 2, 'a value that exists is visible'); assert.equal(sideWidth(5, 0), 0);
// Which groupings a period allows: days up to three months, weeks up to a year, months always.
const span = (from, to) => ({ from, to });
assert.equal(daysIn(span('', '')), null); assert.equal(daysIn(span('2026-10-08', '2026-11-06')), 30); assert.equal(daysIn(span('2026-11-06', '2026-11-06')), 1); assert.equal(daysIn(span('2026-02-01', '2026-03-01')), 29, 'across a short month');
for (const [p, allowed, first] of [[span('', ''), ['month'], 'month'], [span('2026-11-06', '2026-11-06'), ['day', 'week', 'month'], 'day'], [span('2026-10-08', '2026-11-06'), ['day', 'week', 'month'], 'day'], [span('2026-08-01', '2026-11-06'), ['week', 'month'], 'week'], [span('2026-01-01', '2026-11-06'), ['week', 'month'], 'month'], [span('2024-01-01', '2026-11-06'), ['month'], 'month']]) { const g = plain(grains(p)); assert.deepEqual(g.allowed, allowed, p.from + ' ' + p.to); assert.equal(g.first, first, p.from + ' ' + p.to); assert.ok(g.allowed.includes(g.first)); }
console.log('chart arithmetic: all checks passed');
