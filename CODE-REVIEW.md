# chiptune-audio 程式碼審查與優化報告

審查對象：[`cormort/chiptune-audio`](https://github.com/cormort/chiptune-audio)（分支 `claude/game-audio-engine-8ew1e5`，9,770 B／222 行程式碼，零依賴純 ES module）
本機位置：`chiptune-audio/`（`baseline/` 是未改動的原始碼冷凍副本，僅供比對與 parity 測試）

---

## 摘要

程式碼本身寫得乾淨、模組切分清楚、合成核心與 Web Audio 分離（因此可在 Node 測試）——這個架構決定是正確的，也是本專案最有價值的地方。但實際以程式探測後，發現三類問題：

1. **會讓遊戲當掉的缺陷**：`RangeError` 崩潰 ×2，以及 `generateSong({bars: 1e9})` 會把整個 process 記憶體耗盡（實測 `FATAL ERROR: JavaScript heap out of memory`）。根因是同一個——**緩衝區長度直接由 envelope 推導，完全沒有輸入驗證**。
2. **靜默錯誤（比當掉更危險）**：`renderSfx({freq: undefined})` 不會報錯，而是輸出一個帶直流偏壓的固定訊號；`freq: -100` 會變成大聲的直流偏移。這類錯誤在遊戲裡會以「聽起來怪」的形式出現，極難追查。
3. **明確的效能浪費**：`renderSfx` 迴圈內每個 sample 都呼叫 `Math.pow` 與 `Math.sin`；`renderSong` 對每個音符配置一個新陣列再複製一次（8 小節約 220 次）；自訂參數音效完全不做快取。

此外 README 宣稱的「seamlessly loopable」**實測並不成立**：迴圈接縫處的跳變量在 happy/4 小節是內部中位數步幅的 **5.35 倍**、tense 是 **9.84 倍**，也就是每次循環都會有可聽見的 click。

以上全部已修復，並以 **53 個測試**鎖定（其中包含「與原版逐位元相同」的 parity 測試，確保既有 seed 產生的曲子不會改變）。效能：

| | 原版 | 優化後 | 提升 |
|---|---|---|---|
| 10 個音效全部合成 | 6.40 ms | 1.81 ms | **3.5×** |
| 4 種情緒 × 8 小節整首合成 | 173.9 ms | 64.0 ms | **2.7×** |
| `renderSong('happy', 8 小節)` | 38.2 ms | 14.3 ms | 2.7× |
| `explosion` 音效 | 0.993 ms | 0.238 ms | 4.2× |
| `gameover` 音效 | 1.383 ms | 0.292 ms | 4.7× |

**關於「有沒有其他引擎可以整合或取代」——結論是：不建議取代。** 在整個 JS chiptune 生態裡，**沒有任何寬鬆授權的引擎同時具備「seed 程序化作曲 + 零依賴 + 無素材檔 + 可離線」**。`generateSong({seed, mood, bars})` 是這個專案唯一無可替代的資產；所有純 JS 的 SFX 引擎（ZzFX、jsfxr、Sonant-X）都是同一種架構（離線合成 PCM → AudioBuffer），既不解決 main-thread 阻塞，Sonant-X 甚至更慢。詳細評估見下方第四節——**有五個項目值得整合，但有八個是授權陷阱，其中 `libvgm` 完全沒有授權檔，比 GPL 更危險。**

---

## 一、審查發現

嚴重度：🔴 會崩潰／🟠 靜默錯誤／🟡 音質／🔵 效能／⚪ 工程品質

### 🔴 A1–A4：緩衝區長度未驗證，導致崩潰與 OOM

`renderSfx` 的緩衝區長度是 `Math.ceil((attack + sustain + decay) * SAMPLE_RATE)`，直接丟給 `new Float32Array(n)`，中間沒有任何檢查：

| 呼叫 | 實測結果 |
|---|---|
| `renderSfx({ attack: -1 })` | `RangeError: Invalid typed array length: -35280` |
| `renderSfx({ decay: Infinity })` | `RangeError: Invalid typed array length: Infinity` |
| `generateSong({ bars: 1e9 })` | process 直接死亡：`FATAL ERROR: Ineffective mark-compacts near heap limit — JavaScript heap out of memory`（依參數推算需配置 **302 TB** 的 PCM） |
| `generateSong({ bars: -5 })` | 不報錯，回傳 `{bars: -5, lead: []}`，之後才在 `renderSong` 的 `new Float32Array(-...)` 爆掉 |
| `generateSong({ bars: 2.7 })` | 不報錯，產生 **3 小節**的音符流，但緩衝區長度是 `2.7 × 16 × stepSamples`（非整數）→ `renderSong` 拋 `RangeError` |

`bars: 1e9` 那筆是我實際跑出來、整個 Node process 被 OOM killer 終止的。這代表任何把 `bars` 接到 UI 滑桿或 URL 參數的用法，都是一個遠端 DoS。

**修復**：新增 `normalizeSfx()` 逐參數驗證（非有限值回退預設、有限值 clamp 到 `LIMITS` 範圍），`MAX_SFX_SECONDS = 30` 作為單一音效硬上限；`generateSong` 驗證 `bars` 為 1..`MAX_BARS`(128) 的整數並拋出帶說明的 `RangeError`。

### 🟠 A5–A6：兩處靜默錯誤

**A5 — `{ freq: undefined }` 產生直流訊號。** `{...SFX_DEFAULTS, ...params}` 會讓 `undefined` 覆蓋預設值，於是 `freq * 2**(0)` = `NaN`，`phase` 被污染成 `NaN`；接著方波分支的 `phase < duty` 對 `NaN` 恆為 `false`，所以每個 sample 都輸出 `-1`。結果是**一個不報錯、聽起來像破音的直流偏壓訊號**。這比崩潰更糟，因為它不會留下堆疊。

**A6 — `freq: -100` 變成大聲的直流偏移。** 負頻率被 clamp 成 0 Hz，而 naive 振盪器在 `phase = 0` 時方波固定輸出 `+1`、三角波固定輸出 `-1` —— 又是一個直流訊號。

**修復**：非有限值一律回退預設（`undefined`/`NaN`/`Infinity` 都不會污染 phase）；`freq <= 0` 直接輸出靜音（0 Hz 本來就不會振盪）。

### 🟡 A7：迴圈接縫爆音（README 的宣稱與實測不符）

`renderSong` 把音符直接寫進長度為 `total` 的緩衝區，`mixInto` 遇到邊界就停，因此**越過迴圈終點的尾音被直接截斷**。實測（`seed: 7`，以「接縫跳變 ÷ 內部步幅中位數」衡量，>3 倍即可聽見）：

| 情緒／小節 | 原版比值 | 優化後 |
|---|---|---|
| happy / 4 | **5.35**（爆音） | 1.53 |
| tense / 4, 8 | **9.84 / 9.83**（爆音） | 2.06 |
| happy / 8 | 1.63 | 1.51 |
| calm / 4, 8 | 0.15 | 2.31 |
| sad / 4, 8 | 0.11 | 1.86 |

值得注意的是 calm 與 sad 在原版比值很低——那是**巧合**：被截斷的訊號剛好落在起點附近。這也說明用「接縫跳變」單獨當指標會誤判，所以我改用「是否為步幅離群值」，並另外驗證**這個測試在原版上會失敗**（見第三節）。

**修復**：緩衝區額外留 `TAIL_STEPS = 4` 步的 padding，渲染完再把 `[total, total+tail)` 疊回 `[0, tail)`。這在數學上等價於「週期訊號的連續取樣」：`S[i] = B[i] + B[i+P]`，因此接縫不再是截斷造成的人工不連續。

### 🟡 A8：所有雜訊聲都是同一份

`renderSfx` 內寫死 `mulberry32(1)`。這保證了決定性（測試也依賴這點），但代價是**每個 snare 與 hi-hat 都是位元級完全相同的複製品**——8 小節裡 16 個 hi-hat 一字不差，聽起來非常機械。

**修復**：`seed` 成為正式參數（預設 1，維持相容），`renderSong` 對每次鼓點以 `0x5eed + step` / `0xbeef + step` 推進種子。仍然完全決定性（同 seed 同曲子），但鼓點不再複製。順帶修掉一個小問題：原本 `nv` 從 0 起算，雜訊音效開頭會有一小段靜音（在最大聲的瞬間），現在立刻初始化。

### 🟡 A9：無 band-limiting（設計取捨，非 bug）

方波、鋸齒都是硬邊，沒有 polyBLEP/blip，高頻會 aliasing。對「8-bit 風味」引擎這是可接受取捨，但**應該在 README 明確講清楚**，否則使用者會問「為什麼聽起來不像真的 NES？」。已於 README 加上說明，並提供 opt-in 的 master 低通濾波器（`new ChiptuneAudio({ filter: { freq: 11000 } })`）作為緩解。

### 🔵 A10：每個 sample 都在算超越函數

```js
let f = p.freq * 2 ** (p.slide * t);              // 每 sample 一次 pow
if (p.vibDepth) f *= 1 + p.vibDepth * Math.sin(2 * Math.PI * p.vibRate * t);  // 每 sample 一次 sin
const env = t < p.attack ? t / p.attack : ...     // 每 sample 重算 t 並做除法
phase += f / SAMPLE_RATE;                          // 每 sample 一次除法
```

`win` 與 `powerup` 這類帶 vibrato 的預設因此慢了 3–4 倍（`win`: 1.212 ms）。

### 🔵 A11：`renderSong` 每個音符配置並複製一次

對每個音符呼叫 `renderSfx`（配置新 `Float32Array`）再 `mixInto` 複製。8 小節約 **220 個音符 → 220 次配置 + 220 次完整複製**。

### 🔵 A12：自訂參數音效不快取

`playSfx` 只對「預設名稱」做快取；傳入物件時**每次呼叫都重新合成**。遊戲裡若每幀播放自訂音效，就是每幀跑一次完整合成。

### 🔵 A13：取樣率硬寫 44100

`createBuffer(1, n, SAMPLE_RATE)` 固定 44100 Hz，但絕大多數裝置的 `AudioContext` 是 **48000 Hz** → 每個音效都被瀏覽器重新取樣（浪費 CPU，且多一次品質損失）。

### 🔵 A14：第一次 `playMusic` 在主執行緒同步阻塞

8 小節要 38–56 ms；手機大約慢 5–10 倍 → **200–600 ms 的畫面凍結**，而且是在使用者手勢回呼裡發生。這是最影響體感的一項。

### ⚪ A15：API 與生命週期缺口

- `setVolume`/`setMuted` 直接指定 `gain.value` → zipper noise／爆音
- **沒有 `dispose()`** → `AudioContext` 永不關閉（瀏覽器有數量上限，SPA 會累積洩漏）
- `playSfx` 不回傳任何東西 → 無法停止長音效；也沒有 `stopAllSfx`
- 輸出永遠是 mono，沒有 pan、沒有 master 效果
- 無法把已生成的歌曲物件交給 `playMusic`（只能傳選項重新生成）

### ⚪ A16：打包與合規

- **repo 裡完全沒有 LICENSE 檔案**，但 `package.json` 寫 `"license": "MIT"` → 對下游使用者是真實的合規缺口（`package.json` 的宣告不具法律效力，需要授權全文）
- 沒有型別定義、沒有 `exports` map、沒有 `files` / `sideEffects`
- `index.html` 依賴 `fonts.googleapis.com`（第三方、render-blocking、離線直接失效）——與專案「零依賴／可離線」的定位衝突

---

## 二、已完成的優化

### 修復對照

| 原況 | 現況 |
|---|---|
| `renderSfx({attack: -1})` → `RangeError` | `normalizeSfx()` 驗證 + clamp，永不觸及配置器 |
| `renderSfx({decay: Infinity})` → `RangeError` | 同上，且單一音效不超過 `MAX_SFX_SECONDS`(30 s) |
| `{freq: undefined}` → 靜默直流訊號 | 非有限值回退預設 |
| `freq: -100` → 大聲直流偏移 | `freq <= 0` 輸出靜音 |
| `generateSong({bars: 1e9})` → OOM 殺掉 process | 驗證為 1..128 整數，拋出可讀的 `RangeError` |
| `bars: 2.7` → 音符流與緩衝區長度不一致 | 取整並保持一致 |
| 所有雜訊共用 `mulberry32(1)` | `seed` 參數化，`renderSong` 每次鼓點推進 |
| 迴圈尾音被截斷 → click（5.35× / 9.84×） | padding + 尾音回疊，接縫不再是離群值 |
| 自訂參數音效每次重新合成 | 以正規化參數值為 key 做 LRU 快取（上限 64） |
| 一律 44100 Hz 被瀏覽器重新取樣 | 依 `AudioContext` 實際 rate 合成 |
| `setVolume` 直接跳值 | `setTargetAtTime` 平滑 ramp |
| `AudioContext` 無法釋放 | `dispose()` |
| 未知 `bars`／`NaN` 音量無處理 | 驗證並給出說明性錯誤 |

### 效能手法

1. **`Math.pow` → 連乘**：`f(i) = freq · 2^(slide·i/SR)` 改用 `f *= 2^(slide/SR)`。1e6 次連乘的相對誤差約 1e-10，遠低於可聞範圍。
2. **`Math.sin` → 2048 項查表 + 線性內插**（誤差 ~3e-7）。這是最關鍵的一步：**每個 lead 音符都帶 vibrato**，所以整首曲子都在付 `Math.sin`。僅此一項就讓整首合成從 104 ms 降到 63 ms。
3. **直接混入目標緩衝區**：新增 `renderSfxInto()`，`renderSong` 不再為每個音符配置與複製陣列。
4. **envelope 改為增量步進**：不再每 sample 重算 `t = i/SR` 與除法；`decay === 0` 用 `Infinity` 步長自然收斂到 0，與原語意一致。
5. **逐鼓點 seed 取代共用 PRNG**：雜訊不再複製，同時保持完全決定性。

補充一個**尚未處理的觀察**：四種情緒的峰值**全部恰好等於 0.9000**，代表每個 preset 的 pre-normalization 峰值都超過 0.9，全域衰減每次都真的在做事。這說明 gain staging 沒有被控制（衰減應該是安全網，而不是常態）。我**刻意沒有改**，因為任何調整都會改變既有 seed 的輸出音量、破壞 parity 保證。若日後要處理，方向是分別調低 lead/bass/鼓的 `vol` 讓峰值自然落在 0.8 附近，而不是依賴全域正規化。

### 新增 API（全部為向後相容的擴充）

`renderSfxInto`, `normalizeSfx`, `MAX_SFX_SECONDS`, `MAX_BARS`, `STEPS_PER_BAR`,
`preloadMusic`（**在載入畫面先算好，播放時零卡頓**）, `stopAllSfx`, `resume`, `setFilter`, `dispose`,
每次播放的 `pan` / `rate` / `gain`（`rate` 可讓同一個緩衝區以不同音高重複使用，省下重新合成）,
`playSfx`/`playMusic` 回傳節點, `opts.sampleRate`, `types/index.d.ts`, `LICENSE`。

### 體積變化（誠實揭露）

| | 原版 | 優化後 |
|---|---|---|
| 原始檔總計 | 9,770 B | 24,718 B |
| 註解／空白剝除後的實際程式碼 | 8,069 B | 16,376 B |
| 註解行數 | 11 | 93 |

程式碼實質成長約 2 倍，來自驗證層、快取、生命週期管理與 filter/pan/rate。**如果體積是硬需求，驗證層（`LIMITS` + `normalizeSfx`）是最容易精簡的部分**——但我建議保留，因為它修掉的正是「會把遊戲搞當」的那一類問題。

---

## 三、驗證方式

```bash
node test/all.js              # 53 個測試，全部通過
node test/bench.js baseline   # 原版基準
node test/bench.js src        # 優化後
node test/defects.probe.js baseline   # 缺陷探測：原版
node test/defects.probe.js src        # 缺陷探測：優化後
```

- **53 個測試全通過**（原本 5 個全數保留且未修改）
- **`test/parity.test.js`**：`generateSong` 對 **4 情緒 × 8 seed × 4 小節 = 128 組**與原版 **逐位元相同**（`deepEqual`），另外驗證 `mulberry32` 本身未變。這確保**任何既有 seed 產生的曲子都不會改變**——這是重構時最容易不小心破壞、也最難察覺的地方。
- **`test/engine.test.js`**：用一個最小 Web Audio stub 覆蓋原本完全沒有測試的 `ChiptuneAudio`（23 項：延遲建立 context、快取命中、LRU 上限、pan/rate/gain 串接、loop、`dispose` 冪等、filter 鏈路、缺 Web Audio 的錯誤訊息等）。順帶驗證了「buffer 以 context rate（48000）而非硬寫 44100 合成」。
- **`test/regressions.test.js`**：每個修復都有一條對應的迴歸測試，且測試名稱直接引用當初的錯誤（例如 `was RangeError: length -35280`）。
- **判別性驗證**：新的迴圈測試我另外拿原版跑過一次，確認它**在原版上會失敗**（`happy/4: 5.35x`）——避免寫出「兩邊都會過」的無效測試。
- **`test/api.test.js`**：驗證 `index.html` 匯入的每個名稱都存在、呼叫的每個 engine 方法都存在、demo script 語法正確（以「錯誤不是 `SyntaxError`」判別）。

一個環境限制值得記錄：`node --test test/*.test.js` 會為每個檔案 spawn 帶 pipe 的子行程，在受限沙箱中會 `spawn EPERM`。因此我另外提供 `node test/all.js`（同一批測試在單一 process 內執行）與 `npm run test:direct`。這不是專案缺陷。

---

## 四、其他引擎：整合或取代？

我針對整個 JS/browser chiptune 生態做了一輪查證（每個授權結論都實際讀過 LICENSE 檔、npm `license` 欄位或作者聲明）。

### 4.1 結論：不建議取代

**沒有任何寬鬆授權的引擎同時具備這四項：seed 程序化作曲、零依賴、無素材管線、可離線。** 更關鍵的是架構同質性：

> **ZzFX、ZzFXM、jsfxr、Sonant-X 與本專案全都是同一種架構**——在 JS 裡把樣本算成陣列、包成 `AudioBuffer`、用 `AudioBufferSourceNode` 播放。

所以換掉它們**不會**解決 main-thread 阻塞（Sonant-X 的 README 自己說 `generateSong` 可能要數秒，並建議在啟動時先算好——問題比本專案更嚴重）。而 ZzFXM、Sonant-X、BeepBox 都**需要手工作曲**，採用它們等於放棄 `generateSong` 這個唯一無可替代的功能。

### 4.2 值得整合的（依價值排序）

| 對象 | 授權 | 整合方式與注意事項 |
|---|---|---|
| **jsfxr base58 解碼器** | Unlicense（最寬鬆） | 最高性價比。本專案的參數模型本來就是 sfxr 家族，撈這個解碼器就能直接吃 [sfxr.me](https://sfxr.me) 的分享字串，瞬間獲得龐大的免費 preset 庫。**但要注意 `slide` 曲線不同**（本專案是指數 `2^(slide·t)`，sfxr 是線性 `p_freq_ramp`），且 sfxr 的 LPF/HPF/`p_pha_offset` 在本專案沒有對應——必須誠實標示為「有損轉換」。 |
| **ZzFX 參數模型** | MIT | 21 個參數 vs 本專案 14 個：多了 filter、tremolo、delay/echo、pitch jump、delta slide、立體聲 pan。`buildSamples`/`playSamples` 的切分與本專案 `renderSfx`/`_buffer` 幾乎 1:1，是 `renderSfx` 未來升級的現成參考。**不可 seed**（用 `Math.random`），且它在 module 載入時就建立 `AudioContext`。 |
| **`@audio/decode-mod`** | BSD-3 | 若真的需要播放 tracker 模組（MOD/XM/S3M/IT）。單檔 libopenmpt WASM、無 side file、無 `.mem`、非 `ScriptProcessorNode`。~1.4 MB。**這是比 chiptune2.js 全面更好的選擇。** |
| **`beepbox-lite`** | MIT | 零依賴播放 BeepBox 歌曲 JSON（BeepBox 本身 MIT）。適合當「作曲前端 + 播放」路線。注意它是簡化的 Web Audio 重新實作，保真度未經驗證。 |
| **`@beatbax/engine`** | MIT（1 依賴） | 忠實的 Game Boy APU（pulse duty/envelope、wavetable、LFSR noise）。~120 KB gzip。若哪天想要「真實的 duty-cycle 音色」這是寬鬆授權路線。 |

### 4.3 參考架構（研究它，不要照抄）

**[`algo-chip`](https://github.com/abagames/algo-chip)（MIT，零執行期依賴，已獨立驗證 npm metadata）** 是整個生態裡與本專案**概念上最接近的雙胞胎**：seed 決定性 BGM 生成、4 聲道（2×square + triangle + noise，正好是 NES 2A03 的聲道配置）、SFX 命名 10 個裡有 **7 個與本專案完全相同**（`jump, coin, explosion, hit, powerup, select, laser`）——這同時也印證了本專案的 preset 命名是生態標準。它以 **AudioWorklet** 執行，所以完全不阻塞 main thread。

但採用它的代價是：必須把 worklet 檔案複製到靜態資源目錄，或從 `abagames.github.io` 這個第三方來源載入 → **破壞「零素材管線／可離線」**。所以：**如果將來 main-thread 合成成本變成硬瓶頸，要抄的是它的架構（三個小型 AudioWorklet processor），而不是改用 Tone.js。**

**[`chipvoice`](https://github.com/gwendall/chipvoice)** 有一個很聰明的技巧值得學：它把 worklet **以 blob URL 內嵌**，所以 `npm install` 就是完整安裝、不需要任何 worklet 素材檔——這是在保留「無素材管線」前提下使用 AudioWorklet 的最佳做法。但它的授權是 SPDX 運算式 **`(MIT AND LGPL-2.1-or-later)`**（YM2612 與 S-DSP core 是逐行 LGPL port），**不要整包採用**。

`chipvoice` 的 README 也點出一件技術上重要的事，我已寫進本專案 README：**像本專案這種「線性疊加 naive 波形」的引擎，在原理上不可能重現 NES 2A03 的音色**——2A03 的兩個 pulse 是**非線性混合**（`95.88/(8128/(p1+p2)+100)`），而且訊號會經過三段類比濾波（HPF 90 Hz、HPF 440 Hz、LPF 14 kHz）。本專案是「8-bit 風味」而非模擬器，這是刻意的定位，講清楚可以預先回答「為什麼不像真的 NES」。

### 4.4 授權陷阱（在這個專案裡不要碰）

| 專案 | 授權 | 問題 |
|---|---|---|
| **`libvgm`** | **完全沒有授權檔** | API `license: null`、issue #129 標題就叫 "license?"、維護者僅回「大概可以給 GPL-2…也許 BSD-like」。**沒有授權比 GPL 更糟**（等同保留所有權利），而且容易漏看。 |
| **`chip-player-js`** | **GPL-3.0** | 且是 ~655 MB 的 C/Emscripten **應用**、不提供可重用 API、README 自稱 "difficult to self host"。 |
| **Strudel** | **AGPL-3.0-or-later** | 網路 copyleft，對「希望別人自由嵌入的函式庫」是最糟的選擇。 |
| **Furnace** | **GPL-2.0-or-later** | 且啟用 ASIO 會變成 GPLv3 binary。 |
| **`game-music-emu`** | LGPL-2.1 **→ GPL-2.0+** | 一旦啟用 MAME YM2612 core，其 `readme.txt` 明說整個 library 變成 GPL v2.0+。 |
| **`Nuked-OPN2` / `blip_buf`** | LGPL-2.1 | 瀏覽器 bundle 屬靜態連結，義務實務上很棘手。 |
| **`Bfxr`** | **找不到授權** | repo 是 ActionScript/Flash，README 與 LICENSE 都 404。 |
| **Sonant-X** | npm 寫 ISC / repo 寫 Zlib | 但血緣是 **CC-BY-NC-SA 2.5**（非商業 + 相同方式分享）。維護者稱原作者已同意改授權，但這是有紀錄的授權爭議 → 對標榜乾淨 MIT 的專案是盡職調查風險。 |

### 4.5 若真要「真實晶片音」

一律得付出 WASM/Emscripten 與體積代價，且**全部與本專案「零依賴、極小、可離線」的定位衝突**：
`jsnes`（Apache-2.0，純 JS，`onAudioSample` 可逐樣本取用，但那是整台 NES 模擬而非 APU 函式庫）、`apu`（BSD-3，~8.6 KB gzip 的真實 GB APU，但 2021 後未維護）、`libymfm.wasm`（BSD-3，ymfm + AudioWorklet）、`binjgb`（MIT，有 `make wasm`）、`SameBoy`（Expat/MIT，但無官方 wasm build）。

---

## 五、建議的下一步

1. **確認 `LICENSE` 的著作權人**——我先填了 `Copyright (c) 2026 cormort`（依 GitHub repo owner），請自行確認或調整。這是整份報告裡「每單位投入價值最高」的一項修復。
2. **考慮移除 demo 的 Google Fonts 依賴**（我已加上 `preconnect`，但離線仍會失效）。若在意「零依賴／可離線」的一致性，建議改用系統字型堆疊。
3. **若體積是硬需求**：可精簡 `LIMITS` 驗證層（程式碼 8.1 KB → 16.4 KB 的主要來源）。我建議保留，因為它修掉的正是會讓遊戲當掉的那類問題。
4. **考慮加上 jsfxr base58 解碼**——這是用最小成本換取最大生態收益的一步。
5. **`baseline/` 資料夾**是原始碼的冷凍副本，供 `test/parity.test.js` 比對；它不在 npm `files` 清單內。若要從 repo 移除，parity 測試會自動 skip（我已處理），但我建議保留它——它會在未來重構時守住「seed 不能變」這條線。
6. **若 main-thread 合成仍是瓶頸**（例如小節數要拉到 32 以上）：抄 `algo-chip` 的 AudioWorklet 架構，搭配 `chipvoice` 的 blob-URL 內嵌技巧以維持零素材管線。

---

## 附錄：檔案清單

| 路徑 | 說明 |
|---|---|
| `src/sfx.js` | 合成核心：`normalizeSfx`、`renderVoice`、`renderSfx`、`renderSfxInto`、9 個 preset |
| `src/music.js` | 作曲與編曲：`generateSong`、`renderSong`（含尾音回疊、逐鼓點 seed） |
| `src/engine.js` | Web Audio 層：`ChiptuneAudio`（快取、pan/rate/gain、filter、生命週期） |
| `src/index.js` | 對外匯出 |
| `types/index.d.ts` | 手寫型別定義 |
| `test/audio.test.js` | 原始 5 個測試（未修改） |
| `test/regressions.test.js` | 19 項缺陷迴歸測試 |
| `test/engine.test.js` | 23 項 Web Audio stub 測試 |
| `test/parity.test.js` | 與原版逐位元相同（128 組） |
| `test/api.test.js` | demo 與 export 的一致性 |
| `test/defects.probe.js` | 缺陷探測（可對 baseline 或 src 執行） |
| `test/bench.js` | 微基準（min-of-batches，避免 V8 tiering 造成的不穩定） |
| `baseline/` | 未改動的原始碼冷凍副本（比對基準） |
