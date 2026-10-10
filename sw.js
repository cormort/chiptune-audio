// Offline support. Everything the two pages need is cached on install; after
// that each request is answered from the cache at once and refreshed from the
// network in the background (stale-while-revalidate), so the app works offline
// and picks up changes on the next load. Bump VERSION to drop old caches.
//
// Every fetch here passes `cache: 'reload'`: static hosts serve files with
// `cache-control: max-age=600`, and without it a freshly deployed worker would
// precache whatever the browser still had lying around — the app would then
// serve a mix of two versions for up to ten minutes.
const VERSION = 'v22';
const CACHE = `chiptune-${VERSION}`;
// 清理舊版只針對外殼快取（chiptune-v*）。樣本快取叫 chiptune-samples-v1，
// 不在這個前綴裡——它裝的是使用者抓下來的幾 MB 樂器錄音，不該因為換一版就重抓。
const SHELL_PREFIX = 'chiptune-v';
const APP = [
  './', 'index.html', 'keyboard.html', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png',
  'src/index.js', 'src/engine.js', 'src/sfx.js', 'src/music.js', 'src/rng.js',
  'src/instruments.js', 'src/midi.js', 'src/wav.js', 'src/piano.js', 'src/pianoroll.js',
  'src/samples.js', 'src/sample-library.js', 'src/gm.js', 'src/drums.js',
  'page/theme.css', 'page/ui.js', 'page/mixer.js', 'page/pianoview.js',
  'page/console.js', 'page/keyboard.js', 'page/drum-library.js',
];

// 鼓組的擊點（samples/drums/*.mp3）也要進快取：它們是 repo 裡的檔案，離線時才打得到。
// 清單在 build 時產生，見 tools/build-drums.mjs；漏掉一個只會讓那一擊在離線時沒聲音，
// 所以 test/sw.test.js 會逐一比對目錄裡的檔案。
const DRUMS = [
  'samples/drums/35-v1.mp3',
  'samples/drums/35-v2.mp3',
  'samples/drums/36-v1-r1.mp3',
  'samples/drums/36-v1-r2.mp3',
  'samples/drums/36-v2-r1.mp3',
  'samples/drums/36-v2-r2.mp3',
  'samples/drums/36-v3-r1.mp3',
  'samples/drums/36-v3-r2.mp3',
  'samples/drums/37-v1.mp3',
  'samples/drums/37-v2.mp3',
  'samples/drums/38-v1-r1.mp3',
  'samples/drums/38-v1-r2.mp3',
  'samples/drums/38-v2-r1.mp3',
  'samples/drums/38-v2-r2.mp3',
  'samples/drums/38-v3-r1.mp3',
  'samples/drums/38-v3-r2.mp3',
  'samples/drums/38-v4-r1.mp3',
  'samples/drums/38-v4-r2.mp3',
  'samples/drums/39-v1.mp3',
  'samples/drums/39-v2.mp3',
  'samples/drums/40-v1.mp3',
  'samples/drums/40-v2.mp3',
  'samples/drums/41-v1.mp3',
  'samples/drums/41-v2.mp3',
  'samples/drums/42-v1-r1.mp3',
  'samples/drums/42-v1-r2.mp3',
  'samples/drums/42-v2-r1.mp3',
  'samples/drums/42-v2-r2.mp3',
  'samples/drums/42-v3-r1.mp3',
  'samples/drums/42-v3-r2.mp3',
  'samples/drums/43-v1.mp3',
  'samples/drums/43-v2.mp3',
  'samples/drums/44-v1-r1.mp3',
  'samples/drums/44-v1-r2.mp3',
  'samples/drums/44-v2-r1.mp3',
  'samples/drums/44-v2-r2.mp3',
  'samples/drums/45-v1.mp3',
  'samples/drums/45-v2.mp3',
  'samples/drums/46-v1-r1.mp3',
  'samples/drums/46-v1-r2.mp3',
  'samples/drums/46-v2-r1.mp3',
  'samples/drums/46-v2-r2.mp3',
  'samples/drums/46-v3-r1.mp3',
  'samples/drums/46-v3-r2.mp3',
  'samples/drums/47-v1.mp3',
  'samples/drums/47-v2.mp3',
  'samples/drums/48-v1.mp3',
  'samples/drums/48-v2.mp3',
  'samples/drums/49-v1.mp3',
  'samples/drums/49-v2.mp3',
  'samples/drums/49-v3.mp3',
  'samples/drums/50-v1.mp3',
  'samples/drums/50-v2.mp3',
  'samples/drums/51-v1.mp3',
  'samples/drums/51-v2.mp3',
  'samples/drums/51-v3.mp3',
  'samples/drums/53-v1.mp3',
  'samples/drums/53-v2.mp3',
  'samples/drums/54-v1.mp3',
  'samples/drums/54-v2.mp3',
  'samples/drums/55-v1.mp3',
  'samples/drums/55-v2.mp3',
  'samples/drums/56-v1.mp3',
  'samples/drums/56-v2.mp3',
  'samples/drums/57-v1.mp3',
  'samples/drums/57-v2.mp3',
  'samples/drums/58-v1.mp3',
  'samples/drums/59-v1.mp3',
  'samples/drums/59-v2.mp3',
  'samples/drums/60-v1.mp3',
  'samples/drums/60-v2.mp3',
  'samples/drums/61-v1.mp3',
  'samples/drums/61-v2.mp3',
  'samples/drums/62-v1.mp3',
  'samples/drums/62-v2.mp3',
  'samples/drums/63-v1.mp3',
  'samples/drums/63-v2.mp3',
  'samples/drums/64-v1.mp3',
  'samples/drums/64-v2.mp3',
  'samples/drums/67-v1.mp3',
  'samples/drums/67-v2.mp3',
  'samples/drums/68-v1.mp3',
  'samples/drums/68-v2.mp3',
  'samples/drums/69-v1.mp3',
  'samples/drums/70-v1.mp3',
  'samples/drums/70-v2.mp3',
  'samples/drums/71-v1.mp3',
  'samples/drums/72-v1.mp3',
  'samples/drums/73-v1.mp3',
  'samples/drums/74-v1.mp3',
  'samples/drums/75-v1.mp3',
  'samples/drums/75-v2.mp3',
  'samples/drums/80-v1.mp3',
  'samples/drums/80-v2.mp3',
  'samples/drums/81-v1.mp3',
  'samples/drums/81-v2.mp3',
  'samples/drums/82-v1.mp3',
  'samples/drums/83-v1.mp3',
  'samples/drums/83-v2.mp3',
  'samples/drums/84-v1.mp3',
  'samples/drums/84-v2.mp3',
];

const bypassHttpCache = (url) => (new URL(url, location.href).origin === location.origin
  ? { cache: 'reload' }
  : undefined);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(async (cache) => {
    // addAll() would go through the HTTP cache; fetch each file explicitly instead.
    await Promise.all(APP.map(async (path) => {
      const res = await fetch(path, bypassHttpCache(path));
      if (res.ok || res.type === 'opaque') await cache.put(path, res);
    }));
    // 鼓組有 100 個小檔案：一起抓，但不要跟上面那批搶
    await Promise.all(DRUMS.map(async (path) => {
      const res = await fetch(path, bypassHttpCache(path));
      if (res.ok || res.type === 'opaque') await cache.put(path, res);
    }));
    await self.skipWaiting();
  }));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(SHELL_PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
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
    const refresh = fetch(req, bypassHttpCache(req.url)).then((res) => {
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
