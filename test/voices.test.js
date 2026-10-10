import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  renderSfx, normalizeSfx, SFX_DEFAULTS, SFX_PRESETS, WAVE, SAMPLE_RATE,
  INSTRUMENTS, REALISTIC_INSTRUMENTS, INSTRUMENT_BANKS, INSTRUMENT_LABELS,
  instrumentNote, instrumentRelease, instrumentNames, resolveInstrument,
  parseMidi, renderMidi,
} from '../src/index.js';
import { track, smf, tempo } from './smf.js';

const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const sane = (a) => a.every((x) => Number.isFinite(x) && Math.abs(x) <= 1);
const rms = (a, from = 0, to = a.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, to - from));
};
// Mean absolute sample-to-sample step: a cheap stand-in for "how bright it is".
const rough = (a) => {
  let s = 0;
  for (let i = 1; i < a.length; i++) s += Math.abs(a[i] - a[i - 1]);
  return s / a.length;
};

const TIMBRE = ['h2', 'h3', 'h4', 'h5', 'unison', 'detune', 'cutoff', 'chiff'];

test('every realistic instrument renders sane, non-silent audio at any pitch', () => {
  for (const name of Object.keys(REALISTIC_INSTRUMENTS)) {
    for (const note of [36, 48, 60, 72, 84]) {
      const pcm = renderSfx(instrumentNote(name, note, { seconds: 1, bank: 'real' }));
      const where = `${name}@${note}`;
      assert.ok(pcm.length > SAMPLE_RATE / 4, `${where} rendered nothing`);
      assert.ok(sane(pcm), `${where} out of range`);
      assert.ok(peak(pcm) > 0.1, `${where} too quiet: ${peak(pcm).toFixed(3)}`);
      assert.ok(peak(pcm) <= 0.9, `${where} would clip: ${peak(pcm).toFixed(3)}`);
      assert.ok(rms(pcm) > 0.02, `${where} almost silent`);
    }
  }
});

test('the timbre params are clamped, rounded and carried only when set', () => {
  // A plain voice keeps exactly the object shape it always had: the render loop
  // reads it once per voice and eight extra keys cost it 2x (measured).
  const plain = normalizeSfx({});
  assert.equal(Object.keys(plain).length, Object.keys(SFX_DEFAULTS).length - TIMBRE.length);
  for (const k of TIMBRE) assert.ok(!(k in plain), `${k} should be absent from a default voice`);

  const p = normalizeSfx({ h2: 5, h3: -1, h4: 0.5, h5: 0.5, unison: 1.6, detune: 999, cutoff: -5, chiff: 2 });
  assert.equal(p.h2, 1, 'above range clamps to 1');
  assert.equal(p.h4, 0.5);
  assert.equal(p.h5, 0.5);
  assert.equal(p.unison, 2, 'unison is rounded and clamped to 2');
  assert.equal(p.detune, 50, 'detune clamps to 50 cents');
  assert.equal(p.chiff, 1);
  assert.ok(!('h3' in p), 'a value clamped back to its default stays out of the object');
  assert.ok(!('cutoff' in p), 'a negative cutoff means off, which is the default');
  assert.equal(normalizeSfx({ h2: 0 }).h2, undefined, 'a default value must not widen the object');
  assert.equal(normalizeSfx({ h2: NaN }).h2, undefined);
  assert.equal(normalizeSfx({ unison: 1 }).detune, SFX_DEFAULTS.detune, 'detune rides along with unison');
  assert.equal(normalizeSfx({ chiff: 'loud' }).chiff, undefined);
});

test('the timbre params leave every plain chip voice untouched', () => {
  const plain = {
    wave: WAVE.SAW, freq: 300, slide: 2, duty: 0.3, dutySweep: 0.5, vibDepth: 0.01, vibRate: 5,
    arpMult: 2, arpTime: 0.05, bits: 4, attack: 0.01, sustain: 0.2, decay: 0.3, vol: 0.5, seed: 3,
  };
  const spelledOut = { ...plain, h2: 0, h3: 0, h4: 0, h5: 0, unison: 0, cutoff: 0, chiff: 0 };
  assert.deepEqual(normalizeSfx(plain), normalizeSfx(spelledOut));
  assert.deepEqual(renderSfx(plain), renderSfx(spelledOut));
  assert.deepEqual(renderSfx({}), renderSfx({ h2: 0, unison: 0, cutoff: 0, chiff: 0 }));
});

