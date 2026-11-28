import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import {
  prepareSample, normalizeInstrument, pickLayer, layerMix,
  DYNAMIC_INSTRUMENTS,
  SAMPLE_LIBRARY, SAMPLE_CREDIT, SAMPLE_PREFIX, SampledInstruments,
  sampleName, sampleNames, sampleLabel, sampleSynth, sampleUrls,
  nearestSample, sampleVoice, prepareSampleChannels, mixSampleInto,
  parseMidi, renderMidi, resolveInstrument, SAMPLE_RATE,
} from '../src/index.js';
import { track, smf, tempo } from './smf.js';

const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const sane = (a) => a.every((x) => Number.isFinite(x) && Math.abs(x) <= 1);

test('the sample library is complete and points at real-looking files', () => {
  const names = sampleNames();
  assert.ok(names.length >= 15, `only ${names.length} sampled instruments`);
  assert.equal(names[0], 'grand', 'the piano is the one that has to be first');
  assert.ok(SAMPLE_CREDIT.includes('CC-BY'), 'the samples are CC-BY: the credit must say so');
  for (const name of names) {
    const inst = SAMPLE_LIBRARY[name];
    const where = `sample:${name}`;
    assert.ok(inst.label, `${where} has no label`);
    assert.ok(inst.credit, `${where} has no credit`);
    assert.match(inst.base, /^(https:\/\/.+|[a-z0-9_./-]+)\/$/i, `${where} base URL looks wrong`);
    assert.equal(sampleLabel(name), inst.label);
    // 樣本還沒到時播的合成代理音必須真的存在，否則「按鍵不會沒聲音」就是空話。
    assert.ok(resolveInstrument(inst.synth), `${where} synth ${inst.synth} does not resolve`);
    const urls = sampleUrls(name);
    assert.ok(urls.length >= 6, `${where} has only ${urls.length} samples`);
    const midis = [...new Set(urls.map((u) => u.midi))];
    assert.deepEqual(midis, [...midis].sort((a, b) => a - b), `${where} notes are not sorted`);
    for (const { midi, vel, url } of urls) {
      assert.ok(midi >= 0 && midi <= 127, `${where} has an impossible note ${midi}`);
      assert.match(url, /\.mp3$/, `${where} ${url} is not an mp3`);
      // 延音樣本在自己的 base 底下；釋音在另一個資料夾（inst.release.base）
      const under = inst.release && url.startsWith(inst.release.base) ? inst.release.base : inst.base;
      assert.ok(url.startsWith(under), `${where} ${url} is not under ${under}`);
      if (vel !== undefined) assert.ok(vel >= 0 && vel < 1, `${where} layer vel ${vel} out of range`);
    }
    // 有力度層的樂器：每個音至少兩層、由弱到強、同一層不會重複
    if (inst.layers) {
      assert.ok(inst.layers >= 2, `${where} claims layers but has ${inst.layers}`);
      for (const [midi, entry] of Object.entries(inst.notes)) {
        assert.ok(Array.isArray(entry), `${where} note ${midi} is not a layer list`);
        assert.ok(entry.length >= 2, `${where} note ${midi} has only ${entry.length} layer(s)`);
        assert.equal(entry[0].vel, 0, `${where} note ${midi} has no softest layer`);
        const vels = entry.map((l) => l.vel);
        assert.deepEqual(vels, [...vels].sort((a, b) => a - b), `${where} note ${midi} layers are out of order`);
      }
    }
    // gap 是「相鄰樣本差幾個半音」，也就是中間的音要用播放速率拉多少。UI 拿它提醒
    // 使用者，所以數字必須跟資料一致——不一致就等於騙人。
    const gaps = midis.slice(1).map((m, i) => m - midis[i]);
    assert.equal(inst.gap, Math.max(...gaps), `${where} gap says ${inst.gap}, its notes say ${Math.max(...gaps)}`);
    assert.ok(inst.gap <= 14, `${where} has a ${inst.gap}-semitone hole in its recordings`);
    assert.equal(sampleName(name), `${SAMPLE_PREFIX}${name}`);
    assert.equal(sampleSynth(name), inst.synth);
    assert.equal(sampleSynth('kazoo'), null);
  }
  assert.deepEqual(sampleUrls('kazoo'), []);
});

