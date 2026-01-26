@echo off
title TranslateGemma Server
echo 正在啟動 TranslateGemma 翻譯伺服器...
echo.

cd /d "%~dp0"
cd server

if exist ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
) else (
    echo 找不到虛擬環境，嘗試直接使用 python...
)

python main.py

echo.
echo 伺服器已停止。
pause
