// 卡林巴琴模擬器：17 根簧片，撥下去播那把琴的真實錄音（samples/kalimba/，CC0）。
//
// 這個檔案只有 DOM 與事件。簧片的排列、長度比、按鍵對應、調性與示範曲都在
// src/kalimba.js（純資料與算式，測得起來），取樣與播放交給引擎的 SampledInstruments。
//
// 卡林巴是**撥了就一直響**的樂器（鋼簧振動衰減很慢），所以放開指標不會停音——
// 要停請按「止音」，或讓它自己響完。這跟電子琴頁面「放開就停」不一樣，是真的琴的行為。
import {
  ChiptuneAudio, SampledInstruments, SAMPLE_RATE, renderMidi, noteFreq,
  instrumentNote, instrumentRelease, sampleSynth, sampleLabel, SAMPLE_LIBRARY,
  KALIMBA_TUNINGS, KALIMBA_DEMOS, tinePositions, tineNote, tineForKey, tineNumber,
  velocityAt, demoSeconds,
} from '../src/index.js';
import { $, prefs, downloadWav, registerServiceWorker } from './ui.js';

registerServiceWorker();

const NAME = 'kalimba';
/** 匯出時一個音讓它響多久（秒）：簧片自然衰減，這裡只是給引擎一個 note-off 時間。 */
const RING = 3.2;
const audio = new ChiptuneAudio({ volume: prefs.get('kalimba:volume', 0.7) });
const sampled = new SampledInstruments(() => audio._ensure(), () => audio.master);

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n) => NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);

const LABEL_MODES = { number: '簡譜', name: '音名', key: '按鍵' };
const tuningById = (id) => KALIMBA_TUNINGS.find((t) => t.id === id) || KALIMBA_TUNINGS[0];

let tuning = tuningById(prefs.get('kalimba:tuning', 'C'));
let labelMode = LABEL_MODES[prefs.get('kalimba:label')] ? prefs.get('kalimba:label') : 'number';
let velocity = Number(prefs.get('kalimba:velocity', 0.85)) || 0.85;
let autoVelocity = prefs.get('kalimba:autoVelocity', true) !== false;

// ---- 琴身：17 根簧片 ------------------------------------------------------------
// 位置與長度都來自 tinePositions()（src/kalimba.js），這裡只把它畫出來。
const tineEls = [];
{
  const field = $('board').querySelector('.field');
  for (const t of tinePositions()) {
    const el = document.createElement('div');
    el.className = 'tine';
    el.dataset.i = String(t.index);
    el.style.left = `${t.x * 100}%`;
    el.style.height = `${t.length * 100}%`;
    el.innerHTML = '<span class="label"></span>';
    field.append(el);
    tineEls.push(el);
  }
}

/** 畫出每一根簧片上的標示（音名／簡譜／按鍵），調性或標示方式改了就跟著換。 */
function labelTines() {
  tinePositions().forEach((t) => {
    const el = tineEls[t.index];
    const midi = tineNote(t.index, tuning.transpose);
    const name = noteName(midi);
    const number = tineNumber(t.index);
    const key = t.key.toUpperCase();
    const main = labelMode === 'name' ? name : labelMode === 'number' ? number : key;
    const sub = labelMode === 'key' ? name : key;
    el.firstChild.innerHTML = `<b>${main}</b><span class="key">${sub}</span>`;
    el.title = `${name} · ${noteFreq(midi).toFixed(1)} Hz · 簡譜 ${number} · 按鍵 ${key}`;
  });
}

// ---- 聲音 ----------------------------------------------------------------------
/** 還在響的音（止音用）。簧片不會因為放開就停，所以要自己留著 handle。 */
const live = new Set();
const recent = [];

function playTine(index, v) {
  const midi = tineNote(index, tuning.transpose);
  if (midi === null) return;
  const vel = Math.min(1, Math.max(0.05, v));
  const until = performance.now() + RING * 1000;
  const voice = sampled.playNote(NAME, midi, { vel });
  if (voice) {
    live.add({ voice, until });
  } else {
    // 簧片的錄音還沒解碼完（第一次打開的一瞬間）：先用合成音色，按鍵不會沒聲音。
    const synth = sampleSynth(NAME);
    const fallback = synth ? audio.playNote(instrumentNote(synth, midi, { vel })) : null;
    if (fallback) live.add({ voice: fallback, release: instrumentRelease(synth), until });
  }
  for (const item of live) if (item.until < performance.now()) live.delete(item);
  recent.push({ midi, at: performance.now() });
  paintRinging();
  return vel;
}

function paintRinging() {
  const now = performance.now();
  while (recent.length && now - recent[0].at > 2600) recent.shift();
  $('held').textContent = recent.length
    ? recent.map((r) => `${noteName(r.midi)} ${noteFreq(r.midi).toFixed(1)} Hz`).join(' · ')
    : '';
  return recent.length > 0;
}
setInterval(() => { if (recent.length) paintRinging(); }, 600);

