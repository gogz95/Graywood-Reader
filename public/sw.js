// Graywood Reader Service Worker
// - v2: network-first navigations + stale-while-revalidate static assets so
//   deploys propagate (v1 used cache-first with a fixed name -> stale app).
// - Install must not hard-fail on a transient cache miss.
const CACHE_VERSION = 'graywood-pwa-v2';
const STATIC_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch((err) => console.warn('[SW] Pre-cache failed (continuing):', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept non-GET or API/proxy traffic.
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  // Navigation: network-first with the app shell as an offline fallback.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put('/index.html', clone));
          }
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Same-origin static assets: stale-while-revalidate. Return the cached copy
  // immediately (if any) and refresh the cache in the background so updates
  // roll out without a full cache flush.
  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      const network = fetch(event.request)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() => null);

      if (cached) {
        network.then(() => {}); // background refresh
        return cached;
      }
      const res = await network;
      return res || new Response('', { status: 504, statusText: 'Offline' });
    })()
  );
});