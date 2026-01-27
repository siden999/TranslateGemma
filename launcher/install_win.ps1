$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$launcherDir = Join-Path $rootDir "launcher"

$pythonBin = "python"
try {
    & python --version | Out-Null
} catch {
    try {
        $pythonBin = "py -3"
        & py -3 --version | Out-Null
    } catch {
        Write-Host "找不到 Python 3，請先安裝 Python 3.10+" -ForegroundColor Red
        exit 1
    }
}

Set-Location $launcherDir

if (-not (Test-Path ".venv")) {
    Write-Host "建立 Launcher 虛擬環境..."
    & $pythonBin -m venv .venv
}

& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt

$taskName = "TranslateGemma Launcher"
$launcherPath = Join-Path $launcherDir "launcher.py"
$pythonPath = Join-Path $launcherDir ".venv\Scripts\python.exe"
$args = "--no-tray"

schtasks /Delete /TN "$taskName" /F | Out-Null
schtasks /Create /SC ONLOGON /RL HIGHEST /TN "$taskName" /TR "\"$pythonPath\" \"$launcherPath\" $args" | Out-Null

Write-Host "Launcher 已安裝並設定為開機自動啟動" -ForegroundColor Green
