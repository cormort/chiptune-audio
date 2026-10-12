// 兩個頁面共用的小工具：DOM 查詢、主題色、時間格式、WAV 下載、設定記憶。
// 這裡不碰引擎，也不假設頁面上有哪些元素。
import { encodeWav, encodeWavStereo } from '../src/index.js';

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

/** 把一段取樣存成 WAV 檔（瀏覽器下載）。
 *  `samples` 是單聲道 Float32Array，或 `{ left, right }`（立體：取樣樂器有自己的
 *  左右聲道時走這條，例如平台鋼琴——它的左右是兩支不同視角的麥克風）。 */
export function downloadWav(samples, filename, sampleRate) {
  const bytes = samples && samples.left && samples.right
    ? encodeWavStereo(samples.left, samples.right, sampleRate)
    : encodeWav(samples, sampleRate);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Service worker 只在 http(s) 有效；file:// 開啟時直接跳過。
 *  updateViaCache: 'none' 讓瀏覽器檢查 sw.js 有沒有更新時不要用 HTTP 快取 —— 靜態主機
 *  （GitHub Pages）對每個檔都給 max-age=600，不這樣的話部署後最多十分鐘還拿到舊的 service
 *  worker，使用者重新載入也看不到新版。
 *
 *  啟用之後順便要它把音檔（約 11 MB）在背景抓齊。這件事刻意**不放在 install**：369 個
 *  檔案在手機上要一兩分鐘，卡在 install 會讓 service worker 一直停在 installing，
 *  那段時間瀏覽器不給安裝提示，離線也還沒生效。 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => navigator.serviceWorker.ready.catch(() => reg))
    .then((reg) => (navigator.serviceWorker.controller || reg.active)?.postMessage({ type: 'prefetch-media' }))
    .catch(() => {});
}

/** 「下載 App」連結：一個**永遠看得見**的安裝入口，掛在頁首導覽上。
 *
 *  為什麼是連結而不是等瀏覽器自己跳提示：`beforeinstallprompt` 不一定會來（iOS Safari
 *  從來不給、Firefox 不支援、App 內建瀏覽器多半擋掉、之前按過取消的話 Chrome 也會安靜
 *  一陣子），只靠那個事件等於「有支援的瀏覽器才有入口」。所以連結一律顯示，按下去的
 *  行為分三種：
 *
 *  - 有攔到 `beforeinstallprompt`：`prompt()` 開瀏覽器原生的安裝對話框。
 *  - 沒有（iOS、Firefox、內建瀏覽器…）：直接把「去哪裡按」寫在旁邊，不讓使用者猜。
 *  - 已經安裝（standalone 開啟）或安裝完成：連結消失／變成「✓ 已安裝」。
 *
 *  回傳 { el, link, click } 方便測試與手動觸發。 */
