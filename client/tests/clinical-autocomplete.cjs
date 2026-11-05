const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'src/lib/clinicalAutocomplete.ts');
const exports_ = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: exports_, Map, RegExp });
const { activeVocabulary, suggest, formatExpansion, doNotUseWarning, emptyLearned, parseLearned, recordAccepted } = exports_;

const vocab = {
  entries: [
    { abbr: 'HTN', meanings: ['hypertension'], reviewed: true },
    { abbr: 'MS', meanings: ['multiple sclerosis', 'mitral stenosis'], reviewed: true },
    { abbr: 'ART', meanings: ['antiretroviral therapy'], matchCapitals: true, reviewed: true },
    { abbr: 'c/o', meanings: ['complaining of'], reviewed: true },
    { abbr: 'N&V', meanings: ['nausea and vomiting'], reviewed: true },
    { abbr: 'DM', meanings: ['diabetes mellitus'], reviewed: false },
    { abbr: 'EMPTY', meanings: [], reviewed: true },
  ],
  doNotUse: [
    { written: 'QD, Q.D., qd', risk: 'Mistaken for QID', writeInstead: 'daily', tokens: ['qd'], reviewed: true },
    { written: 'D/C', risk: 'Discharge or discontinue', writeInstead: 'Write the word in full', tokens: ['d/c'], reviewed: false },
  ],
};
const live = activeVocabulary(vocab), preview = activeVocabulary(vocab, true);
const at = (text, v = live, learned) => suggest(text, text.length, text.length, v, learned);

// Review gate: unreviewed entries are off unless explicitly previewed; empty entries never load.
assert.equal(at('DM'), null, 'unreviewed abbreviation is off');
assert.deepEqual(at('DM', preview).options, ['diabetes mellitus'], 'reviewer preview shows the draft');
assert.equal(live.abbreviations.has('empty'), false);
assert.equal(doNotUseWarning('D/C', 3, 3, live), null, 'unreviewed warning is off');
assert.ok(doNotUseWarning('D/C', 3, 3, preview), 'unreviewed warning shows in preview');

// Single meaning, case-insensitive, replaces exactly the typed word.
let s = at('Patient has HTN');
assert.deepEqual([s.start, s.end, s.abbr, s.options], [12, 15, 'HTN', ['hypertension']]);
assert.equal(at('patient has htn').options[0], 'hypertension', 'matching ignores case');
assert.equal(at('HTN').start, 0);

// Ambiguous abbreviations list every meaning; nothing is chosen for the doctor.
assert.deepEqual(at('known MS').options, ['multiple sclerosis', 'mitral stenosis']);

// Everyday-word abbreviations need capitals.
assert.equal(at('on ART').options[0], 'antiretroviral therapy');
assert.equal(at('on art'), null, 'the ordinary word art is left alone');

// Punctuation inside the abbreviation.
assert.equal(at('c/o').options[0], 'complaining of');
assert.equal(at('pt has N&V').options[0], 'nausea and vomiting');

// Not a suggestion: caret mid-word, word continues, selection, text after the caret on the line, not a known word.
assert.equal(at('HTNx'), null);
assert.equal(at('HTN '), null, 'only straight after the word');
assert.equal(suggest('HTN', 3, 2, live), null, 'a selection suppresses suggestions');
assert.equal(suggest('HTN later', 3, 3, live), null, 'never overlaps text after the caret');
assert.equal(suggest('HTN\nnext line', 3, 3, live).options[0], 'hypertension', 'a following line does not block it');
assert.equal(at('cough'), null);
assert.equal(at(''), null);
assert.equal(suggest('HTN', 9, 9, live), null, 'caret outside the text is ignored');
assert.equal(suggest('xHTN', 4, 4, live), null, 'a longer word is not an abbreviation');

// Capital only at the start of a sentence.
assert.equal(formatExpansion('Known HTN', 6, 'hypertension'), 'hypertension');
assert.equal(formatExpansion('HTN', 0, 'hypertension'), 'Hypertension');
assert.equal(formatExpansion('Seen today. HTN', 12, 'hypertension'), 'Hypertension');
assert.equal(formatExpansion('Seen\nHTN', 5, 'hypertension'), 'Hypertension');
assert.equal(formatExpansion('Has HTN', 4, 'C-reactive protein'), 'C-reactive protein');

