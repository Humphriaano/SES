import { registerSW } from 'virtual:pwa-register';

type UpdateListener = () => void;
let onUpdateAvailable: UpdateListener | null = null;

/**
 * Registers the service worker once at app startup. When a new version is
 * waiting, calls back into the app (a toast) instead of swapping silently —
 * patients shouldn't see stale UI without knowing a refresh is available.
 */
export function initServiceWorker(notify: UpdateListener): () => void {
  onUpdateAvailable = notify;
  const updateSW = registerSW({
    onNeedRefresh() {
      onUpdateAvailable?.();
    },
    onOfflineReady() {
      // App shell is cached and ready for offline use — no UI needed for this.
    },
  });
  return () => updateSW(true);
}