/** 撥一根簧片：動畫、發聲、錄音。`positionY` 是撥在簧片的哪個位置（0＝琴橋、1＝尾端）。 */
function pluck(index, { positionY, vel } = {}) {
  const el = tineEls[index];
  if (el) {
    el.classList.remove('down');
    void el.offsetWidth;                 // 重新觸發振動動畫（同一個簧片連撥兩次也要動）
    el.classList.add('down');
    setTimeout(() => el.classList.remove('down'), 470);
  }
  const v = vel !== undefined ? vel
    : autoVelocity && positionY !== undefined ? velocity * velocityAt(positionY)
      : velocity;
  const used = playTine(index, v);
  recordHit(index, used);
}

/** 止音：把還在響的簧片全部悶掉（真實的卡林巴是用拇指按住簧片）。 */
function dampAll(fade = 0.12) {
  for (const item of live) {
    // 合成代理音有自己的 release 長度（卡林巴是 null＝讓它響完），取兩者短的
    const fadeFor = Number.isFinite(item.release) ? Math.min(fade, item.release) : fade;
    try { item.voice.release(fadeFor); } catch { /* 已經停了 */ }
  }
  live.clear();
  recent.length = 0;
  paintRinging();
}

/** 撥在簧片的哪個位置（0＝上端琴橋、1＝下端尾端）。 */
function positionIn(el, clientY) {
  const rect = el.getBoundingClientRect();
  return rect.height > 0 ? (clientY - rect.top) / rect.height : 1;
}

// ---- 指標與鍵盤 ----------------------------------------------------------------
// 一根手指一個音；拖過別的簧片就撥那一根（刮奏）。指標離開不放手＝繼續響。
const byPointer = new Map();
const board = $('board');
board.onpointerdown = (e) => {
  const el = e.target.closest('.tine');
  if (!el) return;
  el.releasePointerCapture?.(e.pointerId);   // 觸控會把指標抓在簧片上，放掉才收得到其他簧片
  const i = +el.dataset.i;
  byPointer.set(e.pointerId, i);
  pluck(i, { positionY: positionIn(el, e.clientY) });
};
board.onpointerover = (e) => {
  if (!byPointer.has(e.pointerId)) return;    // 只是滑鼠移過去不算撥
  const el = e.target.closest('.tine');
  if (!el) return;
  const i = +el.dataset.i;
  if (byPointer.get(e.pointerId) === i) return;
  byPointer.set(e.pointerId, i);
  pluck(i, { positionY: positionIn(el, e.clientY) });
};
const pointerEnd = (e) => { byPointer.delete(e.pointerId); };
addEventListener('pointerup', pointerEnd);
addEventListener('pointercancel', pointerEnd);

// 電腦鍵盤：數字排 1–9 是左半邊＋中央，Q–I 是右半邊（跟畫面上一樣）。
// 鍵盤沒有「撥在哪裡」，所以當作撥在尾端（最大力度）。
const byKey = new Set();
addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target && e.target.closest && e.target.closest('input, select, textarea, button')) return;
  const k = e.key.toLowerCase();
  const i = tineForKey(k);
  if (i < 0 || byKey.has(k)) return;
  e.preventDefault();
  byKey.add(k);
  pluck(i, { positionY: 1 });
});
addEventListener('keyup', (e) => { byKey.delete(e.key.toLowerCase()); });
addEventListener('blur', () => { byKey.clear(); byPointer.clear(); });

// ---- 錄音與匯出 ----------------------------------------------------------------
// 記下「哪一根、什麼時候、多大力」，匯出時交給 renderMidi 重算一次：用同一個引擎、
// 同一組錄音，所以檔案裡的東西跟你聽到的一樣（不是另外合成的）。
let rec = null;        // { t0, events, seconds }——`seconds` 是 null 表示還在錄
let recTimer = 0;

function recordHit(index, v) {
  // 只有「正在錄」才收：停止之後還把示範曲或隨手撥的音記進去，匯出時會多出沒打算錄的東西。
  if (!rec || rec.seconds !== null) return;
  rec.events.push({ note: tineNote(index, tuning.transpose), time: (performance.now() - rec.t0) / 1000, dur: RING, vel: v });
}

function paintRec() {
  // 停止（或根本沒錄過）就把計時器收掉：留著的話每 200 ms 都會重畫一次，
  // 而且「停止」之後畫面還會繼續跳數字。
  if (!rec || rec.seconds !== null) {
    clearInterval(recTimer);
    recTimer = 0;
  }
  if (!rec) {
    $('recInfo').textContent = '還沒錄任何東西';
    return;
  }
  const recording = rec.seconds === null;
  const secs = recording ? (performance.now() - rec.t0) / 1000 : rec.seconds;
  // 停止之後這一段還留著（要能匯出），再按一次是**開新的一段**——這句話要講清楚，
  // 不然使用者會以為匯出的是兩段合起來的東西。
  const tail = recording ? '（錄音中…）' : '——再按一次開始新的一段';
  $('recInfo').textContent = `${rec.events.length} 個音、${secs.toFixed(1)} 秒${tail}`;
  if (recording && !recTimer) recTimer = setInterval(paintRec, 200);
}

