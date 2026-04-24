# TranslateGemma Launcher

這個小程式負責：
- 在背景啟動/停止翻譯伺服器
- 提供本機控制 API（供擴充功能啟動/暫停）
- 托盤控制（Start / Stop / Quit，**選用**）

## 安裝

### macOS
1. 執行 `install_mac.command`
2. 完成後會自動安裝到 `~/Library/Application Support/TranslateGemma`
3. 完成後會自動加入開機啟動，並註冊 Chrome Native Host
4. 若 Chrome 顯示「啟動橋接器未安裝」，請重新執行 `install_mac.command`，再到 `chrome://extensions/` 移除舊版 TranslateGemma 並載入 `~/Library/Application Support/TranslateGemma/extension`

### Windows
1. 右鍵 `install_win.ps1` → **使用 PowerShell 執行**
2. 完成後會自動安裝到 `%LOCALAPPDATA%\TranslateGemma`
3. 完成後會加入登入自啟，並註冊 Chrome Native Host
4. 若 Chrome 顯示「啟動橋接器未安裝」，請重新執行 `install_win.ps1`，再到 `chrome://extensions/` 移除舊版 TranslateGemma 並載入 `%LOCALAPPDATA%\TranslateGemma\extension`
5. 若 Chrome 顯示 `TypeError: Failed to fetch`，代表 Launcher 控制服務未在 `127.0.0.1:18181` 回應；請查看 `%LOCALAPPDATA%\TranslateGemma\launcher\launcher.log`

## 啟動

如果已安裝為開機自啟，開機後會自動執行。

手動執行（預設**無托盤、背景模式**）：
```
python launcher.py
```

啟用托盤：
```
python launcher.py --tray
```

## 控制 API

- `GET http://127.0.0.1:18181/status`
- `POST http://127.0.0.1:18181/start`
- `POST http://127.0.0.1:18181/stop`
- `POST http://127.0.0.1:18181/quit`

## 記錄檔

- 翻譯伺服器：`server/logs/server.log`
- Launcher：`launcher/launcher.log`

## 移除

### macOS
執行 `uninstall_mac.command`

### Windows
右鍵 `uninstall_win.ps1` → **使用 PowerShell 執行**
