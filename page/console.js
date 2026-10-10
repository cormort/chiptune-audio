// 控制台頁面。版面照「功能 → 流程」分成四區，這個檔也照同樣的順序讀：
//
//   1. 主控  輸出音量、靜音、匯流排（音效／音樂）推桿
//   2. 音效  挑預設 → 調參數 → 看波形 → 試聽／複製 JSON／下載 WAV
//   3. 音樂  情緒＋種子＋小節 → 播放 → 聲部（主旋律／貝斯／鼓組）推桿
//   4. MIDI  匯入 → 軌道音色 → 鋼琴演奏顯示 → 播放（含進度條）
//
// 畫圖在 page/pianoview.js、混音台在 page/mixer.js、共用小工具在 page/ui.js，
// 這個檔只做接線與各區的狀態。
import {
  ChiptuneAudio, SFX_PRESETS, SFX_DEFAULTS, WAVE, renderSfx, generateSong, MOODS, SAMPLE_RATE,
  INSTRUMENT_BANKS, INSTRUMENT_LABELS, parseMidi, renderMidi, renderSong, flattenMidi,
} from '../src/index.js';
import { $, downloadWav, fmtTime, prefs, registerServiceWorker, round } from './ui.js';
import { createMixer } from './mixer.js';
import { createPianoView } from './pianoview.js';

registerServiceWorker();

const audio = new ChiptuneAudio({ volume: prefs.get('volume', 0.6) });

// Which kind of music owns audio.music, so the song controls never replace a MIDI.
let nowPlaying = null;   // 'song' | 'midi' | null
const midiPlaying = () => !!audio.music && nowPlaying === 'midi';

/** 換誰擁有音樂匯流排。MIDI 不是用音樂的聲部推桿合成的，所以推桿要標成未生效。 */
function setOwner(kind) {
  nowPlaying = kind;
  mixer.setPartsActive(kind !== 'midi');
}

function stopAllMusic() {
  audio.stopMusic();
  setOwner(null);
  $('musicInfo').textContent = '';
  $('midiStatus').textContent = '';
  view.setFreeze(0);
}

// ---------------------------------------------------------------- 1. 主控
$('volume').value = audio.volume;
$('volume').oninput = (e) => {
  audio.setVolume(+e.target.value);
  prefs.set('volume', +e.target.value);
};
$('mute').checked = !!prefs.get('muted', false);
audio.setMuted($('mute').checked);
$('mute').onchange = (e) => {
  audio.setMuted(e.target.checked);
  prefs.set('muted', e.target.checked);
};
$('stopAll').onclick = () => audio.stopAllSfx();

const mixer = createMixer({
  audio,
  busHost: $('busMixer'),
  partHost: $('partMixer'),
  info: $('mixInfo'),
  reset: $('resetMix'),
  partHint: $('partHint'),
  onChange: () => prefs.set('mix', mixer.snapshot()),
});
mixer.restore(prefs.get('mix', null));

// ---------------------------------------------------------------- 2. 音效
// [key, label, min, max, step]
const SLIDERS = [
  ['freq', '頻率 Hz', 20, 3000, 1],
  ['slide', '滑音 oct/s', -8, 8, 0.1],
  ['duty', '脈寬', 0.05, 0.95, 0.01],
  ['dutySweep', '脈寬掃動', -2, 2, 0.05],
  ['vibDepth', '顫音深度', 0, 0.1, 0.001],
  ['vibRate', '顫音速度', 0, 40, 0.5],
  ['arpMult', '琶音倍率', 0.5, 2, 0.01],
  ['arpTime', '琶音時間', 0, 0.5, 0.01],
  ['bits', 'Bit-crush', 0, 8, 1],
  ['attack', '起音', 0, 0.3, 0.005],
  ['sustain', '持續', 0, 1, 0.01],
  ['decay', '衰減', 0, 1.5, 0.01],
  ['vol', '音量', 0, 1, 0.01],
  ['seed', '雜訊種子', 1, 64, 1],
];
const WAVE_NAMES = Object.keys(WAVE);   // SQUARE, SAW, TRIANGLE, NOISE

let params = { ...SFX_DEFAULTS };
const inputs = {};

