$ErrorActionPreference = "Stop"

$launcherDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# 嘗試讓 Launcher 自行退出
try {
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:18181/quit" | Out-Null
} catch {
    # ignore
}

# 移除自動啟動排程
$taskName = "TranslateGemma Launcher"
try {
    schtasks /Delete /TN "$taskName" /F | Out-Null
} catch {
    # ignore
}

# 延遲刪除目錄（避免腳本執行中被刪）
$cmd = "timeout /t 2 >nul & rmdir /s /q \"$launcherDir\""
Start-Process -WindowStyle Hidden -FilePath cmd.exe -ArgumentList "/c $cmd"

Write-Host "Launcher 已移除" -ForegroundColor Green
