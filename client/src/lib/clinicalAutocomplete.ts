// Clinical abbreviation suggestions for free-text notes. Pure and offline: the
// vocabulary is held in the browser and matched against the word being typed.
// A suggestion is only ever ordinary text; nothing about what is saved changes.

export interface AbbreviationEntry { abbr: string; meanings: string[]; matchCapitals?: boolean; reviewed?: boolean }
export interface DoNotUseEntry { written: string; risk: string; writeInstead: string; tokens?: string[]; reviewed?: boolean }
export interface PhraseEntry { text: string; reviewed?: boolean }
export interface WordEntry { text: string; reviewed?: boolean }
export interface Vocabulary { entries: AbbreviationEntry[]; doNotUse: DoNotUseEntry[]; phrases?: PhraseEntry[]; words?: WordEntry[]; generalWords?: WordEntry[] }

export interface ActiveVocabulary { abbreviations: Map<string, AbbreviationEntry>; warnings: Map<string, DoNotUseEntry>; phrases: { text: string; lower: string }[]; words: { text: string; lower: string; general: boolean }[] }
// An abbreviation suggestion replaces the typed word (start..end) with one of
// its meanings. A phrase suggestion only adds text after the caret: options[0]
// is the rest of the phrase, and start === end. A word completion is the same
// shape with word set: options[0] is the rest of the word.
export interface Suggestion { start: number; end: number; abbr: string; options: string[]; phrase?: boolean; word?: boolean; key?: string }

// What one doctor has accepted before: only counts against entries of the
// shipped vocabulary. It never holds anything typed, so it carries no patient
// data. It changes the order of suggestions, never what is suggested.
export interface Learned { phrases: Record<string, number>; words: Record<string, number>; meanings: Record<string, Record<string, number>> }
export const emptyLearned = (): Learned => ({ phrases: {}, words: {}, meanings: {} });
const MAX_LEARNED = 400, MAX_COUNT = 1000;

const countsOnly = (value: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (value && typeof value === 'object') for (const [key, count] of Object.entries(value)) if (typeof count === 'number' && Number.isFinite(count) && count > 0) out[key] = Math.min(Math.floor(count), MAX_COUNT);
  return out;
};

// Reads stored learning defensively: anything that is not a plain count is dropped.
export function parseLearned(raw: string | null): Learned {
  try {
    const data = raw ? JSON.parse(raw) : null;
    const learned = emptyLearned();
    if (!data || typeof data !== 'object') return learned;
    learned.phrases = countsOnly(data.phrases);
    learned.words = countsOnly(data.words);
    if (data.meanings && typeof data.meanings === 'object') for (const [abbr, counts] of Object.entries(data.meanings)) { const clean = countsOnly(counts); if (Object.keys(clean).length) learned.meanings[abbr] = clean; }
    return learned;
  } catch { return emptyLearned(); }
}

function bump(counts: Record<string, number>, key: string) {
  counts[key] = (counts[key] ?? 0) + 1;
  // Halve everything when one count gets large, so recent habits can still overtake old ones.
  if (counts[key] >= MAX_COUNT) for (const k of Object.keys(counts)) counts[k] = Math.max(1, Math.floor(counts[k] / 2));
}

// Keeps the stored profile small: the most used entries survive.
function prune(counts: Record<string, number>, limit: number) {
  const keys = Object.keys(counts);
  if (keys.length <= limit) return;
  keys.sort((a, b) => counts[b] - counts[a]);
  for (const key of keys.slice(limit)) delete counts[key];
}

export function recordAccepted(learned: Learned, suggestion: Suggestion, chosen: string): Learned {
  const next: Learned = { phrases: { ...learned.phrases }, words: { ...learned.words }, meanings: Object.fromEntries(Object.entries(learned.meanings).map(([abbr, counts]) => [abbr, { ...counts }])) };
  if (suggestion.word) {
    if (!suggestion.key) return learned;
    bump(next.words, suggestion.key); prune(next.words, MAX_LEARNED);
  } else if (suggestion.phrase) {
    if (!suggestion.key) return learned;
    bump(next.phrases, suggestion.key); prune(next.phrases, MAX_LEARNED);
  } else {
    // Only ambiguous abbreviations have anything to rank.
    if (suggestion.options.length < 2) return learned;
    const abbr = suggestion.abbr.toLowerCase();
    bump(next.meanings[abbr] ??= {}, chosen);
  }
  return next;
}

