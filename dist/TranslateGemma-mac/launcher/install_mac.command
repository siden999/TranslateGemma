#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LAUNCHER_DIR="$ROOT_DIR/launcher"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST="$PLIST_DIR/com.translategemma.launcher.plist"
LAUNCH_LABEL="com.translategemma.launcher"
LAUNCH_DOMAIN="gui/$(id -u)"
NATIVE_HOST_NAME="com.translategemma.launcher"
EXTENSION_ORIGIN="chrome-extension://glkghkdgkpaflgolppmohgggighiphnn/"
NATIVE_HOST_SCRIPT="$LAUNCHER_DIR/native_host.py"

PY_BIN=""
if command -v python3 >/dev/null 2>&1; then
    PY_BIN="python3"
elif command -v python >/dev/null 2>&1; then
    PY_BIN="python"
else
    echo "找不到 Python 3，請先安裝 Python 3.10+"
    exit 1
fi

check_launcher_ready() {
    curl -fsS http://127.0.0.1:18181/status >/dev/null 2>&1
}

install_native_host_manifest() {
    local host_dir="$1"
    mkdir -p "$host_dir"
    cat > "$host_dir/$NATIVE_HOST_NAME.json" <<JSON
{
  "name": "$NATIVE_HOST_NAME",
  "description": "TranslateGemma Launcher Bridge",
  "path": "$NATIVE_HOST_SCRIPT",
  "type": "stdio",
  "allowed_origins": ["$EXTENSION_ORIGIN"]
}
JSON
}

cd "$LAUNCHER_DIR"
mkdir -p "$PLIST_DIR"

if [ ! -d ".venv" ]; then
    echo "🔧 建立 Launcher 虛擬環境..."
    "$PY_BIN" -m venv .venv
fi

source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
chmod +x "$NATIVE_HOST_SCRIPT"

install_native_host_manifest "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
install_native_host_manifest "$HOME/Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts"
install_native_host_manifest "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LAUNCH_LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$LAUNCHER_DIR/.venv/bin/python</string>
        <string>$LAUNCHER_DIR/launcher.py</string>
        <string>--no-tray</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LAUNCHER_DIR/launcher.log</string>
    <key>StandardErrorPath</key>
    <string>$LAUNCHER_DIR/launcher.log</string>
</dict>
</plist>
PLIST

launchctl bootout "$LAUNCH_DOMAIN" "$PLIST" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "$LAUNCH_DOMAIN" "$PLIST" >/dev/null 2>&1 || launchctl load "$PLIST"
launchctl enable "$LAUNCH_DOMAIN/$LAUNCH_LABEL" >/dev/null 2>&1 || true
launchctl kickstart -k "$LAUNCH_DOMAIN/$LAUNCH_LABEL" >/dev/null 2>&1 || true

if check_launcher_ready; then
    echo "✅ Launcher 已啟動，可直接回 Chrome 按「啟動」下載模型"
else
    echo "⚠️ launchctl 已安裝 LaunchAgent，但 18181 尚未回應，改用背景模式直接啟動 Launcher..."
    nohup "$LAUNCHER_DIR/.venv/bin/python" "$LAUNCHER_DIR/launcher.py" --no-tray >>"$LAUNCHER_DIR/launcher.log" 2>&1 &
    sleep 2

    if check_launcher_ready; then
        echo "✅ Launcher 已透過背景模式啟動"
    else
        echo "⚠️ Launcher 已安裝，但目前尚未回應；請查看 $LAUNCHER_DIR/launcher.log"
    fi
fi

echo "✅ Launcher 已安裝並設定為開機自動啟動"
echo "📝 Launcher 記錄檔：$LAUNCHER_DIR/launcher.log"
echo "🔌 Native Host：$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$NATIVE_HOST_NAME.json"
