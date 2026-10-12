// 琴譜播放頁（score.html）的程式。markup 只留版面，這裡才是行為——
// 跟其他頁面一樣走 page/ui.js（$、Service worker、安裝按鈕）。
import { ChiptuneAudio, INSTRUMENT_LABELS, AcousticPiano, SampledPiano } from '../src/index.js';
import { $, installApp, registerServiceWorker } from './ui.js';

registerServiceWorker();
installApp();

const audio = new ChiptuneAudio({ volume: 0.6 });
// Same two piano voices as keyboard.html.
const pianos = {
  acoustic: new AcousticPiano(() => audio._ensure(), () => audio.master),
  sample: new SampledPiano(() => audio._ensure(), () => audio.master),
};
let voices = [];

// song = { beats, parts: [ { measures: [ { events: [ { start, dur, pitches: [midi] } ] } ] } ] } — all times in quarter notes.
let song = null;
const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const DURS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
const midiName = (n) => NAMES[n % 12] + (Math.floor(n / 12) - 1);

function parseMusicXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('不是有效的 MusicXML');
  const num = (el, tag) => +(el.querySelector(tag)?.textContent ?? 0);
  let beats = 0;
  const parts = [...doc.querySelectorAll('part')].map((p) => {
    let divisions = 1;
    return { measures: [...p.querySelectorAll(':scope > measure')].map((m) => {
      const events = [];
      let cursor = 0;
      for (const el of m.children) {
        if (el.tagName === 'attributes') {
          if (el.querySelector('divisions')) divisions = num(el, 'divisions') || 1;
          if (el.querySelector('time beats')) beats = num(el, 'beats') * 4 / (num(el, 'beat-type') || 4);
        } else if (el.tagName === 'backup') cursor -= num(el, 'duration') / divisions;
        else if (el.tagName === 'forward') cursor += num(el, 'duration') / divisions;
        else if (el.tagName === 'note' && !el.querySelector('grace')) {
          const dur = num(el, 'duration') / divisions;
          let pitch = [];
          if (el.querySelector('pitch')) {
            pitch = [12 * (num(el, 'octave') + 1) + SEMI[el.querySelector('step').textContent] + num(el, 'alter')];
          }
          if (el.querySelector('chord') && events.length) events[events.length - 1].pitches.push(...pitch);
          else { events.push({ start: cursor, dur, pitches: pitch }); cursor += dur; }
        }
      }
      return { events };
    }) };
  });
  if (!beats) {  // oemer writes no time signature: guess the most common measure length
    const seen = {};
    for (const p of parts) for (const m of p.measures) { const l = measureLen(m); seen[l] = (seen[l] || 0) + 1; }
    beats = +Object.entries(seen).sort((a, b) => b[1] - a[1])[0]?.[0] || 4;
  }
  return { beats, parts };
}

// "G3 E3" -> [55, 52]; "r" or "" -> []; null on anything unparseable.
function parsePitches(text) {
  const out = [];
  for (const w of text.trim().split(/[\s+]+/)) {
    if (!w || /^r$/i.test(w)) continue;
    const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(w);
    if (!m) return null;
    out.push(12 * (+m[3] + 1) + SEMI[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0));
  }
  return out;
}

const measureLen = (m) => m.events.reduce((t, e) => Math.max(t, e.start + e.dur), 0);

function render() {
  $('parts').textContent = '';
  song.parts.forEach((part, pi) => {
    const h = document.createElement('h2');
    h.textContent = `聲部 ${pi + 1}`;
    const wrap = document.createElement('div');
    wrap.className = 'measures';
    part.measures.forEach((m, mi) => wrap.append(measureCard(part, m, mi)));
    $('parts').append(h, wrap);
  });
}

