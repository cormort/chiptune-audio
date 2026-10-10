import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as api from '../src/index.js';

// 頁面的程式現在都在 page/，HTML 只留標記與樣式；所以「demo 只能用真的 API」
// 這條線要在兩邊一起看：匯入／呼叫在 page/，控制項 id 在 HTML。
const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const html = read('index.html');
const pageFiles = readdirSync(new URL('../page/', import.meta.url)).filter((f) => f.endsWith('.js')).sort();
const pageSrc = pageFiles.map((f) => read(`page/${f}`)).join('\n');
const imports = [...pageSrc.matchAll(/import \{([^}]+)\} from '\.\.\/src\/index\.js'/g)];

test('the demo console only imports names the package actually exports', () => {
  assert.ok(imports.length >= 2, 'could not find the page imports from src/index.js');
  const names = imports.flatMap((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean));
  assert.ok(names.length >= 5, 'demo import list looks wrong');
  for (const n of names) assert.ok(n in api, `page/ imports "${n}", which is not exported`);
});

test('the demo console only calls engine methods that exist', () => {
  const called = new Set([...pageSrc.matchAll(/\baudio\.([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
  assert.ok(called.size > 0, 'found no audio.* calls to check');
  for (const m of called) {
    assert.equal(typeof api.ChiptuneAudio.prototype[m], 'function', `page/ calls audio.${m}(), which does not exist`);
  }
});

test('the demo console accepts .mid and .smf files for MIDI remix', () => {
  const input = html.match(/<input id="midiFile"[^>]*>/);
  assert.ok(input, 'could not find the MIDI file input');
  const accept = (input[0].match(/accept="([^"]*)"/) || [])[1];
  assert.ok(accept, 'the MIDI file input has no accept list');
  const exts = accept.split(',').map((s) => s.trim());
  for (const ext of ['.mid', '.midi', '.smf']) {
    assert.ok(exts.includes(ext), `the MIDI file input rejects ${ext}`);
  }
  assert.ok(html.includes('id="midiAutoPlay"'), 'the load-then-play toggle is missing');
  assert.ok(html.includes('id="midiSection"'), 'the drop target is missing');
});

test('the pages load their module instead of an inline script', () => {
  assert.match(html, /<script type="module" src="page\/console\.js">/, 'index.html no longer loads page/console.js');
  const keyboard = read('keyboard.html');
  assert.match(keyboard, /<script type="module" src="page\/keyboard\.js">/, 'keyboard.html no longer loads page/keyboard.js');
});

test('every page module parses', async () => {
  // Evaluating them would need a DOM, so a resolve/runtime failure is expected;
  // only a syntax error is a real problem, and that surfaces at parse time.
  assert.ok(pageFiles.length >= 4, `expected the page modules, found ${pageFiles.join(', ')}`);
  for (const f of pageFiles) {
    const src = new TextEncoder().encode(read(`page/${f}`));
    const url = `data:text/javascript;base64,${Buffer.from(src).toString('base64')}`;
    try {
      await import(url);
    } catch (e) {
      assert.ok(!(e instanceof SyntaxError), `page/${f} has a syntax error: ${e.message}`);
    }
  }
});
