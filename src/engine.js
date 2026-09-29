import { renderSfx, SFX_PRESETS, SAMPLE_RATE, normalizeSfx } from './sfx.js';
import { generateSong, renderSong } from './music.js';
import { renderMidi } from './midi.js';

// Rendered AudioBuffers kept around, bounded so a game that sprays custom
// parameter objects cannot grow the heap without limit.
const MAX_CACHED_SFX = 64;
const MAX_CACHED_SONGS = 2;

const clamp01 = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? (n < 0 ? 0 : n > 1 ? 1 : n) : fallback;
};

const MIX_KEYS = ['sfx', 'music', 'lead', 'bass', 'drums'];
const PART_KEYS = ['lead', 'bass', 'drums'];

const isSong = (o) => !!o && typeof o === 'object' && Array.isArray(o.lead) && Array.isArray(o.bass);

// Cache key built from normalised values, so `{}`, `{ freq: 440 }` and a preset
// that happens to match all share one rendered buffer.
function sfxKey(sampleRate, name, params) {
  if (typeof name === 'string') return `${sampleRate}|n:${name}`;
  const p = normalizeSfx(params);
  let s = `${sampleRate}|p:`;
  for (const k of Object.keys(p).sort()) s += `${k}=${p[k]};`;
  return s;
}

// Web Audio playback layer. Create it anywhere; audio starts on the first play*
// call, which must happen after a user gesture (browser autoplay policy).
export class ChiptuneAudio {
  constructor({ volume = 0.6, sampleRate, filter = null } = {}) {
    this.volume = clamp01(volume, 0.6);
    this.muted = false;
    this.ctx = null;
    this.master = null;
    this.filter = null;
    this.music = null;
    this.musicBus = null;
    /** Mixer levels, each 0..1: the sfx/music buses and the three music parts. */
    this.mix = { sfx: 1, music: 1, lead: 1, bass: 1, drums: 1 };
    this._musicOptions = null;
    this._musicStart = 0;
    this.sfxCache = new Map();
    this._songCache = new Map();
    this._active = new Set();
    this._forcedRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 0;
    this._filterOptions = filter;
  }

  /** Render rate: the live AudioContext rate once it exists, so mono buffers are
   *  never resampled by the browser (a 48 kHz device previously had every sound
   *  resampled from 44.1 kHz). */
  get sampleRate() { return this.ctx ? this.ctx.sampleRate : (this._forcedRate || SAMPLE_RATE); }

