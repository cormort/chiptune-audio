// 鋼琴演奏顯示：落下的音符與發聲的琴鍵。幾何全部來自 src/pianoroll.js，這裡只負責畫。
// 播放頭讀 audio.musicTime（AudioContext 的時鐘），所以重新合成、換樂器或改變速度後續播，
// 畫面都對得上聲音；停止時停在 freeze 這個位置，讓點擊／拖曳可以預覽別的地方。
import { instrumentNote, instrumentRelease, BLACK_KEY_HEIGHT, keyAt, noteIndexAfter, notesSoundingAt, pianoLayout, pianoRange, pitchName } from '../src/index.js';
import { fmtTime, theme } from './ui.js';

const TRACK_HUES = [214, 330, 152, 32, 268, 190, 4, 96];
const trackColor = (i) => `hsl(${TRACK_HUES[i % TRACK_HUES.length]} 70% 52%)`;

// 鼓沒有音高，把 GM 鼓號分成幾欄，讓同一種鼓固定落在同一個位置。
const DRUM_COLUMNS = [[36, 0.06], [40, 0.28], [47, 0.48], [53, 0.66], [59, 0.82], [127, 0.94]];
function drumColumn(note) {
  for (const [max, frac] of DRUM_COLUMNS) if (note <= max) return frac;
  return 0.94;
}

/** @param opts.canvas       畫布
 *  @param opts.showToggle   「顯示鋼琴演奏」checkbox（可省略）
 *  @param opts.windowSelect 視窗秒數 <select>（可省略）
 *  @param opts.info         時間／狀態文字（可省略）
 *  @param opts.clock        () => ({ playing, time, owned })：現在播到哪、是否正在發聲、
 *                           音樂匯流排是否由 MIDI 擁有（用來分辨「播完」與「被停止」）
 *  @param opts.onSeek       (t) => void：播放中拖到別的位置時，請頁面重新合成續播
 *  @param opts.onTick       (t, playing) => void：每次重畫後回報位置（進度條跟著跑）
 *  @param opts.audio        ChiptuneAudio：點琴鍵試聽用
 */
