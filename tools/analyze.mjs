// 音訊分析工具：把「聽起來怎樣」拆成可以量的數字。
//
//   node tools/analyze.mjs <檔案...>             # 每個檔一行摘要
//   node tools/analyze.mjs --bands <檔案...>     # 加上八度帶能量表
//   node tools/analyze.mjs --json <檔案...>      # 給程式讀
//   node tools/analyze.mjs --compare A B [...]   # 兩兩比對（對齊後的相關性與頻帶差）
//   node tools/analyze.mjs --notes A             # 找出起音、逐音量基頻與衰減
//
// 為什麼要有這支：這個專案裡每一句「這個聽起來比較真／比較假」最後都應該能追到一個
// 數字。實際上量到過的東西——開頭 24–50 ms 的數位空白、鋼琴比其他樂器小 6.2 dB、
// 立體聲只取左聲道少 19% 能量、96 kbps 對鋼琴其實沒有損失、同一個音重複時相關性
// 1.000000（＝同一個檔）——都是先有數字才敢改的。需要 ffmpeg 解碼（mp3/flac/wav 都行）。
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const RATE = 44100;
const sh = (cmd, args) => execFileSync(cmd, args, { maxBuffer: 1 << 29 });

/** 解碼成單聲道或立體聲的 Float32Array（交錯）。 */
function decode(file, channels = 1, rate = RATE) {
  const buf = sh('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', String(channels), '-ar', String(rate), '-']);
  const copy = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(copy, 0, Math.floor(copy.byteLength / 4));
}

function probe(file) {
  const out = sh('ffprobe', ['-v', 'error', '-show_entries',
    'format=duration,bit_rate:stream=codec_name,sample_rate,channels,bits_per_raw_sample',
    '-of', 'default=nw=1', file]).toString().trim().split('\n')
    .map((l) => l.split('=')).reduce((o, [k, v]) => (o[k] = v, o), {});
  return {
    codec: out.codec_name, rate: +out.sample_rate, channels: +out.channels,
    bits: +out.bits_per_raw_sample || 16, seconds: +(+out.duration).toFixed(3),
    kbps: out.bit_rate ? Math.round(+out.bit_rate / 1000) : null,
  };
}

const db = (x) => 20 * Math.log10(Math.max(x, 1e-12));
const rms = (x, from = 0, len = x.length - from) => {
  let s = 0;
  for (let i = 0; i < len; i++) s += x[from + i] ** 2;
  return Math.sqrt(s / Math.max(1, len));
};
const peakOf = (x) => { let p = 0; for (const v of x) p = Math.max(p, Math.abs(v)); return p; };