// Do-not-use warning appears after the word or one space, never mid-word.
assert.equal(doNotUseWarning('give QD', 7, 7, live).writeInstead, 'daily');
assert.equal(doNotUseWarning('give qd ', 8, 8, live).writeInstead, 'daily');
assert.equal(doNotUseWarning('give qd now', 11, 11, live), null);
assert.equal(doNotUseWarning('QDx', 3, 3, live), null);
assert.equal(doNotUseWarning('QD', 2, 1, live), null);

// Phrase completion (stage two).
vocab.phrases = [
  { text: 'no history of chest pain', reviewed: true },
  { text: 'no history of hypertension', reviewed: true },
  { text: 'chest clear, no added sounds', reviewed: true },
  { text: 'abdomen soft, non-tender', reviewed: true },
  { text: 'secret unreviewed phrase', reviewed: false },
];
const withPhrases = activeVocabulary(vocab), withPreview = activeVocabulary(vocab, true);
const ph = (text, v = withPhrases) => suggest(text, text.length, text.length, v);

let p = ph('no history of ch');
assert.deepEqual([p.phrase, p.start, p.end, ...p.options], [true, 16, 16, 'est pain'], 'completes the rest of the phrase after the caret');
assert.equal(ph('No History Of Ch').options[0], 'est pain', 'matching ignores case and keeps the doctor\'s own typing');
assert.equal(ph('no history of h').options[0], 'ypertension');
assert.equal(ph('Seen today. no history of ch').options[0], 'est pain', 'a phrase may follow other words on the line');
assert.equal(ph('chest clear, n').options[0], 'o added sounds', 'continues across a comma');
assert.equal(ph('abdomen soft,  non').options[0], '-tender', 'extra spaces are tolerated');
assert.equal(ph('line one\nno history of ch').options[0], 'est pain', 'only the current line counts');
assert.equal(suggest('no history of ch\nnext', 16, 16, withPhrases).options[0], 'est pain', 'a following line does not block it');

// Never guess: one word, trailing space, complete phrase, unreviewed, text after the caret, selection, off.
assert.equal(ph('chest'), null, 'a single word is not a phrase');
assert.equal(ph('no history of '), null, 'no suggestion straight after a space');
assert.equal(ph('no history of chest pain'), null, 'a finished phrase has nothing to add');
assert.equal(ph('no history of chest pai'), null, 'a single remaining letter is not worth a suggestion');
assert.equal(ph('no history of chest pa').options[0], 'in', 'two remaining letters are');
assert.equal(ph('secret unreviewed'), null, 'unreviewed phrases are off');
assert.equal(ph('secret unreviewed', withPreview).options[0], ' phrase', 'but show in reviewer preview');
assert.equal(suggest('no history of ch later', 16, 16, withPhrases), null, 'never overlaps text after the caret');
assert.equal(suggest('no history of ch', 16, 10, withPhrases), null, 'a selection suppresses suggestions');
assert.equal(ph('no history of ch', activeVocabulary({ entries: [], doNotUse: [] })), null, 'no phrase list, no suggestion');
assert.equal(ph('xx yy zz'), null);

// Abbreviations keep priority on a known abbreviation; a phrase fills in otherwise.
vocab.phrases.push({ text: 'known MS history', reviewed: true });
const both = activeVocabulary(vocab);
assert.deepEqual(suggest('known MS', 8, 8, both).options, ['multiple sclerosis', 'mitral stenosis'], 'abbreviation wins over a phrase');
assert.equal(suggest('on art', 6, 6, both), null, 'capital-only abbreviation falls through to phrases, none match');

// The shipped phrase list: no numbers, no duplicates, no empty entries, and phrases are plain sentences.
const shipped = JSON.parse(fs.readFileSync(path.join(root, 'src/data/clinicalPhrases.json'), 'utf8')).phrases;
assert.ok(shipped.length > 100);
assert.equal(new Set(shipped.map(x => x.text.toLowerCase())).size, shipped.length, 'no duplicate phrases');
for (const x of shipped) { assert.ok(x.text.trim() === x.text && x.text.length > 4, `bad phrase: ${x.text}`); assert.ok(!/\d/.test(x.text), `number in phrase: ${x.text}`); }
const real = activeVocabulary({ entries: [], doNotUse: [], phrases: shipped });
assert.equal(ph('chest clear, no ad', real).options[0], 'ded sounds');
assert.equal(ph('no history of ch', real).options[0], 'est pain');