// Entries marked reviewed: false (rejected or awaiting sign-off) stay off, unless the
// reviewer is deliberately previewing the draft list in their own browser.
export function activeVocabulary(vocabulary: Vocabulary, includeUnreviewed = false): ActiveVocabulary {
  const abbreviations = new Map<string, AbbreviationEntry>(), warnings = new Map<string, DoNotUseEntry>();
  for (const entry of vocabulary.entries) if ((includeUnreviewed || entry.reviewed) && entry.meanings.length) abbreviations.set(entry.abbr.toLowerCase(), entry);
  for (const entry of vocabulary.doNotUse) if (includeUnreviewed || entry.reviewed) for (const token of entry.tokens ?? []) warnings.set(token.toLowerCase(), entry);
  const phrases: ActiveVocabulary['phrases'] = [];
  for (const entry of vocabulary.phrases ?? []) if ((includeUnreviewed || entry.reviewed) && entry.text.trim()) phrases.push({ text: entry.text, lower: entry.text.toLowerCase() });
  const words: ActiveVocabulary['words'] = [];
  for (const entry of vocabulary.words ?? []) if ((includeUnreviewed || entry.reviewed) && entry.text.trim()) words.push({ text: entry.text, lower: entry.text.toLowerCase(), general: false });
  for (const entry of vocabulary.generalWords ?? []) if ((includeUnreviewed || entry.reviewed) && entry.text.trim()) words.push({ text: entry.text, lower: entry.text.toLowerCase(), general: true });
  return { abbreviations, warnings, phrases, words };
}

const TOKEN = /[A-Za-z0-9][A-Za-z0-9/&]*$/;
const startOfSentence = (before: string) => /(^|[.!?]\s+|\n\s*)$/.test(before);

// The word being typed, only when the caret sits at its end with nothing
// selected and nothing else on the line, so a ghost never overlaps text.
function tokenAtCaret(text: string, caret: number, selectionEnd: number) {
  if (caret !== selectionEnd || caret < 1 || caret > text.length) return null;
  const rest = text.slice(caret);
  if (rest !== '' && rest[0] !== '\n') return null;
  const match = TOKEN.exec(text.slice(0, caret));
  return match ? { token: match[0], start: caret - match[0].length, end: caret } : null;
}

const MAX_PHRASE_WORDS = 8;

// Completes a common phrase from what has been typed on the current line. The
// longest tail of the line that starts a phrase wins. Among phrases that match,
// the one this doctor has accepted most comes first; the list order breaks ties.
// Needs at least two words and a word in progress, so it never guesses from
// a single word or from a trailing space.
function suggestPhrase(text: string, caret: number, selectionEnd: number, vocabulary: ActiveVocabulary, learned?: Learned): Suggestion | null {
  if (!vocabulary.phrases.length || caret !== selectionEnd || caret < 1 || caret > text.length) return null;
  const rest = text.slice(caret);
  if (rest !== '' && rest[0] !== '\n') return null;
  const before = text.slice(0, caret);
  const line = before.slice(before.lastIndexOf('\n') + 1);
  if (!line || /\s$/.test(line)) return null;
  const words = line.split(/\s+/).filter(Boolean).slice(-MAX_PHRASE_WORDS);
  for (let i = 0; i < words.length - 1; i++) {
    const tail = words.slice(i).join(' ').toLowerCase();
    if (tail.length < 5) break;
    let hit: ActiveVocabulary['phrases'][number] | undefined, best = -1;
    for (const phrase of vocabulary.phrases) {
      if (phrase.lower.length < tail.length + 2 || !phrase.lower.startsWith(tail)) continue;
      const used = learned?.phrases[phrase.lower] ?? 0;
      if (used > best) { hit = phrase; best = used; }
    }
    if (hit) return { start: caret, end: caret, abbr: tail, options: [hit.text.slice(tail.length)], phrase: true, key: hit.lower };
  }
  return null;
}

