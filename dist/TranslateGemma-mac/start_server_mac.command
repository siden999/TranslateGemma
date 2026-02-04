#!/bin/bash
cd "$(dirname "$0")/server"

echo "🚀 正在啟動 TranslateGemma 翻譯伺服器..."
echo "請勿關閉此視窗"
echo ""

PYTHON_BIN=""
if command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
    PYTHON_BIN="python"
else
    echo "找不到 Python 3，請先安裝 Python 3.10+"
    read -p "按 Enter鍵 關閉視窗..."
    exit 1
fi

if [ ! -d ".venv" ]; then
    echo "🔧 首次啟動：建立虛擬環境並安裝依賴..."
    "$PYTHON_BIN" -m venv .venv
    source .venv/bin/activate
    python -m pip install --upgrade pip
    python -m pip install -r requirements.txt
else
    source .venv/bin/activate
fi

get_py_ver() {
    python - <<'PY'
import sys
print(f"{sys.version_info.major}.{sys.version_info.minor}")
PY
}

check_metal() {
    PY_VER="$(get_py_ver)"
    SITE_PACKAGES=".venv/lib/python${PY_VER}/site-packages"
    LLAMA_LIB="${SITE_PACKAGES}/llama_cpp/lib"
    if [ -f "${LLAMA_LIB}/libggml-metal.dylib" ]; then
        return 0
    fi
    return 1
}

if check_metal; then
    echo "✅ 已啟用 Metal GPU 加速"
else
    echo "⚠️ 未偵測到 Metal 支援，嘗試啟用 GPU 加速..."
    CMAKE_ARGS="-DGGML_METAL=on" python -m pip install --force-reinstall --no-binary llama-cpp-python llama-cpp-python
    if check_metal; then
        echo "✅ Metal GPU 加速已啟用"
    else
        echo "⚠️ Metal 編譯失敗，改用 CPU 版本"
    fi
fi

python main.py

echo ""
echo "伺服器已停止"
read -p "按 Enter鍵 關閉視窗..."