// Learning from use (stage three): ranking only, counts only, nothing typed is kept.
vocab.phrases = [
  { text: 'no history of chest pain', reviewed: true },
  { text: 'no history of cough', reviewed: true },
  { text: 'no history of diabetes', reviewed: true },
];
const lv = activeVocabulary(vocab);
const sug = (text, learned) => suggest(text, text.length, text.length, lv, learned);
assert.equal(sug('no history of c').options[0], 'hest pain', 'with nothing learned the list order decides');
let learned = emptyLearned();
learned = recordAccepted(learned, sug('no history of co'), 'ugh');
assert.equal(sug('no history of c', learned).options[0], 'ough', 'the phrase this doctor accepts rises to the top');
assert.equal(sug('no history of d', learned).options[0], 'iabetes', 'unrelated phrases are unaffected');
assert.equal(sug('no history of ch', learned).options[0], 'est pain', 'a phrase that no longer matches is not offered');
learned = recordAccepted(learned, sug('no history of ch'), 'est pain');
learned = recordAccepted(learned, sug('no history of ch'), 'est pain');
assert.equal(sug('no history of c', learned).options[0], 'hest pain', 'the most used phrase wins');
assert.equal(sug('no history of c', learned).key, 'no history of chest pain');

// Ambiguous abbreviations: all meanings stay listed, the usual one comes first, nothing expands by itself.
let usage = emptyLearned();
assert.deepEqual([...at('known MS', live, usage).options], ['multiple sclerosis', 'mitral stenosis']);
usage = recordAccepted(usage, at('known MS'), 'mitral stenosis');
const reordered = suggest('known MS', 8, 8, live, usage);
assert.deepEqual([...reordered.options], ['mitral stenosis', 'multiple sclerosis'], 'the usual meaning comes first');
assert.equal(reordered.options.length, 2, 'every meaning is still offered');
assert.equal(suggest('known ms', 8, 8, live, usage).options[0], 'mitral stenosis', 'case of typing does not matter');
const single = at('has HTN');
assert.equal(recordAccepted(usage, single, 'hypertension'), usage, 'a single meaning has nothing to rank and is not recorded');

// Stored data is only counts, and anything else is thrown away.
assert.deepEqual(JSON.parse(JSON.stringify(parseLearned(null))), { phrases: {}, words: {}, meanings: {} });
assert.deepEqual(JSON.parse(JSON.stringify(parseLearned('not json'))), { phrases: {}, words: {}, meanings: {} });
const dirty = parseLearned(JSON.stringify({ phrases: { ok: 3, text: 'patient John has HIV', neg: -2, nan: null, big: 99999 }, meanings: { ms: { a: 2, b: 'free text' }, bad: 'x', empty: {} }, note: 'extra' }));
assert.deepEqual(JSON.parse(JSON.stringify(dirty)), { phrases: { ok: 3, big: 1000 }, words: {}, meanings: { ms: { a: 2 } } }, 'only positive counts survive');

// Bounded: counts decay at the cap and the profile is capped.
let heavy = emptyLearned();
const msSug = at('MS');
for (let i = 0; i < 1100; i++) heavy = recordAccepted(heavy, msSug, 'mitral stenosis');
assert.ok(heavy.meanings.ms['mitral stenosis'] < 1000, 'counts are halved at the cap');
assert.ok(heavy.meanings.ms['mitral stenosis'] > 0);
let many = emptyLearned();
for (let i = 0; i < 450; i++) many = recordAccepted(many, { phrase: true, key: 'phrase ' + i, abbr: 'x', options: ['y'], start: 0, end: 0 }, 'y');
many = recordAccepted(many, { phrase: true, key: 'phrase 0', abbr: 'x', options: ['y'], start: 0, end: 0 }, 'y');
assert.equal(Object.keys(many.phrases).length, 400, 'only the most used 400 are kept');
assert.equal(many.phrases['phrase 0'], 2, 'the most used survive');