// Completes the single clinical word being typed (coug -> cough). Quiet by
// design: three letters minimum, caret at the end of the line, never when the
// word is already complete, never for capitals (those are abbreviations) and
// never mid-word or after a digit or hyphen. A clinical word always beats an
// everyday one. Among clinical words the shortest match wins; among everyday
// words the one listed first (the more common) wins. This doctor's own most
// accepted word beats both.
function suggestWord(text: string, caret: number, selectionEnd: number, vocabulary: ActiveVocabulary, learned?: Learned): Suggestion | null {
  if (!vocabulary.words.length || caret !== selectionEnd || caret < 1 || caret > text.length) return null;
  const rest = text.slice(caret);
  if (rest !== '' && rest[0] !== '\n') return null;
  const match = /(?:^|[^A-Za-z0-9/&-])([A-Za-z]{3,})$/.exec(text.slice(0, caret));
  if (!match) return null;
  const token = match[1], typed = token.toLowerCase();
  if (token === token.toUpperCase()) return null;
  let hit: ActiveVocabulary['words'][number] | undefined, best = -1;
  for (const word of vocabulary.words) {
    if (word.lower === typed) return null;
    if (word.lower.length <= typed.length || !word.lower.startsWith(typed) ) continue;
    const used = learned?.words[word.lower] ?? 0;
    if (!hit || used > best || (used === best && (hit.general && !word.general || !hit.general && !word.general && word.lower.length < hit.lower.length))) { hit = word; best = used; }
  }
  return hit ? { start: caret, end: caret, abbr: typed, options: [hit.text.slice(typed.length)], phrase: true, word: true, key: hit.lower } : null;
}

// Phrases first (they know more), then the word being typed.
function suggestContinuation(text: string, caret: number, selectionEnd: number, vocabulary: ActiveVocabulary, learned?: Learned): Suggestion | null {
  return suggestPhrase(text, caret, selectionEnd, vocabulary, learned) ?? suggestWord(text, caret, selectionEnd, vocabulary, learned);
}

export function suggest(text: string, caret: number, selectionEnd: number, vocabulary: ActiveVocabulary, learned?: Learned): Suggestion | null {
  const found = vocabulary.abbreviations.size ? tokenAtCaret(text, caret, selectionEnd) : null;
  const entry = found && vocabulary.abbreviations.get(found.token.toLowerCase());
  if (!found || !entry) return suggestContinuation(text, caret, selectionEnd, vocabulary, learned);
  // Abbreviations that are also everyday words (ART, AIDS) need capitals.
  if (entry.matchCapitals && found.token !== entry.abbr.toUpperCase()) return suggestContinuation(text, caret, selectionEnd, vocabulary, learned);
  // Every meaning is still listed and the doctor still chooses; the ones used
  // most come first, so the highlighted choice is the doctor's usual one.
  const counts = learned?.meanings[entry.abbr.toLowerCase()];
  const options = counts ? entry.meanings.map((meaning, index) => ({ meaning, index })).sort((x, y) => (counts[y.meaning] ?? 0) - (counts[x.meaning] ?? 0) || x.index - y.index).map(x => x.meaning) : entry.meanings;
  return { start: found.start, end: found.end, abbr: entry.abbr, options };
}

// Follows the sentence being written: capital only at the start of a sentence.
export function formatExpansion(text: string, start: number, meaning: string): string {
  return startOfSentence(text.slice(0, start)) ? meaning.charAt(0).toUpperCase() + meaning.slice(1) : meaning;
}

// Warn on an abbreviation known to be misread, straight after it is typed
// (or after a single space).
export function doNotUseWarning(text: string, caret: number, selectionEnd: number, vocabulary: ActiveVocabulary): DoNotUseEntry | null {
  if (!vocabulary.warnings.size || caret !== selectionEnd) return null;
  const upTo = text.slice(0, caret);
  const match = TOKEN.exec(upTo.endsWith(' ') ? upTo.slice(0, -1) : upTo);
  if (!match) return null;
  return vocabulary.warnings.get(match[0].toLowerCase()) ?? null;
}