test('prepareSample keeps the louder channel, and prepareSampleChannels keeps both', () => {
  // 立體聲**不能取平均**。Salamander 鋼琴的兩個聲道是兩支不同視角的麥克風
  //（各頻帶相位差 +28°～−137°、lag-0 相關 −0.29～−0.79），相加會抵消約 5 dB 而且
  // 每個音被不同地重塑（量到的數字見 tools/analyze.mjs 與 AGENTS.md），所以單聲道
  // 播放用**能量較大的那個聲道**；要立體就兩個都留著。
  const stereo = {
    length: 4, sampleRate: 44100, numberOfChannels: 2,
    getChannelData: (c) => (c === 0 ? Float32Array.from([0.5, 0.5, 0.5, 0.5]) : Float32Array.from([0.1, 0.1, 0.1, 0.1])),
  };
  assert.deepEqual([...prepareSample(stereo)].map((v) => +v.toFixed(3)), [0.5, 0.5, 0.5, 0.5], 'the louder channel, not the average');
  const both = prepareSampleChannels(stereo);
  assert.deepEqual([...both.mono], [0.5, 0.5, 0.5, 0.5]);
  assert.deepEqual([...both.left].map((v) => +v.toFixed(3)), [0.5, 0.5, 0.5, 0.5]);
  assert.deepEqual([...both.right].map((v) => +v.toFixed(3)), [0.1, 0.1, 0.1, 0.1]);
  // 單聲道來源沒有左右，mono 就是它自己
  const mono = { length: 3, sampleRate: 44100, numberOfChannels: 1, getChannelData: () => Float32Array.from([0.2, 0.2, 0.2]) };
  const one = prepareSampleChannels(mono);
  assert.equal(one.left, null);
  assert.equal(one.right, null);
  assert.deepEqual([...one.mono].map((v) => +v.toFixed(3)), [0.2, 0.2, 0.2]);

  // 開頭靜音：切到第一個超過峰值 1% 的樣本，前面留 2 ms 前導
  const rate = 1000;                     // 每秒 1000 個樣本 → 2 ms = 2 個樣本
  const data = new Float32Array(20);
  data[10] = 1;                          // 第 10 個樣本才是起音
  const silentLead = { length: 20, sampleRate: rate, numberOfChannels: 1, getChannelData: () => data };
  const cut = prepareSample(silentLead);
  assert.equal(cut.length, 12, 'it should start 8 samples in (10 - 2 ms of preroll)');
  assert.equal(cut[0], 0, 'the preroll is kept');
  assert.equal(cut[2], 1, 'the attack is sample 0 of the preroll');

  // 沒有靜音就不動；全靜音不要回空陣列（呼叫端還要用長度）
  const loud = { length: 8, sampleRate: 44100, numberOfChannels: 1, getChannelData: () => Float32Array.from([1, 1, 1, 1, 1, 1, 1, 1]) };
  assert.equal(prepareSample(loud).length, 8);
  const allQuiet = { length: 5, sampleRate: 44100, numberOfChannels: 1, getChannelData: () => new Float32Array(5) };
  assert.equal(prepareSample(allQuiet).length, 5);
  assert.equal(prepareSample({ length: 0, sampleRate: 44100, numberOfChannels: 1, getChannelData: () => new Float32Array(0) }).length, 0);

  // 慢起音的樂器（長笛前 30 ms 是吹氣的漸強）不能被切掉：1% 的門檻切在起音之前
  const slow = new Float32Array(4000);
  for (let i = 500; i < 4000; i++) slow[i] = Math.min(1, (i - 500) / 2000);
  const flute = prepareSample({ length: 4000, sampleRate: 44100, numberOfChannels: 1, getChannelData: () => slow });
  assert.equal(flute[0], 0, 'the ramp still starts at zero');
  assert.ok(flute.length > 3400, 'a slow attack must keep its ramp');
});

test('loading a sample stores the processed mono audio, not the raw decode', async () => {
  // 這裡驗證的是「載入時就處理好」：pcm 是單聲道且已切掉開頭，實際播放路徑才不會晚。
  const bank = new SampledInstruments(null);
  const len = 5000;
  const stereo = {
    length: len, sampleRate: 48000, numberOfChannels: 2,
    getChannelData: (c) => {
      const d = new Float32Array(len);
      for (let i = 900; i < len; i++) d[i] = c === 0 ? 0.4 : 0.2;   // 前 900 個樣本是靜音
      return d;
    },
  };
  const loaded = await bank.load('violin', {
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }),
    decode: async () => stereo,
  });
  const voice = bank.pcm('violin');
  assert.equal(voice.rate, 48000, 'the decoded rate is remembered for mixing');
  const layer = voice.notes[0].layers[0];
  const pcm = layer.pcm;
  assert.ok(pcm.length < len, 'the silent lead-in should be gone');
  // 900 個樣本的空白（18.75 ms）減掉 2 ms 前導 = 16.75 → 17 ms
  assert.equal(Math.round((len - pcm.length) / 48000 * 1000), 17, 'the silent lead-in, minus the 2 ms preroll');
  assert.ok(Math.abs(pcm[0]) < 1e-6, 'the preroll is silence');
  // 單聲道版本是**能量較大的聲道**（0.4），不是平均（0.3），再乘上樂器的基準音量倍率
  assert.ok(Math.abs(pcm.at(-1) - 0.4 * loaded.gain) < 1e-6, 'the louder channel, then levelled');
  // 立體的那一份也要留著（左右都切過、對齊、並且一起被 level 過）
  assert.ok(layer.left && layer.right, 'a stereo source must keep both channels');
  assert.equal(layer.left.length, pcm.length);
  assert.equal(layer.right.length, pcm.length);
  assert.ok(Math.abs(layer.left.at(-1) - 0.4 * loaded.gain) < 1e-6);
  assert.ok(Math.abs(layer.right.at(-1) - 0.2 * loaded.gain) < 1e-6, 'the right channel keeps its own level');
});

test('an instrument is levelled against the others, not left at its library level', () => {
  // 量到的差別：tonejs-instruments 那批峰值 0.706，Salamander 鋼琴只有 0.345（小 6.2 dB）。
  // 合奏時鋼琴會特別薄，所以整組拉到同一個基準——但只調樂器之間，不調樂器內部。
  const mk = (peak) => { const pcm = new Float32Array(8); pcm[0] = peak; return pcm; };
  const piano = [0.27, 0.37, 0.34, 0.34].map((p) => ({ midi: 60, pcm: mk(p) }));
  const gain = normalizeInstrument(piano);
  assert.ok(Math.abs(gain - 0.7 / 0.34) < 0.02, `piano should be lifted ~2x, got ${gain}`);
  assert.ok(Math.abs(piano[0].pcm[0] - 0.27 * gain) < 1e-6, 'every sample is scaled by the same factor');
  assert.ok(piano[1].pcm[0] > piano[0].pcm[0], 'the loud sample inside the instrument stays the loud one');

  const vsco = [0.70, 0.71, 0.70].map((p) => ({ midi: 60, pcm: mk(p) }));
  assert.equal(normalizeInstrument(vsco), 1, 'an instrument already at the reference is left alone');

  // 上下限：爛檔案不會被放大到破音，也不會被壓成沒聲音
  assert.ok(normalizeInstrument([{ midi: 60, pcm: mk(0.001) }]) <= 8);
  assert.ok(normalizeInstrument([{ midi: 60, pcm: mk(1) }]) >= 0.25);
  assert.equal(normalizeInstrument([]), 1);
  assert.equal(normalizeInstrument([{ midi: 60, pcm: new Float32Array(4) }]), 1, 'a silent instrument is left alone');
});

