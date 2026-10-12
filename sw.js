// Offline support. Everything the two pages need is cached on install; after
// that each request is answered from the cache at once and refreshed from the
// network in the background (stale-while-revalidate), so the app works offline
// and picks up changes on the next load. Bump VERSION to drop old caches.
//
// Every fetch here passes `cache: 'reload'`: static hosts serve files with
// `cache-control: max-age=600`, and without it a freshly deployed worker would
// precache whatever the browser still had lying around — the app would then
// serve a mix of two versions for up to ten minutes.
const VERSION = 'v35';
/** 外殼（HTML／JS／CSS）每次部署都換。 */
const APP_CACHE = `chiptune-app-${VERSION}`;
/** 音檔（鼓組、卡林巴、長笛、弦樂群、吉他…約 9.5 MB）用**清單的雜湊**當版本：
 *  只有樣本清單真的變了才會換名字，所以純程式更新時這 9.5 MB 一個位元組都不會重抓。 */
const MEDIA_VERSION = 'm59ce7e63';
const MEDIA_CACHE = `chiptune-media-${MEDIA_VERSION}`;
// 清理只刪自己這兩個前綴的舊版。樣本快取叫 chiptune-samples-v1（引擎在用的隨選快取），
// 不在這兩個前綴裡——它裝的是使用者抓下來的十幾 MB 樂器錄音，不該因為換一版就重抓。
const APP_PREFIX = 'chiptune-app-';
const MEDIA_PREFIX = 'chiptune-media-';
const APP = [
  './', 'index.html', 'console.html', 'keyboard.html', 'kalimba.html', 'score.html', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png',
  'src/index.js', 'src/engine.js', 'src/sfx.js', 'src/music.js', 'src/rng.js',
  'src/instruments.js', 'src/midi.js', 'src/wav.js', 'src/piano.js', 'src/pianoroll.js',
  'src/samples.js', 'src/sample-library.js', 'src/dynamic-library.js', 'src/gm.js', 'src/drums.js',
  'src/kalimba.js', 'src/kalimba-library.js',
  'page/theme.css', 'page/ui.js', 'page/mixer.js', 'page/pianoview.js',
  'page/console.js', 'page/keyboard.js', 'page/kalimba.js', 'page/score.js', 'page/drum-library.js',
  'src/flute-library.js', 'src/flute-vib-library.js', 'src/strings-library.js', 'src/guitar-library.js',
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

const GUITARS = [
  'samples/guitar-acoustic/37-v1.mp3',
  'samples/guitar-acoustic/37-v2.mp3',
  'samples/guitar-acoustic/37-v3.mp3',
  'samples/guitar-acoustic/40-v1.mp3',
  'samples/guitar-acoustic/40-v2.mp3',
  'samples/guitar-acoustic/40-v3.mp3',
  'samples/guitar-acoustic/42-v1.mp3',
  'samples/guitar-acoustic/42-v2.mp3',
  'samples/guitar-acoustic/42-v3.mp3',
  'samples/guitar-acoustic/45-v1.mp3',
  'samples/guitar-acoustic/45-v2.mp3',
  'samples/guitar-acoustic/45-v3.mp3',
  'samples/guitar-acoustic/48-v1.mp3',
  'samples/guitar-acoustic/48-v2.mp3',
  'samples/guitar-acoustic/48-v3.mp3',
  'samples/guitar-acoustic/51-v1.mp3',
  'samples/guitar-acoustic/51-v2.mp3',
  'samples/guitar-acoustic/51-v3.mp3',
  'samples/guitar-acoustic/54-v1.mp3',
  'samples/guitar-acoustic/54-v2.mp3',
  'samples/guitar-acoustic/54-v3.mp3',
  'samples/guitar-acoustic/57-v1.mp3',
  'samples/guitar-acoustic/57-v2.mp3',
  'samples/guitar-acoustic/57-v3.mp3',
  'samples/guitar-acoustic/63-v1.mp3',
  'samples/guitar-acoustic/63-v2.mp3',
  'samples/guitar-acoustic/63-v3.mp3',
  'samples/guitar-acoustic/66-v1.mp3',
  'samples/guitar-acoustic/66-v2.mp3',
  'samples/guitar-acoustic/66-v3.mp3',
  'samples/guitar-acoustic/69-v1.mp3',
  'samples/guitar-acoustic/69-v2.mp3',
  'samples/guitar-acoustic/69-v3.mp3',
  'samples/guitar-acoustic/72-v1.mp3',
  'samples/guitar-acoustic/72-v2.mp3',
  'samples/guitar-acoustic/72-v3.mp3',
  'samples/guitar-acoustic/75-v1.mp3',
  'samples/guitar-acoustic/75-v2.mp3',
  'samples/guitar-acoustic/75-v3.mp3',
  'samples/guitar-acoustic/78-v1.mp3',
  'samples/guitar-acoustic/78-v2.mp3',
  'samples/guitar-acoustic/78-v3.mp3',
  'samples/guitar-acoustic/81-v1.mp3',
  'samples/guitar-acoustic/81-v2.mp3',
  'samples/guitar-acoustic/81-v3.mp3',
  'samples/guitar-acoustic/84-v1.mp3',
  'samples/guitar-acoustic/84-v2.mp3',
  'samples/guitar-acoustic/84-v3.mp3',
  'samples/guitar-electric/37-v1.mp3',
  'samples/guitar-electric/37-v2.mp3',
  'samples/guitar-electric/37-v3.mp3',
  'samples/guitar-electric/40-v1.mp3',
  'samples/guitar-electric/40-v2.mp3',
  'samples/guitar-electric/40-v3.mp3',
  'samples/guitar-electric/42-v1.mp3',
  'samples/guitar-electric/42-v2.mp3',
  'samples/guitar-electric/42-v3.mp3',
  'samples/guitar-electric/45-v1.mp3',
  'samples/guitar-electric/45-v2.mp3',
  'samples/guitar-electric/45-v3.mp3',
  'samples/guitar-electric/48-v1.mp3',
  'samples/guitar-electric/48-v2.mp3',
  'samples/guitar-electric/48-v3.mp3',
  'samples/guitar-electric/51-v1.mp3',
  'samples/guitar-electric/51-v2.mp3',
  'samples/guitar-electric/51-v3.mp3',
  'samples/guitar-electric/54-v1.mp3',
  'samples/guitar-electric/54-v2.mp3',
  'samples/guitar-electric/54-v3.mp3',
  'samples/guitar-electric/57-v1.mp3',
  'samples/guitar-electric/57-v2.mp3',
  'samples/guitar-electric/57-v3.mp3',
  'samples/guitar-electric/63-v1.mp3',
  'samples/guitar-electric/63-v2.mp3',
  'samples/guitar-electric/63-v3.mp3',
  'samples/guitar-electric/66-v1.mp3',
  'samples/guitar-electric/66-v2.mp3',
  'samples/guitar-electric/66-v3.mp3',
  'samples/guitar-electric/69-v1.mp3',
  'samples/guitar-electric/69-v2.mp3',
  'samples/guitar-electric/69-v3.mp3',
  'samples/guitar-electric/72-v1.mp3',
  'samples/guitar-electric/72-v2.mp3',
  'samples/guitar-electric/72-v3.mp3',
  'samples/guitar-electric/75-v1.mp3',
  'samples/guitar-electric/75-v2.mp3',
  'samples/guitar-electric/75-v3.mp3',
  'samples/guitar-electric/78-v1.mp3',
  'samples/guitar-electric/78-v2.mp3',
  'samples/guitar-electric/78-v3.mp3',
  'samples/guitar-electric/81-v1.mp3',
  'samples/guitar-electric/81-v2.mp3',
  'samples/guitar-electric/81-v3.mp3',
  'samples/guitar-electric/84-v1.mp3',
  'samples/guitar-electric/84-v2.mp3',
  'samples/guitar-electric/84-v3.mp3',
  'samples/guitar-jazz/37-v1.mp3',
  'samples/guitar-jazz/37-v2.mp3',
  'samples/guitar-jazz/37-v3.mp3',
  'samples/guitar-jazz/40-v1.mp3',
  'samples/guitar-jazz/40-v2.mp3',
  'samples/guitar-jazz/40-v3.mp3',
  'samples/guitar-jazz/42-v1.mp3',
  'samples/guitar-jazz/42-v2.mp3',
  'samples/guitar-jazz/42-v3.mp3',
  'samples/guitar-jazz/45-v1.mp3',
  'samples/guitar-jazz/45-v2.mp3',
  'samples/guitar-jazz/45-v3.mp3',
  'samples/guitar-jazz/48-v1.mp3',
  'samples/guitar-jazz/48-v2.mp3',
  'samples/guitar-jazz/48-v3.mp3',
  'samples/guitar-jazz/51-v1.mp3',
  'samples/guitar-jazz/51-v2.mp3',
  'samples/guitar-jazz/51-v3.mp3',
  'samples/guitar-jazz/54-v1.mp3',
  'samples/guitar-jazz/54-v2.mp3',
  'samples/guitar-jazz/54-v3.mp3',
  'samples/guitar-jazz/57-v1.mp3',
  'samples/guitar-jazz/57-v2.mp3',
  'samples/guitar-jazz/57-v3.mp3',
  'samples/guitar-jazz/63-v1.mp3',
  'samples/guitar-jazz/63-v2.mp3',
  'samples/guitar-jazz/63-v3.mp3',
  'samples/guitar-jazz/66-v1.mp3',
  'samples/guitar-jazz/66-v2.mp3',
  'samples/guitar-jazz/66-v3.mp3',
  'samples/guitar-jazz/69-v1.mp3',
  'samples/guitar-jazz/69-v2.mp3',
  'samples/guitar-jazz/69-v3.mp3',
  'samples/guitar-jazz/72-v1.mp3',
  'samples/guitar-jazz/72-v2.mp3',
  'samples/guitar-jazz/72-v3.mp3',
  'samples/guitar-jazz/75-v1.mp3',
  'samples/guitar-jazz/75-v2.mp3',
  'samples/guitar-jazz/75-v3.mp3',
  'samples/guitar-jazz/78-v1.mp3',
  'samples/guitar-jazz/78-v2.mp3',
  'samples/guitar-jazz/78-v3.mp3',
  'samples/guitar-jazz/81-v1.mp3',
  'samples/guitar-jazz/81-v2.mp3',
  'samples/guitar-jazz/81-v3.mp3',
  'samples/guitar-jazz/84-v1.mp3',
  'samples/guitar-jazz/84-v2.mp3',
  'samples/guitar-jazz/84-v3.mp3',
  'samples/guitar-jazz/86-v1.mp3',
  'samples/guitar-jazz/86-v2.mp3',
  'samples/guitar-jazz/86-v3.mp3',
];
const MEDIA = [...DRUMS, ...RELEASES, ...KALIMBA, ...FLUTE, ...STRINGS_AND_VIB, ...GUITARS];
/** 抓完一輪才寫進音檔快取的記號。有這個記號＝整個 MEDIA 都在，之後載入直接跳過；
 *  沒有＝還沒抓完（或抓過一半），只補缺的那幾個。 */
const MEDIA_MARK = 'media-complete';
/** 同時幾個連線。369 個全開會讓手機整批失敗（連線數與記憶體都用完了），
 *  而且那時 `Promise.all` 會因為第一個 reject 而放棄整批。 */
const FILL_WORKERS = 6;
const bypassHttpCache = (url) => (new URL(url, location.href).origin === location.origin
  ? { cache: 'reload' }
  : undefined);

/** 把 paths 抓進 cache，最多 workers 條連線同時跑。
 *
 *  **單一檔案失敗不算失敗**：回傳沒抓到的清單讓呼叫端決定要不要重試。這點在
 *  install 裡是關鍵——原本 369 個 fetch 用一個 `Promise.all` 包起來，手機上任何
 *  一個 reject 都會讓整個 install 失敗，service worker 變 redundant、沒有 fetch
 *  handler，**瀏覽器就不會給安裝提示**，而且使用者只看到「裝不起來」。 */
async function fillCache(cache, paths, workers = FILL_WORKERS) {
  const todo = [...paths];
  const missed = [];
  const run = async () => {
    for (;;) {
      const path = todo.shift();
      if (path === undefined) return;
      try {
        const res = await fetch(path, bypassHttpCache(path));
        if (res.ok || res.type === 'opaque') await cache.put(path, res);
        else missed.push(path);
      } catch {
        missed.push(path);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(workers, todo.length)) }, run));
  return missed;
}

