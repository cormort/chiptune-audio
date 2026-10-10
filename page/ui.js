// 兩個頁面共用的小工具：DOM 查詢、主題色、時間格式、WAV 下載、設定記憶。
// 這裡不碰引擎，也不假設頁面上有哪些元素。
import { encodeWav } from '../src/index.js';

/** getElementById 的短名；找不到就回 null（呼叫端自己判斷）。 */
export const $ = (id) => document.getElementById(id);

/** 讀一個 CSS 變數（畫 canvas 時要跟著淺色／深色主題走）。 */
export function theme(name, fallback = '') {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** 秒數 -> m:ss。 */
export const fmtTime = (s) => {
  const t = Number.isFinite(s) && s > 0 ? s : 0;
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
};

export const round = (v, digits = 3) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/** 把一段 Float32 取樣存成 WAV 檔（瀏覽器下載）。 */
export function downloadWav(samples, filename, sampleRate) {
  const url = URL.createObjectURL(new Blob([encodeWav(samples, sampleRate)], { type: 'audio/wav' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Service worker 只在 http(s) 有效；file:// 開啟時直接跳過。 */
export function registerServiceWorker() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

/** 設定記憶：把 UI 狀態存在 localStorage，重新載入不用再調一次。
 *  localStorage 在無痕模式或滿了會丟錯，所以整包包在 try 裡，失敗就當作沒有記憶。 */
const PREFS_KEY = 'chiptune:ui:v1';

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const state = loadPrefs();
let saveTimer = 0;

function savePrefs() {
  clearTimeout(saveTimer);
  // 拖推桿會連發事件，攢一下再寫，避免每個 pixel 都碰一次 localStorage。
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(state)); } catch { /* 無痕模式：只少了記憶 */ }
  }, 250);
}

export const prefs = {
  get(name, fallback) {
    const v = state[name];
    return v === undefined ? fallback : v;
  },
  set(name, value) {
    if (state[name] === value) return;
    state[name] = value;
    savePrefs();
  },
  /** 一次寫多個鍵（例如整組混音設定）。 */
  patch(values) {
    let changed = false;
    for (const [k, v] of Object.entries(values)) {
      if (state[k] !== v) { state[k] = v; changed = true; }
    }
    if (changed) savePrefs();
  },
  /** 只給測試或「重設」用：清掉記憶。 */
  clear() {
    for (const k of Object.keys(state)) delete state[k];
    try { localStorage.removeItem(PREFS_KEY); } catch { /* 無痕模式 */ }
  },
};
