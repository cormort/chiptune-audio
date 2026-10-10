// 產生這個專案用的真實鼓組：把 Virtuosity Drums（CC0 1.0，Versilian Studios ×
// Karoryfer Samples）的擊點，轉成單聲道 44.1 kHz 的小 mp3 放進 samples/drums/，
// 並產生 page/drum-library.js（GM 打擊樂音 → 檔名／力度層／基準音量）。
//
// 為什麼要轉檔而不是直接抓原始 FLAC：
//   * 原始檔是 48 kHz 立體聲，單一擊點 200 KB～1.4 MB，整個 GM 打擊樂範圍要幾十 MB
//   * 鼓是單發音、不需要音高內插，所以可以大幅壓縮（單聲道 96 kbps，一個擊點 5～35 KB）
//   * 放進 repo 就隨按即響、離線可打，不必像旋律樂器那樣等第一次下載
//
// 需要的東西：Node 18+、ffmpeg（含 libmp3lame）、網路。輸出檔案已進版控，
// 平常不需要重跑；改了 CURATION 或想換力度層數才跑：
//
//   node tools/build-drums.mjs            # 只轉缺的檔案
//   node tools/build-drums.mjs --force    # 全部重轉
//
// 轉檔的處理（每一擊點都一樣，這樣才可預期）：去掉開頭靜音（保留 3 ms）、
// 依設定的長度切尾、尾端 60 ms 淡出、正規化到 0.9 峰值。力度層只改變音色，
// 音量交給播放時的 gain（= velocity × 這個擊點的基準音量）。
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'samples', 'drums');
const LIB_FILE = join(ROOT, 'page', 'drum-library.js');
const SRC_CACHE = '/tmp/chiptune-drums';
const SRC = 'https://raw.githubusercontent.com/sfzinstruments/virtuosity_drums/master/';
const FORCE = process.argv.includes('--force');

const RATE = 44100;
const PEAK = 0.9;          // 每個擊點正規化到的峰值
const ONSET_FLOOR = 0.02;  // 用峰值的 2% 當「聲音開始」
const FADE = 0.06;         // 尾端淡出秒數

/**
 * 要哪幾顆鼓：GM 音號、來源 map 檔、力度層數、round robin 數、切多長、基準音量。
 * `map` 相對於來源 repo 的 Programs/mappings/。
 * 基準音量是「這個擊點在整套鼓裡該多大聲」——峰值都正規化過了，所以平衡要在這裡給。
 */
