// 卡林巴琴（kalimba／拇指琴）的模型：簧片排列、幾何、按鍵對應、調性與示範曲。
//
// 這裡沒有 DOM、沒有音訊，只有資料與算式——跟 src/pianoroll.js 同一個分工：畫面上的
// 每一個座標都算得出來、測得起來，page/kalimba.js 只負責把它畫出來、接事件。
//
// 17 音卡林巴的排列不是低音到高音排一排：**最長（最低）的那一根在正中間**，往兩邊
// 交替升高（左邊 D4、右邊 E4，再左邊 F4、右邊 G4…），兩邊各 8 根。所以左右手的拇指
// 各自負責由中心往外的那一串——這也是為什麼畫出來會是一個 V 字（中間最長）。
//
// 音域：MIDI 60（中央 C）到 88（E6），就是 samples/kalimba/ 裡 17 個錄音的音高。

/** 17 根簧片由左到右的音號。中間（索引 8）是最低音 C4，往兩邊交替升高。 */
export const KALIMBA_TINES = [86, 83, 79, 76, 72, 69, 65, 62, 60, 64, 67, 71, 74, 77, 81, 84, 88];

/** 中央那一根（最長、最低）在 KALIMBA_TINES 裡的位置。 */
export const KALIMBA_CENTER = 8;

/** 每一根簧片的電腦按鍵：數字排 1–9 是左拇指那半邊（含中央），QWERTY 上排是右半邊。
 *  這樣左右手的位置跟畫面上一樣——數字鍵在鍵盤左邊、字母在右邊。 */
export const TINE_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i'];

/** 簡譜：簧片在 C 大調裡是第幾度是固定的，移調之後也一樣
 *  （調成 F 大調時「1」就是 F，簡譜不會變）。 */
const DEGREE_BY_PITCH_CLASS = ['1', '#1', '2', '#2', '3', '4', '#4', '5', '#5', '6', '#6', '7'];
const OCTAVE_DOTS = ['', '·', '··'];

/** 一根簧片的簡譜寫法（`1`、`3·`、`2··`）：中央 C 起算的第幾度，加上八度點。
 *  17 根簧片都是白鍵，所以只會出現 1–7；`#` 那幾個是給移調後的音名標示用的。 */
export function tineNumber(index) {
  const midi = KALIMBA_TINES[index];
  if (midi === undefined) return '';
  const semis = midi - 60;                       // 中央 C 起算
  return DEGREE_BY_PITCH_CLASS[semis % 12] + OCTAVE_DOTS[Math.floor(semis / 12)];
}

/** 移調（換調性）：這把琴的簧片是一組音階，整組移動就是換一個調。 */
export const KALIMBA_TUNINGS = [
  { id: 'C', label: 'C 大調', transpose: 0 },
  { id: 'G', label: 'G 大調', transpose: 7 },
  { id: 'F', label: 'F 大調', transpose: 5 },
  { id: 'D', label: 'D 大調', transpose: 2 },
  { id: 'Bb', label: 'B♭ 大調', transpose: -2 },
  { id: 'Eb', label: 'E♭ 大調', transpose: 3 },
];

/** 這一根簧片在指定調性下的音號。`transpose` 由 KALIMBA_TUNINGS 提供。 */
export function tineNote(index, transpose = 0) {
  const midi = KALIMBA_TINES[index];
  return midi === undefined ? null : midi + (Number.isFinite(transpose) ? Math.round(transpose) : 0);
}

/** 這個音號落在哪一根簧片上（-1＝不在這把琴上）。 */
export function tineIndexFor(midi) {
  return KALIMBA_TINES.indexOf(midi);
}

/** 這個按鍵是哪一根簧片（-1＝不是）。 */
export function tineForKey(key) {
  return TINE_KEYS.indexOf(String(key).toLowerCase());
}

const freqOf = (midi) => 440 * 2 ** ((midi - 69) / 12);

