@echo off
title TranslateGemma Server
echo 正在啟動 TranslateGemma 翻譯伺服器...
echo.

cd /d "%~dp0"
cd server

set "PYTHON_BIN=python"
where python >nul 2>nul
if errorlevel 1 (
    where py >nul 2>nul
    if errorlevel 1 (
        echo 找不到 Python 3，請先安裝 Python 3.10+
        pause
        exit /b 1
    ) else (
        set "PYTHON_BIN=py -3"
    )
)

if exist ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
) else (
    echo 找不到虛擬環境，開始建立並安裝依賴...
    %PYTHON_BIN% -m venv .venv
    call .venv\Scripts\activate.bat
    python -m pip install --upgrade pip
    python -m pip install -r requirements.txt
)

python main.py

echo.
echo 伺服器已停止。
pause
