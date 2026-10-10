import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  prepareSample, normalizeInstrument, pickLayer, layerMix,
  DYNAMIC_INSTRUMENTS,
  SAMPLE_LIBRARY, SAMPLE_CREDIT, SAMPLE_PREFIX, SampledInstruments,
  sampleName, sampleNames, sampleLabel, sampleSynth, sampleUrls,
  nearestSample, sampleVoice, mixSampleInto,
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
      assert.equal(url, `${inst.base}${url.slice(inst.base.length)}`, `${where} URL does not match its base`);
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

test('prepareSample downmixes stereo and cuts the silent lead-in', () => {
  // 立體聲必須取平均：Salamander 鋼琴的左聲道比右小 5 dB，只取左邊等於少掉 19% 能量。
  const stereo = {
    length: 4, sampleRate: 44100, numberOfChannels: 2,
    getChannelData: (c) => (c === 0 ? Float32Array.from([0.5, 0.5, 0.5, 0.5]) : Float32Array.from([0.1, 0.1, 0.1, 0.1])),
  };
  assert.deepEqual([...prepareSample(stereo)].map((v) => +v.toFixed(3)), [0.3, 0.3, 0.3, 0.3]);

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
  const pcm = voice.notes[0].layers[0].pcm;
  assert.ok(pcm.length < len, 'the silent lead-in should be gone');
  // 900 個樣本的空白（18.75 ms）減掉 2 ms 前導 = 16.75 → 17 ms
  assert.equal(Math.round((len - pcm.length) / 48000 * 1000), 17, 'the silent lead-in, minus the 2 ms preroll');
  assert.ok(Math.abs(pcm[0]) < 1e-6, 'the preroll is silence');
  // 兩聲道取平均（0.4 + 0.2）/ 2 = 0.3，再乘上樂器的基準音量倍率
  assert.ok(Math.abs(pcm.at(-1) - 0.3 * loaded.gain) < 1e-6, 'both channels are mixed in, then levelled');
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

test('the bundled velocity layers are on disk and precached', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const listed = new Set([...sw.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  assert.ok(listed.has('src/dynamic-library.js'), 'src/dynamic-library.js is not precached');
  const names = Object.keys(DYNAMIC_INSTRUMENTS);
  assert.ok(names.length >= 3, `only ${names.length} layered instruments`);
  let files = 0;
  for (const name of names) {
    const inst = DYNAMIC_INSTRUMENTS[name];
    assert.ok(inst.layers >= 2, `${name} claims no layers`);
    assert.ok(inst.credit.includes('CC0'), `${name} must credit its CC0 source`);
    // 每個音都要有兩層，而且兩層真的存在、真的進快取
    for (const url of sampleUrls(name).map((u) => u.url)) {
      files++;
      assert.ok(existsSync(new URL(`../${url}`, import.meta.url)), `${url} is missing (rerun tools/build-velocity.mjs)`);
      assert.ok(listed.has(url), `${url} is not in the sw.js precache list`);
    }
  }
  assert.ok(files >= 50, `only ${files} layered files`);
  // 覆蓋：這三個樂器用的是內建的力度層版本，不是遠端單層版
  for (const name of names) assert.ok(SAMPLE_LIBRARY[name].base.startsWith('samples/velocity/'), `${name} is not the layered version`);
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
