import { mulberry32 } from './rng.js';
import { MAX_SFX_SECONDS, WAVE } from './sfx.js';

// Shared 2048-entry sine LUT for fast FM, vibrato, tremolo and harmonic synthesis
const SINE_BITS = 11;
const SINE_SIZE = 1 << SINE_BITS;
const SINE = new Float32Array(SINE_SIZE + 1);
for (let i = 0; i <= SINE_SIZE; i++) SINE[i] = Math.sin((2 * Math.PI * i) / SINE_SIZE);

function fastSin(phase) {
  let p = phase - Math.floor(phase);
  const pos = p * SINE_SIZE;
  const i = pos | 0;
  const s0 = SINE[i];
  return s0 + (SINE[i + 1] - s0) * (pos - i);
}

function sampleBounds(out, offset, p, sampleRate) {
  const seconds = p.attack + p.sustain + p.decay;
  let n = Math.ceil(seconds * sampleRate);
  const maxN = Math.ceil(MAX_SFX_SECONDS * sampleRate);
  if (n > maxN) n = maxN;
  const room = out.length - offset;
  if (n > room) n = room;
  if (n <= 0 || p.freq <= 0) return 0;
  return n;
}

/** Stiff-string physical piano synthesis (phasor rotation + frequency-dependent partial decay). */
function renderPiano(out, offset, p, sampleRate, n) {
  const f0 = p.freq;
  const vol = p.vol;
  const nyquist = sampleRate * 0.45;
  const B = 0.00015 * Math.pow(Math.max(20, f0) / 261.63, 0.4);
  const K = Math.min(14, Math.max(1, Math.floor(nyquist / f0)));
  const baseDecay = Math.max(0.55, 3.2 - Math.log2(Math.max(20, f0) / 55) * 0.42);
  const attackSamples = Math.min(Math.max(1, Math.floor(0.003 * sampleRate)), n);
  const invAttack = 1 / attackSamples;

  // Render into temporary buffer only if we need fade-out at tail, or write straight with envelope
  const fadeSamples = p.decay > 0 ? Math.min(n, Math.ceil(p.decay * sampleRate)) : 0;
  const fadeStart = Math.max(0, n - fadeSamples);
  const invFade = fadeSamples > 0 ? 1 / fadeSamples : 0;

  // Accumulate partials in a local scratch array so peak stays controlled before scaling by vol
  const buf = new Float32Array(n);
  for (let k = 1; k <= K; k++) {
    const fk = k * f0 * Math.sqrt(1 + B * k * k);
    if (fk >= nyquist) break;
    const amp0 = 0.5 * Math.exp(-0.24 * (k - 1)) * (k === 1 ? 0.62 : 0.42 / Math.pow(k, 0.55));
    const decayK = baseDecay / (1 + 0.62 * (k - 1) + 0.065 * (k - 1) * (k - 1));
    const expStep = Math.exp(-1 / (decayK * sampleRate));
    const df = 0.22 * (1 + 0.08 * k);
    const w1 = (2 * Math.PI * (fk - df)) / sampleRate;
    const w2 = (2 * Math.PI * (fk + df)) / sampleRate;
    const cos1 = Math.cos(w1), sin1 = Math.sin(w1);
    const cos2 = Math.cos(w2), sin2 = Math.sin(w2);
    let c1 = 1, s1 = 0;
    let c2 = 1, s2 = 0;
    let env = amp0;
    for (let i = 0; i < n; i++) {
      buf[i] += (s1 + s2) * env;
      env *= expStep;
      const nc1 = c1 * cos1 - s1 * sin1;
      s1 = s1 * cos1 + c1 * sin1;
      c1 = nc1;
      const nc2 = c2 * cos2 - s2 * sin2;
      s2 = s2 * cos2 + c2 * sin2;
      c2 = nc2;
    }
  }

  // Soft felt hammer transient
  const hammerLen = Math.min(Math.floor(0.018 * sampleRate), n);
  const rng = mulberry32((p.seed ^ Math.round(f0 * 10)) >>> 0);
  let hState = 0;
  for (let i = 0; i < hammerLen; i++) {
    const t = i / hammerLen;
    const white = (rng() * 2 - 1) * 0.14;
    hState += 0.08 * (white - hState);
    buf[i] += hState * (1 - t) * (1 - t);
  }

  for (let i = 0, idx = offset; i < n; i++, idx++) {
    const aEnv = i < attackSamples ? i * invAttack : 1;
    const rEnv = i >= fadeStart && invFade > 0 ? Math.max(0, 1 - (i - fadeStart) * invFade) : 1;
    out[idx] += buf[i] * aEnv * rEnv * vol * 1.15;
  }
  return n;
}

