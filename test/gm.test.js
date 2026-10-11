import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gmInstrument, autoInstruments, medianNote, outOfRange, MAX_SAMPLE_SHIFT,
  resolveInstrument, SAMPLE_LIBRARY, SAMPLE_PREFIX, parseMidi,
} from '../src/index.js';
import { track, smf, tempo } from './smf.js';

const isSampled = (v) => v.startsWith(SAMPLE_PREFIX);
const usable = (v) => v === 'drums'
  || (isSampled(v) && !!SAMPLE_LIBRARY[v.slice(SAMPLE_PREFIX.length)])
  || !!resolveInstrument(v);

test('every General MIDI program lands on a voice that actually exists', () => {
  // 一張對照表最容易錯的地方是「有一格漏了」或「名字打錯」——那種錯在頁面上只會
  // 表現成「這軌怎麼沒聲音」或「選單跳回上一個」。所以 128 個 program 全掃一遍。
  for (let p = 0; p < 128; p++) {
    for (const notes of [null, [{ note: 40 }], [{ note: 60 }], [{ note: 84 }]]) {
      const v = gmInstrument(p, { notes });
      assert.ok(usable(v.instrument), `program ${p} → ${v.instrument} is not a real voice`);
      assert.ok(v.family, `program ${p} has no family label`);
      assert.equal(v.sampled, isSampled(v.instrument), `program ${p} misreports sampled`);
    }
    // 不下載的那條路（CLI）永遠不能給出 sampled:，否則 Node 端會直接爆掉
    const dry = gmInstrument(p, { samples: false });
    assert.ok(!isSampled(dry.instrument), `program ${p} → ${dry.instrument} needs a download`);
    assert.ok(usable(dry.instrument), `program ${p} → ${dry.instrument} (no samples) is not usable`);
  }
});

test('the familiar programs map to the obvious instrument', () => {
  const at = (p, note) => gmInstrument(p, { notes: note === undefined ? null : [{ note }] }).instrument;
  assert.equal(at(0), 'sampled:grand', 'acoustic grand piano');
  assert.equal(at(16), 'sampled:organ');
  assert.equal(at(24), 'sampled:guitar-nylon');
  assert.equal(at(25), 'sampled:guitar-acoustic');
  assert.equal(at(30), 'sampled:guitar-electric');
  assert.equal(at(32), 'sampled:contrabass', 'GM 32 is an acoustic bass');
  assert.equal(at(33), 'sampled:bass-electric');
  assert.equal(at(40), 'sampled:violin');
  assert.equal(at(42), 'sampled:cello');
  assert.equal(at(43), 'sampled:contrabass');
  assert.equal(at(46), 'sampled:harp');
  assert.equal(at(56), 'sampled:trumpet');
  assert.equal(at(57), 'sampled:trombone');
  assert.equal(at(58), 'sampled:tuba');
  assert.equal(at(60), 'sampled:french-horn');
  assert.equal(at(64), 'sampled:saxophone');
  assert.equal(at(70), 'sampled:bassoon');
  assert.equal(at(71), 'sampled:clarinet');
  assert.equal(at(73), 'sampled:flute');
  assert.equal(at(12), 'sampled:xylophone');
});

test('families with no recording stay synthesis, and percussion stays drums', () => {
  const at = (p) => gmInstrument(p, { notes: [{ note: 60 }] });
  // 合成音色本來就不是真樂器，硬套一個錄音上去只會更假。
  assert.equal(at(80).instrument, 'saw', 'a synth lead is a synth lead');
  assert.equal(at(88).instrument, 'real:choir', 'synth pads borrow the choir voice');
  // 沒有取樣的家族退到寫實合成
  assert.equal(at(8).instrument, 'real:bell');
  assert.equal(at(10).instrument, 'real:musicbox');
  assert.equal(at(11).instrument, 'real:vibraphone');
  assert.equal(at(21).instrument, 'real:accordion');
  assert.equal(at(52).instrument, 'real:choir');
  assert.equal(at(68).instrument, 'real:sax', 'an oboe is at least a reed');
  // 打擊樂：47 定音鼓與 112-119 沒有取樣鼓組，先走晶片鼓（而不是假裝是別的樂器）
  assert.equal(at(47).instrument, 'drums');
  assert.equal(at(112).instrument, 'drums');
  assert.equal(at(119).instrument, 'drums');
});