test('a note picks the nearest recording and the playback rate to reach it', () => {
  const notes = [{ midi: 60 }, { midi: 64 }];
  assert.deepEqual(nearestSample(notes, 60), { midi: 60 });
  assert.deepEqual(nearestSample(notes, 62), { midi: 60 }, 'a tie stays with the lower sample');
  assert.deepEqual(nearestSample(notes, 63), { midi: 64 });
  assert.equal(nearestSample([], 60), null);

  const v = sampleVoice(notes, 62);
  assert.equal(v.sample.midi, 60);
  assert.equal(v.semitones, 2);
  assert.ok(Math.abs(v.rate - 2 ** (2 / 12)) < 1e-12, `rate ${v.rate}`);
  assert.equal(sampleVoice([], 60), null);
});

test('mixSampleInto places, resamples and releases a recording as asked', () => {
  // 一個輸出樣本對一個樣本：位置與增益都要是精確的
  const out = new Float32Array(20);
  const pcm = Float32Array.from([1, 0.5, 0.25, 0.125]);
  const wrote = mixSampleInto(out, 3, pcm, 1, 0.5);
  assert.equal(wrote, 6, 'it should report where it stopped');
  assert.deepEqual([...out.slice(3, 6)], [0.5, 0.25, 0.125]);
  assert.equal(out[2], 0, 'nothing before the note');
  assert.equal(out[6], 0, 'nothing after the sample ran out');

  // ratio 2：樣本被快轉兩倍（音高上去一個八度），長度也砍半
  const fast = new Float32Array(20);
  mixSampleInto(fast, 0, Float32Array.from([1, 0, 1, 0, 1, 0, 1, 0]), 2, 1);
  assert.deepEqual([...fast.slice(0, 4)], [1, 1, 1, 1]);

  // 半速（低一個八度）：同樣的樣本拉長一倍
  const slow = new Float32Array(20);
  mixSampleInto(slow, 0, Float32Array.from([1, 1, 1, 1]), 0.5, 1);
  assert.deepEqual([...slow.slice(0, 7)], [1, 1, 1, 1, 1, 1, 0]);

  // note-off 之後淡出，然後停：hold 1 秒、淡 0.5 秒、44100 Hz
  const held = new Float32Array(SAMPLE_RATE * 2);
  const dc = new Float32Array(SAMPLE_RATE * 2).fill(1);
  const stop = mixSampleInto(held, 0, dc, 1, 1, { hold: 1, release: 0.5, rate: SAMPLE_RATE });
  assert.ok(Math.abs(held[SAMPLE_RATE - 10] - 1) < 1e-6, 'full level while held');
  assert.ok(Math.abs(held[SAMPLE_RATE + SAMPLE_RATE / 4] - 0.5) < 0.02, 'half way through the fade');
  assert.ok(stop <= SAMPLE_RATE * 1.5 + 1, `should stop at the end of the fade, stopped at ${stop}`);

  // 沒有 hold（Infinity）就一直放到樣本結束
  const ring = new Float32Array(10);
  mixSampleInto(ring, 0, Float32Array.from([1, 1, 1, 1]), 1, 1);
  assert.deepEqual([...ring.slice(0, 4)], [1, 1, 1, 0]);

  // 壞參數不該產生 NaN 或無限迴圈
  assert.equal(mixSampleInto(new Float32Array(4), 0, pcm, 0, 1), 0);
  assert.equal(mixSampleInto(new Float32Array(4), 0, pcm, 1, 0), 0);
  assert.equal(mixSampleInto(new Float32Array(4), 0, new Float32Array(1), 1, 1), 0);
  const late = new Float32Array(4);
  mixSampleInto(late, 10, pcm, 1, 1);      // 起點在緩衝區外
  assert.equal(peak(late), 0);

  // 負起點（at < 0）：應該從樣本的第 -at 個位置接續寫入 out[0]
  const neg = new Float32Array(4);
  mixSampleInto(neg, -1, pcm, 1, 1);
  assert.deepEqual([...neg.slice(0, 2)], [0.5, 0.25], 'negative offset advances into the sample');
});

test('renderMidi mixes recordings for a sampled track and still normalises', () => {
  const midi = parseMidi(smf(1, 480, [
    track([[0, ...tempo(500000)]]),
    track([[0, 0x90, 60, 100], [480, 0x80, 60, 0]]),
  ]));
  // 一個「錄音」：44100 Hz 的脈衝串，聽起來不重要，位置才重要
  const pcm = new Float32Array(SAMPLE_RATE);
  pcm[0] = 1;
  const samples = { 'sampled:violin': { rate: SAMPLE_RATE, notes: [{ midi: 60, pcm }] } };

  const out = renderMidi(midi, { tracks: [{ instrument: 'sampled:violin' }], samples });
  assert.ok(sane(out), 'sampled render must stay in range');
  assert.ok(peak(out) > 0.05, 'sampled render is silent');
  assert.equal(out[0] > 0.05, true, 'the note starts where the MIDI says');

  // 換成離它 12 個半音的樣本：播放速率加倍，同一個音就變成兩倍快（脈衝位置不變、
  // 但長度減半），這裡用兩個脈衝確認真的做了內插位移。
  const two = new Float32Array(SAMPLE_RATE * 2);
  two[0] = 1; two[100] = 1;
  const up = renderMidi(midi, {
    tracks: [{ instrument: 'sampled:violin' }],
    samples: { 'sampled:violin': { rate: SAMPLE_RATE, notes: [{ midi: 48, pcm: two }] } },
  });
  assert.equal(up[0] > 0.05, true);
  assert.equal(up[50] > 0.05, true, 'the second pulse should land at half the distance');

  // 取樣名稱不在 opts.samples 裡、也不是合成音色 → 明確報錯，不要靜靜地沒聲音
  assert.throws(() => renderMidi(midi, { tracks: [{ instrument: 'sampled:kazoo' }] }), /Unknown instrument/);
  // 靜音的取樣軌不該讓整首變成空的
  const muted = renderMidi(midi, { tracks: [{ instrument: 'sampled:violin', mute: true }], samples });
  assert.equal(peak(muted), 0);
  // 沒有 samples 時，取樣名稱仍然是錯的（不能悄悄退回合成）
  assert.throws(() => renderMidi(midi, { tracks: [{ instrument: 'sampled:violin' }] }), /Unknown instrument/);
});

