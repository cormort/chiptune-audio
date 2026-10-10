/** Geometry for showing a performance: turn a parsed MIDI file into notes
 *  positioned on a piano keyboard, so a page can draw the falling notes and
 *  light the keys up. Nothing here touches the DOM or the audio engine, so it
 *  can be tested in Node and reused for any renderer (canvas, SVG, ...).
 */

/** The 88 keys of a real piano: A0 (21) to C8 (108). */
export const PIANO_LOW = 21;
export const PIANO_HIGH = 108;

export const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// C  C# D  D# E  F  F# G  G# A  A# B
const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];

/** Height of a black key as a fraction of the keyboard, matching the drawing. */
export const BLACK_KEY_HEIGHT = 0.62;

const clampPitch = (n) => (n < 0 ? 0 : n > 127 ? 127 : n);

/** True for the five raised keys of an octave. */
export const isBlackKey = (note) => BLACK[((Math.round(note) % 12) + 12) % 12];

/** Scientific pitch name, e.g. 60 -> "C4", 61 -> "C#4". */
export const pitchName = (note) => {
  const n = Math.round(note);
  return `${PITCH_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
};

/** Flatten a parseMidi() result into one time-sorted note list, with the same
 *  per-track settings the renderer uses (instrument, volume, mute, transpose)
 *  and the same speed, so the picture shows exactly what will be heard.
 *
 *  Returns { notes, maxDur, duration }: every note is
 *  { time, dur, note, vel, track, drum, mute, instrument } in seconds and
 *  sounding pitch (drums keep their GM key and are flagged instead).
 *  `maxDur` is the longest note, the bound needed to know how far back a note
 *  can still be sounding. */
export function flattenMidi(midi, { tracks = [], speed = 1 } = {}) {
  if (!midi || !Array.isArray(midi.tracks)) {
    throw new TypeError('flattenMidi expects the result of parseMidi()');
  }
  const rateIn = Number(speed);
  const rate = Number.isFinite(rateIn) && rateIn > 0 ? Math.min(4, Math.max(0.25, rateIn)) : 1;
  const settings = Array.isArray(tracks) ? tracks : [];
  const notes = [];
  let maxDur = 0;

  midi.tracks.forEach((track, i) => {
    const s = settings[i] || {};
    const instrument = s.instrument || track.instrument;
    const drum = instrument === 'drums';
    const volume = Number.isFinite(s.volume) ? Math.min(1, Math.max(0, s.volume)) : 1;
    const transpose = Number.isFinite(s.transpose) ? Math.round(s.transpose) : 0;
    for (const n of track.notes) {
      const dur = Math.max(0, n.dur) / rate;
      if (dur > maxDur) maxDur = dur;
      notes.push({
        time: Math.max(0, n.time) / rate,
        dur,
        note: drum ? n.note : clampPitch(n.note + transpose),
        vel: (Number.isFinite(n.vel) ? n.vel : 1) * volume,
        track: i,
        drum,
        mute: !!s.mute || volume === 0,
        instrument,
      });
    }
  });

  notes.sort((a, b) => a.time - b.time || a.note - b.note || a.track - b.track);
  return { notes, maxDur, duration: Math.max(0, Number(midi.duration) || 0) / rate };
}

/** Pitch range a piece actually uses, widened to `span` semitones so a narrow
 *  melody does not fill the canvas with two keys, and clamped to the 88 keys.
 *  Drum tracks and muted tracks are ignored — they are not played on the keys. */
export function pianoRange(notes, { low = PIANO_LOW, high = PIANO_HIGH, span = 24 } = {}) {
  const floor = Math.max(0, Math.min(127, Math.round(low)));
  const ceil = Math.max(floor, Math.min(127, Math.round(high)));
  const width = Math.max(1, Math.round(span));
  let lo = Infinity;
  let hi = -Infinity;
  for (const n of notes) {
    if (n.drum || n.mute) continue;
    if (n.note < lo) lo = n.note;
    if (n.note > hi) hi = n.note;
  }
  if (lo > hi) return { low: 48, high: 72 };   // nothing to show: C3-C5
  lo = Math.max(floor, lo);
  hi = Math.min(ceil, hi);
  if (hi - lo + 1 < width) {
    const centre = (lo + hi) / 2;
    lo = Math.round(centre - (width - 1) / 2);
    hi = lo + width - 1;
    if (lo < floor) { lo = floor; hi = floor + width - 1; }
    if (hi > ceil) { hi = ceil; lo = ceil - width + 1; }
  }
  return { low: lo, high: hi };
}

/** Where each key sits horizontally. White keys tile the full width (a real
 *  keyboard has no gaps); a black key straddles the boundary between the two
 *  white keys it sits between, so it is centred on it and drawn narrower.
 *
 *  Returns { keys, whiteCount, whiteWidth, blackWidth }, `keys` being a Map of
 *  note -> { note, black, x, w }. */
export function pianoLayout(low, high, width, { blackRatio = 0.62 } = {}) {
  const floor = clampPitch(Math.round(low));
  const ceil = clampPitch(Math.round(high));
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const ratio = Number.isFinite(blackRatio) ? Math.min(0.95, Math.max(0.2, blackRatio)) : 0.62;

  let whiteCount = 0;
  for (let n = floor; n <= ceil; n++) if (!isBlackKey(n)) whiteCount++;
  const whiteWidth = whiteCount ? w / whiteCount : w;
  const blackWidth = whiteWidth * ratio;

  const keys = new Map();
  let whitesSoFar = 0;
  for (let n = floor; n <= ceil; n++) {
    if (isBlackKey(n)) {
      keys.set(n, { note: n, black: true, x: whitesSoFar * whiteWidth - blackWidth / 2, w: blackWidth });
    } else {
      keys.set(n, { note: n, black: false, x: whitesSoFar * whiteWidth, w: whiteWidth });
      whitesSoFar++;
    }
  }
  return { keys, whiteCount, whiteWidth, blackWidth };
}

/** Index of the first note starting after `time` (notes must be time-sorted),
 *  i.e. the start of the visible window when drawing forward. */
export function noteIndexAfter(notes, time) {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].time <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Every note sounding at `time` — started at or before it and not yet over.
 *  `maxDur` (from flattenMidi) bounds the backward scan, so a long piece costs
 *  a handful of steps per call instead of a full scan: this runs once a frame.
 *  Notes are returned newest-first. */
export function notesSoundingAt(notes, time, maxDur = 0) {
  const out = [];
  // Without the bound the scan would have to walk every earlier note: correct,
  // but only worth it for a caller that has no maxDur at hand.
  const bound = Number.isFinite(maxDur) && maxDur > 0 ? maxDur : Infinity;
  for (let i = noteIndexAfter(notes, time) - 1; i >= 0; i--) {
    const n = notes[i];
    if (n.time + bound <= time) break;
    if (n.time + n.dur > time) out.push(n);
  }
  return out;
}

/** Which key is under `x` (in the same pixel space as pianoLayout) at `y`
 *  within a keyboard `height`: black keys are drawn on top, so they win when
 *  they overlap. Returns the note, or null outside the keyboard. */
export function keyAt(layout, x, y, height) {
  if (!(y >= 0) || y > height || !(x >= 0)) return null;
  let hit = null;
  for (const k of layout.keys.values()) {
    if (x < k.x || x >= k.x + k.w) continue;
    if (k.black) {
      if (y <= height * BLACK_KEY_HEIGHT) return k.note;   // black keys sit on top
      continue;
    }
    hit = k.note;
  }
  return hit;
}
