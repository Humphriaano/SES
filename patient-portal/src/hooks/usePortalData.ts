import { useEffect, useState } from 'react';
import { isOfflineError } from '../api/client';
import { useOnlineStatus } from './useOnlineStatus';

interface PortalDataState<T> {
  data: T | null;
  loading: boolean;
  /** Set only when there is truly nothing to show (offline with no prior cache). */
  offlineNoData: boolean;
  isOffline: boolean;
  lastUpdated: string | null;
  reload: () => void;
}

/**
 * Fetches portal data through the service worker's network-first cache. When
 * offline, a prior successful response is served from cache transparently
 * (axios just sees 200), so this hook only needs to track whether the device
 * itself is offline and when data last refreshed — that's enough to drive the
 * "Last updated ... — offline" banner without inspecting cache internals.
 */
export function usePortalData<T>(key: string, fetcher: () => Promise<T>): PortalDataState<T> {
  const online = useOnlineStatus();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [offlineNoData, setOfflineNoData] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(
    () => localStorage.getItem(`portal:lastFetched:${key}`),
  );
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetcher()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setOfflineNoData(false);
        const now = new Date().toISOString();
        localStorage.setItem(`portal:lastFetched:${key}`, now);
        setLastUpdated(now);
      })
      .catch((err) => {
        if (cancelled) return;
        if (isOfflineError(err)) setOfflineNoData(true);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [key, reloadTick]);

  return { data, loading, offlineNoData, isOffline: !online, lastUpdated, reload: () => setReloadTick((t) => t + 1) };
}
