// Captures Android/Chrome's beforeinstallprompt as early as possible (it must
// be captured before we decide whether to show our own install card — the
// browser only fires it once and only if we don't call preventDefault() too
// late). Imported once at app boot in main.tsx.

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e as BeforeInstallPromptEvent;
  listeners.forEach((l) => l());
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
});

export function getDeferredInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt;
}

export function onInstallPromptCaptured(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function isRunningStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