const CURATION = [
  // ---- 鼓組 ----
  { note: 36, map: 'mid/kick_snoff_map', layers: 3, rr: 2, trim: 0.8, gain: 1 },
  { note: 35, map: 'mid/kick_snon_map', layers: 2, rr: 1, trim: 0.8, gain: 1 },
  { note: 38, map: 'mid/snare_center_map', layers: 4, rr: 2, trim: 0.7, gain: 0.95 },
  { note: 40, map: 'mid/snare_rimshot_map', layers: 2, rr: 1, trim: 0.6, gain: 0.8 },
  { note: 37, map: 'mid/snare_crossstick_map', layers: 2, rr: 1, trim: 0.5, gain: 0.75 },
  { note: 39, map: 'mid/snare_offcenter_map', layers: 2, rr: 1, trim: 0.7, gain: 0.9 },
  { note: 41, map: 'mid/ltom_center_map', layers: 2, rr: 1, trim: 1.2, gain: 0.85 },
  { note: 43, map: 'mid/ltom_offcenter_map', layers: 2, rr: 1, trim: 1.2, gain: 0.85 },
  { note: 45, map: 'mid/ltom_rimshot_map', layers: 2, rr: 1, trim: 1.0, gain: 0.8 },
  { note: 47, map: 'mid/ltom_muted_map', layers: 2, rr: 1, trim: 0.8, gain: 0.8 },
  { note: 48, map: 'mid/htom_center_map', layers: 2, rr: 1, trim: 1.0, gain: 0.85 },
  { note: 50, map: 'mid/htom_offcenter_map', layers: 2, rr: 1, trim: 1.0, gain: 0.85 },
  { note: 42, map: 'mid/hh_closed_map', layers: 3, rr: 2, trim: 0.5, gain: 0.65 },
  { note: 44, map: 'mid/hh_pedal_map', layers: 2, rr: 2, trim: 0.35, gain: 0.6 },
  { note: 46, map: 'mid/hh_open_map', layers: 3, rr: 2, trim: 1.6, gain: 0.7 },
  { note: 49, map: 'mid/crash_crash_map', layers: 3, rr: 1, trim: 3.0, gain: 0.75 },
  { note: 57, map: 'mid/crash_sizzle_map', layers: 2, rr: 1, trim: 2.5, gain: 0.7 },
  { note: 55, map: 'mid/flatride_crash_map', layers: 2, rr: 1, trim: 2.0, gain: 0.7 },
  { note: 51, map: 'mid/ride_ride_map', layers: 3, rr: 1, trim: 2.5, gain: 0.6 },
  { note: 53, map: 'mid/ride_bell_map', layers: 2, rr: 1, trim: 1.5, gain: 0.6 },
  { note: 59, map: 'mid/flatride_ride_map', layers: 2, rr: 1, trim: 2.5, gain: 0.6 },
  // ---- 打擊樂配件（GM 54-84 這一段）----
  { note: 54, map: 'perc/mid/tambourine_map', layers: 2, rr: 1, trim: 0.8, gain: 0.55 },
  { note: 56, map: 'perc/mid/cowbell_map', layers: 2, rr: 1, trim: 1.0, gain: 0.5 },
  { note: 58, map: 'perc/mid/vibraslap_map', layers: 1, rr: 1, trim: 1.5, gain: 0.6 },
  { note: 60, map: 'perc/mid/bongo_high_map', layers: 2, rr: 1, trim: 0.5, gain: 0.7 },
  { note: 61, map: 'perc/mid/bongo_low_map', layers: 2, rr: 1, trim: 0.5, gain: 0.7 },
  { note: 62, map: 'perc/mid/conga_muted_map', layers: 2, rr: 1, trim: 0.6, gain: 0.7 },
  { note: 63, map: 'perc/mid/conga_open_map', layers: 2, rr: 1, trim: 0.8, gain: 0.75 },
  { note: 64, map: 'perc/mid/tumba_map', layers: 2, rr: 1, trim: 0.9, gain: 0.75 },
  { note: 67, map: 'perc/mid/agogo_high_map', layers: 2, rr: 1, trim: 0.8, gain: 0.55 },
  { note: 68, map: 'perc/mid/agogo_low_map', layers: 2, rr: 1, trim: 0.8, gain: 0.55 },
  { note: 69, map: 'perc/mid/cabasa_map', layers: 1, rr: 1, trim: 0.4, gain: 0.4 },
  { note: 70, map: 'perc/mid/shaker_down_map', layers: 2, rr: 1, trim: 0.4, gain: 0.4 },
  { note: 82, map: 'perc/mid/shaker_up_map', layers: 1, rr: 1, trim: 0.4, gain: 0.4 },
  { note: 71, map: 'perc/mid/whistle_short_map', layers: 1, rr: 1, trim: 0.6, gain: 0.5 },
  { note: 72, map: 'perc/mid/whistle_long_map', layers: 1, rr: 1, trim: 1.2, gain: 0.5 },
  { note: 73, map: 'perc/mid/guiro_slow_map', layers: 1, rr: 1, trim: 0.8, gain: 0.5 },
  { note: 74, map: 'perc/mid/guiro_fast_map', layers: 1, rr: 1, trim: 0.6, gain: 0.5 },
  { note: 75, map: 'perc/mid/claves_map', layers: 2, rr: 1, trim: 0.4, gain: 0.6 },
  { note: 80, map: 'perc/mid/triangle_muted_map', layers: 2, rr: 1, trim: 0.8, gain: 0.5 },
  { note: 81, map: 'perc/mid/triangle_open_map', layers: 2, rr: 1, trim: 2.5, gain: 0.5 },
  { note: 83, map: 'perc/mid/jinglebell_map', layers: 2, rr: 1, trim: 1.0, gain: 0.45 },
  { note: 84, map: 'perc/mid/belltree_map', layers: 2, rr: 1, trim: 2.5, gain: 0.45 },
];