// Single-word completion (the word being typed, from the clinical word list).
vocab.words = [
  { text: 'cough', reviewed: true },
  { text: 'coughing', reviewed: true },
  { text: 'headache', reviewed: true },
  { text: 'hearing', reviewed: true },
  { text: 'heartburn', reviewed: true },
  { text: 'secretword', reviewed: false },
];
vocab.phrases = [{ text: 'no history of chest pain', reviewed: true }];
const wv = activeVocabulary(vocab), wpreview = activeVocabulary(vocab, true);
const wd = (text, learned, v = wv) => suggest(text, text.length, text.length, v, learned);
let w = wd('coug');
assert.deepEqual([w.word, w.phrase, w.start, w.end, ...w.options, w.key], [true, true, 4, 4, 'h', 'cough'], 'completes the rest of the word after the caret');
assert.equal(wd('Patient has coug').options[0], 'h', 'works in the middle of a line');
assert.equal(wd('Coug').options[0], 'h', 'a capital start is fine and the doctor\'s own typing is kept');
assert.equal(wd('line one\nhead').options[0], 'ache', 'only the current line counts');
assert.equal(suggest('coug\nnext', 4, 4, wv).options[0], 'h', 'a following line does not block it');
assert.equal(wd('hea').options[0], 'ring', 'the shortest match comes first when nothing is learned');
assert.equal(wd('head').options[0], 'ache');
assert.equal(wd('no cou').options[0], 'gh', 'a word after other words');

// Never guess: too short, already complete, capitals, digits, hyphen, text after the caret, selection, unreviewed.
assert.equal(wd('co'), null, 'two letters is too few');
assert.equal(wd('cough'), null, 'a finished word has nothing to add, even if a longer form exists');
assert.equal(wd('COU'), null, 'capitals are for abbreviations');
assert.equal(wd('5cou'), null, 'not after a digit');
assert.equal(wd('non-cou'), null, 'not after a hyphen');
assert.equal(wd('cough '), null, 'only straight after the word');
assert.equal(wd('xyz'), null);
assert.equal(wd('secretw'), null, 'unreviewed words are off');
assert.equal(wd('secretw', undefined, wpreview).options[0], 'ord', 'but show in reviewer preview');
assert.equal(suggest('coug later', 4, 4, wv), null, 'never overlaps text after the caret');
assert.equal(suggest('coug', 4, 2, wv), null, 'a selection suppresses suggestions');
assert.equal(wd('coug', undefined, activeVocabulary({ entries: [], doNotUse: [] })), null, 'no word list, no suggestion');

// Priority: abbreviation, then phrase, then word.
assert.equal(wd('HTN').options[0], 'hypertension', 'an exact abbreviation wins');
assert.equal(wd('no history of ch').options[0], 'est pain', 'a phrase wins over a word');
assert.equal(wd('no history of ch').word, undefined);
assert.equal(wd('no history of hea').word, true, 'with no phrase matching, the word is offered');

// Learning ranks words, never adds them.
let wl = emptyLearned();
assert.equal(wd('hea', wl).options[0], 'ring');
wl = recordAccepted(wl, wd('head'), 'ache');
assert.equal(wd('hea', wl).options[0], 'dache', 'the word this doctor accepts rises to the top');
assert.equal(wd('coug', wl).options[0], 'h', 'other words are unaffected');
assert.equal(wl.words.headache, 1);
assert.deepEqual(JSON.parse(JSON.stringify(wl.phrases)), {}, 'words and phrases are counted apart');

// The shipped word list: single lower-case letters-only words, no duplicates.
const wordFile = JSON.parse(fs.readFileSync(path.join(root, 'src/data/clinicalWords.json'), 'utf8')).words;
assert.ok(wordFile.length > 200);
assert.equal(new Set(wordFile.map(x => x.text)).size, wordFile.length, 'no duplicate words');
for (const x of wordFile) assert.ok(/^[a-z]{4,}$/.test(x.text), 'bad word: ' + x.text);
const realWords = activeVocabulary({ entries: [], doNotUse: [], words: wordFile });
assert.equal(wd('coug', undefined, realWords).options[0], 'h');
assert.equal(wd('wheez', undefined, realWords).options[0], 'e');

console.log('Passed clinical autocomplete checks: review gate and preview, case rules, ambiguity, punctuation, caret/selection guards, sentence capitalisation, do-not-use warnings, phrase and word completion and learning from use.');
