const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const out = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/pharmacyReport.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: out, Math, Number });
const { optionParams, countParams, sameAsOptions, listParams, listLabel, quantityText, DEFAULT_FILTERS } = out;
const plain = o => JSON.parse(JSON.stringify(o));
const month = { from: '2026-10-08', to: '2026-11-06' }, none = { from: '', to: '' }, brand = { ...DEFAULT_FILTERS, groupBy: 'brand' };

// The item choices are only the period; the counts add what the screen has chosen.
assert.deepEqual(plain(optionParams(month)), { from: '2026-10-08', to: '2026-11-06' });
assert.deepEqual(plain(countParams('dispensed', month, DEFAULT_FILTERS)), { from: '2026-10-08', to: '2026-11-06' });
assert.deepEqual(plain(countParams('dispensed', none, { ...brand, item: 'AMX|capsule', type: 'direct' })), { item: 'AMX|capsule', groupBy: 'brand', type: 'direct' });
assert.deepEqual(plain(countParams('prescriptions', none, { ...brand, item: 'PCM', type: 'direct' })), { item: 'PCM' }, 'prescriptions have no brand or type');
assert.deepEqual(plain(countParams('dispensed', none, { ...DEFAULT_FILTERS, names: true })), {}, 'names belong to the records');

// One request serves the choices and the table only when nothing narrows the table.
assert.equal(sameAsOptions('dispensed', DEFAULT_FILTERS), true); assert.equal(sameAsOptions('dispensed', brand), false); assert.equal(sameAsOptions('dispensed', { ...DEFAULT_FILTERS, type: 'direct' }), false);
assert.equal(sameAsOptions('dispensed', { ...DEFAULT_FILTERS, item: 'IBU|tablet' }), false); assert.equal(sameAsOptions('prescriptions', { ...brand, type: 'direct' }), true); assert.equal(sameAsOptions('prescriptions', { ...DEFAULT_FILTERS, item: 'PCM' }), false);

// Medicines dispensed: a row names an item (or a brand); a type cell names its type; the screen's filters stay.
assert.deepEqual(plain(listParams('dispensed', month, DEFAULT_FILTERS, { key: 'AMX|capsule', measure: 'all' })), { from: '2026-10-08', to: '2026-11-06', item: 'AMX|capsule' });
assert.deepEqual(plain(listParams('dispensed', none, DEFAULT_FILTERS, { key: 'IBU|tablet', measure: 'substitution' })), { item: 'IBU|tablet', type: 'substitution' });
assert.deepEqual(plain(listParams('dispensed', none, brand, { key: 'Not recorded', measure: 'all' })), { brand: 'Not recorded' });
assert.deepEqual(plain(listParams('dispensed', none, { ...brand, item: 'AMX|capsule' }, { key: 'Amoxil', measure: 'all' })), { item: 'AMX|capsule', brand: 'Amoxil' }, 'a brand inside one item');
assert.deepEqual(plain(listParams('dispensed', none, { ...DEFAULT_FILTERS, type: 'direct' }, { key: null, measure: 'all' })), { type: 'direct' }, 'the totals row keeps the filters');
assert.equal(listParams('dispensed', none, { ...DEFAULT_FILTERS, type: 'direct' }, { key: null, measure: 'substitution' })['type'], 'substitution', 'a clicked type wins over the filter');
assert.deepEqual(plain(listParams('dispensed', none, { ...DEFAULT_FILTERS, names: true }, { key: null, measure: 'all' })), { names: '1' });

// Prescriptions: a status cell names its status; "written" is every status.
assert.deepEqual(plain(listParams('prescriptions', month, DEFAULT_FILTERS, { key: 'PCM', measure: 'waiting' })), { from: '2026-10-08', to: '2026-11-06', item: 'PCM', status: 'waiting' });
assert.deepEqual(plain(listParams('prescriptions', none, DEFAULT_FILTERS, { key: 'PCM', measure: 'all' })), { item: 'PCM' });
assert.deepEqual(plain(listParams('prescriptions', none, DEFAULT_FILTERS, { key: null, measure: 'notAvailable' })), { status: 'notAvailable' });
assert.deepEqual(plain(listParams('prescriptions', none, { ...DEFAULT_FILTERS, item: 'PCM' }, { key: null, measure: 'dispensed' })), { item: 'PCM', status: 'dispensed' });

// What a clicked number is called.
const labels = { 'AMX|capsule': 'Amoxicillin', PCM: 'Paracetamol' };
assert.equal(listLabel('dispensed', DEFAULT_FILTERS, { key: 'AMX|capsule', measure: 'substitution' }, labels), 'Amoxicillin · Substituted');
assert.equal(listLabel('dispensed', DEFAULT_FILTERS, { key: null, measure: 'all' }, labels), 'All items · All dispensings');
assert.equal(listLabel('dispensed', brand, { key: null, measure: 'all' }, labels), 'All brands · All dispensings');
assert.equal(listLabel('dispensed', brand, { key: 'Amoxil', measure: 'all' }, labels), 'Amoxil · All dispensings', 'a brand is its own name');
assert.equal(listLabel('prescriptions', DEFAULT_FILTERS, { key: 'PCM', measure: 'waiting' }, labels), 'Paracetamol · Waiting');
assert.equal(listLabel('prescriptions', DEFAULT_FILTERS, { key: null, measure: 'all' }, labels), 'All items · All prescriptions');

// Quantities carry their unit and are never invented.
for (const [q, u, text] of [[49, 'capsule', '49 capsule'], [0.5, 'bottle', '0.5 bottle'], [10.456, 'mL', '10.46 mL'], [20, null, '20'], [0, 'tablet', '0 tablet'], [null, 'tablet', '—'], [undefined, null, '—'], [NaN, 'tablet', '—']]) assert.equal(quantityText(q, u), text, String(q));
console.log('pharmacy report logic: all checks passed');
