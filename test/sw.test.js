import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SampledInstruments } from '../src/index.js';

// The service worker precaches an explicit file list. A module missing from it
// loads fine online but breaks the whole app offline, so pin the list to src/
// and page/ (the page layer is what the two pages actually load).
test('sw.js precaches every module in src/ and page/, and both pages', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const listed = new Set([...sw.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  for (const dir of ['src', 'page']) {
    const modules = readdirSync(new URL(`../${dir}/`, import.meta.url)).filter((f) => f.endsWith('.js'));
    assert.ok(modules.length > 0, `no modules found in ${dir}/`);
    for (const f of modules) assert.ok(listed.has(`${dir}/${f}`), `${dir}/${f} is not in the sw.js precache list`);
  }
  assert.ok(listed.has('page/theme.css'), 'page/theme.css is not in the sw.js precache list');
  for (const f of ['index.html', 'keyboard.html', 'manifest.webmanifest']) assert.ok(listed.has(f), f);
});

// 換一版就清掉舊快取是對的，但清掉的範圍要是「外殼」而已。樣本快取裝的是使用者
// 抓下來的幾 MB 樂器錄音：如果它落在清理前綴裡，每次部署都會被刪掉、使用者下次
// 開啟又要重抓一次，而且不會有任何錯誤訊息——只有「怎麼又在下載」的感覺。
test('a version bump cannot delete the cached instrument samples', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const version = sw.match(/const VERSION = '([^']+)'/)?.[1];
  const prefix = sw.match(/const SHELL_PREFIX = '([^']+)'/)?.[1];
  assert.ok(version, 'sw.js has no VERSION');
  assert.ok(prefix, 'sw.js has no SHELL_PREFIX to scope the cleanup with');
  const shell = `chiptune-${version}`;
  const samples = new SampledInstruments(null).cacheName;
  assert.ok(shell.startsWith(prefix), `the current shell cache ${shell} would never be cleaned up`);
  assert.ok(!samples.startsWith(prefix), `the cleanup prefix ${prefix} would delete ${samples}`);
  // 清理邏輯必須用那個前綴，不能再用寬鬆的 'chiptune-'
  const activate = sw.slice(sw.indexOf("addEventListener('activate'"));
  assert.ok(activate.includes('SHELL_PREFIX'), 'the activate handler ignores SHELL_PREFIX');
});
