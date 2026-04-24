$ErrorActionPreference = "Stop"

$installRoot = Join-Path $env:LOCALAPPDATA "TranslateGemma"
$launcherDir = Join-Path $installRoot "launcher"
$nativeHostName = "com.translategemma.launcher"
$nativeHostManifestPath = Join-Path $launcherDir "$nativeHostName.json"
$startupShortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\TranslateGemma Launcher.lnk"

# Ask Launcher to quit if it is running.
try {
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:18181/quit" | Out-Null
} catch {
    # ignore
}

# Remove automatic startup task.
$taskName = "TranslateGemma Launcher"
try {
    schtasks /Delete /TN "$taskName" /F | Out-Null
} catch {
    # ignore
}

try {
    Remove-Item -Force $startupShortcut
} catch {
    # ignore
}

foreach ($registrySubKey in @(
    "Software\Google\Chrome\NativeMessagingHosts\$nativeHostName",
    "Software\Chromium\NativeMessagingHosts\$nativeHostName",
    "Software\Microsoft\Edge\NativeMessagingHosts\$nativeHostName"
)) {
    foreach ($registryView in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
        try {
            $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $registryView)
            $baseKey.DeleteSubKeyTree($registrySubKey, $false)
            $baseKey.Close()
        } catch {
            # ignore
        }
    }
}

try {
    Remove-Item -Force $nativeHostManifestPath
} catch {
    # ignore
}

# Delay deletion so this script is not removed while it is running.
$cmd = 'timeout /t 2 >nul & rmdir /s /q "' + $installRoot + '"'
Start-Process -WindowStyle Hidden -FilePath cmd.exe -ArgumentList "/c $cmd"

Write-Host "Launcher removed" -ForegroundColor Green
