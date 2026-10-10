// 取樣樂器：真實錄音，不是合成。樣本放在公開的樣本庫（GitHub Pages，CORS 開放），
// 抓到之後存進 CacheStorage，之後離線也能用——service worker 只快取本站檔案，
// 樣本在別的 origin，所以要自己存一份。
//
// 三件事讓這件事變成「零依賴」而不是「bundled 10 MB 取樣」：
//   1. 只有被選到的樂器才抓（src/sample-library.js 的資料表列出檔名）。
//   2. 每個樂器只留最多 12 個樣本，缺的中間音用播放速率內插（±2 個半音內幾乎聽不出來）。
//   3. 樣本還沒到（第一次選、或離線）時先用合成代理音（資料表的 `synth`），按鍵不會沒聲音。
import { SAMPLE_LIBRARY } from './sample-library.js';

export { SAMPLE_LIBRARY, SAMPLE_CREDIT } from './sample-library.js';

const CACHE_NAME = 'chiptune-samples-v1';
/** 取樣樂器在 renderMidi 裡的命名空間，和 chip／real 兩個合成庫並列。 */
export const SAMPLE_PREFIX = 'sampled:';

/** 這個樂器在 renderMidi／鍵盤上用的名字（`sampled:violin`）。 */
export const sampleName = (name) => `${SAMPLE_PREFIX}${name}`;

/** 取樣樂器庫裡有什麼（順序照資料表，鋼琴在最前面）。 */
export const sampleNames = () => Object.keys(SAMPLE_LIBRARY);
/** 中文名。 */
export const sampleLabel = (name) => (SAMPLE_LIBRARY[name] ? SAMPLE_LIBRARY[name].label : name);
/** 樣本還沒到時先播的合成音色（例：小提琴 → real:violin）。 */
export const sampleSynth = (name) => (SAMPLE_LIBRARY[name] ? SAMPLE_LIBRARY[name].synth : null);

/** 一個樂器要抓的每個樣本：{ midi, url }。 */
export function sampleUrls(name) {
  const inst = SAMPLE_LIBRARY[name];
  if (!inst) return [];
  return Object.entries(inst.notes).map(([midi, file]) => ({ midi: +midi, url: inst.base + file }));
}

/** 挑最近的樣本。`notes` 是已載入的清單（可為空），回傳那個項目或 null。 */
export function nearestSample(notes, midi) {
  let best = null;
  let bestDist = Infinity;
  for (const n of notes) {
    const d = Math.abs(n.midi - midi);
    if (d < bestDist) { bestDist = d; best = n; }
  }
  return best;
}

/** 一個音要怎麼用樣本播：挑最近的樣本，以及要套的播放速率（半音差 → 2^(d/12)）。 */
export function sampleVoice(notes, midi) {
  const hit = nearestSample(notes, midi);
  if (!hit) return null;
  return { sample: hit, semitones: midi - hit.midi, rate: 2 ** ((midi - hit.midi) / 12) };
}

/** 讓 out[at + i] 疊上 pcm[0], pcm[1], ...（離線算 MIDI 用），線性內插。
 *  `ratio` 是每個輸出樣本要前進幾個樣本（含取樣率換算與播放速率）。
 *  `hold` 秒之後用 `release` 秒淡出，然後停止——取樣器接到 note-off 就是這樣做的。 */
export function mixSampleInto(out, at, pcm, ratio, gain, { hold = Infinity, release = 0.12, rate = 44100 } = {}) {
  if (!(ratio > 0) || !(gain > 0) || pcm.length < 2) return 0;
  const end = out.length;
  const last = pcm.length - 1;
  const fadeSteps = release > 0 ? release * rate : 0;
  let i = at < 0 ? 0 : at;
  let n = i < 0 ? -at : 0;
  for (; i < end; i++, n++) {
    const pos = n * ratio;
    if (pos >= last) break;                       // 樣本放完了（錄音本來就那麼長）
    const idx = pos | 0;
    const frac = pos - idx;
    let env = 1;
    const t = n / rate;
    if (t > hold) {
      if (fadeSteps <= 0) break;
      const k = (t - hold) / release;
      if (k >= 1) break;
      env = 1 - k;
    }
    out[i] += (pcm[idx] + (pcm[idx + 1] - pcm[idx]) * frac) * gain * env;
  }
  return i;
}

/** 取樣樂器播放器：載入樣本、挑最近的音、用播放速率補中間的音。
 *  一個實例可以載入多個樂器，各自獨立；載過的樂器不會重抓。
 *  建構子的兩個參數跟其他引擎一樣可以傳值或 getter（AudioContext 要等使用者手勢才會有）。 */
export class SampledInstruments {
  constructor(audioContextOrGetter, outputNodeOrGetter = null) {
    this._ctx = audioContextOrGetter;
    this._output = outputNodeOrGetter;
    /** name -> { notes: [{ midi, buffer }], failed: number } */
    this.instruments = new Map();
    this._loading = new Map();     // name -> Promise（同一個樂器只抓一次）
    this.loadedCount = 0;          // 最近一次載入已完成的樣本數
    this.total = 0;                // 最近一次載入總共要抓幾個
    this.cacheName = CACHE_NAME;
  }

