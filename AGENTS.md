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
node bin/chiptune.js midi song.mid --auto -o remix.wav   # 依 GM 編號與音域替每一軌挑最接近的真實音色
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

**Voices for a whole file**: `autoInstruments(midi)` (src/gm.js) reads each track's GM
program number and register and answers with the closest voice — `sampled:` when the
library has a recording for that family, `real:` when it does not, chip for the synth
programs. Register splits a family (GM 48-51 → contrabass below C3, cello below C4, violin
above; brass 61-63 likewise) using the median pitch of the part. The answer also carries
`outOfRange`: how far the part reaches outside the chosen recording's range, in semitones.
Past `MAX_SAMPLE_SHIFT` (3) the recordings are not used at all, because a rate-shifted
recording is a different instrument — a contrabass lifted 16 semitones is not a contrabass
and a flute slowed six is a bass flute. Instead the same family lends a member that fits
(the high melody on a GM 43 part goes to the violin), and when no member can cover the part
(a string pad spanning 4.7 octaves) the family's `fallback` synth voice takes it. Both
cases are pinned by tests taken from real files: Deep Wilderness's melody (program 43,
F#3-D#5) and Rygar's flute (program 73, down to F#3). The console applies it on
import (「自動配真實樂器」) and on demand (「🎻 重新配音色」); the CLI's `--auto` uses
`samples: false`, because Node cannot fetch and decode the recordings. Choosing a voice must
never start a download — that happens on the first play.

Instruments come in two banks, `chip` (one oscillator) and `real` (additive harmonics,
detuned copies, an attack transient and a per-voice lowpass). A bare name is chip;
`real:piano`, `real:bass`, `real:erhu`, ... address the other bank:

- chip: `square pulse25 pulse12 triangle saw organ flute strings brass piano pluck bell`
- real: `piano epiano organ strings flute brass guitar bell bass harp choir marimba`, plus
  the real instruments the chip bank has no slot for — `violin cello trumpet sax clarinet
  harpsichord vibraphone erhu accordion musicbox kalimba` — which are `real:`-only

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

The third family is neither bank: real instruments played from recordings, addressed as
`sampled:<name>` — `grand` (Salamander piano) plus `violin cello contrabass harp
guitar-acoustic guitar-nylon guitar-electric bass-electric flute clarinet saxophone trumpet
trombone french-horn tuba organ xylophone`, and the bundled `kalimba` (see
below). The file lists live in
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

- Only the selected instrument is fetched; each instrument carries at most 18 recordings
  spread across its range (18 keeps *all* recordings for nearly every instrument in the
  source library), and the notes between them use playback rate. `gap` in the data is the
  widest hole, in semitones, and the UI warns past 6 (the French horn's library has a
  14-semitone hole: a note in it is transposed 7 semitones, which is audible). A partial
  load (offline, a 404) keeps what arrived and retries only the missing files on the next
  `load()`.
- `renderMidi` mixes recordings through `opts.samples`; a `sampled:` track with no entry
  there throws `Unknown instrument` rather than playing something else. Seek, loop and the
  WAV export keep working because the output is still one PCM buffer.
- Before a recording is loaded, play `SAMPLE_LIBRARY[name].synth` (a chip/real voice) so a
  key or a track is never silent. `sampleSynth(name)` returns it; the console also rewrites
  unloadable tracks to it for that render.
- Samples are a third-party host: nothing is bundled, so the first visit to an instrument
  needs the network. That is the one place these pages are not offline-first.

### Velocity layers (nine instruments, plus a sampled piano release)

Nine instruments are bundled with recorded dynamics — the grand piano (4 layers **plus 21
release samples played at note-off**), clarinet, trombone and tuba (3) and violin, cello,
oboe, viola and trumpet (2) (`samples/velocity/`, 307 files, ~15 MB; table in
`src/dynamic-library.js`, generated by `tools/build-velocity.mjs`; the source's layer count
is the ceiling, except for the piano, which the original Salamander release gives 16 of and
we use four). The data shape
is a list per pitch — `notes: { 69: [{ vel: 0, file: '69-p.mp3' }, { vel: 0.5, file:
'69-f.mp3' }] }` — and `sampleUrls()` / `_load()` / `pickLayer()` / `layerMix()` /
`sampleVoice(notes, midi, vel)` handle both that and the older `midi: 'file.mp3'` shape
(a single file becomes one layer at vel 0). A piano-style instrument may also carry
`release: { base, notes: { midi: file } }`; `renderMidi` mixes it at note-off (the damper
sound) and realtime `playNote().release()` starts it, so a note has an ending and not just
a fade.

