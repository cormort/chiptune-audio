// 控制台頁面。版面照「功能 → 流程」分成四區，這個檔也照同樣的順序讀：
//
//   1. 主控  輸出音量、靜音、匯流排（音效／音樂）推桿
//   2. 音效  挑預設 → 調參數 → 看波形 → 試聽／複製 JSON／下載 WAV
//   3. 音樂  情緒＋種子＋小節 → 播放 → 聲部（主旋律／貝斯／鼓組）推桿
//   4. MIDI  匯入（可多檔，排成播放清單）→ 軌道音色 → 鋼琴演奏顯示 → 播放（含進度條）
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
// 只有真的開始播過才接手「播完了」的處理；被使用者停止時 stopAllMusic 會關掉它。
let midiStarted = false;
let midiDone = false;    // 這一首的「播完」已經處理過，避免重複觸發

/** 換誰擁有音樂匯流排。MIDI 不是用音樂的聲部推桿合成的，所以推桿要標成未生效。 */
function setOwner(kind) {
  nowPlaying = kind;
  mixer.setPartsActive(kind !== 'midi');
}

function stopAllMusic() {
  audio.stopMusic();
  setOwner(null);
  midiStarted = false;
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
// 一次可以匯入多個檔案：每一首解析後進清單（queue），清單上的每一首各自記住自己的
// 軌道設定；點一列就換那首，開著「連續播放清單」時一首播完自動接下一首。
const queue = [];         // { file, name, midi, tracks, notes, error }，解析完就不再變
let at = -1;              // 清單中目前的索引（-1＝清單是空的）
let midi = null;          // 目前這首（= queue[at].midi）
let midiTracks = [];      // 目前這首的軌道設定；就是 queue[at].tracks，改這裡等於改清單
let midiSpeed = 1;
let midiName = 'midi';

// .mid and .smf are the same format; .kar (MIDI + lyrics) and .rmi (RIFF-wrapped)
// too. parseMidi finds the MThd header itself, so a renamed file, a RIFF/RMID
// container or one with an ID3 tag glued on the front all still load.
const MIDI_FILE = /\.(mid|midi|smf|kar|rmi)$/i;
// 清單空掉時 #midiInfo 要回到開場的提示；那句話寫在 HTML 裡，讀回來就不會有兩份。
const MIDI_HINT = $('midiInfo').textContent;

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
    if (playing) { midiDone = false; return; }
    // 非循環的曲子播完時，狀態列不該還掛著「播放中」；連續播放就接著下一首。
    // 被使用者按停止時 stopAllMusic 已經把 midiStarted 關掉，這裡不接手。
    if (midiDone || !midiStarted || nowPlaying !== 'midi') return;
    midiDone = true;
    // 讀不到或沒有音符的曲目直接跳過，不要卡在壞掉的那一首上。
    const next = nextPlayable(at + 1);
    if ($('midiChain').checked && next >= 0) selectItem(next, { play: true });
    else $('midiStatus').textContent = queue.length > 1 && next < 0 ? '清單播完' : '播放完畢';
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

/** 讀一個檔案並解析。讀不出來也回傳一個項目（帶著訊息），讓清單上看得見是哪一個壞的。 */
async function readMidiFile(file) {
  const item = { file, name: file.name.replace(MIDI_FILE, '') || 'midi', midi: null, tracks: [], notes: 0, error: '' };
  try {
    const parsed = parseMidi(await midiBytes(file));
    item.midi = parsed;
    item.notes = parsed.tracks.reduce((n, t) => n + t.notes.length, 0);
    item.tracks = parsed.tracks.map((t) => ({ instrument: t.instrument, volume: 1, mute: false }));
  } catch (err) {
    item.error = err.message;
  }
  return item;
}

/** 從 from 開始第一首真的播得出來的曲目（沒有就 -1）。 */
function nextPlayable(from) {
  return queue.findIndex((it, i) => i >= from && it.midi && it.midi.tracks.length);
}

/** 這批檔案裡要收哪些：先挑副檔名像 MIDI 的；一個都沒有就整批試試看，
 *  因為 parseMidi 靠檔頭辨認，改過名或 gzip 壓縮的檔案常常真的讀得出來。 */
function midiCandidates(files) {
  const list = [...files].filter((f) => f.size > 0);
  const named = list.filter((f) => MIDI_FILE.test(f.name));
  return named.length ? named : list;
}

/** 匯入一批檔案：全部進清單，選第一首有音符的來播（沒有就選第一個，讓人看到錯誤）。 */
async function addFiles(files) {
  const picked = midiCandidates(files);
  if (!picked.length) return;
  const first = queue.length;
  if (picked.length > 1) $('midiStatus').textContent = `讀取 ${picked.length} 個檔案…`;
  for (const file of picked) queue.push(await readMidiFile(file));
  $('midiStatus').textContent = '';   // 讀取中的提示收掉；要播的話 playMidi 會自己再寫
  const playable = nextPlayable(first);
  selectItem(playable >= 0 ? playable : first, { play: !!$('midiAutoPlay').checked });
}

/** 換清單裡的某一首：停掉目前的聲音，換上它的解析結果與它自己的軌道設定。 */
function selectItem(i, opts = {}) {
  if (i < 0 || i >= queue.length) return;
  const { offset = 0, play = !!$('midiAutoPlay').checked } = opts;
  const it = queue[i];
  if (nowPlaying === 'midi') stopAllMusic();   // 舊的那首不是這一首
  at = i;
  midi = it.midi;
  midiTracks = it.tracks;
  midiName = it.name || 'midi';
  midiDone = false;
  $('midiInfo').textContent = it.error
    ? `${it.file.name} 無法讀取：${it.error}`
    : !it.midi.tracks.length
      ? `${it.file.name} 裡沒有音符`
      : `${it.file.name}：${fmtTime(it.midi.duration)}，${it.midi.tracks.length} 軌，${it.notes} 個音符`;
  buildList();
  buildTracks();
  rebuildScore();
  if (play && midi.tracks.length) playMidi(offset);
}

/** 從清單移除一首。移掉的正好是正在播的那首時，改選最靠近的一首，但不自動出聲。 */
function removeItem(i) {
  if (i < 0 || i >= queue.length) return;
  const wasCurrent = i === at;
  queue.splice(i, 1);
  if (!wasCurrent) {
    if (i < at) at--;                          // 前面少了一首，索引跟著移
    buildList();
    return;
  }
  if (nowPlaying === 'midi') stopAllMusic();
  at = -1;
  midi = null;
  midiTracks = [];
  $('midiInfo').textContent = MIDI_HINT;
  $('midiStatus').textContent = '';
  if (queue.length) { selectItem(Math.min(i, queue.length - 1), { play: false }); return; }
  buildList();
  buildTracks();
  rebuildScore();
}

/** 重畫播放清單。每次增減或換首都整份重建：清單頂多幾十筆，不值得做增量更新。 */
function buildList() {
  const host = $('midiItems');
  host.textContent = '';
  $('midiList').hidden = !queue.length;
  $('midiClear').disabled = !queue.length;
  const total = queue.reduce((s, it) => s + (it.midi ? it.midi.duration : 0), 0);
  $('midiListInfo').textContent = queue.length
    ? `清單 ${queue.length} 首 · 共 ${fmtTime(total)}${$('midiChain').checked ? ' · 連續播放' : ''}`
    : '';
  queue.forEach((it, i) => {
    const row = document.createElement('div');
    row.className = `plItem${i === at ? ' on' : ''}`;
    row.innerHTML = `<span class="plNo"></span>
      <button class="plPick" type="button"><span class="plName"></span><span class="plMeta"></span></button>
      <button class="plX" type="button" title="從清單移除">✕</button>`;
    row.querySelector('.plNo').textContent = String(i + 1);
    row.querySelector('.plName').textContent = it.file.name;
    row.querySelector('.plMeta').textContent = it.error
      ? `讀取失敗：${it.error}`
      : !it.midi.tracks.length
        ? '沒有音符'
        : `${fmtTime(it.midi.duration)} · ${it.midi.tracks.length} 軌 · ${it.notes} 音符`;
    // 點目前這一列＝從頭再播一次，點別列就換過去（自動播放關著時只載入不出聲）。
    row.querySelector('.plPick').onclick = () => selectItem(i, { play: i === at || !!$('midiAutoPlay').checked });
    row.querySelector('.plX').onclick = () => removeItem(i);
    host.append(row);
  });
}

$('midiFile').onchange = (e) => {
  const files = [...e.target.files];
  e.target.value = '';   // picking the same file twice must fire change again
  addFiles(files);
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
  addFiles([...e.dataTransfer.files]);   // 整批拖進來＝整批進清單
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
    // 兩組音色：晶片很快，寫實是疊泛音＋微走音＋起音雜訊的合成，每個音都要完整
    // 算完尾巴，約慢 10-15 倍，所以標上「慢」——長曲子用寫實要等，這是誠實的提示，
    // 不是限制。renderMidi 兩邊都認得（`real:<name>` 就是寫實那一組）。
    for (const [label, bank] of [['晶片（快）', 'chip'], ['寫實（慢）', 'real']]) {
      const group = document.createElement('optgroup');
      group.label = label;
      for (const k of Object.keys(INSTRUMENT_BANKS[bank])) {
        group.append(new Option(INSTRUMENT_LABELS[bank][k] || k, bank === 'chip' ? k : `real:${k}`));
      }
      sel.append(group);
    }
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

/** 這一首有沒有用到寫實音色？它們每個音都要完整合成尾巴，比晶片約慢 10-15 倍。 */
const usesRealVoices = () => midiTracks.some((t) => !t.mute && String(t.instrument).startsWith('real:'));

async function playMidi(offset = 0) {
  midiStarted = false;   // 還沒真的開始播（這中間的 tick 不該當成「播完了」）
  midiDone = false;      // 新的一輪：下一次「播完」要重新判斷
  $('midiStatus').textContent = usesRealVoices() ? '合成中…（寫實音色較慢，請稍等）' : '合成中…';
  await new Promise((r) => setTimeout(r));   // let the status paint before the render blocks
  if (!midi || !midi.tracks.length) return;
  const t0 = performance.now();
  const src = audio.playMidi(midi, { tracks: midiTracks, speed: midiSpeed, loop: $('midiLoop').checked, offset });
  const ms = performance.now() - t0;
  // 全部軌道都被靜音之類的情況：沒有東西可播就不要假裝在播，也別讓連續播放接力下去。
  if (!src) { setOwner(null); $('midiStatus').textContent = '這首沒有可播的聲音'; return; }
  setOwner('midi');
  midiStarted = true;
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
// 連續播放清單：一首播完自動接下一首（清單最後一首播完就停，不繞回開頭）。
$('midiChain').checked = prefs.get('midiChain', true) !== false;
$('midiChain').onchange = () => {
  prefs.set('midiChain', $('midiChain').checked);
  midiDone = false;
  buildList();   // 清單抬頭會跟著顯示「連續播放」
};
$('midiClear').onclick = () => {
  queue.length = 0;
  if (nowPlaying === 'midi') stopAllMusic();
  at = -1;
  midi = null;
  midiTracks = [];
  $('midiInfo').textContent = MIDI_HINT;
  $('midiStatus').textContent = '';
  buildList();
  buildTracks();
  rebuildScore();
};
$('wavMidi').onclick = async () => {
  // 寫實音色的 WAV 要算一段時間；先讓狀態畫出來，不然畫面會像當掉。
  if (usesRealVoices()) {
    $('midiStatus').textContent = '匯出中…（寫實音色較慢，請稍等）';
    await new Promise((r) => setTimeout(r));
  }
  downloadWav(renderMidi(midi, { tracks: midiTracks, speed: midiSpeed }), `${midiName}-remix.wav`, SAMPLE_RATE);
  if (!midiPlaying()) $('midiStatus').textContent = `已下載 ${midiName}-remix.wav`;
};

// ---------------------------------------------------------------- 開場
load(SFX_PRESETS.coin, 'coin');
syncSeek(0);
