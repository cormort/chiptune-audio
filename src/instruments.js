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

/** Sustain rendered for a held keyboard note; it is cut short on release. */
export const HOLD_SECONDS = 2.5;

export const noteFreq = (note) => 440 * 2 ** ((note - 69) / 12);

/** SFX params for one note. `seconds` is how long the note is held; omit it for
 *  a keyboard note whose length is not known yet (renders HOLD_SECONDS). */
export function instrumentNote(name, note, { seconds, vel = 1 } = {}) {
  const inst = INSTRUMENTS[name];
  if (!inst) throw new Error(`Unknown instrument: ${name} (expected one of ${Object.keys(INSTRUMENTS).join(', ')})`);
  const p = { ...inst.params, freq: noteFreq(note) };
  p.vol = (p.vol ?? 0.5) * vel;
  if (inst.hold) {
    const held = seconds === undefined ? HOLD_SECONDS : seconds;
    p.sustain = Math.max(0, held - (p.attack ?? 0));
    p.decay = inst.release;
  }
  return p;
}
