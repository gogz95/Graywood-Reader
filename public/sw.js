// Graywood Reader Service Worker
// - v4: Restrict cache strictly to same-origin immutable static assets and app shell
// - Bails out on cross-origin requests, media blobs, and /api/* endpoints
const CACHE_VERSION = 'graywood-pwa-v4';
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

  // 1. Immediately bail out on non-GET, cross-origin, media blobs, and /api/* endpoints
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.protocol === 'blob:' ||
    url.protocol === 'data:' ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  // 2. Navigation: network-first with /index.html app shell fallback
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

  // 3. Restrict static asset caching strictly to immutable assets (/assets/*, /index.html, /manifest.webmanifest, /icon.svg)
  const isCacheableStatic =
    url.pathname.startsWith('/assets/') ||
    url.pathname === '/index.html' ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/icon.svg' ||
    url.pathname === '/favicon.ico';

  if (!isCacheableStatic) {
    return;
  }

  // Same-origin static assets: stale-while-revalidate.
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