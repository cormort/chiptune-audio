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
  piano: { hold: false, release: 0.2, tone: 9, params: {
    wave: WAVE.SAW, h2: 0.42, h3: 0.26, h4: 0.14, h5: 0.08, unison: 1, detune: 4,
    chiff: 0.2, attack: 0.002, sustain: 0.02, decay: 2, vol: 0.46 } },
  epiano: { hold: false, release: 0.2, tone: 11, params: {
    wave: WAVE.SQUARE, duty: 0.5, h2: 0.55, h3: 0.12, h4: 0.3, h5: 0.05, unison: 1, detune: 6,
    chiff: 0.08, attack: 0.003, sustain: 0.04, decay: 1.6, vol: 0.42 } },
  organ: { hold: true, release: 0.07, tone: 10, params: {
    wave: WAVE.SQUARE, duty: 0.5, h2: 0.6, h3: 0.3, h4: 0.42, h5: 0.12,
    attack: 0.02, vibDepth: 0.004, vibRate: 6.2, vol: 0.34 } },
  strings: { hold: true, release: 0.45, tone: 7, params: {
    wave: WAVE.SAW, h2: 0.32, h3: 0.2, h4: 0.1, unison: 2, detune: 12,
    attack: 0.2, vibDepth: 0.01, vibRate: 5.2, vol: 0.4 } },
  flute: { hold: true, release: 0.15, tone: 6, params: {
    wave: WAVE.TRIANGLE, h2: 0.16, h3: 0.05, chiff: 0.3,
    attack: 0.05, vibDepth: 0.014, vibRate: 5, vol: 0.45 } },
  brass: { hold: true, release: 0.12, tone: 6, params: {
    wave: WAVE.SAW, h2: 0.45, h3: 0.3, h4: 0.18, h5: 0.1, unison: 1, detune: 7,
    chiff: 0.06, attack: 0.05, vibDepth: 0.005, vibRate: 5, vol: 0.4 } },
  guitar: { hold: false, release: null, tone: 8, params: {
    wave: WAVE.SAW, h2: 0.45, h3: 0.22, h4: 0.12, h5: 0.06, unison: 1, detune: 3,
    chiff: 0.16, attack: 0.001, sustain: 0.01, decay: 1.1, vol: 0.44 } },
  bell: { hold: false, release: null, tone: 16, params: {
    wave: WAVE.TRIANGLE, h2: 0.45, h3: 0.2, h4: 0.5, h5: 0.3,
    attack: 0.002, sustain: 0, decay: 2.4, vol: 0.5 } },
  bass: { hold: true, release: 0.1, tone: 5, params: {
    wave: WAVE.SAW, h2: 0.3, h3: 0.14, h4: 0.07, unison: 1, detune: 4,
    attack: 0.012, vol: 0.45 } },
  harp: { hold: false, release: null, tone: 9, params: {
    wave: WAVE.SAW, h2: 0.36, h3: 0.18, h4: 0.09, chiff: 0.1,
    attack: 0.002, sustain: 0.02, decay: 1.7, vol: 0.44 } },
  choir: { hold: true, release: 0.35, tone: 6, params: {
    wave: WAVE.TRIANGLE, h2: 0.28, h3: 0.18, h4: 0.09, unison: 2, detune: 16,
    attack: 0.28, vibDepth: 0.012, vibRate: 4.6, vol: 0.42 } },
  marimba: { hold: false, release: null, tone: 13, params: {
    wave: WAVE.TRIANGLE, h2: 0.22, h3: 0.05, h4: 0.45, chiff: 0.12,
    attack: 0.001, sustain: 0.004, decay: 0.8, vol: 0.5 } },

  // ---- real instruments the chip bank has no slot for ----
  // Each one is the same recipe aimed at a different body: a bowed string gets
  // a slow bow noise and a player's vibrato, a reed gets breath plus the odd
  // harmonics a cylindrical bore favours, a struck string gets a pick transient
  // and rings out. `tone` is per instrument, not per family: the violin has to
  // stay brighter than the cello at the same pitch.
  violin: { hold: true, release: 0.22, tone: 8, params: {
    wave: WAVE.SAW, h2: 0.38, h3: 0.22, h4: 0.12, h5: 0.06, unison: 1, detune: 5,
    chiff: 0.12, attack: 0.09, vibDepth: 0.012, vibRate: 5.6, vol: 0.38 } },
  cello: { hold: true, release: 0.3, tone: 5.5, params: {
    wave: WAVE.SAW, h2: 0.34, h3: 0.2, h4: 0.1, unison: 1, detune: 6,
    chiff: 0.1, attack: 0.13, vibDepth: 0.009, vibRate: 5, vol: 0.44 } },
  trumpet: { hold: true, release: 0.1, tone: 7, params: {
    wave: WAVE.SAW, h2: 0.5, h3: 0.34, h4: 0.2, h5: 0.12, unison: 1, detune: 6,
    chiff: 0.12, attack: 0.045, vibDepth: 0.004, vibRate: 5.4, vol: 0.36 } },
  sax: { hold: true, release: 0.14, tone: 6.5, params: {
    wave: WAVE.SQUARE, duty: 0.4, h2: 0.55, h3: 0.36, h4: 0.18, h5: 0.08, unison: 1, detune: 7,
    chiff: 0.24, attack: 0.05, vibDepth: 0.008, vibRate: 5, vol: 0.36 } },
  // A clarinet's bore is closed at one end, so it favours the odd harmonics —
  // that hollow fifth is what says "clarinet" rather than "organ".
  clarinet: { hold: true, release: 0.12, tone: 6, params: {
    wave: WAVE.SQUARE, duty: 0.5, h2: 0.07, h3: 0.44, h4: 0.05, h5: 0.2,
    chiff: 0.18, attack: 0.04, vibDepth: 0.005, vibRate: 4.8, vol: 0.4 } },
  // Two strings per note, plucked by a quill: bright, quick, and gone.
  harpsichord: { hold: false, release: 0.16, tone: 12, params: {
    wave: WAVE.SAW, h2: 0.5, h3: 0.3, h4: 0.2, h5: 0.1, unison: 1, detune: 9,
    chiff: 0.22, attack: 0.001, sustain: 0.01, decay: 1.3, vol: 0.42 } },
  // Metal bars with a resonator tube: the fourth harmonic is the tuning, and
  // the motor gives it a slow tremolo rather than a vibrato.
  vibraphone: { hold: false, release: null, tone: 14, params: {
    wave: WAVE.TRIANGLE, h2: 0.18, h3: 0.04, h4: 0.5, h5: 0.12,
    attack: 0.002, sustain: 0.01, decay: 2.6, vibDepth: 0.008, vibRate: 5.5, vol: 0.46 } },
  // Two strings, a snakeskin soundbox and no fingerboard: a wide expressive
  // vibrato and a lot of bow noise, which is most of what an erhu is.
  erhu: { hold: true, release: 0.24, tone: 7, params: {
    wave: WAVE.SAW, h2: 0.4, h3: 0.3, h4: 0.16, h5: 0.08, unison: 1, detune: 9,
    chiff: 0.16, attack: 0.07, vibDepth: 0.02, vibRate: 6.2, vol: 0.36 } },
  // Free reeds in pairs, badly out of tune with each other on purpose: the
  // beating between them is the instrument.
  accordion: { hold: true, release: 0.11, tone: 9, params: {
    wave: WAVE.SQUARE, duty: 0.5, h2: 0.5, h3: 0.3, h4: 0.22, h5: 0.1, unison: 1, detune: 13,
    chiff: 0.06, attack: 0.035, vibDepth: 0.003, vibRate: 5.8, vol: 0.36 } },
  // A comb of tuned steel teeth: tiny, high, and mostly fourth harmonic.
  musicbox: { hold: false, release: null, tone: 18, params: {
    wave: WAVE.TRIANGLE, h2: 0.16, h3: 0.04, h4: 0.42, h5: 0.16, chiff: 0.08,
    attack: 0.001, sustain: 0.004, decay: 1.5, vol: 0.46 } },
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