test('each timbre param changes the part of the sound it is meant to', () => {
  const base = { wave: WAVE.SAW, freq: 220, attack: 0.002, sustain: 0.3, decay: 0.2, vol: 0.5 };
  const dry = renderSfx(base);

  // Harmonics add spectrum, and are scaled so the voice still fits in [-1, 1].
  const harmonics = renderSfx({ ...base, h2: 0.5, h3: 0.4, h4: 0.3, h5: 0.2 });
  assert.notDeepEqual(harmonics, dry);
  assert.ok(peak(harmonics) <= 1, `harmonics clipped: ${peak(harmonics).toFixed(3)}`);
  assert.ok(rough(harmonics) > rough(dry), 'harmonics did not add high-frequency content');

  // The lowpass takes that content away again.
  const closed = renderSfx({ ...base, h2: 0.5, h3: 0.4, cutoff: 400 });
  assert.ok(rough(closed) < rough(harmonics) * 0.7, `cutoff did not dull the voice: ${rough(closed).toFixed(4)} vs ${rough(harmonics).toFixed(4)}`);

  // chiff is an attack transient: broadband noise at the start, nothing after.
  const wet = renderSfx({ ...base, chiff: 0.5 });
  const head = Math.round(0.02 * SAMPLE_RATE);
  const tailAt = Math.round(0.1 * SAMPLE_RATE);
  assert.ok(rough(wet.subarray(0, head)) > rough(dry.subarray(0, head)) * 3, 'chiff did not add a transient');
  assert.ok(Math.abs(rms(wet, tailAt) - rms(dry, tailAt)) < rms(dry, tailAt) * 0.05, 'chiff leaked past the attack');

  // Detuned copies widen the voice without collapsing or doubling its level.
  const wide = renderSfx({ ...base, unison: 2, detune: 10 });
  assert.notDeepEqual(wide, dry);
  assert.ok(rms(wide) > rms(dry) * 0.7 && rms(wide) < rms(dry) * 2, `unison level out of range: ${rms(wide).toFixed(4)} vs ${rms(dry).toFixed(4)}`);
  assert.ok(peak(wide) <= 1, `unison clipped: ${peak(wide).toFixed(3)}`);

  // Noise has no harmonics: the partials are ignored rather than smeared into it.
  const hiss = renderSfx({ wave: WAVE.NOISE, freq: 8000, attack: 0.002, sustain: 0.05, decay: 0.05, h2: 0.5, h3: 0.5 });
  assert.ok(sane(hiss) && peak(hiss) > 0.05);
});

test('both banks resolve by bare name, by bank, or by prefix', () => {
  assert.equal(resolveInstrument('saw').bank, 'chip');
  assert.equal(resolveInstrument('piano', 'real').name, 'piano');
  assert.equal(resolveInstrument('real:piano').bank, 'real');
  assert.equal(resolveInstrument('chip:piano').bank, 'chip');
  assert.equal(resolveInstrument('kazoo'), null);
  assert.equal(resolveInstrument('real:kazoo'), null);
  assert.equal(resolveInstrument('nope:piano'), null);
  assert.equal(resolveInstrument(null), null);

  // `piano` is a square blip in the chip bank and a piano in the realistic one.
  assert.notDeepEqual(instrumentNote('piano', 60), instrumentNote('piano', 60, { bank: 'real' }));
  assert.deepEqual(instrumentNote('piano', 60, { bank: 'real' }), instrumentNote('real:piano', 60));
  // A name that only exists in the other bank is an error, not a silent fallback.
  assert.throws(() => instrumentNote('saw', 60, { bank: 'real' }), /Unknown instrument/);
  assert.throws(() => instrumentNote('real:saw', 60), /Unknown instrument/);
  assert.equal(resolveInstrument('saw', 'real'), null);

  assert.equal(instrumentRelease('bell', 'real'), null, 'a bell rings out');
  assert.equal(typeof instrumentRelease('piano', 'real'), 'number');
  assert.equal(instrumentRelease('kazoo'), null);

  assert.throws(() => instrumentNote('kazoo', 60), /Unknown instrument/);
  for (const name of instrumentNames()) assert.ok(resolveInstrument(name), name);
});

test('every bank slot has a label and both banks keep the twelve slots', () => {
  for (const bank of ['chip', 'real']) {
    const keys = Object.keys(INSTRUMENT_BANKS[bank]);
    assert.equal(keys.length, 12, bank);
    for (const k of keys) assert.ok(INSTRUMENT_LABELS[bank][k], `${bank}.${k} has no label`);
  }
  assert.deepEqual(Object.keys(INSTRUMENTS), Object.keys(INSTRUMENT_LABELS.chip));
  assert.deepEqual(Object.keys(REALISTIC_INSTRUMENTS), Object.keys(INSTRUMENT_LABELS.real));
});

test('renderMidi takes realistic instrument names, and still rejects nonsense', () => {
  const midi = parseMidi(smf(1, 480, [
    track([[0, ...tempo(500000)]]),
    track([[0, 0x90, 60, 100], [240, 0x80, 60, 0]]),
  ]));
  const pcm = renderMidi(midi, { tracks: [{ instrument: 'real:piano' }] });
  assert.ok(peak(pcm) > 0.05 && sane(pcm), 'the realistic remix is silent or out of range');
  assert.throws(() => renderMidi(midi, { tracks: [{ instrument: 'kazoo' }] }), /Unknown instrument/);
});

