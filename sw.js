// Offline support. Everything the two pages need is cached on install; after
// that each request is answered from the cache at once and refreshed from the
// network in the background (stale-while-revalidate), so the app works offline
// and picks up changes on the next load. Bump VERSION to drop old caches.
//
// Every fetch here passes `cache: 'reload'`: static hosts serve files with
// `cache-control: max-age=600`, and without it a freshly deployed worker would
// precache whatever the browser still had lying around — the app would then
// serve a mix of two versions for up to ten minutes.
const VERSION = 'v29';
const CACHE = `chiptune-${VERSION}`;
// 清理舊版只針對外殼快取（chiptune-v*）。樣本快取叫 chiptune-samples-v1，
// 不在這個前綴裡——它裝的是使用者抓下來的幾 MB 樂器錄音，不該因為換一版就重抓。
const SHELL_PREFIX = 'chiptune-v';
const APP = [
  './', 'index.html', 'keyboard.html', 'kalimba.html', 'score.html', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png',
  'src/index.js', 'src/engine.js', 'src/sfx.js', 'src/music.js', 'src/rng.js',
  'src/instruments.js', 'src/midi.js', 'src/wav.js', 'src/piano.js', 'src/pianoroll.js',
  'src/samples.js', 'src/sample-library.js', 'src/dynamic-library.js', 'src/gm.js', 'src/drums.js',
  'src/kalimba.js', 'src/kalimba-library.js',
  'page/theme.css', 'page/ui.js', 'page/mixer.js', 'page/pianoview.js',
  'page/console.js', 'page/keyboard.js', 'page/kalimba.js', 'page/drum-library.js',
  'src/flute-library.js', 'src/flute-vib-library.js', 'src/strings-library.js',
];

// 鼓組的擊點與鋼琴的釋音取樣進快取（都很小、幾乎每首都會用到）；有力度層的樂器
// 是「用到才抓」（引擎會把它們存進 CacheStorage，用過一次就離線可用）——全部預快取
// 會讓第一次載入變成 20 MB 以上，那太重了。
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

const RELEASES = [
  'samples/velocity/grand-release/36.mp3',
  'samples/velocity/grand-release/39.mp3',
  'samples/velocity/grand-release/42.mp3',
  'samples/velocity/grand-release/45.mp3',
  'samples/velocity/grand-release/48.mp3',
  'samples/velocity/grand-release/51.mp3',
  'samples/velocity/grand-release/54.mp3',
  'samples/velocity/grand-release/57.mp3',
  'samples/velocity/grand-release/60.mp3',
  'samples/velocity/grand-release/63.mp3',
  'samples/velocity/grand-release/66.mp3',
  'samples/velocity/grand-release/69.mp3',
  'samples/velocity/grand-release/72.mp3',
  'samples/velocity/grand-release/75.mp3',
  'samples/velocity/grand-release/78.mp3',
  'samples/velocity/grand-release/81.mp3',
  'samples/velocity/grand-release/84.mp3',
  'samples/velocity/grand-release/87.mp3',
  'samples/velocity/grand-release/90.mp3',
  'samples/velocity/grand-release/93.mp3',
  'samples/velocity/grand-release/96.mp3',
];

// 卡林巴琴的 17 根簧片（約 0.6 MB）。這一把跟鼓組一樣是**內建的樂器**，不是「用到才抓」
// 的遠端樣本庫：kalimba.html 那把模擬器打開就要能彈、而且離線也要能彈。
// 清單在 build 時產生，見 tools/build-kalimba.mjs；漏掉一根只會讓那根簧片沒聲音，
// 所以 test/kalimba.test.js 會逐一比對目錄裡的檔案。
const KALIMBA = [
  'samples/kalimba/60.mp3',
  'samples/kalimba/62.mp3',
  'samples/kalimba/64.mp3',
  'samples/kalimba/65.mp3',
  'samples/kalimba/67.mp3',
  'samples/kalimba/69.mp3',
  'samples/kalimba/71.mp3',
  'samples/kalimba/72.mp3',
  'samples/kalimba/74.mp3',
  'samples/kalimba/76.mp3',
  'samples/kalimba/77.mp3',
  'samples/kalimba/79.mp3',
  'samples/kalimba/81.mp3',
  'samples/kalimba/83.mp3',
  'samples/kalimba/84.mp3',
  'samples/kalimba/86.mp3',
  'samples/kalimba/88.mp3',
];

