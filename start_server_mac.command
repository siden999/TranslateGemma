#!/bin/bash
cd "$(dirname "$0")/server"

echo "🚀 正在啟動 TranslateGemma 翻譯伺服器..."
echo "請勿關閉此視窗"
echo ""

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

PYTHON_BIN=""
for candidate in python3.12 python3.11 python3.10 python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 && python_is_supported "$candidate"; then
        PYTHON_BIN="$candidate"
        break
    fi
done

if [ -z "$PYTHON_BIN" ]; then
    echo "找不到 Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}-${MAX_PYTHON_MAJOR}.${MAX_PYTHON_MINOR}，請先安裝 Python 3.12 後再執行"
    read -p "按 Enter鍵 關閉視窗..."
    exit 1
fi

if [ ! -d ".venv" ]; then
    echo "🔧 首次啟動：建立虛擬環境並安裝依賴..."
    "$PYTHON_BIN" -m venv .venv
    source .venv/bin/activate
    python -m pip install --upgrade pip
    python -m pip install --no-cache-dir --prefer-binary --extra-index-url "$LLAMA_CPP_METAL_WHEEL_INDEX" -r requirements.txt
else
    source .venv/bin/activate
fi

if ! python_is_supported "python"; then
    echo "目前虛擬環境 Python 版本過舊，請刪除 server/.venv 後重新啟動"
    read -p "按 Enter鍵 關閉視窗..."
    exit 1
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
