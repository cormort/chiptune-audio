import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMidi, renderMidi, renderMidiStereo, encodeWav, encodeWavStereo, SAMPLE_RATE,
  prepareSampleChannels,
} from '../src/index.js';
import { track, smf, tempo } from './smf.js';

const midiWith = (note = 60) => parseMidi(smf(1, 480, [
  track([[0, ...tempo(500000)]]),
  track([[0, 0x90, note, 100], [480, 0x80, note, 0]]),
]));
const ramp = (n, f) => Float32Array.from({ length: n }, (_, i) => f(i));
const sideDb = (left, right) => {
  let sm = 0, ss = 0;
  for (let i = 0; i < left.length; i++) {
    const m = (left[i] + right[i]) / 2;
    const s = (left[i] - right[i]) / 2;
    sm += m * m; ss += s * s;
  }
  return 10 * Math.log10((ss || 1e-20) / (sm || 1e-20));
};

// 為什麼要有立體：Salamander 鋼琴的兩個聲道是兩支不同視角的麥克風，混成單聲道不是
// 「少一點寬度」而是**部分抵消**（量到 −5 dB 而且每個音被不同地重塑）。所以引擎要能
// 把取樣自己的左右聲道一路帶到播放與匯出。
test('a stereo recording renders into both channels, a mono one into both alike', () => {
  const L = ramp(1200, (i) => Math.sin(i / 6) * 0.6);
  const R = ramp(1200, (i) => Math.sin(i / 6 + 1.1) * 0.4);
  const stereo = { 'sampled:grand': { rate: SAMPLE_RATE, notes: [{ midi: 60, rate: SAMPLE_RATE, layers: [{ vel: 0, pcm: L, left: L, right: R }] }] } };
  const out = renderMidiStereo(midiWith(), { tracks: [{ instrument: 'sampled:grand' }], samples: stereo });
  assert.ok(out.left.length === out.right.length && out.left.length > 0);
  assert.ok(sideDb(out.left, out.right) > -6, 'the recording\'s own stereo image must survive the render');
  // 單聲道版本仍然回傳 Float32Array（不能因為加了立體就改掉原本的介面）
  const mono = renderMidi(midiWith(), { tracks: [{ instrument: 'sampled:grand' }], samples: stereo });
  assert.ok(mono instanceof Float32Array);
  assert.ok(Math.max(...mono.map(Math.abs)) > 0.05);

  // 單聲道來源在立體輸出裡左右一樣（單聲道相容）
  const M = ramp(1200, (i) => Math.sin(i / 5) * 0.5);
  const one = { 'sampled:flute': { rate: SAMPLE_RATE, notes: [{ midi: 60, rate: SAMPLE_RATE, layers: [{ vel: 0, pcm: M }] }] } };
  const out1 = renderMidiStereo(midiWith(), { tracks: [{ instrument: 'sampled:flute' }], samples: one });
  let diff = 0;
  for (let i = 0; i < out1.left.length; i++) diff = Math.max(diff, Math.abs(out1.left[i] - out1.right[i]));
  assert.equal(diff, 0, 'a mono source must land identically in both channels');
  // 合成音色也一樣是兩邊相同，而且峰值上限 0.9 對兩個聲道一起算
  const synth = renderMidiStereo(midiWith(69), { tracks: [{ instrument: 'real:strings' }] });
  let peakL = 0, peakR = 0;
  for (let i = 0; i < synth.left.length; i++) { peakL = Math.max(peakL, Math.abs(synth.left[i])); peakR = Math.max(peakR, Math.abs(synth.right[i])); }
  assert.ok(peakL <= 0.9 && peakR <= 0.9 && peakL > 0.05);
});

test('encodeWavStereo writes a real 16-bit stereo file, interleaved', () => {
  const L = Float32Array.from([1, -1, 0.5]);
  const R = Float32Array.from([0, 1, -0.5]);
  const bytes = encodeWavStereo(L, R, 48000);
  const v = new DataView(bytes.buffer);
  assert.equal(bytes.length, 44 + 3 * 4);
  assert.equal(v.getUint16(22, true), 2, 'two channels');
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint32(28, true), 48000 * 4, 'byte rate');
  assert.equal(v.getUint16(32, true), 4, 'block align');
  assert.equal(v.getUint32(40, true), 3 * 4, 'data size');
  assert.equal(v.getInt16(44, true), 0x7fff, 'L of frame 0');
  assert.equal(v.getInt16(46, true), 0, 'R of frame 0');
  assert.equal(v.getInt16(48, true), -0x8000, 'L of frame 1');
  assert.equal(v.getInt16(50, true), 0x7fff, 'R of frame 1');
  // 超出範圍會被夾住（不是繞回來）
  const clipped = encodeWavStereo(Float32Array.from([4, -4]), Float32Array.from([0, 0]), 44100);
  const cv = new DataView(clipped.buffer);
  assert.equal(cv.getInt16(44, true), 0x7fff);
  assert.equal(cv.getInt16(48, true), -0x8000);
  assert.throws(() => encodeWavStereo([1], [1]), TypeError, 'it must be Float32Array');
  // 單聲道那支沒有被改壞
  assert.equal(new DataView(encodeWav(Float32Array.from([1, 0]), 44100).buffer).getUint16(22, true), 1);
});

// 內建鋼琴是唯一立體聲的樂器（16 MB 的力度層裡只有它保留左右），這件事要能被檢查到，
// 不然哪天有人再跑一次 build 把它壓成單聲道，沒有人會發現。直接讀 MP3 的 frame header
// 拿聲道模式（bit 6-7：00/01/10 = 兩聲道、11 = 單聲道），不需要 ffmpeg。
const mp3Channels = (bytes) => {
  for (let i = 0; i + 4 < bytes.length && i < 4096; i++) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue;
    const mode = (bytes[i + 3] >> 6) & 0x3;
    return mode === 3 ? 1 : 2;
  }
  return 0;
};

test('the bundled grand piano ships stereo, and the other instruments stay mono', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (rel) => new Uint8Array(readFileSync(new URL(`../${rel}`, import.meta.url)));
  assert.equal(mp3Channels(read('samples/velocity/grand/60-m1.mp3')), 2, 'the piano must keep its two microphones');
  assert.equal(mp3Channels(read('samples/velocity/grand/45-p.mp3')), 2);
  assert.equal(mp3Channels(read('samples/velocity/grand-release/60.mp3')), 2, 'the damper samples too');
  // 其餘樂器（VSCO）留單聲道：相加只差 0.6–2.3 dB，留立體會讓 15 MB 變成 27 MB
  assert.equal(mp3Channels(read('samples/velocity/violin/55-p.mp3')), 1);
  assert.equal(mp3Channels(read('samples/velocity/clarinet/53-p.mp3')), 1);
  assert.equal(mp3Channels(read('samples/flute/60-a.mp3')), 1);
  assert.equal(mp3Channels(read('samples/drums/36-v1-r1.mp3')), 1);
});
