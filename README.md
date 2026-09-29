# chiptune-audio

Zero-dependency 8-bit sound effect and music engine for browser games, built on the Web Audio API.

- **SFX**: sfxr-style parametric synthesis (square / saw / triangle / noise, pitch slide, arpeggio, vibrato, bit-crush) with 24 presets: `coin jump laser hit explosion powerup select gameover win shoot blip click hurt pickup heal levelup door step bounce alarm teleport charge error splash`.
- **Music**: seeded procedural loops (square lead + triangle bass + noise drums). Same seed and mood always give the same song. Moods: `happy`, `calm`, `tense`, `sad`, `heroic`, `playful`, `dreamy`, `mysterious`, `spooky`, `boss`, `groovy`.
- The synthesis core renders to plain `Float32Array`, so it is testable in Node; only `ChiptuneAudio` touches Web Audio.

**This is an 8-bit-*flavoured* engine, not a chip emulator.** The oscillators are naive
(hard-edged square/saw, no band-limiting) and the voices are summed linearly. Real hardware
does neither: the NES 2A03 mixes its two pulse channels *non-linearly* and passes the result
through three analog filters, and its duty sequences are stepped tables rather than an ideal
square. If you need hardware-accurate timbre, see [Alternatives](#alternatives) below.

## Usage

```js
import { ChiptuneAudio } from './src/index.js';

const audio = new ChiptuneAudio({ volume: 0.6 });

// Call from a user gesture (click/keydown) to satisfy autoplay policy.
button.onclick = () => {
  audio.playMusic({ seed: 42, mood: 'tense' });
  audio.playSfx('coin');
  audio.playSfx({ freq: 500, slide: -2, decay: 0.2 }); // custom params
};

audio.setMuted(true); audio.setVolume(0.3); audio.stopMusic();
```

### Avoiding the first-play hitch

Rendering an 8-bar loop costs ~15-25 ms (it used to be ~40-60 ms). Do it behind a loading
screen rather than on the first `playMusic()`:

```js
audio.preloadMusic({ seed: 42, mood: 'tense' }); // renders + caches, does not play
// ...
audio.playMusic({ seed: 42, mood: 'tense' });     // cache hit, starts immediately
```

`playSfx` caches by *normalised parameter values*, so custom-parameter sounds are rendered
once and reused, not re-synthesised on every call.

### Playback options

```js
audio.playSfx('coin', { pan: -0.5, rate: 1.25, gain: 0.8 });
```

`rate` reuses one rendered buffer at a different pitch — useful for footsteps, coin combos,
or a rising pitch as a timer runs down.

### Mixer

```js
audio.setMix({ sfx: 0.8, music: 0.5 });   // buses, applied instantly
audio.setMix({ drums: 0, lead: 0.7 });    // music parts: re-renders the loop, resumes in place
renderSong(song, { mix: { bass: 0 } });   // same weighting when rendering offline
```

Levels are 0..1. Part levels are baked into the rendered loop (one re-render, ~15-25 ms),
so change them on slider release rather than on every input event.

### Keyboard instruments

```js
import { instrumentNote } from './src/index.js';

const note = audio.playNote(instrumentNote('organ', 60)); // key down: C4 on the organ
note.release(0.08);                                       // key up: fade out
```

Instruments: `square pulse25 pulse12 triangle saw organ flute strings brass piano pluck bell`.

### MIDI remix

```js
import { parseMidi } from './src/index.js';

const midi = parseMidi(await file.arrayBuffer());   // format 0/1, throws on bad input
audio.playMidi(midi, {
  tracks: [{ instrument: 'saw' }, { mute: true }], // per track: instrument, volume, mute, transpose
  speed: 1.25,
  loop: true,
});
```

Channel 10 is rendered as chip drums. Renders are capped at 5 minutes.

### Lifecycle

```js
audio.stopAllSfx();          // scene change
audio.setFilter(11000);      // opt-in master lowpass, tames oscillator aliasing
await audio.dispose();       // closes the AudioContext; call it in an SPA
```

Construct with `new ChiptuneAudio({ filter: { type: 'lowpass', freq: 11000 } })` to enable the
master filter from the start. It is off by default so existing sounds are unchanged.

## 控制台（手動操作）

`index.html` 是手動試聽與調參的控制台：選預設音效、拉滑桿即時聽、看波形，
按「複製參數」把 JSON 貼進遊戲（`audio.playSfx({...})` 或加進 `SFX_PRESETS`）；
音樂可選情緒、種子、小節數。「MIDI 重新混音」可匯入 .mid 檔，每個軌道換成晶片樂器、調音量與速度；
「混音」區有音效、音樂匯流排與主旋律／貝斯／鼓組推桿，含靜音與獨奏。

`keyboard.html` 是電子琴：12 種樂器，按住發聲、放開停止，可彈和弦；
可用滑鼠、觸控或電腦鍵盤（Z–M / Q–U），琴鍵標示可切換電腦按鍵、音名或簡譜。ES module 不能用 `file://` 開，要用 HTTP 服務：

```bash
npx serve .        # 或 python3 -m http.server
```

## Tests

```bash
npm test              # node --test test/*.test.js
npm run test:direct   # same tests in one process (for sandboxes that block the runner)
npm run bench         # micro-benchmarks
npm run probe         # defect probe, prints OK/FAIL per known failure mode
```

`test/parity.test.js` pins the composition output bit-for-bit against the frozen original in
`baseline/`, so a future refactor cannot silently change what a given seed produces.
`test/bench.js baseline` measures the original for comparison.

## What changed in 0.2.0

The public API is additive; existing calls keep working. Songs are unchanged: `generateSong`
is bit-identical to 0.1.0 for every seed/mood/bars (enforced by a test).

**Fixed**

| Was | Now |
| --- | --- |
| `renderSfx({ attack: -1 })` threw `RangeError: Invalid typed array length: -35280` | Parameters are normalised and clamped; nothing reaches the allocator unchecked |
| `renderSfx({ decay: Infinity })` threw `RangeError: Invalid typed array length: Infinity` | Clamped, and one sound can never exceed `MAX_SFX_SECONDS` (30 s) |
| `renderSfx({ freq: undefined })` silently rendered a DC-biased constant (NaN phase) | `undefined`/`NaN` fall back to the default |
| `freq: -100` clamped to 0 Hz and emitted a loud DC offset | `freq <= 0` renders silence |
| `generateSong({ bars: 1e9 })` killed the process (OOM) | Validated to an integer 1..`MAX_BARS` (128), throws a descriptive `RangeError` |
| `generateSong({ bars: 2.7 })` produced 3 bars of notes for a 2.7-bar buffer | Floored, and the note stream matches the buffer length |
| Non-integer / negative `bars` reached `new Float32Array(...)` and threw | Rejected up front |
| Every noise voice shared `mulberry32(1)`, so all drums were identical clones | `seed` is a parameter; `renderSong` advances it per hit (still deterministic) |
| Note tails overrunning the loop point were truncated → click (5.4× and 9.8× the median step on `happy`/`tense`) | The buffer is padded and the overhang folded back onto the loop start |
| Custom-parameter SFX were re-synthesised on every `playSfx` call | Cached by normalised parameter values (LRU, bounded) |
| Buffers were always rendered at 44100 Hz even in a 48 kHz context | Rendered at the AudioContext rate, so nothing is resampled |
| `setVolume`/`setMuted` jumped the gain, causing zipper noise | Ramped with `setTargetAtTime` |
| The `AudioContext` could never be released | `dispose()` |
| Volume of `NaN`, unknown-AudioContext crashes | Validated / descriptive error |

**Added**: `renderSfxInto`, `normalizeSfx`, `MAX_SFX_SECONDS`, `MAX_BARS`, `STEPS_PER_BAR`,
`preloadMusic`, `stopAllSfx`, `resume`, `setFilter`, `dispose`, per-play `pan`/`rate`/`gain`,
`playSfx`/`playMusic` return values, `opts.sampleRate`, `types/index.d.ts`, `LICENSE`.

**Performance** (`node test/bench.js`, Node 24, min-of-batches after warm-up):

| | 0.1.0 | 0.2.0 | |
| --- | --- | --- | --- |
| All 10 SFX renders | 6.41 ms | 1.80 ms | **3.6×** |
| 4 moods × 8-bar loop render | 174.8 ms | 62.7 ms | **2.8×** |
| `renderSong('happy', 8 bars)` | 38.3 ms | 14.1 ms | **2.7×** |
| `explosion` preset | 0.996 ms | 0.232 ms | 4.3× |

The wins come from: mixing voices straight into one buffer instead of allocating and copying
one array per note (~220 allocations/song removed); replacing the per-sample `Math.pow` pitch
sweep with a running multiply; replacing per-sample `Math.sin` vibrato with a 2048-entry
table; and advancing the envelope by a step instead of recomputing `t`.

## Alternatives

Nothing found in the JS chiptune ecosystem replicates this project's combination of *seeded
procedural composition* + *zero dependencies* + *no asset pipeline* + *offline*. The
permissively-licensed pure-JS SFX engines (ZzFX, jsfxr, Sonant-X) all use the same
offline-PCM → `AudioBuffer` architecture, so none of them fixes the main-thread render cost,
and none of them generates music from a seed.

| Project | License | Relationship |
| --- | --- | --- |
| [algo-chip](https://github.com/abagames/algo-chip) | MIT | Closest conceptual twin: seeded procedural BGM, 2×square + triangle + noise, near-identical SFX taxonomy. Runs in an AudioWorklet so it does not block the main thread — but it requires copying worklet asset files (or loading them from a third-party CDN). **Reference architecture; not a drop-in.** |
| [ZzFX](https://github.com/KilledByAPixel/ZzFX) | MIT | Strictly larger SFX parameter model (21 params: adds filter, tremolo, delay, pitch jump, stereo pan). Not seedable. Best place to look if you outgrow `renderSfx`. |
| [ZzFXM](https://github.com/keithclark/ZzFXM) | MIT | Tracker-style music with pattern reuse. Would replace the *generator* — you would have to author songs by hand. Not on npm. |
| [jsfxr](https://github.com/chr15m/jsfxr) / [sfxr.me](https://sfxr.me) | Unlicense | Same preset vocabulary. Its base58 preset strings are the natural interop format, but its linear `p_freq_ramp` differs in kind from this engine's exponential `slide`, and its LPF/HPF/phase-offset params have no equivalent here. |
| [TinyMusic](https://github.com/kevincennis/TinyMusic) | MIT | Real-time oscillator scheduling against the audio clock (this project pre-renders). Unmaintained since 2018, fixed 50% duty, no noise channel. |
| [Tone.js](https://github.com/Tonejs/Tone.js) | MIT | Full framework with a sample-accurate Transport and effects. Two runtime dependencies and ~5.4 MB unpacked — breaks the size/dependency guarantees. |
| [@beatbax/engine](https://github.com/kadraman/beatbax-engine) | MIT | Faithful Game Boy APU (pulse duty, wavetable, LFSR noise). One dependency. |
| [@audio/decode-mod](https://github.com/audiojs/decode) | BSD-3 | Single-file WASM libopenmpt. The clean way to play tracked modules (MOD/XM/S3M/IT) in a browser. ~1.4 MB. |
| [beepbox-lite](https://github.com/zackurben/beepbox) | MIT | Zero-dependency player for [BeepBox](https://beepbox.co) song JSON (BeepBox itself is MIT). Authoring front-end + playback. |
| [FamiStudio](https://github.com/BleuBleu/FamiStudio) | MIT | NES music editor; exports NSF/ROM/FamiTracker text. Desktop app, no browser engine. |

**Avoid in a permissively-licensed project.** [chip-player-js](https://github.com/mmontag/chip-player-js)
is **GPL-3.0** and ~655 MB of C/Emscripten; [Strudel](https://codeberg.org/uzu/strudel) is
**AGPL-3.0-or-later**; [Furnace](https://github.com/tildearrow/furnace) is **GPL-2.0-or-later**;
`libvgm` ships **no license at all**; `game-music-emu` is LGPL-2.1 *until* its MAME YM2612 core
is enabled, at which point it becomes GPL-2.0+; and
[chipvoice](https://github.com/gwendall/chipvoice) is the SPDX expression
`(MIT AND LGPL-2.1-or-later)` because two of its chip cores are line-for-line LGPL ports.
[Nuked-OPN2](https://github.com/nukeykt/Nuked-OPN2) and `blip_buf` are LGPL-2.1.

## License

MIT — see [LICENSE](./LICENSE).