/** 音檔那一批（三百多個小檔案、約 11 MB）。
 *
 *  為什麼不在 install 裡抓：369 個檔案在手機上要一兩分鐘，卡在 install 會讓 worker
 *  一直停在 installing，這段時間**安裝提示不會出現、離線也還沒生效**。改成 activate
 *  之後由頁面在閒置時叫它（見底下的 message），先能安裝、先能離線開外殼，音檔在背景補齊。
 *  **已經有同一個雜湊的快取又抓完過就不抓**——這是「程式更新不重抓 11 MB」的關鍵。 */
let filling = null;
function prefetchMedia() {
  if (filling) return filling;
  filling = (async () => {
    const cache = await caches.open(MEDIA_CACHE);
    if (await cache.match(MEDIA_MARK)) return { skipped: true, done: MEDIA.length, total: MEDIA.length, missed: 0 };
    const have = new Set((await cache.keys()).map((r) => new URL(r.url).pathname.replace(/^.*\/chiptune-audio\//, '')));
    const missed = await fillCache(cache, MEDIA.filter((p) => !have.has(p)));
    if (!missed.length) await cache.put(MEDIA_MARK, new Response('ok'));
    return { skipped: false, done: MEDIA.length - missed.length, total: MEDIA.length, missed: missed.length };
  })().finally(() => { filling = null; });
  return filling;
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    // addAll() would go through the HTTP cache; fetch each file explicitly instead.
    // 外殼缺一個模組整個 app 就壞，所以抓不到的重試一輪（但**不讓 install 失敗**：
    // 失敗的話連 fetch handler 都沒有，使用者連線上都開不了）。
    const missed = await fillCache(cache, APP, 8);
    if (missed.length) await fillCache(cache, missed, 4);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => (k.startsWith(APP_PREFIX) && k !== APP_CACHE) || (k.startsWith(MEDIA_PREFIX) && k !== MEDIA_CACHE))
      .map((k) => caches.delete(k)));
    await self.clients.claim();
    // 先起步（不 waitUntil：這條只是搶時間，真正保證跑完的是頁面送來的 message）
    void prefetchMedia();
  })());
});

/** 頁面閒置時叫我們把音檔抓齊。用 message 而不是 install：waitUntil 綁在這個事件上，
 *  service worker 會為了它活到抓完，而安裝流程完全不受影響。抓完回報進度給所有分頁。 */
self.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'prefetch-media') return;
  e.waitUntil((async () => {
    const result = await prefetchMedia();
    for (const client of await self.clients.matchAll({ includeUncontrolled: true })) {
      client.postMessage({ type: 'media-status', ...result });
    }
  })());
});

// Same-origin files plus the Google Fonts stylesheet and font files.
const cacheable = (url) => url.origin === location.origin
  || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !cacheable(new URL(req.url))) return;
  e.respondWith((async () => {
    const app = await caches.open(APP_CACHE);
    let hit = await app.match(req, { ignoreSearch: true });
    let cache = app;
    if (!hit) {
      const media = await caches.open(MEDIA_CACHE);
      hit = await media.match(req, { ignoreSearch: true });
      cache = media;
    }
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
  })());
});