/** Karplus-Strong fractional-delay waveguide plucked string (guitar, harp, harpsichord, bass). */
function renderPluck(out, offset, p, sampleRate, n) {
  const f0 = Math.min(sampleRate * 0.35, Math.max(20, p.freq));
  // One-pole lowpass in loop adds ~0.5 sample phase delay at DC
  const exactPeriod = sampleRate / f0 - 0.5;
  const delayLen = Math.max(2, Math.floor(exactPeriod));
  const frac = Math.max(0, Math.min(0.999, exactPeriod - delayLen));
  const ring = new Float32Array(delayLen + 2);

  const bright = Number.isFinite(p.pluckBright) ? Math.max(0.05, Math.min(1, p.pluckBright)) : 0.55;
  const damp = Number.isFinite(p.damp) ? Math.max(0.15, Math.min(0.9995, p.damp)) : 0.994;
  // Scale per-cycle feedback inversely with f0 so high notes (more cycles/sec) decay at the same rate/sec
  const feedback = Math.min(0.9996, Math.pow(damp, Math.min(2.5, Math.max(0.2, 261.63 / f0))));

  const rng = mulberry32((p.seed ^ Math.round(f0 * 7)) >>> 0);
  let excLp = 0;
  let mean = 0;
  let excPeak = 0;
  for (let i = 0; i < delayLen; i++) {
    const white = rng() * 2 - 1;
    excLp += bright * (white - excLp);
    ring[i] = excLp;
    mean += excLp;
  }
  mean /= delayLen;
  for (let i = 0; i < delayLen; i++) {
    ring[i] -= mean;
    const a = Math.abs(ring[i]);
    if (a > excPeak) excPeak = a;
  }
  // Normalize initial excitation peak so soft-bright plucks (like bass/harp) stay audible at all octaves
  if (excPeak > 0.05) {
    const norm = 0.85 / excPeak;
    for (let i = 0; i < delayLen; i++) ring[i] *= norm;
  }

  // Optional 2-pole body resonance (SVF bandpass mix, unconditionally stable fCoeff <= 0.85)
  const bodyFreq = Number.isFinite(p.bodyFreq) && p.bodyFreq > 0 ? Math.min(sampleRate * 0.14, p.bodyFreq) : 0;
  const bodyF = bodyFreq > 0 ? Math.min(0.85, 2 * Math.sin((Math.PI * bodyFreq) / sampleRate)) : 0;
  const bodyQ = Number.isFinite(p.bodyQ) && p.bodyQ > 0 ? Math.max(0.45, 1 / p.bodyQ) : 0.65;
  let bLow = 0, bBand = 0;

  const fadeSamples = p.decay > 0 ? Math.min(n, Math.ceil(Math.min(p.decay, 0.25) * sampleRate)) : 0;
  const fadeStart = Math.max(0, n - fadeSamples);
  const invFade = fadeSamples > 0 ? 1 / fadeSamples : 0;
  const attackSamples = Math.min(Math.max(1, Math.floor(0.002 * sampleRate)), n);
  const invAttack = 1 / attackSamples;

  let pos = 0;
  let prev = 0;
  let allpassState = 0;
  const apCoeff = (1 - frac) / (1 + frac);
  const vol = p.vol;

  for (let i = 0, idx = offset; i < n; i++, idx++) {
    const cur = ring[pos];
    // Averaging lowpass inside the feedback loop (classic Karplus-Strong damping)
    const avg = 0.5 * (cur + prev);
    prev = cur;
    const filtered = avg * feedback;
    // First-order allpass for exact fractional tuning
    const nextSample = apCoeff * filtered + allpassState;
    allpassState = filtered - apCoeff * nextSample;
    ring[pos] = nextSample;
    pos++;
    if (pos >= delayLen) pos = 0;

    let sig = cur;
    if (bodyF > 0) {
      bLow += bodyF * bBand;
      const bHigh = sig - bLow - bodyQ * bBand;
      bBand += bodyF * bHigh;
      sig = sig * 0.8 + bBand * 0.25;
    }
    const aEnv = i < attackSamples ? i * invAttack : 1;
    const rEnv = i >= fadeStart && invFade > 0 ? Math.max(0, 1 - (i - fadeStart) * invFade) : 1;
    out[idx] += sig * aEnv * rEnv * vol * 1.1;
  }
  return n;
}

