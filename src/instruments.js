import { WAVE } from './sfx.js';

/** Melodic instruments, shared by the keyboard (`playNote`) and the MIDI
 *  renderer. `params` are SFX params without `freq`, which comes from the note.
 *
 *  - `hold: true`  the note sustains for as long as it is held (key down, or the
 *                  MIDI note length) and fades over `release` seconds after.
 *  - `hold: false` the note plays its own envelope; `release` is the fade used
 *                  when a held key is let go early (a piano damper), or null to
 *                  let it ring out (bell, pluck). */
export const INSTRUMENTS = {
  square:   { hold: true, release: 0.06, params: { wave: WAVE.SQUARE, duty: 0.5, attack: 0.005, vol: 0.3 } },
  pulse25:  { hold: true, release: 0.06, params: { wave: WAVE.SQUARE, duty: 0.25, attack: 0.005, vol: 0.3 } },
  pulse12:  { hold: true, release: 0.06, params: { wave: WAVE.SQUARE, duty: 0.125, attack: 0.005, vol: 0.3 } },
  triangle: { hold: true, release: 0.05, params: { wave: WAVE.TRIANGLE, attack: 0.005, vol: 0.55 } },
  saw:      { hold: true, release: 0.06, params: { wave: WAVE.SAW, attack: 0.005, vol: 0.25 } },
  organ:    { hold: true, release: 0.08, params: { wave: WAVE.SQUARE, duty: 0.25, attack: 0.01, vibDepth: 0.006, vibRate: 6, vol: 0.28 } },
  flute:    { hold: true, release: 0.12, params: { wave: WAVE.TRIANGLE, attack: 0.05, vibDepth: 0.012, vibRate: 5, vol: 0.55 } },
  strings:  { hold: true, release: 0.35, params: { wave: WAVE.SAW, attack: 0.15, vibDepth: 0.008, vibRate: 5.5, vol: 0.22 } },
  brass:    { hold: true, release: 0.1, params: { wave: WAVE.SAW, attack: 0.04, bits: 5, vibDepth: 0.004, vibRate: 5, vol: 0.25 } },
  piano:    { hold: false, release: 0.15, params: { wave: WAVE.SQUARE, duty: 0.5, attack: 0.002, sustain: 0.04, decay: 1.2, vol: 0.32 } },
  pluck:    { hold: false, release: null, params: { wave: WAVE.SQUARE, duty: 0.125, attack: 0.002, sustain: 0.01, decay: 0.45, vol: 0.32 } },
  bell:     { hold: false, release: null, params: { wave: WAVE.TRIANGLE, attack: 0.002, sustain: 0, decay: 1.6, vibDepth: 0.003, vibRate: 30, bits: 4, vol: 0.55 } },
};

/** The chip bank's twelve slots voiced as acoustic instruments instead of chip
 *  waves — what the keyboard's 寫實 (realistic) mode plays and what `real:<name>`
 *  selects in a MIDI remix.
 *
 *  Realism here is synthesis, not samples: this stays a zero-dependency library,
 *  so instead of recording a piano the voice is built from the timbre params —
 *  additive harmonics (h2..h5), one or two detuned copies (unison/detune), an
 *  attack transient (chiff, the hammer/breath/pick noise) and a per-voice
 *  lowpass (cutoff). `tone` is that cutoff expressed as a multiple of the note
 *  frequency, so brightness tracks pitch instead of muffling the top octave.
 *
 *  The first twelve keep the chip bank's keys, so `piano` means a piano in
 *  either one and switching banks on the keyboard keeps the same instrument
 *  under the cursor. The rest are real instruments the chip bank has no slot
 *  for (a violin is not a saw wave), so this bank is a superset: every chip key
 *  resolves here, and the extras resolve as `real:<name>` only. */
