# TranslateGemma 沉浸式翻譯

類似「沉浸式翻譯」的瀏覽器擴充功能，使用 Google TranslateGemma-4b-it 模型提供本地離線翻譯。

## 功能特色

- 🌐 **網頁雙語翻譯**：原文-譯文並排顯示
- 🎬 **YouTube 雙語字幕**：即時翻譯影片字幕
- ⌨️ **快捷鍵切換**：Alt+A 快速切換
- 🖱️ **滑鼠懸停翻譯**：滑鼠停留即顯示翻譯
- 💻 **跨平台**：支援 macOS (Metal) / Windows (CUDA/CPU)
- 🔒 **完全離線**：資料不離開你的電腦

## 系統需求

- Python 3.10+
- Chrome 瀏覽器
- 約 4GB 可用磁碟空間（模型檔案）
- 建議 8GB+ RAM

## 快速開始

### 1. 安裝伺服器

```bash
# macOS
cd server
uv venv
source .venv/bin/activate
CMAKE_ARGS="-DGGML_METAL=on" uv pip install -r requirements.txt

# Windows (CUDA)
cd server
uv venv
.venv\Scripts\activate
set CMAKE_ARGS=-DGGML_CUDA=on
uv pip install -r requirements.txt
```

### 2. 啟動伺服器

```bash
python main.py
```

首次啟動會自動下載 TranslateGemma 模型（約 3.3GB）。

### 3. 安裝擴充功能

1. 開啟 Chrome，前往 `chrome://extensions/`
2. 啟用「開發者模式」
3. 點擊「載入未封裝項目」，選擇 `extension` 資料夾

## 專案結構

```
TranslateGemma/
├── server/          # 翻譯 API 伺服器
└── extension/       # Chrome 擴充功能
```

## 授權

MIT License
