import { useEffect, useState } from 'react';
import api from '../api/client';
import { apiError } from '../lib/money';

// Loads one report for a set of parameters (null = not wanted yet). It keeps the last answer on screen while the next one loads, and tells
// the caller whether what it holds is for the current parameters. `reload` is a number to bump to ask again.
export function useReport<T>(path: string, params: Record<string, string> | null, reload: number) {
  const id = params ? path + JSON.stringify(params) + '#' + reload : '';
  const [result, setResult] = useState<{ id: string; data?: T; error?: string } | null>(null);
  const [last, setLast] = useState<T | undefined>(undefined);
  useEffect(() => {
    if (!params) return;
    let alive = true;
    api.get<T>(path, { params })
      .then(r => { if (alive) { setResult({ id, data: r.data }); setLast(r.data); } })
      .catch(e => { if (alive) setResult({ id, error: apiError(e, 'Could not load this. Check your connection and try again.') }); });
    return () => { alive = false; };
  }, [path, params, id]);
  const now = params && result?.id === id ? result : null;
  return { data: now?.data ?? last, current: !!now?.data, error: now?.error, loading: !!params && !now };
}
