import { renderSfx, SFX_PRESETS, SAMPLE_RATE } from './sfx.js';
import { generateSong, renderSong } from './music.js';

// Web Audio playback layer. Create it anywhere; audio starts on first play*
// call, which must happen after a user gesture (browser autoplay policy).
export class ChiptuneAudio {
  constructor({ volume = 0.6 } = {}) {
    this.volume = volume;
    this.muted = false;
    this.ctx = null;
    this.music = null;
    this.sfxCache = new Map();
  }

  _ensure() {
    if (!this.ctx) {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this._applyVolume();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  _applyVolume() {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  _buffer(samples) {
    const buf = this._ensure().createBuffer(1, samples.length, SAMPLE_RATE);
    buf.getChannelData(0).set(samples);
    return buf;
  }

  // name: a key of SFX_PRESETS, or a params object for renderSfx.
  playSfx(name) {
    let buf = typeof name === 'string' ? this.sfxCache.get(name) : null;
    if (!buf) {
      const params = typeof name === 'string' ? SFX_PRESETS[name] : name;
      if (!params) throw new Error(`Unknown sfx: ${name}`);
      buf = this._buffer(renderSfx(params));
      if (typeof name === 'string') this.sfxCache.set(name, buf);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.master);
    src.start();
  }

  playMusic(options) {
    this.stopMusic();
    const src = this._ensure().createBufferSource();
    src.buffer = this._buffer(renderSong(generateSong(options)));
    src.loop = true;
    src.connect(this.master);
    src.start();
    this.music = src;
  }

  stopMusic() {
    if (this.music) { this.music.stop(); this.music = null; }
  }

  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); this._applyVolume(); }
  setMuted(m) { this.muted = !!m; this._applyVolume(); }
}
