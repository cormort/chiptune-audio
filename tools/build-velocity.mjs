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
// 每個擊點的處理：單聲道 44.1 kHz、去掉開頭靜音（保留 3 ms）、切到 `seconds` 秒、
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
const SRC = 'https://raw.githubusercontent.com/sgossner/VSCO-2-CE/master/';
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
 * `layers[note] = { p: 檔名, f: 檔名 }`（`f` 省略＝這個音只有一層）。
 * 檔名相對於來源 repo。
 */
const INSTRUMENTS = {
  violin: {
    label: '小提琴',
    credit: 'VSCO 2 Community Edition — Solo Violin, Arco Vib（CC0 1.0）',
    synth: 'real:violin',
    seconds: 4,
    dir: 'Strings/Solo Violin/Arco Vib',
    layers: {
      G3: { p: 'LLVln_ArcoVib_G3_p.wav', f: 'LLVln_ArcoVib_G3_f.wav' },
      A3: { p: 'LLVln_ArcoVib_A3_p.wav', f: 'LLVln_ArcoVib_A3_f.wav' },
      C4: { p: 'LLVln_ArcoVib_C4_p.wav', f: 'LLVln_ArcoVib_C4_f.wav' },
      E4: { p: 'LLVln_ArcoVib_E4_p.wav', f: 'LLVln_ArcoVib_E4_f.wav' },
      G4: { p: 'LLVln_ArcoVib_G4_p.wav', f: 'LLVln_ArcoVib_G4_f.wav' },
      A4: { p: 'LLVln_ArcoVib_A4_p.wav', f: 'LLVln_ArcoVib_A4_f.wav' },
      C5: { p: 'LLVln_ArcoVib_C5_p.wav', f: 'LLVln_ArcoVib_C5_f.wav' },
      E5: { p: 'LLVln_ArcoVib_E5_p.wav', f: 'LLVln_ArcoVib_E5_f.wav' },
      G5: { p: 'LLVln_ArcoVib_G5_p.wav', f: 'LLVln_ArcoVib_G5_f.wav' },
      A5: { p: 'LLVln_ArcoVib_A5_p.wav', f: 'LLVln_ArcoVib_A5_f.wav' },
      C6: { p: 'LLVln_ArcoVib_C6_p.wav', f: 'LLVln_ArcoVib_C6_f.wav' },
      E6: { p: 'LLVln_ArcoVib_E6_p.wav', f: 'LLVln_ArcoVib_E6_f.wav' },
      G6: { p: 'LLVln_ArcoVib_G6_p.wav', f: 'LLVln_ArcoVib_G6_f.wav' },
      A6: { p: 'LLVln_ArcoVib_A6_p.wav', f: 'LLVln_ArcoVib_A6_f.wav' },
      C7: { p: 'LLVln_ArcoVib_C7_p.wav', f: 'LLVln_ArcoVib_C7_f.wav' },
    },
  },
  cello: {
    label: '大提琴',
    credit: 'VSCO 2 Community Edition — Cello Section, susvib（CC0 1.0）',
    synth: 'real:cello',
    seconds: 4,
    dir: 'Strings/Cello Section/susvib',
    layers: {
      C1: { p: 'susvib_C1_v1_1.wav', f: 'susvib_C1_v3_1.wav' },
      E1: { p: 'susvib_E1_v1_1.wav', f: 'susvib_E1_v3_1.wav' },
      G1: { p: 'susvib_G1_v1_1.wav', f: 'susvib_G1_v3_1.wav' },
      B1: { p: 'susvib_B1_v1_1.wav', f: 'susvib_B1_v3_1.wav' },
      D2: { p: 'susvib_D2_v1_1.wav', f: 'susvib_D2_v3_1.wav' },
      F2: { p: 'susvib_F2_v1_1.wav', f: 'susvib_F2_v3_1.wav' },
      A2: { p: 'susvib_A2_v1_1.wav', f: 'susvib_A2_v3_1.wav' },
      C3: { p: 'susvib_C3_v1_1.wav', f: 'susvib_C3_v3_1.wav' },
      E3: { p: 'susvib_E3_v1_1.wav', f: 'susvib_E3_v3_1.wav' },
      G3: { p: 'susvib_G3_v1_1.wav', f: 'susvib_G3_v3_1.wav' },
      B3: { p: 'susvib_B3_v1_1.wav', f: 'susvib_B3_v3_1.wav' },
      D4: { p: 'susvib_D4_v1_1.wav', f: 'susvib_D4_v3_1.wav' },
      F4: { p: 'susvib_F4_v1_1.wav', f: 'susvib_F4_v3_1.wav' },
    },
  },
  trumpet: {
    label: '小號',
    credit: 'VSCO 2 Community Edition — Trumpet, sus（CC0 1.0）',
    synth: 'real:trumpet',
    seconds: 4,
    dir: 'Brass/Trumpet/sus',
    layers: {
      F2: { p: 'Sum_SHTrumpet_sus_F2_v1_rr1.wav', f: 'Sum_SHTrumpet_sus_F2_v3_rr1.wav' },
      A2: { p: 'Sum_SHTrumpet_sus_A2_v1_rr1.wav', f: 'Sum_SHTrumpet_sus_A2_v3_rr1.wav' },
      C3: { p: 'Sum_SHTrumpet_sus_C3_v1_rr1.wav', f: 'Sum_SHTrumpet_sus_C3_v3_rr1.wav' },
      'D#3': { p: 'Sum_SHTrumpet_sus_D#3_v1_rr1.wav', f: 'Sum_SHTrumpet_sus_D#3_v3_rr1.wav' },
      'A#3': { p: 'Sum_SHTrumpet_sus_A#3_v1_rr1.wav', f: 'Sum_SHTrumpet_sus_A#3_v3_rr1.wav' },
      D4: { p: 'Sum_SHTrumpet_sus_D4_v1_rr1.wav', f: 'Sum_SHTrumpet_sus_D4_v3_rr1.wav' },
      F4: { p: 'Sum_SHTrumpet_sus_F4_v1_rr1.wav', f: 'Sum_SHTrumpet_sus_F4_v3_rr1.wav' },
      G3: { p: 'Sum_SHTrumpet_sus_G3_v1_rr1.wav', f: 'Sum_SHTrumpet_sus_G3_v3_rr1.wav' },
      A4: { p: 'Sum_SHTrumpet_sus_A4_v1_rr1.wav', f: 'Sum_SHTrumpet_sus_A4_v3_rr1.wav' },
      C5: { p: 'Sum_SHTrumpet_sus_C5_v1_rr1.wav', f: 'Sum_SHTrumpet_sus_C5_v3_rr1.wav' },
    },
  },
};

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { maxBuffer: 1 << 29, ...opts });
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

