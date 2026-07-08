/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, NetworkOnly, StaleWhileRevalidate, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

// Auth endpoints must always hit the network — never serve a cached
// sign-in/session response.
registerRoute(({ url }) => url.pathname.startsWith('/api/portal/auth/'), new NetworkOnly());

// Patient's own dashboard/vitals/conditions/appointments/check-ins — fresh
// when online, falls back to the last cached response when offline.
registerRoute(
  ({ url }) => /^\/api\/portal\/(dashboard|vitals|conditions|appointments|check-ins|preferences)/.test(url.pathname),
  new NetworkFirst({
    cacheName: 'portal-api-cache',
    networkTimeoutSeconds: 4,
    plugins: [
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 30 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
);

registerRoute(({ url }) => url.origin === 'https://fonts.googleapis.com', new StaleWhileRevalidate({ cacheName: 'google-fonts-stylesheets' }));

registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'google-fonts-webfonts',
    plugins: [
      new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
);

// Lets the app's "new version ready" toast trigger the waiting worker to
// activate immediately, instead of waiting for every tab to close.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Appointment reminders and monthly check-in notices deep-link into the app.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const payload = event.data.json() as { title: string; body: string; url: string };
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: payload.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data?.url as string) || '/';
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientsList) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) await (client as WindowClient).navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
