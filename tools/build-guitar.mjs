// 產生木吉他與電吉他的取樣：Karoryfer Samples 的 **Shinyguitar**（CC0 1.0）。
//
// 為什麼換掉原本的：三把吉他原本都是**單層**（木吉他 17 檔、電吉他 17 檔，各一層力度），
// 小力彈只是同一段錄音變小聲、音色不會變柔——這是最容易被聽出來的「假」。Shinyguitar 的
// 對應表（`Programs/acoustic_five.sfz`、`electric_five.sfz`）量出來是：
//
//   木吉他 272 個 region、**3 層力度**（lovel 33／65／97）、16 個音高（MIDI 37–84）
//   電吉他 912 個 region、**3 層力度**、16 個音高（MIDI 37–84），每個層還有 3 個 round robin
//
// 所以一把來源同時解決木吉他與電吉他。音高一律讀 SFZ 的 `pitch_keycenter`（檔名是
// `db2_vl1_rr1_2.wav` 這種，音高在檔名裡是音名、層與 rr 在後面），再用諧波求和逐檔驗證。
//
// 需要的東西：Node 18+、ffmpeg（含 libmp3lame）、網路。輸出已進版控，平常不用重跑。
//
//   node tools/build-guitar.mjs [--force]
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RATE, sh, pickChannel, shape, peakOf, encode, measureHz, midiOfHz, noteName,
  cleanOrphans, writeFile, exists,
} from './sampled-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = '/tmp/chiptune-guitar';
// `--jazz` 換成另一把 CC0 吉他：Karoryfer 的 Emily（Epiphone 半空心、flatwound 弦），
// 4 層力度 × 3 round robin、24 個音高（MIDI 37–96）。它的 SFZ 跟 Shinyguitar 不一樣：
// 力度寫在**檔名**（`notes/a2_mf_rr1.wav` 的 mf）而不是 group 的 lovel／hivel，
// 而且同一張表裡還有 noises（手指摩擦）與 release（放開弦）的取樣，要濾掉。

// jsDelivr 是 GitHub 的 CDN 鏡像：raw.githubusercontent 在連續抓上百個檔之後會開始
// 回 429／HTML 錯誤頁（那會讓 SFZ 解析成 0 個 region，而 curl 還是回 200）。



const FORCE = process.argv.includes('--force');
const SECONDS = 3.2;
const REFERENCE = 0.7;
const LAYERS = 3;

/** 兩把吉他：SFZ 程式、輸出資料夾、資料表鍵名、中文名、代理合成音色。 */
const JAZZ = process.argv.includes('--jazz');
/** 兩套來源：Shinyguitar（木吉他＝鋼弦、電吉他）與 Emily（半空心、flatwound 弦，當爵士吉他）。 */
const SOURCES = {
  shiny: { repo: 'sfzinstruments/karoryfer.shinyguitar', credit: 'Sharur Shinyguitar — Karoryfer Samples（CC0 1.0）', layers: 'hivel' },
  emily: { repo: 'sfzinstruments/karoryfer.emilyguitar', credit: 'Emily the Strange guitar — Karoryfer Samples（CC0 1.0）', layers: 'name' },
};
const ALL_GUITARS = [
  { key: 'guitar-acoustic', src: 'shiny', sfz: 'Programs/acoustic_five.sfz', dir: 'samples/guitar-acoustic', label: '木吉他', synth: 'real:guitar' },
  { key: 'guitar-electric', src: 'shiny', sfz: 'Programs/electric_five.sfz', dir: 'samples/guitar-electric', label: '電吉他', synth: 'real:guitar' },
  { key: 'guitar-jazz', src: 'emily', sfz: 'emily_clean.sfz', dir: 'samples/guitar-jazz', label: '爵士吉他', synth: 'real:guitar' },
];
// 一次跑就重建**全部**（快取讓它很快）：這個資料表是整份寫出的，只跑一部分會把其他把
// 吉他的項目洗掉。`--jazz` 只是保留給「只想看爵士那把」的除錯用，不會只寫一部分。
const GUITARS = ALL_GUITARS;
const RAW_OF = (src) => `https://cdn.jsdelivr.net/gh/${SOURCES[src].repo}@master/`;
const API_OF = (src) => `https://api.github.com/repos/${SOURCES[src].repo}/git/trees/HEAD?recursive=1`;

