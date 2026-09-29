import { mulberry32 } from './rng.js';

export const SAMPLE_RATE = 44100;
export const WAVE = { SQUARE: 0, SAW: 1, TRIANGLE: 2, NOISE: 3 };

/** Hard ceiling on one rendered sound, in seconds.
 *  The old code derived the Float32Array length straight from the envelope, so
 *  a malformed preset (`decay: Infinity`, `attack: -1`) threw RangeError and a
 *  huge one could ask for gigabytes. Every path now clamps to this. */
export const MAX_SFX_SECONDS = 30;

export const SFX_DEFAULTS = {
  wave: WAVE.SQUARE,
  freq: 440,       // Hz
  slide: 0,        // octaves per second
  duty: 0.5,       // square pulse width
  dutySweep: 0,    // duty change per second
  vibDepth: 0,     // fraction of freq
  vibRate: 0,      // Hz
  arpMult: 1,      // frequency multiplier applied at arpTime
  arpTime: 0,      // seconds; 0 = off
  bits: 0,         // bit-crush depth; 0 = off
  attack: 0.005,
  sustain: 0.1,
  decay: 0.1,
  vol: 0.5,
  seed: 1,         // noise generator seed, so successive noise hits can differ
};

// Accepted range per parameter. A non-finite value falls back to the default and
// a finite one is clamped, so no input can reach the oscillator as NaN.
const LIMITS = {
  wave: [0, 3],
  freq: [0, 20000],
  slide: [-64, 64],
  duty: [0.05, 0.95],
  dutySweep: [-256, 256],
  vibDepth: [0, 1],
  vibRate: [0, 4000],
  arpMult: [0.01, 64],
  arpTime: [0, MAX_SFX_SECONDS],
  bits: [0, 16],
  attack: [0, MAX_SFX_SECONDS],
  sustain: [0, MAX_SFX_SECONDS],
  decay: [0, MAX_SFX_SECONDS],
  vol: [0, 1],
};

/** Coerce a params object into a complete, finite, in-range parameter set.
 *  Unknown keys are dropped, `undefined`/`NaN`/`Infinity` fall back to the
 *  default, and out-of-range numbers are clamped. */
export function normalizeSfx(params = {}) {
  const src = params && typeof params === 'object' ? params : {};
  const p = {};
  for (const k in SFX_DEFAULTS) {
    const raw = src[k];
    let v = typeof raw === 'number' && Number.isFinite(raw) ? raw : SFX_DEFAULTS[k];
    const lim = LIMITS[k];
    if (lim !== undefined) {
      if (v < lim[0]) v = lim[0];
      else if (v > lim[1]) v = lim[1];
    }
    p[k] = v;
  }
  p.wave = Math.round(p.wave);
  p.bits = Math.round(p.bits);
  p.seed = p.seed >>> 0;
  return p;
}

// Sine table for vibrato. Vibrato was the last per-sample transcendental left in
// the inner loop (~27 ns/sample for the vibrato presets); a 2048-entry table with
// linear interpolation costs a few multiplies and has ~3e-7 absolute error,
// which is far below anything audible in a pitch LFO.
const SINE_BITS = 11;
const SINE_SIZE = 1 << SINE_BITS;
const SINE = new Float32Array(SINE_SIZE + 1);
for (let i = 0; i <= SINE_SIZE; i++) SINE[i] = Math.sin((2 * Math.PI * i) / SINE_SIZE);

/** Write one normalised voice into `out` starting at `offset`, additively.
 *  Mixing straight into the destination is what lets the song renderer lay down
 *  hundreds of notes without allocating a temporary array per note. */
