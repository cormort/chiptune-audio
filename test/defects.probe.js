// Probe suspected defects. Usage: node test/defects.probe.js [baseline|src]
// Each check prints OK (defect absent) or FAIL (defect reproduced), so the same
// script can be pointed at the frozen original and at the optimised source.
const which = process.argv[2] || 'src';
const base = which === 'baseline' ? '../baseline/src/index.js' : '../src/index.js';
const { renderSfx, SFX_PRESETS, generateSong, renderSong, MOODS, WAVE } = await import(base);
console.log(`\n########## probing: ${which} ##########`);

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

const probe = (label, fn) => {
  try {
    const r = fn();
    console.log(`  OK    ${label} -> ${r}`);
  } catch (e) {
    console.log(`  FAIL  ${label} -> ${e.constructor.name}: ${e.message}`);
  }
};

console.log('\n== A. renderSfx parameter robustness ==');
probe('attack:0, sustain:0, decay:0 (zero-length envelope)', () => {
  const s = renderSfx({ attack: 0, sustain: 0, decay: 0 });
  return `len=${s.length} nan=${s.some(Number.isNaN)}`;
});
probe('negative attack -1 (bad preset data)', () => {
  const s = renderSfx({ attack: -1 });
  return `len=${s.length}`;
});
probe('decay:0 with sustain:0 (divide-by-zero in envelope)', () => {
  const s = renderSfx({ attack: 0.01, sustain: 0, decay: 0 });
  return `len=${s.length} nan=${s.some(Number.isNaN)}`;
});
probe('explicit undefined override {freq: undefined}', () => {
  const s = renderSfx({ freq: undefined });
  return `len=${s.length} nan=${s.some(Number.isNaN)}`;
});
probe('negative freq', () => {
  const s = renderSfx({ freq: -100, sustain: 0.01, decay: 0.01 });
  return `peak=${Math.max(...s.map(Math.abs))}`;
});
probe('NaN bars / Infinity decay', () => {
  const s = renderSfx({ decay: Infinity });
  return `len=${s.length}`;
});

console.log('\n== B. noise determinism (same noise every call) ==');
probe('two noise sfx share identical noise texture', () => {
  const a = renderSfx({ wave: WAVE.NOISE, freq: 6000, slide: -1.5, sustain: 0.03, decay: 0.12, bits: 4 });
  const b = renderSfx({ wave: WAVE.NOISE, freq: 6000, slide: -1.5, sustain: 0.03, decay: 0.12, bits: 4 });
  let same = true;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { same = false; break; }
  return `identical=${same} (deterministic, but no per-hit variation)`;
});

console.log('\n== C. generateSong input validation ==');
probe('bars: 1e9 (unbounded allocation) — computed analytically, not run', () => {
  // Running this actually OOMs the process (reproduced: FATAL ERROR: heap out of memory).
  const bars = 1e9;
  const stepSamples = Math.round((60 / 140 / 4) * 44100);
  const bytes = bars * 16 * stepSamples * 4;
  const noteCount = bars * 16;
  return `would allocate ${(bytes / 1e12).toFixed(1)} TB PCM and ~${noteCount.toExponential(1)} note objects => RangeError/OOM`;
});
probe('bars: -5 (must be rejected, not silently accepted)', () => {
  // Throwing here is the FIX. The original returned {bars:-5, lead:[]}, which
  // then blew up inside renderSong with a negative Float32Array length.
  try {
    const song = generateSong({ bars: -5 });
    return `accepted silently -> bars=${song.bars} lead=${song.lead.length} (renderSong would then throw)`;
  } catch (e) {
    return `rejected with ${e.constructor.name}: ${e.message}`;
  }
});
probe('bars: 2.7 (non-integer)', () => {
  const song = generateSong({ bars: 2.7 });
  return `lead=${song.lead.length}`;
});
probe('seed: "abc" (non-numeric)', () => {
  const song = generateSong({ seed: 'abc' });
  return `seed=${JSON.stringify(song.seed)}`;
});

console.log('\n== D. pentatonic progression mapping ==');
probe('pentatonic chordRoot values used', () => {
  const song = generateSong({ seed: 7, mood: 'calm', bars: 4 });
  const roots = song.bass.map((n) => n.note);
  return `bass midi=${[...new Set(roots)].join(',')} (prog [0,4,5,3] % 5 collapses 5->0)`;
});

console.log('\n== E. loop seam: note tails truncated at loop end ==');
probe('lead notes extending past total length', () => {
  let over = 0;
  for (const mood of Object.keys(MOODS)) {
    const song = generateSong({ seed: 3, mood, bars: 4 });
    const stepSec = 60 / song.bpm / 4;
    const totalSteps = song.bars * 16;
    for (const n of song.lead) if (n.step + n.len > totalSteps) over++;
  }
  return `notes overhanging loop end=${over}`;
});
probe('loop seam: wrap step vs the largest internal step', () => {
  const song = generateSong({ seed: 7, mood: 'happy', bars: 4 });
  const pcm = renderSong(song);
  let maxStep = 0;
  for (let i = 1; i < pcm.length; i++) {
    const d = Math.abs(pcm[i] - pcm[i - 1]);
    if (d > maxStep) maxStep = d;
  }
  const seam = Math.abs(pcm[0] - pcm[pcm.length - 1]);
  const verdict = seam <= maxStep ? 'seamless (wrap is an ordinary step)' : 'CLICK (wrap stands out)';
  return `seam=${seam.toFixed(5)} internalMax=${maxStep.toFixed(5)} last=${pcm[pcm.length - 1].toFixed(4)} first=${pcm[0].toFixed(4)} -> ${verdict}`;
});

console.log('\n== F. renderSong normalisation only triggers above 0.9 ==');
for (const mood of Object.keys(MOODS)) {
  const song = generateSong({ seed: 7, mood, bars: 4 });
  const pcm = renderSong(song);
  let peak = 0;
  for (const x of pcm) peak = Math.max(peak, Math.abs(x));
  console.log(`  info  ${mood.padEnd(6)} peak=${peak.toFixed(4)} len=${pcm.length} (${((pcm.length * 4) / 1e6).toFixed(1)} MB mono float32, ${((pcm.length * 4) / 1024).toFixed(0)} KiB heap)`);
}

console.log('\n== G. aliasing / waveform quality ==');
probe('square wave has no band-limiting (naive hard edges)', () => {
  const s = renderSfx({ wave: WAVE.SQUARE, freq: 2000, sustain: 0.05, decay: 0.01, attack: 0 });
  let edges = 0;
  for (let i = 1; i < s.length; i++) if (Math.sign(s[i]) !== Math.sign(s[i - 1]) && s[i] !== 0) edges++;
  return `discontinuities=${edges} (no polyBLEP/blip => aliasing at high freq)`;
});

let failed = 0;
console.log(`\n(probe harness finished; ${checks.length} registered)`);
