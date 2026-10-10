// 真實鼓組的引擎：一個擊點一個錄音，所以比旋律樂器單純——不用挑最近的音高、
// 不用變速，只要「挑力度層 → 挑 round robin → 混進去」。
//
// 資料表（GM 打擊樂音 → 檔名）由 tools/build-drums.mjs 產生，放在 page/drum-library.js；
// 這裡只認得那個資料的形狀，所以任何一套自備鼓組都能用同一個引擎。
//
// 鼓是 one-shot：MIDI 的 note-off 不該把它切掉（真實的鼓打下去就是讓它響完），
// 這跟旋律樂器的 release 淡出不一樣。

/** 真實鼓組在 renderMidi／樂器選單裡的名字（跟 chip／real／sampled:<樂器> 並列）。 */
export const SAMPLE_KIT = 'sampled:kit';

/** 一個擊點要播哪個錄音：力度決定層（取不超過它的最大 vel），round robin 由
 *  `counter` 決定——同一個力度層有幾個錄音就輪流用，連續打才不會像機器。
 *  回傳 { pcm, gain }，沒有對應的層或錄音時回傳 null（呼叫端自己退回合成鼓）。 */
export function pickHit(layers, vel, counter = 0) {
  if (!Array.isArray(layers) || !layers.length) return null;
  const v = Number.isFinite(vel) ? Math.min(1, Math.max(0, vel)) : 1;
  let chosen = layers[0];
  for (const layer of layers) if (v >= layer.vel) chosen = layer;
  const pcm = chosen.pcm;
  if (!Array.isArray(pcm) || !pcm.length) return null;
  const at = Math.abs(Math.trunc(counter)) % pcm.length;
  return { pcm: pcm[at], gain: chosen.gain };
}

/** GM 打擊樂音裡有取樣的那些（給 UI 顯示覆蓋率）。 */
export const kitNotes = (kit) => Object.keys(kit.notes).map(Number).sort((a, b) => a - b);

/** 這一擊在資料表裡有沒有取樣。 */
export const kitHas = (kit, note) => Array.isArray(kit.notes[note]) && kit.notes[note].length > 0;

/** 取樣鼓組：抓檔、解碼、快取，然後把資料整理成 renderMidi 認得的樣子。
 *  跟 SampledInstruments 一樣，載入過的鼓組不會重抓，抓不到的那幾個就少那幾個音。 */
export class SampledKit {
  constructor(audioContextOrGetter, outputNodeOrGetter = null) {
    this._ctx = audioContextOrGetter;
    this._output = outputNodeOrGetter;
    /** kit name -> { rate, notes: { midi: [{ vel, gain, pcm: [Float32Array] }] } } */
    this.kits = new Map();
    this._loading = new Map();
    this.loadedCount = 0;
    this.total = 0;
    this.cacheName = 'chiptune-samples-v1';   // 跟旋律樂器的樣本共用同一個快取
  }

  get ctx() {
    return typeof this._ctx === 'function' ? this._ctx() : this._ctx;
  }

  get targetNode() {
    const out = typeof this._output === 'function' ? this._output() : this._output;
    return out || (this.ctx ? this.ctx.destination : null);
  }

  /** 這個鼓組已經有幾個「錄音檔」可用（跟 wanted() 同一個單位，才能比較）。 */
  loaded(kit = 'kit') {
    const hit = this.kits.get(kit || 'kit');
    if (!hit) return 0;
    return Object.values(hit.notes).reduce((n, layers) => n + layers.reduce((m, l) => m + l.pcm.length, 0), 0);
  }

  /** 這個鼓組一共要抓幾個檔案。 */
  wanted(kit) {
    return Object.values(kit.notes).reduce((n, layers) => n + layers.reduce((m, l) => m + l.files.length, 0), 0);
  }

  loading(name = 'kit') {
    return this._loading.has(name);
  }