function renderVoice(out, offset, p, sampleRate) {
  const invSR = 1 / sampleRate;
  const seconds = p.attack + p.sustain + p.decay;
  let n = Math.ceil(seconds * sampleRate);
  const maxN = Math.ceil(MAX_SFX_SECONDS * sampleRate);
  if (n > maxN) n = maxN;
  const room = out.length - offset;
  if (n > room) n = room;
  if (n <= 0) return 0;
  // A zero/negative frequency has no oscillation, and the naive oscillators
  // would otherwise sit at a constant +1 or -1: a DC offset, not silence.
  // (Clamping `freq: -100` to 0 used to turn bad input into a loud DC blip.)
  if (p.freq <= 0) return 0;

  const wave = p.wave;
  const vol = p.vol;
  const levels = p.bits > 0 ? 2 ** p.bits : 0;
  const invLevels = levels ? 1 / levels : 0;

  // Envelope: 0 -> 1 over `attack`, hold over `sustain`, 1 -> 0 over `decay`.
  // Advanced by a fixed step instead of recomputing t/attack per sample.
  // decay === 0 yields an infinite step, so the envelope snaps to 0 exactly like
  // the old `1 - (t - a - s) / 0`.
  const aEnd = p.attack * sampleRate;
  const sEnd = aEnd + p.sustain * sampleRate;
  const aStep = aEnd > 0 ? invSR / p.attack : 0;
  const dStep = p.decay > 0 ? invSR / p.decay : Infinity;
  let env = 0;

  // f(i) = freq * 2^(slide * i / SR), evaluated as a running product rather than
  // a Math.pow per sample. Drift over even a 30 s sound stays below 1e-9.
  const slideRatio = p.slide === 0 ? 1 : Math.pow(2, p.slide * invSR);
  let f = p.freq;
  const arpAt = p.arpTime > 0 ? Math.ceil(p.arpTime * sampleRate) : -1;

  const hasVib = p.vibDepth !== 0 && p.vibRate !== 0;
  // Vibrato position is tracked in sine-table units, not radians.
  const vibStep = p.vibRate * SINE_SIZE * invSR;
  let vibPos = 0;

  const hasDutySweep = p.dutySweep !== 0;
  const dutyStep = p.dutySweep * invSR;
  let dutyCur = p.duty;

  const noise = mulberry32(p.seed);
  // Seed the noise register immediately. The old code started at 0, so every
  // noise sound opened with a short run of silence at its loudest moment.
  let nv = noise() * 2 - 1;
  let phase = 0;
  let wrapped = false;

  for (let i = 0, idx = offset; i < n; i++, idx++) {
    if (i < aEnd) env += aStep;
    else if (i < sEnd) env = 1;
    else { env -= dStep; if (env < 0) env = 0; }

    if (i === arpAt) f *= p.arpMult;

    let fi = f;
    if (hasVib) {
      vibPos += vibStep;
      if (vibPos >= SINE_SIZE) vibPos -= SINE_SIZE * Math.floor(vibPos / SINE_SIZE);
      const si = vibPos | 0;
      const s0 = SINE[si];
      fi *= 1 + p.vibDepth * (s0 + (SINE[si + 1] - s0) * (vibPos - si));
    }
    phase += fi * invSR;
    f *= slideRatio;

    if (phase >= 1) { phase -= Math.floor(phase); wrapped = true; } else wrapped = false;

    let v;
    switch (wave) {
      case WAVE.SAW: v = 2 * phase - 1; break;
      case WAVE.TRIANGLE: v = 4 * Math.abs(phase - 0.5) - 1; break;
      case WAVE.NOISE:
        if (wrapped) nv = noise() * 2 - 1;
        v = nv;
        break;
      default:
        if (hasDutySweep) {
          dutyCur += dutyStep;
          if (dutyCur < 0.05) dutyCur = 0.05;
          else if (dutyCur > 0.95) dutyCur = 0.95;
        }
        v = phase < dutyCur ? 1 : -1;
    }
    if (levels) v = Math.round(v * levels) * invLevels;
    out[idx] += v * env * vol;
  }
  return n;
}

/** Render one sound (sfxr-style parameters) to a fresh mono Float32Array.
 *  `opts.sampleRate` defaults to 44100; the playback engine passes the
 *  AudioContext rate so the browser never has to resample. */
export function renderSfx(params = {}, opts = {}) {
  const sampleRate = opts && opts.sampleRate > 0 ? opts.sampleRate : SAMPLE_RATE;
  const p = normalizeSfx(params);
  const seconds = p.attack + p.sustain + p.decay;
  let n = Math.ceil(seconds * sampleRate);
  const maxN = Math.ceil(MAX_SFX_SECONDS * sampleRate);
  if (n > maxN) n = maxN;
  if (n <= 0) return new Float32Array(0);
  const out = new Float32Array(n);
  renderVoice(out, 0, p, sampleRate);
  return out;
}

