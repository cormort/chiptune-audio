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
node bin/chiptune.js midi song.mid --track 1=pulse25 --track 3=mute --transpose 2=-12 --speed 1.2 -o remix.wav
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

Formats 0 and 1. Run `--info` first: it lists every track (numbered from 1) with
its channel, note count and the suggested instrument. Channel 10 defaults to
`drums`. Per-track flags are `N=value` and can repeat:

- `--track N=<instrument>` or `--track N=mute`
- `--volume N=0..1`, `--transpose N=<semitones>`
- `--speed 0.25..4` for the whole piece

Instruments: `square pulse25 pulse12 triangle saw organ flute strings brass piano pluck bell drums`.
Output is capped at 5 minutes.

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

## Rules of thumb

- Keep one-shot SFX under 1 s; lower `vol` for sounds that repeat often (`step`, `blip`).
- For repeated sounds, vary `seed` (noise) or play with `{ rate: 0.9 + Math.random() * 0.2 }`.
- Pick music by the scene's feeling first (`mood`), then try a few seeds.
- `npm test` must pass after any change to `src/`.