export function createPianoView(opts) {
  const { canvas, showToggle, windowSelect, info, clock, onSeek = () => {}, onTick = () => {}, audio } = opts;

  const view = {
    score: { notes: [], maxDur: 0, duration: 0 },
    low: 48, high: 72,
    layout: null, width: 0,
    count: 0,          // 沒被靜音的音符數，只有換譜時才算
    hasDrums: false,
    freeze: 0,         // 停止時停在這個位置
    ended: false,
    raf: 0,
    text: '',
  };

  const on = () => !showToggle || showToggle.checked;

  /** 換一份譜（flattenMidi 的結果；null 表示清空）。 */
  function setScore(score) {
    view.score = score || { notes: [], maxDur: 0, duration: 0 };
    const range = pianoRange(view.score.notes);
    view.low = range.low;
    view.high = range.high;
    view.count = view.score.notes.reduce((n, note) => n + (note.mute ? 0 : 1), 0);
    view.hasDrums = view.score.notes.some((n) => n.drum && !n.mute);
    view.layout = null;
    view.freeze = Math.min(view.freeze, view.score.duration);
    schedule();
  }

  function schedule() {
    if (!view.raf) view.raf = requestAnimationFrame(tick);
  }

  function tick() {
    view.raf = 0;
    draw();
    if (clock().playing) { schedule(); return; }        // 播放中就持續更新
    // 一首播完（沒有循環）之後停在最後一個音符上，畫面會是空的：倒回開頭，
    // 讓人看到接下來要彈的東西。被使用者按停止（owned 為 false）時不動。
    if (view.ended && view.freeze > 0 && duration() > 0 && view.freeze >= duration() - 0.05) {
      view.freeze = 0;
      view.ended = false;
      draw();
    }
  }

  /** 這張 canvas 的分割：旋律區、節奏帶、鍵盤，以及每秒幾像素。 */
  function metrics(W, H) {
    const keysH = H < 240 ? 46 : 64;
    const drumH = view.hasDrums ? (H < 240 ? 11 : 15) : 0;
    const rollBottom = H - keysH - drumH;
    const seconds = +(windowSelect && windowSelect.value) || 4;
    return { keysH, drumH, rollBottom, seconds, pxPerSec: rollBottom / seconds };
  }

  function say(text) {
    if (view.text === text) return;
    view.text = text;
    if (info) info.textContent = text;
  }

  function draw() {
    const visible = on();
    canvas.style.display = visible ? 'block' : 'none';
    if (!visible) { say('鋼琴演奏顯示已關閉'); return; }

    const W = Math.max(1, canvas.clientWidth);
    const H = Math.max(1, canvas.clientHeight);
    const scale = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(W * scale) || canvas.height !== Math.round(H * scale)) {
      canvas.width = Math.round(W * scale);     // 背後的點陣圖跟著 DPR 放大，字才不會糊
      canvas.height = Math.round(H * scale);
    }
    const g = canvas.getContext('2d');
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.clearRect(0, 0, W, H);

    const muted = theme('--muted', '#666');
    const line = theme('--line', '#ccc');
    const accent = theme('--accent', '#3558d6');
    const keyWhite = theme('--key-white', '#fff');
    const keyBlack = theme('--key-black', '#22252f');
    const keyInk = theme('--key-white-text', '#62677a');

    if (!view.score.notes.length) {
      g.fillStyle = muted;
      g.font = '13px ui-monospace, monospace';
      g.textAlign = 'center';
      g.fillText('匯入 .mid / .smf 後，這裡會跟著音樂顯示鋼琴演奏', W / 2, H / 2);
      g.textAlign = 'start';
      say('尚未載入 MIDI');
      return;
    }

    const { keysH, drumH, rollBottom, seconds, pxPerSec } = metrics(W, H);
    if (!view.layout || view.width !== W) {
      view.layout = pianoLayout(view.low, view.high, W);
      view.width = W;
    }
    const keys = view.layout.keys;
    const state = clock();
    const now = state.playing ? state.time : view.freeze;
    if (state.playing) view.freeze = now;
    view.ended = !state.playing && !!state.owned;

    // ---- 旋律區：往下掉的音符 ----
    g.save();
    g.beginPath();
    g.rect(0, 0, W, rollBottom);
    g.clip();
    g.font = '10px ui-monospace, monospace';
    for (const [note, k] of keys) {         // 每個 C 一條線，當作位置的依據
      if (note % 12 !== 0) continue;
      const x = Math.round(k.x) + 0.5;
      g.strokeStyle = line;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, rollBottom);
      g.stroke();
      g.fillStyle = muted;
      g.fillText(pitchName(note), x + 3, 11);
    }
    const from = noteIndexAfter(view.score.notes, now - Math.max(seconds, view.score.maxDur));
    for (let i = from; i < view.score.notes.length; i++) {
      const n = view.score.notes[i];
      if (n.mute || n.drum) continue;
      const k = keys.get(n.note);
      if (!k) continue;
      const h = Math.max(3, n.dur * pxPerSec);
      const bottom = rollBottom - (n.time - now) * pxPerSec;
      if (bottom < -1) break;                          // 更後面的都還在畫面之上
      if (bottom - h > rollBottom) continue;           // 已經滑過鍵盤線
      const w = Math.max(1.5, k.w - 1);
      g.globalAlpha = 0.4 + 0.6 * Math.min(1, n.vel);
      g.fillStyle = trackColor(n.track);
      g.beginPath();
      if (g.roundRect) g.roundRect(k.x + 0.5, bottom - h, w, h, Math.min(3, w / 2));
      else g.rect(k.x + 0.5, bottom - h, w, h);
      g.fill();
    }
    g.globalAlpha = 1;
    // 播放頭：音符掉到這條線就發聲
    g.strokeStyle = accent;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, rollBottom - 1);
    g.lineTo(W, rollBottom - 1);
    g.stroke();
    g.restore();

    // ---- 節奏帶：打擊樂沒有音高，用壓縮的時間軸提示即將到來的鼓點 ----
    if (drumH) {
      const laneSecs = 1.5;
      g.fillStyle = line;
      g.fillRect(0, rollBottom, W, drumH);
      g.save();
      g.beginPath();
      g.rect(0, rollBottom, W, drumH);
      g.clip();
      for (let i = from; i < view.score.notes.length; i++) {
        const n = view.score.notes[i];
        if (n.time > now + laneSecs) break;
        if (!n.drum || n.mute || n.time < now - 0.3) continue;
        const y = rollBottom + drumH * (1 - (n.time - now) / laneSecs);
        g.globalAlpha = Math.abs(n.time - now) < 0.12 ? 1 : 0.55;
        g.fillStyle = trackColor(n.track);
        g.beginPath();
        if (g.roundRect) g.roundRect(drumColumn(n.note) * W - 5, y - 2, 10, 4, 2);
        else g.rect(drumColumn(n.note) * W - 5, y - 2, 10, 4);
        g.fill();
      }
      g.globalAlpha = 1;
      g.restore();
    }

    // ---- 鍵盤：正在響的琴鍵用軌道顏色點亮 ----
    const keysTop = H - keysH;
    const active = new Map();
    for (const n of notesSoundingAt(view.score.notes, now, view.score.maxDur)) {
      if (n.drum || n.mute) continue;
      if (!active.has(n.note)) active.set(n.note, n);
    }
    for (const k of keys.values()) {          // 白鍵先鋪滿整個寬度
      if (k.black) continue;
      const hit = active.get(k.note);
      g.fillStyle = hit ? trackColor(hit.track) : keyWhite;
      g.fillRect(k.x, keysTop, k.w - 1, keysH);
      g.strokeStyle = line;
      g.lineWidth = 1;
      g.strokeRect(k.x + 0.5, keysTop + 0.5, k.w - 2, keysH - 1);
    }
    for (const k of keys.values()) {          // 黑鍵疊在上面
      if (!k.black) continue;
      const hit = active.get(k.note);
      g.fillStyle = hit ? trackColor(hit.track) : keyBlack;
      g.fillRect(k.x, keysTop, k.w, keysH * BLACK_KEY_HEIGHT);
    }
    if (view.layout.whiteWidth > 22) {        // 夠寬才標音名，否則會擠成一團
      g.font = '10px ui-monospace, monospace';
      g.textAlign = 'center';
      for (const [note, k] of keys) {
        if (note % 12 !== 0 || k.black) continue;   // 只標 C，當作八度的地標
        g.fillStyle = active.has(note) ? '#fff' : keyInk;
        g.fillText('C', k.x + k.w / 2, H - 5);
      }
      g.textAlign = 'start';
    }

    say(`${fmtTime(now)} / ${fmtTime(view.score.duration)} · ${state.playing ? '播放中' : '停止'} · ${view.count} 個音符`);
    onTick(now, state.playing);
  }

  // 點琴鍵試聽，點鍵盤線以上從該處開始播，點節奏帶不做事。
  canvas.onpointerdown = (e) => {
    if (!view.score.notes.length) return;
    const W = Math.max(1, canvas.clientWidth);
    const H = Math.max(1, canvas.clientHeight);
    const { keysH, drumH, rollBottom, pxPerSec } = metrics(W, H);
    const box = canvas.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;

    if (!view.layout) { view.layout = pianoLayout(view.low, view.high, W); view.width = W; }
    if (y >= H - keysH) {                     // 鍵盤：試聽
      const note = keyAt(view.layout, x, y - (H - keysH), keysH);
      if (note === null) return;
      const voice = audio && audio.playNote(instrumentNote('piano', note, { seconds: 1.2, vel: 0.9 }));
      if (voice) setTimeout(() => voice.release(instrumentRelease('piano') || 0.08), 420);
      say(`試聽 ${pitchName(note)}`);
      return;
    }
    if (drumH && y >= rollBottom) return;     // 節奏帶有自己的時間軸，不用來跳播
    seekTo(view.freeze + (rollBottom - y) / pxPerSec);
  };

  /** 跳到某個位置：播放中請頁面重新合成續播，停止時只更新畫面。 */
  function seekTo(t) {
    const at = Math.max(0, Math.min(duration(), Number.isFinite(t) ? t : 0));
    if (clock().playing) onSeek(at);
    else setFreeze(at);
  }

  /** 停止狀態下把畫面停在這裡（不碰聲音）。 */
  function setFreeze(t) {
    view.freeze = Math.max(0, Math.min(duration(), Number.isFinite(t) ? t : 0));
    view.ended = false;
    schedule();
  }

  function duration() { return view.score.duration || 0; }

  /** 版面要重算並重畫（顯示開關、視窗秒數、視窗大小改變時）。 */
  function refresh() {
    view.width = 0;
    view.layout = null;
    schedule();
  }

  if (showToggle) showToggle.onchange = refresh;
  if (windowSelect) windowSelect.onchange = refresh;
  // 視窗大小改變時鍵盤的像素寬度也變了：重新排版再畫一張。
  addEventListener('resize', refresh);

  schedule();   // 先畫一張空白提示，載入 MIDI 前也有東西看

  return {
    setScore, schedule, refresh, seekTo, setFreeze, duration,
    time: () => view.freeze,
    playing: () => clock().playing,
    redraw: draw,
  };
}
