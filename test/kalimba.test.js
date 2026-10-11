import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import {
  KALIMBA_INSTRUMENT, KALIMBA_SOURCE, SAMPLE_LIBRARY, SAMPLE_RATE, SampledInstruments,
  KALIMBA_TINES, KALIMBA_CENTER, TINE_KEYS, KALIMBA_TUNINGS, KALIMBA_DEMOS,
  tineNumber, tineNote, tineIndexFor, tineForKey, tineLength, tinePositions, velocityAt, demoSeconds,
  parseMidi, renderMidi, sampleUrls, sampleLabel, sampleSynth, resolveInstrument,
} from '../src/index.js';
import { track, smf, tempo } from './smf.js';

const KALIMBA_DIR = new URL('../samples/kalimba/', import.meta.url);
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

// 這一組檢查「資料表 ↔ 磁碟上的檔案 ↔ service worker 預快取」三者一致。少一根簧片在
// 瀏覽器裡只會表現成「那一根沒聲音」，不會有任何錯誤訊息，所以三個方向都要釘住。
test('every tine has a recording on disk, and every file on disk is used', () => {
  const onDisk = new Set(readdirSync(KALIMBA_DIR).filter((f) => f.endsWith('.mp3')));
  const urls = sampleUrls(KALIMBA_INSTRUMENT);
  assert.equal(urls.length, 17, `the kalimba data lists ${urls.length} files`);
  const referenced = new Set();
  for (const { midi, url } of urls) {
    assert.ok(midi >= 60 && midi <= 88, `MIDI ${midi} is outside a 17-key kalimba (C4–E6)`);
    assert.equal(KALIMBA_TINES.includes(midi), true, `MIDI ${midi} is not a tine in the layout`);
    const file = url.slice(KALIMBA_INSTRUMENT.base.length);
    assert.ok(onDisk.has(file), `samples/kalimba/${file} does not exist (rerun tools/build-kalimba.mjs)`);
    referenced.add(file);
  }
  for (const f of onDisk) assert.ok(referenced.has(f), `samples/kalimba/${f} is not referenced by the data`);
  // 17 根簧片各一個錄音、不重複，而且音號跟排列完全對上
  assert.equal(new Set(KALIMBA_TINES).size, 17, 'the layout repeats a pitch');
  assert.deepEqual([...urls.map((u) => u.midi)].sort((a, b) => a - b), [...KALIMBA_TINES].sort((a, b) => a - b));
});

