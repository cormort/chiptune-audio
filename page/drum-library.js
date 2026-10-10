// 真實鼓組的資料表（產生的，不是手寫的）：GM 打擊樂音 → 力度層與檔名。
//
// 來源：Virtuosity Drums（Versilian Studios × Karoryfer Samples，CC0 1.0）——
// 轉檔方式與授權見 samples/drums/README.md 與 tools/build-drums.mjs。
// 每個擊點的峰值都正規化到 0.9，所以這裡的 gain 是「這個擊點在整套鼓裡該多大聲」，
// 播放時再乘上力度；力度層只改變音色，不是音量。
//
// 檔案放 samples/drums/：跟 repo 同源、進 service worker 快取，所以第一次打就響、離線也能打。

/** 一個力度層：vel 是這一層的起點（0..1，由弱到強），gain 是這個擊點的基準音量，
 *  files 是同一個力度下的幾個錄音（round robin，播放時輪流用，連續打才不會像機器）。 */
export const DRUM_KIT = {
  name: 'kit',
  label: '真實鼓組',
  credit: 'Virtuosity Drums — Versilian Studios × Karoryfer Samples（CC0 1.0）',
  base: 'samples/drums/',
  /** 沒有取樣的 GM 打擊樂音：播放時退回合成鼓，不會變成靜音。 */
  missing: [52, 65, 66, 76, 77, 78, 79, 85, 86, 87],
  notes: {
    35: [{ vel: 0, gain: 1, files: ['35-v1.mp3'] }, { vel: 0.5, gain: 1, files: ['35-v2.mp3'] }],
    36: [{ vel: 0, gain: 1, files: ['36-v1-r1.mp3', '36-v1-r2.mp3'] }, { vel: 0.333, gain: 1, files: ['36-v2-r1.mp3', '36-v2-r2.mp3'] }, { vel: 0.667, gain: 1, files: ['36-v3-r1.mp3', '36-v3-r2.mp3'] }],
    37: [{ vel: 0, gain: 0.75, files: ['37-v1.mp3'] }, { vel: 0.5, gain: 0.75, files: ['37-v2.mp3'] }],
    38: [{ vel: 0, gain: 0.95, files: ['38-v1-r1.mp3', '38-v1-r2.mp3'] }, { vel: 0.25, gain: 0.95, files: ['38-v2-r1.mp3', '38-v2-r2.mp3'] }, { vel: 0.5, gain: 0.95, files: ['38-v3-r1.mp3', '38-v3-r2.mp3'] }, { vel: 0.75, gain: 0.95, files: ['38-v4-r1.mp3', '38-v4-r2.mp3'] }],
    39: [{ vel: 0, gain: 0.9, files: ['39-v1.mp3'] }, { vel: 0.5, gain: 0.9, files: ['39-v2.mp3'] }],
    40: [{ vel: 0, gain: 0.8, files: ['40-v1.mp3'] }, { vel: 0.5, gain: 0.8, files: ['40-v2.mp3'] }],
    41: [{ vel: 0, gain: 0.85, files: ['41-v1.mp3'] }, { vel: 0.5, gain: 0.85, files: ['41-v2.mp3'] }],
    42: [{ vel: 0, gain: 0.65, files: ['42-v1-r1.mp3', '42-v1-r2.mp3'] }, { vel: 0.333, gain: 0.65, files: ['42-v2-r1.mp3', '42-v2-r2.mp3'] }, { vel: 0.667, gain: 0.65, files: ['42-v3-r1.mp3', '42-v3-r2.mp3'] }],
    43: [{ vel: 0, gain: 0.85, files: ['43-v1.mp3'] }, { vel: 0.5, gain: 0.85, files: ['43-v2.mp3'] }],
    44: [{ vel: 0, gain: 0.6, files: ['44-v1-r1.mp3', '44-v1-r2.mp3'] }, { vel: 0.5, gain: 0.6, files: ['44-v2-r1.mp3', '44-v2-r2.mp3'] }],
    45: [{ vel: 0, gain: 0.8, files: ['45-v1.mp3'] }, { vel: 0.5, gain: 0.8, files: ['45-v2.mp3'] }],
    46: [{ vel: 0, gain: 0.7, files: ['46-v1-r1.mp3', '46-v1-r2.mp3'] }, { vel: 0.333, gain: 0.7, files: ['46-v2-r1.mp3', '46-v2-r2.mp3'] }, { vel: 0.667, gain: 0.7, files: ['46-v3-r1.mp3', '46-v3-r2.mp3'] }],
    47: [{ vel: 0, gain: 0.8, files: ['47-v1.mp3'] }, { vel: 0.5, gain: 0.8, files: ['47-v2.mp3'] }],
    48: [{ vel: 0, gain: 0.85, files: ['48-v1.mp3'] }, { vel: 0.5, gain: 0.85, files: ['48-v2.mp3'] }],
    49: [{ vel: 0, gain: 0.75, files: ['49-v1.mp3'] }, { vel: 0.333, gain: 0.75, files: ['49-v2.mp3'] }, { vel: 0.667, gain: 0.75, files: ['49-v3.mp3'] }],
    50: [{ vel: 0, gain: 0.85, files: ['50-v1.mp3'] }, { vel: 0.5, gain: 0.85, files: ['50-v2.mp3'] }],
    51: [{ vel: 0, gain: 0.6, files: ['51-v1.mp3'] }, { vel: 0.333, gain: 0.6, files: ['51-v2.mp3'] }, { vel: 0.667, gain: 0.6, files: ['51-v3.mp3'] }],
    53: [{ vel: 0, gain: 0.6, files: ['53-v1.mp3'] }, { vel: 0.5, gain: 0.6, files: ['53-v2.mp3'] }],
    54: [{ vel: 0, gain: 0.55, files: ['54-v1.mp3'] }, { vel: 0.5, gain: 0.55, files: ['54-v2.mp3'] }],
    55: [{ vel: 0, gain: 0.7, files: ['55-v1.mp3'] }, { vel: 0.5, gain: 0.7, files: ['55-v2.mp3'] }],
    56: [{ vel: 0, gain: 0.5, files: ['56-v1.mp3'] }, { vel: 0.5, gain: 0.5, files: ['56-v2.mp3'] }],
    57: [{ vel: 0, gain: 0.7, files: ['57-v1.mp3'] }, { vel: 0.5, gain: 0.7, files: ['57-v2.mp3'] }],
    58: [{ vel: 0, gain: 0.6, files: ['58-v1.mp3'] }],
    59: [{ vel: 0, gain: 0.6, files: ['59-v1.mp3'] }, { vel: 0.5, gain: 0.6, files: ['59-v2.mp3'] }],
    60: [{ vel: 0, gain: 0.7, files: ['60-v1.mp3'] }, { vel: 0.5, gain: 0.7, files: ['60-v2.mp3'] }],
    61: [{ vel: 0, gain: 0.7, files: ['61-v1.mp3'] }, { vel: 0.5, gain: 0.7, files: ['61-v2.mp3'] }],
    62: [{ vel: 0, gain: 0.7, files: ['62-v1.mp3'] }, { vel: 0.5, gain: 0.7, files: ['62-v2.mp3'] }],
    63: [{ vel: 0, gain: 0.75, files: ['63-v1.mp3'] }, { vel: 0.5, gain: 0.75, files: ['63-v2.mp3'] }],
    64: [{ vel: 0, gain: 0.75, files: ['64-v1.mp3'] }, { vel: 0.5, gain: 0.75, files: ['64-v2.mp3'] }],
    67: [{ vel: 0, gain: 0.55, files: ['67-v1.mp3'] }, { vel: 0.5, gain: 0.55, files: ['67-v2.mp3'] }],
    68: [{ vel: 0, gain: 0.55, files: ['68-v1.mp3'] }, { vel: 0.5, gain: 0.55, files: ['68-v2.mp3'] }],
    69: [{ vel: 0, gain: 0.4, files: ['69-v1.mp3'] }],
    70: [{ vel: 0, gain: 0.4, files: ['70-v1.mp3'] }, { vel: 0.5, gain: 0.4, files: ['70-v2.mp3'] }],
    71: [{ vel: 0, gain: 0.5, files: ['71-v1.mp3'] }],
    72: [{ vel: 0, gain: 0.5, files: ['72-v1.mp3'] }],
    73: [{ vel: 0, gain: 0.5, files: ['73-v1.mp3'] }],
    74: [{ vel: 0, gain: 0.5, files: ['74-v1.mp3'] }],
    75: [{ vel: 0, gain: 0.6, files: ['75-v1.mp3'] }, { vel: 0.5, gain: 0.6, files: ['75-v2.mp3'] }],
    80: [{ vel: 0, gain: 0.5, files: ['80-v1.mp3'] }, { vel: 0.5, gain: 0.5, files: ['80-v2.mp3'] }],
    81: [{ vel: 0, gain: 0.5, files: ['81-v1.mp3'] }, { vel: 0.5, gain: 0.5, files: ['81-v2.mp3'] }],
    82: [{ vel: 0, gain: 0.4, files: ['82-v1.mp3'] }],
    83: [{ vel: 0, gain: 0.45, files: ['83-v1.mp3'] }, { vel: 0.5, gain: 0.45, files: ['83-v2.mp3'] }],
    84: [{ vel: 0, gain: 0.45, files: ['84-v1.mp3'] }, { vel: 0.5, gain: 0.45, files: ['84-v2.mp3'] }],
  },
};
