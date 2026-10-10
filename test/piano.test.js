import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAcousticPiano, AcousticPiano, SampledPiano, PIANO_SAMPLES, SAMPLE_RATE } from '../src/index.js';

const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const sane = (a) => a.every((x) => Number.isFinite(x) && Math.abs(x) <= 1);
const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);

test('renderAcousticPiano: renders sane, non-silent, non-clipping samples for multiple octaves', () => {
  for (const note of [36, 48, 60, 72, 84]) {
    const pcm = renderAcousticPiano(note, SAMPLE_RATE, 1.0);
    assert.ok(pcm.length > SAMPLE_RATE / 2, `note ${note} length too short`);
    assert.ok(sane(pcm), `note ${note} has infinite or out-of-range samples`);
    assert.ok(peak(pcm) > 0.2, `note ${note} too quiet`);
    assert.ok(peak(pcm) <= 0.95, `note ${note} clips: ${peak(pcm)}`);
    assert.ok(rms(pcm) > 0.02, `note ${note} rms too low`);
  }
});

test('renderAcousticPiano: presets alter harmonic spectrum', () => {
  const std = renderAcousticPiano(60, SAMPLE_RATE, 1.0, 'standard');
  const mellow = renderAcousticPiano(60, SAMPLE_RATE, 1.0, 'mellow');
  const bright = renderAcousticPiano(60, SAMPLE_RATE, 1.0, 'bright');

  assert.notDeepEqual(std, mellow);
  assert.notDeepEqual(std, bright);
  // mellow should have lower high-frequency sample-to-sample difference
  const rough = (a) => {
    let s = 0;
    for (let i = 1; i < a.length; i++) s += Math.abs(a[i] - a[i - 1]);
    return s / a.length;
  };
  assert.ok(rough(mellow) < rough(bright), 'mellow should be softer than bright');
});

test('SampledPiano: maps standard MIDI notes and falls back gracefully', () => {
  assert.ok(PIANO_SAMPLES.length >= 15, 'expected rich note sample mapping');
  const sp = new SampledPiano(null);
  assert.equal(sp.findBestSample(60), null, 'unloaded sampler has no best sample');
});

test('AcousticPiano.playNote: when/dur schedule the start and the fade-out', () => {
  const calls = [];
  const param = () => ({ value: 1, setTargetAtTime: (...a) => calls.push(['fade', ...a]), cancelScheduledValues() {} });
  const ctx = {
    currentTime: 5, sampleRate: 8000, state: 'running', destination: {},
    createBuffer: (_, len) => ({ getChannelData: () => new Float32Array(len) }),
    createGain: () => ({ gain: param(), connect() {} }),
    createBufferSource: () => ({ connect() {}, start: (t) => calls.push(['start', t]), stop: (t) => calls.push(['stop', t]) }),
  };
  const p = new AcousticPiano(ctx);
  p.playNote(60, { when: 7, dur: 1 });
  assert.deepEqual(calls[0], ['start', 7]);
  assert.equal(calls[1][1], 0);
  assert.equal(calls[1][2], 8);            // fade begins when the note ends
  assert.ok(Math.abs(calls[2][1] - 8.22) < 1e-9);

  calls.length = 0;
  p.playNote(60);                          // unchanged: start now, no scheduled end
  assert.deepEqual(calls, [['start', 5]]);
});
