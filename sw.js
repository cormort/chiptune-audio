// Offline support. Everything the two pages need is cached on install; after
// that each request is answered from the cache at once and refreshed from the
// network in the background (stale-while-revalidate), so the app works offline
// and picks up changes on the next load. Bump VERSION to drop old caches.
const VERSION = 'v1';
const CACHE = `chiptune-${VERSION}`;
const APP = [
  './', 'index.html', 'keyboard.html', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png',
  'src/index.js', 'src/engine.js', 'src/sfx.js', 'src/music.js', 'src/rng.js',
  'src/instruments.js', 'src/midi.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('chiptune-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Same-origin files plus the Google Fonts stylesheet and font files.
const cacheable = (url) => url.origin === location.origin
  || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !cacheable(new URL(req.url))) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const refresh = fetch(req).then((res) => {
      // Opaque (cross-origin no-cors) font responses report status 0 but are fine to keep.
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    });
    if (hit) {
      e.waitUntil(refresh.catch(() => {}));   // offline: keep serving the cached copy
      return hit;
    }
    return refresh;
  }));
});
