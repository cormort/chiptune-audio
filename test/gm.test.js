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
  // 銅管群（61-63）沒有單一樂器蓋得住整個音域，所以照中位數挑家族成員
  const brass = (note) => gmInstrument(61, { notes: [{ note }] }).instrument;
  assert.equal(brass(40), 'sampled:tuba');
  assert.equal(brass(55), 'sampled:trombone');
  assert.equal(brass(70), 'sampled:trumpet');
  // 弦樂群（44-45、48-51）現在有自己的分軌錄音（小提琴組＋中提琴組＋大提琴組），
  // 不再借獨奏樂器——一條寬廣的弦樂軌會同時用到三組（低音由大提琴組、高音由小提琴組）
  for (const program of [44, 48, 51]) {
    assert.equal(gmInstrument(program, { notes: [{ note: 36 }, { note: 60 }, { note: 84 }] }).instrument, 'sampled:strings');
  }
  assert.equal(gmInstrument(48, { notes: [] }).instrument, 'sampled:strings', 'no notes still picks the family voice');
  assert.equal(gmInstrument(48, { notes: [{ note: 60 }], samples: false }).instrument, 'real:strings', 'the CLI path stays synth');
});

test('a family with several members lends one that fits the register', () => {
  // 銅管群：中位數在 50 以下給低音號、58 以下給長號、其餘小號；音域蓋不到時借同家族
  // 蓋得住的成員（低音號蓋不到的高音交給小號），整個家族都蓋不到才用合成銅管。
  const low = gmInstrument(61, { notes: [{ note: 40 }, { note: 44 }] });
  assert.equal(low.instrument, 'sampled:tuba');
  assert.equal(low.outOfRange, 0);
  const wide = gmInstrument(61, { notes: [{ note: 40 }, { note: 40 }, { note: 40 }, { note: 96 }] });
  assert.equal(wide.instrument, 'real:brass', 'nothing in the brass family spans five octaves');
  assert.equal(wide.sampled, false);
  const high = gmInstrument(61, { notes: [{ note: 62 }, { note: 66 }] });
  assert.equal(high.instrument, 'sampled:trumpet');
  // 比小號的錄音還高（78-80）時，家族裡沒有人蓋得住 → 合成銅管，而不是硬拉 8 個半音
  assert.equal(gmInstrument(61, { notes: [{ note: 78 }, { note: 80 }] }).instrument, 'real:brass');
});

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

test('outOfRange measures the part against the recorded range', () => {
  const flute = SAMPLE_LIBRARY.flute;                 // C4-C7
  assert.equal(outOfRange(flute, [{ note: 60 }, { note: 96 }]), 0);
  assert.equal(outOfRange(flute, [{ note: 48 }]), 12);
  assert.equal(outOfRange(flute, [{ note: 108 }]), 12);
  assert.equal(outOfRange(flute, []), 0, 'no notes means nothing to fit');
  assert.equal(outOfRange(null, [{ note: 60 }]), 0);
  assert.equal(outOfRange(flute, null), 0);
});
