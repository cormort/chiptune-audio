import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 頁面 markup 與 page/ 模組之間的兩個約定。重構最容易漏掉的正是這一類：
// 打錯一個 id（$('x') 拿到 null）或改了區塊 id 而導覽還在指舊的，頁面照樣載入，
// 只有真的去點那個控制項才會壞。
const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

const PAGES = [
  { html: 'index.html', scripts: ['page/console.js', 'page/mixer.js', 'page/pianoview.js', 'page/ui.js'] },
  { html: 'keyboard.html', scripts: ['page/keyboard.js', 'page/ui.js'] },
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
    assert.ok(anchors.length > 0, `${page.html} has no in-page navigation`);
    for (const a of anchors) {
      assert.ok(markup.includes(`id="${a}"`), `${page.html} links to #${a}, which it does not define`);
    }
  }
});

test('importing MIDI keeps every file of a batch, not just one of them', () => {
  const markup = read('index.html');
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
  const markup = read('index.html');
  assert.ok(markup.includes(`<option value="${value}">`), `index.html has no option for the default ${value}`);
});

test('both pages share the theme and pull in no page-local copy of it', () => {
  for (const page of PAGES) {
    const markup = read(page.html);
    assert.ok(markup.includes('href="page/theme.css"'), `${page.html} does not load page/theme.css`);
    assert.ok(!markup.includes('--key-white:'), `${page.html} still defines theme tokens itself`);
  }
});
