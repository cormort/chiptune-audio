import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal Web Audio stub. The engine is the half of the project that cannot run
// in plain Node, so without this it has no test coverage at all.
class FakeParam {
  constructor(v = 0) { this.value = v; this.calls = []; }
  setTargetAtTime(v, t, c) { this.value = v; this.calls.push(['setTargetAtTime', v, t, c]); }
  cancelScheduledValues(t) { this.calls.push(['cancelScheduledValues', t]); }
}
class FakeNode {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.connections = []; this.disconnected = false; }
  connect(n) { this.connections.push(n); return n; }
  disconnect() { this.disconnected = true; }
}
class FakeGain extends FakeNode {
  constructor(ctx) { super(ctx, 'gain'); this.gain = new FakeParam(1); }
}
class FakeBiquad extends FakeNode {
  constructor(ctx) { super(ctx, 'biquad'); this.type = 'lowpass'; this.frequency = new FakeParam(350); this.Q = new FakeParam(1); }
}
class FakePanner extends FakeNode {
  constructor(ctx) { super(ctx, 'panner'); this.pan = new FakeParam(0); }
}
class FakeBuffer {
  constructor(ch, len, rate) { this.numberOfChannels = ch; this.length = len; this.sampleRate = rate; this.duration = len / rate; this._d = [new Float32Array(len)]; }
  getChannelData(i) { return this._d[i]; }
}
class FakeSource extends FakeNode {
  constructor(ctx) {
    super(ctx, 'source');
    this.buffer = null; this.loop = false; this.playbackRate = new FakeParam(1);
    this.started = false; this.stopped = false; this.onended = null;
  }
  start() { this.started = true; this.ctx._sources.push(this); }
  stop() { if (!this.started) throw new Error('stop() before start()'); this.stopped = true; if (this.onended) this.onended(); }
}
class FakeAudioContext {
  constructor(opts) {
    this.sampleRate = (opts && opts.sampleRate) || 48000; // deliberately not 44100
    this.state = 'suspended';
    this.currentTime = 0;
    this.destination = new FakeNode(this, 'destination');
    this._sources = [];
    this.buffersCreated = 0;
    this.closed = false;
  }
  createGain() { return new FakeGain(this); }
  createBiquadFilter() { return new FakeBiquad(this); }
  createStereoPanner() { return new FakePanner(this); }
  createBuffer(ch, len, rate) {
    if (!(len > 0)) throw new Error('createBuffer: length must be > 0');
    this.buffersCreated++;
    return new FakeBuffer(ch, len, rate);
  }
  createBufferSource() { return new FakeSource(this); }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; this.closed = true; return Promise.resolve(); }
}

globalThis.AudioContext = FakeAudioContext;
const { ChiptuneAudio, SFX_DEFAULTS, SAMPLE_RATE } = await import('../src/index.js');

const mk = (opts) => new ChiptuneAudio(opts);

test('context is created lazily and resumed on first play', () => {
  const a = mk();
  assert.equal(a.ctx, null, 'no AudioContext before the first play call');
  a.playSfx('coin');
  assert.ok(a.ctx, 'context created');
  assert.equal(a.ctx.state, 'running', 'suspended context was resumed');
});

test('missing Web Audio gives a descriptive error, not a TypeError', () => {
  const saved = globalThis.AudioContext;
  delete globalThis.AudioContext;
  // webkitAudioContext is a separate global the engine also probes.
  const savedWebkit = globalThis.webkitAudioContext;
  delete globalThis.webkitAudioContext;
  try {
    assert.throws(() => mk().playSfx('coin'), /Web Audio is not available/);
  } finally {
    globalThis.AudioContext = saved;
    if (savedWebkit !== undefined) globalThis.webkitAudioContext = savedWebkit;
  }
});

test('buffers are rendered at the context rate, not a hard-coded 44100', () => {
  const a = mk();
  a.playSfx('coin');
  assert.equal(a.sampleRate, 48000);
  assert.equal(a.ctx._sources[0].buffer.sampleRate, 48000);
  assert.notEqual(a.ctx._sources[0].buffer.sampleRate, SAMPLE_RATE);
});

