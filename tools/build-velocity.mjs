// 產生「有力度層」的取樣樂器：把小提琴、大提琴、長笛的 **p（弱）／f（強）兩層**錄音
// 從 VSCO 2 Community Edition（CC0 1.0）轉成這個專案用的小檔案，放進 samples/velocity/，
// 並產生 src/dynamic-library.js（音高 → 力度層 → 檔名）。
//
// 為什麼是這三個樂器：它們是持續音（sustained），有沒有力度層差最多——單層錄音在
// 小力彈的時候只是變小聲，音色不會變柔。VSCO 2 CE 這三組都真的有兩層（都量過）：
//   * 小提琴 Strings/Solo Violin/Arco Vib  ── 檔名 _p / _f，15 個音；音量差 18.3 dB、強層亮 2.2 倍
//   * 大提琴 Strings/Cello Section/susvib  ── 檔名 _v1 / _v3，13 個音；音量差 18.7 dB
//   * 小號   Brass/Trumpet/sus             ── 檔名 _v1 / _v3，10 個音；音量差 8.1 dB、強層亮 1.48 倍
//
// 長笛本來在名單裡，但 VSCO 的長笛（susNV 的 v1/v3、susvib 的 v1_1/v1_2）只差 4 dB、
// 音色幾乎一樣——那是不同 take，不是力度，所以不放進來（不要拿兩個一樣的錄音假裝 p/f）。
// 要長笛的力度層得換來源（例如 Iowa MIS 的單音樣本）。
//
// 需要的東西：Node 18+、ffmpeg（含 libmp3lame）、網路。輸出檔案已進版控，平常不用重跑。
//
//   node tools/build-velocity.mjs            # 只轉缺的檔案
//   node tools/build-velocity.mjs --force    # 全部重轉
//
// 每個擊點的處理：單聲道 44.1 kHz（立體來源見 decode()：量過左／右／相加再取最好的，
// 不是盲目相加）、去掉開頭靜音（保留 3 ms）、切到 `seconds` 秒、
// 尾端 60 ms 淡出。
//
// 音量：**每一層各自正規化到同一個基準（0.7）**，不是保留「p 比 f 小 15 dB」。
// 為什麼：兩層的音量差如果留著，力度 0.49（弱層）與 0.51（強層）會差 15 dB——同一個
// 力度區間裡突然有一堆音爆出來。層應該只負責**音色**（弱層真的比較暗：小提琴強層亮 2.2 倍），
// 音量交給播放時的 gain（＝力度），這樣從 pp 到 ff 是連續的（0.1→1.0 約 20 dB），
// 而且小力彈同時「比較小聲」與「比較暗」——這才是真樂器的行為。
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'samples', 'velocity');
const LIB_FILE = join(ROOT, 'src', 'dynamic-library.js');
const SRC_CACHE = '/tmp/chiptune-velocity';
const REPO = 'sgossner/VSCO-2-CE';
const SRC = `https://raw.githubusercontent.com/${REPO}/master/`;
/** 檔案清單要看 github.com 的樹狀頁（raw 沒有目錄列表）。 */
const LIST_BASE = `https://github.com/${REPO}/tree/master/`;
/** 鋼琴用的是同一台琴的**原版**（Salamander V3，每音 16 層，CC-BY 3.0）。 */
const SALAMANDER = 'https://raw.githubusercontent.com/sfzinstruments/SalamanderGrandPiano/master/Samples/';
/** 鋼琴的 21 個音（C2–C7，每 3 個半音一個）與 4 個力度層。 */
const PIANO_NOTES = ['C2', 'D#2', 'F#2', 'A2', 'C3', 'D#3', 'F#3', 'A3', 'C4', 'D#4', 'F#4', 'A4', 'C5', 'D#5', 'F#5', 'A5', 'C6', 'D#6', 'F#6', 'A6', 'C7'];
const PIANO_LAYERS = [3, 8, 13, 16];
const FORCE = process.argv.includes('--force');

const RATE = 44100;
const REFERENCE = 0.7;     // 強層的中位峰值要拉到的基準
const FADE = 0.06;
const ONSET_FLOOR = 0.01;
const PREROLL = 0.003;