/** 目前沒有取樣的 GM 打擊樂音（會退回合成鼓，不是靜音）。 */
const MISSING = [52, 65, 66, 76, 77, 78, 79, 85, 86, 87];

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { maxBuffer: 1 << 28, ...opts });

/** 把 SFZ 的 <region> 解析成 { path, lovel, hivel, rr }。 */
function parseRegions(text) {
  const out = [];
  for (const block of text.split('<region>').slice(1)) {
    const get = (k) => (block.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1];
    const sample = get('sample');
    if (!sample) continue;
    out.push({
      path: sample.replace(/^\.\.\//, ''),
      lovel: Number(get('lovel') || 1),
      hivel: Number(get('hivel') || 127),
      rr: Number(get('seq_position') || 1),
    });
  }
  return out;
}

/** 抓來源檔案（快取在 /tmp，重跑不用重新下載）。 */
function fetchSource(path) {
  const local = join(SRC_CACHE, path.replace(/\//g, '_'));
  if (existsSync(local) && !FORCE) return local;
  mkdirSync(SRC_CACHE, { recursive: true });
  const url = SRC + path.split('/').map(encodeURIComponent).join('/');
  const res = sh('curl', ['-sfL', url]);
  writeFileSync(local, res);
  return local;
}

/** FLAC → 單聲道 f32 44.1 kHz。 */
function decode(file, seconds) {
  const buf = sh('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(RATE), '-t', String(seconds + 0.5), '-']);
  // Buffer 可能是共用的大 ArrayBuffer 裡的一段，先複製再轉，避免對齊問題
  const copy = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(copy, 0, Math.floor(copy.byteLength / 4));
}

/** 去掉開頭靜音、切長度、尾端淡出、正規化。 */
function shape(pcm, seconds) {
  let peak = 0;
  for (const v of pcm) peak = Math.max(peak, Math.abs(v));
  if (peak <= 0) throw new Error('silent sample');
  const floor = peak * ONSET_FLOOR;
  let start = 0;
  while (start < pcm.length && Math.abs(pcm[start]) < floor) start++;
  start = Math.max(0, start - Math.round(0.003 * RATE));
  const len = Math.min(pcm.length - start, Math.round(seconds * RATE));
  const out = new Float32Array(len);
  const fadeLen = Math.min(Math.round(FADE * RATE), len);
  const scale = PEAK / peak;
  for (let i = 0; i < len; i++) {
    const fade = i >= len - fadeLen ? (len - i) / fadeLen : 1;
    out[i] = pcm[start + i] * scale * fade;
  }
  return out;
}

/** 正規化後的 f32 轉成單聲道 mp3。 */
function encode(pcm, dest) {
  const raw = join(SRC_CACHE, 'tmp.raw');
  writeFileSync(raw, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  sh('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', raw, '-c:a', 'libmp3lame', '-b:a', '96k', dest]);
  rmSync(raw, { force: true });
}

/** 挑一個 region：先在涵蓋這個力度中心的那些裡面找指定的 round robin，
 *  沒有就退而求其次（同一個力度帶裡任何一個、再不然全部裡最接近的）。 */
function pickRegion(regions, centre, rr) {
  const inBand = regions.filter((r) => centre >= r.lovel && centre <= r.hivel);
  const pool = inBand.length ? inBand : regions;
  const exact = pool.filter((r) => r.rr === rr);
  const use = exact.length ? exact : pool;
  const mid = (r) => (r.lovel + r.hivel) / 2;
  return [...use].sort((a, b) => Math.abs(centre - mid(a)) - Math.abs(centre - mid(b)))[0];
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const notes = {};
  const mapCache = new Map();
  let made = 0;
  let bytes = 0;
  let reused = 0;

  for (const item of CURATION) {
    const mapPath = `Programs/mappings/${item.map}.sfz`;
    if (!mapCache.has(mapPath)) {
      const text = sh('curl', ['-sfL', SRC + mapPath]).toString();
      if (!text.includes('<region>')) throw new Error(`${mapPath} has no regions (wrong name?)`);
      mapCache.set(mapPath, parseRegions(text));
    }
    const regions = mapCache.get(mapPath);
    const layers = [];
    for (let i = 0; i < item.layers; i++) {
      // 力度層：把 1-127 切成 `layers` 段，每一段取涵蓋該段中心的錄音
      const centre = Math.round((i + 0.5) * 127 / item.layers);
      const files = [];
      for (let r = 1; r <= item.rr; r++) {
        const region = pickRegion(regions, centre, r);
        if (!region) throw new Error(`${item.map}: no region for layer ${i + 1} rr ${r}`);
        const name = item.rr > 1 ? `${item.note}-v${i + 1}-r${r}.mp3` : `${item.note}-v${i + 1}.mp3`;
        const dest = join(OUT_DIR, name);
        if (!existsSync(dest) || FORCE) {
          encode(shape(decode(fetchSource(region.path), item.trim), item.trim), dest);
          made++;
        } else {
          reused++;
        }
        bytes += readFileSync(dest).length;
        files.push(name);
      }
      layers.push({ vel: Number((i / item.layers).toFixed(3)), gain: item.gain, files });
    }
    notes[item.note] = layers;
    console.log(`  ${String(item.note).padStart(3)}  ${item.map.padEnd(34)} ${item.layers} 層 ×${item.rr}  ${item.trim}s`);
  }

  const sorted = Object.fromEntries(Object.keys(notes).map(Number).sort((a, b) => a - b).map((k) => [k, notes[k]]));
  const out = `// 真實鼓組的資料表（產生的，不是手寫的）：GM 打擊樂音 → 力度層與檔名。
//
// 來源：Virtuosity Drums（Versilian Studios × Karoryfer Samples，CC0 1.0）——
// 轉檔方式與授權見 samples/drums/README.md 與 tools/build-drums.mjs。
// 每個擊點的峰值都正規化到 ${PEAK}，所以這裡的 gain 是「這個擊點在整套鼓裡該多大聲」，
// 播放時再乘上力度；力度層只改變音色，不是音量。
//
// 檔案放 samples/drums/：跟 repo 同源、進 service worker 快取，所以第一次打就響、離線也能打。

/** 一個力度層：vel 是這一層的起點（0..1，由弱到強），gain 是這個擊點的基準音量，
 *  files 是同一個力度下的幾個錄音（round robin，播放時輪流用，連續打才不會像機器）。 */
export const DRUM_KIT = {
  name: 'kit',
  label: '真實鼓組',
  credit: 'Virtuosity Drums — Versilian Studios × Karoryfer Samples（CC0 1.0）',
  base: 'samples/drums/',
  /** 沒有取樣的 GM 打擊樂音：播放時退回合成鼓，不會變成靜音。 */
  missing: [${MISSING.join(', ')}],
  notes: {
${Object.entries(sorted).map(([note, ls]) => `    ${note}: [${ls.map((l) => `{ vel: ${l.vel}, gain: ${l.gain}, files: [${l.files.map((f) => `'${f}'`).join(', ')}] }`).join(', ')}],`).join('\n')}
  },
};
`;
  writeFileSync(LIB_FILE, out);
  console.log(`\n寫入 ${Object.keys(sorted).length} 個音、${made} 個新檔案（沿用 ${reused} 個已存在的），檔案共 ${kb(bytes)}`);
}

main();
