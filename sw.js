/* Portfolio Dashboard — service worker
   Strategy:
     - HTML navigations (index.html / './'): NETWORK-FIRST with cache fallback, so the app
       always loads the newest UI when online and still works offline. (Previously cache-first,
       which left installed PWAs stuck a version behind after each update.)
     - data.json: network-first with cache fallback (freshest snapshot; offline → last snapshot)
     - other shell assets (manifest, icons, Chart.js CDN): cache-first (instant, offline-capable)
   Bump CACHE_VERSION when the shell changes. */
const CACHE_VERSION = 'pf-v172';
/* v171: the snapshot lives in its OWN cache that survives version bumps. It used to sit in the
   versioned cache, so every app update deleted the only offline copy — and the first fetch after
   an update failing (a flaky network, a stalled 6 MB download) left the app with NOTHING: the
   fallback found no data.json, resolved undefined, and iOS reported "FetchEvent.respondWith
   received an error: TypeError: Load failed" (Jack's phone, 2026-10-30 21:38 ET). */
const DATA_CACHE = 'pf-data';
const DATA_TIMEOUT_MS = 20000;
const SHELL = [
  './',
  './index.html',
  './ui/experience.css?v=172',
  './ui/sd-rules.js?v=172',
  './ui/experience-model.js?v=172',
  './ui/experience.js?v=172',
  './ui/ticker.js?v=172',
  './ui/ticker.css?v=172',
  './ui/predictions.css?v=172',
  './ui/predictions-model.js?v=172',
  './ui/predictions.js?v=172',
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
      Promise.all(keys.filter((k) => k !== CACHE_VERSION && k !== DATA_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Public prediction snapshots must stay network-first and retain a real JSON fallback.
  if ((url.origin === self.location.origin && url.pathname.endsWith('/data/predictions.json'))
    || (url.hostname === 'raw.githubusercontent.com' && url.pathname === '/mcdermottj639/portfolio-dashboard/main/data/predictions.json')) {
    e.respondWith(fetch(req).then(async res => {
      if (!res.ok) throw new Error('Prediction feed unavailable');
      const copy = res.clone();
      const cache = await caches.open(CACHE_VERSION); await cache.put(req, copy);
      return res;
    }).catch(async () => (await caches.match(req)) || new Response('{"error":"offline"}', {
      status: 503, headers: {'Content-Type':'application/json'}
    })));
    return;
  }

  // data.json — network-first with a timeout; on failure serve the last snapshot from the
  // version-independent DATA_CACHE (any cache as a last resort), and if there is none return a
  // real JSON 503 so the page shows a clear error instead of a broken response.
  if (url.pathname.endsWith('/data.json')) {
    const key = new Request(new URL('./data.json', self.registration.scope).href);
    e.respondWith((async () => {
      try {
        const res = await Promise.race([
          fetch(req),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), DATA_TIMEOUT_MS))
        ]);
        if (!res || !res.ok) throw new Error('http ' + (res && res.status));
        const copy = res.clone();
        caches.open(DATA_CACHE).then((c) => c.put(key, copy)).catch(() => {});
        return res;
      } catch (err) {
        const hit = (await caches.open(DATA_CACHE).then((c) => c.match(key)).catch(() => null))
          || (await caches.match(key, { ignoreSearch: true }).catch(() => null));
        if (hit) return hit;
        return new Response(JSON.stringify({ error: 'offline — no saved snapshot on this device yet' }), {
          status: 503, headers: { 'Content-Type': 'application/json' }
        });
      }
    })());
    return;
  }

  // HTML navigations — network-first so the newest UI always loads when online; cache offline.
  const isNav = req.mode === 'navigate'
    || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
  if (isNav) {
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
