// Graywood Reader Service Worker v3
// Strategy:
//  - /api/* requests are NEVER intercepted or cached (always live server data)
//  - Navigations are network-first with a cached index.html fallback (offline shell)
//  - Same-origin static assets are cache-first with background revalidation
//  - Versioned hashed assets auto-invalidate on new deployment
const CACHE_NAME = 'graywood-reader-v3';
const CORE_ASSETS = ['/', '/index.html', '/manifest.json', '/icon.svg'];

// Cache fingerprinting: new deployment → new cache, old caches deleted on activate.
// This prevents stale chunks from surviving after a redeploy.

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Precache the app shell; versioned JS/CSS are picked up on first visit
      // via the cache-first strategy below and live until next activate cycle.
      return cache.addAll(CORE_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            return caches.delete(key);
          })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin GET requests; never touch API traffic
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  // App navigations: network-first so deployments propagate immediately
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Hashed static assets (/assets/*): cache-first with network revalidation
  // Hashed filenames change on every build → no risk of stale cache
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) {
          // Background revalidate: update cache for next visit
          fetch(event.request)
            .then((response) => {
              if (response.ok) {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
              }
            })
            .catch(() => {});
          return cached;
        }
        // Not in cache yet: fetch, cache, return
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        });
      })
    );
    return;
  }

  // Other static assets: stale-while-revalidate (generic fallback)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const revalidate = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || revalidate;
    })
  );
});
