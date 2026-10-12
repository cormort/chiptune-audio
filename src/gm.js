// Which voice a MIDI part should use, from the two numbers a Standard MIDI File
// carries: the program change (a General MIDI instrument number) and the pitches
// the part actually plays.
//
// `parseMidi` already suggests something for each track, but only from the chip
// bank — a 12-track file then lands on twelve chip voices and every part has to
// be picked by hand. This is the same idea pointed at the best voice available:
// a real recording (`sampled:`) when the library has one for that family, the
// realistic synth (`real:`) when it does not, and the chip voice as the last
// resort. Nothing here is a guess about taste — the families are GM's, and the
// range thresholds are the instruments' own ranges.
import { SAMPLE_LIBRARY } from './samples.js';
import { SAMPLE_KIT } from './drums.js';

/** Ranges are inclusive GM program numbers; the first match wins.
 *  `sampled` names an entry in SAMPLE_LIBRARY, `synth` a bank voice, `drums`
 *  sends the part to the percussion voice, and `byRange` picks between sampled
 *  instruments of one family using the pitches the part plays. */
const FAMILIES = [
  { from: 0, to: 7, family: '鋼琴', sampled: 'grand' },
  { from: 8, to: 9, family: '鐘琴', synth: 'real:bell' },
  { from: 10, to: 10, family: '音樂盒', synth: 'real:musicbox' },
  { from: 11, to: 11, family: '顫音琴', synth: 'real:vibraphone' },
  { from: 12, to: 14, family: '木琴', sampled: 'xylophone' },
  { from: 15, to: 15, family: '揚琴', synth: 'real:harpsichord' },
  { from: 16, to: 20, family: '管風琴', sampled: 'organ' },
  { from: 21, to: 23, family: '簧風琴', synth: 'real:accordion' },
  // 古典吉他（GM 24）：**沒有可用的 CC0 多層尼龍吉他**（sfzinstruments 整個組織沒有尼龍／
  // 古典吉他、VSCO 沒有撥弦類、Iowa MIS 的吉他頁已 404，現有那份 Freesound 尼龍是單層）。
  // 所以自動配音用鋼弦的 Shinyguitar 木吉他：三層真實力度、音域 C#2–C6，代價是鋼弦音色。
  // `sampled:guitar-nylon` 仍然留在取樣庫裡，想聽尼龍的人可以自己選。
  { from: 24, to: 24, family: '古典吉他', sampled: 'guitar-acoustic' },
  { from: 25, to: 27, family: '木吉他', sampled: 'guitar-acoustic' },
  { from: 28, to: 31, family: '電吉他', sampled: 'guitar-electric' },
  { from: 32, to: 32, family: '低音提琴', sampled: 'contrabass' },
  { from: 33, to: 39, family: '貝斯', sampled: 'bass-electric' },
  { from: 40, to: 41, family: '小提琴／中提琴', sampled: 'violin' },
  { from: 42, to: 42, family: '大提琴', sampled: 'cello' },
  { from: 43, to: 43, family: '低音提琴', sampled: 'contrabass' },
  // 弦樂群：現在有真正的分軌弦樂錄音（小提琴組＋中提琴組＋大提琴組），不再借獨奏樂器
  { from: 44, to: 45, family: '弦樂（震音／撥奏）', sampled: 'strings' },
  { from: 46, to: 46, family: '豎琴', sampled: 'harp' },
  { from: 47, to: 47, family: '定音鼓', drums: true },
  { from: 48, to: 51, family: '弦樂群', sampled: 'strings' },
  { from: 52, to: 54, family: '人聲', synth: 'real:choir' },
  { from: 55, to: 55, family: '樂團齊奏', synth: 'real:brass' },
  { from: 56, to: 56, family: '小號', sampled: 'trumpet' },
  { from: 57, to: 57, family: '長號', sampled: 'trombone' },
  { from: 58, to: 58, family: '低音號', sampled: 'tuba' },
  { from: 59, to: 59, family: '弱音小號', sampled: 'trumpet' },
  { from: 60, to: 60, family: '法國號', sampled: 'french-horn' },
  { from: 61, to: 63, family: '銅管群', byRange: 'brass', fallback: 'real:brass' },
  { from: 64, to: 67, family: '薩克斯風', sampled: 'saxophone' },
  { from: 68, to: 69, family: '雙簧管', synth: 'real:sax' },
  // 低音管的錄音只有一層（取樣庫並整併掉了），用它的合成代理音色
  { from: 70, to: 70, family: '低音管', synth: 'real:clarinet' },
  { from: 71, to: 71, family: '單簧管', sampled: 'clarinet' },
  { from: 72, to: 79, family: '長笛家族', sampled: 'flute' },
  // 合成音色本來就不是真樂器：留給合成庫，不要硬套一個錄音上去。
  { from: 80, to: 87, family: '合成主奏', synth: 'saw' },
  { from: 88, to: 95, family: '合成鋪底', synth: 'real:choir' },
  { from: 96, to: 103, family: '效果音', synth: 'triangle' },
  { from: 104, to: 104, family: '西塔琴', sampled: 'guitar-nylon' },
  { from: 105, to: 105, family: '斑鳩琴', sampled: 'guitar-acoustic' },
  { from: 106, to: 107, family: '三味線／箏', sampled: 'guitar-nylon' },
  // 卡林巴的代理音色（`synth`）寫在 src/kalimba-library.js 的項目裡，不是寫在這裡：
  // family 上的 `synth` 是「這個家族沒有錄音」，會在 `sampled` 之前被用掉。
  { from: 108, to: 108, family: '卡林巴', sampled: 'kalimba' },
  { from: 109, to: 109, family: '風笛', synth: 'real:accordion' },
  { from: 110, to: 110, family: '民謠提琴', sampled: 'violin' },
  { from: 111, to: 111, family: '嗩吶', synth: 'real:sax' },
  { from: 112, to: 119, family: '打擊樂', drums: true },
  { from: 120, to: 127, family: '音效', synth: 'triangle' },
];

