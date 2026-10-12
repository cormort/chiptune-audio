// 產生卡林巴琴（kalimba／拇指琴）的取樣：把 Moozica 17 音卡林巴的**每一根簧片**
// 轉成這個專案用的小檔案，放進 samples/kalimba/，並產生 src/kalimba-library.js。
//
// 來源：NeoSoundFonts/SimonePiervergili-Kalimba（CC0 1.0）——Simone Piervergili 用
// 手機錄自己的 Moozica 卡林巴，17 個簧片一個檔案（48 kHz 單聲道）。CC0 跟鼓組同一個
// 授權等級：可以商用、不必標註（我們還是標）。
//
// **來源檔名低了一個八度**：`C3.wav` 裡錄的是中央 C（MIDI 60）。這是 SFZ 對應表
// （`Moozica Kalimba.sfz` 的 `pitch_keycenter`）說的，也量過：17 個檔案的基頻與
// keycenter 全部對得上（誤差 0.2% 以內，見 --check）。所以音號一律以 SFZ 為準，
// 不是以檔名為準——照檔名走的話整個樂器會低一個八度。
//
// 需要的東西：Node 18+、ffmpeg（含 libmp3lame）、網路。輸出檔案已進版控，平常不用重跑。
//
//   node tools/build-kalimba.mjs            # 只轉缺的檔案
//   node tools/build-kalimba.mjs --force    # 全部重轉
//   node tools/build-kalimba.mjs --check    # 只量基頻，驗證 SFZ 的音高對應
//
// 每個簧片的處理：單聲道 44.1 kHz、**校正音高**、去掉開頭靜音（保留 3 ms）、切到自然
// 衰減結束（峰值以下 60 dB 或 3.5 秒，先到者為準）、尾端 60 ms 淡出、峰值正規化到 0.9。
//
// 為什麼要校正音高：這把琴是手調的，量出來每一根都比平均律**高**，而且越高音越準不回來
// （C4 +9.8、E5 +20.0、G5 +22.3、E6 +23.3 音分；低音那幾根只有 +1.4…+9.2）。
// 23 音分是四分之一個半音，聽起來就是「這把琴沒調準」，而且每個簧片的誤差還不一樣，
// 音階的音程會忽大忽小。所以量出每一根的基頻，用重取樣把它拉回平均律（±1 音分內），
// 音高交給 MIDI 音號、琴鍵只負責音色——跟「層負責音色、力度負責音量」同一個原則。
// 量測法與校正前後的數字都印在下面，`--check` 可以只量不轉檔。
//
// 為什麼是「峰值正規化」而不是像力度層那樣整組一個基準：卡林巴的簧片**本來就一樣大聲**
// （同一個琴、同一根拇指），這裡 0.221（D4）到 0.997（B4）的落差是 13 dB 的「每次彈
// 不一樣用力」，不是樂器設計。留著的話同一首曲子裡 D4 會小到聽不見。所以每一根自己
// 拉到 0.9：簧片只負責**音色**（低音簧片厚、高音簧片短而亮，衰減時間從 3.9 秒到 0.4 秒），
// 音量交給播放時的力度——跟力度層同一個原則。
//
// 卡林巴是撥弦式的**一次性**樂器：note-off 不切掉它（簧片會一直響到沒能量），所以
// 這裡不做釋音取樣，跟鼓組一樣讓它自然衰減完。
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'samples', 'kalimba');
const LIB_FILE = join(ROOT, 'src', 'kalimba-library.js');
const SRC_CACHE = '/tmp/chiptune-kalimba';
const REPO = 'NeoSoundFonts/SimonePiervergili-Kalimba';
const SRC = `https://raw.githubusercontent.com/${REPO}/HEAD/samples/`;
const CREDIT = 'Moozica 17 音卡林巴 — Simone Piervergili 錄音（CC0 1.0）';
const FORCE = process.argv.includes('--force');
const CHECK = process.argv.includes('--check');

const RATE = 44100;
const PEAK_TARGET = 0.9;    // 每一根簧片自己的峰值
const FADE = 0.06;
const ONSET_FLOOR = 0.01;
const PREROLL = 0.003;
const MAX_SECONDS = 3.5;    // 最長的簧片（C4）量到 3.88 秒才掉 40 dB，再多就只是雜訊
const MIN_SECONDS = 0.6;
const TAIL_DB = -60;

/** 來源檔名 → 音號，取自 Moozica Kalimba.sfz 的 pitch_keycenter（檔名低一個八度）。 */
const TINES = {
  C3: 60, D3: 62, E3: 64, F3: 65, G3: 67, A3: 69, B3: 71,
  C4: 72, D4: 74, E4: 76, F4: 77, G4: 79, A4: 81, B4: 83,
  C5: 84, D5: 86, E5: 88,
};
/** 簧片由左到右的排列（低音在正中間，往兩邊交替升高）——跟 src/kalimba.js 同一份事實，
 *  這裡只是拿來檢查「每一根簧片都有錄音」。 */
