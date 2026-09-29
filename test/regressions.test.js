import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderSfx, renderSfxInto, normalizeSfx, generateSong, renderSong,
  MOODS, MAX_BARS, MAX_SFX_SECONDS, SAMPLE_RATE, WAVE,
} from '../src/index.js';

const peak = (a) => { let m = 0; for (const x of a) { const v = Math.abs(x); if (v > m) m = v; } return m; };
const finite = (a) => { for (const x of a) if (!Number.isFinite(x)) return false; return true; };

// ---------------------------------------------------------------- robustness
// These all reproduce a real failure in the original implementation: the buffer
// length was derived straight from the envelope, so bad preset data reached the
// allocator.

test('negative envelope values do not throw (was RangeError: length -35280)', () => {
  const s = renderSfx({ attack: -1 });
  assert.ok(s.length > 0);
  assert.ok(finite(s));
});

test('Infinity/NaN envelope values are clamped, not fatal (was RangeError: length Infinity)', () => {
  for (const bad of [Infinity, -Infinity, NaN]) {
    const s = renderSfx({ decay: bad, sustain: bad, attack: bad });
    assert.ok(Number.isInteger(s.length), `decay=${bad}`);
    assert.ok(s.length <= MAX_SFX_SECONDS * SAMPLE_RATE, `decay=${bad} not bounded`);
    assert.ok(finite(s), `decay=${bad} produced non-finite samples`);
  }
});

test('a single sound can never exceed MAX_SFX_SECONDS', () => {
  const s = renderSfx({ attack: 1e9, sustain: 1e9, decay: 1e9 });
  assert.equal(s.length, Math.ceil(MAX_SFX_SECONDS * SAMPLE_RATE));
});

test('explicit undefined falls back to the default instead of poisoning the phase', () => {
  // `{...defaults, ...{freq: undefined}}` used to make every sample NaN upstream
  // and then render a DC-biased constant square (silently wrong, no error).
  const bad = renderSfx({ freq: undefined, slide: undefined, duty: undefined });
  const good = renderSfx({});
  assert.deepEqual(bad, good);
  assert.ok(bad.some((x) => x > 0) && bad.some((x) => x < 0), 'must oscillate, not sit at a DC level');
});

test('out-of-range parameters are clamped to sane values', () => {
  assert.equal(normalizeSfx({ freq: -500 }).freq, 0);
  assert.equal(normalizeSfx({ freq: 1e9 }).freq, 20000);
  assert.equal(normalizeSfx({ vol: 5 }).vol, 1);
  assert.equal(normalizeSfx({ vol: -5 }).vol, 0);
  assert.equal(normalizeSfx({ duty: 5 }).duty, 0.95);
  assert.equal(normalizeSfx({ wave: 99 }).wave, 3);
  assert.equal(normalizeSfx({ bits: 999 }).bits, 16);
});

test('a degenerate zero-length envelope yields an empty, non-throwing render', () => {
  const s = renderSfx({ attack: 0, sustain: 0, decay: 0 });
  assert.equal(s.length, 0);
});

test('negative or zero frequency renders silence rather than a DC offset', () => {
  // The naive oscillators sit at a constant +1 at phase 0, so clamping a bad
  // negative frequency to 0 used to emit a loud DC blip instead of silence.
  assert.equal(peak(renderSfx({ freq: -100, sustain: 0.01, decay: 0.01 })), 0);
  assert.equal(peak(renderSfx({ freq: 0, sustain: 0.01, decay: 0.01 })), 0);
  // Still returns a correctly sized (silent) buffer, not an empty one.
  assert.equal(renderSfx({ freq: 0, sustain: 0.01, decay: 0.01 }).length, Math.ceil(0.025 * SAMPLE_RATE));
});

// ------------------------------------------------------------ input validation

test('bars is validated instead of reaching the allocator (was OOM)', () => {
  assert.throws(() => generateSong({ bars: 1e9 }), RangeError);
  assert.throws(() => generateSong({ bars: 0 }), RangeError);
  assert.throws(() => generateSong({ bars: -5 }), RangeError);
  assert.throws(() => generateSong({ bars: MAX_BARS + 1 }), RangeError);
  assert.throws(() => generateSong({ bars: NaN }), RangeError);
});

test('non-integer bars is floored consistently so renderSong length stays integral', () => {
  const song = generateSong({ bars: 2.7 });
  assert.equal(song.bars, 2);
  const pcm = renderSong(song);
  assert.ok(Number.isInteger(pcm.length));
  assert.equal(pcm.length, 2 * 16 * Math.round((60 / song.bpm / 4) * SAMPLE_RATE));
});

test('renderSong rejects malformed songs with a clear error', () => {
  assert.throws(() => renderSong(null), TypeError);
  assert.throws(() => renderSong({}), TypeError);
  assert.throws(() => renderSong({ lead: [], bass: [], bpm: 0, bars: 4 }), RangeError);
  assert.throws(() => renderSong({ lead: [], bass: [], bpm: 120, bars: 9999 }), RangeError);
});

test('an unusable seed falls back to the documented default', () => {
  assert.equal(generateSong({ seed: 'abc' }).seed, 1);
  assert.deepEqual(generateSong({ seed: 'abc' }), generateSong({ seed: 1 }));
  assert.deepEqual(generateSong({ seed: undefined }), generateSong({ seed: 1 }));
});

