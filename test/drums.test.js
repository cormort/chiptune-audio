import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import {
  SampledKit, pickHit, kitNotes, kitHas, SAMPLE_KIT,
  parseMidi, renderMidi, autoInstruments, SAMPLE_RATE,
} from '../src/index.js';
import { DRUM_KIT } from '../page/drum-library.js';
import { track, smf, tempo } from './smf.js';

const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const sane = (a) => a.every((x) => Number.isFinite(x) && Math.abs(x) <= 1);
const DRUM_DIR = new URL('../samples/drums/', import.meta.url);

test('the kit data points at files that are really in the repo', () => {
  // 這張表是產生的，最容易壞的地方是「檔案沒跟著產生」或「改了檔名沒重跑」——
  // 那在瀏覽器裡只會表現成「某一顆鼓沒聲音」，不會有任何錯誤。
  const onDisk = new Set(readdirSync(DRUM_DIR));
  const notes = kitNotes(DRUM_KIT);
  assert.ok(notes.length >= 35, `only ${notes.length} drum notes mapped`);
  const referenced = new Set();
  for (const note of notes) {
    assert.ok(note >= 35 && note <= 84, `${note} is not a GM percussion note`);
    const layers = DRUM_KIT.notes[note];
    assert.equal(layers[0].vel, 0, `note ${note} has no softest layer`);
    let last = -1;
    for (const layer of layers) {
      assert.ok(layer.vel > last, `note ${note} layers are not sorted by velocity`);
      last = layer.vel;
      assert.ok(layer.gain > 0 && layer.gain <= 1, `note ${note} has gain ${layer.gain}`);
      assert.ok(layer.files.length >= 1, `note ${note} has an empty layer`);
      for (const f of layer.files) {
        assert.ok(onDisk.has(f), `samples/drums/${f} does not exist (rerun tools/build-drums.mjs)`);
        referenced.add(f);
      }
    }
  }
  // 反過來：目錄裡的檔案都要有人用，不然就是忘了重跑產生器留下的孤兒
  for (const f of onDisk) {
    if (!f.endsWith('.mp3')) continue;
    assert.ok(referenced.has(f), `samples/drums/${f} is not referenced by the kit data`);
  }
  // 沒取樣的音要明列出來（播放時退回合成鼓），不能默默消失
  for (const note of DRUM_KIT.missing) assert.equal(kitHas(DRUM_KIT, note), false, `${note} is listed missing but mapped`);
  assert.ok(kitHas(DRUM_KIT, 36) && kitHas(DRUM_KIT, 38) && kitHas(DRUM_KIT, 42), 'kick/snare/hat must be mapped');
  assert.ok(DRUM_KIT.credit.includes('CC0'), 'the kit is CC0: the credit must say so');
  assert.equal(DRUM_KIT.base, 'samples/drums/');
});

test('pickHit takes the loudest layer that fits the velocity, and rotates takes', () => {
  const layers = [
    { vel: 0, gain: 0.5, pcm: ['soft'] },
    { vel: 0.5, gain: 0.8, pcm: ['mid-a', 'mid-b'] },
    { vel: 0.9, gain: 1, pcm: ['hard'] },
  ];
  assert.deepEqual(pickHit(layers, 0.1), { pcm: 'soft', gain: 0.5 });
  assert.deepEqual(pickHit(layers, 0.5), { pcm: 'mid-a', gain: 0.8 }, 'the boundary belongs to the louder layer');
  assert.deepEqual(pickHit(layers, 0.89), { pcm: 'mid-a', gain: 0.8 }, 'still the middle layer until 0.9');
  assert.deepEqual(pickHit(layers, 1), { pcm: 'hard', gain: 1 });
  assert.deepEqual(pickHit(layers, 0.95).pcm, 'hard', 'the hardest layer takes everything above it');
  // round robin：同一個力度層有幾個錄音就輪流用
  assert.deepEqual(pickHit(layers, 0.6, 0).pcm, 'mid-a');
  assert.deepEqual(pickHit(layers, 0.6, 1).pcm, 'mid-b');
  assert.deepEqual(pickHit(layers, 0.6, 2).pcm, 'mid-a');
  assert.deepEqual(pickHit(layers, 0.6, -1).pcm, 'mid-b', 'a negative counter still lands in range');
  // 壞輸入不該產生 NaN 或丟例外：呼叫端會自己退回合成鼓
  assert.equal(pickHit(layers, NaN).pcm, 'hard', 'an unknown velocity is treated as a full hit');
  assert.equal(pickHit([], 0.5), null);
  assert.equal(pickHit(null, 0.5), null);
  assert.equal(pickHit([{ vel: 0, gain: 1, pcm: [] }], 0.5), null);
  assert.equal(pickHit(DRUM_KIT.notes[36], 0.5), null, 'the data table lists files; only decoded layers have pcm');
});

const fakeBuffer = (len = 4000, rate = 48000) => {
  const data = new Float32Array(len);
  data[0] = 1;      // 一個脈衝：位置才驗得出來
  return { length: len, sampleRate: rate, getChannelData: () => data };
};