/** A family that covers several instruments, told apart by the part's register.
 *  The numbers are the instruments' own ranges: below C3 is a bass instrument,
 *  below C4 a tenor one, above that the soprano member of the family. */
const BY_RANGE = {
  brass: [
    { below: 50, sampled: 'tuba' },
    { below: 58, sampled: 'trombone' },
    { sampled: 'trumpet' },
  ],
};

/** The pitch a part sits at: the median of its notes, or null when it has none. */
export function medianNote(notes) {
  if (!Array.isArray(notes) || !notes.length) return null;
  const sorted = notes.map((n) => n.note).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** How far a part reaches outside an instrument's *recorded* range, in semitones.
 *  0 means every note has a recording within reach. */
export function outOfRange(spec, notes) {
  if (!spec || !Array.isArray(notes) || !notes.length) return 0;
  const midis = Object.keys(spec.notes).map(Number);
  if (!midis.length) return 0;
  const lo = Math.min(...midis);
  const hi = Math.max(...midis);
  let worst = 0;
  for (const n of notes) worst = Math.max(worst, lo - n.note, n.note - hi);
  return Math.max(0, worst);
}

/** Beyond this much playback-rate shifting a recording stops being that instrument:
 *  the flute transposed six semitones down is a bass flute, and a contrabass lifted
 *  sixteen is not a contrabass at all. Measured per instrument by comparing the
 *  source's recorded range with the part's (see tools/analyze.mjs). */
export const MAX_SAMPLE_SHIFT = 3;

/** A sampled name resolved to a real one, with the two things the caller needs
 *  to know: which voice the recordings give (`sampled`) and whether they can
 *  actually cover the part's register (`fits`). A typo or a library change
 *  returns null, and the caller falls back to a synth voice instead. */
function sampledVoice(name, notes) {
  const spec = SAMPLE_LIBRARY[name];
  if (!spec) return null;
  const shift = outOfRange(spec, notes);
  return { sampled: `sampled:${name}`, synth: spec.synth, fits: shift <= MAX_SAMPLE_SHIFT, outOfRange: shift };
}

/**
 * The voice to use for one part.
 * @param {number} program General MIDI program number, 0..127.
 * @param {{ notes?: { note: number }[], samples?: boolean }} [opts] `notes` is the
 *   part, used to pick between instruments of one family; `samples: false` keeps
 *   the answer to voices that need no download (the CLI, which cannot fetch).
 * @returns {{ instrument: string, family: string, sampled: boolean }}
 */
export function gmInstrument(program, opts = {}) {
  const { notes = null, samples = true } = opts;
  const p = Number.isFinite(program) ? Math.min(127, Math.max(0, Math.round(program))) : 0;
  const fam = FAMILIES.find((f) => p >= f.from && p <= f.to) || FAMILIES[0];
  const say = (instrument, sampled, outOfRange = 0) => ({ instrument, family: fam.family, sampled, outOfRange });

  if (fam.drums) return say('drums', false);
  if (fam.synth) return say(fam.synth, false);          // 合成庫的名字本來就不用下載

  if (fam.byRange) {
    const mid = medianNote(notes);
    const steps = BY_RANGE[fam.byRange];
    // 沒有音符可用時取家族的中間那一項，不要因為沒資訊就挑到極端
    const first = mid === null ? steps[Math.floor(steps.length / 2)] : steps.find((s) => mid < s.below) || steps[steps.length - 1];
    const firstVoice = sampledVoice(first.sampled, notes);
    // CLI（samples: false）走的是合成音色：那個沒有音域限制，所以照音域挑成員就好
    if (!samples) return say(firstVoice ? firstVoice.synth : fam.fallback || 'piano', false);
    if (firstVoice && firstVoice.fits) return say(firstVoice.sampled, true, firstVoice.outOfRange);
    // 錄音蓋不到這條軌的音域：往同一個家族的其他成員找一個蓋得住的
    // （低音提琴蓋不到的高音旋律交給小提琴，而不是硬拉 16 個半音）
    for (const step of steps) {
      if (step === first) continue;
      const voice = sampledVoice(step.sampled, notes);
      if (voice && voice.fits) return say(voice.sampled, true, voice.outOfRange);
    }
    // 整個家族都沒有一把蓋得住（例如橫跨 4.7 個八度的弦樂群）：用家族的合成音色。
    // 它沒有音域限制，也不會把某個音拉高 37 個半音。
    return say(fam.fallback || (firstVoice && firstVoice.synth) || 'piano', false, firstVoice ? firstVoice.outOfRange : 0);
  }

  const voice = sampledVoice(fam.sampled, notes);
  if (!voice) return say(fam.synth || 'piano', false);
  return samples && voice.fits
    ? say(voice.sampled, true, voice.outOfRange)
    : say(voice.synth, false, voice.outOfRange);
}

/**
 * One suggestion per track of a `parseMidi()` result, in track order — what the
 * console's「重新配音色」button and the CLI's `--auto` apply.
 * @param {{ tracks: { channel: number, program: number, notes: { note: number }[] }[] }} midi
 * @param {{ samples?: boolean }} [opts]
 */
export function autoInstruments(midi, opts = {}) {
  if (!midi || !Array.isArray(midi.tracks)) return [];
  return midi.tracks.map((t, i) => {
    // 第 10 聲道是打擊樂：GM 的 program 在那裡沒有意義，一律走鼓。有取樣鼓組時
    // 用真實鼓組（35-84 幾乎都有錄音），不然退回晶片鼓。
    const hit = t.channel === 9
      ? (opts.samples === false
        ? { instrument: 'drums', family: '打擊樂（第 10 聲道）', sampled: false }
        : { instrument: SAMPLE_KIT, family: '打擊樂（第 10 聲道）', sampled: true })
      : gmInstrument(t.program, { notes: t.notes, samples: opts.samples });
    return { ...hit, track: i + 1 };
  });
}