export const REALISTIC_INSTRUMENTS = {
  piano: { hold: false, release: 0.2, params: {
    model: 'piano', attack: 0.002, sustain: 0.02, decay: 2.2, vol: 0.5 } },
  epiano: { hold: false, release: 0.22, params: {
    model: 'fm', fmRatio: 14, fmIndex: 1.8, fmDecay: 0.28, tremRate: 4.5, tremDepth: 0.14,
    chiff: 0.06, attack: 0.002, sustain: 0.05, decay: 1.8, vol: 0.45 } },
  organ: { hold: true, release: 0.07, tone: 10, params: {
    model: 'wind', wave: WAVE.TRIANGLE, h2: 0.65, h3: 0.35, h4: 0.48, h5: 0.15,
    attack: 0.015, vibDepth: 0.003, vibRate: 6.2, vibDelay: 0.15, vol: 0.38 } },
  strings: { hold: true, release: 0.45, tone: 7.5, params: {
    model: 'bow', wave: WAVE.SAW, h2: 0.36, h3: 0.22, h4: 0.12, unison: 2, detune: 11,
    bodyFreq: 420, bodyQ: 1.4, filterEnv: 0.35,
    attack: 0.16, vibDepth: 0.01, vibRate: 5.2, vibDelay: 0.25, vol: 0.44 } },
  flute: { hold: true, release: 0.14, tone: 6, params: {
    model: 'flute', wave: WAVE.TRIANGLE, h2: 0.22, h3: 0.07, chiff: 0.35, filterEnv: 0.25,
    attack: 0.045, vibDepth: 0.013, vibRate: 5.1, vibDelay: 0.22, vol: 0.48 } },
  brass: { hold: true, release: 0.12, tone: 5, params: {
    model: 'brass', wave: WAVE.SAW, h2: 0.55, h3: 0.38, h4: 0.22, h5: 0.12, unison: 1, detune: 7,
    filterEnv: 1.15, bodyFreq: 520, bodyQ: 1.2, chiff: 0.08,
    attack: 0.045, vibDepth: 0.004, vibRate: 5.0, vibDelay: 0.25, vol: 0.42 } },
  guitar: { hold: false, release: null, params: {
    model: 'pluck', pluckBright: 0.52, damp: 0.9945, bodyFreq: 195, bodyQ: 1.6,
    attack: 0.001, sustain: 0.01, decay: 1.5, vol: 0.52 } },
  bell: { hold: false, release: null, params: {
    model: 'fm', fmRatio: 3.5, fmIndex: 4.2, fmDecay: 0.65,
    attack: 0.001, sustain: 0, decay: 2.4, vol: 0.48 } },
  bass: { hold: true, release: 0.1, params: {
    model: 'pluck', pluckBright: 0.34, damp: 0.9965, bodyFreq: 110, bodyQ: 1.3,
    attack: 0.002, vol: 0.55 } },
  harp: { hold: false, release: null, params: {
    model: 'pluck', pluckBright: 0.42, damp: 0.996, bodyFreq: 260, bodyQ: 1.2,
    attack: 0.001, sustain: 0.01, decay: 1.9, vol: 0.52 } },
  choir: { hold: true, release: 0.35, tone: 5.5, params: {
    model: 'choir', wave: WAVE.TRIANGLE, h2: 0.34, h3: 0.22, h4: 0.14, unison: 2, detune: 15,
    bodyFreq: 680, bodyQ: 2.2, filterEnv: 0.25,
    attack: 0.22, vibDepth: 0.012, vibRate: 4.8, vibDelay: 0.3, vol: 0.46 } },
  marimba: { hold: false, release: null, params: {
    model: 'fm', fmRatio: 4.0, fmIndex: 1.25, fmDecay: 0.14, chiff: 0.16,
    attack: 0.001, sustain: 0.004, decay: 0.9, vol: 0.54 } },

  // ---- real instruments the chip bank has no slot for ----
  violin: { hold: true, release: 0.22, tone: 7.5, params: {
    model: 'bow', wave: WAVE.SAW, h2: 0.42, h3: 0.25, h4: 0.14, h5: 0.08, unison: 1, detune: 4,
    bodyFreq: 480, bodyQ: 1.7, filterEnv: 0.45, scoop: -0.35, chiff: 0.16,
    attack: 0.08, vibDepth: 0.013, vibRate: 5.6, vibDelay: 0.2, vol: 0.44 } },
  cello: { hold: true, release: 0.3, tone: 5.2, params: {
    model: 'bow', wave: WAVE.SAW, h2: 0.38, h3: 0.22, h4: 0.11, unison: 1, detune: 5,
    bodyFreq: 210, bodyQ: 1.6, filterEnv: 0.4, scoop: -0.25, chiff: 0.14,
    attack: 0.11, vibDepth: 0.01, vibRate: 5.0, vibDelay: 0.22, vol: 0.48 } },
  trumpet: { hold: true, release: 0.1, tone: 5.5, params: {
    model: 'brass', wave: WAVE.SAW, h2: 0.62, h3: 0.44, h4: 0.26, h5: 0.15, unison: 1, detune: 5,
    filterEnv: 1.3, bodyFreq: 900, bodyQ: 1.3, chiff: 0.12,
    attack: 0.038, vibDepth: 0.006, vibRate: 5.4, vibDelay: 0.25, vol: 0.42 } },
  sax: { hold: true, release: 0.14, tone: 5.5, params: {
    model: 'reed', wave: WAVE.SQUARE, duty: 0.38, h2: 0.55, h3: 0.38, h4: 0.22, h5: 0.1, unison: 1, detune: 6,
    filterEnv: 0.9, bodyFreq: 580, bodyQ: 1.5, chiff: 0.22,
    attack: 0.042, vibDepth: 0.009, vibRate: 5.1, vibDelay: 0.2, vol: 0.42 } },
  clarinet: { hold: true, release: 0.12, tone: 5.2, params: {
    model: 'reed', wave: WAVE.SQUARE, duty: 0.5, h2: 0.08, h3: 0.52, h4: 0.05, h5: 0.26,
    filterEnv: 0.45, bodyFreq: 440, bodyQ: 1.3, chiff: 0.18,
    attack: 0.035, vibDepth: 0.005, vibRate: 4.8, vibDelay: 0.22, vol: 0.46 } },
  harpsichord: { hold: false, release: 0.16, params: {
    model: 'pluck', pluckBright: 0.88, damp: 0.9935, bodyFreq: 650, bodyQ: 1.1,
    attack: 0.001, sustain: 0.01, decay: 1.4, vol: 0.5 } },
  vibraphone: { hold: false, release: null, params: {
    model: 'fm', fmRatio: 4.0, fmIndex: 0.9, fmDecay: 0.22, tremRate: 5.6, tremDepth: 0.28,
    attack: 0.002, sustain: 0.01, decay: 2.5, vol: 0.5 } },
  erhu: { hold: true, release: 0.24, tone: 6.2, params: {
    model: 'bow', wave: WAVE.SAW, h2: 0.46, h3: 0.34, h4: 0.18, h5: 0.09, unison: 1, detune: 6,
    bodyFreq: 960, bodyQ: 2.1, filterEnv: 0.55, scoop: -0.65, chiff: 0.2,
    attack: 0.065, vibDepth: 0.02, vibRate: 6.2, vibDelay: 0.18, vol: 0.44 } },
  accordion: { hold: true, release: 0.11, tone: 8.5, params: {
    model: 'reed', wave: WAVE.SQUARE, duty: 0.44, h2: 0.52, h3: 0.32, h4: 0.22, h5: 0.12, unison: 1, detune: 13,
    filterEnv: 0.25, chiff: 0.06,
    attack: 0.03, vibDepth: 0.003, vibRate: 5.8, vol: 0.42 } },
  musicbox: { hold: false, release: null, params: {
    model: 'fm', fmRatio: 5.04, fmIndex: 2.1, fmDecay: 0.18, chiff: 0.08,
    attack: 0.001, sustain: 0.004, decay: 1.6, vol: 0.5 } },
  kalimba: { hold: false, release: null, params: {
    model: 'fm', fmRatio: 6.27, fmIndex: 0.75, fmDecay: 0.06, chiff: 0.26,
    attack: 0.001, sustain: 0.005, decay: 2.3, vol: 0.52 } },
};