/** 假的 AudioBuffer：只要 decode 之後拿得到長度、取樣率與單聲道資料就夠了。 */
const fakeBuffer = (len = 64, rate = 44100) => ({
  length: len,
  sampleRate: rate,
  getChannelData: () => new Float32Array(len).fill(0.25),
});

/** 這裡故意讓抓取失敗，預期的 console.warn 不用洗版。 */
const quietly = async (fn) => {
  const warn = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = warn; }
};

test('SampledInstruments loads once, survives a bad file, and reports progress', async () => {
  const bank = new SampledInstruments(null);
  // 用測試自己的小樂器，不要依賴真實資料表（真實的會隨來源更新，也會有力度層）
  const tiny = {
    name: 'test-one',
    base: 'https://example.test/samples/',
    notes: { 60: '60.mp3', 64: '64.mp3', 67: '67.mp3' },
  };
  const asked = [];
  const broken = 'https://example.test/samples/64.mp3';
  const fetchImpl = async (url) => {
    asked.push(url);
    if (url === broken) return { ok: false, status: 404 };
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(16) };
  };
  const decode = async () => fakeBuffer(128);
  const progress = [];
  const hit = await bank.load(tiny, {
    fetchImpl, decode, onProgress: (done, total) => progress.push([done, total]),
  });

  assert.equal(asked.length, 3, 'it should ask for exactly the listed files');
  assert.equal(hit.notes.length, 2, 'the 404 file is skipped, the rest still work');
  assert.equal(hit.failed, 1);
  assert.equal(progress.length, 3, 'progress fires for every file, failures included');
  assert.deepEqual(progress.at(-1), [3, 3]);
  assert.equal(bank.loaded('test-one'), 2);
  assert.equal(bank.wanted(tiny), 3);
  assert.equal(bank.loaded('nope'), 0);

  // 只抓到一半時，下一次只補缺的那一個（不重抓已經抓到的樣本）
  const before = asked.length;
  await bank.load(tiny, { fetchImpl, decode });
  assert.equal(asked.length, before + 1, 'only the missing file is retried');
  assert.equal(asked.at(-1), broken);
  assert.equal(bank.loaded('test-one'), 2);

  // 整個樂器都抓完就不再多問一次
  const complete = new SampledInstruments(null);
  const calls = [];
  const okFetch = async (url) => { calls.push(url); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
  await complete.load(tiny, { fetchImpl: okFetch, decode });
  const first = calls.length;
  await complete.load(tiny, { fetchImpl: okFetch, decode });
  assert.equal(calls.length, first, 'a fully loaded instrument must not be fetched again');
  assert.equal(complete.loading('test-one'), false);

  // 挑音：最近的樣本，超出音域也用最近的（低音往最近的樣本拉）
  const notes = [...bank.instruments.get('test-one').notes];
  assert.equal(bank.findBest('test-one', notes[1].midi).midi, notes[1].midi);
  assert.equal(bank.findBest('test-one', notes[1].midi + 1).midi, notes[1].midi);
  assert.equal(bank.findBest('nope', 60), null);

  // 給 renderMidi 用的樣子：單層樂器也會包成一層，播放端只有一條路
  const voices = bank.voices(['test-one']);
  assert.deepEqual(Object.keys(voices), ['sampled:test-one']);
  assert.equal(voices['sampled:test-one'].rate, 44100);
  assert.equal(voices['sampled:test-one'].notes.length, 2);
  assert.equal(voices['sampled:test-one'].notes[0].layers.length, 1);
  assert.equal(voices['sampled:test-one'].notes[0].layers[0].pcm.length, 128);

  // 沒有 AudioContext 就沒有聲音可播，但也不能丟例外
  assert.equal(bank.playNote('test-one', 60), null);
});

test('velocity picks the layer, and the layer carries its own audio', () => {
  const notes = [{ midi: 60, layers: [
    { vel: 0, pcm: Float32Array.from([0.1]) },
    { vel: 0.5, pcm: Float32Array.from([0.9]) },
  ] }];
  const near = (got, want, what) => assert.ok(Math.abs(got - want) < 1e-6, `${what}: ${got} !== ${want}`);
  near(sampleVoice(notes, 60, 0.1).pcm[0], 0.1, 'a soft note uses the soft layer');
  // pickLayer 是「不超過這個力度的最大層」：交界上挑上面那層
  near(pickLayer(notes[0], 0.5).pcm[0], 0.9, 'the boundary belongs to the louder layer');
  // sampleVoice 多了 mix（交界附近兩層），單一 pcm 欄位取 mix 的第一項
  near(sampleVoice(notes, 60, 0.5).mix[0].pcm[0], 0.1, 'at the boundary the mix starts with the soft layer');
  near(sampleVoice(notes, 60, 1).pcm[0], 0.9);
  near(sampleVoice(notes, 60).pcm[0], 0.9, 'no velocity means full velocity');
  assert.equal(sampleVoice(notes, 60, 0.2).mix.length, 1, 'away from a boundary only one layer plays');
  // 單層（沒有 layers）還是它自己
  const single = [{ midi: 60, pcm: Float32Array.from([0.4]) }];
  near(sampleVoice(single, 60, 0.2).pcm[0], 0.4);
  near(pickLayer({ pcm: Float32Array.from([1]) }, 0.3).pcm[0], 1);
  // 音高照樣挑最近的，但層要照力度
  const two = [
    { midi: 60, layers: [{ vel: 0, pcm: Float32Array.from([1]) }, { vel: 0.5, pcm: Float32Array.from([2]) }] },
    { midi: 64, layers: [{ vel: 0, pcm: Float32Array.from([3]) }, { vel: 0.5, pcm: Float32Array.from([4]) }] },
  ];
  near(sampleVoice(two, 63, 0.9).pcm[0], 4, 'nearest pitch first, then the layer');
  near(sampleVoice(two, 63, 0.1).pcm[0], 3);
  assert.equal(sampleVoice([], 60, 1), null);
});

