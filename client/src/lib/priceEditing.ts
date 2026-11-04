type Commit = () => Promise<boolean>;
const editors = new Map<string, Set<Commit>>();

export function registerPriceEditor(ref: string, commit: Commit): () => void {
  const set = editors.get(ref) ?? new Set<Commit>();
  set.add(commit); editors.set(ref, set);
  return () => { set.delete(commit); if (!set.size) editors.delete(ref); };
}

// A click on Order/Dispense also blurs a price field. Await that same write so
// billing reads the committed price, even if the price lookup hasn't refreshed.
export async function flushPriceEdits(refs: string[]): Promise<boolean> {
  const commits = [...new Set(refs.flatMap(ref => [...(editors.get(ref) ?? [])]))];
  const results = await Promise.all(commits.map(commit => commit().catch(() => false)));
  return results.every(Boolean);
}