// Wave selector + sliders. 波形下拉在 HTML 裡（第一個 .param），這裡只填選項。
{
  const wrap = $('params');
  for (const n of WAVE_NAMES) $('waveSel').add(new Option(n, WAVE[n]));
  $('waveSel').onchange = (e) => { params.wave = +e.target.value; refresh(); };

  for (const [key, label, min, max, step] of SLIDERS) {
    const row = document.createElement('label');
    row.className = 'param';
    row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><span></span>`;
    const input = row.querySelector('input');
    input.oninput = () => { params[key] = +input.value; refresh(); };
    input.onchange = () => audio.playSfx(params);   // release slider → hear it
    inputs[key] = input;
    wrap.append(row);
  }
}

const SFX_LABELS = {
  coin: '金幣', jump: '跳躍', laser: '雷射', hit: '擊中', explosion: '爆炸', powerup: '強化',
  select: '選取', gameover: '遊戲結束', win: '勝利', shoot: '射擊', blip: '對話', click: '點擊',
  hurt: '受傷', pickup: '拾取', heal: '補血', levelup: '升級', door: '開門', step: '腳步',
  bounce: '彈跳', alarm: '警報', teleport: '傳送', charge: '蓄力', error: '錯誤', splash: '水花',
};
for (const name of Object.keys(SFX_PRESETS)) {
  const b = document.createElement('button');
  b.textContent = SFX_LABELS[name] ? `${SFX_LABELS[name]} ${name}` : name;
  b.dataset.preset = name;
  b.onclick = () => { load(SFX_PRESETS[name], name); audio.playSfx(params); };
  $('presets').append(b);
}

function load(preset, name = null) {
  params = { ...SFX_DEFAULTS, ...preset };
  for (const b of $('presets').children) b.classList.toggle('on', b.dataset.preset === name);
  refresh();
}

// Only the params that differ from the defaults, i.e. what you'd paste into a preset.
function diffParams() {
  const out = {};
  for (const k of Object.keys(SFX_DEFAULTS)) if (params[k] !== SFX_DEFAULTS[k]) out[k] = round(params[k]);
  return out;
}

function refresh() {
  $('waveSel').value = params.wave;
  for (const [key] of SLIDERS) {
    inputs[key].value = params[key];
    inputs[key].nextElementSibling.textContent = round(params[key]);
  }
  const t0 = performance.now();
  const samples = renderSfx(params);
  const ms = performance.now() - t0;
  drawWave(samples);
  $('sfxInfo').textContent =
    `${(samples.length / SAMPLE_RATE).toFixed(2)} 秒 · 合成 ${ms.toFixed(1)} ms`;
  $('sfxJson').textContent = JSON.stringify(diffParams());
}

function drawWave(samples) {
  const c = $('wave'), g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--wave');
  g.beginPath();
  const per = Math.max(1, Math.floor(samples.length / c.width));
  for (let x = 0; x < c.width; x++) {
    let lo = 0, hi = 0;
    for (let i = x * per; i < Math.min(samples.length, (x + 1) * per); i++) {
      lo = Math.min(lo, samples[i]); hi = Math.max(hi, samples[i]);
    }
    const mid = c.height / 2;
    g.moveTo(x + 0.5, mid - hi * mid);
    g.lineTo(x + 0.5, mid - lo * mid + 1);
  }
  g.stroke();
}

$('playSfx').onclick = () => audio.playSfx(params);
$('randomSfx').onclick = () => {
  const p = {};
  for (const [key, , min, max, step] of SLIDERS) p[key] = Math.round((min + Math.random() * (max - min)) / step) * step;
  p.wave = Math.floor(Math.random() * WAVE_NAMES.length);
  p.attack = Math.min(p.attack, 0.05);
  p.vol = 0.5;
  load(p);
  audio.playSfx(params);
};
$('wavSfx').onclick = () => {
  const on = $('presets').querySelector('.on');
  downloadWav(renderSfx(params), `${on ? on.dataset.preset : "sfx"}.wav`, SAMPLE_RATE);
};
$('copySfx').onclick = async () => {
  const text = JSON.stringify(diffParams());
  try { await navigator.clipboard.writeText(text); $('copySfx').textContent = '已複製'; }
  catch {
    // 剪貼簿被擋時改成選取文字，讓使用者自己複製
    getSelection().selectAllChildren($('sfxJson'));
    $('copySfx').textContent = '已選取，請手動複製';
  }
  setTimeout(() => { $('copySfx').textContent = '複製參數'; }, 1500);
};

// ---------------------------------------------------------------- 3. 音樂
const MOOD_LABELS = {
  happy: '快樂', calm: '平靜', tense: '緊張', sad: '悲傷', heroic: '英勇', playful: '俏皮',
  dreamy: '夢幻', mysterious: '神秘', spooky: '恐怖', boss: '魔王戰', groovy: '藍調律動',
};
for (const m of Object.keys(MOODS)) $('mood').add(new Option(MOOD_LABELS[m] ? `${MOOD_LABELS[m]} ${m}` : m, m));

const musicOptions = () => ({ seed: +$('seed').value || 1, mood: $('mood').value, bars: +$('bars').value });

// 上次用的情緒／種子／小節留著，重新載入不用再挑一次。
$('seed').value = prefs.get('musicSeed', 1);
if (MOODS[prefs.get('musicMood')]) $('mood').value = prefs.get('musicMood');
if ([...$('bars').options].some((o) => +o.value === +prefs.get('musicBars', 0))) {
  $('bars').value = String(prefs.get('musicBars'));
}
function saveMusicOptions() {
  const o = musicOptions();
  prefs.patch({ musicSeed: o.seed, musicMood: o.mood, musicBars: o.bars });
}

// 合成整首循環會花十幾毫秒；先算好就能在播放時立即開始。
function preloadMusic() {
  const opts = musicOptions();
  const t0 = performance.now();
  audio.preloadMusic(opts);
  const ms = performance.now() - t0;
  const song = generateSong(opts);
  $('musicInfo').textContent =
    `已備妥：${song.bpm} BPM，循環 ${(song.bars * 16 * (60 / song.bpm / 4)).toFixed(1)} 秒 · 合成 ${ms.toFixed(1)} ms`;
}

function playMusic() {
  const opts = musicOptions();
  audio.playMusic(opts);
  setOwner('song');
  $('midiStatus').textContent = '';
  const song = generateSong(opts);
  $('musicInfo').textContent = `播放中：${song.bpm} BPM，循環 ${(song.bars * 16 * (60 / song.bpm / 4)).toFixed(1)} 秒`;
}

$('playMusic').onclick = playMusic;
$('preloadMusic').onclick = preloadMusic;
$('dice').onclick = () => { $('seed').value = 1 + Math.floor(Math.random() * 99999); playMusic(); };
$('stopMusic').onclick = () => { if (nowPlaying === 'song') stopAllMusic(); };
const songPlaying = () => audio.music && nowPlaying === 'song';
for (const id of ['mood', 'bars']) $(id).onchange = () => { saveMusicOptions(); if (songPlaying()) playMusic(); };
$('seed').onchange = () => { saveMusicOptions(); if (songPlaying()) playMusic(); };

$('wavMusic').onclick = () => {
  const opts = musicOptions();
  const { lead, bass, drums } = audio.mix;
  downloadWav(renderSong(generateSong(opts), { mix: { lead, bass, drums } }), `music-${opts.mood}-${opts.seed}.wav`, SAMPLE_RATE);
};

// ---------------------------------------------------------------- 4. MIDI
// MIDI remix: parse once, then re-render with each track's instrument.
let midi = null;
let midiTracks = [];      // per-track { instrument, volume, mute }, indexed like midi.tracks
let midiSpeed = 1;
let midiName = 'midi';

// .mid and .smf are the same format; .kar (MIDI + lyrics) and .rmi (RIFF-wrapped)
// too. parseMidi finds the MThd header itself, so a renamed file, a RIFF/RMID
// container or one with an ID3 tag glued on the front all still load.
const MIDI_FILE = /\.(mid|midi|smf|kar|rmi)$/i;

/** Some archives ship `song.mid.gz`; browsers can inflate it natively. */
async function midiBytes(file) {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (head[0] === 0x1f && head[1] === 0x8b && typeof DecompressionStream === 'function') {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }
  return buf;
}

// 鋼琴演奏顯示：位置來自 src/pianoroll.js，播放頭讀 audio.musicTime。
const view = createPianoView({
  canvas: $('pianoRoll'),
  showToggle: $('rollOn'),
  windowSelect: $('rollWindow'),
  keysSelect: $('rollKeys'),
  info: $('rollInfo'),
  audio,
  clock: () => ({ playing: midiPlaying(), time: audio.musicTime, owned: nowPlaying === 'midi' }),
  onSeek: (t) => playMidi(t),                                  // 拖進度條／點畫布 → 重新合成續播
  onTick: (t, playing) => {
    syncSeek(t);
    // 非循環的曲子播完時，狀態列不該還掛著「播放中」。
    if (!playing && $('midiStatus').textContent.startsWith('播放中')) $('midiStatus').textContent = '播放完畢';
  },
});

$('rollOn').checked = !!prefs.get('rollShow', true);
$('rollWindow').value = String(prefs.get('rollWindow', 4));
$('rollOn').onchange = () => { prefs.set('rollShow', $('rollOn').checked); view.refresh(); };
$('rollWindow').onchange = () => { prefs.set('rollWindow', +$('rollWindow').value); view.refresh(); };
// 琴鍵大小：手機（直向或橫向，取比較短的一邊判斷）第一次打開時預設只放 8 個白鍵，
// 每個鍵才夠寬看得清楚；桌機維持整首塞進去。設定過之後就照使用者的選擇。
const KEY_CHOICES = [0, 8, 12, 16, 22];
const savedKeys = +prefs.get('rollKeys', NaN);
const narrow = Math.min(innerWidth, innerHeight) < 560;
$('rollKeys').value = String(KEY_CHOICES.includes(savedKeys) ? savedKeys : (narrow ? 8 : 0));
$('rollKeys').onchange = () => { prefs.set('rollKeys', +$('rollKeys').value); view.refresh(); };

/** 重新整理顯示用的音符（換譜、改樂器／音量／靜音／速度時）。 */
function rebuildScore() {
  view.setScore(midi ? flattenMidi(midi, { tracks: midiTracks, speed: midiSpeed }) : null);
}

// 進度條：拖曳時只動畫面（合成一次要十幾毫秒，不能每個 pixel 都算），放開才續播。
let seeking = false;
const seek = $('midiSeek');
seek.oninput = () => {
  seeking = true;
  view.setFreeze(+seek.value / 1000 * view.duration());
};
seek.onchange = () => {
  seeking = false;
  view.seekTo(+seek.value / 1000 * view.duration());
};
function syncSeek(t) {
  seek.disabled = !midi || !midi.tracks.length;
  if (!seeking && view.duration() > 0) seek.value = String(Math.round(t / view.duration() * 1000));
}

async function loadMidiFile(file) {
  let parsed;
  try {
    parsed = parseMidi(await midiBytes(file));
  } catch (err) {
    // Drop whatever was playing: it no longer matches what the panel shows.
    if (nowPlaying === 'midi') stopAllMusic();
    midi = null;
    midiTracks = [];
    $('midiInfo').textContent = `${file.name} 無法讀取：${err.message}`;
    buildTracks();
    rebuildScore();
    return;
  }
  midi = parsed;
  midiName = file.name.replace(MIDI_FILE, '') || 'midi';
  midiTracks = midi.tracks.map((t) => ({ instrument: t.instrument, volume: 1, mute: false }));
  const notes = midi.tracks.reduce((n, t) => n + t.notes.length, 0);
  $('midiInfo').textContent = midi.tracks.length
    ? `${file.name}：${fmtTime(midi.duration)}，${midi.tracks.length} 軌，${notes} 個音符`
    : `${file.name} 裡沒有音符`;
  buildTracks();
  if (nowPlaying === 'midi') stopAllMusic();   // the old piece is not this file
  rebuildScore();
  if (midi.tracks.length && $('midiAutoPlay').checked) playMidi();
}

$('midiFile').onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = '';   // picking the same file twice must fire change again
  if (file) loadMidiFile(file);
};

// Dropping a file anywhere else would navigate away from the console.
const dropsFiles = (e) => [...(e.dataTransfer && e.dataTransfer.types || [])].includes('Files');
addEventListener('dragover', (e) => { if (dropsFiles(e)) e.preventDefault(); });
addEventListener('drop', (e) => { if (dropsFiles(e)) e.preventDefault(); });

const midiSection = $('midiSection');
midiSection.addEventListener('dragover', (e) => {
  if (!dropsFiles(e)) return;
  e.preventDefault();
  midiSection.classList.add('dropping');
});
midiSection.addEventListener('dragleave', (e) => {
  if (!midiSection.contains(e.relatedTarget)) midiSection.classList.remove('dropping');
});
midiSection.addEventListener('drop', (e) => {
  if (!dropsFiles(e)) return;
  e.preventDefault();
  midiSection.classList.remove('dropping');
  const files = [...e.dataTransfer.files];
  const file = files.find((f) => MIDI_FILE.test(f.name)) || files[0];
  if (file) loadMidiFile(file);
});

function buildTracks() {
  const wrap = $('midiTracks');
  wrap.textContent = '';
  const has = !!(midi && midi.tracks.length);
  $('playMidi').disabled = !has;
  $('stopMidi').disabled = !has;
  $('wavMidi').disabled = !has;
  seek.disabled = !has;
  if (!has) return;
  midi.tracks.forEach((t, i) => {
    const s = midiTracks[i];
    const row = document.createElement('div');
    row.className = 'track';
    row.innerHTML = `<div class="tname"></div><select aria-label="樂器"></select>
      <input type="range" min="0" max="1" step="0.01" aria-label="音量">
      <label class="inline"><input type="checkbox"> 靜音</label>`;
    const nameEl = row.querySelector('.tname');
    nameEl.textContent = t.name;
    const small = document.createElement('small');
    small.textContent = `聲道 ${t.channel + 1} · ${t.notes.length} 音符`;
    nameEl.append(small);
    const sel = row.querySelector('select');
    // Chip voices only: a realistic voice costs ~15x per sample and the midi
    // renderer lays down every note's full tail, which would freeze the tab.
    // `real:<name>` is still available through the library and the CLI.
    for (const k of Object.keys(INSTRUMENT_BANKS.chip)) sel.add(new Option(INSTRUMENT_LABELS.chip[k] || k, k));
    sel.add(new Option('鼓組', 'drums'));
    sel.value = s.instrument;
    sel.onchange = () => { s.instrument = sel.value; remixIfPlaying(); };
    const vol = row.querySelector('input[type=range]');
    vol.value = s.volume;
    vol.onchange = () => { s.volume = +vol.value; remixIfPlaying(); };
    const mute = row.querySelector('input[type=checkbox]');
    mute.onchange = () => { s.mute = mute.checked; row.classList.toggle('muted-track', s.mute); remixIfPlaying(); };
    wrap.append(row);
  });
}

async function playMidi(offset = 0) {
  $('midiStatus').textContent = '合成中…';
  await new Promise((r) => setTimeout(r));   // let the status paint before the render blocks
  const t0 = performance.now();
  audio.playMidi(midi, { tracks: midiTracks, speed: midiSpeed, loop: $('midiLoop').checked, offset });
  const ms = performance.now() - t0;
  setOwner('midi');
  $('musicInfo').textContent = '';
  $('midiStatus').textContent = `播放中 · 合成 ${ms.toFixed(0)} ms`;
  view.setFreeze(offset);
}

function remixIfPlaying(speedRatio = 1) {
  rebuildScore();   // 樂器／音量／靜音／速度都會改變要畫的音符
  if (audio.music && nowPlaying === 'midi') playMidi(audio.musicTime * speedRatio);
  else view.schedule();
}

$('playMidi').onclick = () => playMidi();
$('stopMidi').onclick = () => { if (nowPlaying === 'midi') stopAllMusic(); };
$('midiSpeed').onchange = (e) => {
  const old = midiSpeed;
  midiSpeed = +e.target.value;
  remixIfPlaying(old / midiSpeed);   // same place in the piece at the new tempo
};
$('midiLoop').onchange = () => remixIfPlaying();
$('wavMidi').onclick = () => {
  downloadWav(renderMidi(midi, { tracks: midiTracks, speed: midiSpeed }), `${midiName}-remix.wav`, SAMPLE_RATE);
};

// ---------------------------------------------------------------- 開場
load(SFX_PRESETS.coin, 'coin');
syncSeek(0);