test('the sympathetic-string impulse rings at string pitches, decorrelated left/right', async () => {
  const { resonanceImpulse } = await import('../src/samples.js');
  const [L, R] = resonanceImpulse(44100, 3);
  assert.equal(L.length, 132300);
  assert.ok(L.every(Number.isFinite) && R.every(Number.isFinite));
  const at = (x, f) => {
    const c = 2 * Math.cos((2 * Math.PI * f) / 44100);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < 44100; i++) { const s = x[i] + c * s1 - s2; s2 = s1; s1 = s; }
    return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2);
  };
  // A2 是一條弦；差四分之一音的地方沒有弦，要弱很多
  assert.ok(at(L, 110) > 10 * at(L, 110 * 2 ** (0.5 / 12)), 'resonance must sit on the strings');
  let lr = 0, ll = 0, rr = 0;
  for (let i = 0; i < L.length; i++) { lr += L[i] * R[i]; ll += L[i] * L[i]; rr += R[i] * R[i]; }
  assert.ok(Math.abs(lr / Math.sqrt(ll * rr)) < 0.3, 'left and right must not be the same signal');
});

test('without the pedal, only held keys resonate, never with their own note', async () => {
  const { renderResonance } = await import('../src/samples.js');
  const R = 44100;
  const tone = (f, from, to, len) => { const x = new Float32Array(len); for (let i = from * R; i < to * R; i++) x[i] = Math.sin((2 * Math.PI * f * i) / R) * 0.2; return x; };
  const energy = (o, a, b) => { let s = 0; for (let i = Math.floor(a * R); i < b * R; i++) s += o.left[i] ** 2 + o.right[i] ** 2; return s; };
  // A3（220 Hz）在 0.5–1.0 秒響；A2（110 Hz）的第 2 泛音正好是 220 Hz
  const a3 = tone(220, 0.5, 1, R * 3);
  const heldA2 = renderResonance(a3, [], R, { held: [{ note: 45, on: 0, off: 2 }] });
  const releasedA2 = renderResonance(a3, [], R, { held: [{ note: 45, on: 0, off: 0.4 }] });
  assert.ok(energy(heldA2, 0.5, 1.5) > 0, 'a held A2 must ring with an A3');
  assert.equal(energy(releasedA2, 0.5, 1.5), 0, 'a damped string must not');
  // 鍵放開（2 s）後制音器壓掉
  assert.ok(energy(heldA2, 2.3, 2.9) < 1e-6 * energy(heldA2, 1, 1.9), 'dampers stop it after the key is released');
  // 按住的那條弦就是被敲的弦：它自己的聲音不算共鳴
  const self = renderResonance(a3, [], R, { held: [{ note: 57, on: 0.5, off: 1, self: () => a3.subarray(0.5 * R) }] });
  assert.ok(energy(self, 0, 3) < 1e-9 * energy(heldA2, 0.5, 1.5), 'a string must not resonate with its own note');
  // 按住全部 88 鍵（不踩踏板）＝ 踩著踏板：兩條路是同一組弦
  const all = Array.from({ length: 88 }, (_, k) => ({ note: 21 + k, on: 0, off: 2 }));
  const modal = renderResonance(a3, [], R, { held: all });
  const conv = renderResonance(a3, [{ time: 0, down: true }, { time: 2, down: false }], R);
  let d = 0, s = 0;
  for (let i = 0.1 * R; i < 1.9 * R; i++) { d += (modal.left[i] - conv.left[i]) ** 2; s += conv.left[i] ** 2; }
  assert.ok(10 * Math.log10(d / s) < -40, `held-key modes must match the pedal convolution, off by ${(10 * Math.log10(d / s)).toFixed(1)} dB`);
});

test('the pedal fades the resonance in and damps it on release, building it only once', () => {
  const ramps = [];
  let convolvers = 0;
  const param = () => ({ value: 0, cancelScheduledValues() {}, setTargetAtTime(v, t, tc) { ramps.push([v, tc]); } });
  const node = () => ({ connect() {}, disconnect() {} });
  const ctx = {
    sampleRate: 8000, currentTime: 0, destination: node(),
    createBuffer: (ch, len) => { const d = [new Float32Array(len), new Float32Array(len)]; return { getChannelData: (i) => d[i] }; },
    createConvolver: () => { convolvers++; return node(); },
    createGain: () => ({ ...node(), gain: param() }),
  };
  const bank = new SampledInstruments(ctx);
  bank.setPedal(false);
  assert.equal(convolvers, 0, 'no convolver until the pedal is first pressed');
  bank.setPedal(true);
  bank.setPedal(false);
  bank.setPedal(true);
  assert.equal(convolvers, 1, 'the resonance is built once and reused');
  assert.ok(ramps[0][0] === 1 && ramps[1][0] === 0 && ramps[2][0] === 1, `down/up/down ramps, got ${JSON.stringify(ramps)}`);
});

test('eight closely spaced layers sweep without a gain jump', () => {
  // 8 層的鋼琴層距 0.125 比預設窗口 0.18 窄：窗口重疊時增益會在重疊區跳一下
  const piano = { midi: 60, layers: Array.from({ length: 8 }, (_, i) => ({ vel: i / 8, pcm: Float32Array.from([i]) })) };
  const level = (v) => { const g = new Float64Array(8); for (const x of layerMix(piano, v)) g[x.pcm[0]] = x.gain; return g; };
  let prev = level(0);
  for (let v = 0.001; v <= 1; v += 0.001) {
    const cur = level(v);
    for (let i = 0; i < 8; i++) assert.ok(Math.abs(cur[i] - prev[i]) < 0.05, `layer ${i} jumps at vel ${v.toFixed(3)}`);
    prev = cur;
  }
});