/** 2-operator FM synthesis for metallic/wooden percussion and electric piano (epiano, bell, vibraphone, marimba, musicbox, kalimba). */
function renderFm(out, offset, p, sampleRate, n) {
  const invSR = 1 / sampleRate;
  const f0 = p.freq;
  const vol = p.vol;
  const ratio = Number.isFinite(p.fmRatio) ? p.fmRatio : 2;
  const index0 = Number.isFinite(p.fmIndex) ? p.fmIndex : 2.5;
  const fmDecay = Number.isFinite(p.fmDecay) && p.fmDecay > 0 ? p.fmDecay : 0.35;
  const fmExp = Math.exp(-invSR / fmDecay);

  const aEnd = p.attack * sampleRate;
  const sEnd = aEnd + p.sustain * sampleRate;
  const aStep = aEnd > 0 ? invSR / p.attack : 0;
  const dStep = p.decay > 0 ? invSR / p.decay : Infinity;

  // Exponential decay inside the sustain/decay phase sounds far more acoustic than linear ramp
  const bodyExp = p.decay > 0 ? Math.exp(-3.2 / (p.decay * sampleRate)) : 1;
  let env = aEnd > 0 ? 0 : 1;
  let modIdx = index0;

  const cStep = f0 * invSR;
  const mStep = f0 * ratio * invSR;
  let cPhase = 0;
  let mPhase = 0;

  const hasVib = p.vibDepth !== 0 && p.vibRate !== 0;
  let vibPhase = 0;
  const vibStep = p.vibRate * invSR;

  const tremRate = Number.isFinite(p.tremRate) ? p.tremRate : 0;
  const tremDepth = Number.isFinite(p.tremDepth) ? p.tremDepth : 0;
  let tremPhase = 0;
  const tremStep = tremRate * invSR;

  const chiffLevel = p.chiff || 0;
  const chiffLen = chiffLevel > 0 ? Math.min(n, Math.floor(0.015 * sampleRate)) : 0;
  const rng = mulberry32((p.seed ^ 0x51a7) >>> 0);
  let chiffLp = 0;

  for (let i = 0, idx = offset; i < n; i++, idx++) {
    if (i < aEnd) env = Math.min(1, env + aStep);
    else if (i < sEnd) env = 1;
    else env *= bodyExp;

    let pitchMul = 1;
    if (hasVib) {
      vibPhase += vibStep;
      pitchMul += p.vibDepth * fastSin(vibPhase);
    }

    const mod = fastSin(mPhase) * (modIdx / (2 * Math.PI));
    let sig = fastSin(cPhase + mod);
    cPhase += cStep * pitchMul;
    mPhase += mStep * pitchMul;
    if (cPhase >= 1) cPhase -= Math.floor(cPhase);
    if (mPhase >= 1) mPhase -= Math.floor(mPhase);

    modIdx *= fmExp;

    if (tremDepth > 0 && tremRate > 0) {
      tremPhase += tremStep;
      sig *= 1 - tremDepth * 0.5 * (1 - fastSin(tremPhase));
    }

    sig *= env * vol;
    if (i < chiffLen) {
      const t = 1 - i / chiffLen;
      const white = rng() * 2 - 1;
      chiffLp += 0.18 * (white - chiffLp);
      sig += chiffLp * chiffLevel * t * t * vol * 0.6;
    }
    out[idx] += sig;
  }
  return n;
}

