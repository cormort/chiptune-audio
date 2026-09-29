// Benchmark harness. Usage: node test/bench.js [baseline|src]
//
// Measures the two hot paths: renderSfx (one sound effect) and renderSong (the
// whole-loop pre-render that runs on every playMusic call).
//
// V8 tiers functions up mid-run, which made a single averaged batch bimodal
// (0.10 ms vs 0.26 ms for the same render). So: warm up hard, then take the
// MINIMUM across several batches, which is the standard way to report optimised
// throughput and is stable across passes.
const which = process.argv[2] || 'src';
const mod = await import(`../${which === 'baseline' ? 'baseline/src' : 'src'}/index.js`);
const { renderSfx, SFX_PRESETS, generateSong, renderSong, MOODS } = mod;

// Fast path (single sounds) gets many iterations; the song path is ~500x more
// expensive per call, so it gets proportionally fewer or the run never finishes.
const FAST = { warmup: 60, batches: 10, iters: 40 };
const SLOW = { warmup: 3, batches: 5, iters: 3 };

const timeIt = (label, fn, cfg) => {
  for (let i = 0; i < cfg.warmup; i++) fn();
  let best = Infinity;
  for (let b = 0; b < cfg.batches; b++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < cfg.iters; i++) fn();
    const t1 = process.hrtime.bigint();
    const ms = Number(t1 - t0) / 1e6 / cfg.iters;
    if (ms < best) best = ms;
  }
  console.log(`  ${label.padEnd(36)} ${best.toFixed(3)} ms/op`);
  return best;
};

const json = process.argv.includes('--json');
const results = {};
const time = (label, fn, cfg = FAST) => {
  const ms = timeIt(label, fn, cfg);
  results[label] = Number(ms.toFixed(4));
  return ms;
};

console.log(`\n=== benchmark: ${which} ===`);
console.log(`  node ${process.version} | ${process.arch} | fast=${FAST.warmup}+${FAST.batches}x${FAST.iters} slow=${SLOW.warmup}+${SLOW.batches}x${SLOW.iters}`);

console.log('\n-- renderSfx (one sound effect) --');
let totalSfx = 0;
for (const name of Object.keys(SFX_PRESETS)) totalSfx += time(`preset:${name}`, () => renderSfx(SFX_PRESETS[name]));
totalSfx += time('custom:slide+vibrato+arp', () =>
  renderSfx({ freq: 500, slide: -2, vibDepth: 0.03, vibRate: 30, arpMult: 1.5, arpTime: 0.07, decay: 0.3 }));

console.log('\n-- renderSong (full loop pre-render, 8 bars) --');
let totalSong = 0;
for (const mood of Object.keys(MOODS)) {
  const song = generateSong({ seed: 7, mood, bars: 8 });
  totalSong += time(`song:${mood} 8b`, () => renderSong(song), SLOW);
}

console.log('\n-- generateSong (composition only, no DSP) --');
let s = 0;
time('generateSong 8 bars', () => { generateSong({ seed: (s = (s + 1) % 1000), mood: 'happy', bars: 8 }); });

console.log(`\n  TOTAL sfx set (${Object.keys(SFX_PRESETS).length + 1} sounds): ${totalSfx.toFixed(2)} ms`);
console.log(`  TOTAL 4 songs x 8 bars:                     ${totalSong.toFixed(2)} ms`);
console.log(`  heap used: ${(process.memoryUsage().heapUsed / 1048576).toFixed(1)} MB\n`);

if (json) {
  results.__totalSfx = Number(totalSfx.toFixed(4));
  results.__totalSong = Number(totalSong.toFixed(4));
  console.log('JSON ' + JSON.stringify(results));
}