  _ensure() {
    if (!this.ctx) {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) throw new Error('Web Audio is not available in this environment');
      const opts = this._forcedRate ? { sampleRate: this._forcedRate } : undefined;
      this.ctx = new Ctx(opts);
      this.master = this.ctx.createGain();
      if (this._filterOptions) {
        this.filter = this.ctx.createBiquadFilter();
        this.filter.type = this._filterOptions.type || 'lowpass';
        this.filter.frequency.value = this._filterOptions.freq || 12000;
        if (this._filterOptions.q !== undefined) this.filter.Q.value = this._filterOptions.q;
        this.master.connect(this.filter);
        this.filter.connect(this.ctx.destination);
      } else {
        this.master.connect(this.ctx.destination);
      }
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.mix.music;
      this.musicBus.connect(this.master);
      this._applyVolume(true);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  /** Ramp rather than jump, so volume/mute changes do not click. */
  _applyVolume(immediate = false) {
    if (!this.master) return;
    const target = this.muted ? 0 : this.volume;
    if (immediate) { this.master.gain.value = target; return; }
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(target, now, 0.015);
  }

  _store(cache, key, value, limit) {
    cache.set(key, value);
    while (cache.size > limit) cache.delete(cache.keys().next().value);
    return value;
  }

  _sfxBuffer(name, params) {
    const rate = this.sampleRate;
    const key = sfxKey(rate, name, params);
    const hit = this.sfxCache.get(key);
    if (hit) {
      // Refresh LRU position.
      this.sfxCache.delete(key);
      this.sfxCache.set(key, hit);
      return hit;
    }
    const samples = renderSfx(params, { sampleRate: rate });
    // A degenerate envelope renders nothing; skip rather than hand a zero-length
    // buffer to createBuffer.
    if (samples.length === 0) return null;
    const buf = this.ctx.createBuffer(1, samples.length, rate);
    buf.getChannelData(0).set(samples);
    return this._store(this.sfxCache, key, buf, MAX_CACHED_SFX);
  }

  /** Play a preset name or a custom params object.
   *  @returns {AudioBufferSourceNode|null} handle, so a long sound can be stopped.
   *  opts.pan  -1 (left) .. 1 (right), default 0
   *  opts.rate  playback rate, default 1 (reuse one buffer at several pitches)
   *  opts.gain  per-playback gain multiplier, default 1 */
  playSfx(name, opts = {}) {
    const voice = this._startSfx(name, opts, false);
    return voice ? voice.src : null;
  }

  /** Play a held note: `params` are SFX params (see instrumentNote()). Returns a
   *  handle whose release(fade) fades the note out, e.g. on key up. */
  playNote(params, opts = {}) {
    const voice = this._startSfx(params, opts, true);
    if (!voice) return null;
    const { src, gain } = voice;
    let released = false;
    return {
      source: src,
      release: (fade = 0.08) => {
        if (released || !this.ctx) return;
        released = true;
        const f = Number.isFinite(fade) && fade > 0 ? fade : 0.005;
        const now = this.ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(0, now, f / 4);
        try { src.stop(now + f); } catch { /* already stopped */ }
      },
    };
  }

  /** `withGain` forces a per-voice gain node, so playNote can fade it. */
  _startSfx(name, opts, withGain) {
    const byName = typeof name === 'string';
    let params;
    if (byName) {
      params = SFX_PRESETS[name];
      if (!params) throw new Error(`Unknown sfx: ${name}`);
    } else if (name && typeof name === 'object') {
      params = name;
    } else {
      throw new TypeError('playSfx expects a preset name or a params object');
    }

    const ctx = this._ensure();
    const buf = this._sfxBuffer(name, params);
    if (!buf) return null;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const rate = Number(opts.rate);
    if (Number.isFinite(rate) && rate > 0) src.playbackRate.value = rate;

    let node = src;
    const pan = Number(opts.pan);
    if (Number.isFinite(pan) && pan !== 0 && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan < -1 ? -1 : pan > 1 ? 1 : pan;
      src.connect(panner);
      node = panner;
    }
    const g0 = Number(opts.gain);
    const gain = (Number.isFinite(g0) ? g0 : 1) * this.mix.sfx;
    let g = null;
    if (gain !== 1 || withGain) {
      g = ctx.createGain();
      g.gain.value = gain < 0 ? 0 : gain;
      node.connect(g);
      node = g;
    }
    node.connect(this.master);

    src.onended = () => { this._active.delete(src); node.disconnect(); };
    this._active.add(src);
    src.start();
    return { src, gain: g };
  }

  /** Build (and cache) a song's AudioBuffer without playing it. Call this from a
   *  loading screen: rendering an 8-bar loop costs tens of milliseconds, and
   *  doing it lazily inside the first playMusic() stutters the game. */
  preloadMusic(options = {}) {
    this._ensure();
    const song = isSong(options) ? options : generateSong(options);
    const rate = this.sampleRate;
    const m = this.mix;
    const unity = m.lead === 1 && m.bass === 1 && m.drums === 1;
    const key = (song.seed !== undefined && song.mood !== undefined && song.bars !== undefined)
      ? `${rate}|${song.seed >>> 0}|${song.mood}|${song.bars}|${song.bpm}|${song.duty}|${m.lead},${m.bass},${m.drums}`
      : null;
    if (key) {
      const hit = this._songCache.get(key);
      if (hit) return hit;
    }
    const samples = renderSong(song, unity
      ? { sampleRate: rate }
      : { sampleRate: rate, mix: { lead: m.lead, bass: m.bass, drums: m.drums } });
    if (samples.length === 0) return null;
    const buf = this.ctx.createBuffer(1, samples.length, rate);
    buf.getChannelData(0).set(samples);
    return key ? this._store(this._songCache, key, buf, MAX_CACHED_SONGS) : buf;
  }

  /** Play a loop. `options` is either generateSong options ({seed, mood, bars})
   *  or an already-generated song object. */
  playMusic(options = {}) {
    return this._startMusic(options, 0);
  }

  _startMusic(options, offset) {
    this.stopMusic();
    const ctx = this._ensure();
    const buf = this.preloadMusic(options);
    if (!buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.musicBus);
    src.start(0, offset);
    this.music = src;
    this._musicOptions = options;
    this._musicStart = ctx.currentTime - offset;
    return src;
  }

  /** Set mixer levels (each 0..1; omitted keys are unchanged).
   *  `sfx` and `music` are buses and apply instantly (`sfx` to sounds started
   *  afterwards). `lead`/`bass`/`drums` are baked into the rendered loop, so
   *  changing them re-renders the playing song and resumes it where it was. */
  setMix(levels = {}) {
    const m = this.mix;
    let partsChanged = false;
    for (const k of MIX_KEYS) {
      if (!(k in levels)) continue;
      const v = clamp01(levels[k], m[k]);
      if (v === m[k]) continue;
      m[k] = v;
      if (PART_KEYS.includes(k)) partsChanged = true;
    }
    if (this.musicBus) {
      const now = this.ctx.currentTime;
      this.musicBus.gain.cancelScheduledValues(now);
      this.musicBus.gain.setTargetAtTime(m.music, now, 0.015);
    }
    if (partsChanged && this.music && this._musicOptions) {
      const dur = this.music.buffer.duration;
      const pos = dur > 0 ? (this.ctx.currentTime - this._musicStart) % dur : 0;
      this._startMusic(this._musicOptions, pos);
    }
    return { ...m };
  }

  /** Render a parsed MIDI file (see parseMidi/renderMidi) and play it on the
   *  music bus, replacing any song. opts.offset starts playback that many
   *  seconds in, so a re-rendered remix can continue where it was. */
  playMidi(midi, opts = {}) {
    this.stopMusic();
    const ctx = this._ensure();
    const samples = renderMidi(midi, { ...opts, sampleRate: this.sampleRate });
    if (samples.length === 0) return null;
    const buf = ctx.createBuffer(1, samples.length, this.sampleRate);
    buf.getChannelData(0).set(samples);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = !!opts.loop;
    src.connect(this.musicBus);
    const offset = Number.isFinite(opts.offset) && opts.offset > 0 ? opts.offset % buf.duration : 0;
    src.start(0, offset);
    src.onended = () => { if (this.music === src) { this.music = null; src.disconnect(); } };
    this.music = src;
    this._musicOptions = null; // part levels (setMix lead/bass/drums) do not apply
    this._musicStart = ctx.currentTime - offset;
    return src;
  }

  /** Seconds into the playing music (wraps for loops), or 0 when nothing plays. */
  get musicTime() {
    if (!this.music || !this.ctx) return 0;
    const t = this.ctx.currentTime - this._musicStart;
    const dur = this.music.buffer.duration;
    return this.music.loop && dur > 0 ? t % dur : Math.min(t, dur);
  }

  stopMusic() {
    if (!this.music) return;
    const src = this.music;
    this.music = null;
    try { src.stop(); } catch { /* already stopped */ }
    src.disconnect();
  }

  /** Stop every one-shot sound still playing (e.g. on scene change). */
  stopAllSfx() {
    for (const src of [...this._active]) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    this._active.clear();
  }

  resume() {
    const ctx = this._ensure();
    return ctx.state === 'running' ? Promise.resolve() : ctx.resume();
  }

  setVolume(v) { this.volume = clamp01(v, this.volume); this._applyVolume(); }

  setMuted(m) { this.muted = !!m; this._applyVolume(); }

  /** Opt-in output stage. A gentle lowpass (~10-12 kHz) tames the aliasing the
   *  naive square/saw oscillators produce and mimics a chip's analog output. */
  setFilter(freq) {
    if (!this.filter) return false;
    this.filter.frequency.value = Number.isFinite(freq) && freq > 0 ? freq : 12000;
    return true;
  }

  /** Release everything. Optional, but required to stop leaking an AudioContext
   *  (browsers cap how many a page may create). */
  async dispose() {
    this.stopMusic();
    this.stopAllSfx();
    this.sfxCache.clear();
    this._songCache.clear();
    if (this.ctx) {
      const ctx = this.ctx;
      this.ctx = null;
      this.master = null;
      this.musicBus = null;
      this.filter = null;
      if (ctx.state !== 'closed') await ctx.close();
    }
  }
}