/** The two banks the pages switch between. */
export const INSTRUMENT_BANKS = { chip: INSTRUMENTS, real: REALISTIC_INSTRUMENTS };

/** Chinese labels for every slot in both banks. */
export const INSTRUMENT_LABELS = {
  chip: {
    square: '方波', pulse25: '脈衝 25%', pulse12: '脈衝 12.5%', triangle: '三角波', saw: '鋸齒波',
    organ: '風琴', flute: '長笛', strings: '弦樂', brass: '銅管', piano: '鋼琴', pluck: '撥弦', bell: '鐘聲',
  },
  real: {
    piano: '鋼琴', epiano: '電鋼琴', organ: '管風琴', strings: '弦樂', flute: '長笛', brass: '銅管',
    guitar: '吉他', bell: '鐘琴', bass: '貝斯', harp: '豎琴', choir: '合唱', marimba: '木琴',
    violin: '小提琴', cello: '大提琴', trumpet: '小號', sax: '薩克斯風', clarinet: '單簧管',
    harpsichord: '大鍵琴', vibraphone: '顫音琴', erhu: '二胡', accordion: '手風琴', musicbox: '音樂盒',
    kalimba: '卡林巴琴',
  },
};

/** Sustain rendered for a held keyboard note; it is cut short on release. */
export const HOLD_SECONDS = 2.5;

