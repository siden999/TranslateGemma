#!/bin/bash
set -e

INSTALL_ROOT="$HOME/Library/Application Support/TranslateGemma"
LAUNCHER_DIR="$INSTALL_ROOT/launcher"
PLIST="$HOME/Library/LaunchAgents/com.translategemma.launcher.plist"
LAUNCH_LABEL="com.translategemma.launcher"
LAUNCH_DOMAIN="gui/$(id -u)"
NATIVE_HOST_NAME="com.translategemma.launcher"

# 嘗試讓 Launcher 自行退出
curl -s -X POST http://127.0.0.1:18181/quit >/dev/null 2>&1 || true

# 移除自動啟動
launchctl bootout "$LAUNCH_DOMAIN" "$PLIST" >/dev/null 2>&1 || launchctl remove "$LAUNCH_LABEL" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1 || true
rm -f "$PLIST"
rm -f "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$NATIVE_HOST_NAME.json"
rm -f "$HOME/Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts/$NATIVE_HOST_NAME.json"
rm -f "$HOME/Library/Application Support/Chromium/NativeMessagingHosts/$NATIVE_HOST_NAME.json"

# 刪除固定安裝目錄，不碰使用者下載的原始碼資料夾
cd /tmp
rm -rf "$INSTALL_ROOT"

echo "✅ Launcher 已移除"
read -p "按 Enter鍵 關閉視窗..."
