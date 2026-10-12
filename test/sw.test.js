import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SampledInstruments } from '../src/index.js';

// The service worker precaches an explicit file list. A module missing from it
// loads fine online but breaks the whole app offline, so pin the list to src/
// and page/ (the page layer is what the three pages actually load).
test('sw.js precaches every module in src/ and page/, and every page', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const listed = new Set([...sw.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  for (const dir of ['src', 'page']) {
    const modules = readdirSync(new URL(`../${dir}/`, import.meta.url)).filter((f) => f.endsWith('.js'));
    assert.ok(modules.length > 0, `no modules found in ${dir}/`);
    for (const f of modules) assert.ok(listed.has(`${dir}/${f}`), `${dir}/${f} is not in the sw.js precache list`);
  }
  assert.ok(listed.has('page/theme.css'), 'page/theme.css is not in the sw.js precache list');
  for (const f of ['index.html', 'console.html', 'keyboard.html', 'kalimba.html', 'score.html', 'manifest.webmanifest']) {
    assert.ok(listed.has(f), f);
  }
});

// 換一版就清掉舊快取是對的，但清掉的範圍要是「外殼」而已。樣本快取裝的是使用者
// 抓下來的幾 MB 樂器錄音：如果它落在清理前綴裡，每次部署都會被刪掉、使用者下次
// 開啟又要重抓一次，而且不會有任何錯誤訊息——只有「怎麼又在下載」的感覺。
test('a version bump cannot delete the cached instrument samples', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const version = sw.match(/const VERSION = '([^']+)'/)?.[1];
  const appCache = sw.match(/const APP_CACHE = `([^`]+)`/)?.[1].replace('${VERSION}', version);
  const appPrefix = sw.match(/const APP_PREFIX = '([^']+)'/)?.[1];
  const mediaPrefix = sw.match(/const MEDIA_PREFIX = '([^']+)'/)?.[1];
  assert.ok(version && appCache && appPrefix && mediaPrefix, 'sw.js must name and prefix both caches');
  const mediaCache = sw.match(/const MEDIA_CACHE = `chiptune-media-\$\{MEDIA_VERSION\}`/);
  assert.ok(mediaCache, 'the audio belongs in its own cache');
  // 外殼快取要落在自己的前綴裡（不然永遠不會被清），兩個前綴都不可以碰到樣本快取
  assert.ok(appCache.startsWith(appPrefix), `${appCache} would never be cleaned up`);
  const samples = new SampledInstruments(null).cacheName;
  assert.ok(!samples.startsWith(appPrefix), `the cleanup prefix ${appPrefix} would delete ${samples}`);
  assert.ok(!samples.startsWith(mediaPrefix), `the cleanup prefix ${mediaPrefix} would delete ${samples}`);
  // 清理邏輯要用這兩個前綴
  const activate = sw.slice(sw.indexOf("addEventListener('activate'"));
  assert.ok(activate.includes('APP_PREFIX'), 'the activate handler ignores APP_PREFIX');
  assert.ok(activate.includes('MEDIA_PREFIX'), 'the activate handler ignores MEDIA_PREFIX');
  // 音檔（11 MB）不能下載在 install 裡：369 個檔案在手機上要一兩分鐘，卡在 install 會
  // 讓 worker 停在 installing，那段時間瀏覽器不給安裝提示、離線也還沒生效。
  // 改由頁面在閒置時用 message 叫它抓，抓完寫下 MEDIA_MARK，之後就跳過。
  const install = sw.slice(sw.indexOf("addEventListener('install'"), sw.indexOf("addEventListener('activate'"));
  assert.ok(!/DRUMS|RELEASES|KALIMBA|FLUTE|STRINGS_AND_VIB|GUITARS|MEDIA\b/.test(install),
    'install still downloads the audio: the app cannot be installed until it finishes');
  const prefetch = sw.slice(sw.indexOf('function prefetchMedia'));
  assert.match(prefetch, /MEDIA_CACHE/, 'the audio belongs in its own cache');
  assert.match(prefetch, /MEDIA_MARK/, 'a finished prefetch has to leave a mark, or every load refetches 11 MB');
  assert.match(prefetch, /cache\.match\(MEDIA_MARK\)/, 'the finished mark is never checked');
  // 抓不到的清單要用來決定「這一輪算不算抓完」：只有全部到齊才寫記號
  assert.match(prefetch, /if \(!missed\.length\)/, 'an incomplete prefetch would be marked complete');
  // 讀取時兩個快取都要找
  const fetchHandler = sw.slice(sw.indexOf("addEventListener('fetch'"));
  assert.ok(fetchHandler.includes('APP_CACHE') && fetchHandler.includes('MEDIA_CACHE'), 'fetch must look in both caches');
});

// 這一段是實際把 sw.js 當程式跑起來（不是讀原始碼比對字串）：安裝流程是「裝不起來」
// 這件事的唯一兇手，而它壞掉的方式（一個 fetch 失敗就整批放棄、369 條連線全開）
// 光看程式碼不容易看出來，所以用假的 fetch／CacheStorage 直接驗證行為。
test('a cold install survives a flaky network and never blocks on the audio', async () => {
  const calls = { fetch: [], workers: 0, mediaTouched: [] };
  const store = new Map();                      // cache name -> Map(url -> body)
  const cacheOf = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    const entries = store.get(name);
    return {
      put: async (req, res) => entries.set(String(req), res.body),
      match: async (req) => (entries.has(String(req)) ? { ok: true, body: entries.get(String(req)) } : undefined),
      keys: async () => [...entries.keys()].map((u) => ({ url: `https://example.test/${u}` })),
    };
  };
  const listeners = new Map();
  let live = 0;
  let peak = 0;
  globalThis.self = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {}, matchAll: async () => [] },
  };
  globalThis.location = { href: 'https://example.test/sw.js' };
  globalThis.Response = class { constructor(body) { this.body = body; this.ok = true; this.type = 'basic'; } };
  globalThis.caches = {
    open: async (name) => cacheOf(name),
    keys: async () => [...store.keys()],
    delete: async (name) => store.delete(name),
    has: async (name) => store.has(name),
  };
  globalThis.fetch = async (path) => {
    calls.fetch.push(path);
    live += 1;
    peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 1));
    live -= 1;
    // 每五個檔案壞一個：真實世界的手機連線就是這樣
    if (calls.fetch.length % 5 === 0) throw new Error('network down');
    return new Response(`body of ${path}`);
  };
  // 監看音檔快取有沒有在 install 期間被碰
  const realOpen = globalThis.caches.open;
  globalThis.caches.open = async (name) => {
    if (name.startsWith('chiptune-media')) calls.mediaTouched.push(name);
    return realOpen(name);
  };
  await import(`../sw.js?${Date.now()}`);

  // --- install：就算一堆檔案抓不到，也必須成功 ---
  const waited = [];
  const install = listeners.get('install');
  assert.ok(install, 'sw.js registers no install handler');
  install({ waitUntil: (p) => waited.push(p) });
  await Promise.all(waited);
  assert.ok(calls.fetch.length > 10, 'install fetched almost nothing');
  assert.ok(peak <= 8, `install opened ${peak} connections at once`);
  assert.deepEqual(calls.mediaTouched, [], 'install downloaded the audio: installation would wait for all 11 MB');
  const appCache = [...store.keys()].find((k) => k.startsWith('chiptune-app-'));
  assert.ok(appCache, 'install created no app cache');
  assert.ok(store.get(appCache).size > 5, 'the app shell did not survive a flaky network');

  // --- message：頁面閒置時補齊音檔，全到齊才寫記號 ---
  const media = listeners.get('message');
  assert.ok(media, 'sw.js registers no message handler');
  calls.fetch.length = 0;
  peak = 0;
  const waited2 = [];
  media({ data: { type: 'prefetch-media' }, waitUntil: (p) => waited2.push(p) });
  await Promise.all(waited2);
  const mediaCache = [...store.keys()].find((k) => k.startsWith('chiptune-media-'));
  assert.ok(mediaCache, 'the audio never reached its own cache');
  assert.ok(peak <= 6, `the prefetch opened ${peak} connections at once`);
  assert.ok(!store.get(mediaCache).has('media-complete'), 'a run with failures must not be marked complete');

  // 再跑一次（這次連線正常）：補缺的檔案，然後才寫記號
  globalThis.fetch = async (path) => { calls.fetch.push(path); return new Response(`body of ${path}`); };
  calls.fetch.length = 0;
  const waited3 = [];
  media({ data: { type: 'prefetch-media' }, waitUntil: (p) => waited3.push(p) });
  await Promise.all(waited3);
  assert.ok(store.get(mediaCache).has('media-complete'), 'a complete run has to leave the mark');
  const before = calls.fetch.length;
  const waited4 = [];
  media({ data: { type: 'prefetch-media' }, waitUntil: (p) => waited4.push(p) });
  await Promise.all(waited4);
  assert.equal(calls.fetch.length, before, 'the audio was fetched again even though it is complete');
});