test('a MIDI file that retriggers a pitch without note-offs cannot stack voices', () => {
  // 500 note-ons, no note-off: each pending note used to become a voice ringing
  // to the end of the piece (measured: 4000 of them = 2.7 s and 35 MB).
  const events = [];
  for (let i = 0; i < 500; i++) events.push([i ? 1 : 0, 0x90, 60, 100]);
  const midi = parseMidi(smf(0, 480, [track(events)]));
  const notes = midi.tracks[0].notes;
  assert.ok(notes.length <= 8, `${notes.length} stacked voices`);
  assert.ok(notes.length > 0, 'the retriggered pitch disappeared entirely');
  // The oldest pending notes are the ones stolen, so the last one survives.
  const last = notes.reduce((a, b) => (a.time > b.time ? a : b));
  assert.ok(Math.abs(last.time - 499 / 480 * 0.5) < 1e-9, `kept the wrong retrigger: ${last.time}`);

  // Well-formed polyphony must be untouched, including 8 overlapping voices.
  const chord = [];
  for (let i = 0; i < 8; i++) chord.push([0, 0x90, 60 + i, 100]);
  for (let i = 0; i < 8; i++) chord.push([120, 0x80, 60 + i, 0]);
  assert.equal(parseMidi(smf(0, 480, [track(chord)])).tracks[0].notes.length, 8);
});

test('the keyboard page wires the bank switch to the shared banks', () => {
  // 琴鍵與音色庫的程式在 page/keyboard.js，markup 只留按鈕；兩邊都要看。
  const html = readFileSync(new URL('../keyboard.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../page/keyboard.js', import.meta.url), 'utf8');
  for (const id of ['bankChip', 'bankReal', 'instruments', 'bankHint']) {
    assert.ok(html.includes(`id="${id}"`), `keyboard.html has no #${id}`);
  }
  assert.ok(script.includes('INSTRUMENT_BANKS'), 'page/keyboard.js does not use the shared banks');
  assert.ok(script.includes('INSTRUMENT_LABELS'), 'page/keyboard.js keeps its own label table');
  assert.ok(script.includes('instrumentRelease('), 'page/keyboard.js does not use the shared release');
  assert.ok(script.includes('{ bank }'), 'page/keyboard.js does not pass the bank when playing a note');
});

// Characterisation pin for the rendered voices. `baseline/` cannot serve here:
// the synthesis core was rewritten after it was frozen, so the old voices are
// deliberately not bit-comparable. These hashes (FNV-1a over the float32
// samples) are what the voices sound like today, and any intentional change to
// src/sfx.js or a bank in src/instruments.js has to update them — that is the
// point: an accidental change shows up as a diff here instead of as a sound
// nobody notices until a player does.
const GOLDEN = {
  presets: {
    coin: "f024f3a3",
    jump: "9fb51293",
    laser: "73e30192",
    hit: "0af38e76",
    explosion: "2fd671d8",
    powerup: "bd579641",
    select: "90cf651b",
    gameover: "4a6a6f9a",
    win: "e2dd7bf6",
    shoot: "55c296c6",
    blip: "0509ab21",
    click: "60d0566d",
    hurt: "43a21597",
    pickup: "91e732fd",
    heal: "80be9e00",
    levelup: "d1af826e",
    door: "fe59602b",
    step: "2b19d33a",
    bounce: "74004cf7",
    alarm: "13ccd65e",
    teleport: "467531b2",
    charge: "ebfffc53",
    error: "59860dd2",
    splash: "eb717ca3",
  },
  instruments: {
    chip: {
      square: "a7784990",
      pulse25: "7b1c9510",
      pulse12: "c56c6c90",
      triangle: "de357f58",
      saw: "be47c6f7",
      organ: "b38e4458",
      flute: "31945fb2",
      strings: "c84b6ac7",
      brass: "6558e244",
      piano: "978df328",
      pluck: "46cc806b",
      bell: "bfa9b7ff",
    },
    real: {
      piano: "20d3f278",
      epiano: "92b8c1c3",
      organ: "cfc7a460",
      strings: "2acf83c4",
      flute: "5955a58b",
      brass: "d54ecbbe",
      guitar: "8e4beb84",
      bell: "34cb19ba",
      bass: "828ed0fa",
      harp: "431fc996",
      choir: "a105c785",
      marimba: "f96d7cdc",
    },
  },
};

const voiceHash = (a) => {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
};

test('the rendered voices stay bit-for-bit what they were', () => {
  for (const [name, params] of Object.entries(SFX_PRESETS)) {
    assert.equal(voiceHash(renderSfx(params)), GOLDEN.presets[name], `preset ${name} changed`);
  }
  for (const bank of ['chip', 'real']) {
    for (const name of Object.keys(INSTRUMENT_BANKS[bank])) {
      const pcm = renderSfx(instrumentNote(name, 60, { seconds: 0.5, bank }));
      assert.equal(voiceHash(pcm), GOLDEN.instruments[bank][name], `${bank}:${name} changed`);
    }
  }
});
