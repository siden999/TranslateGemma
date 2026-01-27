# TranslateGemma 沉浸式翻譯 (YouTube 專用版)

<p align="center">
  <strong>最純淨的 YouTube 本地離線翻譯工具</strong><br>
  使用 Google TranslateGemma-4b-it 模型，完全在你的電腦上運行
</p>

<p align="center">
  <a href="#功能特色">功能</a> •
  <a href="#快速開始">安裝</a> •
  <a href="#使用方式">使用</a> •
  <a href="#常見問題">FAQ</a> •
  <a href="#授權">授權</a>
</p>

---

## ✨ 功能特色

專注於解決 YouTube 語言障礙，**絕不干擾**其他網頁瀏覽體驗。

| 功能 | 說明 |
|------|------|
| 🎬 **雙語字幕** | 高效能掛載並翻譯影片字幕，支援防抖與快取 |
| 🏷️ **標題翻譯** | 自動翻譯影片標題，一眼看懂影片主題 |
| 📝 **說明翻譯** | 影片說明欄摘要翻譯 |
| 💬 **留言翻譯** | 滑到哪翻到哪 (Lazy Load)，輕鬆看懂國外討論 |
| 🎞️ **推薦翻譯** | 右側欄推薦影片標題自動翻譯 |
| 🔒 **完全離線** | 資料不離開你的電腦，保護隱私 |
| ⚡ **零干擾** | 僅在 YouTube 運作，瀏覽其他網站時保持靜默與最高效能 |

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

### 設定調整

1. 點擊瀏覽器右上角的擴充功能圖示。
2. **YouTube 翻譯開關**：可一鍵開啟或關閉所有 YouTube 翻譯功能。
3. **伺服器開關**：可一鍵啟動或暫停翻譯伺服器（需 Launcher 在背景執行）。
4. **目標語言**：選擇你想翻譯成的語言 (預設繁體中文)。

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
    ├── content/           # 僅包含 youtube.js 與樣式
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
<summary><strong>Q: 為什麼其他網站不能翻譯了？</strong></summary>

這是為了確保瀏覽體驗的「極簡化」策略。我們移除了通用的網頁翻譯與右鍵選單，專注將 YouTube 體驗做到最好。
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

## 📜 授權

本專案採用 [MIT License](LICENSE) 授權。

<p align="center">
  Made for pure YouTube experience.
</p>
