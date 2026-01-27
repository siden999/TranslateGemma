#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LAUNCHER_DIR="$ROOT_DIR/launcher"
PLIST="$HOME/Library/LaunchAgents/com.translategemma.launcher.plist"

# 嘗試讓 Launcher 自行退出
curl -s -X POST http://127.0.0.1:18181/quit >/dev/null 2>&1 || true

# 移除自動啟動
launchctl unload "$PLIST" >/dev/null 2>&1 || true
rm -f "$PLIST"

# 刪除 Launcher 目錄（若是原始碼資料夾則保留）
if [ -d "$ROOT_DIR/.git" ]; then
    echo "偵測到原始碼資料夾，保留 launcher 目錄"
else
    cd /tmp
    rm -rf "$LAUNCHER_DIR"
fi

echo "✅ Launcher 已移除"
read -p "按 Enter鍵 關閉視窗..."
