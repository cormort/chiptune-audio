import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 頁面 markup 與 page/ 模組之間的兩個約定。重構最容易漏掉的正是這一類：
// 打錯一個 id（$('x') 拿到 null）或改了區塊 id 而導覽還在指舊的，頁面照樣載入，
// 只有真的去點那個控制項才會壞。
const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

const PAGES = [
  { html: 'console.html', scripts: ['page/console.js', 'page/mixer.js', 'page/pianoview.js', 'page/ui.js'], inPageNav: true },
  // 首頁現在是樂器 app（電子琴），控制台搬到 console.html
  { html: 'index.html', scripts: ['page/keyboard.js', 'page/ui.js'], inPageNav: true },
  { html: 'kalimba.html', scripts: ['page/kalimba.js', 'page/ui.js'], inPageNav: true },
  // 琴譜頁原本自成一格：沒有 manifest、沒有 service worker，所以在那一頁**完全沒辦法
  // 安裝 PWA**（Chrome 的安裝判定看的是當前文件，回報 `no-manifest`）。現在跟其他頁一樣。
  { html: 'score.html', scripts: ['page/score.js', 'page/ui.js'], inPageNav: false },
];

test('page modules only look up ids the page markup defines', () => {
  for (const page of PAGES) {
    const markup = read(page.html);
    const ids = new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    for (const file of page.scripts) {
      const src = read(file);
      for (const m of src.matchAll(/\$\('([^']+)'\)/g)) {
        assert.ok(ids.has(m[1]), `${file} looks up #${m[1]}, which ${page.html} does not define`);
      }
    }
  }
});

