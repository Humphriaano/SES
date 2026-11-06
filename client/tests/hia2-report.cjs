const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const out = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/hia2Report.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: out, Math, Number, Date, Array, String });
const { monthId, monthText, monthChoices, defaultMonth, isMonth, countParams, listParams, buildGrid, cellLabel } = out;
const plain = o => JSON.parse(JSON.stringify(o));

// The months: this one and the 23 before it, across a year end, newest first.
const nov = new Date(2026, 10, 6), jan = new Date(2026, 0, 31);
const choices = plain(monthChoices(nov));
assert.equal(choices.length, 24); assert.deepEqual([choices[0], choices[1], choices[23]], [{ id: '2026-11', label: 'November 2026' }, { id: '2026-10', label: 'October 2026' }, { id: '2024-12', label: 'December 2024' }]);
assert.deepEqual(plain(monthChoices(jan)).slice(0, 3).map(m => m.id), ['2026-01', '2025-12', '2025-11'], 'across the year end');
assert.equal(new Set(choices.map(m => m.id)).size, 24);
assert.equal(defaultMonth(nov), '2026-10', 'the return is for the last whole month'); assert.equal(defaultMonth(jan), '2025-12'); assert.equal(defaultMonth(new Date(2026, 2, 31)), '2026-02', 'a short month before a long one');
assert.equal(isMonth('2026-10', nov), true); assert.equal(isMonth('2026-12', nov), false); assert.equal(isMonth('2024-11', nov), false, 'older than the list'); assert.equal(isMonth('garbage', nov), false);
assert.equal(monthId(2026, 0), '2026-01'); assert.equal(monthId(2026, 11), '2026-12'); assert.equal(monthText('2026-02'), 'February 2026'); assert.equal(monthText('x'), '');

// What to ask for.
assert.deepEqual(plain(countParams('2026-10')), { month: '2026-10' });
assert.deepEqual(plain(listParams('2026-10', null, false)), { month: '2026-10' });
assert.deepEqual(plain(listParams('2026-10', 'OPD1-055', true)), { month: '2026-10', code: 'OPD1-055', names: '1' });

// The grid has the shape of the form: sections in order, age rows in order, Male, Female, Total across, the Total row last.
const sexes = ['Male', 'Female', 'Total'];
const rows = [];
for (const [section, first] of [['First attendances', 5], ['Revisits', 80]]) for (const [i, age] of ['<1 year', '1-4 years', '5-14 years', '15+ years', 'Total'].entries()) sexes.forEach((sex, j) => rows.push({ code: 'OPD1-' + String(first + 15 * i + 5 * j).padStart(3, '0'), section, age, sex, value: i * 10 + j }));
sexes.forEach((sex, j) => rows.push({ code: 'OPD1-' + (155 + 5 * j), section: 'Total OPD attendances', age: 'Total', sex, value: 100 + j }));
const grid = plain(buildGrid(rows));
assert.deepEqual(grid.map(s => [s.label, s.rows.length]), [['First attendances', 5], ['Revisits', 5], ['Total OPD attendances', 1]]);
assert.deepEqual(grid[0].rows.map(r => r.age), ['<1 year', '1-4 years', '5-14 years', '15+ years', 'Total']);
assert.deepEqual(grid[0].rows[3].cells, [{ code: 'OPD1-050', sex: 'Male', value: 30 }, { code: 'OPD1-055', sex: 'Female', value: 31 }, { code: 'OPD1-060', sex: 'Total', value: 32 }]);
assert.deepEqual(grid[1].rows[4].cells.map(c => c.code), ['OPD1-140', 'OPD1-145', 'OPD1-150']); assert.deepEqual(grid[2].rows[0].cells.map(c => [c.code, c.value]), [['OPD1-155', 100], ['OPD1-160', 101], ['OPD1-165', 102]]);
assert.equal(grid.flatMap(s => s.rows).flatMap(r => r.cells).length, 33, 'every cell of the form once'); assert.deepEqual(plain(buildGrid([])), []);

// What a clicked cell is called.
assert.equal(cellLabel(rows, 'OPD1-055'), 'OPD1-055: First attendances, 15+ years, Female');
assert.equal(cellLabel(rows, 'OPD1-075'), 'OPD1-075: First attendances, all ages, Total'); assert.equal(cellLabel(rows, 'OPD1-999'), 'OPD1-999');
console.log('hia2 report logic: all checks passed');
