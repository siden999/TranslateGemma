# TranslateGemma Launcher

這個小程式負責：
- 在背景啟動/停止翻譯伺服器
- 提供本機控制 API（供擴充功能啟動/暫停）
- 托盤控制（Start / Stop / Quit，**選用**）

## 安裝

### macOS
1. 執行 `install_mac.command`
2. 完成後會自動加入開機啟動

### Windows
1. 右鍵 `install_win.ps1` → **使用 PowerShell 執行**
2. 完成後會加入登入自啟

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
- Launcher（macOS）：`launcher/launcher.log`

## 移除

### macOS
執行 `uninstall_mac.command`

### Windows
右鍵 `uninstall_win.ps1` → **使用 PowerShell 執行**
