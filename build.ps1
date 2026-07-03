<#
.SYNOPSIS
    Build the SakaDesk Windows installer natively on Windows.

.DESCRIPTION
    Windows-native replacement for the old cross-platform flow
    (`uv run python \\wsl.localhost\...\scripts\verify_build.py`, which copied the
    WSL tree to %TEMP% and built there). Since dev now lives on Windows at
    C:\D\repos, this builds the working copy in place:

      1. Frontend:  npm build  -> frontend\dist
      2. Executable: PyInstaller (tooling\build_windows.spec) -> dist\SakaDesk\
      3. Installer:  Inno Setup (tooling\windows\setup.iss)   -> dist\SakaDesk-<ver>-Setup.exe

    Build-only dependencies (pyinstaller, pywebview -> pythonnet) are injected
    ephemerally with `uv run --with`, so pyproject.toml / uv.lock stay clean.
    Python is pinned to 3.12 because pythonnet/pywebview do not support 3.14.

    Requires: uv, Node/npm, and (for the installer step) Inno Setup 6.
    Depends on the editable sibling ..\pysaka being present (it is bundled).

.PARAMETER SkipFrontend
    Reuse the existing frontend\dist instead of rebuilding it.

.PARAMETER Clean
    Force a clean `npm ci` (delete node_modules) instead of `npm run build` in place.

.PARAMETER ExeOnly
    Build the PyInstaller executable but skip the Inno Setup installer.

.EXAMPLE
    .\build.ps1                     # full: frontend + exe + installer
    .\build.ps1 -SkipFrontend       # rebuild installer from existing frontend\dist
    .\build.ps1 -ExeOnly            # just the exe (no Inno Setup needed)

.NOTES
    If PowerShell blocks the script:
        powershell -ExecutionPolicy Bypass -File .\build.ps1
#>
[CmdletBinding()]
param(
    [switch]$SkipFrontend,
    [switch]$Clean,
    [switch]$ExeOnly
)

$ErrorActionPreference = 'Stop'
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $true   # we DO want native failures to stop the build
}

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host "=== SakaDesk Windows installer build ===" -ForegroundColor Cyan

# --- 0. Prerequisites ------------------------------------------------------
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw "uv not found on PATH. Install from https://docs.astral.sh/uv/"
}
if (-not (Test-Path (Join-Path $Root '..\pysaka'))) {
    throw "Sibling ..\pysaka not found. The build bundles it as an editable dependency; clone it next to SakaDesk."
}
$Iscc = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $ExeOnly -and -not $Iscc) {
    Write-Warning "Inno Setup 6 (ISCC.exe) not found - building the exe only. Installer needs https://jrsoftware.org/isdl.php"
    $ExeOnly = $true
}

# --- 1. Frontend -----------------------------------------------------------
if ($SkipFrontend) {
    Write-Host "[1/2] Skipping frontend build (-SkipFrontend)"
    if (-not (Test-Path (Join-Path $Root 'frontend\dist\index.html'))) {
        throw "frontend\dist not found but -SkipFrontend was given. Drop -SkipFrontend for the first build."
    }
}
else {
    Write-Host "[1/2] Building frontend..." -ForegroundColor Cyan
    Push-Location (Join-Path $Root 'frontend')
    try {
        if ($Clean -or -not (Test-Path 'node_modules')) {
            npm ci
        }
        npm run build
    }
    finally { Pop-Location }
    if (-not (Test-Path (Join-Path $Root 'frontend\dist\index.html'))) {
        throw "Frontend build produced no dist\index.html"
    }
}

# --- 2. Executable (+ installer) ------------------------------------------
Write-Host "[2/2] Building executable (PyInstaller)$(if (-not $ExeOnly) { ' + installer (Inno Setup)' })..." -ForegroundColor Cyan
# Ephemeral build deps via --with (kept out of pyproject/uv.lock); pinned to 3.12.
$uvPrefix = @('run', '--python', '3.12', '--with', 'pyinstaller', '--with', 'pywebview', 'python')
if ($ExeOnly) {
    & uv @uvPrefix -m PyInstaller --noconfirm --clean 'tooling/build_windows.spec'
}
else {
    & uv @uvPrefix 'tooling/windows/build_windows.py'
}
if ($LASTEXITCODE) { throw "Build step failed (exit $LASTEXITCODE)" }

# --- 3. Report artifact ----------------------------------------------------
$version = (Select-String -Path (Join-Path $Root 'pyproject.toml') -Pattern '^version\s*=\s*"([^"]+)"' |
            Select-Object -First 1).Matches[0].Groups[1].Value
$installer = Join-Path $Root "dist\SakaDesk-$version-Setup.exe"
$exeDir    = Join-Path $Root 'dist\SakaDesk'

Write-Host ""
if ((-not $ExeOnly) -and (Test-Path $installer)) {
    $mb = [math]::Round((Get-Item $installer).Length / 1MB, 1)
    Write-Host "SUCCESS: $installer ($mb MB)" -ForegroundColor Green
}
elseif (Test-Path (Join-Path $exeDir 'SakaDesk.exe')) {
    Write-Host "SUCCESS (exe only): $exeDir\SakaDesk.exe" -ForegroundColor Green
}
else {
    throw "Build finished but no artifact found under dist\"
}