// 長笛（10 個音、每個音最多兩個 take，約 0.9 MB）：跟鼓組與卡林巴一樣是**內建的樂器**，
// 打開頁面就要能吹，而且 round robin 需要兩個 take 同時在手上。清單由
// tools/build-flute.mjs 產生，test/flute.test.js 會逐一比對目錄裡的檔案。
const FLUTE = [
  'samples/flute/60-a.mp3',
  'samples/flute/60-b.mp3',
  'samples/flute/64-a.mp3',
  'samples/flute/64-b.mp3',
  'samples/flute/69-a.mp3',
  'samples/flute/69-b.mp3',
  'samples/flute/72-a.mp3',
  'samples/flute/72-b.mp3',
  'samples/flute/76-a.mp3',
  'samples/flute/76-b.mp3',
  'samples/flute/81-a.mp3',
  'samples/flute/81-b.mp3',
  'samples/flute/84-a.mp3',
  'samples/flute/84-b.mp3',
  'samples/flute/88-a.mp3',
  'samples/flute/88-b.mp3',
  'samples/flute/93-a.mp3',
  'samples/flute/93-b.mp3',
  'samples/flute/96-a.mp3',
];
// 弦樂群（三組分軌弦樂合起來，26 個音 × 兩個 take）與有顫音的長笛：都是內建的樂器，
// 跟鼓組、卡林巴一樣進預快取。清單由 tools/build-strings.mjs 與 tools/build-flute.mjs
// 產生，test/strings.test.js 會逐一比對目錄裡的檔案。
const STRINGS_AND_VIB = [
  'samples/strings/36-a.mp3',
  'samples/strings/36-b.mp3',
  'samples/strings/40-a.mp3',
  'samples/strings/40-b.mp3',
  'samples/strings/43-a.mp3',
  'samples/strings/43-b.mp3',
  'samples/strings/47-a.mp3',
  'samples/strings/47-b.mp3',
  'samples/strings/48-a.mp3',
  'samples/strings/48-b.mp3',
  'samples/strings/50-a.mp3',
  'samples/strings/50-b.mp3',
  'samples/strings/52-a.mp3',
  'samples/strings/52-b.mp3',
  'samples/strings/53-a.mp3',
  'samples/strings/53-b.mp3',
  'samples/strings/55-a.mp3',
  'samples/strings/55-b.mp3',
  'samples/strings/57-a.mp3',
  'samples/strings/57-b.mp3',
  'samples/strings/59-a.mp3',
  'samples/strings/59-b.mp3',
  'samples/strings/60-a.mp3',
  'samples/strings/60-b.mp3',
  'samples/strings/62-a.mp3',
  'samples/strings/62-b.mp3',
  'samples/strings/64-a.mp3',
  'samples/strings/64-b.mp3',
  'samples/strings/65-a.mp3',
  'samples/strings/65-b.mp3',
  'samples/strings/66-a.mp3',
  'samples/strings/66-b.mp3',
  'samples/strings/67-a.mp3',
  'samples/strings/67-b.mp3',
  'samples/strings/69-a.mp3',
  'samples/strings/69-b.mp3',
  'samples/strings/71-a.mp3',
  'samples/strings/71-b.mp3',
  'samples/strings/72-a.mp3',
  'samples/strings/72-b.mp3',
  'samples/strings/74-a.mp3',
  'samples/strings/74-b.mp3',
  'samples/strings/76-a.mp3',
  'samples/strings/76-b.mp3',
  'samples/strings/77-a.mp3',
  'samples/strings/77-b.mp3',
  'samples/strings/79-a.mp3',
  'samples/strings/79-b.mp3',
  'samples/strings/83-a.mp3',
  'samples/strings/83-b.mp3',
  'samples/strings/86-a.mp3',
  'samples/strings/86-b.mp3',
  'samples/flute-vib/64-a.mp3',
  'samples/flute-vib/69-a.mp3',
  'samples/flute-vib/72-a.mp3',
  'samples/flute-vib/72-b.mp3',
  'samples/flute-vib/76-a.mp3',
  'samples/flute-vib/76-b.mp3',
  'samples/flute-vib/81-a.mp3',
  'samples/flute-vib/84-a.mp3',
  'samples/flute-vib/88-a.mp3',
  'samples/flute-vib/88-b.mp3',
  'samples/flute-vib/93-a.mp3',
  'samples/flute-vib/96-a.mp3',
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
    // 鼓組、力度層的釋音與卡林巴的取樣檔（一百多個小檔案）：一起抓，但不要跟上面那批搶
    await Promise.all([...DRUMS, ...RELEASES, ...KALIMBA, ...FLUTE, ...STRINGS_AND_VIB].map(async (path) => {
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
