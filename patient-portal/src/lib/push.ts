import api from '../api/client';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/**
 * Requests notification permission and, if granted, subscribes this device
 * to web push and registers the subscription with the server. Returns false
 * without prompting again if the patient already denied permission — the
 * caller should treat that as final for this browser.
 */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false;
  if (Notification.permission === 'denied') return false;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const { data } = await api.get<{ publicKey: string | null }>('/push/vapid-public-key');
  if (!data.publicKey) return false;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(data.publicKey) as BufferSource,
  });

  const json = subscription.toJSON();
  await api.post('/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
  return true;
}
