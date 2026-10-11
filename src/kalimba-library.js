// 卡林巴琴（kalimba／拇指琴）的取樣表（產生的，不是手寫的）：音號 → 檔名。
//
// 來源：Moozica 17 音卡林巴 — Simone Piervergili 錄音（CC0 1.0）
// 17 根簧片一個錄音，涵蓋 MIDI 60（中央 C）到 88（E6）——就是一把 17 音卡林巴的音域。
// 轉檔方式與理由見 tools/build-kalimba.mjs 與 samples/kalimba/README.md。
//
// 形狀跟 src/sample-library.js 的遠端樂器一樣（單層，notes 是「音號 → 檔名」），
// 差別是檔案在 repo 裡、跟鼓組一樣進 service worker 預快取：這把琴是模擬器頁面的主角，
// 不該第一次打開還要等網路。
export const KALIMBA_INSTRUMENT = {
  label: '卡林巴琴',
  credit: 'Moozica 17 音卡林巴 — Simone Piervergili 錄音（CC0 1.0）',
  synth: 'real:kalimba',
  base: 'samples/kalimba/',
  /** 相鄰錄音最多差幾個半音（簧片是音階排列，中間的音用播放速率內插，最多 1 個半音）。 */
  gap: 2,
  notes: {
    60: '60.mp3',
    62: '62.mp3',
    64: '64.mp3',
    65: '65.mp3',
    67: '67.mp3',
    69: '69.mp3',
    71: '71.mp3',
    72: '72.mp3',
    74: '74.mp3',
    76: '76.mp3',
    77: '77.mp3',
    79: '79.mp3',
    81: '81.mp3',
    83: '83.mp3',
    84: '84.mp3',
    86: '86.mp3',
    88: '88.mp3',
  },
};

/** 來源與量測結果（給測試與文件用）。`cents` 是校正前後與平均律的差。 */
export const KALIMBA_SOURCE = {
  repo: 'NeoSoundFonts/SimonePiervergili-Kalimba',
  license: 'CC0 1.0',
  /** 來源檔名低一個八度（C3.wav 錄的是 MIDI 60）：以 SFZ 的 pitch_keycenter 為準。 */
  files: {
    60: 'C3.wav',
    62: 'D3.wav',
    64: 'E3.wav',
    65: 'F3.wav',
    67: 'G3.wav',
    69: 'A3.wav',
    71: 'B3.wav',
    72: 'C4.wav',
    74: 'D4.wav',
    76: 'E4.wav',
    77: 'F4.wav',
    79: 'G4.wav',
    81: 'A4.wav',
    83: 'B4.wav',
    84: 'C5.wav',
    86: 'D5.wav',
    88: 'E5.wav',
  },
  /** 每一根簧片量到的基頻、校正前後的音分差與實際套用的重取樣倍率。 */
  tuning: {
    60: { hz: 262.75, cents: 7.4, ratio: 0.99572 },
    62: { hz: 295.12, cents: 8.5, ratio: 0.99508 },
    64: { hz: 329.59, cents: -0.2, ratio: 1.00011 },
    65: { hz: 350.47, cents: 6.1, ratio: 0.99646 },
    67: { hz: 392.84, cents: 3.7, ratio: 0.99786 },
    69: { hz: 441.93, cents: 7.6, ratio: 0.99563 },
    71: { hz: 494.25, cents: 1.3, ratio: 0.99926 },
    72: { hz: 525.92, cents: 8.8, ratio: 0.99492 },
    74: { hz: 588.57, cents: 3.7, ratio: 0.99789 },
    76: { hz: 666.44, cents: 18.8, ratio: 0.98922 },
    77: { hz: 703.97, cents: 13.6, ratio: 0.99216 },
    79: { hz: 793.48, cents: 20.8, ratio: 0.98804 },
    81: { hz: 887.31, cents: 14.3, ratio: 0.99176 },
    83: { hz: 998.09, cents: 18.0, ratio: 0.98966 },
    84: { hz: 1056.34, cents: 16.2, ratio: 0.99069 },
    86: { hz: 1181.71, cents: 10.4, ratio: 0.99403 },
    88: { hz: 1335.47, cents: 22.1, ratio: 0.98730 },
  },
};
