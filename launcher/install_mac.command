#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LAUNCHER_DIR="$ROOT_DIR/launcher"

PY_BIN=""
if command -v python3 >/dev/null 2>&1; then
    PY_BIN="python3"
elif command -v python >/dev/null 2>&1; then
    PY_BIN="python"
else
    echo "找不到 Python 3，請先安裝 Python 3.10+"
    exit 1
fi

cd "$LAUNCHER_DIR"

if [ ! -d ".venv" ]; then
    echo "🔧 建立 Launcher 虛擬環境..."
    "$PY_BIN" -m venv .venv
fi

source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

PLIST="$HOME/Library/LaunchAgents/com.translategemma.launcher.plist"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.translategemma.launcher</string>
    <key>ProgramArguments</key>
    <array>
        <string>$LAUNCHER_DIR/.venv/bin/python</string>
        <string>$LAUNCHER_DIR/launcher.py</string>
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

launchctl unload "$PLIST" >/dev/null 2>&1 || true
launchctl load "$PLIST"

echo "✅ Launcher 已安裝並設定為開機自動啟動"
