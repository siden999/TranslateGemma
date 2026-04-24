#!/usr/bin/env bash
set -euo pipefail

RELEASE_VERSION="1.1.2"
REPO_OWNER="siden999"
REPO_NAME="TranslateGemma"
INSTALL_ROOT="$HOME/Library/Application Support/TranslateGemma"
EXTENSION_DIR="$INSTALL_ROOT/extension"
LAUNCHER_LOG="$INSTALL_ROOT/launcher/launcher.log"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

step() {
    printf "\n== %s ==\n" "$1"
}

resolve_release_version() {
    if [[ -n "$RELEASE_VERSION" && "$RELEASE_VERSION" != __* ]]; then
        printf "%s" "$RELEASE_VERSION"
        return
    fi

    for manifest in "$SCRIPT_DIR/../../extension/manifest.json" "$PWD/extension/manifest.json"; do
        if [[ -f "$manifest" ]]; then
            python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$manifest"
            return
        fi
    done

    echo "找不到版本資訊；請使用 GitHub Release 內的 TranslateGemmaInstaller-v*.command" >&2
    exit 1
}

find_local_zip() {
    local version="$1"
    local candidate
    for dir in "$SCRIPT_DIR" "$SCRIPT_DIR/dist" "$SCRIPT_DIR/.." "$SCRIPT_DIR/../dist" "$PWD" "$PWD/dist"; do
        candidate="$dir/TranslateGemma-mac-v$version.zip"
        if [[ -f "$candidate" ]]; then
            printf "%s" "$candidate"
            return
        fi
    done
}

download_zip() {
    local version="$1"
    local destination="$2"
    local urls=(
        "https://github.com/$REPO_OWNER/$REPO_NAME/releases/download/v$version/TranslateGemma-mac-v$version.zip"
        "https://github.com/$REPO_OWNER/$REPO_NAME/raw/refs/tags/v$version/dist/TranslateGemma-mac-v$version.zip"
    )

    for url in "${urls[@]}"; do
        echo "下載：$url"
        if curl -fL "$url" -o "$destination"; then
            return
        fi
        echo "下載失敗，改試下一個來源" >&2
    done

    echo "無法下載 TranslateGemma macOS 安裝包。請確認網路連線，或從 GitHub Release 同時下載 TranslateGemma-mac-v$version.zip。" >&2
    exit 1
}

wait_launcher_ready() {
    local timeout_seconds="${1:-45}"
    local attempts=$((timeout_seconds * 2))
    local i

    for ((i = 0; i < attempts; i++)); do
        if curl -fsS "http://127.0.0.1:18181/status" >/dev/null 2>&1; then
            return 0
        fi
        sleep 0.5
    done
    return 1
}

show_launcher_log_tail() {
    if [[ -f "$LAUNCHER_LOG" ]]; then
        echo
        echo "Launcher 最近記錄："
        tail -n 60 "$LAUNCHER_LOG"
    else
        echo "尚未建立 Launcher log：$LAUNCHER_LOG" >&2
    fi
}

VERSION="$(resolve_release_version)"
ASSET_NAME="TranslateGemma-mac-v$VERSION.zip"
WORK_ROOT="${TMPDIR:-/tmp}/TranslateGemmaInstaller-$VERSION"
ZIP_PATH="$WORK_ROOT/$ASSET_NAME"
EXTRACT_DIR="$WORK_ROOT/extract"

echo "TranslateGemma macOS 安裝器 v$VERSION"
echo "這個安裝器會自動安裝本機 Launcher、Native Host、server 依賴並啟動控制服務。"

step "準備安裝檔"
rm -rf "$WORK_ROOT"
mkdir -p "$EXTRACT_DIR"

LOCAL_ZIP="$(find_local_zip "$VERSION" || true)"
if [[ -n "$LOCAL_ZIP" ]]; then
    echo "使用本機安裝包：$LOCAL_ZIP"
    cp "$LOCAL_ZIP" "$ZIP_PATH"
else
    download_zip "$VERSION" "$ZIP_PATH"
fi

step "解壓縮"
unzip -q "$ZIP_PATH" -d "$EXTRACT_DIR"

INSTALL_SCRIPT="$EXTRACT_DIR/TranslateGemma-mac/launcher/install_mac.command"
if [[ ! -f "$INSTALL_SCRIPT" ]]; then
    echo "安裝包內容不完整，找不到：$INSTALL_SCRIPT" >&2
    exit 1
fi

step "安裝本機 Launcher 與橋接器"
chmod +x "$INSTALL_SCRIPT"
"$INSTALL_SCRIPT"

step "驗證控制服務"
if ! wait_launcher_ready 45; then
    show_launcher_log_tail
    echo "Launcher 控制服務未在 127.0.0.1:18181 回應。請把上方 Launcher 記錄貼給開發者。" >&2
    exit 1
fi

if [[ ! -f "$EXTENSION_DIR/manifest.json" ]]; then
    echo "Chrome 擴充資料夾不存在：$EXTENSION_DIR" >&2
    exit 1
fi

echo
echo "安裝完成。"
echo "下一步：Chrome 會開啟擴充功能頁。請移除舊版 TranslateGemma，開啟開發者模式，載入這個資料夾："
echo "$EXTENSION_DIR"
open "chrome://extensions/" >/dev/null 2>&1 || true
