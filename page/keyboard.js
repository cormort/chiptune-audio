// 電子琴頁面：樂器 → 設定 → 琴鍵。按住發聲、放開停止，可多指和弦。
// 四套音色（晶片／寫實合成／物理擬真鋼琴／真實錄音取樣）都是即時合成或即時取樣，
// 沒有預先算好的音檔；取樣那套是唯一會連網的：選到的樂器才抓樣本，抓過進 CacheStorage，
// 樣本還沒到時先用對應的合成音色代替。
import {
  ChiptuneAudio, INSTRUMENT_BANKS, INSTRUMENT_LABELS, instrumentNote, instrumentRelease, noteFreq,
  AcousticPiano, SampledInstruments, SAMPLE_LIBRARY, SAMPLE_CREDIT, sampleNames, sampleLabel, sampleSynth,
} from '../src/index.js';
import { $, prefs, registerServiceWorker } from './ui.js';

registerServiceWorker();

const audio = new ChiptuneAudio({ volume: prefs.get('volume', 0.6) });
const acousticPiano = new AcousticPiano(() => audio._ensure(), () => audio.master);
const sampled = new SampledInstruments(() => audio._ensure(), () => audio.master);

// 取樣樂器的名稱與中文名來自 src/sample-library.js（20 種真實錄音）。
const SAMPLE_NAMES = sampleNames();
const SAMPLE_LABELS = Object.fromEntries(SAMPLE_NAMES.map((n) => [n, sampleLabel(n)]));
// 物理擬真鋼琴自己一套 API（preset），所以這兩個庫各有自己的可選音色清單。
const ACOUSTIC_INSTRUMENTS = { standard: '標準鋼琴', mellow: '柔和琴音', bright: '明亮鋼琴' };
const BANKS = {
  chip: { label: '單一振盪器，8-bit 遊戲音色' },
  real: { label: '疊泛音、微走音與起音雜訊，接近真實樂器（小提琴、二胡、薩克斯風、大鍵琴…）' },
  acoustic: { label: '多泛音物理頻散與琴槌動態衰減，100% 離線純演算法溫潤琴音' },
  sample: { label: `真實樂器錄音，共 ${SAMPLE_NAMES.length} 種；選到才抓樣本，抓過就離線可用` },
};

/** 這一套音色庫有哪些位置（key）與顯示名稱。 */
const bankKeys = (b) => (b === 'sample' ? SAMPLE_NAMES
  : b === 'acoustic' ? Object.keys(ACOUSTIC_INSTRUMENTS)
    : Object.keys(INSTRUMENT_BANKS[b]));
const bankNames = (b) => (b === 'sample' ? SAMPLE_LABELS
  : b === 'acoustic' ? ACOUSTIC_INSTRUMENTS
    : INSTRUMENT_LABELS[b]);

let bank = null;
let instrument = 'square';

/** 選到取樣音色就開始抓它的樣本；抓過的從瀏覽器快取來，一個樂器只抓一次。 */
function loadSample(name = instrument) {
  if (bank !== 'sample' || !SAMPLE_LIBRARY[name]) return;
  const label = sampleLabel(name);
  const total = sampled.wanted(name);
  if (total > 0 && sampled.loaded(name) >= total) {
    $('bankHint').textContent = `${label}：${total} 個樣本就緒，離線也能彈`;
    return;
  }
  $('bankHint').textContent = `${label}：抓取樣本 0/${total}…`;
  sampled.load(name, {
    onProgress: (done, all) => {
      if (bank === 'sample' && instrument === name) $('bankHint').textContent = `${label}：抓取樣本 ${done}/${all}…`;
    },
  }).then((hit) => {
    if (bank !== 'sample' || instrument !== name) return;
    if (!hit || !hit.notes.length) {
      $('bankHint').textContent = `${label}：樣本抓不到（離線？），先用合成音色代替`;
      return;
    }
    const missed = hit.failed ? `，${hit.failed} 個抓不到` : '';
    $('bankHint').textContent = `${label}：${hit.notes.length} 個樣本就緒${missed}，離線也能彈 · ${SAMPLE_CREDIT}`;
  });
}

