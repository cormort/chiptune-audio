/**
 * 高品質物理擬真合成與真實鋼琴採樣模組 (Acoustic & Sampled Piano Engine)
 *
 * 提供兩種高階鋼琴音色：
 * 1. AcousticPiano / renderAcousticPiano: 純數學物理建模與多泛音動態衰減合成 (100% 離線、零資源依賴、無刺耳鋸齒波)
 * 2. SampledPiano: 專業真實平台鋼琴錄音取樣引擎 (支援 CacheStorage 永久離線快取與鄰近音高內插)
 */

import { noteFreq } from './instruments.js';

// 鋼琴音域標準 MIDI 對照表 (對應 Salamander Grand Piano 採樣檔名)
export const PIANO_SAMPLES = [
  { midi: 36, name: 'C2' },
  { midi: 39, name: 'Ds2' },
  { midi: 42, name: 'Fs2' },
  { midi: 45, name: 'A2' },
  { midi: 48, name: 'C3' },
  { midi: 51, name: 'Ds3' },
  { midi: 54, name: 'Fs3' },
  { midi: 57, name: 'A3' },
  { midi: 60, name: 'C4' },
  { midi: 63, name: 'Ds4' },
  { midi: 66, name: 'Fs4' },
  { midi: 69, name: 'A4' },
  { midi: 72, name: 'C5' },
  { midi: 75, name: 'Ds5' },
  { midi: 78, name: 'Fs5' },
  { midi: 81, name: 'A5' },
  { midi: 84, name: 'C6' },
  { midi: 87, name: 'Ds6' },
  { midi: 90, name: 'Fs6' },
  { midi: 93, name: 'A6' },
  { midi: 96, name: 'C7' },
];

const SAMPLE_BASE_URL = 'https://tonejs.github.io/audio/salamander/';
const CACHE_NAME = 'chiptune-piano-samples-v1';

/**
 * 純演算法高品質物理擬真鋼琴合成 (Acoustic Physical Modeling Synthesis)
 *
 * 核心原理：
 * - 鋼弦剛性非諧波性 (Stiff String Inharmonicity): fk = k * f0 * sqrt(1 + B * k^2)
 * - 頻率動態衰減 (Frequency-dependent Damping): 高頻泛音在 0.1~0.3s 迅速消逝，低頻基音自然長留
 * - 雙弦微失諧 (Unison Beating): 兩根琴弦微小相位差 (0.2~0.4 Hz) 營造真實鋼琴的聲學厚度
 * - 琴槌毛氈敲擊聲 (Felt Hammer Transient): 軟化帶通撞擊聲，消除塑膠白雜訊感
 */
