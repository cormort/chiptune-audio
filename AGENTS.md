# chiptune-audio for AI agents

Zero-dependency 8-bit sound engine. Use it to **make game audio files** (the
`chiptune` CLI) or to **play audio inside a browser game** (the library).

You cannot hear the output, so every CLI command prints a JSON summary you can
check instead. Requires Node 18+. No install step: run `node bin/chiptune.js`
from the repo root (or `npx chiptune` where the package is installed).

## Make audio files (CLI)

Every command writes a 16-bit mono WAV (44100 Hz unless `--rate`) and prints JSON
on stdout. On error it prints `{"error": "..."}` on stderr, writes nothing and
exits 1: read the message, fix the arguments, retry.

```bash
node bin/chiptune.js list                        # presets, moods, instruments, param defaults
node bin/chiptune.js sfx coin -o coin.wav        # a preset
node bin/chiptune.js sfx jump --param freq=320,slide=3 -o jump-high.wav   # preset + overrides
node bin/chiptune.js sfx '{"wave":3,"freq":3000,"slide":-2,"decay":0.4}' -o whoosh.wav   # from scratch
node bin/chiptune.js music --mood boss --seed 7 --bars 8 -o boss.wav      # seamless loop
node bin/chiptune.js music --mood calm --seed 3 --loops 4 --mix drums=0 -o menu.wav
node bin/chiptune.js midi song.mid --info        # list tracks before remixing
node bin/chiptune.js midi song.smf --track 1=pulse25 --track 3=mute --transpose 2=-12 --speed 1.2 -o remix.wav
```

Example summary (`sfx coin`):

```json
{ "file": "coin.wav", "seconds": 0.255, "sampleRate": 44100, "samples": 11246,
  "peak": 0.5011, "rms": 0.3856, "silent": false, "params": { "wave": 0, "freq": 988, "...": "..." } }
```

### Checking a result without listening

| Field | What to look for |
|---|---|
| `silent` | Must be `false`. `true` means zero volume, `freq: 0`, or every MIDI track muted. |
| `seconds` | Matches the intent: UI blips 0.02–0.15, hits/jumps 0.1–0.4, jingles 0.5–1.5. |
| `peak` | 0.2–0.9 is healthy. Music and MIDI are normalised to at most 0.9. |
| `params` | (sfx) the values actually used after clamping. Copy them into game code. |
| `bpm`, `loopSeconds` | (music) the loop length the game should expect. |
| `tracks` | (midi) instrument, volume, mute and transpose actually applied per track. |

Same arguments always produce the same file: a seed or param set that works can
be recorded and regenerated later.

## Sound-effect parameters

Pass as JSON or `--param key=value`. Out-of-range values are clamped (never an error).

| Param | Range | Default | Meaning |
|---|---|---|---|
| `wave` | 0 square, 1 saw, 2 triangle, 3 noise (`--param wave=noise` also works) | 0 | Oscillator |
| `freq` | 0–20000 Hz | 440 | Start pitch (for noise: how fast the noise changes) |
| `slide` | -64–64 | 0 | Pitch sweep, octaves/second. + rises (jump, powerup), − falls (laser, hit) |
| `duty` | 0.05–0.95 | 0.5 | Square pulse width. 0.125/0.25 thinner and brighter |
| `dutySweep` | -256–256 | 0 | Duty change per second |
| `vibDepth` | 0–1 | 0 | Vibrato depth, fraction of freq (0.01 subtle, 0.2 siren) |
| `vibRate` | 0–4000 Hz | 0 | Vibrato speed |
| `arpMult` | 0.01–64 | 1 | Pitch multiplier applied at `arpTime` (1.5 fifth, 2 octave) |
| `arpTime` | 0–30 s | 0 | When the arpeggio jump happens; 0 = off (coin = 988 Hz, ×1.5 at 0.07 s) |
| `bits` | 0–16 | 0 | Bit-crush; 3–5 crunchy, 0 = off |
| `attack` | 0–30 s | 0.005 | Fade-in |
| `sustain` | 0–30 s | 0.1 | Full-volume hold |
| `decay` | 0–30 s | 0.1 | Fade-out |
| `vol` | 0–1 | 0.5 | Level |
| `seed` | integer | 1 | Noise pattern; change it for varied hits |
| `h2` | 0–1 | 0 | 2nd harmonic (octave) level |
| `h3` | 0–1 | 0 | 3rd harmonic (octave + fifth) level |
| `h4` | 0–1 | 0 | 4th harmonic (two octaves) level |
| `h5` | 0–1 | 0 | 5th harmonic (two octaves + major third) level |
| `unison` | 0–2 | 0 | Extra detuned copies: 1 one above, 2 above and below |
| `detune` | 0–50 cents | 10 | Spread between those copies |
| `cutoff` | 0–20000 Hz | 0 | One-pole lowpass on this voice; 0 = off |
| `chiff` | 0–1 | 0 | Noise burst mixed into the attack (hammer, breath, pick) |

