// 電子琴頁面：樂器 → 設定 → 琴鍵。按住發聲、放開停止，可多指和弦。
// 四套音色（晶片／寫實合成／物理擬真鋼琴／真實平台鋼琴取樣）都是即時合成或即時取樣，
// 沒有預先算好的音檔；選到取樣那套時才向網路抓取樣本（抓過就進 CacheStorage，離線可用）。
import {
  ChiptuneAudio, INSTRUMENT_BANKS, INSTRUMENT_LABELS, instrumentNote, instrumentRelease, noteFreq,
  AcousticPiano, SampledPiano,
} from '../src/index.js';
import { $, prefs, registerServiceWorker } from './ui.js';

registerServiceWorker();

const audio = new ChiptuneAudio({ volume: prefs.get('volume', 0.6) });
const acousticPiano = new AcousticPiano(() => audio._ensure(), () => audio.master);
const sampledPiano = new SampledPiano(() => audio._ensure(), () => audio.master);

// 取樣鋼琴的名稱掛在另一套 API 上，所以各有一套可選音色清單。
const ACOUSTIC_INSTRUMENTS = { standard: '標準鋼琴', mellow: '柔和琴音', bright: '明亮鋼琴' };
const SAMPLE_INSTRUMENTS = { grand: 'Yamaha C5 平台鋼琴' };
const BANKS = {
  chip: { label: '單一振盪器，8-bit 遊戲音色' },
  real: { label: '疊泛音、微走音與起音雜訊，接近真實樂器' },
  acoustic: { label: '多泛音物理頻散與琴槌動態衰減，100% 離線純演算法溫潤琴音' },
  sample: { label: '準備載入真實平台鋼琴取樣（支援 CacheStorage 永久離線快取）...' },
};

/** 這一套音色庫有哪些位置（key）與顯示名稱。 */
const bankKeys = (b) => (b === 'acoustic' || b === 'sample' ? Object.keys(bankNames(b)) : Object.keys(INSTRUMENT_BANKS[b]));
const bankNames = (b) => (b === 'acoustic' ? ACOUSTIC_INSTRUMENTS : b === 'sample' ? SAMPLE_INSTRUMENTS : INSTRUMENT_LABELS[b]);

let bank = null;
let instrument = 'square';

function preloadSamples() {
  sampledPiano.preload((loaded, total) => {
    if (bank === 'sample') $('bankHint').textContent = `真實平台鋼琴取樣已就緒 (${loaded}/${total})，隨按即響`;
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
    b.onclick = () => { instrument = name; paintInstruments(); saveVoice(); };
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

/** 換一套音色庫：挑第一個可用音色（同名就沿用），取樣那套順便開始抓樣本。 */
function setBank(next) {
  if (bank === next || !BANKS[next]) return;
  bank = next;
  if (!bankKeys(bank).includes(instrument)) instrument = bankKeys(bank)[0];
  if (bank === 'sample') preloadSamples();
  $('bankHint').textContent = BANKS[bank].label;
  for (const el of document.querySelectorAll('[data-bank]')) {
    const on = el.dataset.bank === bank;
    el.classList.toggle('on', on);
    el.setAttribute('aria-pressed', String(on));
  }
  buildInstruments();
  saveVoice();
}

for (const el of document.querySelectorAll('[data-bank]')) {
  el.onclick = () => setBank(el.dataset.bank);
}

// 開場：套用上次的選擇（音色、音量、八度、標示）。取樣那套會重新抓一次樣本，
// 抓過就進 CacheStorage，離線開啟也一樣快。
setBank(BANKS[prefs.get('bank')] ? prefs.get('bank') : 'chip');
if (bankKeys(bank).includes(prefs.get('instrument'))) {
  instrument = prefs.get('instrument');
  paintInstruments();
  saveVoice();
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

// A held note: which key, the engine handle, and the instrument and bank it
// started with (so switching either mid-chord still releases every note with the
// right fade).
const held = new Set();
function noteOn(i) {
  const n = baseMidi() + i;
  let voice;
  if (bank === 'sample') voice = sampledPiano.playNote(n, { vel: 0.85 });
  else if (bank === 'acoustic') voice = acousticPiano.playNote(n, { preset: instrument, vel: 0.85 });
  else voice = audio.playNote(instrumentNote(instrument, n, { bank }));
  const note = { i, n, voice, instrument, bank };
  held.add(note);
  paintHeld();
  return note;
}
function noteOff(note) {
  if (!note || !held.delete(note)) return;
  const fade = (note.bank === 'sample' || note.bank === 'acoustic') ? 0.22 : instrumentRelease(note.instrument, note.bank);
  if (note.voice && fade !== null) note.voice.release(fade);
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
