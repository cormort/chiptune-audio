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

## 控制台（手動操作）

`index.html` 是手動試聽與調參的控制台：選預設音效、拉滑桿即時聽、看波形，
按「複製參數」把 JSON 貼進遊戲（`audio.playSfx({...})` 或加進 `SFX_PRESETS`）；
音樂可選情緒、種子、小節數。ES module 不能用 `file://` 開，要用 HTTP 服務：

```bash
npx serve .        # 或 python3 -m http.server
```

## Tests

`npm test`
