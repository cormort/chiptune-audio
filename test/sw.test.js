import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// The service worker precaches an explicit file list. A module missing from it
// loads fine online but breaks the whole app offline, so pin the list to src/.
test('sw.js precaches every module in src/ and both pages', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const listed = new Set([...sw.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  const modules = readdirSync(new URL('../src/', import.meta.url)).filter((f) => f.endsWith('.js'));
  for (const f of modules) assert.ok(listed.has(`src/${f}`), `src/${f} is not in the sw.js precache list`);
  for (const f of ['index.html', 'keyboard.html', 'manifest.webmanifest']) assert.ok(listed.has(f), f);
});