export const noteFreq = (note) => 440 * 2 ** ((note - 69) / 12);

/** Find an instrument in either bank. Accepts a bare name (looked up in `bank`,
 *  default 'chip'), an explicit `real:piano` / `chip:saw`, and 'drums', which is
 *  not an instrument here. Returns { name, bank, spec } or null. */
export function resolveInstrument(name, bank = 'chip') {
  if (typeof name !== 'string') return null;
  const at = name.indexOf(':');
  const b = at > 0 ? name.slice(0, at) : bank;
  const n = at > 0 ? name.slice(at + 1) : name;
  const spec = INSTRUMENT_BANKS[b] && INSTRUMENT_BANKS[b][n];
  return spec ? { name: n, bank: b, spec } : null;
}

/** Every selectable name, `real:` ones included, for error messages. */
export function instrumentNames() {
  return [
    ...Object.keys(INSTRUMENTS),
    ...Object.keys(REALISTIC_INSTRUMENTS).map((n) => `real:${n}`),
  ];
}

/** SFX params for one note. `seconds` is how long the note is held; omit it for
 *  a keyboard note whose length is not known yet (renders HOLD_SECONDS).
 *  `bank` picks the chip or the realistic voicing; a `real:` prefix in `name`
 *  overrides it. */
export function instrumentNote(name, note, { seconds, vel = 1, bank = 'chip' } = {}) {
  const found = resolveInstrument(name, bank);
  if (!found) {
    throw new Error(`Unknown instrument: ${name} (expected one of ${instrumentNames().join(', ')}, or drums)`);
  }
  const { spec } = found;
  const p = { ...spec.params, freq: noteFreq(note) };
  p.vol = (p.vol ?? 0.5) * vel;
  // An acoustic model also changes timbre with velocity (soft = darker).
  if (p.model) p.vel = vel;
  // A realistic bank entry sets `tone` (cutoff / note frequency) rather than a
  // fixed cutoff, so the top of the keyboard does not go dull.
  if (spec.tone) p.cutoff = Math.min(20000, p.freq * spec.tone);
  if (spec.hold) {
    const held = seconds === undefined ? HOLD_SECONDS : seconds;
    p.sustain = Math.max(0, held - (p.attack ?? 0));
    p.decay = spec.release;
  }
  return p;
}

/** Fade used when a held key is released, or null when the note rings out on its
 *  own. Accepts the same names as instrumentNote. */
export function instrumentRelease(name, bank = 'chip') {
  const found = resolveInstrument(name, bank);
  return found ? found.spec.release : null;
}
