// 取樣樂器：真實錄音，不是合成。樣本放在公開的樣本庫（GitHub Pages，CORS 開放），
// 抓到之後存進 CacheStorage，之後離線也能用——service worker 只快取本站檔案，
// 樣本在別的 origin，所以要自己存一份。
//
// 三件事讓這件事變成「零依賴」而不是「bundled 10 MB 取樣」：
//   1. 只有被選到的樂器才抓（src/sample-library.js 的資料表列出檔名）。
//   2. 每個樂器最多留 18 個樣本，缺的中間音用播放速率內插（±2 個半音內幾乎聽不出來）。
//   3. 樣本還沒到（第一次選、或離線）時先用合成代理音（資料表的 `synth`），按鍵不會沒聲音。
//
// 另外有三個樂器（小提琴、大提琴、小號）用的是**有力度層**的版本：錄音放在 repo 裡
// （samples/velocity/，跟鼓組一樣同源、進 service worker 快取），資料在
// src/dynamic-library.js；它們覆蓋掉下面同名的遠端單層版本（見 MERGED）。
//
// 卡林巴琴（kalimba）也是 repo 內建的，理由不一樣：它是 kalimba.html 那把模擬器的主角，
// 打開頁面就該能彈，所以 17 個簧片的錄音（約 0.6 MB）跟鼓組一樣進預快取。
import { SAMPLE_LIBRARY as REMOTE_LIBRARY } from './sample-library.js';
import { DYNAMIC_INSTRUMENTS } from './dynamic-library.js';
import { KALIMBA_INSTRUMENT } from './kalimba-library.js';
import { FLUTE_INSTRUMENT } from './flute-library.js';
import { FLUTE_VIB_INSTRUMENT } from './flute-vib-library.js';
import { STRINGS_INSTRUMENT } from './strings-library.js';

/** 遠端單層 + repo 內建（同名或同一個名字以內建的為準；卡林巴只有內建這一份）。 */
export const SAMPLE_LIBRARY = {
  ...REMOTE_LIBRARY,
  ...DYNAMIC_INSTRUMENTS,
  kalimba: KALIMBA_INSTRUMENT,
  // 內建長笛（C4–C7、每個音兩個 take）覆蓋遠端那個（同音域但每個音只有一個 take）
  flute: FLUTE_INSTRUMENT,
  // 有顫音的長笛（susvib）：想吹長音時自己選，GM 73 仍然用無顫音那個
  'flute-vib': FLUTE_VIB_INSTRUMENT,
  // 弦樂群：原本的取樣庫裡沒有這個樂器（GM 44-45／48-51 以前借獨奏小提琴／大提琴）
  strings: STRINGS_INSTRUMENT,
};

export { SAMPLE_CREDIT } from './sample-library.js';
export { DYNAMIC_INSTRUMENTS } from './dynamic-library.js';
export { KALIMBA_INSTRUMENT, KALIMBA_SOURCE } from './kalimba-library.js';
export { FLUTE_INSTRUMENT } from './flute-library.js';
export { FLUTE_VIB_INSTRUMENT } from './flute-vib-library.js';
export { STRINGS_INSTRUMENT } from './strings-library.js';

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

/** 解碼後的 AudioBuffer → 單聲道、去掉開頭靜音。兩件事都是量出來的：
 *
 *  - **立體聲不能只取左聲道**。Salamander 鋼琴是立體聲，而且左聲道比右小約 5 dB；
 *    只取左邊等於少掉 19% 的能量，聽起來比樣本庫原本的樣子薄。
 *  - **開頭要切掉**。tonejs-instruments 那批樣本前面有 24–50 ms 的數位空白
 *    （鋼琴只有 8 ms）。照原樣播，每個音都會晚一點；更糟的是每個樂器晚的不一樣多
 *    （長笛 28 ms、吉他 50 ms），合奏起來就是拖、就是散。
 *
 *  切法是「峰值 1% 以下當作還沒開始」，再保留 2 ms 前導，所以樂器自己的起音
 *  （長笛的前 30 ms 是吹氣的漸強）不會被切掉。鼓組的檔案在產生時已經切過，
 *  這裡再跑一次是無害的（已經是開頭了）。
 */
