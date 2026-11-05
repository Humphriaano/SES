import { Learned, Suggestion, parseLearned, recordAccepted } from './clinicalAutocomplete';

// Each doctor's accepted suggestions, kept only in this browser and keyed by
// the signed-in user, so colleagues sharing a workstation do not mix. It holds
// counts against vocabulary entries, never typed text. Storage that is blocked
// or full just means nothing is learned; typing and suggestions still work.
const keyFor = (userId: string) => `ses.autocomplete.learned.${userId}`;
const cache = new Map<string, Learned>();
const read = (userId: string) => { try { return parseLearned(localStorage.getItem(keyFor(userId))); } catch { return parseLearned(null); } };

export function getLearned(userId?: string): Learned | undefined {
  if (!userId) return undefined;
  let learned = cache.get(userId);
  if (!learned) { learned = read(userId); cache.set(userId, learned); }
  return learned;
}

// Called when a suggestion is accepted. Re-reads storage first so a second tab's
// learning is not overwritten.
export function recordLearned(userId: string | undefined, suggestion: Suggestion, chosen: string) {
  if (!userId) return;
  const current = read(userId), next = recordAccepted(current, suggestion, chosen);
  cache.set(userId, next);
  if (next === current) return;
  try { localStorage.setItem(keyFor(userId), JSON.stringify(next)); } catch { /* storage blocked or full: learning lasts until reload */ }
}