test('SampledKit loads every hit once, keeps what arrived, and reports progress', async () => {
  const kit = new SampledKit(null);
  const tiny = {
    name: 'test-kit',
    base: 'samples/drums/',
    notes: { 36: [{ vel: 0, gain: 1, files: ['36-v1-r1.mp3', '36-v1-r2.mp3'] }], 38: [{ vel: 0, gain: 0.9, files: ['38-v1-r1.mp3'] }] },
  };
  const asked = [];
  const broken = 'samples/drums/38-v1-r1.mp3';
  const fetchImpl = async (url) => {
    asked.push(url);
    if (url === broken) return { ok: false, status: 404 };
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(16) };
  };
  const progress = [];
  const hit = await kit.load(tiny, { fetchImpl, decode: async () => fakeBuffer(), onProgress: (d, t) => progress.push([d, t]) });
  assert.equal(asked.length, 3, 'every referenced file, once');
  assert.equal(progress.at(-1)[0], 3);
  assert.equal(progress.at(-1)[1], 3);
  assert.equal(hit.failed, 1);
  assert.equal(kit.loaded('test-kit'), 2, 'the 404 hit is skipped, the rest still work');
  assert.equal(kit.wanted(tiny), 3);
  assert.equal(kit.loaded('kit'), 0, 'unloaded kits report nothing');

  const before = asked.length;
  await kit.load(tiny, { fetchImpl, decode: async () => fakeBuffer() });
  assert.equal(asked.length, before + 1, 'only the missing file is retried');
  assert.equal(asked.at(-1), broken);

  // 補齊之後就不再抓，而且 voices() 給 renderMidi 的形狀要對
  const full = await kit.load(tiny, {
    fetchImpl: async (url) => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
    decode: async () => fakeBuffer(200, 48000),
  });
  assert.equal(full.notes[36].length, 1);
  assert.equal(full.notes[36][0].pcm.length, 2, 'both round robins');
  assert.equal(full.rate, 48000, 'the rate comes from the decoded audio');
  const voices = kit.voices(SAMPLE_KIT, 'test-kit');
  assert.deepEqual(Object.keys(voices), [SAMPLE_KIT]);
  assert.equal(voices[SAMPLE_KIT].rate, 48000);
  assert.equal(voices[SAMPLE_KIT].kit[38][0].gain, 0.9);
  assert.equal(kit.voices(SAMPLE_KIT, 'nope'), null);
});

test('a drum track plays the recordings, and unmapped notes fall back to the synth', () => {
  const midi = parseMidi(smf(1, 480, [
    track([[0, ...tempo(500000)]]),
    track([
      [0, 0x99, 36, 100],      // kick
      [240, 0x89, 36, 0],
      [0, 0x99, 47, 100],      // timpani: the kit has no recording for it
      [240, 0x89, 47, 0],
    ]),
  ]));
  const pcm = new Float32Array(SAMPLE_RATE);
  pcm[0] = 1;
  const voices = { [SAMPLE_KIT]: { rate: SAMPLE_RATE, kit: { 36: [{ vel: 0, gain: 1, pcm: [pcm, pcm] }] } } };

  const out = renderMidi(midi, { tracks: [{ instrument: SAMPLE_KIT }], samples: voices });
  assert.ok(sane(out), 'a kit render must stay in range');
  assert.ok(peak(out) > 0.05, 'the sampled hit is silent');
  assert.equal(out[0] > 0.05, true, 'the kick lands at the start');
  // 47 沒有取樣：那一下要退回合成鼓，所以整首的後半不可能是全零
  const half = Math.round(0.25 * SAMPLE_RATE);
  assert.ok(peak(out.subarray(half)) > 0, 'an unmapped drum note must not disappear');

  // 沒有給鼓的樣本時 sampled:kit 是錯的（不是靜靜地播合成鼓）
  assert.throws(() => renderMidi(midi, { tracks: [{ instrument: SAMPLE_KIT }] }), /Unknown instrument/);
  // 晶片鼓照舊（沒給樣本時 drums 還是 drumParams）
  const chip = renderMidi(midi, { tracks: [{ instrument: 'drums' }] });
  assert.ok(peak(chip) > 0.05 && sane(chip));
  // 靜音就真的沒有聲音
  assert.equal(peak(renderMidi(midi, { tracks: [{ instrument: SAMPLE_KIT, mute: true }], samples: voices })), 0);
});

test('the drum channel is voiced with the real kit, and the CLI keeps its chip drums', () => {
  const midi = parseMidi(smf(1, 480, [
    track([[0, ...tempo(500000)]]),
    track([[0, 0x99, 36, 100], [240, 0x89, 36, 0]]),
  ]));
  assert.equal(autoInstruments(midi)[0].instrument, SAMPLE_KIT);
  assert.equal(autoInstruments(midi, { samples: false })[0].instrument, 'drums');
});

test('every drum hit is precached, and nothing else is', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const listed = new Set([...sw.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  const files = readdirSync(DRUM_DIR).filter((f) => f.endsWith('.mp3'));
  assert.ok(files.length > 50, `only ${files.length} drum files on disk`);
  for (const f of files) assert.ok(listed.has(`samples/drums/${f}`), `samples/drums/${f} is not in the sw.js precache list`);
  for (const path of listed) {
    if (!path.startsWith('samples/drums/')) continue;
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `${path} is precached but missing`);
  }
  assert.ok(listed.has('page/drum-library.js'), 'page/drum-library.js is not precached');
});