export function prepareSample(buffer, opts) {
  return trimChannels(buffer, opts).mono;
}

/** 同上，但**保留左右聲道**：`{ mono, left, right }`（單聲道來源時 left/right 是 null）。
 *
 *  為什麼要留：立體來源的左右可能不是一對相干的麥克風（Salamander 鋼琴就是兩支
 *  不同視角，各頻帶相位差 +28°～−137°），相加會抵消掉約 5 dB 而且每個音被不同地
 *  重塑。所以 `mono` **不是平均**，而是**能量較大的那個聲道**——單聲道播放時用它，
 *  立體播放時用 left/right 兩邊。
 *  兩個聲道用同一個起點切（用比較大聲的那一邊找起音），才不會左右錯開。 */
export function prepareSampleChannels(buffer, opts) {
  return trimChannels(buffer, opts);
}

function trimChannels(buffer, { floor = 0.01, prerollSeconds = 0.002 } = {}) {
  const len = buffer.length || 0;
  if (!len) return { mono: new Float32Array(0), left: null, right: null };
  const chans = buffer.numberOfChannels || 1;
  const data = [];
  for (let c = 0; c < chans; c++) data.push(buffer.getChannelData(c));
  // 每個聲道的能量：單聲道播放要挑大的那一個，不是平均
  const energy = data.map((d) => {
    let e = 0;
    for (let i = 0; i < len; i++) e += d[i] * d[i];
    return e;
  });
  const loudest = energy.indexOf(Math.max(...energy));
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(data[loudest][i]));
  if (peak <= 0) return { mono: data[loudest].slice(), left: null, right: null };   // 全靜音：留給呼叫端判斷
  const floorAt = peak * floor;
  let start = 0;
  while (start < len && Math.abs(data[loudest][start]) < floorAt) start++;
  const preroll = Math.round(prerollSeconds * (buffer.sampleRate || 44100));
  start = Math.max(0, start - preroll);
  // 兩個聲道用**同一個起點**切，左右才不會錯開
  return {
    mono: data[loudest].slice(start),
    left: chans < 2 ? null : data[0].slice(start),
    right: chans < 2 ? null : data[1].slice(start),
  };
}

/** 把一個樂器的錄音整體拉到同一個基準音量。
 *
 *  量出來的差別：tonejs-instruments 那批（小提琴、大提琴、長笛、吉他…）都正規化到峰值
 *  0.706，但 Salamander 鋼琴只有 0.345——**同一首曲子裡鋼琴就比小提琴小 6.2 dB**，
 *  聽起來就是「鋼琴怎麼特別薄」。
 *
 *  只調「樂器之間」的差：取樂器所有樣本峰值的中位數（不被單一顆大聲的樣本牽著走），
 *  整組乘上同一個倍率，所以樂器內部原本的強弱關係（鋼琴低音比較厚）保持不變。
 *  倍率有上下限，避免一顆爛檔案把整個樂器放大到破音。
 *
 *  @returns {number} 實際套用的倍率（1 = 沒動）
 */
export function normalizeInstrument(notes, target = 0.7, { min = 0.25, max = 8 } = {}) {
  const peakOf = (pcm) => {
    let peak = 0;
    for (const v of pcm) { const x = Math.abs(v); if (x > peak) peak = x; }
    return peak;
  };
  // 有力度層時只看「最強的那一層」：拿全部層一起算中位數的話，弱層（本來就小 15 dB）
  // 會把基準拉低，整組被放大到破音。
  const peaks = notes.map((n) => {
    // 有 take 的音：peak 取所有 take 的最大值（take 之間在 build 時已經對齊過峰值）
    const takes = Array.isArray(n.takes) ? n.takes : [];
    const layers = Array.isArray(n.layers) && n.layers.length ? n.layers : [n];
    return Math.max(
      ...layers.map((l) => Math.max(peakOf(l.pcm || new Float32Array(0)), peakOf(l.left || new Float32Array(0)), peakOf(l.right || new Float32Array(0)))),
      ...takes.map((t) => peakOf(t || new Float32Array(0))),
    );
  }).filter((p) => p > 0);
  if (!peaks.length) return 1;
  peaks.sort((a, b) => a - b);
  const median = peaks[Math.floor(peaks.length / 2)];
  if (!(median > 0)) return 1;
  const gain = Math.min(max, Math.max(min, target / median));
  if (Math.abs(gain - 1) < 0.01) return 1;
  for (const note of notes) {
    const layers = Array.isArray(note.layers) && note.layers.length ? note.layers : [note];
    for (const layer of layers) {
      const pcm = layer.pcm;
      if (pcm) for (let i = 0; i < pcm.length; i++) pcm[i] *= gain;
      if (layer.left) for (let i = 0; i < layer.left.length; i++) layer.left[i] *= gain;
      if (layer.right) for (let i = 0; i < layer.right.length; i++) layer.right[i] *= gain;
    }
    for (const take of Array.isArray(note.takes) ? note.takes : []) {
      if (!take) continue;
      for (let i = 0; i < take.length; i++) take[i] *= gain;
    }
  }
  return gain;
}

