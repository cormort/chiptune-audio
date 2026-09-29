import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as api from '../src/index.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const importLine = html.match(/import \{([^}]+)\} from '\.\/src\/index\.js'/);
const demoScript = html.match(/<script type="module">([\s\S]*?)<\/script>/);

test('the demo console only imports names the package actually exports', () => {
  assert.ok(importLine, 'could not find the demo import statement');
  const names = importLine[1].split(',').map((s) => s.trim()).filter(Boolean);
  assert.ok(names.length >= 5, 'demo import list looks wrong');
  for (const n of names) assert.ok(n in api, `index.html imports "${n}", which is not exported`);
});

test('the demo console only calls engine methods that exist', () => {
  assert.ok(demoScript, 'could not find the demo module script');
  const called = new Set([...demoScript[1].matchAll(/\baudio\.([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
  assert.ok(called.size > 0, 'found no audio.* calls to check');
  for (const m of called) {
    assert.equal(typeof api.ChiptuneAudio.prototype[m], 'function', `index.html calls audio.${m}(), which does not exist`);
  }
});

test('the demo module script parses', async () => {
  // Evaluating it would need a DOM, but a syntax error surfaces as SyntaxError
  // at parse time, before any of that. A resolve/runtime failure is not a
  // syntax problem, so only SyntaxError fails this test.
  const src = new TextEncoder().encode(demoScript[1]);
  const url = `data:text/javascript;base64,${Buffer.from(src).toString('base64')}`;
  try {
    await import(url);
  } catch (e) {
    assert.ok(!(e instanceof SyntaxError), `index.html script has a syntax error: ${e.message}`);
  }
});
