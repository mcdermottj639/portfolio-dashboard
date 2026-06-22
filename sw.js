/* Portfolio Dashboard — service worker
   Strategy:
     - HTML navigations (index.html / './'): NETWORK-FIRST with cache fallback, so the app
       always loads the newest UI when online and still works offline. (Previously cache-first,
       which left installed PWAs stuck a version behind after each update.)
     - data.json: network-first with cache fallback (freshest snapshot; offline → last snapshot)
     - other shell assets (manifest, icons, Chart.js CDN): cache-first (instant, offline-capable)
   Bump CACHE_VERSION when the shell changes. */
const CACHE_VERSION = 'pf-v34';
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

  // HTML navigations + data.json — network-first so the newest UI/snapshot always loads when
  // online; fall back to cache offline.
  const isNav = req.mode === 'navigate'
    || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
  if (isNav || url.pathname.endsWith('data.json')) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // Everything else (icons, manifest, Chart.js) — cache-first, fall back to network (and cache it).
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