export function installApp({ into, label = '⬇ 下載 App' } = {}) {
  const standalone = matchMedia('(display-mode: standalone)').matches
    || matchMedia('(display-mode: minimal-ui)').matches
    || navigator.standalone === true;
  const host = into || document.querySelector('nav.nav') || document.querySelector('main') || document.body;
  const bar = document.createElement('div');
  bar.className = 'install-bar';
  // 長得像導覽連結（跟旁邊的「樂器／琴鍵」同一排），但用 button 才有正確的鍵盤與無障礙行為
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'install-link';
  link.textContent = label;
  const note = document.createElement('span');
  note.className = 'muted install-note';
  bar.append(link, note);
  if (!standalone) host.append(bar);

  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const android = /Android/.test(navigator.userAgent);
  const chromium = /Chrome|Chromium|Edg\//.test(navigator.userAgent) && !/Firefox/.test(navigator.userAgent);
  /** 講清楚「去哪裡按」。iOS 只有 Safari 能加主畫面；Chromium 平常會自己顯示安裝圖示，
   *  事件沒來通常是之前按過取消（瀏覽器會安靜一陣子）或已經裝過。 */
  const whereToInstall = () => {
    if (ios) return '在 Safari：分享 → 加入主畫面（要用 Safari；Chrome 或 App 內建瀏覽器不行）。';
    if (chromium && android) return '這個瀏覽器沒給安裝提示：改用 Chrome 開，或 ⋮ → 安裝應用程式／加到主畫面。';
    if (chromium) return '這個瀏覽器沒給安裝提示：用網址列右側的安裝圖示，或 ⋮ → 儲存並分享 → 安裝應用程式。';
    return '這個瀏覽器不支援安裝：改用 Chrome／Edge（電腦、Android）或 Safari（iPhone、iPad）。';
  };
  const say = (text) => { note.textContent = text; };
  let deferred = null;
  let installed = false;

  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();          // 自己決定什麼時候問：由使用者按下這個連結
    deferred = e;
    say('裝到桌面／開始功能表，之後離線也能開。');
  });

  addEventListener('appinstalled', () => {
    installed = true;
    link.textContent = '✓ 已安裝';
    link.disabled = true;
    say('已經裝好了，可以從桌面圖示開啟。');
  });

  link.onclick = async () => {
    if (installed) return;
    if (!deferred) { say(whereToInstall()); return; }   // 沒有原生提示：直接說去哪裡按
    link.disabled = true;
    deferred.prompt();
    const { outcome } = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }));
    deferred = null;
    link.disabled = false;
    if (outcome === 'accepted') {
      installed = true;
      link.textContent = '✓ 安裝中…';
      say('完成後桌面／開始功能表會多一個圖示。');
    } else {
      say('已取消。想安裝再按一次。');
    }
  };

  // iOS 沒有那個事件，先把說明放著，不然使用者只會看到一個按了沒反應的連結。
  if (!standalone && ios) say(whereToInstall());

  return { el: bar, link, get hasPrompt() { return !!deferred; }, click: () => link.click() };
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

/** 可收合的區塊：markup 只要在 <section> 上加 `data-collapse`，標題就會變成切換鈕。
 *
 *  為什麼預設收合：手機上四個區塊疊起來要好幾次捲動才看得到最後一區，而一次通常只
 *  用得到其中一區。收起來之後整頁的標題一目了然，點哪個開哪個。
 *  使用者點過就記住；導覽連結（#id）指到收合的區塊時會自動展開，不然點了像沒反應。
 *  回傳 { open } 讓呼叫端可以在「使用者做了某件事」時主動展開（例如匯入 MIDI）。 */
export function collapsibleSections({ defaultOpen = false } = {}) {
  const sections = new Map();

  for (const el of document.querySelectorAll('section[data-collapse]')) {
    const h2 = el.querySelector('h2');
    if (!h2) continue;
    // 標題本身變成按鈕：字型與顏色沿用 h2，只在右邊多一個箭頭
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'twist';
    while (h2.firstChild) btn.append(h2.firstChild);
    const caret = document.createElement('span');
    caret.className = 'caret';
    caret.setAttribute('aria-hidden', 'true');
    btn.append(caret);
    h2.append(btn);

    const key = `open:${el.id}`;
    const set = (open, remember = true) => {
      el.classList.toggle('collapsed', !open);
      btn.setAttribute('aria-expanded', String(open));
      btn.title = open ? '收起' : '展開';
      if (remember) prefs.set(key, open);
    };
    set(prefs.get(key, defaultOpen), false);
    btn.onclick = () => set(el.classList.contains('collapsed'));
    sections.set(el.id, { el, set });
  }

  /** 展開某個區塊（給「使用者剛做了跟它有關係的事」用，例如匯入 MIDI）。 */
  const open = (id) => {
    const hit = sections.get(id);
    if (hit) hit.set(true);
    return !!hit;
  };

  // 導覽連結指到收合的區塊：先展開再讓瀏覽器捲過去
  const reveal = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id && sections.has(id)) open(id);
  };
  addEventListener('hashchange', reveal);
  addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (a) setTimeout(reveal, 0);   // hash 沒變時不會有 hashchange
  });
  reveal();

  return { open, sections };
}