test('the layer boundary crossfades instead of stepping', () => {
  const mk = (v) => Float32Array.from([v]);
  const two = { midi: 60, layers: [{ vel: 0, pcm: mk(1) }, { vel: 0.5, pcm: mk(2) }] };
  // 遠離交界：只有一層
  assert.deepEqual(layerMix(two, 0.2).length, 1);
  assert.equal(layerMix(two, 0.2)[0].pcm[0], 1);
  assert.equal(layerMix(two, 0.9)[0].pcm[0], 2);
  // 交界上：兩層，等功率（平方和 = 1）——不是線性相加，那會在交界出現凹陷
  const mid = layerMix(two, 0.5);
  assert.equal(mid.length, 2);
  const power = mid.reduce((s, p) => s + p.gain * p.gain, 0);
  assert.ok(Math.abs(power - 1) < 1e-9, `equal power expected, got ${power}`);
  assert.ok(Math.abs(mid[0].gain - mid[1].gain) < 1e-9, 'half way means both at 0.707');
  // 跨過去之後又變成一層，而且是新的一層
  assert.equal(layerMix(two, 0.6).length, 1);
  assert.equal(layerMix(two, 0.6)[0].pcm[0], 2);
  // 三層的樂器（單簧管）：0.33 附近混 p+m、0.67 附近混 m+f
  const three = { midi: 60, layers: [{ vel: 0, pcm: mk(1) }, { vel: 0.333, pcm: mk(2) }, { vel: 0.667, pcm: mk(3) }] };
  assert.deepEqual(layerMix(three, 0.34).map((x) => x.pcm[0]), [1, 2], 'p + m near the first boundary');
  assert.deepEqual(layerMix(three, 0.68).map((x) => x.pcm[0]), [2, 3], 'm + f near the second boundary');
  assert.deepEqual(layerMix(three, 0.2).map((x) => x.pcm[0]), [1]);
  assert.deepEqual(layerMix(three, 0.9).map((x) => x.pcm[0]), [3]);
  // 單層樂器與壞輸入
  assert.deepEqual(layerMix({ pcm: mk(3) }, 0.4), [{ pcm: mk(3), gain: 1 }]);
  assert.deepEqual(layerMix(null, 0.4), []);
});

test('a remix near the boundary contains both layers', () => {
  const midi = parseMidi(smf(1, 480, [
    track([[0, ...tempo(500000)]]),
    track([[0, 0x90, 60, 64], [480, 0x80, 60, 0]]),
  ]));
  // 兩層的內容完全不同：只有真的混到，輸出才會有第二層的成分
  const soft = new Float32Array(SAMPLE_RATE).fill(0);
  const loud = new Float32Array(SAMPLE_RATE).fill(0);
  soft[0] = 1;
  loud[441] = 1;          // 10 ms 後
  const samples = { 'sampled:x': { rate: SAMPLE_RATE, notes: [{ midi: 60, layers: [{ vel: 0, pcm: soft }, { vel: 0.5, pcm: loud }] }] } };
  const hard = renderMidi(midi, { tracks: [{ instrument: 'sampled:x' }], samples: { 'sampled:x': { rate: SAMPLE_RATE, notes: [{ midi: 60, layers: [{ vel: 0, pcm: loud }] }] } } });
  const mixed = renderMidi(midi, { tracks: [{ instrument: 'sampled:x' }], samples });
  assert.ok(peak(hard) > 0.05);
  // 力度 64/127 = 0.504，剛好在交界上：兩層都要出現（第 0 與第 441 個樣本都有能量）
  assert.ok(Math.abs(mixed[0]) > 1e-4, 'the soft layer is missing at the boundary');
  assert.ok(Math.abs(mixed[441]) > 1e-4, 'the loud layer is missing at the boundary');
});

test('the levelling looks at the strongest layer, not at every layer', () => {
  // 弱層本來就小 15 dB，如果一起算中位數，整組會被放大到破音
  const mk = (peak) => { const pcm = new Float32Array(4); pcm[0] = peak; return pcm; };
  const notes = [
    { midi: 60, layers: [{ vel: 0, pcm: mk(0.1) }, { vel: 0.5, pcm: mk(0.5) }] },
    { midi: 64, layers: [{ vel: 0, pcm: mk(0.1) }, { vel: 0.5, pcm: mk(0.5) }] },
  ];
  const gain = normalizeInstrument(notes);
  // 強層中位峰值 0.5 → 拉到 0.7（×1.4）。若把弱層也算進去，基準會被拉低、整組放大到破音。
  assert.ok(Math.abs(gain - 0.7 / 0.5) < 0.02, `should level against the strong layers (median 0.5), got ${gain}`);
  // 兩層都乘同一個倍率：p 與 f 的音量差（就是力度）保持不變
  assert.ok(Math.abs(notes[0].layers[1].pcm[0] / notes[0].layers[0].pcm[0] - 5) < 1e-6);
});

test('a release section is loaded with the instrument and reaches renderMidi', async () => {
  const bank = new SampledInstruments(null);
  const spec = {
    name: 'test-rel',
    base: 'https://example.test/a/',
    notes: { 60: '60.mp3' },
    release: { base: 'https://example.test/rel/', notes: { 60: '60.mp3' } },
  };
  const asked = [];
  await bank.load(spec, {
    fetchImpl: async (url) => { asked.push(url); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; },
    decode: async () => fakeBuffer(64, 44100),
  });
  assert.deepEqual(asked, ['https://example.test/a/60.mp3', 'https://example.test/rel/60.mp3'], 'release files load with the instrument');
  const voice = bank.voices(['test-rel'])['sampled:test-rel'];
  assert.ok(voice.release, 'the release set must reach the mixer');
  assert.equal(voice.release.rate, 44100);
  assert.equal(voice.release.kit[60][0].pcm[0].length, 64, 'the release audio is in the kit shape');
});

