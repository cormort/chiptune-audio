import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMidi, PIANO_LOW, PIANO_HIGH, isBlackKey, pitchName, flattenMidi, pianoRange, pianoLayout,
  noteIndexAfter, notesSoundingAt, keyAt,
} from '../src/index.js';

import { track, smf, tempo } from './smf.js';

// A MIDI object shaped like parseMidi()'s output: the piano helpers take it
// directly, so most tests do not need to build a byte-level file.
const midi = (tracks, duration = 4) => ({ duration, tracks });

test('flattenMidi: speed, transpose, volume and mute match what is rendered', () => {
  const flat = flattenMidi(midi([
    { name: 'Lead', channel: 0, program: 0, instrument: 'square', notes: [
      { time: 1, dur: 0.5, note: 60, vel: 1 },
      { time: 0, dur: 0.25, note: 64, vel: 0.5 },
    ] },
    { name: 'Bass', channel: 1, program: 33, instrument: 'triangle', notes: [
      { time: 0, dur: 2, note: 36, vel: 1 },
    ] },
  ]), {
    speed: 2,
    tracks: [{ transpose: 12, volume: 0.5 }, { mute: true }],
  });

  assert.equal(flat.notes.length, 3);
  assert.deepEqual(flat.notes.map((n) => n.time), [0, 0, 0.5], 'sorted by time, halved by speed 2');
  const lead = flat.notes.filter((n) => n.track === 0);
  assert.deepEqual(lead.map((n) => n.note), [76, 72], 'transposed an octave up');
  assert.deepEqual(lead.map((n) => n.vel), [0.25, 0.5], 'velocity scaled by the track volume');
  assert.deepEqual(lead.map((n) => n.dur), [0.125, 0.25]);
  const bass = flat.notes[0];
  assert.equal(bass.track, 1);
  assert.equal(bass.mute, true);
  assert.equal(bass.note, 36, 'a muted track keeps its pitch, only flagged');
  assert.equal(flat.maxDur, 1, '2 s bass / speed 2');
  assert.equal(flat.duration, 2);
});

test('flattenMidi: drums keep their GM key and their own flag', () => {
  const flat = flattenMidi(midi([
    { name: 'Kit', channel: 9, program: 0, instrument: 'drums', notes: [{ time: 0, dur: 0.1, note: 36, vel: 0.9 }] },
  ]), { tracks: [{ transpose: 12 }] });
  assert.equal(flat.notes[0].drum, true);
  assert.equal(flat.notes[0].note, 36, 'a drum is not transposed');
  assert.equal(flat.notes[0].vel, 0.9);
});

test('flattenMidi: rejects anything that is not parseMidi() output', () => {
  assert.throws(() => flattenMidi(null), TypeError);
  assert.throws(() => flattenMidi({ duration: 1 }), TypeError);
  assert.throws(() => flattenMidi([1, 2]), TypeError);
});

test('flattenMidi: reads a real file end to end', () => {
  const bytes = smf(1, 480, [
    track([[0, ...tempo(500000)]]),
    track([[0, 0xc0, 40], [0, 0x90, 60, 100], [480, 0x80, 60, 0]]),
  ]);
  const parsed = parseMidi(bytes);
  const flat = flattenMidi(parsed, { tracks: [{ instrument: 'saw', transpose: -12 }] });
  assert.equal(flat.notes.length, 1);
  assert.equal(flat.notes[0].note, 48, 'C3 after the transpose');
  assert.equal(flat.notes[0].instrument, 'saw');
  assert.ok(Math.abs(flat.notes[0].time) < 1e-9);
  assert.ok(Math.abs(flat.notes[0].dur - 0.5) < 1e-9, 'one beat at 120 BPM');
  assert.ok(Math.abs(flat.duration - 0.5) < 1e-9);
});

test('pianoRange: covers the piece, ignores drums and muted tracks, clamps to 88 keys', () => {
  const notes = [
    { note: 60, drum: false, mute: false },
    { note: 67, drum: false, mute: false },
    { note: 20, drum: true, mute: false },      // drum keys must not drag the range down
    { note: 12, drum: false, mute: true },      // silent track
  ];
  const r = pianoRange(notes);
  assert.ok(r.low <= 60 && r.high >= 67, `covers the played notes: ${r.low}-${r.high}`);
  assert.equal(r.high - r.low + 1, 24, 'widened to the minimum span');
  assert.deepEqual(pianoRange([]), { low: 48, high: 72 });
  assert.deepEqual(pianoRange([{ note: 0, drum: false, mute: false }]), { low: PIANO_LOW, high: PIANO_LOW + 23 });
  assert.deepEqual(pianoRange([{ note: 127, drum: false, mute: false }]), { low: PIANO_HIGH - 23, high: PIANO_HIGH });
  const wide = pianoRange([{ note: 21, drum: false, mute: false }, { note: 108, drum: false, mute: false }], { span: 88 });
  assert.deepEqual(wide, { low: PIANO_LOW, high: PIANO_HIGH });
});

