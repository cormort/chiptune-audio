# chiptune-audio

Zero-dependency 8-bit sound effect and music engine for browser games, built on the Web Audio API.

- **SFX**: sfxr-style parametric synthesis (square / saw / triangle / noise, pitch slide, arpeggio, vibrato, bit-crush, plus additive harmonics, detuned unison, an attack transient and a per-voice lowpass for acoustic voicings) with 24 presets: `coin jump laser hit explosion powerup select gameover win shoot blip click hurt pickup heal levelup door step bounce alarm teleport charge error splash`.
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

Levels are 0..1. Part levels are baked into the rendered loop (one re-render, ~30-45 ms for
an 8-bar loop — measured, longer loops cost more), so change them on slider release rather
than on every input event. Changing a part level to the one already playing is skipped.

### Keyboard instruments

```js
import { instrumentNote, instrumentRelease } from './src/index.js';

const note = audio.playNote(instrumentNote('organ', 60));        // key down: C4 on the organ
note.release(instrumentRelease('organ'));                        // key up: fade out
```

Two banks, `chip` (twelve slots, one oscillator, 8-bit) and `real` (additive harmonics,
detuned copies, an attack transient and a per-voice lowpass — synthesis, not samples):

- chip: `square pulse25 pulse12 triangle saw organ flute strings brass piano pluck bell`
- real: `piano epiano organ strings flute brass guitar bell bass harp choir marimba`, plus
  the real instruments the chip bank has no slot for: `violin cello trumpet sax clarinet
  harpsichord vibraphone erhu accordion musicbox`

The six names the two banks share (`piano organ strings flute brass bell`) are the same
instrument in either one, so switching banks on the keyboard does not change what the key
under the cursor plays. The rest of `real` is `real:`-only — `real:erhu` is an erhu, a bare
`erhu` is an error, the same way `saw` has no realistic version.

`instrumentNote(name, note, opts)` takes `bank: 'real'` (or a `real:<name>` prefix) and
`vel`, and its output is ordinary SFX params — `renderSfx(instrumentNote('real:piano', 60))`
renders one note. A realistic voice costs roughly 10-15x a chip voice per sample and lays
down every note's full tail, so the keyboard can afford it per note while a long MIDI remix
cannot.

### Sampled instruments (real recordings)

Nothing above is a recording. The third family is: 20 real instruments played from
recordings — the Salamander grand piano plus `violin cello contrabass harp guitar-acoustic
guitar-nylon guitar-electric bass-electric flute clarinet saxophone trumpet trombone
french-horn tuba bassoon organ harmonium xylophone`, all from the CC-BY
`nbrosowsky/tonejs-instruments` library (VSCO 2 CE, University of Iowa MIS, Karoryfer,
Freesound). They are fetched on demand, never bundled:

```js
import { SampledInstruments } from './src/index.js';

const samples = new SampledInstruments(() => audio._ensure(), () => audio.master);
await samples.load('violin', { onProgress: (done, total) => console.log(done, total) });
samples.playNote('violin', 60, { vel: 0.85 });            // C4, from the recording

// In a MIDI remix the recordings go through the normal renderer, so seek, loop and
// the WAV export keep working — the track is mixed from PCM instead of synthesised:
renderMidi(midi, { tracks: [{ instrument: 'sampled:violin' }], samples: samples.voices(['violin']) });
```

Three things keep this cheap: only the instrument you select is fetched; each instrument
carries at most 18 recordings spread over its range (18 is enough that nearly every
instrument keeps *all* the recordings its library has) and the notes between them are
reached with playback rate — within ±2 semitones that is inaudible, which is why
`SAMPLE_LIBRARY[name].gap` is published and shown in the UI when a library is sparse (the
French horn has a 14-semitone hole); and the decoded samples are
kept in `CacheStorage` (`chiptune-samples-v1`) so the second visit is offline-capable.
Before a recording arrives — first press, or offline — `SAMPLE_LIBRARY[name].synth` is the
synthesised voice to play instead, so a key is never silent. A `sampled:` track with no
entry in `renderMidi`'s `samples` is an error, not a quiet fallback.

### Sampled drums

Percussion is sampled too, and unlike the instruments above it ships **inside the repo**:
`page/drum-library.js` maps the GM percussion notes (35–84) to 101 one-shots in
`samples/drums/` (about 1.5 MB of mono 44.1 kHz mp3). Drums are one-shots, so they need no
pitch interpolation and compress hard — and because they are same-origin files they are
precached by the service worker, so a kit hit is instant and works offline. That is the
trade the instruments above make in the opposite direction: they stay out of the repo and
pay a first-load download.