test('named presets are rendered once and reused', () => {
  const a = mk();
  a.playSfx('coin'); a.playSfx('coin'); a.playSfx('coin');
  assert.equal(a.ctx.buffersCreated, 1);
  assert.equal(a.ctx._sources.length, 3, 'each play still gets its own source node');
});

test('custom params are cached too (the original re-rendered every call)', () => {
  const a = mk();
  const p = { freq: 500, slide: -2, decay: 0.2 };
  a.playSfx(p); a.playSfx({ ...p }); a.playSfx({ ...p });
  assert.equal(a.ctx.buffersCreated, 1, 'equivalent params must hit the same cache entry');
});

test('cache keys use normalised values, so redundant params collide', () => {
  const a = mk();
  a.playSfx({});                       // all defaults
  a.playSfx({ freq: SFX_DEFAULTS.freq });
  a.playSfx({ freq: 440, duty: 0.5 });
  assert.equal(a.ctx.buffersCreated, 1);
});

test('the SFX cache is bounded', () => {
  const a = mk();
  for (let i = 0; i < 120; i++) a.playSfx({ freq: 200 + i, sustain: 0.01, decay: 0.01 });
  assert.ok(a.sfxCache.size <= 64, `cache grew to ${a.sfxCache.size}`);
});

test('an unknown preset name throws a useful error', () => {
  const a = mk();
  assert.throws(() => a.playSfx('nope'), /Unknown sfx: nope/);
  assert.throws(() => a.playSfx(), TypeError);
  assert.throws(() => a.playSfx(42), TypeError);
});

test('a degenerate envelope is skipped instead of calling createBuffer(0)', () => {
  const a = mk();
  const src = a.playSfx({ attack: 0, sustain: 0, decay: 0 });
  assert.equal(src, null);
  assert.equal(a.ctx.buffersCreated, 0);
});

test('play options wire up pan, rate and gain', () => {
  const a = mk();
  const src = a.playSfx('coin', { pan: -0.5, rate: 1.5, gain: 0.25 });
  assert.equal(src.playbackRate.value, 1.5);
  // src -> panner -> gain -> master
  const panner = src.connections[0];
  assert.equal(panner.kind, 'panner');
  assert.equal(panner.pan.value, -0.5);
  const gain = panner.connections[0];
  assert.equal(gain.kind, 'gain');
  assert.equal(gain.gain.value, 0.25);
  assert.equal(gain.connections[0], a.master);
});

test('pan is clamped and skipped when zero', () => {
  const a = mk();
  assert.equal(a.playSfx('coin', { pan: 0 }).connections[0], a.master, 'pan 0 goes straight to master');
  const loud = a.playSfx('coin', { pan: -9 });
  assert.equal(loud.connections[0].pan.value, -1);
});

test('music loops, caches on preload, and does not re-render on replay', () => {
  const a = mk();
  a.playSfx('coin'); // force the context into existence first
  const before = a.ctx.buffersCreated;
  a.preloadMusic({ seed: 42, mood: 'happy', bars: 4 });
  const afterPreload = a.ctx.buffersCreated;
  assert.equal(afterPreload, before + 1, 'preload renders exactly one buffer');
  assert.equal(a.music, null, 'preload must not start playback');

  const src = a.playMusic({ seed: 42, mood: 'happy', bars: 4 });
  assert.ok(src.loop, 'music source is looped');
  assert.equal(a.ctx.buffersCreated, afterPreload, 'cache hit: no second render');
  assert.equal(a.music, src);
});

test('cheap moods still produce a real loop', () => {
  const a = mk();
  for (const mood of ['happy', 'calm', 'tense', 'sad']) {
    const src = a.playMusic({ seed: 5, mood, bars: 2 });
    assert.ok(src.buffer.length > 0, `${mood} rendered nothing`);
  }
});