/** radix-2 FFT（實數輸入，虛部給 0）。 */
function fft(re, im) {
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

/** 平均頻譜（Hann 窗，取最有能量的幾段平均，避免只看到開頭或尾巴）。 */
function averageSpectrum(x, rate, segments = 6, N = 8192) {
  const hop = Math.max(N, Math.floor((x.length - N) / segments));
  const acc = new Float64Array(N / 2);
  let used = 0;
  for (let s = 0; s + N <= x.length; s += hop) {
    let e = 0;
    for (let i = 0; i < N; i++) e += x[s + i] ** 2;
    if (e < 1e-9) continue;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    fft(re, im);
    for (let i = 0; i < N / 2; i++) acc[i] += Math.hypot(re[i], im[i]);
    used++;
  }
  if (!used) return { mag: acc, binHz: rate / N, used: 0 };
  for (let i = 0; i < acc.length; i++) acc[i] /= used;
  return { mag: acc, binHz: rate / N, used };
}

function spectralStats(mag, binHz) {
  let total = 0, centroidNum = 0;
  const bands = [];
  for (let i = 1; i < mag.length; i++) {
    const f = i * binHz, p = mag[i] ** 2;
    total += p; centroidNum += f * p;
  }
  let acc = 0, rolloff = 0;
  for (let i = 1; i < mag.length; i++) {
    acc += mag[i] ** 2;
    if (!rolloff && acc >= total * 0.95) rolloff = i * binHz;
  }
  for (const [lo, hi] of [[0, 125], [125, 250], [250, 500], [500, 1000], [1000, 2000], [2000, 4000], [4000, 8000], [8000, 16000], [16000, 22050]]) {
    let e = 0;
    for (let i = Math.ceil(lo / binHz); i < Math.min(mag.length, Math.floor(hi / binHz)); i++) e += mag[i] ** 2;
    bands.push([`${lo}-${hi}`, 10 * Math.log10((e || 1e-15) / total)]);
  }
  return { centroid: centroidNum / total, rolloff, bands };
}

/** 起音位置（能量從 50 ms 窗突然上升）。 */
function onsets(x, rate, rise = 1.8, floor = 0.004) {
  const w = Math.round(0.05 * rate);
  const env = [];
  for (let s = 0; s + w <= x.length; s += w) env.push(rms(x, s, w));
  const out = [];
  for (let i = 1; i < env.length; i++) {
    if (env[i] > env[i - 1] * rise && env[i] > floor) out.push(i * 0.05);
  }
  return out;
}

/** 一個音的衰減：回到 −20 dB 要多久（用起音後的 20 ms 窗當基準）。 */
function decays(x, rate, positions, targetDb = -20) {
  const w = Math.round(0.02 * rate);
  const out = [];
  for (const at of positions) {
    const s0 = Math.round(at * rate);
    let ref = 0;
    for (let i = s0; i < Math.min(s0 + w, x.length); i++) ref += x[i] ** 2;
    ref = Math.sqrt(ref / w);
    if (ref <= 0) continue;
    let hit = null;
    for (let s = s0 + w; s + w <= x.length; s += w) {
      if (rms(x, s, w) < ref * 10 ** (targetDb / 20)) { hit = (s - s0) / rate; break; }
    }
    if (hit !== null) out.push(hit);
  }
  out.sort((a, b) => a - b);
  return out.length ? out[Math.floor(out.length / 2)] : null;
}

/** 基頻：**諧波求和**（f、2f、3f、4f、5f 的強度相加取最大），不是找最強的峰。
 *  長笛有一堆 take 的基頻比第二泛音弱 7 dB，峰值法會回報高一個八度。 */
function notePitch(x, rate, from, len) {
  const mag = (f) => {
    let re = 0, im = 0;
    for (let i = 0; i < len; i++) {
      const t = i / rate;
      re += x[from + i] * Math.cos(2 * Math.PI * f * t);
      im += x[from + i] * Math.sin(2 * Math.PI * f * t);
    }
    return Math.hypot(re, im);
  };
  const score = (f) => { let s = 0; for (let k = 1; k <= 5; k++) s += mag(f * k) / k; return s; };
  let best = -1, bestF = 0;
  for (let f = 55; f <= 2400; f += 0.5) { const m = score(f); if (m > best) { best = m; bestF = f; } }
  return bestF;
}

function analyse(file, { bands = false, notes = false } = {}) {
  const info = probe(file);
  const mono = decode(file, 1);
  const r = {
    file, ...info,
    peak: peakOf(mono), rms: rms(mono),
    dc: mono.reduce((s, v) => s + v, 0) / mono.length,
  };
  r.crestDb = db(r.peak / (r.rms || 1e-12));
  // 底噪：50 ms 窗 RMS 的第 5 百分位
  const w = Math.round(0.05 * RATE);
  const env = [];
  for (let s = 0; s + w <= mono.length; s += w) env.push(rms(mono, s, w));
  env.sort((a, b) => a - b);
  r.floorDb = db(env.length ? env[Math.floor(env.length * 0.05)] : 0);
  const { mag, binHz, used } = averageSpectrum(mono, RATE);
  if (used) {
    const st = spectralStats(mag, binHz);
    r.centroid = Math.round(st.centroid);
    r.rolloff95 = Math.round(st.rolloff);
    if (bands) r.bands = st.bands.map(([k, v]) => `${k}:${v.toFixed(0)}`);
  }
  r.onsets = onsets(mono, RATE).length;
  r.decay20 = decays(mono, RATE, onsets(mono, RATE));
  if (info.channels === 2) {
    const st = decode(file, 2);
    const n = st.length / 2;
    let sm = 0, ss = 0, sl = 0, sr = 0, slr = 0;
    for (let i = 0; i < n; i++) {
      const l = st[2 * i], rr = st[2 * i + 1];
      const m = (l + rr) / 2, s = (l - rr) / 2;
      sm += m * m; ss += s * s; sl += l * l; sr += rr * rr; slr += l * rr;
    }
    r.sideDb = 10 * Math.log10((ss || 1e-15) / (sm || 1e-15));
    r.lrCorr = slr / Math.sqrt((sl * sr) || 1e-15);
  }
  if (notes) {
    r.noteList = onsets(mono, RATE).slice(0, 12).map((t) => {
      const from = Math.round((t + 0.03) * RATE);
      const len = Math.min(Math.round(0.35 * RATE), mono.length - from);
      if (len < 2048) return null;
      const hz = notePitch(mono, RATE, from, len);
      return { at: +t.toFixed(2), hz: +hz.toFixed(1) };
    }).filter(Boolean);
  }
  return r;
}

/** 兩兩比對：先用互相關對齊（±60 ms），再報相關性與頻帶差。
 *  對齊的窗取 **A 的中段**（不是開頭）：開頭常常是前奏或單一樂器，拿它估時間差會
 *  偏掉，整首的相關性也會被那一段主導。相關性與差值能量則算「整段重疊」，
 *  每 7 個取樣抽一個（4 分鐘的檔也不會慢）。 */
function compare(aFile, bFile) {
  const a = decode(aFile, 1), b = decode(bFile, 1);
  const probeFrom = Math.floor(a.length / 2);
  const probeLen = Math.min(44100, a.length - probeFrom);
  let bestLag = 0, best = -Infinity;
  for (let lag = -2646; lag <= 2646; lag += 2) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < probeLen; i += 5) {
      const j = probeFrom + i + lag;
      if (j < 0 || j >= b.length) continue;
      const x = a[probeFrom + i], y = b[j];
      dot += x * y; na += x * x; nb += y * y;
    }
    const c = dot / Math.sqrt((na * nb) || 1e-12);
    if (c > best) { best = c; bestLag = lag; }
  }
  const from = Math.max(0, -bestLag), fromB = Math.max(0, bestLag);
  const len = Math.min(a.length - from, b.length - fromB);
  let sa = 0, sb = 0, sd = 0, dab = 0;
  for (let i = 0; i < len; i += 7) {
    const x = a[from + i], y = b[fromB + i];
    sa += x * x; sb += y * y; sd += (x - y) ** 2; dab += x * y;
  }
  return {
    a: aFile, b: bFile, lag: bestLag,
    corr: +(dab / Math.sqrt((sa * sb) || 1e-15)).toFixed(4),
    rmsA: +Math.sqrt(sa / len).toFixed(5), rmsB: +Math.sqrt(sb / len).toFixed(5),
    residualDb: +(10 * Math.log10((sd / len) / (sa / len || 1e-15))).toFixed(1),
    levelDb: +(10 * Math.log10((sb || 1e-15) / (sa || 1e-15))).toFixed(1),
  };
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.log('用法：node tools/analyze.mjs [--bands] [--json] [--notes] [--compare] <檔案...>');
  process.exit(1);
}
for (const f of files) if (!existsSync(f)) { console.error(`找不到檔案：${f}`); process.exit(1); }