/** 一個樂器要抓的每個檔案：{ midi, vel, url }。`vel` 是 undefined 表示單層樂器；
 *  有力度層的樂器（src/dynamic-library.js）一個音會有好幾個檔。 */
export function sampleUrls(nameOrSpec) {
  const inst = typeof nameOrSpec === 'string' ? SAMPLE_LIBRARY[nameOrSpec] : nameOrSpec;
  if (!inst) return [];
  const out = [];
  for (const [midi, entry] of Object.entries(inst.notes)) {
    if (Array.isArray(entry)) for (const layer of entry) out.push({ midi: +midi, vel: layer.vel, url: inst.base + layer.file });
    // 一個音有多個 take（同一個音的不同次錄音，輪流用）：
    // { takes: ['60-a.mp3', '60-b.mp3'] }。take 不是力度層——兩次吹奏的音色幾乎一樣，
    // 所以不能用 layerMix 交叉淡化（那會讓同一個音變成兩層疊起來）。
    else if (entry && Array.isArray(entry.takes)) entry.takes.forEach((file, take) => out.push({ midi: +midi, vel: undefined, take, url: inst.base + file }));
    else out.push({ midi: +midi, vel: undefined, url: inst.base + entry });
  }
  // 釋音（放開鍵）的檔案也一起抓：它們跟延音樣本同進同出
  if (inst.release) {
    for (const [midi, file] of Object.entries(inst.release.notes)) {
      out.push({ midi: +midi, vel: undefined, url: inst.release.base + file, release: true });
    }
  }
  return out;
}

/** 一個音高在指定力度下要用哪一層：挑「不超過這個力度的最大 vel」。
 *  單層的項目（沒有 layers）就是它自己。 */
