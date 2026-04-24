#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
    VERSION="$(python3 -c "import json; print(json.load(open('extension/manifest.json'))['version'])")"
fi

MAC_DIR="$DIST_DIR/TranslateGemma-mac"
WIN_DIR="$DIST_DIR/TranslateGemma-win"

copy_common() {
    local target_dir="$1"
    mkdir -p "$target_dir"

    rsync -a --delete \
        --exclude '.DS_Store' \
        --exclude '.venv' \
        --exclude '__pycache__' \
        --exclude '*.pyc' \
        --exclude '*.log' \
        --exclude 'logs' \
        --exclude 'cache' \
        --exclude 'models/.cache' \
        --exclude 'models/*.gguf' \
        "$ROOT_DIR/server/" "$target_dir/server/"

    rsync -a --delete "$ROOT_DIR/extension/" "$target_dir/extension/"
    rsync -a --delete \
        --exclude '.venv' \
        --exclude '__pycache__' \
        --exclude '*.pyc' \
        --exclude '*.log' \
        "$ROOT_DIR/launcher/" "$target_dir/launcher/"

    cp "$ROOT_DIR/README.md" "$target_dir/README.md"
    cp "$ROOT_DIR/INSTALL.md" "$target_dir/INSTALL.md"
    cp "$ROOT_DIR/NOTICE" "$target_dir/NOTICE"
    cp "$ROOT_DIR/TERMS_OF_USE.md" "$target_dir/TERMS_OF_USE.md"
    cp "$ROOT_DIR/GEMMA_TERMS_OF_USE.md" "$target_dir/GEMMA_TERMS_OF_USE.md"
    cp "$ROOT_DIR/GEMMA_PROHIBITED_USE_POLICY.md" "$target_dir/GEMMA_PROHIBITED_USE_POLICY.md"
}

rm -rf "$MAC_DIR" "$WIN_DIR"
rm -f "$DIST_DIR"/TranslateGemma-mac-v*.zip
rm -f "$DIST_DIR"/TranslateGemma-win-v*.zip
rm -f "$DIST_DIR"/TranslateGemmaSetup-v*.exe
rm -f "$DIST_DIR"/TranslateGemmaSetup-v*.cmd
rm -f "$DIST_DIR"/TranslateGemmaSetup-v*.ps1
rm -f "$DIST_DIR"/TranslateGemmaInstaller-v*.command
mkdir -p "$DIST_DIR"

copy_common "$MAC_DIR"
cp "$ROOT_DIR/start_server_mac.command" "$MAC_DIR/start_server_mac.command"
rm -f "$MAC_DIR/launcher/install_win.ps1"
rm -f "$MAC_DIR/launcher/uninstall_win.ps1"
rm -f "$MAC_DIR/launcher/native_host.cmd"
chmod +x "$MAC_DIR/start_server_mac.command" "$MAC_DIR/launcher/install_mac.command" "$MAC_DIR/launcher/uninstall_mac.command"

copy_common "$WIN_DIR"
cp "$ROOT_DIR/start_server_win.bat" "$WIN_DIR/start_server_win.bat"
rm -f "$WIN_DIR/launcher/install_mac.command"
rm -f "$WIN_DIR/launcher/uninstall_mac.command"

(
    cd "$DIST_DIR"
    zip -qr "TranslateGemma-mac-v$VERSION.zip" "TranslateGemma-mac"
    zip -qr "TranslateGemma-win-v$VERSION.zip" "TranslateGemma-win"
)

sed "s/__TRANSLATEGEMMA_VERSION__/$VERSION/g" \
    "$ROOT_DIR/setup/macos/TranslateGemmaInstaller.command" \
    > "$DIST_DIR/TranslateGemmaInstaller-v$VERSION.command"
chmod +x "$DIST_DIR/TranslateGemmaInstaller-v$VERSION.command"

echo "Built release packages for v$VERSION in $DIST_DIR"
