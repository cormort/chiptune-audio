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

test('both pages share the theme and pull in no page-local copy of it', () => {
  for (const page of PAGES) {
    const markup = read(page.html);
    assert.ok(markup.includes('href="page/theme.css"'), `${page.html} does not load page/theme.css`);
    assert.ok(!markup.includes('--key-white:'), `${page.html} still defines theme tokens itself`);
  }
});
