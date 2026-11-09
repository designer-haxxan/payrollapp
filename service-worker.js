/* Service worker: precaches the app shell and CDN libraries so the app loads fully offline.
   Bump VERSION whenever any cached file changes; clients update automatically. */
// Cache names are namespaced so this app never touches caches that belong to other apps on the same origin.
const APP_ID = 'payroll';
const VERSION = `${APP_ID}-v1.0.0`;
const isOwnCache = (key) => key.startsWith(`${APP_ID}-`);
const SHELL = [
  './', './index.html', './manifest.json', './css/app.css',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png',
  './js/app.js', './js/config.js',
  './js/core/early.js', './js/core/link-login.js', './js/core/i18n.js', './js/core/settings.js', './js/core/ui.js', './js/core/utils.js',
  './js/db/idb.js', './js/db/schema.js',
  './js/i18n/en.js', './js/i18n/ur.js',
  './js/modules/dashboard.js', './js/modules/employees.js', './js/modules/payroll.js', './js/modules/settings.js',
  './js/services/auth.js', './js/services/data.js', './js/services/payroll.js',
];
const CDN = [
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.rtl.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
  'https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.1.0/index.css',
];

async function cacheCdn(cache) {
  for (const url of CDN) {
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'reload' });
      if (!res.ok) continue;
      await cache.put(url, res.clone());
      // Also cache fonts referenced by stylesheets (Bootstrap Icons, Inter).
      if (url.endsWith('.css')) {
        const css = await res.text();
        for (const m of css.matchAll(/url\(["']?([^"')]+\.woff2?[^"')]*)["']?\)/g)) {
          const fontUrl = new URL(m[1], url).href;
          try { const f = await fetch(fontUrl, { mode: 'cors', credentials: 'omit' }); if (f.ok) await cache.put(fontUrl, f); } catch (e) { /* fetched again at runtime */ }
        }
      }
    } catch (e) { /* offline during install: cached at runtime later */ }
  }
}

async function precache() {
  const cache = await caches.open(VERSION);
  // cache: 'reload' bypasses the browser HTTP cache, so a new version never stores stale files.
  await cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
  await cacheCdn(cache);
  // Urdu font (for Nastaleeq text): cached for offline use; install still succeeds if this download fails.
  try { await cache.add(new Request('./fonts/jameel-noori-nastaleeq.woff', { cache: 'reload' })); } catch (e) { /* cached at runtime later */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await precache();
    // Activate new versions immediately; open pages reload on controllerchange.
    await self.skipWaiting();
  })());
});

// The page asks us to rebuild the cache when it is missing (for example after the browser cleared storage).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ENSURE_CACHE') {
    event.waitUntil((async () => { if (!(await caches.has(VERSION)) || !(await (await caches.open(VERSION)).match('./index.html'))) await precache(); })());
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Only delete this app's own old caches.
    for (const key of await caches.keys()) if (key !== VERSION && isOwnCache(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    // App shell: serve the cached index.html of this version (works offline).
    event.respondWith((async () => {
      const cached = await caches.match('./index.html', { cacheName: VERSION });
      if (cached) return cached;
      try { return await fetch(req); } catch (e) { return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }); }
    })());
    return;
  }

  // Never cache the login API (it is the only network call the app makes, and it must always be live).
  if (url.origin === 'https://eposwala.com' || url.pathname.startsWith('/api/')) return;
  const sameOrigin = url.origin === self.location.origin;
  const isCdn = url.hostname === 'cdn.jsdelivr.net';
  if (!sameOrigin && !isCdn) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req, { ignoreSearch: sameOrigin });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok && (res.type === 'basic' || res.type === 'cors')) cache.put(req, res.clone());
      return res;
    } catch (e) {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