The velocity set is **not** in the service worker precache (15 MB on the first visit); the
drums, the piano releases and the app shell are. Loaded instruments are cached by the engine
itself, so they work offline after one use.

`layerMix()` is what plays: one layer normally, two **crossfaded with equal power** inside
±9% of a boundary (cos/sin, because the two layers are different recordings and a linear sum
would dip in the middle). That is why two layers do not sound like a step. Do not "fix" the
layer count by reusing a take as a second layer: measure the brightness ratio first (the
flute's two takes differ by 4 dB at a 0.99 brightness ratio, i.e. no dynamics at all; the
French horn's three-layer notes only cover MIDI 34-48, so they cannot voice a horn part).

Rules: the **layer carries timbre, velocity carries level**, so each layer is normalised to
the same reference at build time (keeping the recorded 15 dB p/f difference would put a 15 dB
step at the velocity boundary). `normalizeInstrument()` looks only at the strongest layer per
pitch for the same reason — averaging the soft layers in would push the loud ones over 1.0.
A source whose two takes differ by ~4 dB with the same brightness is *not* a dynamics layer:
measure before claiming it is (the flute was dropped for exactly that).

### Sampled drums (`sampled:kit`)

Percussion is the exception to that rule: the kit **is** bundled. `samples/drums/*.mp3`
(101 one-shots, ~1.5 MB) plus the generated `page/drum-library.js` (GM note → velocity
layers → files), loaded by `SampledKit` in `src/drums.js`. Drums are one-shots: no pitch
interpolation, no release envelope, and note-off must not cut them (`mixSampleInto` is
called with the default `hold: Infinity`).

Regenerate with `node tools/build-drums.mjs` (needs ffmpeg + network; passes `--force` to
redo everything). It follows the source kit's own SFZ mapping for velocity layers and round
robins, converts to mono 44.1 kHz, trims the lead-in, fades the tail and normalises every
hit to 0.9 — so a layer is timbre, not level, and the `gain` in the data is what balances
kick against hi-hat. Source: Virtuosity Drums (Versilian Studios × Karoryfer, CC0 1.0);
credit it in `samples/drums/README.md` and in the generated table.

Rules: every file in `samples/drums/` must be referenced by the data table and precached in
`sw.js` (both directions are tested — a missing file is a silently dead drum). Percussion
notes with no recording fall back to the chip drum in `renderMidi`, and `sampled:kit` with
no `opts.samples` entry throws. `page/drum-library.js` and `samples/` are page assets: they
are not in the npm package (`package.json` files), so a library user brings their own kit
description to the same engine.

### Sampled string ensemble and vibrato flute

Two more bundled instruments, both built by `tools/build-flute.mjs --vibrato` /
`tools/build-strings.mjs` (shared steps in `tools/sampled-source.mjs`):

- **`strings`** (弦樂群, G2-D6 after the octave fix, 26 pitches, two takes each): VSCO's
  Violin/Viola/Cello *Section* `susvib` recordings merged by register, so a wide string part
  gets cellos at the bottom and violins on top. The library had **no** ensemble recording
  before: GM 44-45 and 48-51 borrowed a *solo* violin/cello/contrabass, which is why a
  string pad sounded thin.
- **`flute-vib`** (長笛（有顫音）, E4-C7, 9 pitches): the same flute with the source's vibrato
  articulation, selectable by name. GM 73 still uses the plain one.

Two traps in that source, both caught by measuring rather than trusting file names: the
`susvib` names are inconsistent (two files are an octave above the rest, and one file's two
"takes" are a different octave from each other — a take that is not the same note is dropped
by the build), and the low string sections have very weak fundamentals (the cello section's
C2 sits at 65.4 Hz, **-49.6 dB** below its second harmonic), so harmonic summation reports
them an octave or two high. The build therefore takes the **pitch class** from the
measurement and the **octave** from the naming convention plus the instrument's own range
(a cello section's lowest note is C2, not C1), and prints the disagreement count.

### Sampled kalimba (`sampled:kalimba`)

The kalimba is bundled for the same reason as the drums, only more so: `kalimba.html` **is** a
kalimba, so its 17 tines have to be there the moment the page opens. `samples/kalimba/*.mp3`
(one recording per tine, ~0.6 MB) plus the generated `src/kalimba-library.js`
(`KALIMBA_INSTRUMENT`, shaped like a `SAMPLE_LIBRARY` entry, so `SampledInstruments` loads it
through the ordinary path), precached in `sw.js` under `KALIMBA`.

Source: a Moozica 17-key kalimba recorded by Simone Piervergili
(`NeoSoundFonts/SimonePiervergili-Kalimba`, **CC0 1.0**, mono 48 kHz WAVs). Two things about
that source are traps, both handled by `tools/build-kalimba.mjs` and pinned by
`test/kalimba.test.js`:

- **The file names are an octave below the pitch.** `C3.wav` is middle C (MIDI 60). The
  authority is the SFZ's `pitch_keycenter`; `KALIMBA_SOURCE.files` records both.
- **Every tine is tuned sharp**, up to 22 cents at the top and never the same amount twice, so
  scales and transposition come out of tune. The build measures each tine (0.5 s DFT scan with
  a parabolic refine — a kalimba tine is nearly a pure tone, and autocorrelation happily
  reports a sub-octave), resamples it onto equal temperament and records the correction in
  `KALIMBA_SOURCE.tuning`. Residual is <0.2 cents, and <1 cent measured back out of the mp3s.

Each tine is also normalised on its own to 0.9 (the source spread 13 dB between takes — thumb
force, not instrument design): the tine carries timbre (ring time 3.9 s → 0.4 s across the
range) and velocity carries level. `src/kalimba.js` is the instrument model — the tine layout
(longest, lowest tine in the centre, alternating outward, so the tips form a V), length as
`1/√f`, the keymap, the tunings and the demo tunes. It is pure data: no DOM, no audio, so the
layout invariants are testable. `page/kalimba.js` only draws it and wires events.

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

## The demo pages (`index.html` = 電子琴, `console.html`, `kalimba.html`, `score.html`)

The pages demo this library; they are not part of the npm package. Their HTML holds
only markup and the page's own CSS — all script lives in `page/`:

`index.html` is the front door and it is the instrument (`page/keyboard.js`); the control
panel lives in `console.html`, and `keyboard.html` is a redirect to `index.html` so old
links and installed shortcuts keep working. The PWA's `start_url` is `./`.

- `page/console.js` — the control panel (console.html), wired top-to-bottom in the order the page is
  laid out: 主控 (bus levels) → 音效 → 音樂 (part faders) → MIDI (import one or many
  files into a playlist → tracks → piano view → transport + seek bar)
- `page/keyboard.js` — the on-screen keyboard (index.html) and its three voice banks
- `page/kalimba.js` — the 17-tine kalimba simulator: it draws `src/kalimba.js`'s tine
  layout, plays `sampled:kalimba`, and records a performance into a WAV through
  `renderMidi` (so the file is the same engine and the same recordings you heard)
- `page/pianoview.js` — the canvas falling-notes display (`src/pianoroll.js` does the geometry)
- `page/score.js` — the sheet-music page (score.html): PDF → `/omr` → MusicXML, a measure
  editor, and playback through the two piano voices
- `page/mixer.js` — bus strips and part strips, including marking the part faders inactive
  while a MIDI owns the music bus
- `page/ui.js` — `$`, theme colours, time formatting, WAV download, `prefs` (localStorage),
  `registerServiceWorker()` and `installApp()`, and `collapsibleSections()`: any
  `<section data-collapse>` gets a heading that toggles it (the console's three working
  sections start collapsed, the choice is remembered, an in-page link to a collapsed section
  expands it, and importing a file expands the MIDI section)
- `page/theme.css` — the shared design tokens the pages load

### Installing it (and why every page carries the plumbing)

Chrome decides installability **per document**, so a page without a manifest link has no
install entry point at all — `score.html` used to be exactly that (`Page.getInstallabilityErrors`
reported `no-manifest`), which is what "can't install the PWA" looked like from the outside.
Every page therefore needs the manifest link, the icons, the apple meta tags, and a module
that calls `registerServiceWorker()` + `installApp()`; `test/pages.test.js` pins that.

- `installApp()` (page/ui.js) puts an always-visible **⬇ 下載 App** link in the header nav.
  It must not wait for `beforeinstallprompt` to appear: iOS Safari never fires it, Firefox
  does not support install, in-app browsers usually swallow it, and Chrome goes quiet for a
  while after a dismissal — waiting means those users see no entry point at all. With the
  event, clicking calls `prompt()` (never on load — the click is the user's gesture); without
  it, clicking prints where to press for that platform. It disappears in standalone and
  becomes ✓ 已安裝 after `appinstalled`.
- The manifest carries a stable `"id": "./"`. Without it the app id is derived from
  `start_url`, and this app's start page has moved three times — each move looked like a
  *different* app to the browser, so an installed icon never updated in place.
- The 11 MB of audio is **not** downloaded in the service worker's `install` event: 369 files
  take a minute or two on a phone, and a worker that is still `installing` means no install
  prompt and no offline shell yet. `install` fetches the shell (in batches, tolerating
  failures — one bad fetch must never abort the install), activates, and the page then asks
  for the audio with `postMessage({ type: 'prefetch-media' })`; the worker fills
  `chiptune-media-<hash>` with six connections at a time and writes a `media-complete` entry
  only when everything arrived, so a partial cache is resumed rather than repeated. Do not
  move that back into `install`, and do not let one rejected `fetch` reject the batch:
  `test/sw.test.js` runs the worker against a flaky fake network and checks both.

A kalimba tine rings until it runs out of energy, so note-off does not stop it: the page lets
the voice ring out (like the piano) and offers an explicit 止音 (damp) button instead. Do not
"fix" that by fading on pointer-up — it is what the instrument does.

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

## Measuring audio instead of guessing

`tools/analyze.mjs` (`npm run analyze -- <files>`) turns "it sounds fake" into numbers:
peak/RMS/crest, noise floor, octave-band energy, spectral centroid and rolloff, stereo
width (side/mid + L/R correlation), onsets, decay to -20 dB, per-note pitch, and
`--compare A B` (aligned correlation and residual energy between two files). Everything
this project claims about sample quality was measured with something like it — the 24-50 ms
digital lead-ins, the piano's 6.2 dB level gap, the 96 kbps encode being inaudible to the
piano, and the mono fold below.

Two findings worth keeping in mind when touching the bundled samples:

- **Do not fold a decorrelated stereo pair with `(L+R)/2`.** The build tools now decode
  every source to two channels, measure left, right *and* the fold, and keep whichever has
  the most energy (measured over the whole bundled set: the fold won 0 times out of 307 —
  147 left, 160 right). Rebuilding with that rule recovered 2.6 dB on the piano note it was
  measured on, up to 6.7 dB on individual notes (the fold had made some notes quieter than
  others by that much, which is a level error *between* notes), and it put the snare's
  centroid back from 877 Hz to 1094 Hz and the hi-hat's from 4426 Hz to 4828 Hz — the fold
  had been cancelling exactly the high-frequency part of those hits. The original
  measurements: Salamander's two channels are
  two different microphone perspectives (their per-band phase difference scatters from +28°
  to -137°, lag-0 correlation -0.29 to -0.79), so the fold cancels about 5 dB of each note's
  energy *and* reshapes its spectrum differently per note (measured: A3v8 channels 0.0138 /
  0.0147 RMS, the fold 0.0076; 250-500 Hz 2-5 dB louder and 500-2000 Hz 3-4 dB quieter than
  either channel). VSCO's stereo sources are benign in comparison (fold 0.6-2.3 dB below the
  best channel). `-ac 1` in a build tool is that fold; pick the stronger channel instead.
- **Encoding bitrate is not where realism is lost.** For a piano note every band up to
  16 kHz matches the 48 kHz/24-bit original within 1 dB at 96 kbps mono; only the >16 kHz
  band differs (-83 dB original vs -104 dB), which is inaudible. Look at the source
  recordings and the playback rate, not the encoder.
