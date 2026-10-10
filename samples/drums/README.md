# samples/drums — 真實鼓組的擊點

這裡是網頁用的鼓聲：GM 打擊樂音（35–84）對應的單聲道 mp3，一個擊點一個檔案。

## 來源與授權

**Virtuosity Drums** — Versilian Studios × Karoryfer Samples，**CC0 1.0**（公眾領域奉獻，
可自由使用、修改、再散布，不需要署名）。KVR Developer Challenge 2021 的參賽作品，
專案：<https://github.com/sfzinstruments/virtuosity_drums>

這裡只取其中一組麥克風（`Samples/mid/`，也就是混音後的 mid mic），挑出 GM 打擊樂需要的
那幾顆鼓與配件。原始檔（48 kHz 立體聲 FLAC，單一擊點 200 KB～1.4 MB）沒有進 repo。

## 這些檔案怎麼來的

由 `tools/build-drums.mjs` 產生（需要 ffmpeg 與網路）：

```bash
node tools/build-drums.mjs          # 只轉缺的檔案（已存在的沿用）
node tools/build-drums.mjs --force  # 全部重轉
```

每一個擊點的處理都一樣，這樣聲音才可預期：

1. 從 Virtuosity Drums 的 SFZ 對應檔（`Programs/mappings/...`）挑出對應力度層與
   round robin 的原始檔，所以「哪一個音用哪一個錄音」不是我猜的，是照它自己的對應。
2. 轉成單聲道 44.1 kHz、去掉開頭靜音（保留 3 ms）、依樂器切長度（大鼓 0.8 s、
   小鼓 0.7 s、閉合 hi-hat 0.5 s、crash 3 s…）、尾端 60 ms 淡出、正規化到 0.9 峰值。
3. 編成 96 kbps mp3：一個擊點 5–35 KB，整個鼓組 101 個檔案約 1.5 MB。

**力度層只改變音色，不是音量**（每一層都正規化到同一個峰值），音量交給播放時的
`gain`（= 力度 × 這一擊的基準音量，見 `page/drum-library.js` 的 `gain`）。這樣
「小力打」是換一個音色，而不是把大力的錄音轉小聲。

## 為什麼放進 repo 而不是像旋律樂器那樣連外抓

旋律樂器（小提琴、平台鋼琴…）的樣本在公開樣本庫，抓過就進瀏覽器快取；鼓不一樣：

* 鼓是**單發音**，不需要音高內插，所以可以壓得很小（整組 1.5 MB）
* 鼓幾乎每首曲子都要用，**等第一次下載很煩**；放進 repo 就隨按即響
* 同源檔案可以進 service worker 快取，**離線也打得到**

代價是 repo 多了約 1.5 MB 的二進位檔，而且 `package.json` 的 `files` 不含 `samples/`，
所以這些檔案只給 demo 頁面用，不會進 npm 套件。

## 沒錄到的音

`page/drum-library.js` 的 `missing` 列出沒有取樣的 GM 打擊樂音（例如 47 定音鼓、
76/77 木魚、78/79 庫伊卡）。播放時它們會退回原本的合成鼓，不會變成靜音。