test('every in-page link points at a section the page has', () => {
  for (const page of PAGES) {
    const markup = read(page.html);
    const anchors = [...markup.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    if (page.inPageNav) assert.ok(anchors.length > 0, `${page.html} has no in-page navigation`);
    for (const a of anchors) {
      assert.ok(markup.includes(`id="${a}"`), `${page.html} links to #${a}, which it does not define`);
    }
  }
});

// 「怎麼安裝」不該是猜謎題，而安裝判定是**看當前文件**的：任何一頁少了 manifest／
// service worker，使用者在那一頁就完全沒有安裝入口（score.html 就是這樣壞掉的）。
test('every page can be installed: manifest, icons, and the service worker', () => {
  for (const page of PAGES) {
    const markup = read(page.html);
    assert.ok(markup.includes('href="manifest.webmanifest"'), `${page.html} has no manifest link: Chrome reports no-manifest`);
    assert.ok(markup.includes('rel="apple-touch-icon"'), `${page.html} has no apple-touch-icon (iOS uses it for the home-screen icon)`);
    assert.ok(markup.includes('apple-mobile-web-app-capable'), `${page.html} would open with Safari chrome on iOS`);
    const mod = page.scripts.find((f) => f !== 'page/ui.js' && f !== 'page/mixer.js' && f !== 'page/pianoview.js');
    const src = read(mod);
    assert.match(src, /registerServiceWorker\(\)/, `${mod} never registers the service worker`);
    assert.match(src, /installApp\(\)/, `${mod} never shows the install button`);
  }
  // 身分（id）要寫死在 manifest 裡。start_url 換過三次，而沒有 id 時瀏覽器是拿
  // start_url 當身分——等於每次改首頁都變成「另一個 app」，已安裝的舊圖示不會跟著更新。
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.ok(manifest.id, 'the manifest has no id: changing start_url forks the installed app');
  assert.equal(manifest.start_url, './', 'the app must start on the instrument page');
});

test('importing MIDI keeps every file of a batch, not just one of them', () => {
  const markup = read('console.html');
  const input = markup.match(/<input id="midiFile"[^>]*>/);
  assert.ok(input, 'index.html has no #midiFile');
  assert.match(input[0], /\bmultiple\b/, '#midiFile cannot pick more than one file');
  // 播放清單的容器與開關：模組會查這些 id，缺一個清單就建不起來。
  for (const id of ['midiList', 'midiListInfo', 'midiItems', 'midiClear', 'midiChain']) {
    assert.ok(markup.includes(`id="${id}"`), `index.html does not define #${id}`);
  }
  const src = read('page/console.js');
  // 兩個入口都必須把整批交出去：只拿 files[0] 或從裡面挑一個，多選就白按了。
  assert.match(src, /\[\.\.\.e\.target\.files\]/, 'the file input does not hand over the whole selection');
  assert.match(src, /addFiles\(files\)/, 'the selected files are never imported');
  assert.match(src, /addFiles\(\[\.\.\.e\.dataTransfer\.files\]\)/, 'a drop does not hand over the whole batch');
  assert.ok(!/files\.find\(/.test(src), 'the drop handler still picks a single file out of the batch');
});

test('the performance view starts zoomed, not with the whole range squeezed in', () => {
  // 自動播放時的演奏畫面：整首塞進去看的是全貌，但每個鍵只有幾 px，琴鍵與鏡頭就沒意義了。
  // 第一次打開（沒有存過設定）要落在 22 個白鍵；存過設定的話照使用者選的。
  const src = read('page/console.js');
  const fallback = src.match(/KEY_CHOICES\.includes\(savedKeys\) \? savedKeys : (\w+)/);
  assert.ok(fallback, 'page/console.js no longer picks a default key count');
  const value = /^\d+$/.test(fallback[1]) ? Number(fallback[1]) : Number(src.match(new RegExp(`const ${fallback[1]} = (\\d+)`))?.[1]);
  assert.ok(value >= 16, `the default key window is ${value} white keys: too zoomed out to see a performance`);
  const markup = read('console.html');
  assert.ok(markup.includes(`<option value="${value}">`), `index.html has no option for the default ${value}`);
});

test('the console sections start collapsed, and the nav still opens them', () => {
  // 手機上四個區塊疊起來要好幾次捲動；三個工作區塊預設收合，只留標題。
  // 這種事在測試裡看不出來，所以釘住三件會壞掉的地方：哪幾區該收、主控不該收、
  // 以及「導覽連結指到收合的區塊要自動展開」（不然點了看起來像沒反應）。
  const markup = read('console.html');
  const collapsed = [...markup.matchAll(/<section id="([^"]+)"[^>]*data-collapse/g)].map((m) => m[1]);
  assert.deepEqual(collapsed, ['sfx', 'music', 'midiSection'], 'the three working sections should collapse');
  assert.ok(!collapsed.includes('master'), '主控是最短的區塊，也是所有聲音的出口，不該收起來');
  for (const id of collapsed) {
    assert.ok(markup.includes(`href="#${id}"`), `no nav link to #${id}: nothing would expand it`);
  }
  const ui = read('page/ui.js');
  assert.match(ui, /section\[data-collapse\]/, 'page/ui.js does not look for the collapsible sections');
  assert.match(ui, /defaultOpen = false/, 'collapsible sections must start collapsed');
  assert.match(ui, /hashchange/, 'in-page links would scroll to a collapsed section');
  assert.match(ui, /prefs\.get\(key/, 'the open/closed choice is not remembered');
  // 匯入 MIDI 時要展開那一區（拖進去的檔案不該掉進收起來的抽屜）
  const consoleSrc = read('page/console.js');
  assert.match(consoleSrc, /collapsibleSections\(/, 'page/console.js never wires the sections');
  assert.match(consoleSrc, /sections\.open\('midiSection'\)/, 'importing a file does not reveal the MIDI section');
  assert.ok(read('page/theme.css').includes('section[data-collapse]'), 'page/theme.css has no collapsed style');
});

test('a finished MIDI frees the music bus, so the part faders stop looking disabled', () => {
  // 聲部推桿在 MIDI 擁有音樂匯流排時會被標成未生效（.inactive ＋ 一行提示）。
  // 曲子播完之後匯流排就空著了，那時候推桿是有作用的——沒還原的話畫面會一直說
  // 「MIDI 播放中」，使用者拉推桿卻以為壞掉。
  const src = read('page/console.js');
  const branch = src.slice(src.indexOf('const next = nextPlayable(at + 1)')).slice(0, 400);
  assert.match(branch, /setPartsActive\(true\)/, 'the end of a piece must re-activate the part faders');
  assert.match(src, /setOwner\('midi'\)/, 'playing a MIDI still has to mark them inactive');
});

test('the selected preset is the one you are hearing, not the last one clicked', () => {
  // 拉過滑桿之後參數已經不是那個預設了，按鈕卻還亮著——畫面等於在說謊。
  // 所以「選取」必須由現在的參數算出來：拉走就不亮，拉回來自己亮回來。
  const src = read('page/console.js');
  assert.match(src, /function paintPresets\(/, 'the preset highlight is not derived from the parameters');
  const refresh = src.slice(src.indexOf('function refresh()'), src.indexOf('function drawWave'));
  assert.match(refresh, /paintPresets\(\)/, 'refresh() must repaint the highlight');
  assert.ok(!/dataset\.preset === name/.test(src), 'a preset is still marked selected by name alone');
  // 波形下拉要跟畫面上其他控制項一樣是中文（程式裡的名字留著給 JSON／CLI 對照）
  assert.match(src, /方波 SQUARE/, 'the wave dropdown still shows raw enum names');
});

test('both pages share the theme and pull in no page-local copy of it', () => {
  for (const page of PAGES) {
    const markup = read(page.html);
    assert.ok(markup.includes('href="page/theme.css"'), `${page.html} does not load page/theme.css`);
    assert.ok(!markup.includes('--key-white:'), `${page.html} still defines theme tokens itself`);
  }
});
