export type AutosaveStatus = 'saved' | 'saving' | 'error';

export interface Autosaver<T> {
  enqueue: (value: T) => void;
  flush: () => Promise<boolean>;
  hasPending: () => boolean;
  latest: () => T | undefined;
  status: () => AutosaveStatus;
  dispose: () => void;
}

// Start the first write immediately. While it is in flight, keep only the
// newest edit and send it next, so an older response cannot overwrite it.
export function createAutosaver<T>(write: (value: T) => Promise<void>, onStatus: (status: AutosaveStatus) => void): Autosaver<T> {
  let pending: { value: T } | null = null;
  let latestValue: T | undefined;
  let active: Promise<boolean> | null = null;
  let state: AutosaveStatus = 'saved';
  let retry: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = 5000;
  let disposed = false;

  function update(status: AutosaveStatus) {
    if (state !== status) { state = status; onStatus(status); }
  }

  function flush(): Promise<boolean> {
    if (active) return active;
    if (retry) { clearTimeout(retry); retry = null; }
    if (!pending) return Promise.resolve(true);
    update('saving');
    active = (async () => {
      while (pending) {
        const snapshot: { value: T } = pending;
        try {
          await write(snapshot.value);
          if (pending === snapshot) pending = null;
          retryDelay = 5000;
        } catch {
          update('error');
          if (!disposed) {
            retry = setTimeout(() => { retry = null; void flush(); }, retryDelay);
            retryDelay = Math.min(retryDelay * 2, 30000);
          }
          return false;
        }
      }
      update('saved');
      return true;
    })().finally(() => {
      active = null;
      // A change queued by another microtask at the end of a request still
      // needs its own write, even if no further keystroke follows it.
      if (pending && state !== 'error') void flush();
    });
    return active;
  }

  return {
    enqueue(value) {
      latestValue = value;
      pending = { value };
      if (state === 'error' && retry) return;
      void flush();
    },
    flush,
    hasPending: () => pending !== null,
    latest: () => latestValue,
    status: () => state,
    dispose() {
      disposed = true;
      if (retry) { clearTimeout(retry); retry = null; }
      // Finish the latest edit when navigating inside the app, without
      // retaining background retry timers after the editor has unmounted.
      void flush();
    },
  };
}