test('a note-off plays the recorded release, not just a fade', () => {
  // 延音刻意做成靜音、釋音是一個脈衝：輸出只在 note-off 的位置有東西
  const silent = new Float32Array(SAMPLE_RATE);
  const rel = new Float32Array(SAMPLE_RATE);
  rel[0] = 1;
  const midi = parseMidi(smf(1, 480, [
    track([[0, ...tempo(500000)]]),
    track([[0, 0x90, 60, 100], [960, 0x80, 60, 0]]),      // 1 秒長
  ]));
  const samples = {
    'sampled:x': {
      rate: SAMPLE_RATE,
      notes: [{ midi: 60, layers: [{ vel: 0, pcm: silent }] }],
      release: { rate: SAMPLE_RATE, kit: { 60: [{ vel: 0, gain: 1, pcm: [rel] }] } },
    },
  };
  const out = renderMidi(midi, { tracks: [{ instrument: 'sampled:x' }], samples });
  const offAt = SAMPLE_RATE;                                 // 1 秒處放開
  assert.equal(peak(out.subarray(0, offAt - 100)), 0, 'nothing before note-off (the sustain is silent)');
  assert.ok(peak(out.subarray(offAt, offAt + 100)) > 0.05, 'the release lands at note-off');
  // 沒有 release 的樂器就維持原樣（只有淡出）
  const plain = renderMidi(midi, { tracks: [{ instrument: 'sampled:x' }], samples: { 'sampled:x': { rate: SAMPLE_RATE, notes: [{ midi: 60, layers: [{ vel: 0, pcm: silent }] }] } } });
  assert.equal(peak(plain), 0);
});

test('every bundled velocity file is on disk, referenced, and small enough to stay off the precache', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const listed = new Set([...sw.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  const names = Object.keys(DYNAMIC_INSTRUMENTS);
  assert.ok(names.length >= 8, `only ${names.length} layered instruments`);
  const referenced = new Set();
  let files = 0;
  let bytes = 0;
  for (const name of names) {
    const inst = DYNAMIC_INSTRUMENTS[name];
    assert.ok(inst.layers >= 2, `${name} claims no layers`);
    assert.ok(inst.credit.includes('CC0') || inst.credit.includes('CC-BY'), `${name} must credit its source`);
    for (const { url } of sampleUrls(name)) {
      files++;
      referenced.add(url);
      const path = new URL(`../${url}`, import.meta.url);
      assert.ok(existsSync(path), `${url} is missing (rerun tools/build-velocity.mjs)`);
      bytes += readFileSync(path).length;
    }
    // 有釋音取樣的樂器（鋼琴）：釋音也要在，而且進預快取（它很小、放開鍵就要用）
    if (inst.release) {
      for (const file of Object.values(inst.release.notes)) {
        const url = inst.release.base + file;
        referenced.add(url);
        assert.ok(existsSync(new URL(`../${url}`, import.meta.url)), `${url} is missing`);
        assert.ok(listed.has(url), `${url} should be precached (releases are tiny)`);
      }
    }
    // 覆蓋：這些樂器用的是內建的力度層版本，不是遠端單層版
    assert.ok(SAMPLE_LIBRARY[name].base.startsWith('samples/velocity/'), `${name} is not the layered version`);
  }
  // 反過來：目錄裡的檔案都要有人用（改了層的命名會留下孤兒檔）
  for (const name of names) {
    const dir = new URL(`../samples/velocity/${name}/`, import.meta.url);
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.mp3')) assert.ok(referenced.has(`samples/velocity/${name}/${file}`), `samples/velocity/${name}/${file} is not referenced`);
    }
  }
  assert.ok(files >= 150, `only ${files} layered files`);
  // 力度層不進預快取：全部加起來十幾 MB，會讓第一次開啟變成一次大下載
  // （用到才抓，引擎自己會存進 CacheStorage，用過一次就離線可用）
  const mb = bytes / 1048576;
  assert.ok(mb > 10, `the layered set is only ${mb.toFixed(1)} MB — did the build run?`);
  assert.ok(!listed.has('samples/velocity/grand/60-p.mp3'), 'the layered instruments must not be precached');
  assert.ok(listed.has('samples/velocity/grand-release/60.mp3'), 'the piano releases are precached');
});

test('a failed instrument is not remembered as loaded, so it can be retried', async () => {
  const bank = new SampledInstruments(null);
  const hit = await quietly(() => bank.load('flute', {
    fetchImpl: async () => { throw new Error('offline'); },
    decode: async () => fakeBuffer(),
  }));
  assert.equal(hit.notes.length, 0);
  assert.equal(hit.failed, sampleUrls('flute').length);
  assert.equal(bank.loaded('flute'), 0, 'a total failure must not count as loaded');
  assert.equal(bank.pcm('flute'), null);

  const ok = await bank.load('flute', {
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
    decode: async () => fakeBuffer(),
  });
  assert.ok(ok.notes.length > 0, 'the retry should work');
  assert.equal(bank.load('kazoo').then ? true : true, true);
  assert.equal(await bank.load('kazoo'), null, 'an unknown instrument resolves to null');
});

test('both pages play from the shared sample library', () => {
  const keyboard = readFileSync(new URL('../page/keyboard.js', import.meta.url), 'utf8');
  const console_ = readFileSync(new URL('../page/console.js', import.meta.url), 'utf8');
  for (const [name, src] of [['page/keyboard.js', keyboard], ['page/console.js', console_]]) {
    assert.ok(src.includes('SampledInstruments'), `${name} does not use the sampled engine`);
    assert.ok(src.includes('SAMPLE_LIBRARY'), `${name} keeps its own sample list`);
  }
  // 取樣音色在 MIDI 面板裡是 sampled:<name>，跟 chip／real 一樣靠前綴分辨
  assert.ok(console_.includes('SAMPLE_PREFIX'), 'page/console.js does not build sampled:<name> options');
  assert.ok(keyboard.includes('sampleSynth('), 'page/keyboard.js has no synth fallback while samples load');
});

