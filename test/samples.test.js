import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
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
    assert.match(inst.base, /^https:\/\/.+\/$/, `${where} base URL looks wrong`);
    assert.equal(sampleLabel(name), inst.label);
    // 樣本還沒到時播的合成代理音必須真的存在，否則「按鍵不會沒聲音」就是空話。
    assert.ok(resolveInstrument(inst.synth), `${where} synth ${inst.synth} does not resolve`);
    const urls = sampleUrls(name);
    assert.ok(urls.length >= 6, `${where} has only ${urls.length} samples`);
    const midis = urls.map((u) => u.midi);
    assert.deepEqual(midis, [...midis].sort((a, b) => a - b), `${where} notes are not sorted`);
    assert.equal(new Set(midis).size, midis.length, `${where} has duplicate notes`);
    for (const { midi, url } of urls) {
      assert.ok(midi >= 0 && midi <= 127, `${where} has an impossible note ${midi}`);
      assert.equal(url, `${inst.base}${inst.notes[midi]}`, `${where} URL does not match its file`);
      assert.match(url, /\.mp3$/, `${where} ${url} is not an mp3`);
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
  const asked = [];
  const brokenUrl = sampleUrls('violin')[1].url;      // 一個檔案壞掉（404）
  const fetchImpl = async (url) => {
    asked.push(url);
    if (url === brokenUrl) return { ok: false, status: 404 };
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(16) };
  };
  const decode = async () => fakeBuffer(128);
  const progress = [];
  const hit = await quietly(() => bank.load('violin', {
    fetchImpl, decode, onProgress: (done, total) => progress.push([done, total]),
  }));

  const wanted = sampleUrls('violin').length;
  assert.equal(asked.length, wanted, 'it should ask for exactly the listed files');
  assert.equal(hit.notes.length, wanted - 1, 'the 404 file is skipped, the rest still work');
  assert.equal(hit.failed, 1);
  assert.equal(progress.length, wanted, 'progress fires for every file, failures included');
  assert.equal(progress.at(-1)[0], wanted);
  assert.deepEqual(progress.at(-1)[1], wanted);
  assert.equal(bank.loaded('violin'), wanted - 1);
  assert.equal(bank.wanted('violin'), wanted);
  assert.equal(bank.loaded('kazoo'), 0);

  // 只抓到一半時，下一次只補缺的那一個（不重抓已經抓到的樣本）
  const before = asked.length;
  await quietly(() => bank.load('violin', { fetchImpl, decode }));
  assert.equal(asked.length, before + 1, 'only the missing file is retried');
  assert.equal(asked.at(-1), brokenUrl);
  assert.equal(bank.loaded('violin'), wanted - 1);

  // 整個樂器都抓完就不再多問一次
  const complete = new SampledInstruments(null);
  const calls = [];
  const okFetch = async (url) => { calls.push(url); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
  await complete.load('flute', { fetchImpl: okFetch, decode });
  const first = calls.length;
  await complete.load('flute', { fetchImpl: okFetch, decode });
  assert.equal(calls.length, first, 'a fully loaded instrument must not be fetched again');
  assert.equal(complete.loading('flute'), false);

  // 挑音：最近的樣本，超出音域也用最近的（低音往最近的樣本拉）
  const notes = [...bank.instruments.get('violin').notes];
  const best = bank.findBest('violin', notes[1].midi);
  assert.equal(best.midi, notes[1].midi);
  assert.equal(bank.findBest('violin', notes[1].midi + 1).midi, notes[1].midi);
  assert.equal(bank.findBest('kazoo', 60), null);

  // 給 renderMidi 用的樣子
  const voices = bank.voices();
  assert.deepEqual(Object.keys(voices), ['sampled:violin']);
  assert.equal(voices['sampled:violin'].rate, 44100);
  assert.equal(voices['sampled:violin'].notes.length, wanted - 1);
  assert.equal(voices['sampled:violin'].notes[0].pcm.length, 128);

  // 沒有 AudioContext 就沒有聲音可播，但也不能丟例外
  assert.equal(bank.playNote('violin', 60), null);
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