$('record').onclick = () => {
  // 只有「正在錄」的那一段才算停止；停止之後再按是開新的一段（否則第二段永遠錄不了）
  if (rec && rec.seconds === null) {
    rec.seconds = (performance.now() - rec.t0) / 1000;
    $('record').textContent = '● 開始錄音';
    $('record').classList.remove('on');
    paintRec();
    return;
  }
  rec = { t0: performance.now(), events: [], seconds: null };
  $('record').textContent = '■ 停止錄音';
  $('record').classList.add('on');
  paintRec();
};

$('exportWav').onclick = () => {
  if (!rec || !rec.events.length) {
    $('recInfo').textContent = '先按「開始錄音」撥幾個音，再匯出';
    return;
  }
  const events = rec.events.slice().sort((a, b) => a.time - b.time);
  const last = events[events.length - 1];
  const midi = { tracks: [{ notes: events, channel: 0, program: 108 }], duration: last.time + last.dur + 1 };
  // 錄音已經解碼完就用真實簧片，還沒有的話用同一組代理音色（不讓匯出失敗）
  const ready = !!sampled.pcm(NAME);
  const instrument = ready ? `sampled:${NAME}` : sampleSynth(NAME);
  const pcm = renderMidi(midi, {
    tracks: [{ instrument }],
    samples: ready ? sampled.voices([NAME]) : null,
  });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  downloadWav(pcm, `kalimba-${stamp}.wav`, SAMPLE_RATE);
  $('recInfo').textContent = `${events.length} 個音已匯出（${ready ? '真實簧片錄音' : '合成音色'}）`;
};

// ---- 示範曲 --------------------------------------------------------------------
let demoTimers = [];

function stopDemo() {
  for (const t of demoTimers) clearTimeout(t);
  demoTimers = [];
  $('playDemo').classList.remove('on');
}

$('playDemo').onclick = () => {
  stopDemo();
  const demo = KALIMBA_DEMOS.find((d) => d.id === $('demo').value) || KALIMBA_DEMOS[0];
  const secondsPerBeat = 60 / demo.bpm;
  for (const [index, at, dur] of demo.notes) {
    demoTimers.push(setTimeout(() => pluck(index, { vel: velocity }), at * secondsPerBeat * 1000));
  }
  demoTimers.push(setTimeout(stopDemo, demoSeconds(demo) * 1000));
  $('playDemo').classList.add('on');
};
$('stopDemo').onclick = stopDemo;

// ---- 設定 ----------------------------------------------------------------------
for (const t of KALIMBA_TUNINGS) {
  const o = document.createElement('option');
  o.value = t.id;
  o.textContent = t.label;
  $('tuning').append(o);
}
for (const [id, label] of Object.entries(LABEL_MODES)) {
  const o = document.createElement('option');
  o.value = id;
  o.textContent = label;
  $('label').append(o);
}
for (const d of KALIMBA_DEMOS) {
  const o = document.createElement('option');
  o.value = d.id;
  o.textContent = `${d.label}（${d.bpm} BPM）`;
  $('demo').append(o);
}

$('volume').value = String(audio.volume);
$('velocity').value = String(velocity);
$('autoVelocity').checked = autoVelocity;
$('tuning').value = tuning.id;
$('label').value = labelMode;

$('volume').oninput = (e) => { audio.setVolume(+e.target.value); prefs.set('kalimba:volume', +e.target.value); };
$('velocity').oninput = (e) => { velocity = +e.target.value; prefs.set('kalimba:velocity', velocity); };
$('autoVelocity').onchange = (e) => { autoVelocity = e.target.checked; prefs.set('kalimba:autoVelocity', autoVelocity); };
$('tuning').onchange = (e) => { tuning = tuningById(e.target.value); prefs.set('kalimba:tuning', tuning.id); labelTines(); };
$('label').onchange = (e) => { labelMode = e.target.value; prefs.set('kalimba:label', labelMode); labelTines(); };
$('damp').onclick = () => dampAll();

labelTines();

// ---- 簧片的錄音 ------------------------------------------------------------------
// 17 個檔案就在這個站上（跟鼓組一樣進 service worker 預快取），所以打開就能彈、離線也能彈。
{
  const label = sampleLabel(NAME);
  const credit = SAMPLE_LIBRARY[NAME] ? SAMPLE_LIBRARY[NAME].credit : '';
  const total = sampled.wanted(NAME);
  $('sampleHint').textContent = `${label}：載入 ${total} 根簧片的錄音…`;
  sampled.load(NAME, {
    onProgress: (done) => { $('sampleHint').textContent = `${label}：載入簧片錄音 ${done}/${total}…`; },
  }).then((hit) => {
    if (!hit || !hit.notes.length) {
      $('sampleHint').textContent = `${label}：錄音載入失敗，先用合成音色代替`;
      return;
    }
    const missed = hit.failed ? `（${hit.failed} 個失敗）` : '';
    $('sampleHint').textContent = `${label}：${hit.notes.length} 根簧片的錄音就緒${missed}——離線也能彈。${credit}`;
  });
}
