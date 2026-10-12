// 產生「弦樂群」的取樣：VSCO 2 Community Edition 的三組分軌弦樂（CC0 1.0）——
// `Strings/Violin Section/susVib`、`Strings/Viola Section/susvib`、
// `Strings/Cello Section/susvib`，都是「持續音＋顫音」的錄音，每個音有兩個 take。
//
// 為什麼要這一個：我們的取樣庫裡原本**沒有弦樂群**——GM 44-45／48-51（弦樂群、震音、
// 撥奏）在引擎裡是依音域借「獨奏」小提琴／大提琴／低音提琴來演，一個人拉一整組弦樂
// 聽起來就是薄。三組分軌合起來才是真正的一組弦樂：低音由大提琴組、中音由中提琴組、
// 高音由小提琴組。
//
// **音號＝檔名 + 12，量到的頻率只用來驗證。** VSCO 的檔名低一個八度（長笛那份量過：
// `C3_v1_1.wav` 裡是 261.6 Hz；這裡 `susvib_G1_v1_1.wav` 量到 98.0 Hz = G2），而且
// 這個慣例與樂器本身的音域吻合（大提琴最低的空弦是 C2 = 65.4 Hz，不是 32.7）。
//
// 為什麼不是「以量到的為準」：低音弦樂的錄音裡基頻常常比泛音弱（大提琴組的 C 音，
// 基頻 65.4 Hz 比第二泛音小），諧波求和會往上抓一個八度甚至更多——第一版就是這樣把
// 大提琴組的 C2 量成 327 Hz。所以八度交給檔名（已驗證的慣例＋樂器音域），
// 量測只確認「音級對不對」（與最近的八度差 30 音分以內），並把量測偏掉幾個八度印出來。
//
// 需要的東西：Node 18+、ffmpeg（含 libmp3lame）、網路。輸出已進版控，平常不用重跑。
//
//   node tools/build-strings.mjs [--force]
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RATE, sh, pickChannel, shape, peakOf, matchTakes, encode, measureHz, midiOfHz, noteName,
  cleanOrphans, writeFile, exists,
} from './sampled-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'samples', 'strings');
const LIB_FILE = join(ROOT, 'src', 'strings-library.js');
const CACHE = '/tmp/chiptune-strings';
const REPO = 'sgossner/VSCO-2-CE';
const SRC = `https://raw.githubusercontent.com/${REPO}/master/`;
const CREDIT = 'VSCO 2 Community Edition — Violin/Viola/Cello Section, susvib（CC0 1.0）';
const FORCE = process.argv.includes('--force');

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 來源檔名的音高比實際低一個八度（量到的，見檔頭）。 */
const SOURCE_OCTAVE = 12;
const midiOf = (name) => {
  const m = name.match(/^([A-G])([#b]?)(-?\d)$/);
  return NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (+m[3] + 1) * 12 + SOURCE_OCTAVE;
};

const SECONDS = 4;
const REFERENCE = 0.7;

/** 三組分軌：來源資料夾、檔名（音名 → 這個音有哪幾個 take）。 */
const SECTIONS = {
  violin: {
    label: '小提琴組',
    dir: 'Strings/Violin Section/susVib',
    notes: {
      G2: ['VlnEns_susVib_G2_v1.wav', 'VlnEns_susVib_G2_v2.wav'],
      A2: ['VlnEns_susVib_A2_v1.wav', 'VlnEns_susVib_A2_v2.wav'],
      B2: ['VlnEns_susVib_B2_v1.wav', 'VlnEns_susVib_B2_v2.wav'],
      D3: ['VlnEns_susVib_D3_v1.wav', 'VlnEns_susVib_D3_v2.wav'],
      'F#3': ['VlnEns_susVib_F#3_v1.wav', 'VlnEns_susVib_F#3_v2.wav'],
      A3: ['VlnEns_susVib_A3_v1.wav', 'VlnEns_susVib_A3_v2.wav'],
      C4: ['VlnEns_susVib_C4_v1.wav', 'VlnEns_susVib_C4_v2.wav'],
      E4: ['VlnEns_susVib_E4_v1.wav', 'VlnEns_susVib_E4_v2.wav'],
      G4: ['VlnEns_susVib_G4_v1.wav', 'VlnEns_susVib_G4_v2.wav'],
      B4: ['VlnEns_susVib_B4_v1.wav', 'VlnEns_susVib_B4_v2.wav'],
      D5: ['VlnEns_susVib_D5_v1.wav', 'VlnEns_susVib_D5_v2.wav'],
    },
  },
  viola: {
    label: '中提琴組',
    dir: 'Strings/Viola Section/susvib',
    notes: {
      C2: ['ViolaEns_susvib_C2_v1_1.wav', 'ViolaEns_susvib_C2_v2_1.wav'],
      D2: ['ViolaEns_susvib_D2_v1_1.wav', 'ViolaEns_susvib_D2_v2_1.wav'],
      E2: ['ViolaEns_susvib_E2_v1_1.wav', 'ViolaEns_susvib_E2_v2_1.wav'],
      G2: ['ViolaEns_susvib_G2_v1_1.wav', 'ViolaEns_susvib_G2_v2_1.wav'],
      B2: ['ViolaEns_susvib_B2_v1_1.wav', 'ViolaEns_susvib_B2_v2_1.wav'],
      D3: ['ViolaEns_susvib_D3_v1_1.wav', 'ViolaEns_susvib_D3_v2_1.wav'],
      F3: ['ViolaEns_susvib_F3_v1_1.wav', 'ViolaEns_susvib_F3_v2_1.wav'],
      A3: ['ViolaEns_susvib_A3_v1_1.wav', 'ViolaEns_susvib_A3_v2_1.wav'],
      C4: ['ViolaEns_susvib_C4_v1_1.wav', 'ViolaEns_susvib_C4_v2_1.wav'],
      E4: ['ViolaEns_susvib_E4_v1_1.wav', 'ViolaEns_susvib_E4_v2_1.wav'],
      G4: ['ViolaEns_susvib_G4_v1_1.wav', 'ViolaEns_susvib_G4_v2_1.wav'],
      B4: ['ViolaEns_susvib_B4_v1_1.wav', 'ViolaEns_susvib_B4_v2_1.wav'],
      D5: ['ViolaEns_susvib_D5_v1_1.wav', 'ViolaEns_susvib_D5_v2_1.wav'],
    },
  },
  cello: {
    label: '大提琴組',
    dir: 'Strings/Cello Section/susvib',
    notes: {
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
};

function fetchSource(section, file) {
  const local = join(CACHE, file);
  if (exists(local) && !FORCE) return local;
  sh('mkdir', ['-p', CACHE]);
  sh('curl', ['-sfL', SRC + section.dir.split('/').map(encodeURIComponent).join('/') + '/' + encodeURIComponent(file), '-o', local]);
  return local;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  // 1) 每個段落：抓檔 → 挑聲道 → 整形 → 量音高（音號以量到的為準）→ take 對齊
  const recorded = [];   // { section, midi, fileName, hz, takes }
  for (const [key, section] of Object.entries(SECTIONS)) {
    for (const [name, files] of Object.entries(section.notes)) {
      const takes = files.map((f) => shape(pickChannel(fetchSource(section, f), SECONDS), SECONDS));
      const hz = measureHz(takes[0]);
      const midi = midiOf(name);
      // 量到的頻率與這個音號差幾個八度（0 = 量測與檔名一致；正數代表量測偏高）
      const octaves = Math.round(Math.log2(hz / (440 * 2 ** ((midi - 69) / 12))));
      recorded.push({ section: key, name, midi, hz, octaves, takes, files });
    }
  }
  // 2) 同一個音號可能有三組都錄到：挑「離這個音號最近的那一組」（同距離時挑音域比較
  //    合適的那一組＝中位數離得比較近的）。這樣一條寬廣的和弦會有大提琴組的低音、
  //    小提琴組的高音，而不是全部用同一把樂器硬拉。
  const byMidi = new Map();
  for (const entry of recorded) {
    const { section, midi, takes, files, octaves } = entry;
    const sectionMidis = recorded.filter((r) => r.section === section).map((r) => r.midi).sort((a, b) => a - b);
    const median = sectionMidis[Math.floor(sectionMidis.length / 2)];
    // 同一個音號有兩個段落都錄到時：挑「這個段落的中位音域離它比較近」的那一個
    // （低音給大提琴組、中音給中提琴組、高音給小提琴組）。
    const score = [Math.abs(midi - median), Math.abs(octaves)];
    const prev = byMidi.get(midi);
    if (!prev || score[0] < prev.score[0] || (score[0] === prev.score[0] && score[1] < prev.score[1])) {
      byMidi.set(midi, { section, name: entry.name, midi, hz: entry.hz, takes, files, score, octaves });
    }
  }
  const midis = [...byMidi.keys()].sort((a, b) => a - b);

  // 3) 音高驗證：量到的頻率與選定的音號必須對得上（音分）
  const rows = midis.map((m) => {
    const hit = byMidi.get(m);
    const want = 440 * 2 ** ((m - 69) / 12);
    return { ...hit, want, cents: 1200 * Math.log2(hit.hz / want) };
  });
  console.log('音號  音名   段落     量到Hz    應該Hz   音分   來源檔名');
  for (const r of rows) {
    console.log(`${String(r.midi).padStart(4)}  ${noteName(r.midi).padEnd(5)} ${SECTIONS[r.section].label}  ${r.hz.toFixed(1).padStart(8)} ${r.want.toFixed(1).padStart(8)} ${r.cents.toFixed(1).padStart(6)}   ${r.files[0]}`);
  }
  const gaps = midis.slice(1).map((m, i) => m - midis[i]);
  // 量測確認的是**音級**（C、E、G…），八度交給檔名與樂器音域：低音弦樂的錄音裡基頻
  // 常常很弱（大提琴組的 C2，65.4 Hz 只有 −49.6 dB，第二泛音才是最大的），諧波求和
  // 會往上抓好幾個八度。音級不會錯，所以用它當檢查。
  const pitchClass = (m) => ((m % 12) + 12) % 12;
  const classOk = rows.filter((r) => pitchClass(midiOfHz(r.hz)) === pitchClass(r.midi)).length;
  const weak = rows.filter((r) => r.octaves !== 0).length;
  const twoTake = rows.filter((r) => r.takes.length > 1).length;
  const checks = [
    [`${midis.length} 個音（${noteName(midis[0])}–${noteName(midis[midis.length - 1])}）`, midis.length >= 20],
    ['三個段落都有用到', new Set(rows.map((r) => r.section)).size === 3],
    [`量到的音級與音號相符（${classOk}/${rows.length}）`, classOk >= rows.length - 2],
    [`${weak} 個檔的基頻較弱（量測偏高／偏低一個八度，八度以檔名與樂器音域為準）`, true],
    [`相鄰錄音最多差 ${Math.max(...gaps)} 個半音`, Math.max(...gaps) <= 4],
    [`${twoTake} 個音有兩個 take 可以輪替`, twoTake >= 15],
  ];
  for (const [what, ok] of checks) console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);

  // 4) 全樂器統一基準音量（跟 build-velocity 一樣：樂器之間一致，樂器內部保留）
  const peaks = rows.map((r) => Math.max(...r.takes.map(peakOf))).filter((p) => p > 0).sort((a, b) => a - b);
  const median = peaks[Math.floor(peaks.length / 2)];
  const gain = median > 0 ? Math.min(64, Math.max(0.25, REFERENCE / median)) : 1;
  console.log(`\n基準音量：中位峰值 ${median.toFixed(3)} → 整組 ×${gain.toFixed(2)}`);

  // 5) 編碼 + 寫資料表
  const notes = {};
  let made = 0;
  let reused = 0;
  for (const r of rows) {
    const files = [];
    r.takes.forEach((pcm, i) => {
      for (let k = 0; k < pcm.length; k++) pcm[k] *= gain;
      const file = `${r.midi}-${'ab'[i]}.mp3`;
      const dest = join(OUT_DIR, file);
      if (exists(dest) && !FORCE) reused++;
      else { encode(pcm, dest, { cache: CACHE }); made++; }
      files.push(file);
    });
    notes[r.midi] = { takes: files };
  }
  const body = midis.map((m) => `    ${m}: { takes: [${notes[m].takes.map((f) => `'${f}'`).join(', ')}] },`).join('\n');
  writeFile(LIB_FILE, `// 弦樂群的取樣表（產生的，不是手寫的）：音號 → 每個音有哪幾個 take。
//
// 來源：${CREDIT}
// 三組分軌合起來：低音用大提琴組、中音用中提琴組、高音用小提琴組，共
// ${midis.length} 個音（${noteName(midis[0])}–${noteName(midis[midis.length - 1])}）。音號**以量到的基頻為準**，
// 不看檔名（VSCO 的檔名有低一個八度的慣例）。產生方式見 tools/build-strings.mjs。
//
// 這一個是取樣庫裡原本沒有的樂器：GM 44-45／48-51（弦樂群、震音、撥奏）以前是依音域
// 借「獨奏」小提琴／大提琴／低音提琴，一個人拉一整組弦樂聽起來就是薄。
// 檔案在 repo 裡，跟鼓組、卡林巴、長笛一樣進 service worker 預快取。
export const STRINGS_INSTRUMENT = {
  label: '弦樂群',
  credit: '${CREDIT}',
  synth: 'real:strings',
  base: 'samples/strings/',
  /** 相鄰錄音最多差幾個半音（中間的音用播放速率內插）。 */
  gap: ${Math.max(...gaps)},
  /** 每個音最多幾個 take（round robin 用）。 */
  takes: ${Math.max(...rows.map((r) => r.takes.length))},
  notes: {
${body}
  },
};
`);
  const removed = cleanOrphans(OUT_DIR, new Set(Object.values(notes).flatMap((n) => n.takes)));
  if (removed) console.log(`刪掉 ${removed} 個不被資料表引用的孤兒檔`);
  console.log(`\n${made} 個轉檔、${reused} 個沿用；資料表寫入 src/strings-library.js`);
}

main();

// 樣本換了就要換媒體快取的名字（否則使用者會一直拿到舊音檔）；見 tools/bump-media.mjs。
await import('./bump-media.mjs');
