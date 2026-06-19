/* Portfolio Dashboard — service worker
   Strategy:
     - App shell (html, manifest, icons, Chart.js CDN): cache-first (instant, offline-capable)
     - data.json: network-first with cache fallback (always tries fresh data, falls back to last snapshot offline)
   Bump CACHE_VERSION whenever the shell (index.html/sw.js/manifest) changes so clients pick it up. */
const CACHE_VERSION = 'pf-v5';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  'https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.js'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_VERSION).then((c) =>
      // Don't let one failed CDN fetch abort the whole install.
      Promise.allSettled(SHELL.map((u) => c.add(u)))
    )
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // data.json — network-first so the app shows the freshest snapshot, cache as backup.
  if (url.pathname.endsWith('/data.json') || url.pathname.endsWith('data.json')) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Everything else — cache-first, fall back to network (and cache it).
  e.respondWith(
    caches.match(req).then((hit) =>
      hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        return res;
      }).catch(() => hit)
    )
  );
});