test('the kalimba is bundled, so it is CC0, credited, and precached like the drums', () => {
  assert.equal(KALIMBA_INSTRUMENT.base, 'samples/kalimba/');
  assert.equal(KALIMBA_SOURCE.license, 'CC0 1.0');
  assert.ok(KALIMBA_INSTRUMENT.credit.includes('CC0'), 'the credit must name the licence');
  assert.ok(KALIMBA_INSTRUMENT.credit.includes('Piervergili'), 'the credit must name the player');
  assert.equal(KALIMBA_INSTRUMENT.synth, 'real:kalimba', 'the fallback voice must exist in the real bank');
  assert.ok(resolveInstrument(KALIMBA_INSTRUMENT.synth), `${KALIMBA_INSTRUMENT.synth} is not a bank voice`);
  assert.equal(sampleSynth('kalimba'), 'real:kalimba');
  assert.ok(sampleLabel('kalimba').length > 0);
  assert.equal(SAMPLE_LIBRARY.kalimba, KALIMBA_INSTRUMENT, 'the sampler library must carry the kalimba');

  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const listed = new Set([...sw.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  const files = readdirSync(KALIMBA_DIR).filter((f) => f.endsWith('.mp3'));
  for (const f of files) assert.ok(listed.has(`samples/kalimba/${f}`), `samples/kalimba/${f} is not in the sw.js precache list`);
  for (const path of listed) {
    if (!path.startsWith('samples/kalimba/')) continue;
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `${path} is precached but missing`);
  }
  // 相鄰簧片最多差 2 個半音，所以中間的音用播放速率內插最多只差 1 個半音（不會出現
  // 法國號那種 14 個半音的洞）
  const midis = [...KALIMBA_TINES].sort((a, b) => a - b);
  const widest = Math.max(...midis.slice(1).map((m, i) => m - midis[i]));
  assert.equal(widest, 2);
  assert.equal(KALIMBA_INSTRUMENT.gap, 2);
});

// 音高是量出來、校正過的（tools/build-kalimba.mjs）：來源那把琴每一根都偏高，
// 最高的簧片高了 22 音分（四分之一個半音）。這裡檢查產生的量測資料還在，而且
// 校正倍率真的把那一段修掉了——沒有這一步的話，移調或跟其他樂器合奏都會走音。
test('every tine was tuned to equal temperament before it was encoded', () => {
  const tuning = KALIMBA_SOURCE.tuning;
  assert.ok(tuning, 'the build did not record the tuning measurements');
  const cents = Object.values(tuning).map((t) => t.cents);
  assert.equal(cents.length, 17);
  assert.ok(Math.max(...cents) > 15, 'the source was not measurably sharp: was the measurement changed?');
  // 幾乎每一根都偏高（只有 E4 是 −0.2 音分，等於準的），而不是幾根特別離譜
  assert.ok(cents.filter((c) => c > 3).length >= 12, 'most tines should have been sharp');
  for (const [midi, t] of Object.entries(tuning)) {
    const target = 440 * 2 ** ((+midi - 69) / 12);
    assert.ok(t.ratio > 0.97 && t.ratio < 1.01, `${midi}: correction ${t.ratio} is not a tuning fix`);
    // 校正後應該回到平均律上（量到 262.8 Hz → 乘上 0.9954 → 261.6 Hz）
    const corrected = t.hz * t.ratio;
    const off = 1200 * Math.log2(corrected / target);
    assert.ok(Math.abs(off) < 3, `${midi} is still ${off.toFixed(1)} cents off after correction`);
  }
});

// 排列是這個樂器的重點：最長（最低）的一根在正中間，往兩邊交替升高，兩邊各 8 根。
test('the layout is a real 17-key kalimba: longest tine in the centre', () => {
  assert.equal(KALIMBA_TINES.length, 17);
  assert.equal(KALIMBA_TINES[KALIMBA_CENTER], Math.min(...KALIMBA_TINES), 'the centre tine must be the lowest');
  assert.equal(KALIMBA_CENTER, 8, 'seventeen tines split 8 + 1 + 8');
  // 往兩邊走音高都升高（左手那一邊由中心往左、右手那一邊由中心往右）
  for (let i = KALIMBA_CENTER; i > 0; i--) assert.ok(KALIMBA_TINES[i - 1] > KALIMBA_TINES[i], `tine ${i - 1} breaks the left run`);
  for (let i = KALIMBA_CENTER; i < 16; i++) assert.ok(KALIMBA_TINES[i + 1] > KALIMBA_TINES[i], `tine ${i + 1} breaks the right run`);
  // 兩邊各是一串**三度**（左 D4 F4 A4 C5 E5 G5 B5 D6、右 E4 G4 B4 D5 F5 A5 C6 E6）：
  // 由中心往外依音高交替左右，所以每一邊拿到的都是音階的隔一個音。這件事也可以用
  // 「音高排序後的左右順序」驗：中央、左、右、左、右…
  const byPitch = [...KALIMBA_TINES].sort((a, b) => a - b);
  assert.deepEqual(byPitch, [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84, 86, 88], 'not a C-major run');
  assert.deepEqual(byPitch.slice(1).map((m, i) => m - byPitch[i]), [2, 2, 1, 2, 2, 2, 1, 2, 2, 1, 2, 2, 2, 1, 2, 2], 'not the diatonic scale');
  const sides = byPitch.map((m) => {
    const i = KALIMBA_TINES.indexOf(m);
    return i === KALIMBA_CENTER ? 'C' : i < KALIMBA_CENTER ? 'L' : 'R';
  });
  assert.equal(sides.join(''), `CLRLRLRLRLRLRLRLR`, 'the tines must alternate left/right as the pitch rises');
  assert.equal(KALIMBA_TINES.filter((m) => m % 12 === 0).length, 3, 'C4, C5 and C6 are the only C tines');

  // 長度 ∝ 1/√f：中央最長、兩邊最短，而且是單調的
  const lengths = KALIMBA_TINES.map(tineLength);
  assert.ok(Math.abs(lengths[KALIMBA_CENTER] - 1) < 1e-9, 'the longest tine must be the reference');
  for (let i = KALIMBA_CENTER; i > 0; i--) assert.ok(lengths[i - 1] < lengths[i], `tine ${i - 1} is not shorter`);
  for (let i = KALIMBA_CENTER; i < 16; i++) assert.ok(lengths[i + 1] < lengths[i], `tine ${i + 1} is not shorter`);
  assert.ok(lengths[0] > 0.4 && lengths[16] > 0.4, 'the shortest tine is more than 2.2x shorter than the longest');

  // 畫面上的座標：x 由左到右遞增、都在 0..1 內，index 與音號跟常數一致
  const pos = tinePositions();
  assert.equal(pos.length, 17);
  for (const [i, t] of pos.entries()) {
    assert.equal(t.index, i);
    assert.equal(t.midi, KALIMBA_TINES[i]);
    assert.equal(t.length, lengths[i]);
    assert.equal(t.side, i < 8 ? 'L' : i === 8 ? 'C' : 'R');
    assert.ok(t.x > 0 && t.x < 1);
    if (i) assert.ok(t.x > pos[i - 1].x, 'the tines must be laid out left to right');
  }
});

test('tines, keys and notes map onto each other, and the numbers are a C-major scale', () => {
  assert.equal(new Set(TINE_KEYS).size, 17, 'two tines share a key');
  assert.equal(new Set(TINE_KEYS.map((k) => k.toLowerCase())).size, 17);
  TINE_KEYS.forEach((k, i) => {
    assert.equal(tineForKey(k), i);
    assert.equal(tineForKey(k.toUpperCase()), i, 'the mapping is case-insensitive');
  });
  assert.equal(tineForKey('!'), -1);
  assert.equal(tineForKey('z'), -1, 'z is not part of the kalimba layout');
  KALIMBA_TINES.forEach((midi, i) => assert.equal(tineIndexFor(midi), i));
  assert.equal(tineIndexFor(61), -1, 'a chromatic note is not a tine');
  assert.equal(tineIndexFor(59), -1, 'below the lowest tine');

  // 簡譜：中央 C 是 1，往上每一個八度多一個點；17 根都是白鍵
  assert.equal(tineNumber(8), '1');
  assert.equal(tineNumber(7), '2');
  assert.equal(tineNumber(9), '3');
  assert.equal(tineNumber(15), '1··');
  assert.equal(tineNumber(16), '3··');
  for (let i = 0; i < 17; i++) assert.match(tineNumber(i), /^[1-7]·{0,2}$/, `tine ${i} is not a white-key degree`);

  // 移調：整組平移，排列不變；移調後仍然每一根都對得上自己的音號
  for (const t of KALIMBA_TUNINGS) {
    assert.equal(typeof t.transpose, 'number');
    KALIMBA_TINES.forEach((midi, i) => assert.equal(tineNote(i, t.transpose), midi + t.transpose));
  }
  assert.equal(KALIMBA_TUNINGS[0].transpose, 0, 'the first tuning is the instrument itself');
  assert.equal(new Set(KALIMBA_TUNINGS.map((t) => t.id)).size, KALIMBA_TUNINGS.length);
});

test('plucking further from the bridge is louder, and never silent', () => {
  const at = (y) => velocityAt(y);
  assert.ok(at(0) > 0.4, 'plucking at the bridge must still be audible');
  assert.ok(at(1) <= 1);
  for (let y = 0; y <= 1.0001; y += 0.1) assert.ok(at(y) >= at(y - 0.1), 'velocity must not fall towards the tip');
  assert.equal(at(-5), at(0), 'out of range positions clamp');
  assert.equal(at(9), at(1));
  assert.equal(at(NaN), at(1), 'an unknown position is treated as the tip');
});

test('the demo tunes only use tines that exist, in order', () => {
  assert.ok(KALIMBA_DEMOS.length >= 2);
  for (const demo of KALIMBA_DEMOS) {
    assert.ok(demo.label && demo.bpm > 0);
    let last = -1;
    for (const [index, at, dur] of demo.notes) {
      assert.ok(Number.isInteger(index) && index >= 0 && index < 17, `${demo.id}: tine ${index} does not exist`);
      assert.ok(dur > 0, `${demo.id}: a note has no length`);
      assert.ok(at >= last, `${demo.id}: the notes are not in time order`);
      last = at;
    }
    const seconds = demoSeconds(demo);
    assert.ok(seconds > 3 && seconds < 60, `${demo.id} is ${seconds.toFixed(1)}s long`);
  }
});

// 取樣來自 CC0 的 17 個檔案，所以載入器要能用同一條路徑（cache → fetch → decode）載完它們。
test('SampledInstruments loads all 17 tines through the normal path', async () => {
  const sampled = new SampledInstruments(null);
  const asked = [];
  const fake = (len = 4000, rate = 48000) => {
    const data = new Float32Array(len);
    data[0] = 0.5;
    return { length: len, sampleRate: rate, getChannelData: () => data };
  };
  const hit = await sampled.load('kalimba', {
    fetchImpl: async (url) => { asked.push(url); return { ok: true, arrayBuffer: async () => new ArrayBuffer(16) }; },
    decode: async () => fake(),
  });
  assert.equal(asked.length, 17, 'every tine is fetched exactly once');
  assert.equal(hit.notes.length, 17);
  assert.equal(hit.failed, 0);
  assert.equal(sampled.wanted('kalimba'), 17);
  assert.equal(sampled.loaded('kalimba'), 17);
  assert.equal(hit.rate, undefined, 'the rate is per note, not on the instrument');
  assert.equal(hit.notes[0].rate, 48000);
  // 每一個音都有一層，而且是照音號排序的
  assert.deepEqual(hit.notes.map((n) => n.midi), [...KALIMBA_TINES].sort((a, b) => a - b));
  for (const n of hit.notes) {
    assert.equal(n.layers.length, 1);
    assert.equal(n.layers[0].vel, 0);
    assert.ok(n.layers[0].pcm.length > 0);
  }
});

test('a sampled:kalimba track renders the recordings, and needs them passed in', () => {
  const midi = parseMidi(smf(1, 480, [
    track([[0, ...tempo(500000)]]),
    track([[0, 0x90, 60, 100], [480, 0x80, 60, 0]]),
  ]));
  const pcm = new Float32Array(4000);
  pcm[0] = 1;
  const voices = { 'sampled:kalimba': { rate: SAMPLE_RATE, notes: [{ midi: 60, rate: SAMPLE_RATE, layers: [{ vel: 0, pcm }] }] } };
  const out = renderMidi(midi, { tracks: [{ instrument: 'sampled:kalimba' }], samples: voices });
  assert.ok(peak(out) > 0.05, 'the recorded tine is silent');
  // 沒有把錄音傳進去時，sampled:kalimba 是錯的（不是靜靜地換一個音色）
  assert.throws(() => renderMidi(midi, { tracks: [{ instrument: 'sampled:kalimba' }] }), /Unknown instrument/);
  // 代理音色（取樣還沒到時播的）是一般的合成音，不需要任何樣本
  const synth = renderMidi(midi, { tracks: [{ instrument: 'real:kalimba' }] });
  assert.ok(peak(synth) > 0.01 && peak(synth) < 1);
});

// 取樣來自 CC0 的 repository，網址寫下來是為了下次要重建時找得到來源。
test('the source and licence of the recordings are documented', () => {
  const readme = readFileSync(new URL('../samples/kalimba/README.md', import.meta.url), 'utf8');
  assert.match(readme, /CC0/);
  assert.match(readme, /Simone Piervergili/);
  assert.match(readme, /build-kalimba\.mjs/);
  assert.match(KALIMBA_SOURCE.repo, /SimonePiervergili-Kalimba/);
  assert.equal(Object.keys(KALIMBA_SOURCE.files).length, 17);
  // 來源檔名低一個八度，這件事一定要寫在資料裡（不然下一個人會照檔名重建，整個低八度）
  assert.equal(KALIMBA_SOURCE.files[60], 'C3.wav');
});