test('playMusic accepts a pre-generated song object', async () => {
  const { generateSong } = await import('../src/index.js');
  const a = mk();
  const song = generateSong({ seed: 9, mood: 'calm', bars: 2 });
  const src = a.playMusic(song);
  assert.ok(src && src.loop);
});

test('playMusic replaces the previous loop instead of stacking them', () => {
  const a = mk();
  const first = a.playMusic({ seed: 1, mood: 'happy', bars: 2 });
  const second = a.playMusic({ seed: 2, mood: 'happy', bars: 2 });
  assert.ok(first.stopped, 'previous loop was stopped');
  assert.ok(first.disconnected);
  assert.equal(a.music, second);
});

test('stopMusic is idempotent', () => {
  const a = mk();
  a.playMusic({ seed: 1, bars: 2 });
  a.stopMusic();
  assert.equal(a.music, null);
  assert.doesNotThrow(() => a.stopMusic());
});

test('stopAllSfx stops every one-shot still playing', () => {
  const a = mk();
  a.playSfx('coin'); a.playSfx('jump'); a.playSfx('laser');
  const started = a.ctx._sources.filter((s) => s.kind === 'source');
  assert.equal(started.length, 3);
  a.stopAllSfx();
  assert.ok(started.every((s) => s.stopped));
});

test('volume and mute are clamped and ramped rather than jumped', () => {
  const a = mk();
  a.playSfx('coin'); // create the context + master
  a.setVolume(0.25);
  assert.equal(a.volume, 0.25);
  assert.equal(a.master.gain.value, 0.25);
  assert.ok(a.master.gain.calls.some((c) => c[0] === 'setTargetAtTime'), 'gain was ramped, not assigned');

  a.setVolume(5);
  assert.equal(a.volume, 1, 'clamped to 1');
  a.setVolume(-5);
  assert.equal(a.volume, 0, 'clamped to 0');
  a.setVolume(NaN);
  assert.equal(a.volume, 0, 'NaN keeps the previous value');

  a.setMuted(true);
  assert.equal(a.master.gain.value, 0);
  a.setMuted(false);
  assert.equal(a.master.gain.value, 0);
});

test('the opt-in master filter is inserted between master and destination', () => {
  const a = mk({ filter: { freq: 11000 } });
  a.playSfx('coin');
  assert.ok(a.filter, 'filter node created');
  assert.equal(a.filter.frequency.value, 11000);
  assert.equal(a.master.connections[0], a.filter);
  assert.equal(a.filter.connections[0], a.ctx.destination);
  assert.equal(a.setFilter(9000), true);
  assert.equal(a.filter.frequency.value, 9000);
});

test('no filter configured means no filter node, and setFilter reports it', () => {
  const a = mk();
  a.playSfx('coin');
  assert.equal(a.filter, null);
  assert.equal(a.master.connections[0], a.ctx.destination);
  assert.equal(a.setFilter(9000), false);
});

test('dispose releases the context and is safe to call twice', async () => {
  const a = mk();
  a.playMusic({ seed: 1, bars: 2 });
  a.playSfx('coin');
  const ctx = a.ctx;
  await a.dispose();
  assert.ok(ctx.closed, 'AudioContext was closed');
  assert.equal(a.ctx, null);
  assert.equal(a.music, null);
  assert.equal(a.sfxCache.size, 0);
  await a.dispose(); // second dispose must be a no-op, not a throw
});

test('a disposed engine can be used again', async () => {
  const a = mk();
  a.playSfx('coin');
  await a.dispose();
  assert.doesNotThrow(() => a.playSfx('coin'));
  assert.ok(a.ctx);
});

test('playing after stopMusic works (engine is reusable)', () => {
  const a = mk();
  a.playMusic({ seed: 1, bars: 2 });
  a.stopMusic();
  const again = a.playMusic({ seed: 1, bars: 2 });
  assert.ok(again.started);
});