/** 抓文字檔（SFZ、GitHub 的檔案樹）：失敗要**大聲**，不要靜靜地回空字串——
 *  那會讓整把樂器變成 0 個 region 而沒有錯誤訊息。 */
function fetchText(url, tries = 4) {
  let last = '';
  for (let i = 0; i < tries; i++) {
    const text = sh('curl', ['-sfL', '--retry', '3', '--retry-delay', '2', url]).toString();
    if (text.length > 200) return text;
    last = text;
    sh('sleep', [String(2 * (i + 1))]);
  }
  throw new Error(`抓不到 ${url}（拿到 ${last.length} 個字元）`);
}

/** SFZ 文字：抓一次就快取在 /tmp（來源不會變，而且 GitHub 會限流）。 */
function readSfz(src, path) {
  const cached = join(CACHE, `${src}-${path.replace(/[^\w.-]/g, '_')}`);
  if (exists(cached)) return readFileSync(cached, 'utf8');
  const text = fetchText(RAW_OF(src) + path);
  mkdirSync(CACHE, { recursive: true });
  writeFile(cached, text);
  return text;
}

/** 檔名 → 在 repo 裡的路徑（SFZ 用的是 Windows 反斜線，資料夾名也不一定一樣）。 */
function sampleIndex(src) {
  const cached = join(CACHE, `tree-${src}.json`);
  if (exists(cached)) return new Map(JSON.parse(readFileSync(cached, 'utf8')));
  const tree = JSON.parse(fetchText(API_OF(src)));
  const map = new Map();
  for (const t of tree.tree) {
    if (!/\.(wav|flac)$/i.test(t.path)) continue;
    map.set(basename(t.path).toLowerCase(), t.path);
  }
  mkdirSync(CACHE, { recursive: true });
  writeFile(join(CACHE, 'tree.json'), JSON.stringify([...map]));
  return map;
}

/** SFZ → 每個 region 的 { keycenter, layer, file }。
 *
 *  這張表是**分群**的：`<group>` 標頭放共用的設定（`lokey`／`hivel`／`pitch_keycenter`），
 *  後面的 `<region>` 繼承它，只列自己的 `sample=`。第一版用 `<region>` 切字串、
 *  在每一塊裡找 keycenter，結果抓到的是**下一個 group** 的值（所以量出來會是
 *  「keycenter C#2 卻是 G#3」這種鬼數字）。所以要照順序走，維護「目前的 group 狀態」。
 */
function parseSfz(src, path) {
  const lines = readSfz(src, path).split(/\r?\n/);
  let group = {};
  let cur = null;
  const out = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (!t || t.startsWith('//')) continue;
    if (t.startsWith('<')) {
      const tag = t.replace(/[<>]/g, '').split(/\s/)[0].toLowerCase();
      if (tag === 'group') { group = {}; cur = null; }
      else if (tag === 'region') { if (cur) out.push(cur); cur = { ...group }; }
      else if (tag === 'global') { cur = null; }
      continue;
    }
    const m = t.match(/^([A-Za-z_0-9]+)=(.*)$/);
    if (!m) continue;
    if (cur) cur[m[1].toLowerCase()] = m[2];
    else group[m[1].toLowerCase()] = m[2];
  }
  if (cur) out.push(cur);
  return out.filter((r) => r.pitch_keycenter && r.sample).map((r) => {
    const file = basename(String(r.sample).trim().replace(/\\/g, '/'));
    // 力度層：用這一群的 hivel／lovel 判（hivel 32/64/127 = 弱／中／強）
    const raw0 = String(r.sample).trim().replace(/\\/g, '/');
    if (SOURCES[src].layers === 'name') {
      // 只收 notes/ 底下的（noises／release 是同一個程式裡的效果音，不是音高）
      if (!/^notes\//i.test(raw0)) return null;
      const dyn = file.match(/_(pp|mf|ff|p|f)_rr\d/i);
      const layer = !dyn ? 1 : (dyn[1].toLowerCase() === 'pp' || dyn[1].toLowerCase() === 'p') ? 0
        : (dyn[1].toLowerCase() === 'mf') ? 1 : 2;
      return { keycenter: +r.pitch_keycenter, layer, file, lo: 0, hi: 127 };
    }
    const hi = Number(r.hivel ?? 127);
    const lo = Number(r.lovel ?? 0);
    const mid = (hi + lo) / 2;
    const layer = mid <= 40 ? 0 : mid <= 80 ? 1 : 2;
    return { keycenter: +r.pitch_keycenter, layer, file, lo, hi };
  // `vl4`／`rr4` 不是音：這套來源把敲擊、摩擦、放開弦的雜音也放在同一張表裡
  }).filter((r) => r && !/vl4|rr4/i.test(r.file));
}

