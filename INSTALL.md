# TranslateGemma 安裝說明（一般使用者版）

這份說明是給第一次使用的人看的。請不要下載 GitHub 的 source code zip，請下載 Release 裡的安裝器。

---

## 你需要準備的東西
- Windows 或 macOS
- Chrome 瀏覽器
- 可以上網下載檔案
- Python 3.10-3.12（建議 Python 3.12）

---

## 第 1 步：安裝本機程式

本機程式會處理 Chrome 擴充做不到的事情：安裝 Launcher、server 依賴、Native Host、開機自動啟動，並驗證 `127.0.0.1:18181` 控制服務。

### Windows
1. 到 GitHub Release 下載 `TranslateGemmaSetup-v版本號.exe`
2. 雙擊執行
3. 等到畫面顯示「安裝完成」
4. 如果安裝器顯示錯誤，請把畫面上的錯誤與 `%LOCALAPPDATA%\TranslateGemma\launcher\launcher.log` 內容貼給開發者

### macOS
1. 到 GitHub Release 下載 `TranslateGemmaInstaller-v版本號.command`
2. 雙擊執行
3. 等到畫面顯示「安裝完成」
4. 如果安裝器顯示錯誤，請把畫面上的錯誤與 `~/Library/Application Support/TranslateGemma/launcher/launcher.log` 內容貼給開發者

---

## 第 2 步：安裝 Chrome 擴充

目前尚未上架 Chrome Web Store，所以仍需要開發者模式載入一次。

1. 打開 Chrome
2. 在網址列輸入 `chrome://extensions/`
3. 右上角打開「開發者模式」
4. 如果已經有舊版 TranslateGemma，先移除
5. 按「載入未封裝項目」
6. 選擇固定安裝位置裡的 `extension` 資料夾

固定安裝位置：
- Windows：`%LOCALAPPDATA%\TranslateGemma\extension`
- macOS：`~/Library/Application Support/TranslateGemma/extension`

---

## 第 3 步：開始使用
1. 打開 YouTube
2. 點右上角 TranslateGemma 圖示
3. 按「啟動」
4. 第一次會自動下載 2-3GB 模型
5. 下載完成後會自動啟動本機翻譯 server

---

## 常見問題

**Q1：為什麼還要分成本機安裝器和 Chrome 擴充？**
- 因為 Chrome 擴充不能安裝本機程式、不能寫 Windows registry、不能註冊 Native Host，也不能建立開機自動啟動。

**Q2：顯示「啟動橋接器未安裝」？**
- 代表 Chrome 找不到本機 Native Host。請重新執行本機安裝器，然後在 `chrome://extensions/` 移除舊版 TranslateGemma 並重新載入固定安裝位置的 extension。

**Q3：顯示 `TypeError: Failed to fetch`？**
- 代表 Chrome 連不到 `127.0.0.1:18181` 的 Launcher 控制服務。請重新執行本機安裝器，確認最後有顯示「安裝完成」。

**Q4：重開機後還要再按啟動嗎？**
- 需要。Launcher 會自動在背景啟動，但翻譯 server 預設關閉，要在擴充介面按一次「啟動」才會載入模型。

**Q5：看不到翻譯？**
- 重新整理 YouTube 頁面再試一次。
