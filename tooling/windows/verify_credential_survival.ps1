# Verifies the developer machine's REAL credentials survive (1) a full
# backend pytest run and (2) a silent over-the-top upgrade install.
#
# Why this exists: backend/tests ran unisolated against the real Windows
# Credential Manager for months — two /api/translation/configure tests
# overwrote and then deleted the real `pysaka:llm_provider_api_key` entry on
# every full-suite run, which kept being misdiagnosed as an installer upgrade
# bug. Inno Setup has no unit tests, so this script is the regression gate.
#
# Usage (from the repo root):
#   .\tooling\windows\verify_credential_survival.ps1                 # pytest check only
#   .\tooling\windows\verify_credential_survival.ps1 -SetupExe dist\SakaDesk-X.Y.Z-Setup.exe
#
# It never reads or prints credential VALUES — only presence + LastWritten
# metadata via cmdkey's listing.

param(
    [string]$SetupExe = ""
)

$ErrorActionPreference = "Stop"

function Get-PysakaCredSnapshot {
    # cmdkey /list prints Target lines; filter to pysaka-owned entries.
    $lines = cmdkey /list | Where-Object { $_ -match 'pysaka' }
    return ($lines | ForEach-Object { $_.Trim() } | Sort-Object) -join "`n"
}

function Assert-SnapshotsEqual([string]$Before, [string]$After, [string]$Phase) {
    if ($Before -ne $After) {
        Write-Host "=== BEFORE ===`n$Before" -ForegroundColor Yellow
        Write-Host "=== AFTER ===`n$After" -ForegroundColor Yellow
        throw "FAIL [$Phase]: the set of real pysaka credentials changed."
    }
    Write-Host "PASS [$Phase]: real credentials untouched." -ForegroundColor Green
}

$before = Get-PysakaCredSnapshot
if (-not $before) {
    Write-Host "NOTE: no real pysaka credentials found — snapshot check is vacuous." -ForegroundColor Yellow
}

# --- Phase 1: full backend suite must not touch the real keyring -----------
Write-Host "Running backend pytest suite..."
uv run pytest backend/tests -q
if ($LASTEXITCODE -ne 0) { throw "backend suite failed (exit $LASTEXITCODE)" }
Assert-SnapshotsEqual $before (Get-PysakaCredSnapshot) "pytest"

# --- Phase 2 (optional): silent over-the-top upgrade install ---------------
if ($SetupExe) {
    if (-not (Test-Path $SetupExe)) { throw "Setup exe not found: $SetupExe" }
    Write-Host "Running silent upgrade install: $SetupExe"
    $p = Start-Process -FilePath $SetupExe `
        -ArgumentList "/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART" `
        -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "installer exited $($p.ExitCode)" }
    Assert-SnapshotsEqual $before (Get-PysakaCredSnapshot) "upgrade-install"
}

Write-Host "All credential-survival checks passed." -ForegroundColor Green