export function pickLayer(entry, vel = 1) {
  const layers = entry && entry.layers;
  if (!Array.isArray(layers) || !layers.length) return entry;
  const v = Number.isFinite(vel) ? Math.min(1, Math.max(0, vel)) : 1;
  let chosen = layers[0];
  for (const layer of layers) if (v >= layer.vel) chosen = layer;
  return chosen;
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

/** 一個音在指定力度下要播哪幾層：通常一層，落在交界附近時是兩層交叉淡化。
 *
 *  兩層是**不同的錄音**（不相關），所以用等功率淡化（cos／sin）而不是線性相加——
 *  線性相加在交界處會出現一個凹陷。寬度 0.18 表示「交界前後各 9% 的力度」在混合，
 *  等於用 2 層做出 4 層的平滑感（層數的跳躍被攤平）。
 *
 *  @returns {{ pcm: Float32Array, gain: number }[]} 一到兩個要一起播的層
 */
/** 一個層（或一個項目）身上的立體資訊：有 left/right 就一起帶出去。 */
const stereoOf = (x) => (x && x.left && x.right ? { left: x.left, right: x.right } : null) || {};

export function layerMix(entry, vel = 1, width = 0.18) {
  const layers = entry && entry.layers;
  if (!Array.isArray(layers) || !layers.length) return entry && entry.pcm ? [{ pcm: entry.pcm, gain: 1, ...stereoOf(entry) }] : [];
  const v = Number.isFinite(vel) ? Math.min(1, Math.max(0, vel)) : 1;
  // 交界就是每一層（第 1 層以後）的起點。看 v 有沒有落在某個交界的前後半個窗口內，
  // 兩側對稱處理：剛好在交界上時兩層各 0.707（等功率），跨過窗口就是單層。
  let boundary = -1;
  for (let k = 1; k < layers.length; k++) {
    if (Math.abs(v - layers[k].vel) <= width / 2) { boundary = k; break; }
  }
  if (boundary < 0) {
    let i = 0;
    for (let k = 0; k < layers.length; k++) if (v >= layers[k].vel) i = k;
    return [{ pcm: layers[i].pcm, gain: 1, ...stereoOf(layers[i]) }];
  }
  const below = layers[boundary - 1];
  const above = layers[boundary];
  const t = Math.min(1, Math.max(0, (v - (above.vel - width / 2)) / width));
  const out = [];
  if (below.pcm) out.push({ pcm: below.pcm, gain: Math.cos((t * Math.PI) / 2), ...stereoOf(below) });
  if (above.pcm) out.push({ pcm: above.pcm, gain: Math.sin((t * Math.PI) / 2), ...stereoOf(above) });
  return out;
}

/** 一個音要怎麼用樣本播：挑最近的樣本、挑力度層、挑第幾個 take，以及要套的播放速率
 *  （半音差 → 2^(d/12)）。有力度層時 `layer` 就是選中的那一層；`take` 是有多個錄音
 *  時輪到的那一個（`round` 由呼叫端維護，同一個音連續出現才會輪替，才會「不像機器」）。 */
export function sampleVoice(notes, midi, vel = 1, round = 0) {
  const hit = nearestSample(notes, midi);
  if (!hit) return null;
  const layer = pickLayer(hit, vel);
  const mix = layerMix(hit, vel);
  const take = Array.isArray(hit.takes) && hit.takes.length
    ? hit.takes[Math.abs(Math.trunc(round)) % hit.takes.length]
    : null;
  return {
    sample: hit,
    layer,
    mix,
    take,
    pcm: take || (mix.length ? mix[0].pcm : (layer && layer.pcm ? layer.pcm : hit.pcm)),
    semitones: midi - hit.midi,
    rate: 2 ** ((midi - hit.midi) / 12),
  };
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

/** Start `src` at `when` (default now) and, given `dur`, fade it out after that
 *  many seconds, so a whole score can be scheduled up front. */
export function startAt(ctx, gainNode, src, opts) {
  const when = opts.when !== undefined ? opts.when : ctx.currentTime;
  src.start(when);
  if (opts.dur > 0) {
    const fade = 0.22;
    gainNode.gain.setTargetAtTime(0, when + opts.dur, fade / 4);
    src.stop(when + opts.dur + fade);
  }
}

/** 取樣樂器播放器：載入樣本、挑最近的音、用播放速率補中間的音。
 *  一個實例可以載入多個樂器，各自獨立；載過的樂器不會重抓。
 *  建構子的兩個參數跟其他引擎一樣可以傳值或 getter（AudioContext 要等使用者手勢才會有）。 */
export class SampledInstruments {
  constructor(audioContextOrGetter, outputNodeOrGetter = null) {
    this._ctx = audioContextOrGetter;
    this._output = outputNodeOrGetter;
    this._buffers = new WeakMap();   // pcm -> AudioBuffer（即時播放用，做過就留著）
    /** name -> { notes: [{ midi, layers: [{ vel, pcm }], takes: [pcm], rate }], failed, gain } */
    this.instruments = new Map();
    this._rounds = new Map();      // `${name}|${midi}` -> 下次要用第幾個 take
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

  /** 這個樂器已經有幾個「檔案」可用（跟 wanted() 同一個單位，才能比較）。 */
  loaded(name) {
    const inst = this.instruments.get(name);
    if (!inst) return 0;
    return inst.notes.reduce((n, e) => n + e.layers.length + (Array.isArray(e.takes) ? e.takes.length : 0), 0);
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
  load(nameOrSpec, opts = {}) {
    const spec = typeof nameOrSpec === 'string' ? SAMPLE_LIBRARY[nameOrSpec] : nameOrSpec;
    if (!spec) return Promise.resolve(null);
    const name = spec.name || (typeof nameOrSpec === 'string' ? nameOrSpec : '');
    const running = this._loading.get(name);
    if (running) return running;
    const total = this.wanted(spec);
    if (total > 0 && this.loaded(name) >= total) return Promise.resolve(this.instruments.get(name));
    const p = this._load(name, spec, opts).finally(() => this._loading.delete(name));
    this._loading.set(name, p);
    return p;
  }

  async _load(name, spec, { onProgress, fetchImpl, decode } = {}) {
    const get = fetchImpl || ((url) => fetch(url));
    const decodeBuffer = decode || ((bytes) => this.ctx.decodeAudioData(bytes));
    const urls = sampleUrls(spec);
    let cache = null;
    try {
      if (typeof caches !== 'undefined') cache = await caches.open(this.cacheName);
    } catch {
      cache = null;   // 無痕模式或沒權限：照抓，只是不進快取
    }
    const have = new Map((this.instruments.get(name)?.notes || []).map((n) => [n.midi, n]));
    const notes = new Map([...have.values()].map((n) => [n.midi, { ...n, layers: [...n.layers] }]));
    const release = new Map((this.instruments.get(name)?.release?.notes || []).map((n) => [n.midi, n]));
    let releaseRate = this.instruments.get(name)?.release?.rate || 0;
    let failed = 0;
    let done = 0;
    for (const { midi, vel, url, take, release: isRelease } of urls) {
      if (isRelease && release.has(midi)) { done++; continue; }
      const had = notes.get(midi);
      const already = !isRelease && (take === undefined
        ? had && had.layers.some((l) => l.vel === (vel === undefined ? 0 : vel))
        : had && had.takes && had.takes[take]);
      if (already) { done++; continue; }   // 上次就抓到了（處理過的 pcm 也在），不重抓
      try {
        let res = cache ? await cache.match(url) : null;
        if (!res) {
          res = await get(url);
          if (res && res.ok && cache) { try { cache.put(url, res.clone()); } catch {} }
        }
        if (!res || !res.ok) throw new Error(`${url}: HTTP ${res ? res.status : 'no response'}`);
        const buffer = await decodeBuffer(await res.arrayBuffer());
        if (buffer && buffer.length && isRelease) {
          release.set(midi, { midi, pcm: prepareSample(buffer) });
          if (!releaseRate) releaseRate = buffer.sampleRate || 44100;
        } else if (buffer && buffer.length) {
          const entry = notes.get(midi) || { midi, layers: [], rate: buffer.sampleRate || 44100 };
          entry.rate = buffer.sampleRate || 44100;
          if (take === undefined) {
            const prepared = prepareSampleChannels(buffer);
            entry.layers.push({
              vel: vel === undefined ? 0 : vel,
              pcm: prepared.mono,
              ...(prepared.left && prepared.right ? { left: prepared.left, right: prepared.right } : {}),
            });
          }
          else {
            if (!Array.isArray(entry.takes)) entry.takes = [];
            entry.takes[take] = prepareSample(buffer);
          }
          notes.set(midi, entry);
        } else failed++;
      } catch (err) {
        failed++;   // 單一檔案壞掉不該讓整個樂器不能用：有幾個樣本用幾個
        if (typeof console !== 'undefined') console.warn(`[samples] ${name} ${url}: ${err.message}`);
      }
      done++;
      if (onProgress) onProgress(done, urls.length, name);
    }
    const sorted = [...notes.values()].sort((a, b) => a.midi - b.midi);
    for (const entry of sorted) {
      entry.layers.sort((a, b) => a.vel - b.vel);
      if (Array.isArray(entry.takes)) entry.takes = entry.takes.filter(Boolean);
    }
    // 樂器之間的基準音量：鋼琴原本比別人小 6 dB（見 normalizeInstrument）
    const gain = normalizeInstrument(sorted);
    const hit = {
      notes: sorted,
      failed,
      gain,
      ...(release.size ? { release: { rate: releaseRate || 44100, notes: [...release.values()].sort((a, b) => a.midi - b.midi) } } : {}),
    };
    if (sorted.length) this.instruments.set(name, hit);
    this.loadedCount = sorted.reduce((n, e) => n + e.layers.length, 0);
    this.total = urls.length;
    return hit;
  }

  /** 即時播放要用的 AudioBuffer：由處理過的 pcm 現做一顆並快取（第一次播那個音才做）。
   *  這樣記憶體只留一份單聲道、切過開頭的資料，而不是每顆樣本都留原本的立體聲解碼結果。 */
  bufferFor(pcm, rate) {
    if (!pcm || !pcm.length) return null;
    const hit = this._buffers.get(pcm);
    if (hit) return hit;
    const ctx = this.ctx;
    if (!ctx) return null;
    const buf = ctx.createBuffer(1, pcm.length, rate || 44100);
    buf.copyToChannel(pcm, 0);
    this._buffers.set(pcm, buf);
    return buf;
  }

  /** 即時播放要用的立體 AudioBuffer（兩聲道，由處理過的 pcm 現做並快取）。 */
  stereoBufferFor(left, right, rate) {
    if (!left || !right || !left.length) return null;
    const hit = this._buffers.get(left);
    if (hit) return hit;
    const ctx = this.ctx;
    if (!ctx) return null;
    const len = Math.min(left.length, right.length);
    const buf = ctx.createBuffer(2, len, rate || 44100);
    buf.copyToChannel(left.subarray(0, len), 0);
    buf.copyToChannel(right.subarray(0, len), 1);
    this._buffers.set(left, buf);
    return buf;
  }

  /** 挑最近的樣本（沒載入或沒樣本時 null）。 */
  findBest(name, midi) {
    const inst = this.instruments.get(name);
    if (!inst || !inst.notes.length) return null;
    const v = sampleVoice(inst.notes, midi);
    const pair = v.take ? null : (v.mix.find((m) => m.left && m.right) || null);
    const buffer = pair ? this.stereoBufferFor(pair.left, pair.right, inst.notes[0].rate) : this.bufferFor(v.pcm, inst.notes[0].rate);
    return { midi: v.sample.midi, buffer: buffer || null };
  }

  /** 播一個音。樣本還沒到時回傳 null，讓呼叫端自己決定要用哪個合成音色代替。 */
  playNote(name, note, opts = {}) {
    const ctx = this.ctx;
    if (!ctx) return null;
    const inst = this.instruments.get(name);
    if (!inst || !inst.notes.length) return null;
    // 同一個音連續按（或 MIDI 裡同一個音連續出現）時輪流用不同的 take：
    // 每次都播同一段波形是「這是取樣」最明顯的破綻。
    const key = `${name}|${note}`;
    const round = this._rounds.get(key) || 0;
    this._rounds.set(key, round + 1);
    const v = sampleVoice(inst.notes, note, opts.vel === undefined ? 0.85 : opts.vel, round);
    // 立體樣本（鋼琴）用兩聲道播：它的左右是兩支不同視角的麥克風，混成單聲道就是
    // 丟掉半個錄音，而且會抵消。
    const pair = v.take ? null : (v.mix.find((m) => m.left && m.right) || null);
    const buffer = pair
      ? this.stereoBufferFor(pair.left, pair.right, inst.notes[0].rate)
      : this.bufferFor(v.pcm, inst.notes[0].rate);
    if (!buffer) return null;
    if (ctx.state === 'suspended') ctx.resume();

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = v.rate;
    const gainNode = ctx.createGain();
    gainNode.gain.value = Math.max(0, Math.min(1, (opts.vel === undefined ? 0.85 : opts.vel) * (opts.gain === undefined ? 0.9 : opts.gain)));
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

  /** 給離線算 MIDI 用的樣子：{ rate, notes: [{ midi, pcm }] }（取樣率是 AudioContext 的）。
   *  單聲道與開頭靜音的處理在 prepareSample 裡（載入時就做完了）。 */
  pcm(name) {
    const inst = this.instruments.get(name);
    if (!inst || !inst.notes.length) return null;
    return {
      rate: inst.notes[0].rate || 44100,
      notes: inst.notes.map((n) => ({ midi: n.midi, layers: n.layers, ...(n.takes ? { takes: n.takes } : {}) })),
      ...(inst.release
        ? { release: { rate: inst.release.rate, kit: Object.fromEntries(inst.release.notes.map((n) => [n.midi, [{ vel: 0, gain: 1, pcm: [n.pcm] }]])) } }
        : {}),
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
