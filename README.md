# TranslateGemma 沉浸式翻譯

<p align="center">
  <strong>完全離線的本地翻譯工具</strong><br>
  使用 Google TranslateGemma-4b-it 模型，完全在你的電腦上運行
</p>

<p align="center">
  <a href="#功能特色">功能</a> •
  <a href="#快速開始">安裝</a> •
  <a href="#使用方式">使用</a> •
  <a href="#常見問題">FAQ</a> •
  <a href="#法律與使用條款">法律與使用條款</a>
</p>

---

## ✨ 功能特色

專注於解決語言障礙，支援 YouTube、Reddit、GitHub、新聞網站、Wikipedia 等多種場景。

| 功能 | 說明 |
|------|------|
| 🎬 **YouTube 翻譯** | 雙語字幕、標題、說明、留言、推薦影片 |
| 📰 **文章翻譯** | 自動翻譯新聞網站 (BBC, NYT 等) 的標題與內文 |
| 📚 **Wikipedia** | 支援所有語言版本的維基百科翻譯 |
| 🐙 **GitHub** | README、Issue、Pull Request 自動翻譯 |
| 🔴 **Reddit** | 帖子標題、內文、留言翻譯（列表頁僅標題） |
| ✋ **選取翻譯** | 任意網站選取文字自動彈出翻譯氣泡 |
| 🔒 **完全離線** | 資料不離開你的電腦，保護隱私 |
| ⚡ **獨立開關** | 各功能皆有獨立開關，隨時啟停 |
| 🌐 **智慧語言偵測** | 自動跳過中文內容，不重複翻譯 |

### 🖥️ 跨平台支援

- **macOS**: Metal GPU 加速 (M1/M2/M3)
- **Windows**: CUDA GPU 加速 (NVIDIA) 或 CPU 運算

---

## 📋 系統需求

| 項目 | 最低需求 | 建議配置 |
|------|---------|---------|
| 作業系統 | macOS 12+ / Windows 10+ | macOS 14+ / Windows 11 |
| Python | 3.10-3.12 | 3.12 |
| 記憶體 | 8GB RAM | 16GB+ RAM |
| 瀏覽器 | Chrome | Chrome |

---

## 🚀 快速開始

TranslateGemma 需要兩段安裝。這不是多做一步，而是 Chrome 擴充功能本身不能安裝本機模型、背景程式和系統橋接器。

請把它想成兩個盒子：

- **第一個盒子：本機程式**，負責模型、背景服務、Native Host、開機自動啟動。
- **第二個盒子：Chrome 擴充功能**，負責顯示按鈕、翻譯網頁、跟本機程式說話。

使用者不需要知道 venv、pip、server、Native Host 是什麼。這些都應該由安裝器處理。

### 第 1 步：先安裝本機程式

#### Windows

Windows 版目前不把未簽章 `.exe` 當作一般使用者主流程，因為 Windows Smart App Control 可能直接封鎖未知執行檔。

接下來的正式 Windows 流程會改成「複製一段指令到 PowerShell」：

1. 開啟 Windows Terminal 或 PowerShell。
2. 貼上 TranslateGemma 提供的安裝指令。
3. 等它自動安裝本機程式。
4. 看到安裝完成後，再去安裝 Chrome 擴充功能。

這段指令會自動做這些事：

- 檢查或引導安裝 Python 3.12。
- 建立 TranslateGemma 專用資料夾。
- 建立專用 Python 環境，不污染全域 Python。
- 安裝 Launcher 與翻譯 server 需要的依賴。
- 註冊 Chrome Native Host。
- 設定開機後自動啟動 Launcher。
- 檢查 `127.0.0.1:18181` 是否正常回應。

固定安裝位置：

```text
%LOCALAPPDATA%\TranslateGemma
```

如果 Windows 顯示找不到啟動橋接器、`TypeError: Failed to fetch`，通常代表第一步本機程式沒有成功裝好，或 Chrome 載入的是舊版 extension。

#### macOS

macOS 版會以 `TranslateGemmaInstaller-v版本號.command` 作為短期主流程。

1. 到 GitHub Release 下載 `TranslateGemmaInstaller-v版本號.command`。
2. 如果 macOS 提醒安全性，請用右鍵點檔案，選「打開」。
3. 依畫面提示完成安裝。
4. 安裝器會自動處理本機程式、依賴、Native Host、LaunchAgent。
5. 看到安裝完成後，再去安裝 Chrome 擴充功能。

如果沒有合適的 Python，安裝器應該清楚提示使用者安裝 Python 3.12，之後再繼續安裝。TranslateGemma 的依賴會放在自己的資料夾裡，不需要使用者手動開啟 venv。

固定安裝位置：

```text
~/Library/Application Support/TranslateGemma
```

### 第 2 步：再安裝 Chrome 擴充功能

目前尚未上架 Chrome Web Store，所以需要用開發者模式載入一次。

1. 開啟 Chrome。
2. 在網址列輸入 `chrome://extensions/`。
3. 打開右上角「開發者模式」。
4. 如果已經有舊版 TranslateGemma，先移除。
5. 點「載入未封裝項目」。
6. 選擇本機安裝器放好的 `extension` 資料夾。

Windows 請選：

```text
%LOCALAPPDATA%\TranslateGemma\extension
```

macOS 請選：

```text
~/Library/Application Support/TranslateGemma/extension
```

