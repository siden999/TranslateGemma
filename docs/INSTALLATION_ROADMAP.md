# TranslateGemma 二段式安裝開發規劃書

本文件是 TranslateGemma 接下來的安裝策略。目標是走我們自己的本機模型路線，不把本機模型責任交給其他工具。

---

## 1. 核心結論

TranslateGemma 必須維持二段式安裝。

原因是 Chrome 擴充功能不能做這些事：

- 安裝本機模型服務。
- 建立 Python 環境。
- 安裝 `llama-cpp-python` 等依賴。
- 註冊 Native Host。
- 寫入 Windows registry。
- 建立 macOS LaunchAgent。
- 設定開機自動啟動。

所以本專案的正式使用流程固定為：

```text
第一段：安裝本機程式
第二段：安裝 Chrome 擴充功能
第三段：按啟動，首次下載模型
```

這不是臨時方案，而是 TranslateGemma 的產品架構。

---

## 2. 一般使用者要看到的說法

一般使用者只需要理解兩個盒子。

```text
盒子 1：本機程式
負責模型、背景服務、橋接器、自動啟動。

盒子 2：Chrome 擴充功能
負責按鈕、網頁翻譯、把命令送給本機程式。
```

一般使用者不應該看到這些詞作為操作步驟：

- venv
- pip
- uv
- requirements.txt
- Native Host manifest
- registry
- LaunchAgent
- server/main.py

這些都應該由安裝器處理。

---

## 3. Windows 安裝策略

### 3.1 問題

Windows 最大問題不是安裝邏輯，而是信任機制。

未簽章 `.exe` 可能被 Smart App Control 擋住。`.ps1` 也可能遇到執行政策、下載標記、編碼與權限問題。

因此在沒有正式 code signing 前，不把未簽章 `.exe` 當成一般使用者主入口。

### 3.2 短期主流程

Windows 使用者看到的流程應該是：

```text
1. 開啟 Windows Terminal 或 PowerShell
2. 貼上 TranslateGemma 提供的一段安裝指令
3. 等待安裝完成
4. 到 Chrome 載入 extension 資料夾
5. 按啟動
```

目前可用的安裝指令：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/siden999/TranslateGemma/main/setup/windows/install.ps1 | iex"
```

這段指令的內部工作：

- 檢查 Python 3.10-3.12 是否可用。
- 如果沒有合適 Python，優先嘗試安裝官方 Python 3.12，或清楚引導使用者手動安裝。
- 下載最新 GitHub Release 的 Windows 安裝包。
- 呼叫 release 包內的內部安裝器。
- 安裝 Launcher、server、依賴與 Native Host。
- 設定開機自動啟動。
- 確認 `http://127.0.0.1:18181/status` 有回應。

### 3.3 Windows 完成標準

Windows 安裝完成時必須滿足：

- `%LOCALAPPDATA%\TranslateGemma\extension\manifest.json` 存在。
- `%LOCALAPPDATA%\TranslateGemma\launcher\launcher.log` 可寫入。
- Native Host registry 已指向正確 manifest。
- 開機自動啟動設定已建立。
- `127.0.0.1:18181/status` 回傳成功。
- Chrome 擴充錯誤訊息不再叫使用者執行 `install_win.ps1`。

---

## 4. macOS 安裝策略

### 4.1 問題

macOS 也有安全性檢查，但相對 Windows 未簽章 exe 問題小。使用者通常可以對單一 `.command` 檔案用右鍵「打開」放行。

macOS 主要風險是乾淨電腦可能沒有合適的 Python。

### 4.2 短期主流程

macOS 使用者看到的流程應該是：

```text
1. 下載 TranslateGemmaInstaller-v版本號.command
2. 右鍵打開
3. 依畫面提示完成本機安裝
4. 到 Chrome 載入 extension 資料夾
5. 按啟動
```

安裝器的內部工作：

- 檢查 Python 3.10-3.12，建議 Python 3.12。
- 如果沒有合適 Python，清楚提示如何安裝 Python 3.12。
- 建立 `~/Library/Application Support/TranslateGemma`。
- 建立 launcher/server 專用 Python 環境。
- 安裝依賴。
- 建立 Chrome Native Host manifest。
- 建立 LaunchAgent。
- 啟動 Launcher。
- 確認 `http://127.0.0.1:18181/status` 有回應。

### 4.3 macOS 完成標準

macOS 安裝完成時必須滿足：

- `~/Library/Application Support/TranslateGemma/extension/manifest.json` 存在。
- `~/Library/Application Support/TranslateGemma/launcher/launcher.log` 可寫入。
- Chrome Native Host manifest 存在。
- LaunchAgent plist 存在並可啟動。
- `127.0.0.1:18181/status` 回傳成功。

---

## 5. Chrome 擴充安裝策略

短期仍使用開發者模式載入：

```text
chrome://extensions
開發者模式
載入未封裝項目
選擇固定 extension 資料夾
```

固定資料夾：

```text
Windows: %LOCALAPPDATA%\TranslateGemma\extension
macOS: ~/Library/Application Support/TranslateGemma/extension
```

長期目標是上架 Chrome Web Store。上架後，第二段安裝會變成：

```text
到 Chrome Web Store
點安裝
```

但即使上架 Chrome Web Store，第一段本機程式仍然需要存在。

---

## 6. 錯誤訊息原則

錯誤訊息要直接告訴使用者下一步，不要丟工程師詞彙。

正確方向：

```text
本機程式沒有成功啟動。請重新執行本機安裝流程。
```

不要再出現這種一般使用者看不懂的要求：

```text
請重新執行 install_win.ps1
請手動啟用 venv
請手動啟動 server/main.py
```

---

## 7. Release 策略

GitHub Release 應該明確寫出：

- 這是二段式安裝。
- 先裝本機程式，再裝 Chrome 擴充。
- Windows 沒簽章前，不承諾未簽章 exe 一定可雙擊安裝。
- macOS 短期主流程是 `.command` installer。
- source code zip 不是一般使用者安裝包。

Release assets 可以保留壓縮包與安裝器，但頁面文字必須讓使用者先看懂流程。

---

## 8. 接下來開發順序

1. 建立 Windows Python installer package。
2. 讓 Windows 使用者只需要貼上一段安裝指令。
3. 改善 macOS installer 的 Python 缺失提示。
4. 確認兩個平台安裝完成後都能回報 `18181` 狀態。
5. 更新擴充功能內的錯誤提示。
6. 整理解除安裝流程。
7. 準備 Chrome Web Store 上架。

---

## 9. 不做的事

目前不把其他本機模型管理工具當主路線。

目前不要求一般使用者手動操作 venv、pip、uv、server。

目前不把未簽章 Windows exe 當作穩定的一鍵安裝承諾。

---

## 10. 最終目標

Windows 使用者看到：

```text
貼上一段安裝指令
等待完成
載入 Chrome 擴充
按啟動
```

macOS 使用者看到：

```text
下載 command 安裝器
右鍵打開
等待完成
載入 Chrome 擴充
按啟動
```

這就是 TranslateGemma 接下來要推進的安裝方向。