  get ctx() {
    return typeof this._ctx === 'function' ? this._ctx() : this._ctx;
  }

  get targetNode() {
    const out = typeof this._output === 'function' ? this._output() : this._output;
    return out || (this.ctx ? this.ctx.destination : null);
  }

  /** 這個樂器已經有幾個樣本可用。 */
  loaded(name) {
    return this.instruments.get(name)?.notes.length || 0;
  }

  /** 這個樂器一共要抓幾個樣本。 */
  wanted(name) {
    return sampleUrls(name).length;
  }

  loading(name) {
    return this._loading.has(name);
  }

  /** 載入一個樂器的樣本；已經抓完的就直接回傳，正在載就等同一個 promise，
   *  只抓到一半（上次離線、有檔案 404）時只補缺的那幾個。
   *  `fetchImpl`／`decode` 可以換掉，測試用不到網路也能驗證整條路徑。 */
  load(name, opts = {}) {
    const running = this._loading.get(name);
    if (running) return running;
    if (!SAMPLE_LIBRARY[name]) return Promise.resolve(null);
    const total = this.wanted(name);
    if (total > 0 && this.loaded(name) >= total) return Promise.resolve(this.instruments.get(name));
    const p = this._load(name, opts).finally(() => this._loading.delete(name));
    this._loading.set(name, p);
    return p;
  }

  async _load(name, { onProgress, fetchImpl, decode } = {}) {
    const get = fetchImpl || ((url) => fetch(url));
    const decodeBuffer = decode || ((bytes) => this.ctx.decodeAudioData(bytes));
    const urls = sampleUrls(name);
    let cache = null;
    try {
      if (typeof caches !== 'undefined') cache = await caches.open(this.cacheName);
    } catch {
      cache = null;   // 無痕模式或沒權限：照抓，只是不進快取
    }
    const have = new Map((this.instruments.get(name)?.notes || []).map((n) => [n.midi, n.buffer]));
    const notes = [...have].map(([midi, buffer]) => ({ midi, buffer }));
    let failed = 0;
    let done = 0;
    for (const { midi, url } of urls) {
      if (have.has(midi)) { done++; continue; }     // 上次就抓到了，不重抓
      try {
        let res = cache ? await cache.match(url) : null;
        if (!res) {
          res = await get(url);
          if (res && res.ok && cache) { try { cache.put(url, res.clone()); } catch {} }
        }
        if (!res || !res.ok) throw new Error(`${url}: HTTP ${res ? res.status : 'no response'}`);
        const buffer = await decodeBuffer(await res.arrayBuffer());
        if (buffer && buffer.length) notes.push({ midi, buffer });
        else failed++;
      } catch (err) {
        failed++;   // 單一檔案壞掉不該讓整個樂器不能用：有幾個樣本用幾個
        if (typeof console !== 'undefined') console.warn(`[samples] ${name} ${url}: ${err.message}`);
      }
      done++;
      if (onProgress) onProgress(done, urls.length, name);
    }
    notes.sort((a, b) => a.midi - b.midi);
    const hit = { notes, failed };
    if (notes.length) this.instruments.set(name, hit);
    this.loadedCount = notes.length;
    this.total = urls.length;
    return hit;
  }

  /** 挑最近的樣本（沒載入或沒樣本時 null）。 */
  findBest(name, midi) {
    const inst = this.instruments.get(name);
    if (!inst || !inst.notes.length) return null;
    const v = sampleVoice(inst.notes, midi);
    return { midi: v.sample.midi, buffer: v.sample.buffer };
  }

  /** 播一個音。樣本還沒到時回傳 null，讓呼叫端自己決定要用哪個合成音色代替。 */
  playNote(name, note, opts = {}) {
    const ctx = this.ctx;
    if (!ctx) return null;
    const inst = this.instruments.get(name);
    if (!inst || !inst.notes.length) return null;
    const v = sampleVoice(inst.notes, note);
    if (ctx.state === 'suspended') ctx.resume();

    const src = ctx.createBufferSource();
    src.buffer = v.sample.buffer;
    src.playbackRate.value = v.rate;
    const gainNode = ctx.createGain();
    gainNode.gain.value = Math.max(0, Math.min(1, (opts.vel === undefined ? 0.85 : opts.vel) * (opts.gain === undefined ? 0.9 : opts.gain)));
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

  /** 給離線算 MIDI 用的樣子：{ rate, notes: [{ midi, pcm }] }（取樣率是 AudioContext 的）。 */
  pcm(name) {
    const inst = this.instruments.get(name);
    if (!inst || !inst.notes.length) return null;
    return {
      rate: inst.notes[0].buffer.sampleRate,
      notes: inst.notes.map((n) => ({ midi: n.midi, pcm: n.buffer.getChannelData(0) })),
    };
  }

  /** 把已載入的樂器整理成 renderMidi 認得的樣子：{ 'sampled:violin': { rate, notes } }。 */
  voices(names = [...this.instruments.keys()]) {
    const out = {};
    for (const name of names) {
      const pcm = this.pcm(name);
      if (pcm) out[sampleName(name)] = pcm;
    }
    return out;
  }
}
