// 重算媒體快取的版本（`sw.js` 的 `MEDIA_VERSION`）。
//
// 為什麼需要：音檔快取（鼓組、卡林巴、長笛、弦樂群、吉他…約 9.5 MB）只有在**版本名字
// 變了**的時候才會重抓。純程式更新不該重抓它們（那是 `sw.js` 的 `install` 跳過的依據），
// 但**樣本真的換了**就必須換名字，不然使用者會一直拿到舊音檔。
//
// 雜湊的內容是 sw.js 裡那六個音檔清單的**檔名 + 檔案大小**——所以：
//   * 新增／刪除樣本 → 變
//   * 同一個檔名但內容改過（大小不同）→ 變
//   * 只有程式碼改動 → **不變**（使用者不用重抓 9.5 MB）
//
// 每個產生樣本的工具（build-velocity／build-drums／build-kalimba／build-flute／
// build-strings／build-guitar）跑完都會 import 這支，所以平常不用自己跑；
// 手動要跑就是 `npm run media`。
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SW = join(ROOT, 'sw.js');
const LISTS = ['DRUMS', 'RELEASES', 'KALIMBA', 'FLUTE', 'STRINGS_AND_VIB', 'GUITARS'];

const sw = readFileSync(SW, 'utf8');
const hash = createHash('sha1');
let files = 0;
let bytes = 0;
for (const name of LISTS) {
  const start = sw.indexOf(`const ${name} = [`);
  if (start < 0) throw new Error(`sw.js 裡找不到 ${name} 清單`);
  const end = sw.indexOf('];', start);
  const paths = [...sw.slice(start, end).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  hash.update(name);
  for (const p of paths) {
    files++;
    const abs = join(ROOT, p);
    const size = existsSync(abs) ? statSync(abs).size : -1;   // 路徑不在磁碟上也要有確定的值
    if (size > 0) bytes += size;
    hash.update(`${p}:${size}\n`);
  }
}
const version = `m${hash.digest('hex').slice(0, 8)}`;
const current = sw.match(/const MEDIA_VERSION = '([^']+)'/)?.[1];
if (current === version) {
  console.log(`媒體版本不變（${version}）：${files} 個檔、${(bytes / 1048576).toFixed(2)} MB`);
} else {
  writeFileSync(SW, sw.replace(/const MEDIA_VERSION = '[^']+'/, `const MEDIA_VERSION = '${version}'`));
  console.log(`媒體版本 ${current} → ${version}：${files} 個檔、${(bytes / 1048576).toFixed(2)} MB`);
}