test('pianoLayout: white keys tile the width, black keys straddle the boundary', () => {
  const { keys, whiteCount, whiteWidth } = pianoLayout(60, 72, 700);   // C4..C5
  assert.equal(whiteCount, 8);
  assert.equal(whiteWidth, 700 / 8);
  const c4 = keys.get(60);
  assert.equal(c4.black, false);
  assert.equal(c4.x, 0);
  const c5 = keys.get(72);
  assert.equal(c5.x + c5.w, 700, 'the last white key ends exactly at the right edge');
  const cSharp = keys.get(61);
  assert.equal(cSharp.black, true);
  assert.ok(Math.abs((cSharp.x + cSharp.w / 2) - whiteWidth) < 1e-9, 'centred on the C4/D4 boundary');
  assert.ok(cSharp.w < whiteWidth);
  for (let n = 60; n <= 72; n++) assert.ok(keys.has(n), `key ${n} is missing`);
});

test('keyAt: black keys win where they overlap, white keys elsewhere, null off the keyboard', () => {
  const layout = pianoLayout(60, 72, 700);
  const height = 60;
  assert.equal(keyAt(layout, 1, height - 1, height), 60, 'top of the keyboard: C4 white key');
  assert.equal(keyAt(layout, 1, 1, height), 60, 'just under the top edge of the keyboard');
  assert.equal(keyAt(layout, 1, -4, height), null, 'above the keyboard (in the roll)');
  const cSharp = layout.keys.get(61);
  assert.equal(keyAt(layout, cSharp.x + cSharp.w / 2, height * 0.3, height), 61, 'the black key covers the top');
  assert.equal(keyAt(layout, cSharp.x + cSharp.w / 2, height - 1, height), 62, 'below the black key, D4 shows');
  assert.equal(keyAt(layout, 5000, 10, height), null, 'past the right edge');
});

test('notesSoundingAt: only notes that have started and not finished', () => {
  const { notes, maxDur } = flattenMidi(midi([
    { name: 'A', channel: 0, program: 0, instrument: 'square', notes: [
      { time: 0, dur: 1, note: 60, vel: 1 },       // sounds 0..1
      { time: 0.5, dur: 2, note: 64, vel: 1 },     // sounds 0.5..2.5
      { time: 3, dur: 0.5, note: 67, vel: 1 },     // sounds 3..3.5
    ] },
  ]));
  assert.equal(maxDur, 2);
  assert.deepEqual(notesSoundingAt(notes, 0, maxDur).map((n) => n.note), [60]);
  assert.deepEqual(notesSoundingAt(notes, 0.9, maxDur).map((n) => n.note), [64, 60], 'newest first');
  assert.deepEqual(notesSoundingAt(notes, 2.6, maxDur), []);
  assert.deepEqual(notesSoundingAt(notes, 3.2, maxDur).map((n) => n.note), [67]);
  assert.deepEqual(notesSoundingAt(notes, 0.2, maxDur).map((n) => n.note), [60]);
  assert.deepEqual(notesSoundingAt(notes, 0.2).map((n) => n.note), [60], 'still right without maxDur');
});

test('notesSoundingAt: the maxDur bound never changes the answer', () => {
  const notes = [
    { time: 0, dur: 8, note: 40, vel: 1 },
    { time: 7.5, dur: 0.1, note: 41, vel: 1 },
    { time: 7.9, dur: 0.2, note: 42, vel: 1 },
  ];
  const at = 7.95;   // the 0..8 note is still ringing; 7.5..7.6 already finished
  const fast = notesSoundingAt(notes, at, 8).map((n) => n.note);
  const slow = notesSoundingAt(notes, at).map((n) => n.note);
  assert.deepEqual(fast, slow);
  assert.deepEqual(fast, [42, 40], 'the long note is still ringing');
  assert.deepEqual(notesSoundingAt(notes, 8, 8).map((n) => n.note), [42], 'a note ending exactly now is over');
});

test('noteIndexAfter: binary search over the note list', () => {
  const notes = [{ time: 0 }, { time: 1 }, { time: 1 }, { time: 4 }];
  assert.equal(noteIndexAfter(notes, -1), 0);
  assert.equal(noteIndexAfter(notes, 0), 1);
  assert.equal(noteIndexAfter(notes, 1), 3, 'past both notes that start at 1');
  assert.equal(noteIndexAfter(notes, 3.9), 3);
  assert.equal(noteIndexAfter(notes, 4), 4);
  assert.equal(noteIndexAfter([], 5), 0);
});

test('isBlackKey / pitchName: standard names over the whole piano', () => {
  assert.deepEqual([60, 61, 62, 63, 64, 65, 66].map(isBlackKey), [false, true, false, true, false, false, true]);
  assert.equal(isBlackKey(0), false);
  assert.equal(isBlackKey(-1), false, 'negative degrees must not read past the table');
  assert.equal(pitchName(60), 'C4');
  assert.equal(pitchName(61), 'C#4');
  assert.equal(pitchName(PIANO_LOW), 'A0');
  assert.equal(pitchName(PIANO_HIGH), 'C8');
  assert.equal(pitchName(0), 'C-1');
});
