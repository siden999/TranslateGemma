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

# 刪除 Launcher 目錄
cd /tmp
rm -rf "$LAUNCHER_DIR"

echo "✅ Launcher 已移除"
read -p "按 Enter鍵 關閉視窗..."
