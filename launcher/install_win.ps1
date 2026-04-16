$ErrorActionPreference = "Stop"

$sourceRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$installRoot = Join-Path $env:LOCALAPPDATA "TranslateGemma"
$launcherDir = Join-Path $installRoot "launcher"
$serverDir = Join-Path $installRoot "server"
$extensionDir = Join-Path $installRoot "extension"

function Invoke-Robocopy {
    param(
        [string]$Source,
        [string]$Destination,
        [string[]]$Options
    )

    & robocopy $Source $Destination @Options | Out-Null
    if ($LASTEXITCODE -gt 7) {
        throw "robocopy failed with exit code $LASTEXITCODE"
    }
}

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

function Set-StartupShortcut {
    param(
        [string]$ShortcutPath,
        [string]$TargetPath,
        [string]$Arguments,
        [string]$WorkingDirectory
    )

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = $TargetPath
    $shortcut.Arguments = $Arguments
    $shortcut.WorkingDirectory = $WorkingDirectory
    $shortcut.WindowStyle = 7
    $shortcut.Save()
}

New-Item -ItemType Directory -Force -Path $installRoot, $launcherDir, $serverDir, $extensionDir | Out-Null

Invoke-Robocopy (Join-Path $sourceRoot "launcher") $launcherDir @("/MIR", "/XD", ".venv", "/XF", "launcher.log")
Invoke-Robocopy (Join-Path $sourceRoot "server") $serverDir @("/MIR", "/XD", ".venv", "logs", "models")
Invoke-Robocopy (Join-Path $sourceRoot "extension") $extensionDir @("/MIR")

New-Item -ItemType Directory -Force -Path (Join-Path $serverDir "logs"), (Join-Path $serverDir "models") | Out-Null

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
$pythonwPath = Join-Path $launcherDir ".venv\Scripts\pythonw.exe"
$backgroundPythonPath = if (Test-Path $pythonwPath) { $pythonwPath } else { $pythonPath }
$args = "--no-tray"
$startupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$startupShortcutPath = Join-Path $startupDir "TranslateGemma Launcher.lnk"

New-Item -ItemType Directory -Force -Path $startupDir | Out-Null

schtasks /Delete /TN "$taskName" /F | Out-Null
schtasks /Create /SC ONLOGON /RL HIGHEST /TN "$taskName" /TR "\"$backgroundPythonPath\" \"$launcherPath\" $args" | Out-Null
Set-StartupShortcut -ShortcutPath $startupShortcutPath -TargetPath $backgroundPythonPath -Arguments "`"$launcherPath`" $args" -WorkingDirectory $launcherDir

if (Test-LauncherReady) {
    Write-Host "Launcher 已在背景執行" -ForegroundColor Green
} else {
    Write-Host "正在啟動 Launcher 背景服務..."
    Start-Process -FilePath $backgroundPythonPath -ArgumentList @($launcherPath, "--no-tray") -WorkingDirectory $launcherDir -WindowStyle Hidden | Out-Null

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
        Write-Host "Launcher 已安裝，但目前尚未回應；請重新登入 Windows，或檢查 $launcherDir\\launcher.log" -ForegroundColor Yellow
    }
}

Write-Host "Launcher 已安裝並設定為開機自動啟動" -ForegroundColor Green
Write-Host "固定安裝位置：$installRoot" -ForegroundColor Cyan
Write-Host "Chrome 未封裝擴充請載入：$extensionDir" -ForegroundColor Cyan
Write-Host "Launcher 記錄檔：$launcherDir\\launcher.log" -ForegroundColor Cyan