function measureCard(part, m, mi) {
  const card = document.createElement('div');
  const len = measureLen(m);
  card.className = 'm' + (Math.abs(len - song.beats) > 0.01 ? ' bad' : '');
  const head = document.createElement('header');
  head.innerHTML = `<b>${mi + 1}</b><span class="len">${len} / ${song.beats} 拍</span>`;
  const ins = button('＋小節', '在前面插入空小節', () => { part.measures.splice(mi, 0, { events: [] }); render(); });
  const del = button('✕', '刪除這個小節', () => { part.measures.splice(mi, 1); render(); });
  head.append(ins, del);
  card.append(head);
  m.events.forEach((e, ei) => {
    const row = document.createElement('div');
    row.className = 'ev';
    const inp = document.createElement('input');
    inp.value = e.pitches.map(midiName).join(' ') || 'r';
    inp.title = '音名，例如 C4 或和弦 G3 E3；r = 休止';
    inp.onchange = () => {
      const p = parsePitches(inp.value);
      if (!p) { inp.classList.add('err'); return; }
      e.pitches = p; render();
    };
    const sel = document.createElement('select');
    for (const d of [...new Set([...DURS, e.dur])].sort((a, b) => a - b)) sel.add(new Option(`${d} 拍`, d, false, d === e.dur));
    sel.onchange = () => { e.dur = +sel.value; render(); };
    const at = document.createElement('span');
    at.className = 'muted'; at.title = '起始拍位'; at.textContent = `@${e.start + 1}`;
    row.append(at, inp, sel, button('✕', '刪除這個音', () => { m.events.splice(ei, 1); render(); }));
    card.append(row);
  });
  card.append(button('＋音', '在小節尾端加一個音', () => { m.events.push({ start: len, dur: 1, pitches: [60] }); render(); }));
  return card;
}

function button(label, title, onclick) {
  const b = document.createElement('button');
  b.textContent = label; b.title = title; b.onclick = onclick;
  return b;
}

function toMidi() {
  const spb = 60 / (+$('bpm').value || 88);
  const tracks = song.parts.map((part) => {
    const notes = [];
    part.measures.forEach((m, mi) => {
      for (const e of m.events) for (const n of e.pitches) {
        notes.push({ time: (mi * song.beats + e.start) * spb, dur: e.dur * spb, note: n, vel: 0.8 });
      }
    });
    return { name: 'part', channel: 0, program: 0, instrument: $('inst').value, notes };
  });
  const duration = Math.max(0, ...song.parts.map((p) => p.measures.length)) * song.beats * spb;
  return { duration, tracks };
}

function show(s, images = []) {
  song = s;
  $('beats').value = s.beats;
  $('page').hidden = !images.length;
  $('page').replaceChildren(...images.map((src) => Object.assign(document.createElement('img'), { src })));
  $('editor').hidden = false;
  render();
}

$('inst').add(new Option('物理擬真鋼琴', 'acoustic'));
$('inst').add(new Option('真實平台鋼琴 (取樣)', 'sample'));
for (const k of Object.keys(INSTRUMENT_LABELS.chip)) $('inst').add(new Option(`晶片 ${INSTRUMENT_LABELS.chip[k]}`, k));
$('beats').onchange = () => { song.beats = +$('beats').value || song.beats; render(); };

function stop() {
  audio.stopMusic();
  for (const v of voices) v?.release(0.05);
  voices = [];
}

$('inst').onchange = () => {
  if ($('inst').value === 'sample') {
    $('status').textContent = '載入鋼琴取樣…（未載入完成的音會先用物理擬真代替）';
    pianos.sample.preload((n, total) => { $('status').textContent = `鋼琴取樣 ${n}/${total}`; });
  }
};

$('play').onclick = () => {
  stop();
  const inst = $('inst').value;
  const midi = toMidi();
  if (!pianos[inst]) return audio.playMidi(midi, { speed: 1 });
  // ponytail: every note is scheduled up front, fine for a page or two; stream in chunks for long pieces.
  const t0 = audio._ensure().currentTime + 0.1;
  for (const track of midi.tracks) for (const n of track.notes) {
    voices.push(pianos[inst].playNote(n.note, { when: t0 + n.time, dur: n.dur, vel: n.vel }));
  }
};
$('stop').onclick = stop;

$('file').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const status = $('status');
  try {
    if (/\.pdf$/i.test(file.name)) {
      status.textContent = '辨識中…（每頁約 1 分鐘）';
      const res = await fetch('/omr', { method: 'POST', body: file });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const songs = data.pages.map((p) => parseMusicXml(p.musicxml));
      // ponytail: pages are joined measure-by-measure, assuming the same parts on every page.
      const merged = songs[0];
      for (const s of songs.slice(1)) s.parts.forEach((p, i) => merged.parts[i]?.measures.push(...p.measures));
      show(merged, data.pages.map((p) => p.image));
    } else {
      show(parseMusicXml(await file.text()));
    }
    status.textContent = `${file.name} 已載入`;
  } catch (err) {
    status.textContent = `失敗：${err.message}`;
  }
};
