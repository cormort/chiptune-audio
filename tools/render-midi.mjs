// Render a MIDI file with the sampled grand (Salamander, 8 layers + release + sympathetic resonance)
// through the same export path as the page, without a browser.
//
//   node tools/render-midi.mjs score.mid score.mp3     # .wav, or anything else ffmpeg can encode
//
// Needs ffmpeg (decodes the samples, encodes non-.wav output). Pedal events in the MIDI drive the dampers.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMidi, renderMidiStereo, encodeWavStereo } from '../src/index.js';
import { prepareSampleChannels, prepareSample } from '../src/samples.js';
import { DYNAMIC_INSTRUMENTS } from '../src/dynamic-library.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('用法：node tools/render-midi.mjs <in.mid> <out.wav|out.mp3>');
  process.exit(1);
}
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RATE = 44100;

function decode(file) {
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', ROOT + file, '-f', 'f32le', '-ac', '2', '-ar', String(RATE), '-'], { maxBuffer: 1 << 28 });
  const st = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));  // copy: offset may be unaligned
  const n = st.length >> 1, l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < n; i++) { l[i] = st[2 * i]; r[i] = st[2 * i + 1]; }
  return { numberOfChannels: 2, length: n, sampleRate: RATE, getChannelData: (c) => (c ? r : l) };
}

const g = DYNAMIC_INSTRUMENTS.grand;
const notes = Object.entries(g.notes).map(([midi, layers]) => ({
  midi: +midi, rate: RATE,
  layers: layers.map((L) => { const p = prepareSampleChannels(decode(g.base + L.file)); return { vel: L.vel, pcm: p.mono, left: p.left, right: p.right }; }),
}));
const kit = Object.fromEntries(Object.entries(g.release.notes)
  .map(([midi, f]) => [midi, [{ vel: 0, gain: 1, pcm: [prepareSample(decode(g.release.base + f))] }]]));
const samples = { 'sampled:grand': { rate: RATE, notes, release: { rate: RATE, kit } } };

const midi = parseMidi(readFileSync(input));
const t0 = performance.now();
const { left, right } = renderMidiStereo(midi, { tracks: midi.tracks.map(() => ({ instrument: 'sampled:grand' })), samples });
const wav = encodeWavStereo(left, right);
if (/\.wav$/i.test(output)) writeFileSync(output, wav);
else execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', '-', '-b:a', '192k', output], { input: wav });
console.log(`${output}：${(left.length / RATE).toFixed(0)} 秒，算了 ${((performance.now() - t0) / 1000).toFixed(1)} 秒`);