test('SampledInstruments.playNote: crossfades layers at boundary, plays release sample on note-off, and disconnects GainNodes', async () => {
  const sources = [];
  const gains = [];
  const ctx = {
    currentTime: 1,
    sampleRate: 44100,
    state: 'running',
    destination: {},
    createBuffer: (ch, len, rate) => ({
      numberOfChannels: ch, length: len, sampleRate: rate,
      copyToChannel() {},
    }),
    createGain: () => {
      const g = {
        gain: { value: 1, cancelScheduledValues() {}, setTargetAtTime() {} },
        connect() {},
        disconnect() { g.disconnected = true; },
        disconnected: false,
      };
      gains.push(g);
      return g;
    },
    createBufferSource: () => {
      const s = {
        buffer: null,
        playbackRate: { value: 1 },
        connect() {},
        start(when) { s.startedAt = when; },
        stop(when) { s.stoppedAt = when; },
        onended: null,
      };
      sources.push(s);
      return s;
    },
  };

  const bank = new SampledInstruments(ctx);
  const spec = {
    name: 'test-piano',
    base: 'https://example.test/p/',
    notes: { 60: [{ vel: 0, file: '60-p.mp3' }, { vel: 0.5, file: '60-f.mp3' }] },
    release: { base: 'https://example.test/r/', notes: { 60: '60-rel.mp3' } },
  };
  await bank.load(spec, {
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
    decode: async () => fakeBuffer(64, 44100),
  });

  // At velocity 0.5 (the layer boundary), both layers play in equal-power crossfade
  const handle = bank.playNote('test-piano', 60, { vel: 0.5 });
  assert.ok(handle);
  assert.equal(handle.sources.length, 2, 'two layers should play at the velocity boundary');
  assert.equal(sources.length, 2);

  // When released, both layers stop and the release damper sample starts
  handle.release(0.2);
  assert.equal(sources.length, 3, 'releasing the note should trigger the release sample');
  assert.equal(sources[2].startedAt, 1);

  // Every source cleans up its GainNode on ended
  for (const s of sources) {
    assert.equal(typeof s.onended, 'function');
    s.onended();
  }
  assert.ok(gains.every((g) => g.disconnected), 'every GainNode must disconnect when its source ends');
});

test('SampledInstruments: progressive loading publishes early, single-layer velocity filter, sustain loop, and stereo pan', async () => {
  const filters = [];
  const panners = [];
  const sources = [];
  const gains = [];
  const ctx = {
    currentTime: 0,
    sampleRate: 44100,
    state: 'running',
    destination: {},
    createBuffer: (ch, len, rate) => ({
      numberOfChannels: ch, length: len, sampleRate: rate, copyToChannel() {},
    }),
    createBiquadFilter: () => {
      const f = { type: 'lowpass', frequency: { value: 20000 }, connect() {}, disconnect() { f.disconnected = true; }, disconnected: false };
      filters.push(f);
      return f;
    },
    createStereoPanner: () => {
      const p = { pan: { value: 0 }, connect() {}, disconnect() { p.disconnected = true; }, disconnected: false };
      panners.push(p);
      return p;
    },
    createGain: () => {
      const g = { gain: { value: 1, cancelScheduledValues() {}, setTargetAtTime() {} }, connect() {}, disconnect() { g.disconnected = true; }, disconnected: false };
      gains.push(g);
      return g;
    },
    createBufferSource: () => {
      const s = { buffer: null, playbackRate: { value: 1 }, loop: false, loopStart: 0, loopEnd: 0, connect() {}, start() {}, stop() {}, onended: null };
      sources.push(s);
      return s;
    },
  };

  const bank = new SampledInstruments(ctx);
  // Progressive loading: 7 notes x 2 layers; instrument should be playable before all 14 files finish
  const progSpec = {
    name: 'strings',
    base: 'https://example.test/s/',
    notes: Object.fromEntries([48, 52, 55, 60, 64, 67, 72].map((m) => [m, [{ vel: 0, file: `${m}p.mp3` }, { vel: 0.5, file: `${m}f.mp3` }]])),
  };
  let seenPlayableDuringLoad = false;
  const longTone = (() => {
    const len = 44100;
    const d = new Float32Array(len);
    for (let i = 0; i < len; i++) d[i] = Math.sin((2 * Math.PI * 220 * i) / 44100);
    return { length: len, sampleRate: 44100, numberOfChannels: 1, getChannelData: () => d };
  })();
  await bank.load(progSpec, {
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
    decode: async () => longTone,
    onProgress: (done, total) => {
      if (done < total && bank.instruments.has('strings')) seenPlayableDuringLoad = true;
    },
  });
  assert.equal(seenPlayableDuringLoad, true, 'progressive loading must publish primary notes before secondary layers finish');

  // Sustained instrument ('strings') sets loop points when held without fixed dur
  const hStr = bank.playNote('strings', 72, { vel: 0.85 });
  assert.ok(hStr);
  assert.equal(sources[0].loop, true, 'sustained instrument should loop in realtime');
  assert.ok(sources[0].loopEnd > sources[0].loopStart);
  assert.equal(panners.length, 1, 'mono recording gets key-tracked stereo panner');
  assert.ok(panners[0].pan.value > 0, 'high note pans slightly right');

  // Single-layer instrument with soft velocity engages lowpass velocity filter
  await bank.load({ name: 'harp-test', base: 'https://example.test/h/', notes: { 60: '60.mp3' } }, {
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
    decode: async () => longTone,
  });
  const hHarp = bank.playNote('harp-test', 48, { vel: 0.3 });
  assert.ok(hHarp);
  assert.equal(filters.length, 1, 'soft note on single-layer instrument engages lowpass velocity filter');
  assert.ok(filters[0].frequency.value < 5000);

  for (const s of sources) s.onended();
  assert.ok(filters.every((f) => f.disconnected) && panners.every((p) => p.disconnected) && gains.every((g) => g.disconnected));
});
