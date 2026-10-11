// 弦樂群的取樣表（產生的，不是手寫的）：音號 → 每個音有哪幾個 take。
//
// 來源：VSCO 2 Community Edition — Violin/Viola/Cello Section, susvib（CC0 1.0）
// 三組分軌合起來：低音用大提琴組、中音用中提琴組、高音用小提琴組，共
// 26 個音（C2–D6）。音號**以量到的基頻為準**，
// 不看檔名（VSCO 的檔名有低一個八度的慣例）。產生方式見 tools/build-strings.mjs。
//
// 這一個是取樣庫裡原本沒有的樂器：GM 44-45／48-51（弦樂群、震音、撥奏）以前是依音域
// 借「獨奏」小提琴／大提琴／低音提琴，一個人拉一整組弦樂聽起來就是薄。
// 檔案在 repo 裡，跟鼓組、卡林巴、長笛一樣進 service worker 預快取。
export const STRINGS_INSTRUMENT = {
  label: '弦樂群',
  credit: 'VSCO 2 Community Edition — Violin/Viola/Cello Section, susvib（CC0 1.0）',
  synth: 'real:strings',
  base: 'samples/strings/',
  /** 相鄰錄音最多差幾個半音（中間的音用播放速率內插）。 */
  gap: 4,
  /** 每個音最多幾個 take（round robin 用）。 */
  takes: 2,
  notes: {
    36: { takes: ['36-a.mp3', '36-b.mp3'] },
    40: { takes: ['40-a.mp3', '40-b.mp3'] },
    43: { takes: ['43-a.mp3', '43-b.mp3'] },
    47: { takes: ['47-a.mp3', '47-b.mp3'] },
    48: { takes: ['48-a.mp3', '48-b.mp3'] },
    50: { takes: ['50-a.mp3', '50-b.mp3'] },
    52: { takes: ['52-a.mp3', '52-b.mp3'] },
    53: { takes: ['53-a.mp3', '53-b.mp3'] },
    55: { takes: ['55-a.mp3', '55-b.mp3'] },
    57: { takes: ['57-a.mp3', '57-b.mp3'] },
    59: { takes: ['59-a.mp3', '59-b.mp3'] },
    60: { takes: ['60-a.mp3', '60-b.mp3'] },
    62: { takes: ['62-a.mp3', '62-b.mp3'] },
    64: { takes: ['64-a.mp3', '64-b.mp3'] },
    65: { takes: ['65-a.mp3', '65-b.mp3'] },
    66: { takes: ['66-a.mp3', '66-b.mp3'] },
    67: { takes: ['67-a.mp3', '67-b.mp3'] },
    69: { takes: ['69-a.mp3', '69-b.mp3'] },
    71: { takes: ['71-a.mp3', '71-b.mp3'] },
    72: { takes: ['72-a.mp3', '72-b.mp3'] },
    74: { takes: ['74-a.mp3', '74-b.mp3'] },
    76: { takes: ['76-a.mp3', '76-b.mp3'] },
    77: { takes: ['77-a.mp3', '77-b.mp3'] },
    79: { takes: ['79-a.mp3', '79-b.mp3'] },
    83: { takes: ['83-a.mp3', '83-b.mp3'] },
    86: { takes: ['86-a.mp3', '86-b.mp3'] },
  },
};