function buildInstruments() {
  const wrap = $('instruments');
  wrap.textContent = '';
  const names = bankNames(bank);
  for (const name of bankKeys(bank)) {
    const b = document.createElement('button');
    b.textContent = names[name] || name;
    b.dataset.name = name;
    if (bank === 'sample' && SAMPLE_LIBRARY[name]) b.title = `樣本：${SAMPLE_LIBRARY[name].credit}`;
    b.onclick = () => {
      instrument = name;
      paintInstruments();
      saveVoice();
      if (bank === 'sample') loadSample(name);   // 選到才抓，抓過不重抓
    };
    wrap.append(b);
  }
  paintInstruments();
}

function paintInstruments() {
  for (const b of $('instruments').children) {
    const on = b.dataset.name === instrument;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
}

function saveVoice() {
  prefs.patch({ bank, instrument });
}

/** 換一套音色庫：挑第一個可用音色（同名就沿用），取樣那套開始抓目前這個樂器。 */
function setBank(next) {
  if (bank === next || !BANKS[next]) return;
  bank = next;
  if (!bankKeys(bank).includes(instrument)) instrument = bankKeys(bank)[0];
  $('bankHint').textContent = BANKS[bank].label;
  for (const el of document.querySelectorAll('[data-bank]')) {
    const on = el.dataset.bank === bank;
    el.classList.toggle('on', on);
    el.setAttribute('aria-pressed', String(on));
  }
  buildInstruments();
  saveVoice();
  if (bank === 'sample') loadSample();   // 只抓目前選到的那個樂器
}

for (const el of document.querySelectorAll('[data-bank]')) {
  el.onclick = () => setBank(el.dataset.bank);
}

// 開場：套用上次的選擇（音色、音量、八度、標示）。取樣那套會抓上次用的那個樂器，
// 抓過就進 CacheStorage，離線開啟也一樣快。
setBank(BANKS[prefs.get('bank')] ? prefs.get('bank') : 'chip');
if (bankKeys(bank).includes(prefs.get('instrument'))) {
  instrument = prefs.get('instrument');
  paintInstruments();
  saveVoice();
  if (bank === 'sample') loadSample();   // setBank 先抓的是第一個，改回上次用的那一個
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// Tracker layout; index = semitones above the keyboard's lowest C.
const KEYMAP = ['z', 's', 'x', 'd', 'c', 'v', 'g', 'b', 'h', 'n', 'j', 'm',
                'q', '2', 'w', '3', 'e', 'r', '5', 't', '6', 'y', '7', 'u', 'i'];
// 簡譜: 1 = C; a dot above marks each octave above the keyboard's lowest one.
const NUMBERS = ['1', '#1', '2', '#2', '3', '4', '#4', '5', '#5', '6', '#6', '7'];
const OCTAVE_DOTS = ['', '·', '··'];
const keyEls = [];
const baseMidi = () => 12 * (+$('octave').value + 1);   // C4 = midi 60
const noteName = (n) => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);
{
  const WHITES = 15;   // two octaves plus the top C
  let white = 0;
  for (let i = 0; i < KEYMAP.length; i++) {
    const black = NOTE_NAMES[i % 12].includes('#');
    const el = document.createElement('div');
    el.className = `key ${black ? 'black' : 'white'}`;
    if (black) {
      el.style.left = `${(white - 0.3) / WHITES * 100}%`;
      el.style.width = `${0.6 / WHITES * 100}%`;
    } else {
      white++;
    }
    el.innerHTML = '<b></b><i></i><span></span>';
    el.dataset.i = i;
    keyEls.push(el);
    $('keys').append(el);
  }
}
function keyLabel(i) {
  switch ($('keyLabel').value) {
    case 'name': return NOTE_NAMES[i % 12];
    case 'num': return NUMBERS[i % 12];
    default: return KEYMAP[i].toUpperCase();
  }
}
function labelKeys() {
  keyEls.forEach((el, i) => {
    el.firstChild.textContent = i % 12 === 0 ? noteName(baseMidi() + i) : '';
    el.children[1].textContent = $('keyLabel').value === 'num' ? OCTAVE_DOTS[Math.floor(i / 12)] : '';
    el.lastChild.textContent = keyLabel(i);
  });
}

// A held note: which key, the engine handle, the instrument and bank it started
// with, and the fade to use when it is let go (so switching bank or instrument
// mid-chord still releases every note the right way).
const held = new Set();
function noteOn(i) {
  const n = baseMidi() + i;
  let voice = null;
  let release = null;      // null＝讓它自己響完（鋼琴、撥弦、鐘聲）
  if (bank === 'sample') {
    voice = sampled.playNote(instrument, n, { vel: 0.85 });
    if (voice) {
      release = 0.2;       // 取樣：放開就是悶掉（鋼琴的制音器）
    } else {
      // 樣本還沒到（第一次按，或離線）：先播對應的合成音色，按鍵不會沒聲音。
      const synth = sampleSynth(instrument);
      if (synth) {
        voice = audio.playNote(instrumentNote(synth, n, { vel: 0.85 }));
        release = instrumentRelease(synth);
      }
      loadSample();        // 順便開始抓，下一次按就是真的錄音
    }
  } else if (bank === 'acoustic') {
    voice = acousticPiano.playNote(n, { preset: instrument, vel: 0.85 });
    release = 0.22;
  } else {
    voice = audio.playNote(instrumentNote(instrument, n, { bank }));
    release = instrumentRelease(instrument, bank);
  }
  const note = { i, n, voice, instrument, bank, release };
  held.add(note);
  paintHeld();
  return note;
}
function noteOff(note) {
  if (!note || !held.delete(note)) return;
  if (note.voice && note.release !== null) note.voice.release(note.release);
  paintHeld();
}
function paintHeld() {
  const down = new Set([...held].map((h) => h.i));
  keyEls.forEach((el, i) => el.classList.toggle('down', down.has(i)));
  const notes = [...held].sort((a, b) => a.n - b.n);
  $('held').textContent = notes.map((h) => `${noteName(h.n)} ${noteFreq(h.n).toFixed(1)} Hz`).join(' · ');
}

// Pointer: one note per finger/mouse; dragging to another key moves the note.
const byPointer = new Map();
$('keys').onpointerdown = (e) => {
  const el = e.target.closest('.key');
  if (!el) return;
  el.releasePointerCapture?.(e.pointerId);   // touch captures to the key; release so pointerover reaches the others
  noteOff(byPointer.get(e.pointerId));
  byPointer.set(e.pointerId, noteOn(+el.dataset.i));
};
$('keys').onpointerover = (e) => {
  const cur = byPointer.get(e.pointerId);
  const el = e.target.closest('.key');
  if (!cur || !el || +el.dataset.i === cur.i) return;
  noteOff(cur);
  byPointer.set(e.pointerId, noteOn(+el.dataset.i));
};
const pointerEnd = (e) => { noteOff(byPointer.get(e.pointerId)); byPointer.delete(e.pointerId); };
addEventListener('pointerup', pointerEnd);
addEventListener('pointercancel', pointerEnd);

// Computer keyboard.
const byKey = new Map();
addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  // The target is not always an Element (a synthetic event on window, or a
  // browser that reports document), and typing in a control must not play notes.
  if (e.target && e.target.closest && e.target.closest('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  const i = KEYMAP.indexOf(k);
  if (i < 0 || byKey.has(k)) return;
  e.preventDefault();
  byKey.set(k, noteOn(i));
});
addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  noteOff(byKey.get(k));
  byKey.delete(k);
});
// Keys held while the window loses focus never get a keyup.
addEventListener('blur', () => {
  for (const note of [...held]) noteOff(note);
  byKey.clear();
  byPointer.clear();
});

// 設定：音量、八度、標示都留著（音色在上面一起存）。
$('volume').value = audio.volume;
$('octave').value = String(prefs.get('octave', 4));
$('keyLabel').value = prefs.get('keyLabel', 'key');
$('octave').onchange = () => { prefs.set('octave', +$('octave').value); labelKeys(); };
$('keyLabel').onchange = () => { prefs.set('keyLabel', $('keyLabel').value); labelKeys(); };
$('volume').oninput = (e) => { audio.setVolume(+e.target.value); prefs.set('volume', +e.target.value); };
labelKeys();