  /** 載入一個鼓組。已經抓完的直接回傳，正在載就等同一個 promise；只抓到一半時
   *  下一次只補缺的檔案（跟 SampledInstruments 一樣的規則）。 */
  load(kit, opts = {}) {
    const name = kit && kit.name ? kit.name : 'kit';
    const running = this._loading.get(name);
    if (running) return running;
    const total = this.wanted(kit);
    if (total > 0 && this.loaded(name) >= total) return Promise.resolve(this.kits.get(name));
    const p = this._load(kit, opts).finally(() => this._loading.delete(name));
    this._loading.set(name, p);
    return p;
  }

  async _load(kit, { onProgress, fetchImpl, decode } = {}) {
    const name = kit && kit.name ? kit.name : 'kit';
    const get = fetchImpl || ((url) => fetch(url));
    const decodeBuffer = decode || ((bytes) => this.ctx.decodeAudioData(bytes));
    const base = kit.base || '';
    const have = this.kits.get(name);
    const notes = {};
    let cache = null;
    try {
      if (typeof caches !== 'undefined') cache = await caches.open(this.cacheName);
    } catch {
      cache = null;   // 無痕模式或沒權限：照抓，只是不進快取
    }

    // 這個鼓組要抓的每個檔案，同一個檔案可能被多個力度層用到
    const jobs = [];
    for (const [midi, layers] of Object.entries(kit.notes)) {
      for (const [i, layer] of layers.entries()) {
        for (const [j, file] of layer.files.entries()) {
          const done = have && have.notes[midi] && have.notes[midi][i] && have.notes[midi][i].pcm[j];
          jobs.push({ midi: +midi, i, j, url: base + file, keep: done });
        }
      }
    }

    const pcmOf = new Map();      // url -> Float32Array
    let rate = 0;                 // 解碼後的取樣率（＝AudioContext 的），混音要用
    let failed = 0;
    let done = 0;
    for (const job of jobs) {
      if (job.keep) {
        pcmOf.set(job.url, have.notes[job.midi][job.i].pcm[job.j]);
        done++;
        if (onProgress) onProgress(done, jobs.length, name);
        continue;
      }
      try {
        let res = cache ? await cache.match(job.url) : null;
        if (!res) {
          res = await get(job.url);
          if (res && res.ok && cache) { try { cache.put(job.url, res.clone()); } catch {} }
        }
        if (!res || !res.ok) throw new Error(`${job.url}: HTTP ${res ? res.status : 'no response'}`);
        const buffer = await decodeBuffer(await res.arrayBuffer());
        if (buffer && buffer.length) {
          pcmOf.set(job.url, buffer.getChannelData(0));
          if (!rate) rate = buffer.sampleRate || 44100;
        } else failed++;
      } catch (err) {
        failed++;   // 單一檔案壞掉不該讓整套鼓不能用
        if (typeof console !== 'undefined') console.warn(`[drums] ${job.url}: ${err.message}`);
      }
      done++;
      if (onProgress) onProgress(done, jobs.length, name);
    }

    for (const [midi, layers] of Object.entries(kit.notes)) {
      const out = [];
      for (const [i, layer] of layers.entries()) {
        const kept = have && have.notes[midi] && have.notes[midi][i] ? have.notes[midi][i].pcm : [];
        const pcm = layer.files.map((file, j) => pcmOf.get(base + file) || kept[j]).filter(Boolean);
        if (!pcm.length) continue;
        out.push({ vel: layer.vel, gain: layer.gain, pcm });
      }
      if (out.length) notes[+midi] = out;
    }
    const hit = { rate: rate || (have && have.rate) || 44100, notes, failed };
    if (Object.keys(notes).length) this.kits.set(name, hit);
    this.loadedCount = Object.values(notes).reduce((n, layers) => n + layers.reduce((m, l) => m + l.pcm.length, 0), 0);
    this.total = jobs.length;
    return hit;
  }

  /** 給 renderMidi 用的樣子：{ 'sampled:kit': { rate, kit: { midi: [{vel, gain, pcm}] } } }。
   *  rate 是解碼後的取樣率＝AudioContext 的（通常是 48 kHz），混音要拿它換算。 */
  voices(instrument = 'sampled:kit', name = 'kit') {
    const hit = this.kits.get(name);
    if (!hit) return null;
    return { [instrument]: { rate: hit.rate || 44100, kit: hit.notes } };
  }
}
