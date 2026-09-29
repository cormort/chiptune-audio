import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSfx, SFX_PRESETS, generateSong, renderSong, MOODS } from '../src/index.js';

const sane = (a) => a.every((x) => Number.isFinite(x) && Math.abs(x) <= 1);
const peak = (a) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

test('every sfx preset renders non-silent, finite, in-range samples', () => {
  for (const [name, p] of Object.entries(SFX_PRESETS)) {
    const s = renderSfx(p);
    assert.ok(s.length > 0, name);
    assert.ok(sane(s), `${name} out of range`);
    assert.ok(peak(s) > 0.05, `${name} silent`);
  }
});

test('sfx rendering is deterministic', () => {
  assert.deepEqual(renderSfx(SFX_PRESETS.explosion), renderSfx(SFX_PRESETS.explosion));
});

test('same seed => same song; different seed => different song', () => {
  assert.deepEqual(generateSong({ seed: 42 }), generateSong({ seed: 42 }));
  assert.notDeepEqual(generateSong({ seed: 1 }).lead, generateSong({ seed: 2 }).lead);
});

test('every mood renders a loopable, sane, non-silent song', () => {
  for (const mood of Object.keys(MOODS)) {
    const song = generateSong({ seed: 7, mood, bars: 4 });
    const pcm = renderSong(song);
    const expected = Math.round(60 / song.bpm / 4 * 44100) * 16 * 4;
    assert.equal(pcm.length, expected, mood);
    assert.ok(sane(pcm), mood);
    assert.ok(peak(pcm) > 0.1, mood);
  }
});

test('unknown mood throws', () => {
  assert.throws(() => generateSong({ mood: 'nope' }));
});
