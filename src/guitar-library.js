// 木吉他與電吉他的取樣表（產生的，不是手寫的）：音號 → 力度層 → 檔名。
//
// 來源：Sharur Shinyguitar — Karoryfer Samples（CC0 1.0）
// 對應表（SFZ）與量測結果見 tools/build-guitar.mjs。
// 每一層正規化到同一個基準：**層負責音色、力度負責音量**（跟 samples/velocity/ 同一個規則）。
// 檔案在 repo 裡，跟鼓組、卡林巴、長笛、弦樂群一樣進 service worker 預快取。
export const GUITAR_INSTRUMENTS = {
  'guitar-acoustic': {
    label: '木吉他',
    credit: 'Sharur Shinyguitar — Karoryfer Samples（CC0 1.0）',
    synth: 'real:guitar',
    base: 'samples/guitar-acoustic/',
    gap: 6,
    layers: 3,
    notes: {
    37: [{ vel: 0, file: '37-v1.mp3' }, { vel: 0.33, file: '37-v2.mp3' }, { vel: 0.67, file: '37-v3.mp3' }],
    40: [{ vel: 0, file: '40-v1.mp3' }, { vel: 0.33, file: '40-v2.mp3' }, { vel: 0.67, file: '40-v3.mp3' }],
    42: [{ vel: 0, file: '42-v1.mp3' }, { vel: 0.33, file: '42-v2.mp3' }, { vel: 0.67, file: '42-v3.mp3' }],
    45: [{ vel: 0, file: '45-v1.mp3' }, { vel: 0.33, file: '45-v2.mp3' }, { vel: 0.67, file: '45-v3.mp3' }],
    48: [{ vel: 0, file: '48-v1.mp3' }, { vel: 0.33, file: '48-v2.mp3' }, { vel: 0.67, file: '48-v3.mp3' }],
    51: [{ vel: 0, file: '51-v1.mp3' }, { vel: 0.33, file: '51-v2.mp3' }, { vel: 0.67, file: '51-v3.mp3' }],
    54: [{ vel: 0, file: '54-v1.mp3' }, { vel: 0.33, file: '54-v2.mp3' }, { vel: 0.67, file: '54-v3.mp3' }],
    57: [{ vel: 0, file: '57-v1.mp3' }, { vel: 0.33, file: '57-v2.mp3' }, { vel: 0.67, file: '57-v3.mp3' }],
    63: [{ vel: 0, file: '63-v1.mp3' }, { vel: 0.33, file: '63-v2.mp3' }, { vel: 0.67, file: '63-v3.mp3' }],
    66: [{ vel: 0, file: '66-v1.mp3' }, { vel: 0.33, file: '66-v2.mp3' }, { vel: 0.67, file: '66-v3.mp3' }],
    69: [{ vel: 0, file: '69-v1.mp3' }, { vel: 0.33, file: '69-v2.mp3' }, { vel: 0.67, file: '69-v3.mp3' }],
    72: [{ vel: 0, file: '72-v1.mp3' }, { vel: 0.33, file: '72-v2.mp3' }, { vel: 0.67, file: '72-v3.mp3' }],
    75: [{ vel: 0, file: '75-v1.mp3' }, { vel: 0.33, file: '75-v2.mp3' }, { vel: 0.67, file: '75-v3.mp3' }],
    78: [{ vel: 0, file: '78-v1.mp3' }, { vel: 0.33, file: '78-v2.mp3' }, { vel: 0.67, file: '78-v3.mp3' }],
    81: [{ vel: 0, file: '81-v1.mp3' }, { vel: 0.33, file: '81-v2.mp3' }, { vel: 0.67, file: '81-v3.mp3' }],
    84: [{ vel: 0, file: '84-v1.mp3' }, { vel: 0.33, file: '84-v2.mp3' }, { vel: 0.67, file: '84-v3.mp3' }],
    },
  },
  'guitar-electric': {
    label: '電吉他',
    credit: 'Sharur Shinyguitar — Karoryfer Samples（CC0 1.0）',
    synth: 'real:guitar',
    base: 'samples/guitar-electric/',
    gap: 6,
    layers: 3,
    notes: {
    37: [{ vel: 0, file: '37-v1.mp3' }, { vel: 0.33, file: '37-v2.mp3' }, { vel: 0.67, file: '37-v3.mp3' }],
    40: [{ vel: 0, file: '40-v1.mp3' }, { vel: 0.33, file: '40-v2.mp3' }, { vel: 0.67, file: '40-v3.mp3' }],
    42: [{ vel: 0, file: '42-v1.mp3' }, { vel: 0.33, file: '42-v2.mp3' }, { vel: 0.67, file: '42-v3.mp3' }],
    45: [{ vel: 0, file: '45-v1.mp3' }, { vel: 0.33, file: '45-v2.mp3' }, { vel: 0.67, file: '45-v3.mp3' }],
    48: [{ vel: 0, file: '48-v1.mp3' }, { vel: 0.33, file: '48-v2.mp3' }, { vel: 0.67, file: '48-v3.mp3' }],
    51: [{ vel: 0, file: '51-v1.mp3' }, { vel: 0.33, file: '51-v2.mp3' }, { vel: 0.67, file: '51-v3.mp3' }],
    54: [{ vel: 0, file: '54-v1.mp3' }, { vel: 0.33, file: '54-v2.mp3' }, { vel: 0.67, file: '54-v3.mp3' }],
    57: [{ vel: 0, file: '57-v1.mp3' }, { vel: 0.33, file: '57-v2.mp3' }, { vel: 0.67, file: '57-v3.mp3' }],
    63: [{ vel: 0, file: '63-v1.mp3' }, { vel: 0.33, file: '63-v2.mp3' }, { vel: 0.67, file: '63-v3.mp3' }],
    66: [{ vel: 0, file: '66-v1.mp3' }, { vel: 0.33, file: '66-v2.mp3' }, { vel: 0.67, file: '66-v3.mp3' }],
    69: [{ vel: 0, file: '69-v1.mp3' }, { vel: 0.33, file: '69-v2.mp3' }, { vel: 0.67, file: '69-v3.mp3' }],
    72: [{ vel: 0, file: '72-v1.mp3' }, { vel: 0.33, file: '72-v2.mp3' }, { vel: 0.67, file: '72-v3.mp3' }],
    75: [{ vel: 0, file: '75-v1.mp3' }, { vel: 0.33, file: '75-v2.mp3' }, { vel: 0.67, file: '75-v3.mp3' }],
    78: [{ vel: 0, file: '78-v1.mp3' }, { vel: 0.33, file: '78-v2.mp3' }, { vel: 0.67, file: '78-v3.mp3' }],
    81: [{ vel: 0, file: '81-v1.mp3' }, { vel: 0.33, file: '81-v2.mp3' }, { vel: 0.67, file: '81-v3.mp3' }],
    84: [{ vel: 0, file: '84-v1.mp3' }, { vel: 0.33, file: '84-v2.mp3' }, { vel: 0.67, file: '84-v3.mp3' }],
    },
  },
};