/** Dynamic SVF + formant + delayed vibrato + filtered breath/bow noise for sustained acoustic instruments. */
function renderWindBow(out, offset, p, sampleRate, n) {
  const invSR = 1 / sampleRate;
  const f0 = p.freq;
  const vol = p.vol;

  const aEnd = p.attack * sampleRate;
  const sEnd = aEnd + p.sustain * sampleRate;
  const aStep = aEnd > 0 ? invSR / p.attack : 0;
  const dStep = p.decay > 0 ? invSR / p.decay : Infinity;
  let env = aEnd > 0 ? 0 : 1;

  const h2 = p.h2 || 0, h3 = p.h3 || 0, h4 = p.h4 || 0, h5 = p.h5 || 0;
  const copies = 1 + (p.unison || 0);
  const detune = p.detune === undefined ? 10 : p.detune;
  const ratios = new Float64Array(copies);
  const phases = new Float64Array(copies);
  for (let u = 0; u < copies; u++) {
    ratios[u] = u === 0 ? 1 : Math.pow(2, ((u % 2 ? 1 : -1) * detune) / 1200);
  }
  const invAmp = 1 / ((1 + h2 + h3 + h4 + h5) * Math.sqrt(copies));

  const hasVib = p.vibDepth !== 0 && p.vibRate !== 0;
  const vibStep = p.vibRate * invSR;
  const vibDelaySamples = Number.isFinite(p.vibDelay) && p.vibDelay > 0 ? p.vibDelay * sampleRate : 0;
  let vibPhase = 0;

  // Pitch scoop on attack (expressive slide-in for erhu / violin)
  const scoop = Number.isFinite(p.scoop) ? p.scoop : 0;
  const scoopLen = scoop !== 0 ? Math.max(1, Math.floor(0.08 * sampleRate)) : 0;

  // Dynamic 2-pole State Variable Filter (2x oversampled so it stays unconditionally stable up to Nyquist)
  const baseCutoff = p.cutoff > 0 ? Math.min(sampleRate * 0.42, p.cutoff) : Math.min(sampleRate * 0.42, f0 * 7);
  const filterEnvAmt = Number.isFinite(p.filterEnv) ? p.filterEnv : 0;
  const svfQ = 0.85;
  let svfLow = 0, svfBand = 0;

  // Optional body / vowel formant resonator (unconditionally stable)
  const bodyFreq = Number.isFinite(p.bodyFreq) && p.bodyFreq > 0 ? Math.min(sampleRate * 0.14, p.bodyFreq) : 0;
  const bodyF = bodyFreq > 0 ? Math.min(0.85, 2 * Math.sin((Math.PI * bodyFreq) / sampleRate)) : 0;
  const bodyQ = Number.isFinite(p.bodyQ) && p.bodyQ > 0 ? Math.max(0.45, 1 / p.bodyQ) : 0.65;
  let bLow = 0, bBand = 0;

  // Bandpass-shaped breath/bow noise transient
  const chiff = p.chiff || 0;
  const chiffLen = chiff > 0 ? Math.min(n, Math.floor(0.065 * sampleRate)) : 0;
  const rng = mulberry32((p.seed ^ 0xbeef) >>> 0);
  let nLp = 0, nPrev = 0;

  const wave = p.wave;
  const duty = p.duty || 0.5;

  for (let i = 0, idx = offset; i < n; i++, idx++) {
    if (i < aEnd) env = Math.min(1, env + aStep);
    else if (i < sEnd) env = 1;
    else env = Math.max(0, env - dStep);

    let fi = f0;
    if (scoopLen > 0 && i < scoopLen) {
      const k = 1 - i / scoopLen;
      fi *= Math.pow(2, (scoop * k * k) / 12);
    }
    if (hasVib) {
      vibPhase += vibStep;
      const vScale = vibDelaySamples > 0 ? Math.min(1, i / vibDelaySamples) : 1;
      fi *= 1 + p.vibDepth * vScale * fastSin(vibPhase);
    }

    let v = 0;
    for (let u = 0; u < copies; u++) {
      let ph = phases[u] + fi * ratios[u] * invSR;
      if (ph >= 1) ph -= Math.floor(ph);
      phases[u] = ph;
      // Clean fundamental + rich harmonic partials using sine LUT for smooth acoustic tone
      if (wave === WAVE.TRIANGLE) {
        v += fastSin(ph);
      } else if (wave === WAVE.SQUARE) {
        // Odd-heavy mellow reed/organ wave using limited harmonics (alias-free)
        v += fastSin(ph) + (duty < 0.45 ? 0.35 * fastSin(ph * 2) : 0);
      } else {
        // Warm saw-like base with soft upper slope (first 2 terms + controlled partials)
        v += 0.72 * fastSin(ph) + 0.28 * (2 * ph - 1);
      }
      if (h2 !== 0) v += h2 * fastSin(ph * 2);
      if (h3 !== 0) v += h3 * fastSin(ph * 3);
      if (h4 !== 0) v += h4 * fastSin(ph * 4);
      if (h5 !== 0) v += h5 * fastSin(ph * 5);
    }
    v *= invAmp;

    // Dynamic 2x-oversampled SVF lowpass: brightens during attack/sustain based on envelope & filterEnvAmt
    const cut = Math.min(sampleRate * 0.42, Math.max(80, baseCutoff * (1 + filterEnvAmt * env)));
    const fCoeff = Math.min(0.95, 2 * Math.sin((Math.PI * cut) / (2 * sampleRate)));
    svfLow += fCoeff * svfBand;
    svfBand += fCoeff * (v - svfLow - svfQ * svfBand);
    svfLow += fCoeff * svfBand;
    svfBand += fCoeff * (v - svfLow - svfQ * svfBand);
    let sig = svfLow;

    if (bodyF > 0) {
      bLow += bodyF * bBand;
      const bHigh = sig - bLow - bodyQ * bBand;
      bBand += bodyF * bHigh;
      sig = sig * 0.78 + bBand * 0.28;
    }

    sig *= env * vol;
    if (i < chiffLen) {
      const k = 1 - i / chiffLen;
      const white = rng() * 2 - 1;
      nLp += 0.22 * (white - nLp);
      const bp = nLp - nPrev * 0.85;
      nPrev = nLp;
      sig += bp * chiff * k * vol * 0.45;
    }
    out[idx] += sig;
  }
  return n;
}

/** Dispatch an acoustic synthesis model into `out` at `offset` (additive). */
export function renderAcousticModel(out, offset, p, sampleRate) {
  const n = sampleBounds(out, offset, p, sampleRate);
  if (n <= 0) return 0;
  switch (p.model) {
    case 'piano': return renderPiano(out, offset, p, sampleRate, n);
    case 'pluck': return renderPluck(out, offset, p, sampleRate, n);
    case 'fm':    return renderFm(out, offset, p, sampleRate, n);
    default:      return renderWindBow(out, offset, p, sampleRate, n);
  }
}
