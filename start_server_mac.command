#!/bin/bash
cd "$(dirname "$0")/server"

echo "🚀 正在啟動 TranslateGemma 翻譯伺服器..."
echo "請勿關閉此視窗"
echo ""

if [ -f ".venv/bin/activate" ]; then
    source .venv/bin/activate
fi

python main.py

echo ""
echo "伺服器已停止"
read -p "按 Enter鍵 關閉視窗..."