export function renderAcousticPiano(note, sampleRate = 44100, seconds = 2.8, preset = 'standard') {
  const f0 = noteFreq(note);
  const totalSamples = Math.floor(sampleRate * seconds);
  const out = new Float32Array(totalSamples);

  // 琴弦剛度係數 (低音弦剛性低，高音弦剛性較明顯)
  const B = 0.00015 * Math.pow(Math.max(20, f0) / 261.63, 0.4);
  const nyquist = sampleRate * 0.48;
  // 泛音數與衰減坡度
  const K = preset === 'mellow'
    ? Math.min(8, Math.floor((sampleRate * 0.25) / f0))
    : preset === 'bright'
      ? Math.min(18, Math.floor(nyquist / f0))
      : Math.min(14, Math.floor(nyquist / f0));

  const baseDecay = Math.max(0.7, 3.4 - Math.log2(Math.max(20, f0) / 55) * 0.45);
  const brightSlope = preset === 'bright' ? 0.15 : preset === 'mellow' ? 0.45 : 0.25;

  for (let k = 1; k <= K; k++) {
    const fk = k * f0 * Math.sqrt(1 + B * k * k);
    if (fk >= nyquist) break;

    // 泛音振幅分佈：符合真實敲擊琴弦的頻譜斜率
    const amp0 = Math.exp(-brightSlope * (k - 1)) * (k === 1 ? 0.58 : (0.42 / Math.pow(k, 0.55)));

    // 關鍵：各階泛音依物理規律單獨衰減，高頻消逝極快
    const decayK = baseDecay / (1 + 0.65 * (k - 1) + 0.07 * (k - 1) * (k - 1));
    const dStep = 1 / (decayK * sampleRate);

    // 雙弦微失諧 (雙/三弦合奏帶來的溫暖自然聲學拍頻)
    const df = 0.22 * (1 + 0.08 * k);
    const w1 = 2 * Math.PI * (fk - df) / sampleRate;
    const w2 = 2 * Math.PI * (fk + df) / sampleRate;

    let ph1 = 0, ph2 = 0;
    const attackSamples = Math.min(Math.floor(0.003 * sampleRate), totalSamples);

    for (let i = 0; i < totalSamples; i++) {
      const env = Math.exp(-i * dStep);
      // 3ms 起音防爆音平滑斜率
      const aEnv = i < attackSamples ? i / attackSamples : 1;
      const s = 0.5 * (Math.sin(ph1) + Math.sin(ph2)) * amp0 * env * aEnv;
      out[i] += s;
      ph1 += w1;
      ph2 += w2;
    }
  }

  // 琴槌毛氈木質撞擊聲 (Hammer Strike Thump)
  const hammerLen = Math.min(Math.floor(0.02 * sampleRate), totalSamples);
  const hammerVol = preset === 'mellow' ? 0.05 : preset === 'bright' ? 0.22 : 0.14;
  const hammerFilter = preset === 'mellow' ? 0.04 : preset === 'bright' ? 0.12 : 0.08;
  let noiseState = 0;
  for (let i = 0; i < hammerLen; i++) {
    const t = i / hammerLen;
    const env = (1 - t) * (1 - t);
    const white = (Math.random() * 2 - 1) * hammerVol;
    noiseState += hammerFilter * (white - noiseState);
    out[i] += noiseState * env;
  }

  // 峰值防破音保護
  let max = 0;
  for (let i = 0; i < totalSamples; i++) {
    const abs = Math.abs(out[i]);
    if (abs > max) max = abs;
  }
  if (max > 0.85) {
    const norm = 0.85 / max;
    for (let i = 0; i < totalSamples; i++) out[i] *= norm;
  }
  return out;
}

/**
 * 物理擬真鋼琴合成器類別 (Acoustic Piano Player)
 */
export class AcousticPiano {
  constructor(audioContextOrGetter, outputNodeOrGetter = null) {
    this._ctx = audioContextOrGetter;
    this._output = outputNodeOrGetter;
    this.cache = new Map(); // key -> AudioBuffer
  }

  get ctx() {
    return typeof this._ctx === 'function' ? this._ctx() : this._ctx;
  }

  get targetNode() {
    const out = typeof this._output === 'function' ? this._output() : this._output;
    return out || (this.ctx ? this.ctx.destination : null);
  }

  getBuffer(note, preset = 'standard') {
    const key = `${note}:${preset}`;
    let buf = this.cache.get(key);
    if (!buf && this.ctx) {
      const pcm = renderAcousticPiano(note, this.ctx.sampleRate, 2.8, preset);
      buf = this.ctx.createBuffer(1, pcm.length, this.ctx.sampleRate);
      buf.getChannelData(0).set(pcm);
      this.cache.set(key, buf);
    }
    return buf;
  }

  playNote(note, opts = {}) {
    const ctx = this.ctx;
    if (!ctx) return null;
    if (ctx.state === 'suspended') ctx.resume();

    const buf = this.getBuffer(note, opts.preset || 'standard');
    if (!buf) return null;

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const gainNode = ctx.createGain();
    const vel = opts.vel !== undefined ? opts.vel : 0.85;
    gainNode.gain.value = Math.max(0, Math.min(1, vel * 0.9));

    src.connect(gainNode);
    gainNode.connect(this.targetNode);
    src.start();

    let released = false;
    return {
      source: src,
      release: (fade = 0.22) => {
        if (released) return;
        released = true;
        const now = ctx.currentTime;
        const f = Math.max(0.02, fade);
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setTargetAtTime(0, now, f / 4);
        try { src.stop(now + f); } catch {}
      },
    };
  }
}