The last eight are the *timbre* params: all zero is a plain chip voice (the cheap path
every preset uses), and any of them switches that voice to an additive one. `normalizeSfx`
carries them only when they are set, so a default voice keeps the object shape — and the
speed — it always had.

Length = `attack + sustain + decay` (capped at 30 s).

**Presets:** `coin jump laser hit explosion powerup select gameover win shoot blip
click hurt pickup heal levelup door step bounce alarm teleport charge error splash`.
Start from the closest preset and override a few params rather than starting from scratch.

## Music

`--mood`: `happy calm tense sad heroic playful dreamy mysterious spooky boss groovy`.
`--seed` picks the melody (any integer), `--bars` 1–128 (default 8), `--loops` 1–16
repeats the loop in the file, `--mix lead=|bass=|drums=` 0–1 per part.
The loop is seamless: loop the file in the game.

## MIDI remix

`.mid` and `.smf` name the same Standard MIDI File format, so both work
anywhere a MIDI file is expected (formats 0 and 1). `parseMidi` finds the MThd
header itself, so it also reads the wrappers these files arrive in: RIFF/RMID
(.rmi), a file with an ID3 tag or a few stray bytes in front, and `song.mid.gz`
(the console page inflates gzip in the browser). A file with no MIDI in it throws
an error naming what it looks like (`RIFF/WAVE audio file`, `MP3 file`, `text or
markup`, `gzip-compressed data`, ...) rather than a bare "missing header". Run
`--info` first: it lists
every track (numbered from 1) with its channel, note count and the suggested
instrument. Channel 10 defaults to `drums`. Per-track flags are `N=value` and
can repeat:

- `--track N=<instrument>` or `--track N=mute`
- `--volume N=0..1`, `--transpose N=<semitones>`
- `--speed 0.25..4` for the whole piece

The console page imports **many files at once** (multi-select or a whole drop): each one
becomes a playlist entry that keeps its own track settings, and the "連續播放清單" toggle
plays them one after another. The CLI is still one file per run: to put several pieces in
one file, render each and concatenate the WAVs.

Instruments come in two banks, `chip` (one oscillator) and `real` (additive harmonics,
detuned copies, an attack transient and a per-voice lowpass). A bare name is chip;
`real:piano`, `real:bass`, `real:erhu`, ... address the other bank:

- chip: `square pulse25 pulse12 triangle saw organ flute strings brass piano pluck bell`
- real: `piano epiano organ strings flute brass guitar bell bass harp choir marimba`, plus
  the real instruments the chip bank has no slot for — `violin cello trumpet sax clarinet
  harpsichord vibraphone erhu accordion musicbox` — which are `real:`-only

The six names both banks have (`piano organ strings flute brass bell`) are the same
instrument in either one, so switching banks on the keyboard keeps the key under the cursor
on the same instrument. Adding a voice is data: one entry in `REALISTIC_INSTRUMENTS`, its
label in `INSTRUMENT_LABELS.real`, and its hash in the golden table in `test/voices.test.js`
(`npm test` prints the mismatch, and the hash has to be recomputed on purpose).

A realistic voice costs ~10-15x a chip voice per sample and every note's full tail is
rendered, so a long piece can take minutes (measured: 15 s of MIDI with
`real:piano`/`real:bass`/`real:strings`/`drums` took 13.5 s against 0.85 s for the same file
with chip voices). Use it for short pieces or accept the wait.

## Sampled instruments (real recordings)

The third family is neither bank: 20 real instruments played from recordings, addressed as
`sampled:<name>` — `grand` (Salamander piano) plus `violin cello contrabass harp
guitar-acoustic guitar-nylon guitar-electric bass-electric flute clarinet saxophone trumpet
trombone french-horn tuba bassoon organ harmonium xylophone`. The file lists live in
`src/sample-library.js` (generated; samples CC-BY 3.0 from `nbrosowsky/tonejs-instruments`,
i.e. VSCO 2 CE / University of Iowa MIS / Karoryfer / Freesound — keep `credit` per
instrument accurate). `src/samples.js` is the engine:

```js
const samples = new SampledInstruments(() => audio._ensure(), () => audio.master);
await samples.load('violin', { onProgress: (done, total) => {} });   // cached in CacheStorage
samples.playNote('violin', 60, { vel: 0.85 });                       // realtime, per note
renderMidi(midi, { tracks: [{ instrument: 'sampled:violin' }], samples: samples.voices(['violin']) });
```