/** Mix a sound into an existing buffer at `offset`. Used by the song renderer to
 *  lay down every voice into one buffer, allocating nothing per note. */
export function renderSfxInto(out, offset, params, sampleRate = SAMPLE_RATE) {
  if (!(out instanceof Float32Array)) throw new TypeError('renderSfxInto expects a Float32Array');
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) sampleRate = SAMPLE_RATE;
  return renderVoice(out, Math.floor(offset), normalizeSfx(params), sampleRate);
}

export const SFX_PRESETS = {
  coin:     { freq: 988, arpMult: 1.5, arpTime: 0.07, sustain: 0.1, decay: 0.15, duty: 0.25 },
  jump:     { freq: 260, slide: 2.2, sustain: 0.08, decay: 0.15, duty: 0.4 },
  laser:    { freq: 1400, slide: -4, sustain: 0.05, decay: 0.15, duty: 0.3, dutySweep: -1 },
  hit:      { wave: WAVE.NOISE, freq: 6000, slide: -1.5, sustain: 0.03, decay: 0.12, bits: 4 },
  explosion:{ wave: WAVE.NOISE, freq: 2500, slide: -2.5, attack: 0.01, sustain: 0.15, decay: 0.55, vol: 0.7 },
  powerup:  { freq: 330, slide: 3, vibDepth: 0.03, vibRate: 30, sustain: 0.2, decay: 0.2, duty: 0.5 },
  select:   { freq: 660, sustain: 0.04, decay: 0.06, duty: 0.5, vol: 0.4 },
  gameover: { wave: WAVE.TRIANGLE, freq: 400, slide: -1, attack: 0.01, sustain: 0.4, decay: 0.6, vol: 0.6 },
  win:      { freq: 523, arpMult: 1.5, arpTime: 0.12, sustain: 0.3, decay: 0.4, duty: 0.25, vibDepth: 0.01, vibRate: 8 },
  shoot:    { freq: 900, slide: -6, sustain: 0.02, decay: 0.08, duty: 0.5, vol: 0.4 },
  blip:     { freq: 1200, sustain: 0.01, decay: 0.03, duty: 0.25, vol: 0.3 },
  click:    { freq: 2000, attack: 0, sustain: 0.003, decay: 0.012, vol: 0.35 },
  hurt:     { wave: WAVE.SAW, freq: 320, slide: -3, sustain: 0.05, decay: 0.15, bits: 4 },
  pickup:   { freq: 700, arpMult: 2, arpTime: 0.05, sustain: 0.06, decay: 0.1, duty: 0.125 },
  heal:     { wave: WAVE.TRIANGLE, freq: 400, slide: 1.5, vibDepth: 0.02, vibRate: 12, sustain: 0.25, decay: 0.3, vol: 0.6 },
  levelup:  { freq: 440, slide: 0.5, arpMult: 2, arpTime: 0.1, sustain: 0.25, decay: 0.3, duty: 0.125, vibDepth: 0.01, vibRate: 10 },
  door:     { wave: WAVE.NOISE, freq: 300, slide: -1, attack: 0.01, sustain: 0.1, decay: 0.2, bits: 3, vol: 0.6 },
  step:     { wave: WAVE.NOISE, freq: 1500, sustain: 0.01, decay: 0.04, vol: 0.3 },
  bounce:   { wave: WAVE.TRIANGLE, freq: 180, slide: 4, sustain: 0.03, decay: 0.1, vol: 0.6 },
  alarm:    { freq: 880, vibDepth: 0.2, vibRate: 6, sustain: 0.6, decay: 0.1, vol: 0.35 },
  teleport: { freq: 200, slide: 6, vibDepth: 0.08, vibRate: 40, sustain: 0.25, decay: 0.15, duty: 0.3, dutySweep: 2 },
  charge:   { wave: WAVE.SAW, freq: 110, slide: 3, attack: 0.05, sustain: 0.6, decay: 0.05, vol: 0.35 },
  error:    { freq: 220, arpMult: 0.75, arpTime: 0.08, sustain: 0.12, decay: 0.08, duty: 0.5, vol: 0.4 },
  splash:   { wave: WAVE.NOISE, freq: 4000, slide: -1, attack: 0.02, sustain: 0.1, decay: 0.35, vol: 0.5 },
};