/** MIDI 音名 → 音號（VSCO 的檔名用 A3、C#4 這種寫法）。 */
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midiOf = (name) => {
  const m = name.match(/^([A-G])([#b]?)(-?\d)$/);
  const semi = NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return semi + (+m[3] + 1) * 12;
};

/**
 * 每個樂器：來源資料夾、中文名、代理合成音色、切多長，以及
 * `layers[note] = [最弱, 中, 最強]`（由弱到強的檔名；長度就是層數）。
 * 檔名相對於來源 repo。
 */
/** 單簧管的檔名有規律，用一個小工具產生，避免手抄 33 個檔名抄錯。 */
const clarinet = (notes) => Object.fromEntries(notes.map((n) => [n,
  [1, 2, 3].map((v) => `DCClar_susLong_${n}_v${v}_rr1_sum.wav`)]));

/** 鋼琴：4 個力度層，外加放開鍵的釋音取樣（rel16..rel76，一個音一個檔）。 */
const piano = {
  label: '平台鋼琴',
  // 立體：兩支不同視角的麥克風，是這台琴「在一個空間裡」的那一半（見 STEREO_INSTRUMENTS）
  stereo: true,
  credit: 'Salamander Grand Piano V3 — Alexander Holm（CC-BY 3.0）',
  synth: 'real:piano',
  seconds: 5,
  src: SALAMANDER,
  dir: '',
  layers: Object.fromEntries(PIANO_NOTES.map((n) => [n, PIANO_LAYERS.map((v) => `${n}v${v}.flac`)])),
  // 釋音：MIDI 21（A0）= rel1，所以 rel 編號 = 音號 - 20
  release: { dir: '', files: Object.fromEntries(PIANO_NOTES.map((n) => [n, `rel${midiOf(n) - 20}.flac`])), seconds: 1.5 },
};

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { maxBuffer: 1 << 29, ...opts });

/**
 * 有力度層的樂器：從來源資料夾的檔名自己探索「有哪些音、每個音有幾層」，
 * 不手抄檔名（來源動輒上百個檔）。`pattern` 是檔名的形狀，`v` 執行完會拿到
 * 「音名 → 層號」的清單；只要有兩層以上的音才會採用。
 */
const DISCOVER = {
  oboe: { label: '雙簧管', credit: 'VSCO 2 Community Edition — Oboe, Vib（CC0 1.0）', synth: 'real:sax', dir: 'Woodwinds/Oboe/Vib', note: /^Oboe_Vib_([A-G]#?\d)_v(\d+)_Main\.wav$/, seconds: 4  },
  viola: { label: '中提琴', credit: 'VSCO 2 Community Edition — Viola Section, susvib（CC0 1.0）', synth: 'real:strings', dir: 'Strings/Viola Section/susvib', note: /^ViolaEns_susvib_([A-G]#?\d)_v(\d+)_1\.wav$/, seconds: 4  },
  trombone: { label: '長號', credit: 'VSCO 2 Community Edition — Tenor Trombone, sus（CC0 1.0）', synth: 'real:brass', dir: 'Brass/Tenor Trombone/sus', note: /^tenortbn_sus_([A-G]#?\d)_v(\d+)_1\.wav$/, seconds: 4  },
  tuba: { label: '低音號', credit: 'VSCO 2 Community Edition — Tuba, sus（CC0 1.0）', synth: 'real:brass', dir: 'Brass/Tuba/sus', note: /^Tuba3_sus_([A-G]#?\d)_v(\d+)_rr1_Mid\.wav$/, seconds: 4  },
  // 低音管試過但拿掉：來源的兩層只差 5 dB、亮度比 0.93（幾乎同音色），那是不同 take
  // 不是力度——跟長笛同一個狀況，拿它假裝 p/f 是騙人。
};

const INSTRUMENTS = {
  grand: piano,
  violin: {
    label: '小提琴',
    credit: 'VSCO 2 Community Edition — Solo Violin, Arco Vib（CC0 1.0）',
    synth: 'real:violin',
    seconds: 4,
    dir: 'Strings/Solo Violin/Arco Vib',
    layers: {
      G3: ['LLVln_ArcoVib_G3_p.wav', 'LLVln_ArcoVib_G3_f.wav'],
      A3: ['LLVln_ArcoVib_A3_p.wav', 'LLVln_ArcoVib_A3_f.wav'],
      C4: ['LLVln_ArcoVib_C4_p.wav', 'LLVln_ArcoVib_C4_f.wav'],
      E4: ['LLVln_ArcoVib_E4_p.wav', 'LLVln_ArcoVib_E4_f.wav'],
      G4: ['LLVln_ArcoVib_G4_p.wav', 'LLVln_ArcoVib_G4_f.wav'],
      A4: ['LLVln_ArcoVib_A4_p.wav', 'LLVln_ArcoVib_A4_f.wav'],
      C5: ['LLVln_ArcoVib_C5_p.wav', 'LLVln_ArcoVib_C5_f.wav'],
      E5: ['LLVln_ArcoVib_E5_p.wav', 'LLVln_ArcoVib_E5_f.wav'],
      G5: ['LLVln_ArcoVib_G5_p.wav', 'LLVln_ArcoVib_G5_f.wav'],
      A5: ['LLVln_ArcoVib_A5_p.wav', 'LLVln_ArcoVib_A5_f.wav'],
      C6: ['LLVln_ArcoVib_C6_p.wav', 'LLVln_ArcoVib_C6_f.wav'],
      E6: ['LLVln_ArcoVib_E6_p.wav', 'LLVln_ArcoVib_E6_f.wav'],
      G6: ['LLVln_ArcoVib_G6_p.wav', 'LLVln_ArcoVib_G6_f.wav'],
      A6: ['LLVln_ArcoVib_A6_p.wav', 'LLVln_ArcoVib_A6_f.wav'],
      C7: ['LLVln_ArcoVib_C7_p.wav', 'LLVln_ArcoVib_C7_f.wav'],
    },
  },
  cello: {
    label: '大提琴',
    credit: 'VSCO 2 Community Edition — Cello Section, susvib（CC0 1.0）',
    synth: 'real:cello',
    seconds: 4,
    dir: 'Strings/Cello Section/susvib',
    layers: {
      C1: ['susvib_C1_v1_1.wav', 'susvib_C1_v3_1.wav'],
      E1: ['susvib_E1_v1_1.wav', 'susvib_E1_v3_1.wav'],
      G1: ['susvib_G1_v1_1.wav', 'susvib_G1_v3_1.wav'],
      B1: ['susvib_B1_v1_1.wav', 'susvib_B1_v3_1.wav'],
      D2: ['susvib_D2_v1_1.wav', 'susvib_D2_v3_1.wav'],
      F2: ['susvib_F2_v1_1.wav', 'susvib_F2_v3_1.wav'],
      A2: ['susvib_A2_v1_1.wav', 'susvib_A2_v3_1.wav'],
      C3: ['susvib_C3_v1_1.wav', 'susvib_C3_v3_1.wav'],
      E3: ['susvib_E3_v1_1.wav', 'susvib_E3_v3_1.wav'],
      G3: ['susvib_G3_v1_1.wav', 'susvib_G3_v3_1.wav'],
      B3: ['susvib_B3_v1_1.wav', 'susvib_B3_v3_1.wav'],
      D4: ['susvib_D4_v1_1.wav', 'susvib_D4_v3_1.wav'],
      F4: ['susvib_F4_v1_1.wav', 'susvib_F4_v3_1.wav'],
    },
  },
  clarinet: {
    label: '單簧管',
    credit: 'VSCO 2 Community Edition — Clarinet, susLong（CC0 1.0）',
    synth: 'real:clarinet',
    seconds: 4,
    dir: 'Woodwinds/Clarinet/susLong',
    // 11 個音、每個音 3 層（v1/v2/v3）。這是來源裡層數最多的樂器之一，
    // 而且音域從 D2 到 F#5 涵蓋三個八度，不像法國號有 3 層的音只到 C3。
    layers: clarinet(['F2', 'A#2', 'D3', 'F3', 'A#3', 'D4', 'F4', 'A#4', 'D5', 'F#5']),
  },
  ...Object.fromEntries(Object.entries(DISCOVER).map(([name, spec]) => [name, {
    label: spec.label,
    credit: spec.credit,
    synth: spec.synth,
    seconds: spec.seconds,
    dir: spec.dir,
    layers: discoverLayers(spec),
  }])),
  trumpet: {
    label: '小號',
    credit: 'VSCO 2 Community Edition — Trumpet, sus（CC0 1.0）',
    synth: 'real:trumpet',
    seconds: 4,
    dir: 'Brass/Trumpet/sus',
    layers: {
      F2: ['Sum_SHTrumpet_sus_F2_v1_rr1.wav', 'Sum_SHTrumpet_sus_F2_v3_rr1.wav'],
      A2: ['Sum_SHTrumpet_sus_A2_v1_rr1.wav', 'Sum_SHTrumpet_sus_A2_v3_rr1.wav'],
      C3: ['Sum_SHTrumpet_sus_C3_v1_rr1.wav', 'Sum_SHTrumpet_sus_C3_v3_rr1.wav'],
      'D#3': ['Sum_SHTrumpet_sus_D#3_v1_rr1.wav', 'Sum_SHTrumpet_sus_D#3_v3_rr1.wav'],
      'A#3': ['Sum_SHTrumpet_sus_A#3_v1_rr1.wav', 'Sum_SHTrumpet_sus_A#3_v3_rr1.wav'],
      D4: ['Sum_SHTrumpet_sus_D4_v1_rr1.wav', 'Sum_SHTrumpet_sus_D4_v3_rr1.wav'],
      F4: ['Sum_SHTrumpet_sus_F4_v1_rr1.wav', 'Sum_SHTrumpet_sus_F4_v3_rr1.wav'],
      G3: ['Sum_SHTrumpet_sus_G3_v1_rr1.wav', 'Sum_SHTrumpet_sus_G3_v3_rr1.wav'],
      A4: ['Sum_SHTrumpet_sus_A4_v1_rr1.wav', 'Sum_SHTrumpet_sus_A4_v3_rr1.wav'],
      C5: ['Sum_SHTrumpet_sus_C5_v1_rr1.wav', 'Sum_SHTrumpet_sus_C5_v3_rr1.wav'],
    },
  },
};

/** 來源資料夾裡有哪些檔（用 GitHub 的檔案樹頁面，不用 API 額度）。
 *  抓不到就重試幾次：這一步失敗整個建置就沒意義，所以寧可等也不要靜靜地少幾個樂器。 */
function listFolder(dir, tries = 4) {
  const url = LIST_BASE + dir.split('/').map(encodeURIComponent).join('/');
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const html = sh('curl', ['-sfL', '--retry', '3', '--retry-delay', '2', url]).toString();
      const names = [...new Set([...html.matchAll(/"name":"([^"]+\.wav)"/g)].map((m) => m[1]))];
      if (names.length) return names;
      last = new Error(`no .wav names in the listing of ${dir}`);
    } catch (err) {
      last = err;
    }
    sleepMs(1500 * (i + 1));
  }
  throw new Error(`cannot list ${dir}: ${last && last.message}`);
}

/** 同步等（建置腳本，不需要非同步）。 */
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 從檔名清單湊出「音名 → [檔名, ...]」（由弱到強），只留有兩層以上的音。 */
function discoverLayers(spec) {
  const found = new Map();
  for (const file of listFolder(spec.dir)) {
    const m = file.match(spec.note);
    if (!m) continue;
    const [, noteName, layer] = m;
    if (!found.has(noteName)) found.set(noteName, new Map());
    found.get(noteName).set(+layer, file);
  }
  const layers = {};
  for (const [noteName, byLayer] of [...found.entries()].sort()) {
    const nums = [...byLayer.keys()].sort((a, b) => a - b);
    if (nums.length < 2) continue;                 // 只有一層的音不放（同一個樂器裡會音量不一致）
    layers[noteName] = nums.map((n) => byLayer.get(n));
  }
  return layers;
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

function fetchSource(base, path) {
  const local = join(SRC_CACHE, (base + path).replace(/[^\w.-]/g, '_'));
  if (existsSync(local) && !FORCE) return local;
  mkdirSync(SRC_CACHE, { recursive: true });
  sh('curl', ['-sfL', base + path.split('/').map(encodeURIComponent).join('/'), '-o', local]);
  return local;
}

/** 解碼的統計：每一種來源最後選了哪個聲道（跑完會印出來）。 */
const channelChoice = { left: 0, right: 0, mid: 0, mono: 0 };

/** 保留立體聲的樂器（`INSTRUMENTS[name].stereo`）。
 *
 *  只有鋼琴：它的兩個聲道是**兩支不同視角的麥克風**（各頻帶相位差 +28°～−137°、
 *  lag-0 相關 −0.29～−0.79），取單聲道等於丟掉半個錄音，而丟掉的那一半正是「這台琴
 *  在一個空間裡」的感覺。VSCO 的弦樂／管樂是相干的一對（相加只差 0.6–2.3 dB），
 *  留單聲道就夠，而且可以讓力度層那 15 MB 不要變成 27 MB。
 *
 *  立體來源的檔案比較大（128 kbps 立體 vs 96 kbps 單聲道，約 2 倍），所以只用在
 *  鋼琴這一個樂器上。 */
const STEREO_INSTRUMENTS = new Set(Object.entries(INSTRUMENTS).filter(([, i]) => i.stereo).map(([n]) => n));
const stereoStats = { kept: 0, mono: 0 };

function decodeChannels(file, seconds) {
  const buf = sh('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(RATE), '-t', String(seconds + 0.4), '-']);
  const copy = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const st = new Float32Array(copy, 0, Math.floor(copy.byteLength / 4));
  const frames = st.length >> 1;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) { left[i] = st[2 * i]; right[i] = st[2 * i + 1]; }
  return { left, right };
}

/** FLAC/WAV → 單聲道 f32 44.1 kHz（只解到需要的長度）。
 *
 *  **立體來源不能直接 `(L+R)/2`。** Salamander 的兩個聲道是兩支不同視角的麥克風
 *  （各頻帶相位差從 +28° 散到 −137°、zero-lag 相關 −0.29～−0.79），相加不是中性的
 * 單聲道混音而是**部分抵消**：量到 A3v8 的左/右是 0.0138 / 0.0147 RMS，相加只剩
 * 0.0076（少 5.2 dB），而且 250–500 Hz 多了 2–5 dB、500–2000 Hz 少了 3–4 dB——
 * 音色被重塑，每個音還不一樣。VSCO 的立體檔是相干的一對，相加只差 0.6–2.3 dB，
 * 那時候相加才是對的（標準的單聲道混音）。
 *
 *  所以這裡解成兩聲道，量左、右、相加三個候選的能量，取最大的那個；單聲道來源
 *  （卡林巴、tonejs 那批）三個候選一樣，行為跟以前相同。ffmpeg 的 `-ac 1` 就是
 *  上面那個抵消的相加，不能再用。 */
function decode(file, seconds, stereo = false) {
  const { left, right } = decodeChannels(file, seconds);
  if (stereo) { stereoStats.kept++; return { stereo: true, left, right }; }
  stereoStats.mono++;
  const frames = left.length;
  const mid = new Float32Array(frames);
  const energy = [0, 0, 0];
  for (let i = 0; i < frames; i++) {
    const l = left[i];
    const r = right[i];
    mid[i] = (l + r) / 2;
    energy[0] += l * l;
    energy[1] += r * r;
    energy[2] += mid[i] * mid[i];
  }
  // 完全一樣（單聲道來源，或左右相同）就不用挑
  if (energy[0] === energy[1] && energy[1] === energy[2]) { channelChoice.mono++; return left; }
  const best = energy.indexOf(Math.max(...energy));
  channelChoice[['left', 'right', 'mid'][best]]++;
  return [left, right, mid][best];
}

/** 去掉開頭靜音、切長度、尾端淡出。不正規化（p 與 f 的音量差要留著）。 */
function shape(pcm, seconds) {
  if (pcm && pcm.stereo) {
    // 立體：兩個聲道一起切（同一段起點與長度），淡出也一起
    const len = Math.min(pcm.left.length, Math.round(seconds * RATE));
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(pcm.left[i]), Math.abs(pcm.right[i]));
    if (peak <= 0) throw new Error('silent sample');
    const floor = peak * ONSET_FLOOR;
    let start = 0;
    while (start < len && Math.abs(pcm.left[start]) < floor && Math.abs(pcm.right[start]) < floor) start++;
    start = Math.max(0, start - Math.round(PREROLL * RATE));
    const n = Math.min(len - start, Math.round(seconds * RATE));
    const outL = new Float32Array(n);
    const outR = new Float32Array(n);
    const fadeLen = Math.min(Math.round(FADE * RATE), n);
    for (let i = 0; i < n; i++) {
      const g = i >= n - fadeLen ? (n - i) / fadeLen : 1;
      outL[i] = pcm.left[start + i] * g;
      outR[i] = pcm.right[start + i] * g;
    }
    return { stereo: true, left: outL, right: outR };
  }
  let peak = 0;
  for (const v of pcm) peak = Math.max(peak, Math.abs(v));
  if (peak <= 0) throw new Error('silent sample');
  const floor = peak * ONSET_FLOOR;
  let start = 0;
  while (start < pcm.length && Math.abs(pcm[start]) < floor) start++;
  start = Math.max(0, start - Math.round(PREROLL * RATE));
  const len = Math.min(pcm.length - start, Math.round(seconds * RATE));
  const out = new Float32Array(len);
  const fadeLen = Math.min(Math.round(FADE * RATE), len);
  for (let i = 0; i < len; i++) out[i] = pcm[start + i] * (i >= len - fadeLen ? (len - i) / fadeLen : 1);
  return out;
}

function encode(pcm, dest) {
  const raw = join(SRC_CACHE, 'tmp.raw');
  if (pcm && pcm.stereo) {
    const inter = new Float32Array(pcm.left.length * 2);
    for (let i = 0; i < pcm.left.length; i++) { inter[2 * i] = pcm.left[i]; inter[2 * i + 1] = pcm.right[i]; }
    writeFileSync(raw, Buffer.from(inter.buffer, inter.byteOffset, inter.byteLength));
    sh('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '2', '-i', raw, '-c:a', 'libmp3lame', '-b:a', '128k', dest]);
  } else {
    writeFileSync(raw, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    sh('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', raw, '-c:a', 'libmp3lame', '-b:a', '96k', dest]);
  }
  rmSync(raw, { force: true });
}

const peakOf = (pcm) => {
  if (pcm && pcm.stereo) {
    let p = 0;
    for (let i = 0; i < pcm.left.length; i++) p = Math.max(p, Math.abs(pcm.left[i]), Math.abs(pcm.right[i]));
    return p;
  }
  let p = 0;
  for (const v of pcm) p = Math.max(p, Math.abs(v));
  return p;
};

// 量出來的八度修正：這七個來源的檔名比實際音高低一個八度（`A#3_v1` 裡是 468.5 Hz =
// A#4；卡林巴、長笛、弦樂群、小號…都是同一個 VSCO 慣例）。沒有列在這裡的（Salamander
// 鋼琴、Solo Violin）量起來本來就是對的。逐檔驗證：npm run analyze 或 tools 裡的稽核。
for (const name of ['cello', 'clarinet', 'oboe', 'trombone', 'tuba', 'viola', 'trumpet']) {
  if (INSTRUMENTS[name]) INSTRUMENTS[name].octave = 12;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const library = {};
  let made = 0;
  let reused = 0;
  let bytes = 0;

  for (const [name, inst] of Object.entries(INSTRUMENTS)) {
    const dir = join(OUT_DIR, name);
    mkdirSync(dir, { recursive: true });
    const entries = {};
    const peaksByLayer = {};   // 層名 -> 峰值（p／m／m1／m2／f…）
    const converted = new Map();     // 檔名 -> { pcm, layer }（還沒套該層的基準音量）

    for (const [noteName, layers] of Object.entries(inst.layers)) {
      const midi = midiOf(noteName) + (inst.octave || 0);
      const out = [];
      // 弱層在前、強層在後：播放時挑「不超過這個力度的最大 vel」
      // 由弱到強，vel 的門檻平均切開（2 層 → 0/0.5；3 層 → 0/0.33/0.67）
      const ordered = layers.map((file, i) => [
        i === 0 ? 'p' : i === layers.length - 1 ? 'f' : layers.length === 3 ? 'm' : `m${i}`,
        i / layers.length,
        file,
      ]);
      for (const [layerName, vel, file] of ordered) {
        const dest = join(dir, `${midi}-${layerName}.mp3`);
        const source = decode(fetchSource(inst.src || SRC, inst.dir ? `${inst.dir}/${file}` : file), inst.seconds, !!inst.stereo);
        (peaksByLayer[layerName] ||= []).push(peakOf(shape(source, inst.seconds)));
        if (!existsSync(dest) || FORCE) {
          converted.set(dest, { pcm: shape(source, inst.seconds), layer: layerName });
          made++;
        } else {
          reused++;
        }
        out.push({ vel, file: dest.slice(dir.length + 1) });
      }
      entries[midi] = out;
    }

    // 每一層各自的基準音量（見檔頭的說明）：層負責音色，音量交給力度
    const gainByLayer = {};
    for (const [layerName, list] of Object.entries(peaksByLayer)) {
      if (!list.length) continue;
      list.sort((a, b) => a - b);
      const median = list[Math.floor(list.length / 2)];
      gainByLayer[layerName] = median > 0 ? Math.min(64, Math.max(0.25, REFERENCE / median)) : 1;
    }
    for (const [dest, { pcm, layer }] of converted) {
      const g = gainByLayer[layer] || 1;
      if (pcm && pcm.stereo) {
        for (let i = 0; i < pcm.left.length; i++) { pcm.left[i] *= g; pcm.right[i] *= g; }
      } else {
        for (let i = 0; i < pcm.length; i++) pcm[i] *= g;
      }
      encode(pcm, dest);
    }
    // 放開鍵的釋音取樣（目前只有鋼琴）：一個音一個檔，很短，所以整組一個資料夾
    let release = null;
    if (inst.release) {
      const rdir = join(OUT_DIR, `${name}-release`);
      mkdirSync(rdir, { recursive: true });
      const notes = {};
      const peaks = [];
      const pending = [];
      for (const [noteName, file] of Object.entries(inst.release.files)) {
        const midi = midiOf(noteName) + (inst.octave || 0);
        const dest = join(rdir, `${midi}.mp3`);
        const pcm = shape(decode(fetchSource(inst.src || SRC, inst.release.dir ? `${inst.release.dir}/${file}` : file), inst.release.seconds || 1.5, !!inst.stereo), inst.release.seconds || 1.5);
        peaks.push(peakOf(pcm));
        pending.push([dest, pcm]);
        notes[midi] = `${midi}.mp3`;
      }
      peaks.sort((a, b) => a - b);
      const median = peaks[Math.floor(peaks.length / 2)] || 0;
      const g = median > 0 ? Math.min(64, Math.max(0.25, REFERENCE / median)) : 1;
      for (const [dest, pcm] of pending) {
        if (existsSync(dest) && !FORCE) { reused++; } else { made++; }
        for (let i = 0; i < pcm.length; i++) pcm[i] *= g;
        encode(pcm, dest);
      }
      release = {
        base: `samples/velocity/${name}-release/`,
        notes: Object.fromEntries(Object.keys(notes).map(Number).sort((a, b) => a - b).map((k) => [k, notes[k]])),
      };
      console.log(`  ${name} 釋音 ${Object.keys(notes).length} 個音（基準 ×${g.toFixed(2)}）`);
    }

    // 清掉孤兒檔：資料表沒有引用的檔案不該留在目錄裡（改了層的命名就會產生）
    const keep = new Set(Object.values(entries).flat().map((l) => l.file));
    for (const file of readdirSync(dir)) if (!keep.has(file)) rmSync(join(dir, file));
    const gaps = Object.keys(entries).map(Number).sort((a, b) => a - b);
    library[name] = {
      label: inst.label,
      credit: inst.credit,
      synth: inst.synth,
      base: `samples/velocity/${name}/`,
      gap: Math.max(0, ...gaps.slice(1).map((m, i) => m - gaps[i])),
      layers: Math.max(...Object.values(inst.layers).map((l) => l.length)),
      notes: Object.fromEntries(Object.keys(entries).map(Number).sort((a, b) => a - b).map((k) => [k, entries[k]])),
      ...(release ? { release } : {}),
    };
    const gains = Object.entries(gainByLayer).filter(([, g]) => g).map(([l, g]) => `${l} ×${g.toFixed(2)}`).join('、');
    console.log(`  ${name.padEnd(8)} ${Object.keys(entries).length} 個音　基準音量 ${gains}`);
  }

  const out = `// 有力度層的取樣樂器（產生的，不是手寫的）：音高 → 力度層 → 檔名。
//
// 來源：VSCO 2 Community Edition（CC0 1.0）——小提琴 Solo Violin/Arco Vib、
// 大提琴 Cello Section/susvib、長笛 Flute/susNV。轉檔方式與理由見 tools/build-velocity.mjs
// 與 samples/velocity/README.md。
//
// 每一層：vel 是這一層的起點（0..1，由弱到強）、file 相對於 base。
// 檔名裡的 p/m/f 是「最弱／中間／最強」，層數不一定一樣（小提琴 2 層、單簧管 3 層）。
// 每一層的音量都正規化到 ${REFERENCE}：層只負責音色（弱層真的比較暗），音量由播放時的
// 力度增益決定。播放時挑「不超過這個力度的最大 vel」，再乘上力度。
//
// 這一組覆蓋掉 src/sample-library.js 裡同名的遠端單層版本（見 src/samples.js 的合併）。

/** 有力度層的樂器，形狀跟 SAMPLE_LIBRARY 的項目一樣，但 notes 是陣列。 */
export const DYNAMIC_INSTRUMENTS = {
${Object.entries(library).map(([name, inst]) => `  ${name}: {
    label: '${inst.label}',
    credit: '${inst.credit}',
    synth: '${inst.synth}',
    base: '${inst.base}',
    gap: ${inst.gap},
    layers: ${inst.layers},
    notes: {
${Object.entries(inst.notes).map(([midi, list]) => `      ${midi}: [${list.map((l) => `{ vel: ${l.vel}, file: '${l.file}' }`).join(', ')}],`).join('\n')}
    },${inst.release ? `
    /** 放開鍵的釋音取樣：一個音一個檔（note-off 時播，鋼琴的「制音器」聲音）。 */
    release: {
      base: '${inst.release.base}',
      notes: {
${Object.entries(inst.release.notes).map(([midi, file]) => `        ${midi}: '${file}',`).join('\n')}
      },
    },` : ''}
  },`).join('\n')}
};
`;
  writeFileSync(LIB_FILE, out);
  for (const name of Object.keys(INSTRUMENTS)) {
    const dir = join(OUT_DIR, name);
    for (const file of readdirSync(dir)) bytes += readFileSync(join(dir, file)).length;
  }
  console.log(`\n寫入 ${Object.keys(library).length} 個樂器、${made} 個新檔案（沿用 ${reused}），檔案共 ${kb(bytes)}`);
  console.log(`立體來源的聲道選擇：左 ${channelChoice.left}、右 ${channelChoice.right}、相加 ${channelChoice.mid}，單聲道 ${channelChoice.mono}`);
  console.log(`保留立體聲的來源：${stereoStats.kept} 個（${[...STEREO_INSTRUMENTS].join('、') || '無'}）；轉成單聲道的：${stereoStats.mono} 個`);
}

main();

// 樣本換了就要換媒體快取的名字（否則使用者會一直拿到舊音檔）；見 tools/bump-media.mjs。
await import('./bump-media.mjs');
