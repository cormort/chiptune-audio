import { mulberry32 } from './rng.js';
import { renderSfxInto, SAMPLE_RATE, WAVE } from './sfx.js';

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  blues: [0, 3, 5, 6, 7, 10],
};

// Chord progressions as scale-degree roots (7-note scales).
const PROGRESSIONS = [[0, 4, 5, 3], [0, 5, 3, 4], [0, 3, 4, 0], [5, 3, 0, 4]];

export const MOODS = {
  happy: { scale: 'major', bpm: 140, duty: 0.5, density: 0.7, root: 60 },
  calm:  { scale: 'pentatonic', bpm: 96, duty: 0.25, density: 0.4, root: 57 },
  tense: { scale: 'minor', bpm: 164, duty: 0.125, density: 0.85, root: 57 },
  sad:   { scale: 'minor', bpm: 72, duty: 0.25, density: 0.35, root: 55 },
  // Added later; the four above are frozen (see test/parity.test.js).
  heroic:     { scale: 'major', bpm: 152, duty: 0.25, density: 0.75, root: 62 },
  playful:    { scale: 'pentatonic', bpm: 128, duty: 0.5, density: 0.8, root: 64 },
  dreamy:     { scale: 'lydian', bpm: 100, duty: 0.25, density: 0.45, root: 64 },
  mysterious: { scale: 'dorian', bpm: 88, duty: 0.125, density: 0.45, root: 57 },
  spooky:     { scale: 'phrygian', bpm: 76, duty: 0.125, density: 0.4, root: 52 },
  boss:       { scale: 'harmonicMinor', bpm: 180, duty: 0.125, density: 0.95, root: 52 },
  groovy:     { scale: 'blues', bpm: 116, duty: 0.5, density: 0.6, root: 55 },
};

export const STEPS_PER_BAR = 16;

/** Longest loop we will compose/render. `bars: 1e9` used to reach the allocator
 *  and killed the process with "JavaScript heap out of memory" (measured). */
export const MAX_BARS = 128;

/** Loop padding, in steps. Note tails that overrun the loop end are folded back
 *  onto the loop start, which removes the click the old renderer produced
 *  (measured: last sample -0.0129 against a first sample of 0). */
const TAIL_STEPS = 4;

const midi = (n) => 440 * 2 ** ((n - 69) / 12);

// Scale note (may be negative / beyond the octave) -> midi number.
function degreeToMidi(scale, root, degree) {
  const len = scale.length;
  const oct = Math.floor(degree / len);
  return root + oct * 12 + scale[((degree % len) + len) % len];
}

/** Deterministic song description: same options => same song.
 *  Seed handling is unchanged, so every previously generated song still comes
 *  out bit-identical (see test/parity.test.js). Invalid input now throws a
 *  descriptive RangeError instead of reaching the allocator. */
export function generateSong({ seed = 1, mood = 'happy', bars = 8 } = {}) {
  const m = MOODS[mood];
  if (!m) throw new Error(`Unknown mood: ${mood} (expected one of ${Object.keys(MOODS).join(', ')})`);

  const barCount = Math.floor(Number(bars));
  if (!Number.isFinite(barCount) || barCount < 1 || barCount > MAX_BARS) {
    throw new RangeError(`bars must be an integer between 1 and ${MAX_BARS}, got ${bars}`);
  }
  const seedU32 = Number.isFinite(Number(seed)) ? Number(seed) >>> 0 : 1;

  const rng = mulberry32(seedU32);
  const scale = SCALES[m.scale];
  const prog = PROGRESSIONS[Math.floor(rng() * PROGRESSIONS.length)];
  const lead = [];
  const bass = [];
  let deg = 7 + Math.floor(rng() * 3); // start around the upper octave
  for (let bar = 0; bar < barCount; bar++) {
    const chordRoot = m.scale === 'pentatonic' ? prog[bar % 4] % scale.length : prog[bar % 4];
    for (let s = 0; s < STEPS_PER_BAR; s++) {
      const step = bar * STEPS_PER_BAR + s;
      if (s % 2 === 0) {
        bass.push({ step, len: 2, note: degreeToMidi(scale, m.root - 24, chordRoot) });
      }
      const onBeat = s % 4 === 0;
      if (rng() < (onBeat ? Math.min(1, m.density + 0.2) : m.density * 0.6)) {
        // Stepwise motion, with a pull toward chord tones on strong beats.
        deg += Math.floor(rng() * 5) - 2;
        if (onBeat) deg = chordRoot + 7 + 2 * Math.round((deg - chordRoot - 7) / 2);
        deg = Math.max(0, Math.min(scale.length * 2, deg));
        lead.push({ step, len: onBeat ? 3 : 2, note: degreeToMidi(scale, m.root, deg) });
      }
    }
  }
  return { seed: seedU32, mood, bars: barCount, bpm: m.bpm, duty: m.duty, lead, bass };
}

/** Render a song to a seamlessly loopable mono Float32Array.
 *
 *  Two changes from the original:
 *  - voices are mixed straight into one buffer (`renderSfxInto`), so there is no
 *    temporary array and no second copy per note (was ~220 allocations/song);
 *  - the buffer is padded and the overhang folded back to the start, so a note
 *    tail running past the loop point continues into the loop instead of being
 *    truncated into a click.
 *
 *  `opts.sampleRate` defaults to 44100; the engine passes the AudioContext rate
 *  so playback never needs resampling. `opts.mix` ({ lead, bass, drums }, each
 *  0..1, default 1) weights the parts.
 */
