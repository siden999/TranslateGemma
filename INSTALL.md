# TranslateGemma 安裝說明

這份說明是給第一次使用的人看的。請先記住一件事：

```text
TranslateGemma 需要先裝本機程式，再裝 Chrome 擴充功能。
```

原因很簡單：Chrome 擴充功能不能自己安裝模型、背景服務、Python 依賴、Native Host 和開機自動啟動。這些事情一定要由本機安裝流程完成。

---

## 你需要準備的東西

- Windows 或 macOS。
- Chrome 瀏覽器。
- 可以上網下載檔案。
- Python 3.10-3.12，建議 Python 3.12。

一般使用者不需要知道 venv、pip、server 是什麼。安裝器會自己處理。

---

## 第 1 步：安裝本機程式

本機程式負責做 Chrome 擴充做不到的事情：

- 安裝 Launcher。
- 安裝翻譯 server 需要的依賴。
- 註冊 Native Host，讓 Chrome 可以叫醒本機程式。
- 設定開機自動啟動。
- 檢查 `127.0.0.1:18181` 控制服務是否正常。

### Windows

Windows 沒有簽章時，未簽章 `.exe` 可能被 Smart App Control 擋住。因此 Windows 的正式短期方向是：

```text
開 PowerShell → 貼上 TranslateGemma 提供的安裝指令 → 等它完成
```

使用者不需要手動開 venv，也不需要自己安裝 Python 套件。安裝指令會把 TranslateGemma 裝到固定位置：

```text
%LOCALAPPDATA%\TranslateGemma
```

安裝完成後，你會得到 Chrome 擴充資料夾：

```text
%LOCALAPPDATA%\TranslateGemma\extension
```

如果看到這些錯誤，通常代表本機程式沒有裝好，或 Chrome 載入了舊版 extension：

- 找不到本機啟動橋接器
- 啟動橋接器未安裝
- `TypeError: Failed to fetch`
- 控制服務健康檢查失敗

處理方式是重新跑本機安裝流程，然後到 `chrome://extensions/` 移除舊版 TranslateGemma，再重新載入固定位置的 `extension` 資料夾。

### macOS

macOS 的短期主流程是使用 GitHub Release 裡的：

```text
TranslateGemmaInstaller-v版本號.command
```

操作方式：

1. 下載 `TranslateGemmaInstaller-v版本號.command`。
2. 如果 macOS 跳出安全性提醒，請用右鍵點檔案，選「打開」。
3. 依畫面提示完成安裝。
4. 如果提示缺 Python 3.12，請依提示安裝 Python 後再繼續。

安裝器會把 TranslateGemma 放到固定位置：

```text
~/Library/Application Support/TranslateGemma
```

安裝完成後，你會得到 Chrome 擴充資料夾：

```text
~/Library/Application Support/TranslateGemma/extension
```

---

## 第 2 步：安裝 Chrome 擴充功能

目前尚未上架 Chrome Web Store，所以需要用開發者模式載入一次。

1. 打開 Chrome。
2. 在網址列輸入 `chrome://extensions/`。
3. 打開右上角「開發者模式」。
4. 如果已經有舊版 TranslateGemma，先移除。
5. 按「載入未封裝項目」。
6. 選擇本機安裝器建立的 `extension` 資料夾。

Windows 選這個：

```text
%LOCALAPPDATA%\TranslateGemma\extension
```

macOS 選這個：

```text
~/Library/Application Support/TranslateGemma/extension
```

---

## 第 3 步：開始使用

1. 打開 YouTube 或其他支援網站。
2. 點 Chrome 右上角的 TranslateGemma 圖示。
3. 按「啟動」。
4. 第一次會下載模型，請等待。
5. 下載完成後就可以開始翻譯。

---

## 常見問題

**Q1：為什麼不能只裝 Chrome 擴充？**

因為模型和翻譯 server 要跑在你的電腦上。Chrome 擴充功能沒有權限自己安裝這些東西。

**Q2：使用者需要開 venv 嗎？**

不需要。venv 是安裝器內部用來隔離依賴的技術，使用者不需要看到，也不需要操作。

**Q3：Windows 為什麼不用未簽章 exe 當主流程？**

因為 Windows Smart App Control 可能會直接封鎖未知 `.exe`。在沒有正式簽章前，PowerShell 貼上安裝指令會比未簽章 exe 更可控。

**Q4：macOS 會不會也被擋？**

macOS 也可能出現安全性提醒，但通常可以針對單一檔案用右鍵「打開」放行。整體安裝阻力比 Windows 未簽章 exe 小。

**Q5：重開機後還要再按啟動嗎？**

Launcher 會自動在背景啟動，但翻譯 server 預設不載入模型。你想使用翻譯時，再到擴充功能按「啟動」。