function local(src, file) {
  const p = join(CACHE, file);
  if (exists(p) && !FORCE) return p;
  mkdirSync(CACHE, { recursive: true });
  const path = sampleIndexCache[src].get(file.toLowerCase());
  if (!path) throw new Error(`來源裡找不到 ${file}`);
  sh('curl', ['-sfL', RAW_OF(src) + path.split('/').map(encodeURIComponent).join('/'), '-o', p]);
  return p;
}

const sampleIndexCache = {};

function main() {
  for (const src of new Set(ALL_GUITARS.map((g) => g.src))) sampleIndexCache[src] = sampleIndex(src);
  const library = {};
  let made = 0;
  let reused = 0;

  for (const g of GUITARS) {
    const outDir = join(ROOT, g.dir);
    mkdirSync(outDir, { recursive: true });
    const regions = parseSfz(g.src, g.sfz);
    if (regions.length < 24) throw new Error(`${g.key} 只解析到 ${regions.length} 個 region`);
    // 依 (音高, 層) 分組，取第一個 region 當代表（同一個位置有多個 round robin，
    // 這次只取一個：層數是這次的重點，round robin 留給下一輪）
    const byPitch = new Map();
    for (const r of regions) {
      const layer = r.layer;
      const k = `${r.keycenter}|${layer}`;
      if (!byPitch.has(k)) byPitch.set(k, r.file);
    }
    // 逐層的峰值基準（層負責音色、力度負責音量——跟 build-velocity 同一個規則）
    const peaksByLayer = [[], [], []];
    const notes = {};
    const rows = [];
    for (const [k, file] of [...byPitch.entries()].sort()) {
      const [keycenter, layer] = k.split('|').map(Number);
      const pcm = shape(pickChannel(local(g.src, file), SECONDS), SECONDS);
      peaksByLayer[layer].push(peakOf(pcm));
      rows.push({ keycenter, layer, file, pcm });
    }
    const gainByLayer = peaksByLayer.map((list) => {
      list.sort((a, b) => a - b);
      const median = list[Math.floor(list.length / 2)] || 0;
      return median > 0 ? Math.min(64, Math.max(0.25, REFERENCE / median)) : 1;
    });
    // 量音高：SFZ 的 keycenter 是音高的依據，量測只做驗證（來源檔名不是直接音高）
    const checks = rows.map((r) => {
      const hz = measureHz(r.pcm);
      const cents = 1200 * Math.log2(hz / (440 * 2 ** ((r.keycenter - 69) / 12)));
      return { ...r, hz, cents, measured: midiOfHz(hz) };
    });
    const worst = Math.max(...checks.map((c) => Math.abs(c.cents)));
    const classOk = checks.filter((c) => ((c.measured % 12) + 12) % 12 === ((c.keycenter % 12) + 12) % 12).length;
    console.log(`${g.label}（${g.key}）：${regions.length} 個 region → ${rows.length} 個檔（${new Set(rows.map((r) => r.keycenter)).size} 個音高 × ${LAYERS} 層）`);
    console.log(`  音高：量到的音級與 SFZ keycenter 相符 ${classOk}/${checks.length}；與 keycenter 最大差 ${worst.toFixed(1)} 音分`);
    console.log(`  逐層基準音量：${gainByLayer.map((x) => '×' + x.toFixed(2)).join('　')}`);
    // 低音弦的基頻很弱（跟大提琴組一樣），諧波求和會抓到第 3 泛音；音高以 SFZ 的
    // pitch_keycenter 為準（檔名 db2／gb2／c3 也各自佐證），量測只回報不一致的數量。
    if (classOk < checks.length - 8) {
      for (const c of checks.filter((x) => ((x.measured % 12) + 12) % 12 !== ((x.keycenter % 12) + 12) % 12).slice(0, 8)) {
        console.log(`    不符：keycenter ${c.keycenter}（${noteName(c.keycenter)}）量到 ${c.hz.toFixed(1)} Hz（${noteName(c.measured)}，${c.cents.toFixed(0)} 音分）  ${c.file}`);
      }
    }
    for (const c of checks) {
      const g2 = gainByLayer[c.layer];
      for (let i = 0; i < c.pcm.length; i++) c.pcm[i] *= g2;
      const dest = join(outDir, `${c.keycenter}-v${c.layer + 1}.mp3`);
      if (exists(dest) && !FORCE) reused++;
      else { encode(c.pcm, dest, { cache: CACHE }); made++; }
      (notes[c.keycenter] ||= []).push({ vel: +(c.layer / LAYERS).toFixed(2), file: `${c.keycenter}-v${c.layer + 1}.mp3` });
    }
    const midis = Object.keys(notes).map(Number).sort((a, b) => a - b);
    const gaps = midis.slice(1).map((m, i) => m - midis[i]);
    for (const m of midis) notes[m].sort((a, b) => a.vel - b.vel);
    const body = midis.map((m) => `    ${m}: [${notes[m].map((l) => `{ vel: ${l.vel}, file: '${l.file}' }`).join(', ')}],`).join('\n');
    library[g.key] = `  '${g.key}': {
    label: '${g.label}',
    credit: '${SOURCES[g.src].credit}',
    synth: '${g.synth}',
    base: '${g.dir}/',
    gap: ${Math.max(...gaps)},
    layers: ${LAYERS},
    notes: {
${body}
    },
  },`;
    const removed = cleanOrphans(outDir, new Set(Object.values(notes).flat().map((l) => l.file)));
    if (removed) console.log(`  刪掉 ${removed} 個不被資料表引用的孤兒檔`);
    console.log(`  音域 ${noteName(midis[0])}–${noteName(midis[midis.length - 1])}、最大缺口 ${Math.max(...gaps)} 個半音`);
  }

  writeFile(join(ROOT, 'src', 'guitar-library.js'), `// 木吉他與電吉他的取樣表（產生的，不是手寫的）：音號 → 力度層 → 檔名。
//
// 來源：
//   ${[...new Set(ALL_GUITARS.map((g) => SOURCES[g.src].credit))].join('\n//   ')}
// 對應表（SFZ）與量測結果見 tools/build-guitar.mjs。
// 每一層正規化到同一個基準：**層負責音色、力度負責音量**（跟 samples/velocity/ 同一個規則）。
// 檔案在 repo 裡，跟鼓組、卡林巴、長笛、弦樂群一樣進 service worker 預快取。
export const GUITAR_INSTRUMENTS = {
${Object.values(library).join('\n')}
};
`);
  console.log(`\n${made} 個轉檔、${reused} 個沿用；資料表寫入 src/guitar-library.js`);
}

main();

// 樣本換了就要換媒體快取的名字（否則使用者會一直拿到舊音檔）；見 tools/bump-media.mjs。
await import('./bump-media.mjs');
