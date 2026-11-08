const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const out = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/attendanceExtras.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: out });
const { workloadParams, workloadLineParams, workloadLabel, WORKLOAD_DEFAULTS, diagnosisParams, diagnosisLineParams, diagnosisLabel, DIAGNOSIS_DEFAULTS, visibleRows, FIRST_ROWS } = out;
const plain = o => JSON.parse(JSON.stringify(o));
const month = { from: '2026-10-08', to: '2026-11-06' }, none = { from: '', to: '' }, staff = { ...WORKLOAD_DEFAULTS, groupBy: 'staff' };

// Workload: the counts ask for the period and the grouping; a clicked number names its row and whether seen.
assert.deepEqual(plain(workloadParams(month, WORKLOAD_DEFAULTS)), { from: '2026-10-08', to: '2026-11-06' });
assert.deepEqual(plain(workloadParams(none, { ...staff, names: true })), { groupBy: 'staff' }, 'names belong to the records');
assert.deepEqual(plain(workloadLineParams(month, WORKLOAD_DEFAULTS, { key: 'room-1', measure: 'attendances' })), { from: '2026-10-08', to: '2026-11-06', servicePoint: 'room-1' });
assert.deepEqual(plain(workloadLineParams(none, WORKLOAD_DEFAULTS, { key: 'room-1', measure: 'seen' })), { servicePoint: 'room-1', seen: 'yes' });
assert.deepEqual(plain(workloadLineParams(none, staff, { key: 'user-1', measure: 'notSeen' })), { staff: 'user-1', seen: 'no' });
assert.deepEqual(plain(workloadLineParams(none, staff, { key: 'none', measure: 'attendances' })), { staff: 'none' }, 'the row of patients nobody started seeing');
assert.deepEqual(plain(workloadLineParams(none, { ...staff, names: true }, { key: null, measure: 'seen' })), { seen: 'yes', names: '1' }, 'the totals row names nobody');
assert.equal(workloadLabel(WORKLOAD_DEFAULTS, { key: 'room-1', measure: 'notSeen' }, { 'room-1': 'Treatment room' }), 'Treatment room · Not seen yet');
assert.equal(workloadLabel(staff, { key: null, measure: 'attendances' }, {}), 'All staff · All attendances');
assert.equal(workloadLabel(WORKLOAD_DEFAULTS, { key: null, measure: 'seen' }, {}), 'All service points · Seen');

// OPD diagnoses: the screen's filters, and a clicked number adds its code and its column's meaning, which wins over the screen's sex filter.
assert.deepEqual(plain(diagnosisParams(month, DIAGNOSIS_DEFAULTS)), { from: '2026-10-08', to: '2026-11-06' });
assert.deepEqual(plain(diagnosisParams(none, { sex: 'FEMALE', ageBand: '25-49', mainOnly: true, names: true })), { sex: 'FEMALE', ageBand: '25-49', main: 'yes' });
assert.deepEqual(plain(diagnosisLineParams(none, DIAGNOSIS_DEFAULTS, { code: 'CA40', measure: 'consultations' })), { code: 'CA40' });
assert.deepEqual(plain(diagnosisLineParams(none, DIAGNOSIS_DEFAULTS, { code: 'CA40', measure: 'main' })), { code: 'CA40', main: 'yes' });
assert.deepEqual(plain(diagnosisLineParams(month, { ...DIAGNOSIS_DEFAULTS, sex: 'FEMALE', names: true }, { code: 'BA00', measure: 'male' })), { from: '2026-10-08', to: '2026-11-06', sex: 'MALE', code: 'BA00', names: '1' });
assert.deepEqual(plain(diagnosisLineParams(none, { ...DIAGNOSIS_DEFAULTS, ageBand: '5-14', mainOnly: true }, { code: '1F40', measure: 'other' })), { ageBand: '5-14', main: 'yes', code: '1F40', sex: 'OTHER' });
assert.equal(diagnosisLabel({ code: 'CA40', measure: 'female' }, { CA40: 'Pneumonia' }), 'CA40 Pneumonia · Female');
assert.equal(diagnosisLabel({ code: 'XX99', measure: 'consultations' }, {}), 'XX99 · All consultations');

// The commonest diagnoses first, the rest one click away.
const many = Array.from({ length: 40 }, (_, i) => i);
assert.equal(FIRST_ROWS, 25); assert.equal(visibleRows(many, false).length, 25); assert.equal(visibleRows(many, true).length, 40); assert.equal(visibleRows([1, 2], false).length, 2);
console.log('workload and diagnosis logic: all checks passed');
