import { useEffect, useRef } from 'react';

// Runs `fn` now and every `ms` while the tab is visible and online. Pauses in
// background tabs (saves battery and data) and refreshes straight away when
// the user comes back or the connection returns.
export function useVisiblePolling(fn: () => void, ms: number, enabled = true) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => { if (navigator.onLine) fnRef.current(); };
    const start = () => { if (!timer) { tick(); timer = setInterval(tick, ms); } };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVisibility = () => (document.hidden ? stop() : start());

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', tick);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', tick);
    };
  }, [ms, enabled]);
}