test('a family that spans several instruments is picked by register', () => {
  const strings = (note) => gmInstrument(48, { notes: [{ note }] }).instrument;
  assert.equal(strings(36), 'sampled:contrabass');
  assert.equal(strings(47), 'sampled:contrabass');
  assert.equal(strings(48), 'sampled:cello');
  assert.equal(strings(59), 'sampled:cello');
  assert.equal(strings(60), 'sampled:violin');
  assert.equal(strings(84), 'sampled:violin');
  // 同一個家族用 median 而不是平均值：一個低音長音加幾個高音裝飾不該把整軌拉上去。
  // 但音域也要蓋得住——40 到 96 是 4.7 個八度，家族裡沒有任何一把獨奏樂器蓋得住，
  // 所以正確答案是家族的合成弦樂（把 C7 用小提琴的錄音拉高 37 個半音才是壞掉）。
  assert.equal(gmInstrument(48, { notes: [{ note: 40 }, { note: 40 }, { note: 40 }, { note: 96 }] }).instrument, 'real:strings');
  // 蓋得住的低音長音還是低音提琴
  assert.equal(gmInstrument(48, { notes: [{ note: 40 }, { note: 40 }, { note: 40 }, { note: 56 }] }).instrument, 'sampled:contrabass');
  // 沒有音符時取家族中間的一項，不要挑到極端
  assert.equal(gmInstrument(48, { notes: [] }).instrument, 'sampled:cello');
  assert.equal(strings(40), gmInstrument(44, { notes: [{ note: 40 }] }).instrument, '44 震音弦樂跟 48 弦樂群同一套規則');

  const brass = (note) => gmInstrument(61, { notes: [{ note }] }).instrument;
  assert.equal(brass(40), 'sampled:tuba');
  assert.equal(brass(55), 'sampled:trombone');
  assert.equal(brass(70), 'sampled:trumpet');
});

test('samples: false keeps the same instrument, minus the download', () => {
  for (let p = 0; p < 128; p++) {
    const wet = gmInstrument(p, { notes: [{ note: 60 }] });
    if (!wet.sampled) continue;
    const dry = gmInstrument(p, { notes: [{ note: 60 }], samples: false });
    const name = wet.instrument.slice(SAMPLE_PREFIX.length);
    assert.equal(dry.instrument, SAMPLE_LIBRARY[name].synth, `program ${p} lost its voice without samples`);
  }
});

test('a nonsense program number falls back instead of throwing', () => {
  for (const p of [undefined, null, NaN, -5, 999, 12.6, '42']) {
    const v = gmInstrument(p, { notes: [{ note: 60 }] });
    assert.ok(usable(v.instrument), `program ${JSON.stringify(p)} → ${v.instrument}`);
  }
  assert.equal(gmInstrument(999).instrument, gmInstrument(127).instrument, 'above the range clamps to the top');
  assert.equal(gmInstrument(-5).instrument, gmInstrument(0).instrument, 'below the range clamps to the bottom');
});

test('medianNote reads a part the way a player would', () => {
  assert.equal(medianNote([{ note: 60 }, { note: 64 }, { note: 67 }]), 64);
  assert.equal(medianNote([{ note: 40 }, { note: 40 }, { note: 96 }]), 40);
  assert.equal(medianNote([]), null);
  assert.equal(medianNote(null), null);
  assert.equal(medianNote(undefined), null);
});

test('autoInstruments answers per track, in order, with channel 10 as drums', () => {
  const midi = parseMidi(smf(1, 480, [
    track([[0, ...tempo(500000)]]),
    track([[0, 0xc0, 40], [0, 0x90, 55, 100], [240, 0x80, 55, 0]]),      // program 40 = violin
    track([[0, 0xc0, 32], [0, 0x90, 40, 100], [240, 0x80, 40, 0]]),      // program 32 = acoustic bass
    track([[0, 0x99, 36, 100], [240, 0x89, 36, 0]]),                     // channel 10
  ]));
  const plan = autoInstruments(midi);
  assert.equal(plan.length, midi.tracks.length, 'one suggestion per track');
  // 第 10 聲道有取樣鼓組時走真實鼓組（sampled:kit），CLI 那條路才是晶片鼓
  assert.deepEqual(plan.map((p) => p.instrument), ['sampled:violin', 'sampled:contrabass', 'sampled:kit']);
  assert.deepEqual(plan.map((p) => p.track), [1, 2, 3]);
  assert.equal(plan[2].family.includes('第 10 聲道'), true, 'the drum track says why it is drums');

  const dry = autoInstruments(midi, { samples: false }).map((p) => p.instrument);
  assert.deepEqual(dry, ['real:violin', 'real:bass', 'drums'], 'the CLI path keeps the instrument, not the recording');
  assert.equal(plan[2].sampled, true, 'the real kit is a recording: it has to be loaded before it plays');
  assert.deepEqual(autoInstruments(null), [], 'no file, no suggestions');
});

