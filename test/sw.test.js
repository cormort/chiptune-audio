import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

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