export function renderSong(song, opts = {}) {
  const sampleRate = opts && opts.sampleRate > 0 ? opts.sampleRate : SAMPLE_RATE;
  if (!song || typeof song !== 'object' || !Array.isArray(song.lead) || !Array.isArray(song.bass)) {
    throw new TypeError('renderSong expects a song object from generateSong()');
  }
  const bpm = Number(song.bpm);
  if (!Number.isFinite(bpm) || bpm <= 0) throw new RangeError(`song.bpm must be a positive number, got ${song.bpm}`);
  const bars = Math.floor(Number(song.bars));
  if (!Number.isFinite(bars) || bars < 1 || bars > MAX_BARS) {
    throw new RangeError(`song.bars must be an integer between 1 and ${MAX_BARS}, got ${song.bars}`);
  }
  const duty = Number.isFinite(song.duty) ? song.duty : 0.5;

  const stepSec = 60 / bpm / 4;
  const stepSamples = Math.max(1, Math.round(stepSec * sampleRate));
  const total = bars * STEPS_PER_BAR * stepSamples;
  const tail = TAIL_STEPS * stepSamples;
  const len = total + tail;

  // Without a mix every voice goes into one buffer (the original, cheapest path).
  // With a mix each part gets its own buffer so it can be weighted, while the
  // normalisation gain still comes from the unity mix: a soloed part plays at
  // the same level it has inside the full song.
  const mix = opts && opts.mix;
  if (!mix) {
    const out = new Float32Array(len);
    renderParts(song, out, out, out, stepSec, stepSamples, duty, sampleRate);
    foldTail(out, total, tail);
    const peak = peakOf(out, total);
    if (peak > 0.9) {
      const g = 0.9 / peak;
      for (let i = 0; i < total; i++) out[i] *= g;
    }
    // A view, not a copy: avoids duplicating up to ~2.4 MB per song.
    return out.subarray(0, total);
  }

  const lead = new Float32Array(len);
  const bass = new Float32Array(len);
  const drums = new Float32Array(len);
  renderParts(song, lead, bass, drums, stepSec, stepSamples, duty, sampleRate);
  foldTail(lead, total, tail);
  foldTail(bass, total, tail);
  foldTail(drums, total, tail);
  let peak = 0;
  for (let i = 0; i < total; i++) {
    const a = Math.abs(lead[i] + bass[i] + drums[i]);
    if (a > peak) peak = a;
  }
  const g = peak > 0.9 ? 0.9 / peak : 1;
  const gl = mixGain(mix.lead) * g, gb = mixGain(mix.bass) * g, gd = mixGain(mix.drums) * g;
  // Reuse the lead buffer as the output.
  for (let i = 0; i < total; i++) lead[i] = lead[i] * gl + bass[i] * gb + drums[i] * gd;
  return lead.subarray(0, total);
}

/** Part gain, 0..1; anything missing or non-finite means unity. */
function mixGain(v) {
  return typeof v === 'number' && Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 1;
}

function peakOf(buf, n) {
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(buf[i]);
    if (a > peak) peak = a;
  }
  return peak;
}

// Fold the overhang onto the loop start: the tail of the last notes now
// continues into the first samples, so the loop is continuous.
function foldTail(buf, total, tail) {
  for (let i = 0; i < tail; i++) buf[i] += buf[total + i];
}

/** Mix every note into the given part buffers (which may all be the same one). */
function renderParts(song, leadOut, bassOut, drumsOut, stepSec, stepSamples, duty, sampleRate) {
  const bars = Math.floor(Number(song.bars));
  for (const n of song.lead) {
    const dur = n.len * stepSec;
    renderSfxInto(leadOut, n.step * stepSamples, {
      wave: WAVE.SQUARE, freq: midi(n.note), duty,
      vibDepth: 0.004, vibRate: 6, attack: 0.005, sustain: dur * 0.5, decay: dur * 0.5, vol: 0.22,
    }, sampleRate);
  }
  for (const n of song.bass) {
    const dur = n.len * stepSec;
    renderSfxInto(bassOut, n.step * stepSamples, {
      wave: WAVE.TRIANGLE, freq: midi(n.note), attack: 0.005, sustain: dur * 0.7, decay: dur * 0.3, vol: 0.35,
    }, sampleRate);
  }

  // Drums. The seed is advanced per hit, so repeated snares/hats are no longer
  // bit-identical (all noise used to share the hard-coded mulberry32(1) stream,
  // which made every hit sound mechanically cloned) while staying reproducible.
  const steps = bars * STEPS_PER_BAR;
  for (let step = 0; step < steps; step++) {
    const s = step % STEPS_PER_BAR;
    const at = step * stepSamples;
    if (s === 0 || s === 8) {
      renderSfxInto(drumsOut, at, {
        wave: WAVE.TRIANGLE, freq: 150, slide: -6, sustain: 0.02, decay: 0.1, vol: 0.5,
      }, sampleRate);
    }
    if (s === 4 || s === 12) {
      renderSfxInto(drumsOut, at, {
        wave: WAVE.NOISE, freq: 9000, sustain: 0.02, decay: 0.09, vol: 0.2, bits: 4,
        seed: (0x5eed + step) >>> 0,
      }, sampleRate);
    }
    if (s % 2 === 0) {
      renderSfxInto(drumsOut, at, {
        wave: WAVE.NOISE, freq: 20000, sustain: 0.005, decay: 0.03,
        vol: s % 4 === 0 ? 0.09 : 0.05,
        seed: (0xbeef + step) >>> 0,
      }, sampleRate);
    }
  }
}
