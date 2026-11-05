import { useSyncExternalStore } from 'react';
import vocabularyJson from '../data/clinicalAbbreviations.draft.json';
import phrasesJson from '../data/clinicalPhrases.json';
import wordsJson from '../data/clinicalWords.json';
import generalWordsJson from '../data/generalWords.json';
import { activeVocabulary, ActiveVocabulary, PhraseEntry, Vocabulary, WordEntry } from './clinicalAutocomplete';

// Per-browser switches. `off` turns suggestions off for this user. `preview`
// lets the clinical reviewer try the unreviewed draft list in their own
// browser; it is off by default and clearly labelled where it is shown.
const KEYS = { off: 'ses.autocomplete.off', preview: 'ses.autocomplete.preview' } as const;
const CHANGED = 'ses-autocomplete-settings';
const read = (key: string) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const write = (key: string, on: boolean) => { try { if (on) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch { /* storage blocked: setting lasts until reload */ } window.dispatchEvent(new Event(CHANGED)); };

// The reviewer opens any page once with ?autocompletePreview=1 to try the draft
// list (=0 to stop). Nobody gets unreviewed suggestions by accident.
try {
  const asked = new URLSearchParams(window.location.search).get('autocompletePreview');
  if (asked === '1') localStorage.setItem(KEYS.preview, '1');
  else if (asked === '0') localStorage.removeItem(KEYS.preview);
} catch { /* storage blocked */ }

export interface AutocompleteSettings { enabled: boolean; preview: boolean }
let snapshot: AutocompleteSettings = { enabled: !read(KEYS.off), preview: read(KEYS.preview) };
function refresh() {
  const next = { enabled: !read(KEYS.off), preview: read(KEYS.preview) };
  if (next.enabled !== snapshot.enabled || next.preview !== snapshot.preview) snapshot = next;
}
function subscribe(notify: () => void) {
  const handler = () => { refresh(); notify(); };
  window.addEventListener(CHANGED, handler); window.addEventListener('storage', handler);
  return () => { window.removeEventListener(CHANGED, handler); window.removeEventListener('storage', handler); };
}

export function useAutocompleteSettings(): AutocompleteSettings { return useSyncExternalStore(subscribe, () => snapshot, () => snapshot); }
export const setAutocompleteEnabled = (enabled: boolean) => write(KEYS.off, !enabled);
export const setAutocompletePreview = (preview: boolean) => write(KEYS.preview, preview);

const cache = new Map<boolean, ActiveVocabulary>();
export function vocabularyFor(settings: AutocompleteSettings): ActiveVocabulary {
  if (!settings.enabled) return EMPTY;
  let active = cache.get(settings.preview);
  if (!active) { active = activeVocabulary({ ...(vocabularyJson as Vocabulary), phrases: (phrasesJson as { phrases: PhraseEntry[] }).phrases, words: (wordsJson as { words: WordEntry[] }).words, generalWords: (generalWordsJson as { words: WordEntry[] }).words }, settings.preview); cache.set(settings.preview, active); }
  return active;
}
const EMPTY: ActiveVocabulary = { abbreviations: new Map(), warnings: new Map(), phrases: [], words: [] };