function fetchSource(path) {
  const local = join(SRC_CACHE, path.replace(/\//g, '_'));
  if (existsSync(local) && !FORCE) return local;
  mkdirSync(SRC_CACHE, { recursive: true });
  sh('curl', ['-sfL', SRC + path.split('/').map(encodeURIComponent).join('/'), '-o', local]);
  return local;
}

/** FLAC/WAV → 單聲道 f32 44.1 kHz（只解到需要的長度）。 */
function decode(file, seconds) {
  const buf = sh('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(RATE), '-t', String(seconds + 0.4), '-']);
  const copy = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(copy, 0, Math.floor(copy.byteLength / 4));
}

/** 去掉開頭靜音、切長度、尾端淡出。不正規化（p 與 f 的音量差要留著）。 */
function shape(pcm, seconds) {
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
  writeFileSync(raw, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  sh('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', raw, '-c:a', 'libmp3lame', '-b:a', '96k', dest]);
  rmSync(raw, { force: true });
}

const peakOf = (pcm) => { let p = 0; for (const v of pcm) p = Math.max(p, Math.abs(v)); return p; };

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
    const peaksByLayer = { p: [], f: [] };
    const converted = new Map();     // 檔名 -> { pcm, layer }（還沒套該層的基準音量）

    for (const [noteName, layers] of Object.entries(inst.layers)) {
      const midi = midiOf(noteName);
      const out = [];
      // 弱層在前、強層在後：播放時挑「不超過這個力度的最大 vel」
      const ordered = layers.f ? [['p', 0, layers.p], ['f', 0.5, layers.f]] : [['p', 0, layers.p]];
      for (const [layerName, vel, file] of ordered) {
        const dest = join(dir, `${midi}-${layerName}.mp3`);
        const source = decode(fetchSource(`${inst.dir}/${file}`), inst.seconds);
        peaksByLayer[layerName].push(peakOf(shape(source.slice(), inst.seconds)));
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
      gainByLayer[layerName] = median > 0 ? Math.min(16, Math.max(0.25, REFERENCE / median)) : 1;
    }
    for (const [dest, { pcm, layer }] of converted) {
      const g = gainByLayer[layer] || 1;
      for (let i = 0; i < pcm.length; i++) pcm[i] *= g;
      encode(pcm, dest);
    }
    const gaps = Object.keys(entries).map(Number).sort((a, b) => a - b);
    library[name] = {
      label: inst.label,
      credit: inst.credit,
      synth: inst.synth,
      base: `samples/velocity/${name}/`,
      gap: Math.max(0, ...gaps.slice(1).map((m, i) => m - gaps[i])),
      layers: 2,
      notes: Object.fromEntries(Object.keys(entries).map(Number).sort((a, b) => a - b).map((k) => [k, entries[k]])),
    };
    const gains = Object.entries(gainByLayer).map(([l, g]) => `${l} ×${g.toFixed(2)}`).join('、');
    console.log(`  ${name.padEnd(8)} ${Object.keys(entries).length} 個音　基準音量 ${gains}`);
  }

  const out = `// 有力度層的取樣樂器（產生的，不是手寫的）：音高 → 力度層 → 檔名。
//
// 來源：VSCO 2 Community Edition（CC0 1.0）——小提琴 Solo Violin/Arco Vib、
// 大提琴 Cello Section/susvib、長笛 Flute/susNV。轉檔方式與理由見 tools/build-velocity.mjs
// 與 samples/velocity/README.md。
//
// 每一層：vel 是這一層的起點（0..1，由弱到強）、file 相對於 base。
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
    },
  },`).join('\n')}
};
`;
  writeFileSync(LIB_FILE, out);
  for (const name of Object.keys(INSTRUMENTS)) {
    const dir = join(OUT_DIR, name);
    for (const file of readdirSync(dir)) bytes += readFileSync(join(dir, file)).length;
  }
  console.log(`\n寫入 ${Object.keys(library).length} 個樂器、${made} 個新檔案（沿用 ${reused}），檔案共 ${kb(bytes)}`);
}

main();
