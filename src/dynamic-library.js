// 有力度層的取樣樂器（產生的，不是手寫的）：音高 → 力度層 → 檔名。
//
// 來源：VSCO 2 Community Edition（CC0 1.0）——小提琴 Solo Violin/Arco Vib、
// 大提琴 Cello Section/susvib、長笛 Flute/susNV。轉檔方式與理由見 tools/build-velocity.mjs
// 與 samples/velocity/README.md。
//
// 每一層：vel 是這一層的起點（0..1，由弱到強）、file 相對於 base。
// 每一層的音量都正規化到 0.7：層只負責音色（弱層真的比較暗），音量由播放時的
// 力度增益決定。播放時挑「不超過這個力度的最大 vel」，再乘上力度。
//
// 這一組覆蓋掉 src/sample-library.js 裡同名的遠端單層版本（見 src/samples.js 的合併）。

/** 有力度層的樂器，形狀跟 SAMPLE_LIBRARY 的項目一樣，但 notes 是陣列。 */
export const DYNAMIC_INSTRUMENTS = {
  violin: {
    label: '小提琴',
    credit: 'VSCO 2 Community Edition — Solo Violin, Arco Vib（CC0 1.0）',
    synth: 'real:violin',
    base: 'samples/velocity/violin/',
    gap: 4,
    layers: 2,
    notes: {
      55: [{ vel: 0, file: '55-p.mp3' }, { vel: 0.5, file: '55-f.mp3' }],
      57: [{ vel: 0, file: '57-p.mp3' }, { vel: 0.5, file: '57-f.mp3' }],
      60: [{ vel: 0, file: '60-p.mp3' }, { vel: 0.5, file: '60-f.mp3' }],
      64: [{ vel: 0, file: '64-p.mp3' }, { vel: 0.5, file: '64-f.mp3' }],
      67: [{ vel: 0, file: '67-p.mp3' }, { vel: 0.5, file: '67-f.mp3' }],
      69: [{ vel: 0, file: '69-p.mp3' }, { vel: 0.5, file: '69-f.mp3' }],
      72: [{ vel: 0, file: '72-p.mp3' }, { vel: 0.5, file: '72-f.mp3' }],
      76: [{ vel: 0, file: '76-p.mp3' }, { vel: 0.5, file: '76-f.mp3' }],
      79: [{ vel: 0, file: '79-p.mp3' }, { vel: 0.5, file: '79-f.mp3' }],
      81: [{ vel: 0, file: '81-p.mp3' }, { vel: 0.5, file: '81-f.mp3' }],
      84: [{ vel: 0, file: '84-p.mp3' }, { vel: 0.5, file: '84-f.mp3' }],
      88: [{ vel: 0, file: '88-p.mp3' }, { vel: 0.5, file: '88-f.mp3' }],
      91: [{ vel: 0, file: '91-p.mp3' }, { vel: 0.5, file: '91-f.mp3' }],
      93: [{ vel: 0, file: '93-p.mp3' }, { vel: 0.5, file: '93-f.mp3' }],
      96: [{ vel: 0, file: '96-p.mp3' }, { vel: 0.5, file: '96-f.mp3' }],
    },
  },
  cello: {
    label: '大提琴',
    credit: 'VSCO 2 Community Edition — Cello Section, susvib（CC0 1.0）',
    synth: 'real:cello',
    base: 'samples/velocity/cello/',
    gap: 4,
    layers: 2,
    notes: {
      24: [{ vel: 0, file: '24-p.mp3' }, { vel: 0.5, file: '24-f.mp3' }],
      28: [{ vel: 0, file: '28-p.mp3' }, { vel: 0.5, file: '28-f.mp3' }],
      31: [{ vel: 0, file: '31-p.mp3' }, { vel: 0.5, file: '31-f.mp3' }],
      35: [{ vel: 0, file: '35-p.mp3' }, { vel: 0.5, file: '35-f.mp3' }],
      38: [{ vel: 0, file: '38-p.mp3' }, { vel: 0.5, file: '38-f.mp3' }],
      41: [{ vel: 0, file: '41-p.mp3' }, { vel: 0.5, file: '41-f.mp3' }],
      45: [{ vel: 0, file: '45-p.mp3' }, { vel: 0.5, file: '45-f.mp3' }],
      48: [{ vel: 0, file: '48-p.mp3' }, { vel: 0.5, file: '48-f.mp3' }],
      52: [{ vel: 0, file: '52-p.mp3' }, { vel: 0.5, file: '52-f.mp3' }],
      55: [{ vel: 0, file: '55-p.mp3' }, { vel: 0.5, file: '55-f.mp3' }],
      59: [{ vel: 0, file: '59-p.mp3' }, { vel: 0.5, file: '59-f.mp3' }],
      62: [{ vel: 0, file: '62-p.mp3' }, { vel: 0.5, file: '62-f.mp3' }],
      65: [{ vel: 0, file: '65-p.mp3' }, { vel: 0.5, file: '65-f.mp3' }],
    },
  },
  trumpet: {
    label: '小號',
    credit: 'VSCO 2 Community Edition — Trumpet, sus（CC0 1.0）',
    synth: 'real:trumpet',
    base: 'samples/velocity/trumpet/',
    gap: 4,
    layers: 2,
    notes: {
      41: [{ vel: 0, file: '41-p.mp3' }, { vel: 0.5, file: '41-f.mp3' }],
      45: [{ vel: 0, file: '45-p.mp3' }, { vel: 0.5, file: '45-f.mp3' }],
      48: [{ vel: 0, file: '48-p.mp3' }, { vel: 0.5, file: '48-f.mp3' }],
      51: [{ vel: 0, file: '51-p.mp3' }, { vel: 0.5, file: '51-f.mp3' }],
      55: [{ vel: 0, file: '55-p.mp3' }, { vel: 0.5, file: '55-f.mp3' }],
      58: [{ vel: 0, file: '58-p.mp3' }, { vel: 0.5, file: '58-f.mp3' }],
      62: [{ vel: 0, file: '62-p.mp3' }, { vel: 0.5, file: '62-f.mp3' }],
      65: [{ vel: 0, file: '65-p.mp3' }, { vel: 0.5, file: '65-f.mp3' }],
      69: [{ vel: 0, file: '69-p.mp3' }, { vel: 0.5, file: '69-f.mp3' }],
      72: [{ vel: 0, file: '72-p.mp3' }, { vel: 0.5, file: '72-f.mp3' }],
    },
  },
};