Rules that keep it honest and cheap:

- Only the selected instrument is fetched; each instrument carries at most 12 recordings
  spread across its range, and the notes between them use playback rate (±2 semitones is
  inaudible). A partial load (offline, a 404) keeps what arrived and retries only the
  missing files on the next `load()`.
- `renderMidi` mixes recordings through `opts.samples`; a `sampled:` track with no entry
  there throws `Unknown instrument` rather than playing something else. Seek, loop and the
  WAV export keep working because the output is still one PCM buffer.
- Before a recording is loaded, play `SAMPLE_LIBRARY[name].synth` (a chip/real voice) so a
  key or a track is never silent. `sampleSynth(name)` returns it; the console also rewrites
  unloadable tracks to it for that render.
- Samples are a third-party host: nothing is bundled, so the first visit to an instrument
  needs the network. That is the one place these pages are not offline-first.

Output is capped at 5 minutes. A malformed file that retriggers a pitch without ever
sending its note-off cannot stack voices: at most 8 pending note-ons are kept per
channel/pitch (the oldest is stolen), so render time and memory stay bounded by the file's
structure instead of by the number of unmatched on-notes.

## Drawing a performance (piano display)

`flattenMidi`, `pianoRange`, `pianoLayout`, `keyWindow`, `countWhiteKeys`,
`notesSoundingAt` and `keyAt` (all in `src/pianoroll.js`) turn a parsed file into the
geometry of a falling-notes keyboard, with no DOM and no audio:

```js
const score = flattenMidi(midi, { tracks, speed });           // same options as renderMidi
const { low, high } = pianoRange(score.notes);                // range to draw
const win = keyWindow(60, 8, { low, high });                  // zoomed view: 8 white keys near C4
const layout = pianoLayout(win.low, win.high, width);         // x/w per visible key
notesSoundingAt(score.notes, audio.musicTime, score.maxDur);  // keys to light up now
```

`keyWindow` is how a zoomed keyboard stays usable: it returns a slice that starts on a white
key and stays inside the range, and `countWhiteKeys` counts the keys in a range. The demo
page picks the window from the notes currently on screen and re-centres only when one would
fall outside, so the camera does not jitter.

`score.notes` is time-sorted and carries `{ time, dur, note, vel, track, drum, mute }` with
the track settings and speed already applied, so a picture drawn from it matches the sound.
`index.html` uses them for the canvas piano display under the MIDI panel; the drawing code
is 100% of the browser-specific part.

## Use it in a browser game (library)

```js
import { ChiptuneAudio } from './src/index.js';
const audio = new ChiptuneAudio({ volume: 0.6 });

// Must run inside a user gesture (click/keydown) because of browser autoplay rules.
startButton.onclick = () => {
  audio.playMusic({ seed: 7, mood: 'boss' });
  audio.playSfx('coin');
  audio.playSfx({ freq: 320, slide: 3, decay: 0.15 });    // same params as the CLI
};
audio.setMix({ music: 0.5, sfx: 1 });
```

Types are in `types/index.d.ts`. Pages using ES modules must be served over
HTTP (`npx serve .`), not opened as `file://`.

## The demo pages (`index.html`, `keyboard.html`)

The two pages demo this library; they are not part of the npm package. Their HTML holds
only markup and the page's own CSS — all script lives in `page/`:

- `page/console.js` — the control panel, wired top-to-bottom in the order the page is
  laid out: 主控 (bus levels) → 音效 → 音樂 (part faders) → MIDI (import one or many
  files into a playlist → tracks → piano view → transport + seek bar)
- `page/keyboard.js` — the on-screen keyboard and its four voice banks
- `page/pianoview.js` — the canvas falling-notes display (`src/pianoroll.js` does the geometry)
- `page/mixer.js` — bus strips and part strips, including marking the part faders inactive
  while a MIDI owns the music bus
- `page/ui.js` — `$`, theme colours, time formatting, WAV download, `prefs` (localStorage)
- `page/theme.css` — the shared design tokens both pages load

If you rename a control, change the page markup and the module together:
`test/pages.test.js` checks that every `$('id')` a page module looks up exists in that
page's HTML, and that the in-page nav links resolve. `test/sw.test.js` requires every
`src/` and `page/` module plus `page/theme.css` to be in the `sw.js` precache list, so
bump `VERSION` there when you add a file.

## Rules of thumb

- Keep one-shot SFX under 1 s; lower `vol` for sounds that repeat often (`step`, `blip`).
- For repeated sounds, vary `seed` (noise) or play with `{ rate: 0.9 + Math.random() * 0.2 }`.
- Pick music by the scene's feeling first (`mood`), then try a few seeds.
- `npm test` must pass after any change to `src/`.