/** 簧片的長度比：自由棒的頻率與長度的平方成反比（f ∝ 1/L²），所以長度 ∝ 1/√f。
 *  最長（中央 C4）＝1，最短（E6）≈0.45——畫面上那個 V 字的比例就是這樣來的，
 *  不是隨手挑的縮放。 */
export function tineLength(midi) {
  const longest = freqOf(KALIMBA_TINES[KALIMBA_CENTER]);
  return Math.sqrt(longest / freqOf(midi));
}

/** 畫一把琴要的每一個座標（都正規化到 0..1，頁面自己乘上寬高）。
 *  `x` 是這一根簧片的中心、`length` 是相對長度（中央＝1）。 */
export function tinePositions() {
  return KALIMBA_TINES.map((midi, index) => ({
    index,
    midi,
    side: index < KALIMBA_CENTER ? 'L' : index > KALIMBA_CENTER ? 'R' : 'C',
    x: (index + 0.5) / KALIMBA_TINES.length,
    length: tineLength(midi),
    key: TINE_KEYS[index],
    number: tineNumber(index),
  }));
}

/** 撥在簧片哪裡：0＝靠近琴橋（短、悶），1＝靠近尾端（長、飽）。
 *  真實的卡林巴是這樣：撥尾端振幅大、聲音大，撥靠近琴橋只有細細一聲。
 *  回傳 0.55–1 的力度（再小聲就不像卡林巴了）。 */
export function velocityAt(positionY) {
  const t = Number.isFinite(positionY) ? Math.min(1, Math.max(0, positionY)) : 1;
  return 0.55 + 0.45 * t;
}

/** 示範曲：`notes` 是 [簧片索引, 第幾拍, 幾拍長]。
 *  兩首都是 17 音 C 大調卡林巴彈得出來的東西——卡林巴只有 17 根簧片，音域外的旋律
 *  本來就彈不了，所以不挑音域不合的曲子。 */
export const KALIMBA_DEMOS = [
  {
    id: 'twinkle',
    label: '小星星',
    bpm: 96,
    notes: [
      [8, 0, 1], [8, 1, 1], [10, 2, 1], [10, 3, 1], [5, 4, 1], [5, 5, 1], [10, 6, 2],
      [6, 8, 1], [6, 9, 1], [9, 10, 1], [9, 11, 1], [7, 12, 1], [7, 13, 1], [8, 14, 2],
    ],
  },
  {
    id: 'arpeggio',
    label: '琶音練習',
    bpm: 84,
    // C–Am–F–G，每小節八個八分音符：低音在左拇指、和弦音在右拇指，最後停在 C
    notes: [
      [8, 0, 0.5], [10, 0.5, 0.5], [9, 1, 0.5], [15, 1.5, 0.5], [9, 2, 0.5], [10, 2.5, 0.5], [8, 3, 0.5], [10, 3.5, 0.5],
      [5, 4, 0.5], [9, 4.5, 0.5], [14, 5, 0.5], [4, 5.5, 0.5], [9, 6, 0.5], [14, 6.5, 0.5], [5, 7, 0.5], [9, 7.5, 0.5],
      [6, 8, 0.5], [4, 8.5, 0.5], [14, 9, 0.5], [13, 9.5, 0.5], [14, 10, 0.5], [4, 10.5, 0.5], [6, 11, 0.5], [4, 11.5, 0.5],
      [10, 12, 0.5], [11, 12.5, 0.5], [12, 13, 0.5], [2, 13.5, 0.5], [12, 14, 0.5], [11, 14.5, 0.5], [10, 15, 0.5], [2, 15.5, 0.5],
      [8, 16, 1], [15, 16, 1], [8, 18, 2],
    ],
  },
];

/** 示範曲的總長度（秒）。 */
export function demoSeconds(demo) {
  const last = demo.notes.reduce((m, [, at, dur]) => Math.max(m, at + dur), 0);
  return (last * 60) / demo.bpm + 0.5;
}
