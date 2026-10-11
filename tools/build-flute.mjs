// 產生長笛的取樣：VSCO 2 Community Edition 的 `Woodwinds/Flute/susNV`（CC0 1.0）。
//
// 為什麼要換掉原本的 tonejs-instruments 長笛（同一批 VSCO 素材，但取樣者挑的音域不同）：
//
//  1. **檔名的音高比實際低一個八度**（跟卡林巴那份來源一樣的陷阱）。量過：
//     `LDFlute_susNV_C3_v1_1.wav` 裡是 261.6 Hz（C4），130.8 Hz 的位置是 −51 dB；
//     最高那個檔 `C6` 裡是 2093 Hz（C7）。所以音號＝檔名 **+12**，實際音域 C4–C7，
//     跟長笛這件樂器本身的音域一致（也跟原本 tonejs 那版一樣）。
//     這件事一定要量：照檔名走的話整把樂器會低一個八度。
//  2. **同一個音不會一模一樣**。VSCO 每個音有 **v1/v3 兩個 take**（同一天、同一支笛子、
//     兩次吹奏，量起來差約 4 dB、音色幾乎一樣——所以它們是 takes，不是力度層）。
//     兩個 take 輪流用（round robin）之後，重複的音就不再是同一段波形：
//     之前量到〈給愛麗絲〉開頭的三個 E5，第 2 與第 3 個的相關性是 **1.000000**。
//
// 需要的東西：Node 18+、ffmpeg（含 libmp3lame）、網路。輸出已進版控，平常不用重跑。
//
//   node tools/build-flute.mjs            # 只轉缺的檔案
//   node tools/build-flute.mjs --force    # 全部重轉
//
// 每個 take 的處理：單聲道 44.1 kHz（立體來源量過左／右／相加再取最好的）、去掉開頭
// 靜音（保留 3 ms）、切到 `SECONDS` 秒、尾端 60 ms 淡出，最後**同一個音的兩個 take
// 對齊到同一個峰值**（不然輪流用會忽大忽小）。
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'samples', 'flute');
const LIB_FILE = join(ROOT, 'src', 'flute-library.js');
const SRC_CACHE = '/tmp/chiptune-flute';
const REPO = 'sgossner/VSCO-2-CE';
const SRC_DIR = 'Woodwinds/Flute/susNV';
const SRC = `https://raw.githubusercontent.com/${REPO}/master/`;
const CREDIT = 'VSCO 2 Community Edition — Flute/susNV（CC0 1.0）';
const FORCE = process.argv.includes('--force');

const RATE = 44100;
const SECONDS = 4;          // 長笛的長音：4 秒對旋律夠用，再長只是檔案變大
const FADE = 0.06;
const ONSET_FLOOR = 0.01;
const PREROLL = 0.003;
const REFERENCE = 0.7;      // 樂器內部各音之間（不是 take 之間）的基準改用 normalizeInstrument

