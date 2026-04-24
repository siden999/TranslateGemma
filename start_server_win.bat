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
        echo 找不到 Python 3，請先安裝 Python 3.10-3.12
        pause
        exit /b 1
    ) else (
        set "PYTHON_BIN=py -3"
    )
)

%PYTHON_BIN% -c "import sys; raise SystemExit(0 if (3, 10) <= sys.version_info[:2] <= (3, 12) else 1)"
if errorlevel 1 (
    echo 找不到相容的 Python 3.10-3.12，請先安裝 Python 3.12 後再執行
    pause
    exit /b 1
)

if exist ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
) else (
    echo 找不到虛擬環境，開始建立並安裝依賴...
    %PYTHON_BIN% -m venv .venv
    call .venv\Scripts\activate.bat
    python -m pip install --upgrade pip
    python -m pip install --no-cache-dir --prefer-binary --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu -r requirements.txt
)

set "SITE_PACKAGES=%CD%\.venv\Lib\site-packages"
set "LLAMA_LIB=%SITE_PACKAGES%\llama_cpp\lib"

call :check_cuda
if errorlevel 1 (
    where nvidia-smi >nul 2>nul
    if errorlevel 1 (
        echo 未偵測到 NVIDIA GPU，使用 CPU 版本
    ) else (
        echo ⚡ 偵測到 NVIDIA GPU，嘗試啟用 CUDA 加速...
        set "CMAKE_ARGS=-DGGML_CUDA=on"
        python -m pip install --force-reinstall --no-binary llama-cpp-python llama-cpp-python
        set "CMAKE_ARGS="
        call :check_cuda
        if errorlevel 1 (
            echo ⚠️ CUDA 編譯失敗，改用 CPU 版本
        ) else (
            echo ✅ CUDA GPU 加速已啟用
        )
    )
) else (
    echo ✅ CUDA GPU 加速已啟用
)

python main.py

echo.
echo 伺服器已停止。
pause
exit /b 0

:check_cuda
if not exist "%LLAMA_LIB%" exit /b 1
dir /b "%LLAMA_LIB%\*cuda*.dll" >nul 2>nul
if errorlevel 1 exit /b 1
exit /b 0
