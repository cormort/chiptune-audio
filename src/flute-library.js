// 長笛的取樣表（產生的，不是手寫的）：音號 → 每個音有哪幾個 take（輪流用）。
//
// 來源：VSCO 2 Community Edition — Flute/susNV（CC0 1.0）
// 10 個音（C3–C6）、8 個音有兩個 take。轉檔方式與理由見 tools/build-flute.mjs。
//
// 這一份**覆蓋掉** src/sample-library.js 裡同名的遠端長笛（那個是 C4–C7、每個音一個 take）：
// 音域低一個八度才蓋得住旋律，兩個 take 輪替才不會「同一個音一模一樣」。
// 檔案在 repo 裡，跟鼓組與卡林巴一樣進 service worker 預快取。
export const FLUTE_INSTRUMENT = {
  label: '長笛',
  credit: 'VSCO 2 Community Edition — Flute/susNV（CC0 1.0）',
  synth: 'real:flute',
  base: 'samples/flute/',
  /** 相鄰錄音最多差幾個半音（C3 E3 A3 C4 E4 A4 C5 E5 A5 C6，中間的音用播放速率內插）。 */
  gap: 5,
  /** 每個音最多幾個 take（round robin 用）。 */
  takes: 2,
  notes: {
    60: { takes: ['60-a.mp3', '60-b.mp3'] },
    64: { takes: ['64-a.mp3', '64-b.mp3'] },
    69: { takes: ['69-a.mp3', '69-b.mp3'] },
    72: { takes: ['72-a.mp3', '72-b.mp3'] },
    76: { takes: ['76-a.mp3', '76-b.mp3'] },
    81: { takes: ['81-a.mp3', '81-b.mp3'] },
    84: { takes: ['84-a.mp3', '84-b.mp3'] },
    88: { takes: ['88-a.mp3', '88-b.mp3'] },
    93: { takes: ['93-a.mp3', '93-b.mp3'] },
    96: { takes: ['96-a.mp3'] },
  },
};
