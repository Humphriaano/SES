const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const load = file => { const out = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: out, Set }); return out; };
const { searchProcedures, mergeProcedures, QUICK_PICKS } = load('src/lib/procedureSearch.ts');
const catalogue = JSON.parse(fs.readFileSync(path.join(root, 'src/data/proceduresCatalogue.json'), 'utf8')).procedures;
const names = (q, list = catalogue) => [...searchProcedures(list, q)].map(x => x.name);

// The words doctors actually use.
assert.equal(names('cannulation')[0], 'Peripheral IV cannulation', 'cannulation finds cannulation');
assert.equal(names('cannula')[0], 'Peripheral IV cannulation', 'a stem works');
assert.equal(names('canul').length, 0, 'a misspelling finds nothing rather than something wrong');
assert.equal(names('iv access')[0], 'Peripheral IV cannulation', 'alternative names work');
assert.ok(names('drip').includes('Peripheral IV cannulation') && names('drip').includes('IV fluid infusion'), 'drip means both the line and the fluids');
assert.ok(names('suture').includes('Suturing of wound') && names('stitches').includes('Suture removal'), 'plain words find the right procedures');
assert.equal(names('cath')[0].toLowerCase().includes('catheter'), true);
assert.ok(names('foley').includes('Urinary catheterisation'));
assert.ok(names('plaster').includes('Plaster cast application'));
assert.ok(names('ecg').some(n => n.includes('ECG')) && names('lumbar').includes('Lumbar puncture'));
assert.ok(names('pap smear').includes('Cervical screening (VIA or Pap smear)'));

// Matching rules: every typed word must start a word, in any order, case and punctuation ignored.
assert.deepEqual(names('IV  CANN'), names('iv cann'), 'case and spacing are ignored');
assert.ok(names('cannulation iv').includes('Peripheral IV cannulation'), 'any order');
assert.equal(names('c').length, 0, 'one letter is too few');
assert.equal(names('').length, 0); assert.equal(names('   ').length, 0);
assert.equal(names('xyzzy').length, 0);
assert.ok(searchProcedures(catalogue, 'inj', 3).length <= 3, 'the limit is respected');
assert.ok(names('inj').length >= 3, 'several injections are listed');

// Better matches come first: a name that starts with the text beats one that only contains the word.
const sample = [
  { code: 'a', name: 'Removal of dressing', category: 'x' }, { code: 'b', name: 'Dressing change', category: 'x' }, { code: 'c', name: 'Burns care', category: 'x', aliases: 'dressing' },
];
assert.deepEqual(names('dressing', sample), ['Dressing change', 'Removal of dressing', 'Burns care']);

// Procedures an admin added by hand join the list after the built-in ones, never twice.
const merged = mergeProcedures(catalogue.slice(0, 2), [{ code: catalogue[0].code, name: 'duplicate', category: 'x' }, { code: 'procedure_custom_thing', name: 'Custom thing', category: 'Other' }]);
assert.equal(merged.length, 3); assert.equal(merged[2].name, 'Custom thing');
assert.deepEqual(names('custom', merged), ['Custom thing']);

// The shipped list: unique, readable, and everything quick-picked exists.
assert.ok(catalogue.length >= 50);
assert.equal(new Set(catalogue.map(x => x.code)).size, catalogue.length);
for (const x of catalogue) { assert.match(x.code, /^procedure_[a-z0-9_]+$/); assert.ok(x.name.length >= 2 && x.name.length <= 120 && x.category); }
for (const code of QUICK_PICKS) assert.ok(catalogue.some(x => x.code === code), 'quick pick missing from the list: ' + code);
assert.ok(catalogue.some(x => /cannulation/i.test(x.name)), 'cannulation is on the list');
// Nothing in a procedure name is a drug dose or a price.
for (const x of catalogue) assert.ok(!/\d+\s?(mg|ml|mcg|zmw|kwacha)/i.test(x.name), 'dose or price in a name: ' + x.name);

console.log('Passed procedure search checks: cannulation and everyday terms, alternative names, any-order matching, ranking, custom procedures, and the shipped list.');