/** 來源：音名 → 這個音有哪幾個 take 的檔名（v1／v3，C6 只有一個）。 */
const SOURCES = {
  C3: ['LDFlute_susNV_C3_v1_1.wav', 'LDFlute_susNV_C3_v3_1.wav'],
  E3: ['LDFlute_susNV_E3_v1_1.wav', 'LDFlute_susNV_E3_v3_1.wav'],
  A3: ['LDFlute_susNV_A3_v1_1.wav', 'LDFlute_susNV_A3_v3_1.wav'],
  C4: ['LDFlute_susNV_C4_v1_1.wav', 'LDFlute_susNV_C4_v3_1.wav'],
  E4: ['LDFlute_susNV_E4_v1_1.wav', 'LDFlute_susNV_E4_v3_1.wav'],
  A4: ['LDFlute_susNV_A4_v1_1.wav', 'LDFlute_susNV_A4_v3_1.wav'],
  C5: ['LDFlute_susNV_C5_v1_1.wav', 'LDFlute_susNV_C5_v2_1.wav'],
  E5: ['LDFlute_susNV_E5_v1_1.wav', 'LDFlute_susNV_E5_v2_1.wav'],
  A5: ['LDFlute_susNV_A5_v1_1.wav', 'LDFlute_susNV_A5_v3_1.wav'],
  C6: ['LDFlute_susNV_C6_v1_1.wav'],
};
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 來源檔名的音高比實際低一個八度（量到的，見檔頭）。 */
const SOURCE_OCTAVE = 12;
const midiOf = (name) => {
  const m = name.match(/^([A-G])([#b]?)(-?\d)$/);
  return NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (+m[3] + 1) * 12 + SOURCE_OCTAVE;
};

/** radix-2 FFT（實數輸入，虛部 0）。 */
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

/** 基頻：**諧波求和**，一次 FFT 之後在頻域查表（不是每個候選都做一次 DFT——那樣
 *  19 個 take 要跑好幾分鐘，而且峰值法在長笛上會錯一個八度）。
 *
 *  為什麼不能只找最強的峰：這批 take 裡有一個音的基頻比它的第二泛音低 7 dB
 *  （329.6 Hz 是 −7.2 dB、659.3 Hz 是 0.0 dB），峰值法會回報 E5。諧波求和是對每個
 *  候選基頻 f 把 f、2f、3f、4f、5f 的強度加起來取最大的；再往下檢查 f/2、f/3：
 *  如果它們的分數還在最佳值的 85% 以內，那才是真正的基頻（避免八度誤判）。 */
function measureHz(pcm) {
  const N = 32768;
  const from = Math.min(Math.round(0.15 * RATE), Math.max(0, pcm.length - N - 1));
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N && from + i < pcm.length; i++) {
    re[i] = pcm[from + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  }
  fftInPlace(re, im);
  const binHz = RATE / N;
  const mag = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  const at = (f) => {
    const idx = Math.round(f / binHz);
    if (idx < 1 || idx >= mag.length) return 0;
    // 取相鄰三格的最大值：候選頻率不一定剛好落在 bin 上
    return Math.max(mag[idx - 1], mag[idx], mag[idx + 1]);
  };
  const score = (f) => { let s = 0; for (let k = 1; k <= 5; k++) s += at(f * k) / k; return s; };
  let best = -1, bestF = 0;
  for (let f = 55; f <= 2400; f += 0.5) { const m = score(f); if (m > best) { best = m; bestF = f; } }
  for (const k of [2, 3, 4]) {
    const sub = bestF / k;
    if (sub < 40) continue;
    const m = score(sub);
    if (m >= best * 0.85) return sub;
  }
  return bestF;
}

const sh = (cmd, args) => execFileSync(cmd, args, { maxBuffer: 1 << 28 });

function fetchSource(file) {
  const local = join(SRC_CACHE, file);
  if (existsSync(local) && !FORCE) return local;
  mkdirSync(SRC_CACHE, { recursive: true });
  sh('curl', ['-sfL', `${SRC}${SRC_DIR}/${file}`, '-o', local]);
  return local;
}

/** FLAC/WAV → 單聲道 f32 44.1 kHz：立體來源量左／右／相加三個候選取最大的
 *  （理由與量到的數字見 tools/build-velocity.mjs 的 decode()）。 */
function decode(file) {
  const buf = sh('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(RATE), '-t', String(SECONDS + 0.4), '-']);
  const copy = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const st = new Float32Array(copy, 0, Math.floor(copy.byteLength / 4));
  const frames = st.length >> 1;
  const cands = [new Float32Array(frames), new Float32Array(frames), new Float32Array(frames)];
  const energy = [0, 0, 0];
  for (let i = 0; i < frames; i++) {
    const l = st[2 * i];
    const r = st[2 * i + 1];
    cands[0][i] = l; cands[1][i] = r; cands[2][i] = (l + r) / 2;
    energy[0] += l * l; energy[1] += r * r; energy[2] += cands[2][i] * cands[2][i];
  }
  if (energy[0] === energy[1] && energy[1] === energy[2]) return cands[0];
  return cands[energy.indexOf(Math.max(...energy))];
}

/** 去掉開頭靜音、切長度、尾端淡出（不正規化，take 之間的關係等一下才處理）。 */
function shape(pcm) {
  let peak = 0;
  for (const v of pcm) peak = Math.max(peak, Math.abs(v));
  if (peak <= 0) throw new Error('silent sample');
  const floor = peak * ONSET_FLOOR;
  let start = 0;
  while (start < pcm.length && Math.abs(pcm[start]) < floor) start++;
  start = Math.max(0, start - Math.round(PREROLL * RATE));
  const len = Math.min(pcm.length - start, Math.round(SECONDS * RATE));
  const out = new Float32Array(len);
  const fadeLen = Math.min(Math.round(FADE * RATE), len);
  for (let i = 0; i < len; i++) out[i] = pcm[start + i] * (i >= len - fadeLen ? (len - i) / fadeLen : 1);
  return out;
}

const peakOf = (pcm) => { let p = 0; for (const v of pcm) p = Math.max(p, Math.abs(v)); return p; };

function encode(pcm, dest) {
  const raw = join(SRC_CACHE, 'tmp.raw');
  mkdirSync(SRC_CACHE, { recursive: true });
  writeFileSync(raw, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  sh('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', raw,
    '-c:a', 'libmp3lame', '-b:a', '96k', dest]);
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const notes = {};
  const rows = [];
  let made = 0;
  let reused = 0;

  for (const [name, files] of Object.entries(SOURCES)) {
    const midi = midiOf(name);
    // 先把這個音的所有 take 解出來，才知道要對齊到哪個峰值
    const takes = files.map((f) => shape(decode(fetchSource(f))));
    const want = 440 * 2 ** ((midi - 69) / 12);
    const hz = takes.map(measureHz);
    const cents = hz.map((h) => 1200 * Math.log2(h / want));
    const target = Math.max(...takes.map(peakOf));
    const gains = takes.map((t) => target / (peakOf(t) || 1));
    const rowsFor = [];
    takes.forEach((pcm, i) => {
      const g = gains[i];
      for (let k = 0; k < pcm.length; k++) pcm[k] *= g;
      const dest = join(OUT_DIR, `${midi}-${'ab'[i]}.mp3`);
      if (existsSync(dest) && !FORCE) reused++;
      else { encode(pcm, dest); made++; }
      rowsFor.push({ take: 'ab'[i], peak: peakOf(pcm), gain: g, hz: hz[i], cents: cents[i] });
    });
    notes[midi] = { takes: takes.map((_, i) => `${midi}-${'ab'[i]}.mp3`) };
    rows.push({ name, midi, takes: rowsFor });
  }

  console.log('音名  音號  take  量到Hz    應該Hz   音分   校正倍率  峰值');
  for (const r of rows) {
    for (const t of r.takes) {
      const want = 440 * 2 ** ((r.midi - 69) / 12);
      console.log(`${r.name.padEnd(4)} ${String(r.midi).padStart(4)}  ${t.take}    ${t.hz.toFixed(1).padStart(7)}  ${want.toFixed(1).padStart(7)}  ${t.cents.toFixed(1).padStart(6)}   ×${t.gain.toFixed(2).padStart(5)}   ${t.peak.toFixed(3)}`);
    }
  }
  const midis = Object.keys(notes).map(Number).sort((a, b) => a - b);
  const gaps = midis.slice(1).map((m, i) => m - midis[i]);
  const twoTake = rows.filter((r) => r.takes.length > 1).length;
  const worstCents = Math.max(...rows.flatMap((r) => r.takes.map((t) => Math.abs(t.cents))));
  const checks = [
    [`${midis.length} 個音（${midis[0]}–${midis[midis.length - 1]}）`, midis.length === 10],
    [`音域 C4–C7，跟長笛這件樂器一致`, midis[0] === 60 && midis[midis.length - 1] === 96],
    [`檔名 +12 之後音高正確（最大誤差 ${worstCents.toFixed(1)} 音分）`, worstCents < 25],
    [`${twoTake} 個音有兩個 take 可以輪替`, twoTake >= 8],
    [`相鄰錄音最多差 ${Math.max(...gaps)} 個半音`, Math.max(...gaps) <= 5],
  ];
  for (const [what, ok] of checks) console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);

  const body = midis.map((m) => `    ${m}: { takes: [${notes[m].takes.map((f) => `'${f}'`).join(', ')}] },`).join('\n');
  const out = `// 長笛的取樣表（產生的，不是手寫的）：音號 → 每個音有哪幾個 take（輪流用）。
//
// 來源：${CREDIT}
// 10 個音（C3–C6）、8 個音有兩個 take。轉檔方式與理由見 tools/build-flute.mjs。
//
// 這一份**覆蓋掉** src/sample-library.js 裡同名的遠端長笛（那個是 C4–C7、每個音一個 take）：
// 音域低一個八度才蓋得住旋律，兩個 take 輪替才不會「同一個音一模一樣」。
// 檔案在 repo 裡，跟鼓組與卡林巴一樣進 service worker 預快取。
export const FLUTE_INSTRUMENT = {
  label: '長笛',
  credit: '${CREDIT}',
  synth: 'real:flute',
  base: 'samples/flute/',
  /** 相鄰錄音最多差幾個半音（C3 E3 A3 C4 E4 A4 C5 E5 A5 C6，中間的音用播放速率內插）。 */
  gap: ${Math.max(...gaps)},
  /** 每個音最多幾個 take（round robin 用）。 */
  takes: ${Math.max(...rows.map((r) => r.takes.length))},
  notes: {
${body}
  },
};
`;
  writeFileSync(LIB_FILE, out);
  // 孤兒檔：上一版（八度還沒修正之前）留下的檔名不會被新的資料表引用，要刪掉——
  // 留著只會讓預快取清單變長、而且那些檔的音高是錯的。
  const expected = new Set(Object.values(notes).flatMap((n) => n.takes));
  let removed = 0;
  for (const f of readdirSync(OUT_DIR)) {
    if (!f.endsWith('.mp3') || expected.has(f)) continue;
    rmSync(join(OUT_DIR, f), { force: true });
    removed++;
  }
  if (removed) console.log(`刪掉 ${removed} 個不被資料表引用的孤兒檔`);
  console.log(`\n${made} 個轉檔、${reused} 個沿用；資料表寫入 src/flute-library.js`);
}

main();