// ------------------------------------------------------------------- looping

test('the loop is continuous: the wrap is not a step outlier (was a click)', () => {
  // The wrap step is compared to the median internal step rather than the max,
  // because a hard-edged square sets a huge max that would mask any click. The
  // original renderer truncated note tails at the loop point, which produced a
  // wrap step of 5.4x and 9.8x the median on `happy`/`tense` (audible); folding
  // the tail back onto the start keeps every mood in the 1.5-2.3x range, which
  // is just the drum attack that legitimately starts the loop.
  const medianStep = (p) => {
    // Stride-sampled: the median of ~600k steps is stable enough from every 8th
    // sample and keeps the suite fast.
    const d = [];
    for (let i = 1; i < p.length; i += 8) d.push(Math.abs(p[i] - p[i - 1]));
    d.sort((a, b) => a - b);
    return d[d.length >> 1];
  };
  for (const mood of Object.keys(MOODS)) {
    for (const bars of [4, 8]) {
      const pcm = renderSong(generateSong({ seed: 7, mood, bars }));
      const seam = Math.abs(pcm[0] - pcm[pcm.length - 1]);
      const med = medianStep(pcm);
      assert.ok(
        seam <= 3 * med,
        `${mood}/${bars} bars: wrap step ${seam.toFixed(5)} is ${(seam / med).toFixed(2)}x the median step ${med.toFixed(5)}`,
      );
    }
  }
});

test('renderSong returns exactly bars*16*stepSamples samples', () => {
  for (const bars of [1, 2, 4, 8, 16]) {
    const song = generateSong({ seed: 3, bars });
    assert.equal(renderSong(song).length, bars * 16 * Math.round((60 / song.bpm / 4) * SAMPLE_RATE), `bars=${bars}`);
  }
});

// ---------------------------------------------------------------------- noise

test('noise is seeded: same seed identical, different seed different', () => {
  const base = { wave: WAVE.NOISE, freq: 9000, sustain: 0.02, decay: 0.09, bits: 4 };
  assert.deepEqual(renderSfx({ ...base, seed: 5 }), renderSfx({ ...base, seed: 5 }));
  assert.notDeepEqual(renderSfx({ ...base, seed: 5 }), renderSfx({ ...base, seed: 6 }));
});

test('drum hits inside one song are not bit-identical clones', () => {
  // Every noise voice used to share mulberry32(1), so all snares were the same.
  const song = generateSong({ seed: 11, mood: 'happy', bars: 2 });
  const pcm = renderSong(song);
  const snareLen = Math.ceil(0.11 * SAMPLE_RATE);
  const at = (step) => step * Math.round((60 / song.bpm / 4) * SAMPLE_RATE);
  const a = pcm.slice(at(4), at(4) + snareLen);
  const b = pcm.slice(at(12), at(12) + snareLen);
  assert.notDeepEqual([...a], [...b], 'both snares are identical');
});

// --------------------------------------------------------------- sample rates

test('rendering honours a custom sample rate (no resampling in a 48 kHz context)', () => {
  const p = { freq: 440, sustain: 0.1, decay: 0.1 };
  const at44 = renderSfx(p, { sampleRate: 44100 });
  const at48 = renderSfx(p, { sampleRate: 48000 });
  assert.equal(at44.length, Math.ceil(0.205 * 44100));
  assert.equal(at48.length, Math.ceil(0.205 * 48000));
  // Same sound, so the wall-clock duration must match at both rates...
  const dur44 = at44.length / 44100;
  const dur48 = at48.length / 48000;
  assert.ok(Math.abs(dur44 - dur48) < 0.001, `duration drifted: ${dur44} vs ${dur48}`);
  // ...and the pitch must be unchanged (zero crossings count cycles, not samples).
  const zc = (a) => { let n = 0; for (let i = 1; i < a.length; i++) if (a[i] >= 0 !== a[i - 1] >= 0) n++; return n; };
  assert.equal(zc(at48), zc(at44));
});

// --------------------------------------------------------------- mix-into API

test('renderSfxInto mixes additively without allocating its own buffer', () => {
  const out = new Float32Array(8000);
  renderSfxInto(out, 0, { freq: 440, sustain: 0.02, decay: 0.02 });
  const afterFirst = out.slice();
  assert.ok(peak(afterFirst) > 0);
  renderSfxInto(out, 0, { freq: 440, sustain: 0.02, decay: 0.02 });
  assert.ok(Math.abs(out[100] - afterFirst[100] * 2) < 1e-6, 'second voice did not add');
});

test('renderSfxInto clips writes to the destination length rather than overflowing', () => {
  const out = new Float32Array(64);
  const written = renderSfxInto(out, 32, { freq: 440, sustain: 1, decay: 1 });
  assert.equal(written, 32);
  assert.ok(finite(out));
});

test('renderSfxInto tolerates a negative or non-numeric offset', () => {
  const out = new Float32Array(256);
  assert.doesNotThrow(() => renderSfxInto(out, -10, { sustain: 0.001, decay: 0.001 }));
  assert.doesNotThrow(() => renderSfxInto(out, NaN, { sustain: 0.001, decay: 0.001 }));
  assert.ok(finite(out));
});
