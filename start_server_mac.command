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

python main.py

echo ""
echo "伺服器已停止"
read -p "按 Enter鍵 關閉視窗..."