const LAYOUT = [86, 83, 79, 76, 72, 69, 65, 62, 60, 64, 67, 71, 74, 77, 81, 84, 88];

const sh = (cmd, args) => execFileSync(cmd, args, { maxBuffer: 1 << 28 });

function fetchSource(name) {
  const local = join(SRC_CACHE, `${name}.wav`);
  if (existsSync(local) && !FORCE) return local;
  mkdirSync(SRC_CACHE, { recursive: true });
  sh('curl', ['-sfL', SRC + `${name}.wav`, '-o', local]);
  return local;
}

/** WAV → 單聲道 f32 44.1 kHz。 */
function decode(file) {
  const buf = sh('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(RATE), '-']);
  const copy = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(copy, 0, Math.floor(copy.byteLength / 4));
}

const peakOf = (pcm) => { let p = 0; for (const v of pcm) p = Math.max(p, Math.abs(v)); return p; };

/** 基頻：0.5 秒窗（起音後 50 ms 開始）的 DFT 掃描，先粗掃 0.5 Hz 再逐步二分細修。
 *
 *  簧片幾乎是純音（泛音比基頻低 20 dB 以上），所以取最強的峰就夠；用自相關會被衰減
 *  尾端的雜訊拉去倍數的 lag（第一版就是這樣量出「C3 只有 131 Hz」的假結果）。
 *  窗從 50 ms 開始、長 0.5 秒：量過三個時間點，簧片的音高從頭到尾是穩的
 *  （C4 的 0.1–0.6 s 與 1.0–1.5 s 都是 526 Hz），所以不是起音的滑音，是真的調高了。 */
function measureHz(pcm) {
  const from = Math.min(Math.round(0.05 * RATE), Math.max(0, pcm.length - 1));
  const len = Math.min(Math.round(0.5 * RATE), pcm.length - from);
  if (len < 1024) return 0;
  const w = pcm.subarray(from, from + len);
  const mag = (f) => {
    let re = 0;
    let im = 0;
    for (let i = 0; i < len; i++) {
      const t = i / RATE;
      re += w[i] * Math.cos(2 * Math.PI * f * t);
      im += w[i] * Math.sin(2 * Math.PI * f * t);
    }
    return Math.hypot(re, im);
  };
  let best = -1;
  let bestF = 0;
  for (let f = 60; f <= 1800; f += 0.5) {
    const m = mag(f);
    if (m > best) { best = m; bestF = f; }
  }
  for (let step = 0.25; step > 0.002; step /= 2) {
    for (const dir of [-1, 1]) {
      for (let f = bestF + dir * step; f > 0; f += dir * step) {
        const m = mag(f);
        if (m <= best) break;
        best = m;
        bestF = f;
      }
    }
  }
  return bestF;
}

/** 重取樣（線性內插）：`ratio` > 1 是升高音高。校正量只有 ~1%，內插的誤差可以忽略。 */
function resample(pcm, ratio) {
  const len = Math.floor(pcm.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const pos = i * ratio;
    const idx = pos | 0;
    const frac = pos - idx;
    const a = pcm[idx] ?? 0;
    const b = pcm[idx + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** 去開頭靜音、切到自然衰減結束、尾端淡出、峰值正規化到 0.9。 */
function shape(pcm) {
  let peak = 0;
  for (const v of pcm) peak = Math.max(peak, Math.abs(v));
  if (peak <= 0) throw new Error('silent sample');
  const floor = peak * ONSET_FLOOR;
  let start = 0;
  while (start < pcm.length && Math.abs(pcm[start]) < floor) start++;
  start = Math.max(0, start - Math.round(PREROLL * RATE));

  // 自然衰減結束：每 20 ms 的 rms 掉到峰值窗以下 60 dB 就算沒了
  const win = Math.round(0.02 * RATE);
  const refWin = Math.floor(start / win) * win + win;
  let ref = 0;
  for (let i = refWin; i < Math.min(refWin + win, pcm.length); i++) ref += pcm[i] ** 2;
  ref = Math.sqrt(ref / win) || peak;
  const threshold = ref * 10 ** (TAIL_DB / 20);
  let end = pcm.length;
  for (let s = refWin; s + win <= pcm.length; s += win) {
    let e = 0;
    for (let i = 0; i < win; i++) e += pcm[s + i] ** 2;
    if (Math.sqrt(e / win) < threshold) { end = s + win; break; }
  }
  const len = Math.max(
    Math.round(MIN_SECONDS * RATE),
    Math.min(end - start, Math.round(MAX_SECONDS * RATE), pcm.length - start),
  );
  const out = new Float32Array(len);
  const gain = PEAK_TARGET / peak;
  const fadeLen = Math.min(Math.round(FADE * RATE), len);
  for (let i = 0; i < len; i++) {
    out[i] = pcm[start + i] * gain * (i >= len - fadeLen ? (len - i) / fadeLen : 1);
  }
  return out;
}

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

  for (const [name, midi] of Object.entries(TINES)) {
    const want = 440 * 2 ** ((midi - 69) / 12);
    const raw = decode(fetchSource(name));
    const before = measureHz(raw);
    const centsBefore = 1200 * Math.log2(before / want);
    // 校正音高：量到偏高就放慢（ratio < 1）
    const ratio = want / before;
    const tuned = Math.abs(centsBefore) < 1 ? raw : resample(raw, ratio);
    const after = measureHz(tuned);
    const centsAfter = 1200 * Math.log2(after / want);
    rows.push({ name, midi, before, after, want, centsBefore, centsAfter, ratio });
    if (CHECK) continue;
    const dest = join(OUT_DIR, `${midi}.mp3`);
    if (existsSync(dest) && !FORCE) { reused++; } else {
      encode(shape(tuned), dest);
      made++;
    }
    notes[midi] = `${midi}.mp3`;
  }

  rows.sort((a, b) => a.midi - b.midi);
  console.log('音號  來源檔   量到 Hz   校正前    校正後   應該 Hz   校正後誤差');
  for (const r of rows) {
    console.log(`${String(r.midi).padStart(4)}  ${r.name.padEnd(6)} ${r.before.toFixed(1).padStart(8)} `
      + `${`${r.centsBefore >= 0 ? '+' : ''}${r.centsBefore.toFixed(1)}`.padStart(8)} `
      + `${`${r.centsAfter >= 0 ? '+' : ''}${r.centsAfter.toFixed(1)}`.padStart(8)} `
      + `${r.want.toFixed(1).padStart(9)} ${`${r.centsAfter >= 0 ? '+' : ''}${r.centsAfter.toFixed(1)} cent`.padStart(12)}`);
  }
  const worstBefore = Math.max(...rows.map((r) => Math.abs(r.centsBefore)));
  const worstAfter = Math.max(...rows.map((r) => Math.abs(r.centsAfter)));
  const recorded = new Set(rows.map((r) => r.midi));
  const checks = [
    ['17 根簧片都有錄音', rows.length === 17],
    [`來源本來就偏高（最大 ${worstBefore.toFixed(1)} 音分）`, worstBefore > 3],
    [`校正後落在平均律上（最大 ${worstAfter.toFixed(1)} 音分）`, worstAfter < 2],
    ['簧片排列（17 鍵）的每一個音都有取樣', LAYOUT.length === 17 && LAYOUT.every((m) => recorded.has(m))],
    ['取樣與簧片排列是同一個音集合', LAYOUT.length === recorded.size],
  ];
  for (const [what, ok] of checks) console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (CHECK) { if (checks.some(([, ok]) => !ok)) process.exitCode = 1; return; }

  const body = Object.keys(notes).map(Number).sort((a, b) => a - b)
    .map((m) => `    ${m}: '${notes[m]}',`).join('\n');
  const out = `// 卡林巴琴（kalimba／拇指琴）的取樣表（產生的，不是手寫的）：音號 → 檔名。
//
// 來源：${CREDIT}
// 17 根簧片一個錄音，涵蓋 MIDI 60（中央 C）到 88（E6）——就是一把 17 音卡林巴的音域。
// 轉檔方式與理由見 tools/build-kalimba.mjs 與 samples/kalimba/README.md。
//
// 形狀跟 src/sample-library.js 的遠端樂器一樣（單層，notes 是「音號 → 檔名」），
// 差別是檔案在 repo 裡、跟鼓組一樣進 service worker 預快取：這把琴是模擬器頁面的主角，
// 不該第一次打開還要等網路。
export const KALIMBA_INSTRUMENT = {
  label: '卡林巴琴',
  credit: '${CREDIT}',
  synth: 'real:kalimba',
  base: 'samples/kalimba/',
  /** 相鄰錄音最多差幾個半音（簧片是音階排列，中間的音用播放速率內插，最多 1 個半音）。 */
  gap: 2,
  notes: {
${body}
  },
};

/** 來源與量測結果（給測試與文件用）。\`cents\` 是校正前後與平均律的差。 */
export const KALIMBA_SOURCE = {
  repo: '${REPO}',
  license: 'CC0 1.0',
  /** 來源檔名低一個八度（C3.wav 錄的是 MIDI 60）：以 SFZ 的 pitch_keycenter 為準。 */
  files: {
${rows.map((r) => `    ${r.midi}: '${r.name}.wav',`).join('\n')}
  },
  /** 每一根簧片量到的基頻、校正前後的音分差與實際套用的重取樣倍率。 */
  tuning: {
${rows.map((r) => `    ${r.midi}: { hz: ${r.before.toFixed(2)}, cents: ${r.centsBefore.toFixed(1)}, ratio: ${r.ratio.toFixed(5)} },`).join('\n')}
  },
};
`;
  writeFileSync(LIB_FILE, out);
  console.log(`\n${made} 個轉檔、${reused} 個沿用；資料表寫入 src/kalimba-library.js`);
}

main();

// 樣本換了就要換媒體快取的名字（否則使用者會一直拿到舊音檔）；見 tools/bump-media.mjs。
await import('./bump-media.mjs');
