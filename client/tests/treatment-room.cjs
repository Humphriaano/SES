const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const out = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/treatmentRoom.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: out, Date, Math });
const { waitingText, agoText, patientLine } = out;
const now = Date.parse('2026-11-05T12:00:00Z'), ago = minutes => new Date(now - minutes * 60000).toISOString();

// How long a patient has been waiting.
assert.equal(waitingText(ago(0), now), 'Just now');
assert.equal(waitingText(ago(0.5), now), 'Just now');
assert.equal(waitingText(ago(1), now), '1 min');
assert.equal(waitingText(ago(59), now), '59 min');
assert.equal(waitingText(ago(60), now), '1 h');
assert.equal(waitingText(ago(65), now), '1 h 5 min');
assert.equal(waitingText(ago(180), now), '3 h');
assert.equal(waitingText(ago(24 * 60), now), '1 day');
assert.equal(waitingText(ago(50 * 60), now), '2 days');
assert.equal(waitingText(ago(-5), now), 'Just now', 'a clock a little ahead never shows a negative wait');
assert.equal(waitingText(null, now), ''); assert.equal(waitingText(undefined, now), '');

assert.equal(agoText(ago(0), now), 'just now'); assert.equal(agoText(ago(12), now), '12 min ago'); assert.equal(agoText(ago(125), now), '2 h 5 min ago'); assert.equal(agoText(null, now), '');

// Age is counted in calendar years.
const today = new Date(2026, 10, 5);
assert.equal(patientLine({ dateOfBirth: '1990-11-05T00:00:00.000Z', gender: 'FEMALE' }, today), 'Female · 36 yrs', 'on the birthday');
assert.equal(patientLine({ dateOfBirth: '1990-11-06T00:00:00.000Z', gender: 'FEMALE' }, today), 'Female · 35 yrs', 'the day before the birthday');
assert.equal(patientLine({ dateOfBirth: '2025-11-05T00:00:00.000Z', gender: 'MALE' }, today), 'Male · 1 yr');
assert.equal(patientLine({ dateOfBirth: '2026-06-01T00:00:00.000Z', gender: 'MALE' }, today), 'Male · Under 1 yr');
assert.equal(patientLine({ dateOfBirth: '2999-01-01T00:00:00.000Z', gender: 'MALE' }, today), 'Male', 'a date of birth in the future shows no age');
assert.equal(patientLine({ dateOfBirth: 'garbage', gender: 'OTHER' }, today), '');
assert.equal(patientLine(null, today), '');

console.log('Passed treatment room helper checks: waiting time wording and calendar-year ages.');