/**
 * 真實平台鋼琴採樣播放器 (Sampled Grand Piano)
 */
export class SampledPiano {
  constructor(audioContextOrGetter, outputNodeOrGetter = null) {
    this._ctx = audioContextOrGetter;
    this._output = outputNodeOrGetter;
    this.buffers = new Map(); // midi -> AudioBuffer
    this.acousticFallback = new AcousticPiano(audioContextOrGetter, outputNodeOrGetter);
    this.isLoading = false;
    this.loadedCount = 0;
  }

  get ctx() {
    return typeof this._ctx === 'function' ? this._ctx() : this._ctx;
  }

  get targetNode() {
    const out = typeof this._output === 'function' ? this._output() : this._output;
    return out || (this.ctx ? this.ctx.destination : null);
  }

  /**
   * 尋找最接近且已載入的採樣
   */
  findBestSample(targetMidi) {
    if (this.buffers.size === 0) return null;
    let closest = null;
    let minDiff = Infinity;
    for (const [midi, buf] of this.buffers.entries()) {
      const diff = Math.abs(midi - targetMidi);
      if (diff < minDiff) {
        minDiff = diff;
        closest = { midi, buffer: buf };
      }
    }
    return closest;
  }

  /**
   * 背景預載常用音域採樣 (帶 Cache API 快取)
   */
  async preload(onProgress) {
    if (this.isLoading || this.buffers.size >= PIANO_SAMPLES.length) return;
    this.isLoading = true;

    let cache = null;
    try {
      if (typeof window !== 'undefined' && 'caches' in window) {
        cache = await window.caches.open(CACHE_NAME);
      }
    } catch {
      // ignore cache failure
    }

    const total = PIANO_SAMPLES.length;
    for (const item of PIANO_SAMPLES) {
      if (this.buffers.has(item.midi)) continue;
      try {
        const url = `${SAMPLE_BASE_URL}${item.name}.mp3`;
        let res = null;
        if (cache) {
          res = await cache.match(url);
        }
        if (!res) {
          res = await fetch(url);
          if (res.ok && cache) {
            try { cache.put(url, res.clone()); } catch {}
          }
        }
        if (res && res.ok) {
          const ab = await res.arrayBuffer();
          const ctx = this.ctx;
          if (ctx) {
            const audioBuf = await ctx.decodeAudioData(ab);
            this.buffers.set(item.midi, audioBuf);
            this.loadedCount++;
            if (onProgress) onProgress(this.loadedCount, total);
          }
        }
      } catch (err) {
        console.warn(`[SampledPiano] Failed loading sample ${item.name}:`, err);
      }
    }
    this.isLoading = false;
  }

  /**
   * 演奏一個音符
   * @param {number} note MIDI 音高 (C4 = 60)
   * @param {object} opts { vel, pan, gain }
   * @returns {object} { source, release: (fade) => void }
   */
  playNote(note, opts = {}) {
    const ctx = this.ctx;
    if (!ctx) return null;
    if (ctx.state === 'suspended') ctx.resume();

    const sample = this.findBestSample(note);
    let buf = null;
    let playbackRate = 1.0;

    if (sample && Math.abs(sample.midi - note) <= 12) {
      buf = sample.buffer;
      playbackRate = Math.pow(2, (note - sample.midi) / 12);
    } else {
      // 採樣尚未載入完成或無網路時，無縫平滑降級為高品質物理擬真合成！
      return this.acousticFallback.playNote(note, opts);
    }

    if (!buf) return null;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = playbackRate;

    const gainNode = ctx.createGain();
    const vel = opts.vel !== undefined ? opts.vel : 0.85;
    gainNode.gain.value = Math.max(0, Math.min(1, vel * 0.9));

    src.connect(gainNode);
    gainNode.connect(this.targetNode);

    src.start();

    let released = false;
    return {
      source: src,
      release: (fade = 0.22) => {
        if (released) return;
        released = true;
        const now = ctx.currentTime;
        const f = Math.max(0.02, fade);
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setTargetAtTime(0, now, f / 4);
        try { src.stop(now + f); } catch {}
      },
    };
  }
}
