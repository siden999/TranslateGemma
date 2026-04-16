$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$launcherDir = Join-Path $rootDir "launcher"

$pythonExe = "python"
$pythonArgs = @()
try {
    & $pythonExe --version | Out-Null
} catch {
    try {
        $pythonExe = "py"
        $pythonArgs = @("-3")
        & $pythonExe @pythonArgs --version | Out-Null
    } catch {
        Write-Host "找不到 Python 3，請先安裝 Python 3.10+" -ForegroundColor Red
        exit 1
    }
}

function Test-LauncherReady {
    try {
        Invoke-WebRequest -Uri "http://127.0.0.1:18181/status" -UseBasicParsing -TimeoutSec 2 | Out-Null
        return $true
    } catch {
        return $false
    }
}

Set-Location $launcherDir

if (-not (Test-Path ".venv")) {
    Write-Host "建立 Launcher 虛擬環境..."
    & $pythonExe @pythonArgs -m venv .venv
}

& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt

$taskName = "TranslateGemma Launcher"
$launcherPath = Join-Path $launcherDir "launcher.py"
$pythonPath = Join-Path $launcherDir ".venv\Scripts\python.exe"
$args = "--no-tray"

schtasks /Delete /TN "$taskName" /F | Out-Null
schtasks /Create /SC ONLOGON /RL HIGHEST /TN "$taskName" /TR "\"$pythonPath\" \"$launcherPath\" $args" | Out-Null

if (Test-LauncherReady) {
    Write-Host "Launcher 已在背景執行" -ForegroundColor Green
} else {
    Write-Host "正在啟動 Launcher 背景服務..."
    Start-Process -FilePath $pythonPath -ArgumentList @($launcherPath, "--no-tray") -WorkingDirectory $launcherDir -WindowStyle Hidden | Out-Null

    $launcherReady = $false
    for ($i = 0; $i -lt 10; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-LauncherReady) {
            $launcherReady = $true
            break
        }
    }

    if ($launcherReady) {
        Write-Host "Launcher 已啟動，可直接回 Chrome 按「啟動」下載模型" -ForegroundColor Green
    } else {
        Write-Host "Launcher 已安裝，但目前尚未回應；請重新登入 Windows，或手動執行 launcher.py" -ForegroundColor Yellow
    }
}

Write-Host "Launcher 已安裝並設定為開機自動啟動" -ForegroundColor Green
