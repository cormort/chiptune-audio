import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMidi, renderMidi, INSTRUMENTS, instrumentNote, noteFreq, renderSfx, HOLD_SECONDS, SAMPLE_RATE, MAX_MIDI_SECONDS,
} from '../src/index.js';

// ---- tiny SMF writer, so the tests need no binary fixtures
const vlq = (n) => {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
};
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >> 8) & 255, n & 255];
const track = (events) => {
  const body = [];
  for (const [delta, ...bytes] of events) body.push(...vlq(delta), ...bytes);
  body.push(0, 0xff, 0x2f, 0);
  return [...'MTrk'].map((c) => c.charCodeAt(0)).concat(u32(body.length), body);
};
const smf = (format, division, tracks) => new Uint8Array(
  [...'MThd'].map((c) => c.charCodeAt(0)).concat(u32(6), u16(format), u16(tracks.length), u16(division), ...tracks),
);
const name = (s) => [0xff, 0x03, s.length, ...[...s].map((c) => c.charCodeAt(0))];
const tempo = (us) => [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255];

test('parseMidi: format 1, tempo map, running status, velocity-0 note off', () => {
  const conductor = track([[0, ...tempo(500000)], [1440, ...tempo(250000)]]); // 120 BPM, then 240 from beat 3
  const melody = track([
    [0, ...name('Lead')],
    [0, 0xc0, 80],                  // program change
    [0, 0x90, 60, 100],             // C4 on
    [480, 60, 0],                   // running status, velocity 0 = off (0.5 s)
    [480, 0x90, 64, 127],           // E4 at beat 2 (1.0 s)
    [960, 0x80, 64, 0],             // off at beat 4: 1 beat @120 + 1 beat @240 = 0.5+0.25
  ]);
  const drums = track([[0, 0x99, 36, 90], [240, 0x89, 36, 0]]);
  const midi = parseMidi(smf(1, 480, [conductor, melody, drums]));

  assert.equal(midi.tracks.length, 2, 'the conductor track has no notes');
  const [lead, kit] = midi.tracks;
  assert.equal(lead.name, 'Lead');
  assert.equal(lead.program, 80);
  assert.deepEqual(lead.notes.map((n) => n.note), [60, 64]);
  assert.ok(Math.abs(lead.notes[0].dur - 0.5) < 1e-9);
  assert.ok(Math.abs(lead.notes[1].time - 1.0) < 1e-9);
  assert.ok(Math.abs(lead.notes[1].dur - 0.75) < 1e-9, `tempo change mid-note: ${lead.notes[1].dur}`);
  assert.ok(Math.abs(lead.notes[0].vel - 100 / 127) < 1e-9);
  assert.equal(kit.channel, 9);
  assert.equal(kit.instrument, 'drums');
  assert.ok(Math.abs(midi.duration - 1.75) < 1e-9);
});

test('parseMidi: format 0 splits channels into separate parts', () => {
  const midi = parseMidi(smf(0, 96, [track([
    [0, 0x90, 72, 100], [0, 0x91, 36, 100], [96, 0x80, 72, 0], [0, 0x81, 36, 0],
  ])]));
  assert.deepEqual(midi.tracks.map((t) => t.channel), [0, 1]);
  assert.equal(midi.tracks[1].instrument, 'triangle', 'a low part defaults to the triangle bass');
});

test('parseMidi: notes never switched off end with their track', () => {
  const midi = parseMidi(smf(0, 96, [track([[0, 0x90, 60, 100], [192, 0xff, 0x01, 0]])]));
  assert.equal(midi.tracks[0].notes.length, 1);
  assert.ok(Math.abs(midi.tracks[0].notes[0].dur - 1) < 1e-9);
});

test('parseMidi rejects malformed input with an Error, never a hang', () => {
  assert.throws(() => parseMidi(new Uint8Array([1, 2, 3])), /Invalid MIDI/);
  assert.throws(() => parseMidi(new TextEncoder().encode('RIFF....WAVEfmt ')), /Invalid MIDI/);
  const good = smf(0, 96, [track([[0, 0x90, 60, 100], [96, 0x80, 60, 0]])]);
  for (let cut = 1; cut < good.length - 4; cut++) {
    assert.throws(() => parseMidi(good.subarray(0, cut)), Error, `truncated at ${cut}`);
  }
  assert.throws(() => parseMidi('nope'), TypeError);
});

test('renderMidi: length, peak, mute, speed and overrides', () => {
  const midi = parseMidi(smf(1, 480, [
    track([[0, ...tempo(500000)]]),
    track([[0, 0x90, 60, 127], [960, 0x80, 60, 0], [0, 0x90, 67, 127], [960, 0x80, 67, 0]]),
    track([[0, 0x99, 36, 127], [480, 0x89, 36, 0], [0, 0x99, 38, 127], [480, 0x89, 38, 0]]),
  ]));
  const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const full = renderMidi(midi);
  assert.equal(full.length, Math.ceil((midi.duration + 1.5) * SAMPLE_RATE));
  assert.ok(peak(full) > 0.1 && peak(full) <= 0.9 + 1e-6);
  assert.equal(peak(renderMidi(midi, { tracks: [{ mute: true }, { volume: 0 }] })), 0);
  const fast = renderMidi(midi, { speed: 2 });
  assert.equal(fast.length, Math.ceil((midi.duration / 2 + 1.5) * SAMPLE_RATE));
  for (const instrument of Object.keys(INSTRUMENTS)) {
    assert.ok(peak(renderMidi(midi, { tracks: [{ instrument }] })) > 0.05, instrument);
  }
  assert.throws(() => renderMidi(midi, { tracks: [{ instrument: 'kazoo' }] }), /Unknown instrument/);
  assert.throws(() => renderMidi(null), TypeError);
});

test('renderMidi caps very long files instead of allocating without limit', () => {
  const midi = { duration: 36000, tracks: [{ instrument: 'square', notes: [{ time: 35000, dur: 1, note: 60, vel: 1 }] }] };
  assert.equal(renderMidi(midi, { sampleRate: 8000 }).length, MAX_MIDI_SECONDS * 8000);
});

test('instruments: held notes follow the note length, others keep their envelope', () => {
  assert.equal(noteFreq(69), 440);
  const held = instrumentNote('organ', 60, { seconds: 1 });
  assert.ok(Math.abs(held.attack + held.sustain - 1) < 1e-9);
  assert.equal(held.decay, INSTRUMENTS.organ.release);
  assert.ok(Math.abs(instrumentNote('square', 60).sustain - (HOLD_SECONDS - 0.005)) < 1e-9, 'keyboard default');
  assert.equal(instrumentNote('bell', 60, { seconds: 5 }).decay, INSTRUMENTS.bell.params.decay);
  assert.ok(Math.abs(instrumentNote('square', 60, { vel: 0.5 }).vol - INSTRUMENTS.square.params.vol / 2) < 1e-12);
  for (const k of Object.keys(INSTRUMENTS)) {
    const pcm = renderSfx(instrumentNote(k, 60, { seconds: 0.3 }));
    assert.ok(pcm.length > 0 && pcm.some((v) => Math.abs(v) > 0.05), k);
  }
  assert.throws(() => instrumentNote('kazoo', 60), /Unknown instrument/);
});
