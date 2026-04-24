#!/bin/bash
set -e

SOURCE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_ROOT="$HOME/Library/Application Support/TranslateGemma"
LAUNCHER_DIR="$INSTALL_ROOT/launcher"
SERVER_DIR="$INSTALL_ROOT/server"
EXTENSION_DIR="$INSTALL_ROOT/extension"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST="$PLIST_DIR/com.translategemma.launcher.plist"
LAUNCH_LABEL="com.translategemma.launcher"
LAUNCH_DOMAIN="gui/$(id -u)"
NATIVE_HOST_NAME="com.translategemma.launcher"
EXTENSION_ORIGIN="chrome-extension://glkghkdgkpaflgolppmohgggighiphnn/"
NATIVE_HOST_SCRIPT="$LAUNCHER_DIR/native_host.py"

MIN_PYTHON_MAJOR=3
MIN_PYTHON_MINOR=10
MAX_PYTHON_MAJOR=3
MAX_PYTHON_MINOR=12
LLAMA_CPP_METAL_WHEEL_INDEX="https://abetlen.github.io/llama-cpp-python/whl/metal"

python_is_supported() {
    "$1" - "$MIN_PYTHON_MAJOR" "$MIN_PYTHON_MINOR" "$MAX_PYTHON_MAJOR" "$MAX_PYTHON_MINOR" <<'PY'
import sys

minimum = (int(sys.argv[1]), int(sys.argv[2]))
maximum = (int(sys.argv[3]), int(sys.argv[4]))
current = sys.version_info[:2]
raise SystemExit(0 if minimum <= current <= maximum else 1)
PY
}

PY_BIN=""
for candidate in python3.12 python3.11 python3.10 python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 && python_is_supported "$candidate"; then
        PY_BIN="$candidate"
        break
    fi
done

if [ -z "$PY_BIN" ]; then
    echo "找不到 Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}-${MAX_PYTHON_MAJOR}.${MAX_PYTHON_MINOR}，請先安裝 Python 3.12 後再執行"
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

prepare_server_environment() {
    echo "🔧 建立/更新 Server 虛擬環境（首次安裝可能需要幾分鐘）..."
    cd "$SERVER_DIR"

    if [ ! -d ".venv" ]; then
        "$PY_BIN" -m venv .venv
    fi

    SERVER_PY="$SERVER_DIR/.venv/bin/python"
    if ! python_is_supported "$SERVER_PY"; then
        echo "Server 虛擬環境的 Python 版本過舊，請刪除 $SERVER_DIR/.venv 後重新執行安裝器"
        exit 1
    fi

    "$SERVER_PY" -m pip install --upgrade pip
    "$SERVER_PY" -m pip install --no-cache-dir --prefer-binary --extra-index-url "$LLAMA_CPP_METAL_WHEEL_INDEX" -r requirements.txt

    if "$SERVER_PY" - <<'PY'
from pathlib import Path
import llama_cpp

metal = Path(llama_cpp.__file__).parent / "lib" / "libggml-metal.dylib"
raise SystemExit(0 if metal.exists() else 1)
PY
    then
        echo "✅ Server 相依套件已安裝，Metal GPU 支援可用"
    else
        echo "⚠️ Server 相依套件已安裝，但未偵測到 Metal；可先使用 CPU，或改用 Python.org/Homebrew Python 重新安裝"
    fi

    "$SERVER_PY" - <<'PY'
import main
import translator

print("✅ Server Python 模組檢查完成")
PY

    cd "$LAUNCHER_DIR"
}

mkdir -p "$INSTALL_ROOT" "$SERVER_DIR" "$EXTENSION_DIR"
mkdir -p "$PLIST_DIR"

rsync -a --delete \
    --exclude '.venv' \
    --exclude 'launcher.log' \
    "$SOURCE_ROOT/launcher/" "$LAUNCHER_DIR/"

rsync -a --delete \
    --exclude '.venv' \
    --exclude 'logs' \
    --exclude 'models' \
    "$SOURCE_ROOT/server/" "$SERVER_DIR/"

mkdir -p "$SERVER_DIR/models" "$SERVER_DIR/logs"

rsync -a --delete \
    "$SOURCE_ROOT/extension/" "$EXTENSION_DIR/"

cd "$LAUNCHER_DIR"

if [ ! -d ".venv" ]; then
    echo "🔧 建立 Launcher 虛擬環境..."
    "$PY_BIN" -m venv .venv
fi

source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
chmod +x "$NATIVE_HOST_SCRIPT"

prepare_server_environment

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
echo "📁 固定安裝位置：$INSTALL_ROOT"
echo "🧩 Chrome 未封裝擴充請載入：$EXTENSION_DIR"
echo "📝 Launcher 記錄檔：$LAUNCHER_DIR/launcher.log"
echo "🔌 Native Host：$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$NATIVE_HOST_NAME.json"
