// 產生「取樣樂器」時共用的步驟：抓檔、解碼、挑聲道、切頭尾、對齊 take、量音高、編碼、
// 寫資料表、清孤兒檔。tools/build-flute.mjs 與 tools/build-strings.mjs 都用這一組。
//
// 這裡的每一個決定都是量出來的，數字與理由見 AGENTS.md 的「Measuring audio」一節：
//  * 立體來源**不取平均**：量左、右、相加三個候選，取能量最大的（相加常常是抵消）。
//  * 開頭靜音要切掉（來源有 24–50 ms 的數位空白）。
//  * 同一個音的多個 take **各自對齊到同一個峰值**：不然輪流用會忽大忽小。
//  * 音高用**諧波求和**量，不是找最強的峰——長笛有 take 的基頻比第二泛音弱 7 dB。
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const RATE = 44100;
export const sh = (cmd, args) => execFileSync(cmd, args, { maxBuffer: 1 << 29 });

// ---- 解碼 ----------------------------------------------------------------------

/** 兩聲道 f32 44.1 kHz（只解到需要的長度）。 */
export function decodeChannels(file, seconds) {
  const buf = sh('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(RATE), '-t', String(seconds + 0.4), '-']);
  const copy = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const st = new Float32Array(copy, 0, Math.floor(copy.byteLength / 4));
  const frames = st.length >> 1;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) { left[i] = st[2 * i]; right[i] = st[2 * i + 1]; }
  return { left, right };
}

/** 立體 → 單聲道：量左／右／相加三個候選的能量，取最大的（見檔頭）。 */
export function pickChannel(file, seconds) {
  const { left, right } = decodeChannels(file, seconds);
  const frames = left.length;
  const mid = new Float32Array(frames);
  const energy = [0, 0, 0];
  for (let i = 0; i < frames; i++) {
    mid[i] = (left[i] + right[i]) / 2;
    energy[0] += left[i] * left[i];
    energy[1] += right[i] * right[i];
    energy[2] += mid[i] * mid[i];
  }
  if (energy[0] === energy[1] && energy[1] === energy[2]) return left;   // 單聲道來源
  const best = energy.indexOf(Math.max(...energy));
  return [left, right, mid][best];
}

// ---- 整形 ----------------------------------------------------------------------

/** 去掉開頭靜音（保留 preroll 秒）、切到 seconds 秒、尾端 60 ms 淡出。 */
export function shape(pcm, seconds, { fade = 0.06, floor = 0.01, preroll = 0.003 } = {}) {
  let peak = 0;
  for (const v of pcm) peak = Math.max(peak, Math.abs(v));
  if (peak <= 0) throw new Error('silent sample');
  const at = peak * floor;
  let start = 0;
  while (start < pcm.length && Math.abs(pcm[start]) < at) start++;
  start = Math.max(0, start - Math.round(preroll * RATE));
  const len = Math.min(pcm.length - start, Math.round(seconds * RATE));
  const out = new Float32Array(len);
  const fadeLen = Math.min(Math.round(fade * RATE), len);
  for (let i = 0; i < len; i++) out[i] = pcm[start + i] * (i >= len - fadeLen ? (len - i) / fadeLen : 1);
  return out;
}

export const peakOf = (pcm) => { let p = 0; for (const v of pcm) p = Math.max(p, Math.abs(v)); return p; };

/** 同一個音的多個 take 對齊到同一個峰值（就地縮放）。回傳套用的倍率。 */
export function matchTakes(takes) {
  const target = Math.max(...takes.map(peakOf));
  return takes.map((pcm) => {
    const g = target / (peakOf(pcm) || 1);
    for (let i = 0; i < pcm.length; i++) pcm[i] *= g;
    return g;
  });
}

export function encode(pcm, dest, { cache, kbps = 96 } = {}) {
  const raw = join(cache, 'tmp.raw');
  mkdirSync(cache, { recursive: true });
  writeFileSync(raw, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  sh('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', raw,
    '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, dest]);
  rmSync(raw, { force: true });
}

// ---- 音高 ----------------------------------------------------------------------

function fftInPlace(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
      }
    }
  }
}

/** 基頻：一次 FFT + 頻域諧波求和，再往下檢查 f/2、f/3（避免八度誤判）。
 *  找最強的峰在真實樂器上會錯：長笛某個 take 的基頻比第二泛音弱 7 dB。 */
export function measureHz(pcm) {
  const N = 32768;
  const from = Math.min(Math.round(0.15 * RATE), Math.max(0, pcm.length - N - 1));
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N && from + i < pcm.length; i++) re[i] = pcm[from + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  fftInPlace(re, im);
  const binHz = RATE / N;
  const mag = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  const at = (f) => {
    const idx = Math.round(f / binHz);
    if (idx < 1 || idx >= mag.length) return 0;
    return Math.max(mag[idx - 1], mag[idx], mag[idx + 1]);
  };
  const score = (f) => { let s = 0; for (let k = 1; k <= 5; k++) s += at(f * k) / k; return s; };
  let best = -1, bestF = 0;
  for (let f = 55; f <= 2400; f += 0.5) { const m = score(f); if (m > best) { best = m; bestF = f; } }
  for (const k of [2, 3, 4]) {
    const sub = bestF / k;
    if (sub < 40) continue;
    if (score(sub) >= best * 0.85) return sub;
  }
  return bestF;
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (midi) => NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
/** 量到的頻率最接近哪個音號（用來**忽略檔名的八度慣例**：以量到的音高為準）。 */
export const midiOfHz = (hz) => Math.round(69 + 12 * Math.log2(hz / 440));

// ---- 收尾 ----------------------------------------------------------------------

/** 刪掉資料表沒有引用的檔案（改過檔名或改過音高對應時留下的孤兒）。 */
export function cleanOrphans(dir, expected) {
  let removed = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.mp3') || expected.has(f)) continue;
    rmSync(join(dir, f), { force: true });
    removed++;
  }
  return removed;
}

export const writeFile = (path, body) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, body); };
export const exists = existsSync;