### 第 3 步：按啟動

1. 點 Chrome 右上角的 TranslateGemma 圖示。
2. 按「啟動」。
3. 第一次會下載模型，檔案較大，請等待。
4. 下載完成後，本機翻譯 server 會開始工作。

### 平常怎麼用

- Launcher 是小型背景程式，平常安靜待命。
- 按「啟動」才會載入模型和翻譯 server。
- 按「暫停」只會關掉翻譯 server，Launcher 仍在背景待命。
- 重新開機後，Launcher 會自動啟動；你仍可在擴充功能裡決定是否啟動模型。

---

## 📖 使用方式

### YouTube 翻譯

只要進入任何 YouTube 影片頁面或首頁，擴充功能會自動運作：

- **字幕**：開啟 CC 字幕後，翻譯會自動顯示在下方。
- **標題/留言**：檢測到非目標語言時，會自動在下方插入翻譯。

### 文章翻譯

進入新聞網站 (BBC, NYT 等) 後會自動翻譯：

- **標題**：頁面主標題自動翻譯
- **段落**：內文段落自動翻譯，顯示在原文下方

### Wikipedia 翻譯

進入任何語言版本的 Wikipedia 頁面後會自動翻譯：

- **頁面標題**：自動翻譯
- **章節標題**：自動翻譯
- **內文段落**：自動翻譯

### GitHub 翻譯

進入 GitHub 頁面後自動翻譯：

- **README**：自動翻譯 Markdown 內容
- **Issue / PR**：自動翻譯標題與內文

### Reddit 翻譯

進入 Reddit 後自動翻譯：

- **列表頁**：帖子標題自動翻譯
- **帖子內頁**：標題、內文、留言全部翻譯
- 支援 SPA 路由切換偵測與動態載入內容

### 選取翻譯

在任何網站上選取文字後自動彈出翻譯氣泡：

- 選取超過 5 個字元即觸發
- 自動跳過中文選取
- 點擊外部或按 ESC 關閉氣泡

### 設定調整

1. 點擊瀏覽器右上角的擴充功能圖示。
2. **YouTube 翻譯**：開啟或關閉 YouTube 翻譯。
3. **文章翻譯**：開啟或關閉新聞網站翻譯。
4. **Wikipedia**：開啟或關閉 Wikipedia 翻譯。
5. **GitHub**：開啟或關閉 GitHub 翻譯。
6. **Reddit**：開啟或關閉 Reddit 翻譯。
7. **選取翻譯**：開啟或關閉選取文字翻譯。
8. **伺服器開關**：啟動或暫停翻譯伺服器。
9. **目標語言**：選擇翻譯目標語言 (預設繁體中文)。

---

## 📁 專案結構

```
TranslateGemma/
├── server/                 # 翻譯 API 伺服器 (FastAPI + GGUF)
│   ├── main.py            
│   └── models/            
│
├── launcher/              # 背景啟動 + 托盤控制
│   ├── launcher.py
│   └── install_*          
│
└── extension/             # Chrome 擴充功能
    ├── manifest.json      
    ├── content/           # youtube.js, article.js, wikipedia.js,
    │                      # github.js, reddit.js, selection-translate.js,
    │                      # dark-mode-detect.js
    ├── popup/             # 設定介面
    └── background/        # Service Worker (輕量化)
```

---

## ❓ 常見問題

<details>
<summary><strong>Q: 伺服器狀態顯示「離線」？</strong></summary>

請先確認第一段「本機程式」是否安裝完成。安裝完成後，Launcher 會在背景待命；你仍需要在 Chrome 擴充功能裡按「啟動」才會載入模型與翻譯 server。
</details>

<details>
<summary><strong>Q: Launcher 會一直常駐嗎？關掉擴充就會關嗎？</strong></summary>

Launcher 會在背景常駐，但它只在你「啟動翻譯伺服器」時才會真正吃資源。  
擴充介面上的「暫停」只會停止伺服器，**Launcher 仍在背景待命**。  
重新開機後會自動再啟動（除非你手動移除自動啟動設定）。
</details>
<details>
<summary><strong>Q: 支援哪些網站？</strong></summary>

目前支援：YouTube、一般新聞網站（BBC, NYT 等）、Wikipedia、GitHub、Reddit。此外，選取翻譯功能可在任何網站上使用。
</details>

<details>
<summary><strong>Q: Windows 可以直接執行 .exe 嗎？</strong></summary>

未簽章 `.exe` 可能被 Windows Smart App Control 擋住。在沒有正式簽章前，Windows 的主流程會改成 PowerShell 貼上一段安裝指令，由安裝器自己建立專用環境與安裝本機程式。
</details>

---

## 🔧 技術細節

- **翻譯模型**: [TranslateGemma-4b-it](https://huggingface.co/google/translate-gemma-4b-it) (Q6_K GGUF)
- **推論引擎**: [llama-cpp-python](https://github.com/abetlen/llama-cpp-python)
- **前端技術**: Vanilla JS (無框架), IntersectionObserver (效能優化)

---

## 📜 法律與使用條款

本專案使用 Google Gemma 模型，請閱讀並遵守下列文件：

- `GEMMA_TERMS_OF_USE.md`
- `GEMMA_PROHIBITED_USE_POLICY.md`
- `NOTICE`
- `TERMS_OF_USE.md`

<p align="center">
  Made for pure YouTube experience.
</p>
