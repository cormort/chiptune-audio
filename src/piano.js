/**
 * 高品質物理擬真合成與真實鋼琴採樣模組 (Acoustic & Sampled Piano Engine)
 *
 * 提供兩種高階鋼琴音色：
 * 1. AcousticPiano / renderAcousticPiano: 純數學物理建模與多泛音動態衰減合成 (100% 離線、零資源依賴、無刺耳鋸齒波)
 * 2. SampledPiano: 專業真實平台鋼琴錄音取樣引擎 (支援 CacheStorage 永久離線快取與鄰近音高內插)
 */

import { noteFreq } from './instruments.js';
import { SampledInstruments, startAt } from './samples.js';
import { SAMPLE_LIBRARY } from './sample-library.js';

// 平台鋼琴的樣本清單（Salamander Grand Piano）。檔名與音高的對照在 sample-library.js，
// 這裡只是把它整理成舊介面的樣子。
export const PIANO_SAMPLES = Object.entries(SAMPLE_LIBRARY.grand.notes)
  .map(([midi, file]) => ({ midi: +midi, name: file.replace(/\.mp3$/, '') }))
  .sort((a, b) => a.midi - b.midi);

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
    startAt(ctx, gainNode, src, opts);

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
 *
 * 這是 `SampledInstruments`（src/samples.js）的一層薄包裝，只綁定平台鋼琴那組樣本，
 * 並保留原本的行為：樣本還沒到（第一次播、離線、抓失敗）就退回 `AcousticPiano`
 * 的高品質物理擬真合成，所以按鍵永遠有聲音。
 */
export class SampledPiano {
  constructor(audioContextOrGetter, outputNodeOrGetter = null) {
    this.bank = new SampledInstruments(audioContextOrGetter, outputNodeOrGetter);
    this.acousticFallback = new AcousticPiano(audioContextOrGetter, outputNodeOrGetter);
    this.name = 'grand';
  }

  get ctx() {
    return this.bank.ctx;
  }

  get targetNode() {
    return this.bank.targetNode;
  }

  /** 已載入的樣本，midi -> AudioBuffer（相容舊介面）。 */
  get buffers() {
    const out = new Map();
    for (const n of this.bank.instruments.get(this.name)?.notes || []) out.set(n.midi, n.buffer);
    return out;
  }

  get isLoading() {
    return this.bank.loading(this.name);
  }

  get loadedCount() {
    return this.bank.loaded(this.name);
  }

  /** 最接近又已載入的樣本（沒有的話 null）。 */
  findBestSample(targetMidi) {
    return this.bank.findBest(this.name, targetMidi);
  }

  /** 預載平台鋼琴的樣本（帶 CacheStorage 快取）。已載完就不重抓。 */
  async preload(onProgress) {
    if (this.loadedCount >= PIANO_SAMPLES.length) return;
    await this.bank.load(this.name, {
      onProgress: onProgress ? (done, total) => onProgress(done, total) : undefined,
    });
  }

  /**
   * 演奏一個音符
   * @param {number} note MIDI 音高 (C4 = 60)
   * @param {object} opts { vel, pan, gain }
   * @returns {object} { source, release: (fade) => void }
   */
  playNote(note, opts = {}) {
    const voice = this.bank.playNote(this.name, note, opts);
    // 樣本還沒到（或無網路）：無縫降級成物理擬真合成
    return voice || this.acousticFallback.playNote(note, opts);
  }
}
