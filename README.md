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
| Python | 3.10+ | 3.11+ |
| 記憶體 | 8GB RAM | 16GB+ RAM |
| 瀏覽器 | Chrome | Chrome |

---

## 🚀 快速開始

建議使用 Launcher 無痛安裝：背景啟動伺服器、托盤控制、擴充介面可一鍵啟動/暫停。

### 1️⃣ 安裝 Launcher（推薦無痛）

- **macOS**：執行 `launcher/install_mac.command`
- **Windows**：以 PowerShell 執行 `launcher/install_win.ps1`（若被阻擋可先執行 `Set-ExecutionPolicy -Scope Process Bypass`）

> 注意：首次啟動會自動建立環境並下載模型（需要 Python 3.10+ 與網路）。完成後會自動加入「開機自動啟動」，Launcher 會在背景常駐，但**伺服器預設不啟動**。
> 背景模式不會出現在前台視窗；需要托盤請手動用 `--tray` 啟動。

**一鍵移除**

- **macOS**：執行 `launcher/uninstall_mac.command`
- **Windows**：以 PowerShell 執行 `launcher/uninstall_win.ps1`

**運作方式（一般人版）**

- Launcher 是「小型背景程式」，平常安靜在背景待命。
- 擴充功能的「啟動/暫停」只會控制**翻譯伺服器**，不會關掉 Launcher 本體。
- 預設情況下伺服器是關閉的，要在擴充介面按「啟動」才會載入模型。
- 若你在擴充裡按「暫停」，只是停止翻譯伺服器；Launcher 仍在背景待命。
- 重新開機後，Launcher 會自動再啟動（除非你手動移除自動啟動設定）。

#### 方式 B：手動啟動（開發/除錯用）

若不使用 Launcher，可手動啟動伺服器：

#### macOS 使用者

1. 開啟終端機 (Terminal)。
2. 進入專案目錄：

   ```bash
   cd TranslateGemma/server
   ```

3. 建議使用 `uv` 或 `venv` 建立環境：

   ```bash
   uv venv
   source .venv/bin/activate
   ```

4. 安裝依賴 (啟用 Metal GPU 加速)：

   ```bash
   CMAKE_ARGS="-DGGML_METAL=on" uv pip install -r requirements.txt
   ```

5. 啟動伺服器：

   ```bash
   python main.py
   ```

   > 首次啟動會自動下載約 3.3GB 的模型檔案，請耐心等待。

#### Windows 使用者

1. 開啟 PowerShell。
2. 進入專案目錄。
3. 建立並啟用環境：

   ```powershell
   uv venv
   .venv\Scripts\activate
   ```

4. 安裝依賴：
   - **NVIDIA 顯卡 (CUDA 加速)**：

     ```powershell
     $env:CMAKE_ARGS="-DGGML_CUDA=on"
     uv pip install -r requirements.txt
     ```

   - **僅使用 CPU**：

     ```powershell
     uv pip install -r requirements.txt
     ```

5. 啟動伺服器：

   ```bash
   python main.py
   ```

### 2️⃣ 安裝 Chrome 擴充功能

> Chrome Web Store 上架後，可直接安裝。  
> 目前可用開發者模式安裝：

1. 開啟 Chrome 瀏覽器，在網址列輸入 `chrome://extensions/`。
2. 開啟右上角的「**開發者模式 (Developer mode)**」。
3. 點擊左上角的「**載入未封裝項目 (Load unpacked)**」。
4. 選擇專案資料夾中的 `extension` 資料夾。
5. 完成！現在前往 YouTube 即可體驗。

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

請確認 Launcher 是否已啟動（托盤有圖示），或使用手動模式啟動 `server/main.py`。伺服器必須在背景運行才能翻譯。
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

目前版本為開發者版本，需安裝 Python。未來計畫提供打包好的執行檔 (Portable Version)。
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
