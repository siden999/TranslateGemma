$ErrorActionPreference = "Stop"

$repoOwner = "siden999"
$repoName = "TranslateGemma"
$installRoot = Join-Path $env:LOCALAPPDATA "TranslateGemma"
$extensionDir = Join-Path $installRoot "extension"
$workRoot = Join-Path $env:TEMP "TranslateGemmaInstall"
$apiLatestRelease = "https://api.github.com/repos/$repoOwner/$repoName/releases/latest"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "== $Message ==" -ForegroundColor Cyan
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
        return ($major -eq 3 -and $minor -ge 10 -and $minor -le 12)
    } catch {
        return $false
    }
}

function Test-AnySupportedPython {
    foreach ($candidate in @(
        @{ Exe = "py"; Args = @("-3.12") },
        @{ Exe = "py"; Args = @("-3.11") },
        @{ Exe = "py"; Args = @("-3.10") },
        @{ Exe = "python3.12"; Args = @() },
        @{ Exe = "python3.11"; Args = @() },
        @{ Exe = "python3.10"; Args = @() },
        @{ Exe = "python"; Args = @() }
    )) {
        if (Test-PythonSupported -Exe $candidate.Exe -Args $candidate.Args) {
            return $true
        }
    }
    return $false
}

function Ensure-Python {
    if (Test-AnySupportedPython) {
        Write-Host "Python 3.10-3.12 found."
        return
    }

    Write-Host "Python 3.10-3.12 was not found. TranslateGemma recommends Python 3.12." -ForegroundColor Yellow
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        Write-Host "Please install Python 3.12 from https://www.python.org/downloads/windows/ and run this command again." -ForegroundColor Yellow
        Start-Process "https://www.python.org/downloads/windows/"
        throw "Python is required before TranslateGemma can be installed."
    }

    Write-Host "Installing Python 3.12 with winget. If Windows asks for permission, please approve it."
    & winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "Python 3.12 install failed. Install Python 3.12 manually, then run this command again."
    }

    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"

    if (-not (Test-AnySupportedPython)) {
        throw "Python was installed, but this PowerShell window cannot see it yet. Close PowerShell, open it again, then run this command again."
    }
}

function Resolve-ReleaseZip {
    $versionFromEnv = $env:TRANSLATEGEMMA_VERSION
    if ($versionFromEnv) {
        $version = $versionFromEnv.Trim().TrimStart("v")
        return @{
            Version = $version
            Url = "https://github.com/$repoOwner/$repoName/releases/download/v$version/TranslateGemma-win-v$version.zip"
        }
    }

    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $release = Invoke-RestMethod -Uri $apiLatestRelease -Headers @{ "User-Agent" = "TranslateGemmaInstaller" }
    $asset = $release.assets | Where-Object { $_.name -like "TranslateGemma-win-v*.zip" } | Select-Object -First 1
    if (-not $asset) {
        throw "Could not find TranslateGemma Windows zip in the latest GitHub Release."
    }

    $version = [string]$release.tag_name
    $version = $version.TrimStart("v")
    return @{
        Version = $version
        Url = $asset.browser_download_url
    }
}

Write-Host "TranslateGemma Windows installer"
Write-Host "This command installs the local Launcher, dependencies, Native Host, and startup task."

Write-Step "Check Python"
Ensure-Python

Write-Step "Find latest GitHub Release"
$releaseInfo = Resolve-ReleaseZip
$version = $releaseInfo.Version
$zipUrl = $releaseInfo.Url
$zipPath = Join-Path $workRoot "TranslateGemma-win-v$version.zip"
$extractDir = Join-Path $workRoot "extract"

Write-Host "Version: v$version"
Write-Host "Download: $zipUrl"

Write-Step "Download installer package"
Remove-Item -Recurse -Force $workRoot -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $workRoot, $extractDir | Out-Null
Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing

Write-Step "Extract package"
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

$installScript = Join-Path $extractDir "TranslateGemma-win\launcher\install_win.ps1"
if (-not (Test-Path $installScript)) {
    throw "Install package is incomplete. Missing launcher\install_win.ps1."
}

Write-Step "Install local TranslateGemma"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installScript
if ($LASTEXITCODE -ne 0) {
    throw "TranslateGemma local install failed."
}

Write-Step "Done"
Write-Host "Local install finished." -ForegroundColor Green
Write-Host "Next step: open Chrome and go to chrome://extensions/"
Write-Host "Turn on Developer mode, click Load unpacked, then choose this folder:"
Write-Host $extensionDir -ForegroundColor Cyan
Start-Process "chrome://extensions/" -ErrorAction SilentlyContinue
