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
  // 音檔只在「這個雜湊的快取還不存在」時才抓：這就是純程式更新不重抓 9.5 MB 的原因
  const install = sw.slice(sw.indexOf("addEventListener('install'"), sw.indexOf("addEventListener('activate'"));
  assert.match(install, /caches\.has\(MEDIA_CACHE\)/, 'install must skip the audio when its cache already exists');
  // 讀取時兩個快取都要找
  const fetchHandler = sw.slice(sw.indexOf("addEventListener('fetch'"));
  assert.ok(fetchHandler.includes('APP_CACHE') && fetchHandler.includes('MEDIA_CACHE'), 'fetch must look in both caches');
});
