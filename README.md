# chiptune-audio

Zero-dependency 8-bit sound effect and music engine for browser games, built on the Web Audio API.

- **SFX**: sfxr-style parametric synthesis (square / saw / triangle / noise, pitch slide, arpeggio, vibrato, bit-crush) with 9 presets: `coin jump laser hit explosion powerup select gameover win`.
- **Music**: seeded procedural loops (square lead + triangle bass + noise drums). Same seed and mood always give the same song. Moods: `happy`, `calm`, `tense`, `sad`.
- The synthesis core renders to plain `Float32Array`, so it is testable in Node; only `ChiptuneAudio` touches Web Audio.

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

Serve the folder over HTTP (e.g. `npx serve`) and open `demo.html` to try it.

## Tests

`npm test`