test('the console applies the plan on import and on demand', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../page/console.js', import.meta.url), 'utf8');
  for (const id of ['midiAuto', 'midiAutoNow']) {
    assert.ok(html.includes(`id="${id}"`), `index.html has no #${id}`);
  }
  assert.ok(script.includes('autoInstruments('), 'page/console.js never asks for the mapping');
  assert.ok(/\$\('midiAuto'\)\.checked/.test(script), 'the import path ignores the auto switch');
  assert.ok(script.includes("$('midiAutoNow').onclick"), 'the re-voice button is not wired');
  assert.ok(script.includes("$('midiAutoNow').disabled = !has"), 'the button never gets disabled');
  // 選音色不該順便下載：抓樣本只發生在播放／匯出（ensureSamples）
  const importPath = script.slice(script.indexOf('async function readMidiFile'), script.indexOf('function instrumentShort'));
  assert.ok(!importPath.includes('load('), 'importing must not start downloading samples');
});

// 取樣庫的音域是有限的（長笛 C4–C7、低音提琴 F#1–B3）。配音只看 GM 編號與音域
// 中位數的話，一個「program 43 但旋律坐在 D#4」的軌會被配到低音提琴，然後每個音
// 被拉高最多 16 個半音——那不是低音提琴，是變聲怪。這兩個案例都來自真實檔案：
// Deep Wilderness 的旋律軌與 Rygar 的長笛軌。
test('a voice whose recordings cannot cover the part falls back instead of shifting', () => {
  const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => ({ note: lo + i }));
  // Deep Wilderness 旋律：program 43（低音提琴，樣本 F#1–B3），實際 F#3–D#5
  const melody = range(54, 75);
  const deep = gmInstrument(43, { notes: melody });
  assert.equal(deep.instrument, 'real:bass', 'a contrabass lifted 16 semitones is not a contrabass');
  assert.equal(deep.sampled, false);
  assert.equal(deep.outOfRange, 16, 'the measurement has to be published');
  assert.equal(gmInstrument(43, { notes: melody, samples: false }).instrument, 'real:bass');
  // 蓋得住的低音提琴照樣用錄音
  const low = gmInstrument(43, { notes: range(30, 55) });
  assert.equal(low.instrument, 'sampled:contrabass');
  assert.equal(low.sampled, true);
  assert.equal(low.outOfRange, 0);
  // 掉出範圍 2 個半音還在容忍值內：照樣用錄音，但把差距報出來
  assert.equal(gmInstrument(43, { notes: range(28, 55) }).outOfRange, 2);
  // Rygar 長笛：program 73，樣本 C4–C7，旋律掉到 F#3（低 6 個半音）
  const flute = gmInstrument(73, { notes: range(54, 75) });
  assert.equal(flute.instrument, 'real:flute', 'a flute slowed six semitones is a bass flute');
  assert.equal(flute.outOfRange, 6);
  assert.equal(gmInstrument(73, { notes: range(60, 84) }).instrument, 'sampled:flute');
  // 3 個半音以內仍然用錄音（小提琴最高到 C7，B3 只是低一點）
  const viola = gmInstrument(41, { notes: range(52, 72) });
  assert.equal(viola.instrument, 'sampled:violin');
  assert.equal(viola.outOfRange, 3);
  assert.equal(MAX_SAMPLE_SHIFT, 3, 'the tolerance is part of the contract');
});

test('a family with several members lends one that fits the register', () => {
  // GM 48-51 弦樂群：中位數在 C4 以上給小提琴，但音域掉到低音提琴的地盤時，
  // 由同一個家族裡蓋得住的成員接手（而不是硬用小提琴拉 20 個半音以下）。
  const lowPad = gmInstrument(49, { notes: [{ note: 64 }, { note: 36 }, { note: 40 }, { note: 43 }] });
  assert.equal(lowPad.sampled, true, 'a low string pad should still be a recording');
  assert.ok(['sampled:cello', 'sampled:contrabass'].includes(lowPad.instrument), `got ${lowPad.instrument}`);
  const highPad = gmInstrument(49, { notes: [{ note: 64 }, { note: 67 }, { note: 72 }] });
  assert.equal(highPad.instrument, 'sampled:violin');
  assert.equal(highPad.outOfRange, 0);
  // 整個家族都蓋不到（極端音域）就退回合成弦樂，而不是變速
  const tooLow = gmInstrument(49, { notes: [{ note: 12 }, { note: 14 }] });
  assert.equal(tooLow.instrument, 'real:strings', 'nothing in the string family reaches C0');
  assert.equal(tooLow.sampled, false);
  assert.ok(tooLow.outOfRange > MAX_SAMPLE_SHIFT);
});

test('outOfRange measures the part against the recorded range', () => {
  const flute = SAMPLE_LIBRARY.flute;                 // C4-C7
  assert.equal(outOfRange(flute, [{ note: 60 }, { note: 96 }]), 0);
  assert.equal(outOfRange(flute, [{ note: 48 }]), 12);
  assert.equal(outOfRange(flute, [{ note: 108 }]), 12);
  assert.equal(outOfRange(flute, []), 0, 'no notes means nothing to fit');
  assert.equal(outOfRange(null, [{ note: 60 }]), 0);
  assert.equal(outOfRange(flute, null), 0);
});
