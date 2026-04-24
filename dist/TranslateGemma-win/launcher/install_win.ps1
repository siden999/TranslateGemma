$ErrorActionPreference = "Stop"

$sourceRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$installRoot = Join-Path $env:LOCALAPPDATA "TranslateGemma"
$launcherDir = Join-Path $installRoot "launcher"
$serverDir = Join-Path $installRoot "server"
$extensionDir = Join-Path $installRoot "extension"
$nativeHostName = "com.translategemma.launcher"
$extensionOrigin = "chrome-extension://glkghkdgkpaflgolppmohgggighiphnn/"
$nativeHostManifestPath = Join-Path $launcherDir "$nativeHostName.json"
$minPythonMajor = 3
$minPythonMinor = 10
$maxPythonMajor = 3
$maxPythonMinor = 12
$llamaCppCpuWheelIndex = "https://abetlen.github.io/llama-cpp-python/whl/cpu"

function Invoke-Checked {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$ErrorMessage
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$ErrorMessage (exit code $LASTEXITCODE)"
    }
}

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

function Test-PythonSupported {
    param(
        [string]$Exe,
        [string[]]$Args = @()
    )

    try {
        $versionText = & $Exe @Args -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
        if ($LASTEXITCODE -ne 0) {
            return $false
        }
        $parts = $versionText.Trim().Split(".")
        $major = [int]$parts[0]
        $minor = [int]$parts[1]
        $aboveMinimum = ($major -gt $minPythonMajor) -or ($major -eq $minPythonMajor -and $minor -ge $minPythonMinor)
        $belowMaximum = ($major -lt $maxPythonMajor) -or ($major -eq $maxPythonMajor -and $minor -le $maxPythonMinor)
        return $aboveMinimum -and $belowMaximum
    } catch {
        return $false
    }
}

$pythonExe = $null
$pythonArgs = @()
foreach ($candidate in @(
    @{ Exe = "python3.12"; Args = @() },
    @{ Exe = "python3.11"; Args = @() },
    @{ Exe = "python3.10"; Args = @() },
    @{ Exe = "python"; Args = @() },
    @{ Exe = "py"; Args = @("-3") }
)) {
    if (Test-PythonSupported -Exe $candidate.Exe -Args $candidate.Args) {
        $pythonExe = $candidate.Exe
        $pythonArgs = $candidate.Args
        break
    }
}

if (-not $pythonExe) {
    Write-Host "找不到 Python $minPythonMajor.$minPythonMinor-$maxPythonMajor.$maxPythonMinor，請先安裝 Python 3.12 後再執行" -ForegroundColor Red
    exit 1
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

function Install-NativeHost {
    $manifest = @{
        name = $nativeHostName
        description = "TranslateGemma Launcher Bridge"
        path = "native_host.cmd"
        type = "stdio"
        allowed_origins = @($extensionOrigin)
    } | ConvertTo-Json -Depth 4

    Set-Content -Path $nativeHostManifestPath -Value $manifest -Encoding Ascii

    $registryTargets = @(
        "HKCU\Software\Google\Chrome\NativeMessagingHosts\$nativeHostName",
        "HKCU\Software\Chromium\NativeMessagingHosts\$nativeHostName"
    )

    foreach ($registryTarget in $registryTargets) {
        & reg add $registryTarget /ve /t REG_SZ /d $nativeHostManifestPath /f | Out-Null
    }
}

function Install-ServerEnvironment {
    Write-Host "建立/更新 Server 虛擬環境（首次安裝可能需要幾分鐘）..."
    Set-Location $serverDir

    if (-not (Test-Path ".venv")) {
        Invoke-Checked $pythonExe ($pythonArgs + @("-m", "venv", ".venv")) "建立 Server 虛擬環境失敗"
    }

    $serverPython = Join-Path $serverDir ".venv\Scripts\python.exe"
    if (-not (Test-PythonSupported -Exe $serverPython)) {
        throw "Server 虛擬環境的 Python 版本過舊，請刪除 $serverDir\.venv 後重新執行安裝器"
    }

    Invoke-Checked $serverPython @("-m", "pip", "install", "--upgrade", "pip") "更新 Server pip 失敗"
    Invoke-Checked $serverPython @("-m", "pip", "install", "--no-cache-dir", "--prefer-binary", "--extra-index-url", $llamaCppCpuWheelIndex, "-r", "requirements.txt") "安裝 Server 相依套件失敗"
    Invoke-Checked $serverPython @("-c", "import main; import translator; print('Server Python modules OK')") "Server 模組檢查失敗"

    Set-Location $launcherDir
}

New-Item -ItemType Directory -Force -Path $installRoot, $launcherDir, $serverDir, $extensionDir | Out-Null

Invoke-Robocopy (Join-Path $sourceRoot "launcher") $launcherDir @("/MIR", "/XD", ".venv", "/XF", "launcher.log")
Invoke-Robocopy (Join-Path $sourceRoot "server") $serverDir @("/MIR", "/XD", ".venv", "logs", "models")
Invoke-Robocopy (Join-Path $sourceRoot "extension") $extensionDir @("/MIR")

New-Item -ItemType Directory -Force -Path (Join-Path $serverDir "logs"), (Join-Path $serverDir "models") | Out-Null

Set-Location $launcherDir

if (-not (Test-Path ".venv")) {
    Write-Host "建立 Launcher 虛擬環境..."
    Invoke-Checked $pythonExe ($pythonArgs + @("-m", "venv", ".venv")) "建立 Launcher 虛擬環境失敗"
}

Invoke-Checked ".\.venv\Scripts\python.exe" @("-m", "pip", "install", "--upgrade", "pip") "更新 Launcher pip 失敗"
Invoke-Checked ".\.venv\Scripts\python.exe" @("-m", "pip", "install", "-r", "requirements.txt") "安裝 Launcher 相依套件失敗"
Install-ServerEnvironment
Install-NativeHost

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
if ($LASTEXITCODE -ne 0) {
    Write-Host "排程自動啟動建立失敗，將使用啟動資料夾捷徑作為 fallback" -ForegroundColor Yellow
}
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
Write-Host "Native Host：$nativeHostManifestPath" -ForegroundColor Cyan