if (flags.has('--compare')) {
  const rows = [];
  for (let i = 0; i + 1 < files.length; i += 2) rows.push(compare(files[i], files[i + 1]));
  if (flags.has('--json')) console.log(JSON.stringify(rows, null, 1));
  else for (const r of rows) {
    console.log(`${r.a}\n  vs ${r.b}\n  對齊 lag ${r.lag} 樣本 · 相關性 ${r.corr} · rms ${r.rmsA} / ${r.rmsB}（${r.levelDb >= 0 ? '+' : ''}${r.levelDb} dB）· 差值能量 ${r.residualDb} dB（越低越像同一段錄音）`);
  }
} else {
  const rows = files.map((f) => analyse(f, { bands: flags.has('--bands'), notes: flags.has('--notes') }));
  if (flags.has('--json')) { console.log(JSON.stringify(rows, null, 1)); process.exit(0); }
  console.log('檔案'.padEnd(34) + ' 長度   聲道 格式      峰值   rms    crest  底噪   重心Hz  rolloff  立體side  起音  衰減-20dB');
  for (const r of rows) {
    const name = r.file.replace(/^.*\//, '').slice(0, 33).padEnd(34);
    console.log(`${name} ${String(r.seconds).padStart(6)}s ${String(r.channels).padStart(3)}  ${(r.codec + (r.kbps ? '@' + r.kbps : '')).padEnd(9)}`
      + ` ${r.peak.toFixed(3)} ${r.rms.toFixed(4)} ${r.crestDb.toFixed(1).padStart(5)} ${r.floorDb.toFixed(1).padStart(6)}`
      + ` ${String(r.centroid ?? '-').padStart(7)} ${String(r.rolloff95 ?? '-').padStart(7)}`
      + ` ${(r.channels === 2 ? r.sideDb.toFixed(1) + 'dB' : '單聲道').padStart(9)}`
      + ` ${String(r.onsets).padStart(4)} ${(r.decay20 === null ? '-' : r.decay20.toFixed(2) + 's').padStart(9)}`);
    if (r.bands) console.log('    ' + r.bands.join('  '));
    if (r.noteList) console.log('    起音與基頻：' + r.noteList.map((n) => `${n.at}s=${n.hz}Hz`).join(' '));
  }
}
