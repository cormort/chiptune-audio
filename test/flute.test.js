import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import {
  FLUTE_INSTRUMENT, SAMPLE_LIBRARY, SAMPLE_RATE, SampledInstruments,
  sampleUrls, sampleVoice, parseMidi, renderMidi,
} from '../src/index.js';
import { track, smf, tempo } from './smf.js';

const DIR = new URL('../samples/flute/', import.meta.url);
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const corr = (a, b) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / Math.sqrt((na * nb) || 1e-15);
};

// 這一組釘住三件事：內建長笛的音域與 take 數、資料表 ↔ 磁碟 ↔ 預快取一致、
// 以及「同一個音重複時不會是同一段波形」——那是取樣最明顯的破綻。
test('the flute is bundled with two takes per pitch, and every file is accounted for', () => {
  const onDisk = new Set(readdirSync(DIR).filter((f) => f.endsWith('.mp3')));
  const urls = sampleUrls(FLUTE_INSTRUMENT);
  const pitches = [...new Set(urls.map((u) => u.midi))].sort((a, b) => a - b);
  assert.deepEqual(pitches, [60, 64, 69, 72, 76, 81, 84, 88, 93, 96], 'the recorded range must be C4–C7');
  assert.equal(FLUTE_INSTRUMENT.gap, 5);
  assert.equal(FLUTE_INSTRUMENT.takes, 2);
  const referenced = new Set();
  for (const u of urls) {
    const file = u.url.slice(FLUTE_INSTRUMENT.base.length);
    assert.ok(onDisk.has(file), `samples/flute/${file} does not exist (rerun tools/build-flute.mjs)`);
    referenced.add(file);
    assert.equal(typeof u.take, 'number', 'a take whose index is unknown cannot be rotated');
  }
  for (const f of onDisk) assert.ok(referenced.has(f), `samples/flute/${f} is not referenced by the data`);
  const twoTake = pitches.filter((p) => urls.filter((u) => u.midi === p).length === 2).length;
  assert.ok(twoTake >= 8, `only ${twoTake} pitches have two takes to rotate`);

  // 覆蓋掉遠端那個（同音域、每個音一個 take）
  assert.equal(SAMPLE_LIBRARY.flute, FLUTE_INSTRUMENT, 'the bundled flute must override the remote one');
  assert.equal(FLUTE_INSTRUMENT.synth, 'real:flute', 'and still carry a synth fallback');

  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const listed = new Set([...sw.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  for (const f of onDisk) assert.ok(listed.has(`samples/flute/${f}`), `samples/flute/${f} is not precached`);
  for (const path of listed) {
    if (!path.startsWith('samples/flute/')) continue;
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `${path} is precached but missing`);
  }
  assert.ok(listed.has('src/flute-library.js'), 'the generated table is not precached');
});

test('takes rotate: the same pitch is not the same waveform twice', () => {
  const a = Float32Array.from([1, 0, -1, 0]);
  const b = Float32Array.from([0, 1, 0, -1]);
  const notes = [{ midi: 69, layers: [], takes: [a, b], rate: SAMPLE_RATE }];
  assert.equal(sampleVoice(notes, 69, 1, 0).take, a);
  assert.equal(sampleVoice(notes, 69, 1, 1).take, b);
  assert.equal(sampleVoice(notes, 69, 1, 2).take, a, 'it wraps around');
  assert.equal(sampleVoice(notes, 69, 1, -1).take, b, 'a negative counter still lands in range');
  assert.equal(sampleVoice(notes, 69, 1, 1).pcm, b, 'the chosen take is what gets mixed');
  assert.equal(sampleVoice([{ midi: 69, layers: [{ vel: 0, pcm: a }] }], 69, 1, 3).take, null, 'no takes, no rotation');
});

test('renderMidi rotates takes, so repeated notes stop being identical', () => {
  // 同一個音高連續出現（真實的旋律就是這樣：〈給愛麗絲〉開頭 E5 三次）
  const a = new Float32Array(2000);
  const b = new Float32Array(2000);
  for (let i = 0; i < 2000; i++) { a[i] = Math.sin((2 * Math.PI * 440 * i) / 44100); b[i] = Math.cos((2 * Math.PI * 440 * i) / 44100) * 0.8; }
  const voices = { 'sampled:flute': { rate: SAMPLE_RATE, notes: [{ midi: 69, layers: [], takes: [a, b], rate: SAMPLE_RATE }] } };
  const one = renderMidi(parseMidi(smf(1, 480, [
    track([[0, ...tempo(500000)]]),
    track([[0, 0x90, 69, 100], [480, 0x80, 69, 0]]),
  ])), { tracks: [{ instrument: 'sampled:flute' }], samples: voices });
  // 兩次同樣的呼叫要產生同樣的結果（引擎是決定性的：輪替從 0 開始）
  const again = renderMidi(parseMidi(smf(1, 480, [
    track([[0, ...tempo(500000)]]),
    track([[0, 0x90, 69, 100], [480, 0x80, 69, 0]]),
  ])), { tracks: [{ instrument: 'sampled:flute' }], samples: voices });
  assert.equal(corr(one, again).toFixed(6), '1.000000', 'the renderer must stay deterministic');
  assert.ok(peak(one) > 0.05);

  // 兩個 take 完全不同：輪替之後，第一顆與第二顆的相關性必須明顯低於 1
  const twoNotes = renderMidi(parseMidi(smf(1, 480, [
    track([[0, ...tempo(500000)]]),
    track([[0, 0x90, 69, 100], [240, 0x80, 69, 0], [240, 0x90, 69, 100], [480, 0x80, 69, 0]]),
  ])), { tracks: [{ instrument: 'sampled:flute' }], samples: voices });
  const win = Math.round(0.25 * SAMPLE_RATE);
  const seg = (from) => twoNotes.subarray(from, from + win);
  assert.ok(corr(seg(0), seg(Math.round(0.25 * SAMPLE_RATE))) < 0.9, 'the second note must be a different take');
  // 沒有 takes 的樂器行為不變
  const mono = { 'sampled:flute': { rate: SAMPLE_RATE, notes: [{ midi: 69, layers: [{ vel: 0, pcm: a }], rate: SAMPLE_RATE }] } };
  const plain = renderMidi(parseMidi(smf(1, 480, [
    track([[0, ...tempo(500000)]]),
    track([[0, 0x90, 69, 100], [480, 0x80, 69, 0]]),
  ])), { tracks: [{ instrument: 'sampled:flute' }], samples: mono });
  assert.ok(peak(plain) > 0.05);
});

test('SampledInstruments loads both takes per pitch and rotates them per note', async () => {
  const sampled = new SampledInstruments(null);
  const asked = [];
  const fake = (len = 4000, rate = 48000, seed = 0) => {
    const data = new Float32Array(len);
    for (let i = 0; i < len; i++) data[i] = Math.sin((i + seed) / 7) * 0.5;
    return { length: len, sampleRate: rate, getChannelData: () => data };
  };
  let n = 0;
  const hit = await sampled.load('flute', {
    fetchImpl: async (url) => { asked.push(url); return { ok: true, arrayBuffer: async () => new ArrayBuffer(16) }; },
    decode: async () => fake(4000, 48000, n++),
  });
  assert.equal(asked.length, 19, 'every take of every pitch');
  assert.equal(hit.failed, 0);
  assert.equal(sampled.wanted('flute'), 19);
  assert.equal(sampled.loaded('flute'), 19);
  const withTakes = hit.notes.filter((x) => Array.isArray(x.takes) && x.takes.length === 2);
  assert.ok(withTakes.length >= 8, `only ${withTakes.length} pitches loaded two takes`);
  // 重抓時不該再抓（takes 也算「已經有了」）
  const before = asked.length;
  await sampled.load('flute', { fetchImpl: async (u) => { asked.push(u); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; }, decode: async () => fake() });
  assert.equal(asked.length, before, 'a loaded instrument must not be fetched again');
  // pcm() 要把 takes 交給離線算圖
  const pcm = sampled.pcm('flute');
  assert.ok(pcm.notes.some((x) => Array.isArray(x.takes) && x.takes.length === 2), 'pcm() must expose takes');
});
