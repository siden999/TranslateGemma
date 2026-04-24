$ErrorActionPreference = "Stop"

$sourceRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$installRoot = Join-Path $env:LOCALAPPDATA "TranslateGemma"
$launcherDir = Join-Path $installRoot "launcher"
$serverDir = Join-Path $installRoot "server"
$extensionDir = Join-Path $installRoot "extension"
$nativeHostName = "com.translategemma.launcher"
$extensionOrigin = "chrome-extension://glkghkdgkpaflgolppmohgggighiphnn/"
$nativeHostManifestPath = Join-Path $launcherDir "$nativeHostName.json"
$nativeHostLauncherPath = Join-Path $launcherDir "native_host.cmd"
$nativeHostRegistrySubKeys = @(
    "Software\Google\Chrome\NativeMessagingHosts\$nativeHostName",
    "Software\Chromium\NativeMessagingHosts\$nativeHostName",
    "Software\Microsoft\Edge\NativeMessagingHosts\$nativeHostName"
)
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
    Write-Host "Python $minPythonMajor.$minPythonMinor-$maxPythonMajor.$maxPythonMinor was not found. Install Python 3.12, then run setup again." -ForegroundColor Red
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

function Wait-LauncherReady {
    param(
        [int]$TimeoutSeconds = 30
    )

    for ($i = 0; $i -lt ($TimeoutSeconds * 2); $i++) {
        if (Test-LauncherReady) {
            return $true
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Start-LauncherProcess {
    param(
        [string]$PythonPath,
        [string]$LauncherPath
    )

    if (-not (Test-Path $PythonPath)) {
        throw "Launcher Python was not found: $PythonPath"
    }
    if (-not (Test-Path $LauncherPath)) {
        throw "Launcher script was not found: $LauncherPath"
    }

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $PythonPath
    $startInfo.Arguments = "`"$LauncherPath`" --no-tray"
    $startInfo.WorkingDirectory = $launcherDir
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.EnvironmentVariables["PYTHONUNBUFFERED"] = "1"

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw "Failed to start Launcher background service"
    }
    return $process.Id
}

function Show-LauncherLogTail {
    $launcherLogPath = Join-Path $launcherDir "launcher.log"
    if (Test-Path $launcherLogPath) {
        Write-Host "Recent Launcher log:" -ForegroundColor Yellow
        Get-Content -Path $launcherLogPath -Tail 40
    } else {
        Write-Host "Launcher log has not been created yet: $launcherLogPath" -ForegroundColor Yellow
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
    if (-not (Test-Path $nativeHostLauncherPath)) {
        throw "Native Host launcher was not found: $nativeHostLauncherPath"
    }

    $manifest = [ordered]@{
        name = $nativeHostName
        description = "TranslateGemma Launcher Bridge"
        path = $nativeHostLauncherPath
        type = "stdio"
        allowed_origins = @($extensionOrigin)
    } | ConvertTo-Json -Depth 4

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($nativeHostManifestPath, $manifest, $utf8NoBom)

    foreach ($registrySubKey in $nativeHostRegistrySubKeys) {
        foreach ($registryView in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
            try {
                $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $registryView)
                $key = $baseKey.CreateSubKey($registrySubKey)
                $key.SetValue("", $nativeHostManifestPath, [Microsoft.Win32.RegistryValueKind]::String)
                $key.Close()
                $baseKey.Close()
            } catch {
                Write-Host ("Unable to write {0} {1}: {2}" -f $registryView, $registrySubKey, $_.Exception.Message) -ForegroundColor Yellow
            }
        }
    }
}

function Test-NativeHostRegistration {
    if (-not (Test-Path $nativeHostManifestPath)) {
        throw "Native Host manifest was not created: $nativeHostManifestPath"
    }

    $manifest = Get-Content -Raw -Path $nativeHostManifestPath | ConvertFrom-Json
    if ($manifest.name -ne $nativeHostName) {
        throw "Native Host manifest name does not match: $($manifest.name)"
    }
    if ($manifest.path -ne $nativeHostLauncherPath -or -not (Test-Path $manifest.path)) {
        throw "Native Host manifest path is invalid: $($manifest.path)"
    }
    if ($manifest.allowed_origins -notcontains $extensionOrigin) {
        throw "Native Host allowed_origins does not include the current extension ID: $extensionOrigin"
    }

    foreach ($registrySubKey in $nativeHostRegistrySubKeys) {
        $foundRegistration = $false
        foreach ($registryView in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
            try {
                $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $registryView)
                $key = $baseKey.OpenSubKey($registrySubKey)
                $value = if ($key) { [string]$key.GetValue("") } else { "" }
                if ($value -eq $nativeHostManifestPath) {
                    $foundRegistration = $true
                }
                if ($key) { $key.Close() }
                $baseKey.Close()
            } catch {
                # ignore and let the final check report failure
            }
        }

        if (-not $foundRegistration) {
            throw ("Native Host registry does not point to {0}: {1}" -f $nativeHostManifestPath, $registrySubKey)
        }
    }
}

function Install-ServerEnvironment {
    Write-Host "Creating/updating Server virtual environment. First install may take several minutes..."
    Set-Location $serverDir

    if (-not (Test-Path ".venv")) {
        Invoke-Checked $pythonExe ($pythonArgs + @("-m", "venv", ".venv")) "Failed to create Server virtual environment"
    }

    $serverPython = Join-Path $serverDir ".venv\Scripts\python.exe"
    if (-not (Test-PythonSupported -Exe $serverPython)) {
        throw "Server virtual environment Python is too old. Delete $serverDir\.venv, then run setup again."
    }

    Invoke-Checked $serverPython @("-m", "pip", "install", "--upgrade", "pip") "Failed to upgrade Server pip"
    Invoke-Checked $serverPython @("-m", "pip", "install", "--no-cache-dir", "--prefer-binary", "--extra-index-url", $llamaCppCpuWheelIndex, "-r", "requirements.txt") "Failed to install Server dependencies"
    Invoke-Checked $serverPython @("-c", "import main; import translator; print('Server Python modules OK')") "Server module check failed"

    Set-Location $launcherDir
}

New-Item -ItemType Directory -Force -Path $installRoot, $launcherDir, $serverDir, $extensionDir | Out-Null

Invoke-Robocopy (Join-Path $sourceRoot "launcher") $launcherDir @("/MIR", "/XD", ".venv", "/XF", "launcher.log")
Invoke-Robocopy (Join-Path $sourceRoot "server") $serverDir @("/MIR", "/XD", ".venv", "logs", "models")
Invoke-Robocopy (Join-Path $sourceRoot "extension") $extensionDir @("/MIR")

New-Item -ItemType Directory -Force -Path (Join-Path $serverDir "logs"), (Join-Path $serverDir "models") | Out-Null

Set-Location $launcherDir

if (-not (Test-Path ".venv")) {
    Write-Host "Creating Launcher virtual environment..."
    Invoke-Checked $pythonExe ($pythonArgs + @("-m", "venv", ".venv")) "Failed to create Launcher virtual environment"
}

Invoke-Checked ".\.venv\Scripts\python.exe" @("-m", "pip", "install", "--upgrade", "pip") "Failed to upgrade Launcher pip"
Invoke-Checked ".\.venv\Scripts\python.exe" @("-m", "pip", "install", "-r", "requirements.txt") "Failed to install Launcher dependencies"
Install-NativeHost
Test-NativeHostRegistration
Install-ServerEnvironment

$taskName = "TranslateGemma Launcher"
$launcherPath = Join-Path $launcherDir "launcher.py"
$pythonPath = Join-Path $launcherDir ".venv\Scripts\python.exe"
$backgroundPythonPath = $pythonPath
$args = "--no-tray"
$startupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$startupShortcutPath = Join-Path $startupDir "TranslateGemma Launcher.lnk"

New-Item -ItemType Directory -Force -Path $startupDir | Out-Null

schtasks /Delete /TN "$taskName" /F | Out-Null
$scheduledTaskCommand = '"' + $backgroundPythonPath + '" "' + $launcherPath + '" ' + $args
schtasks /Create /F /SC ONLOGON /RL LIMITED /TN "$taskName" /TR $scheduledTaskCommand | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Scheduled startup task failed. Startup folder shortcut will be used as fallback." -ForegroundColor Yellow
}
Set-StartupShortcut -ShortcutPath $startupShortcutPath -TargetPath $backgroundPythonPath -Arguments "`"$launcherPath`" $args" -WorkingDirectory $launcherDir

if (Test-LauncherReady) {
    Write-Host "Launcher is already running in the background" -ForegroundColor Green
} else {
    Write-Host "Starting Launcher background service..."
    $launcherPid = Start-LauncherProcess -PythonPath $backgroundPythonPath -LauncherPath $launcherPath
    Write-Host "Launcher background service start requested. PID: $launcherPid" -ForegroundColor Cyan

    $launcherReady = Wait-LauncherReady -TimeoutSeconds 30

    if ($launcherReady) {
        Write-Host "Launcher is ready. Return to Chrome and click Start to download the model." -ForegroundColor Green
    } else {
        Write-Host "Launcher was installed but is not responding yet. Sign out/in to Windows, or check $launcherDir\\launcher.log" -ForegroundColor Yellow
        Show-LauncherLogTail
    }
}

Write-Host "Launcher installed and configured to start automatically" -ForegroundColor Green
Write-Host "Install location: $installRoot" -ForegroundColor Cyan
Write-Host "Load this unpacked Chrome extension: $extensionDir" -ForegroundColor Cyan
Write-Host "If Chrome still says the launch bridge is not installed, remove the old TranslateGemma extension from chrome://extensions, then reload the extension folder above." -ForegroundColor Cyan
Write-Host "Launcher log: $launcherDir\\launcher.log" -ForegroundColor Cyan
Write-Host "Native Host: $nativeHostManifestPath" -ForegroundColor Cyan
