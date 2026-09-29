import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { generateSong as genNew, MOODS } from '../src/index.js';

// `baseline/` is a frozen copy of the pre-optimisation sources, kept so the
// composition output can be pinned bit-for-bit. It is not part of the published
// package; if it has been deleted these tests skip rather than fail.
const hasBaseline = existsSync(new URL('../baseline/src/index.js', import.meta.url));
const skip = hasBaseline ? false : 'baseline/ not present';

// The composition logic was deliberately left alone, so every song the old code
// produced must still be reproduced exactly. A refactor that silently changed the
// note stream would be a breaking change for anyone who shipped a seed.
test('generateSong is bit-identical to the original for every mood/seed/bars', { skip }, async () => {
  const { generateSong: genOld, MOODS: OLD_MOODS } = await import('../baseline/src/index.js');
  // Moods added after the baseline have nothing to compare against.
  for (const mood of Object.keys(OLD_MOODS)) {
    assert.deepEqual(MOODS[mood], OLD_MOODS[mood], `${mood} spec changed`);
    for (const seed of [0, 1, 2, 7, 42, 1337, 99999, 4294967295]) {
      for (const bars of [1, 2, 4, 8]) {
        const opts = { seed, mood, bars };
        assert.deepEqual(genNew(opts), genOld(opts), `mismatch for ${JSON.stringify(opts)}`);
      }
    }
  }
});

test('the RNG itself is unchanged', { skip }, async () => {
  const { mulberry32: newRng } = await import('../src/index.js');
  const { mulberry32: oldRng } = await import('../baseline/src/index.js');
  for (const seed of [0, 1, 42, 123456]) {
    const a = newRng(seed);
    const b = oldRng(seed);
    for (let i = 0; i < 32; i++) assert.equal(a(), b(), `seed ${seed} step ${i}`);
  }
});

test('a handful of known seeds still produce a non-trivial song', () => {
  for (const seed of [1, 42, 1337]) {
    const song = genNew({ seed, mood: 'happy', bars: 8 });
    assert.ok(song.lead.length > 20, `seed ${seed} produced ${song.lead.length} lead notes`);
    assert.equal(song.bass.length, 8 * 16 / 2);
  }
});