test('music plays through the music bus, which setMix ramps', () => {
  const a = mk();
  const src = a.playMusic({ seed: 1, bars: 2 });
  assert.equal(src.connections[0], a.musicBus);
  assert.equal(a.musicBus.connections[0], a.master);
  a.setMix({ music: 0.3 });
  assert.equal(a.musicBus.gain.value, 0.3);
  assert.ok(a.musicBus.gain.calls.some((c) => c[0] === 'setTargetAtTime'));
});

test('setMix sfx level scales new one-shots', () => {
  const a = mk();
  a.setMix({ sfx: 0.5 });
  const gain = a.playSfx('coin', { gain: 0.8 }).connections[0];
  assert.equal(gain.kind, 'gain');
  assert.equal(gain.gain.value, 0.4);
  a.setMix({ sfx: 1 });
  assert.equal(a.playSfx('coin').connections[0], a.master, 'unity sfx level adds no node');
});

test('setMix part levels re-render the playing loop, clamp, and keep other keys', () => {
  const a = mk();
  const first = a.playMusic({ seed: 1, bars: 2 });
  const mix = a.setMix({ drums: 0, lead: 7, nope: 1 });
  assert.deepEqual(mix, { sfx: 1, music: 1, lead: 1, bass: 1, drums: 0 });
  assert.ok(first.stopped, 'old loop replaced');
  assert.notEqual(a.music, first);
  assert.notEqual(a.music.buffer, first.buffer, 'new render for the new mix');
  a.setMix({ drums: 1 });
  assert.equal(a.music.buffer, first.buffer, 'unity mix is served from the song cache');
});

test('setMix before any audio just records the levels', () => {
  const a = mk();
  assert.doesNotThrow(() => a.setMix({ lead: 0.2 }));
  assert.equal(a.ctx, null);
  assert.equal(a.mix.lead, 0.2);
});

test('playNote returns a handle whose release fades and stops the voice', async () => {
  const { instrumentNote } = await import('../src/index.js');
  const a = mk();
  const v = a.playNote(instrumentNote('organ', 60));
  const gain = v.source.connections[0];
  assert.equal(gain.kind, 'gain', 'a note always gets its own gain node');
  assert.equal(gain.connections[0], a.master);
  v.release(0.2);
  assert.ok(gain.gain.calls.some((c) => c[0] === 'setTargetAtTime' && c[1] === 0), 'faded to 0');
  assert.ok(v.source.stopped);
  assert.doesNotThrow(() => v.release(), 'release is idempotent');
});

test('playMidi plays on the music bus and ignores part levels', async () => {
  const a = mk();
  const midi = { duration: 1, tracks: [{ instrument: 'square', notes: [{ time: 0, dur: 0.5, note: 60, vel: 1 }] }] };
  const src = a.playMidi(midi, { loop: true, offset: 0.25 });
  assert.equal(src.connections[0], a.musicBus);
  assert.equal(src.loop, true);
  assert.equal(a.music, src);
  assert.ok(Math.abs(a.musicTime - 0.25) < 1e-9, 'offset is reflected in musicTime');
  a.setMix({ lead: 0 });
  assert.equal(a.music, src, 'no re-render: lead/bass/drums are for generated songs');
  a.playMusic({ seed: 1, bars: 2 });
  assert.ok(src.stopped, 'a song replaces the MIDI');
});

test('setMix skips the re-render when the part levels are already playing', () => {
  const a = mk();
  const first = a.playMusic({ seed: 1, bars: 2 });
  const created = a.ctx.buffersCreated;
  a.setMix({ lead: 1, bass: 1, drums: 1 });   // already playing: nothing to bake
  assert.equal(a.ctx.buffersCreated, created, 'no re-render for unchanged part levels');
  assert.equal(a.music, first, 'the loop keeps playing');
  assert.ok(!first.stopped);
  a.setMix({ lead: 0.5 });                    // a real change still re-renders
  assert.ok(a.ctx.buffersCreated > created);
  assert.ok(first.stopped);
});