```js
import { SampledKit } from './src/index.js';
import { DRUM_KIT } from './page/drum-library.js';

const kit = new SampledKit(() => audio._ensure(), () => audio.master);
await kit.load(DRUM_KIT, { onProgress: (done, total) => {} });
renderMidi(midi, { tracks: [{ instrument: 'sampled:kit' }], samples: kit.voices('sampled:kit') });
```

Voice selection happens at mix time: velocity picks the layer (a layer is timbre, not level —
every hit is normalised), a rotating counter picks the round robin, and the per-hit `gain`
in the data is what balances kick against hi-hat. Percussion notes the kit has no recording
for (timpani, woodblock, cuica…) fall back to the chip drum rather than going silent, and a
`sampled:kit` track with no samples passed is an error.

The source is **Virtuosity Drums** (Versilian Studios × Karoryfer Samples, **CC0 1.0**);
`samples/drums/README.md` credits it and `tools/build-drums.mjs` regenerates the files
(ffmpeg, it follows the kit's own SFZ velocity/round-robin mapping rather than guessing).

### Velocity layers

Three of those instruments — violin, cello and trumpet — are **bundled** (like the drums) and
carry **two recorded dynamics** each, so a soft note is darker, not just quieter: VSCO 2 CE's
`_p`/`_f` and `_v1`/`_v3` pairs (brightness ratios measured at 1.36×, 1.51× and 3.18×).
They live in `samples/velocity/` (76 files, ~3.6 MB) with the generated table in
`src/dynamic-library.js`, and they override the single-layer remote entries of the same name
in `src/samples.js`. `pickLayer()` picks the loudest layer that fits the velocity, so the
layer carries timbre and velocity still carries level — which is why the levels of the two
layers are normalised to match (a 15 dB jump at the velocity boundary would be worse than no
layers at all). The flute was going to be one of the three; VSCO's flute turns out to have
takes rather than dynamics (4 dB, same timbre), so it is a trumpet instead and the flute keeps
its single layer. Regenerate with `node tools/build-velocity.mjs`.

Sample licensing: instruments CC-BY 3.0 (credits in `SAMPLE_LIBRARY`, i.e.
`src/sample-library.js`; the Salamander piano is Alexander Holm's V3), drums CC0,
velocity layers CC0 (VSCO 2 Community Edition).

### MIDI remix

```js
import { parseMidi } from './src/index.js';

const midi = parseMidi(await file.arrayBuffer());   // .mid/.smf/.rmi, format 0/1, throws on bad input
audio.playMidi(midi, {
  tracks: [{ instrument: 'saw' }, { mute: true }], // per track: instrument, volume, mute, transpose
  speed: 1.25,
  loop: true,
});
```

The parser locates the MIDI header rather than trusting the file to start with it, so
RIFF/RMID containers, tag-prefixed files and stray padding all load; anything without MIDI
in it throws an error that names what the file actually is. Channel 10 is rendered as chip
drums, and renders are capped at 5 minutes.

**Picking the voices for a whole file** is a solved problem, because a Standard MIDI File
says what each part is: `autoInstruments(midi)` reads every track's General MIDI program
number and its register, and answers with the closest voice — a recording when the library
has one for that family, the realistic synth when it does not, and the chip voice for the
synth programs that never were real instruments.

```js
import { autoInstruments } from './src/index.js';

autoInstruments(midi);                    // [{ instrument: 'sampled:violin', family: '小提琴／中提琴', sampled: true }, ...]
autoInstruments(midi, { samples: false });// same choices without the download (what the CLI does)
```

Register is what separates a cello from a violin: GM 48-51 (string ensembles) answers
`sampled:contrabass` below C3, `sampled:cello` below C4 and `sampled:violin` above, using
the median pitch of the part. The console applies this on import (「自動配真實樂器」, on by
default) and re-applies it on demand (「🎻 重新配音色」); the CLI has `--auto`. Nothing is
downloaded by choosing a voice — that happens on the first play.

A track can also be set by hand, in any of the three families:
`{ instrument: 'real:piano' }` for the realistic synth bank, `{ instrument: 'sampled:violin' }`
for a recording (see above), or the CLI's `--track 1=real:piano`. Realistic voices cost ~10-15x a chip voice per sample and the
renderer lays down every note's full tail, so a long piece can take minutes — chip voices
stay the default for that reason, and the console's track menu groups all three under
「晶片（快）」, 「寫實合成（慢）」 and 「真實錄音取樣（要下載）」 so the choice is an informed one.

### Showing the performance (piano display)

```js
import { flattenMidi, pianoRange, pianoLayout, notesSoundingAt, keyAt } from './src/index.js';

const score = flattenMidi(midi, { tracks, speed });            // the notes as they will sound
const { low, high } = pianoRange(score.notes);                 // the range worth drawing
const win = keyWindow(60, 8, { low, high });                   // zoomed view: 8 white keys around C4
const layout = pianoLayout(win.low, win.high, canvasWidth);    // x/w for the visible keys
notesSoundingAt(score.notes, audio.musicTime, score.maxDur);   // the keys to light up now
keyAt(layout, x, y - keysTop, keysHeight);                     // which key was clicked
```

`keyWindow(centre, whiteCount, { low, high })` returns a slice that always starts on a white
key (so a zoomed view never shows half a black key at the edge) and stays inside the range;
`countWhiteKeys(low, high)` says how many white keys a range covers. The demo page uses them
to keep a readable key size on a phone while the camera follows the music.

`flattenMidi` takes the same per-track settings and `speed` as `renderMidi`, so a picture
built from it matches what is heard. The helpers are pure geometry — no DOM, no audio —
so they work in Node (they are covered by `test/pianoroll.test.js`) and suit any renderer;
`index.html` uses them to draw the falling notes and the keyboard on a canvas.

### Lifecycle

```js
audio.stopAllSfx();          // scene change
audio.setFilter(11000);      // opt-in master lowpass, tames oscillator aliasing
await audio.dispose();       // closes the AudioContext; call it in an SPA
```

Construct with `new ChiptuneAudio({ filter: { type: 'lowpass', freq: 11000 } })` to enable the
master filter from the start. It is off by default so existing sounds are unchanged.

## Command line (for scripts and AI agents)

```bash
node bin/chiptune.js sfx coin -o coin.wav
node bin/chiptune.js music --mood boss --seed 7 -o boss.wav
node bin/chiptune.js midi song.mid --track 1=saw --speed 1.2 -o remix.wav
node bin/chiptune.js midi song.smf --info        # .smf is the same Standard MIDI File format
```

Each command writes a WAV and prints a JSON summary (length, peak, RMS, the parameters
used), so a result can be checked without listening. [AGENTS.md](AGENTS.md) is the guide
for AI agents: every command, parameter ranges, and how to judge the output.
`encodeWav(samples, sampleRate)` is exported for your own renders.

## 控制台（手動操作）

`index.html` 是手動試聽與調參的控制台，版面照**功能與流程**分成四區，每一區都是
「設定 → 產生 → 播放 → 匯出」的順序。**主控**以外的三區預設收合（點標題展開，選過的會記住，
點上方導覽連結或匯入檔案也會自動展開）——手機上四區疊起來要好幾次捲動，收起來才看得到全貌：

| 區塊 | 內容 |
|---|---|
| **主控** | 總音量、靜音、停止全部音效；兩條**匯流排**推桿（音效、音樂）——所有聲音都經過這裡 |
| **音效** | ① 挑預設 → ② 拉滑桿調參數（放開就聽得到）、看波形 → ③ 播放、複製 JSON（貼進 `audio.playSfx({...})`）、下載 WAV |
| **音樂** | ① 情緒＋種子＋小節 → ② 播放（可「預先算好」避免第一拍卡頓）→ ③ 三條**聲部**推桿（主旋律／貝斯／鼓組，含靜音與獨奏） |
| **MIDI 重新混音** | ① 匯入或拖放 .mid／.smf，**可一次多選或整批拖進來**（.rmi、gzip、前面帶 ID3 標籤的檔案也認得）→ ② **依 GM 樂器編號與音域自動配真實樂器**（含**真實鼓組**），再逐軌微調（晶片／寫實合成／真實錄音取樣）→ ③ 看鋼琴演奏顯示 → ④ 播放、拖進度條、下載 WAV |

匯流排與聲部推桿分開放，是因為兩者作用的地方不同：匯流排立即生效，聲部是烘進音樂迴圈裡的
（放開推桿才重新合成，並從原位置接著播），而 MIDI 是即時算出來的，所以**播放 MIDI 時聲部推桿會被
標成未生效**，不會讓人以為推了有反應。

MIDI 支援**一次匯入多個檔案**：檔案匯入後排成一份**播放清單**（檔名、長度、軌數、音符數），
每一首各自記住自己的樂器、音量與靜音設定，點一列就換那首、`✕` 移除、「清空清單」一次清掉全部。
開著**連續播放清單**時一首播完自動接下一首（讀不到或沒有音符的曲目會跳過），
清單最後一首播完就停——要一首一直重播請用「循環」。

MIDI 區下方是**鋼琴演奏顯示**：音符由上往下掉，落到鍵盤線時發聲，琴鍵亮起代表正在響
（顏色對應軌道，第 10 聲道的鼓走另一條節奏帶）；可以選 2／4／8 秒的視窗、關掉整個顯示。
**琴鍵大小也可以調**——「琴鍵」選單是「同時顯示幾個白鍵」（整首塞進去／8／12／16／22），
放大之後畫面會跟著音樂左右移動，**預設就是 22 個白鍵**：自動播放時琴鍵才看得清楚、也才看得出
鏡頭跟著旋律跑（整首塞進去適合看全貌，但每個鍵只有幾 px，演奏畫面就沒有用了）。
琴鍵上方會顯示目前這一段的音名（例如 `C4–C5`）。
點琴鍵試聽，點鍵盤線以上或拖進度條，都可以從那個位置開始播。
音量、混音、情緒、種子、小節、顯示與連續播放設定會存在瀏覽器裡，下次開啟直接接上。

`keyboard.html` 是電子琴：四套音色庫（晶片音色／寫實合成／物理擬真鋼琴／**真實錄音取樣**——平台鋼琴、
小提琴、大提琴、長笛、單簧管、薩克斯風、小號、木吉他、豎琴、木琴等 20 種，選到才下載、抓過可離線），
按住發聲、放開停止，可彈和弦；可用滑鼠、觸控或電腦鍵盤（Z–M / Q–U），
琴鍵標示可切換電腦按鍵、音名或簡譜；音量、八度、標示與選用的音色同樣會記住。

### 頁面的程式放在 `page/`

兩個 HTML 只留標記與自己的版面，程式在 `page/`，共用的部分不再各寫一份：

| 檔案 | 內容 |
|---|---|
| `page/theme.css` | 共用設計權杖（淺色／深色）與基礎元素樣式 |
| `page/ui.js` | `$`、主題色、時間格式、WAV 下載、設定記憶（localStorage） |
| `page/mixer.js` | 混音台：匯流排與聲部兩組推桿、M／S、未生效提示 |
| `page/pianoview.js` | canvas 鋼琴演奏顯示（幾何來自 `src/pianoroll.js`） |
| `page/console.js` | 控制台頁面：把上面幾塊接起來 |
| `page/keyboard.js` | 電子琴頁面 |

`test/pages.test.js` 會檢查模組查的每個 `#id` 都真的在該頁 markup 裡、導覽連結都指向存在的區塊，
`test/sw.test.js` 則確保 `page/` 的每個檔案都進了 service worker 的快取清單——
這一類「打錯一個字，只有點下去才會壞」的問題，靠這兩個測試守住。

ES module 不能用 `file://` 開，要用 HTTP 服務：

```bash
npx serve .        # 或 python3 -m http.server
```

### 安裝成 App（PWA）

兩個頁面都可以安裝：Chrome／Edge 網址列的「安裝」圖示，或手機瀏覽器的「加到主畫面」。
安裝後可離線使用；長按 App 圖示有「電子琴」捷徑。
`sw.js` 先用快取回應，同時在背景更新，所以部署新版後要**重新開啟一次**才會看到。
改了頁面或 `page/`／`src/` 的檔案時，記得同步調高 `sw.js` 裡的 `VERSION`
（`test/sw.test.js` 會確認清單沒有漏掉任何模組）。
Service worker 只在 HTTPS 或 `localhost` 上啟用。

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

**Performance** (`node test/bench.js`, min-of-batches after warm-up). The 0.1.0 column is
the release's own measured numbers and is historical; absolute times move with the machine,
so re-run the bench instead of trusting a table:

| | 0.1.0 | 0.2.0 | |
| --- | --- | --- | --- |
| All 10 SFX renders | 6.41 ms | 1.80 ms | **3.6×** |
| 4 moods × 8-bar loop render | 174.8 ms | 62.7 ms | **2.8×** |
| `renderSong('happy', 8 bars)` | 38.3 ms | 14.1 ms | **2.7×** |
| `explosion` preset | 0.996 ms | 0.232 ms | 4.3× |

Re-measured for this revision (Node 26, Apple silicon, `node test/bench.js src` vs
`... baseline`, where `baseline/` is the frozen pre-0.2.0 copy): the four original moods at
8 bars are **127 ms** against the baseline's **325 ms** (2.6×), 25 SFX renders take
**5.3 ms** against the baseline's 10 in **8.8 ms** (0.21 vs 0.88 ms per sound), and the
song heap is **6.1 MB** against 3.7 MB — the render paths now allocate one buffer instead of
one per note, but the song cache and dictionary-mode params cost a little more.

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
