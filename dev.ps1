<#
.SYNOPSIS
    SakaDesk development server manager (Windows-native equivalent of dev.sh).

.DESCRIPTION
    Starts, stops, and monitors the two dev servers as hidden background processes:
      - Backend : FastAPI via uvicorn on http://127.0.0.1:8000 (--reload, watches
                  backend/ and the editable sibling ..\pysaka\src)
      - Frontend: Vite dev server on http://127.0.0.1:5173

    'start' / 'restart' draw a fresh API token on every run (written to the
    git-ignored .dev-api-token, readable by the current user only) unless
    SAKADESK_API_TOKEN is already set. Once the frontend answers, they open the
    app in the default browser at http://127.0.0.1:5173/#t=<token>: the local
    API requires that token, so an older tab must be reopened via the new URL.

    Unlike dev.sh (lsof / nohup / /tmp — Linux only) this uses Get-NetTCPConnection
    for port ownership and taskkill /T to tear down the whole process tree
    (cmd -> uv -> python/uvicorn, and npm -> node), so --reload workers don't leak.

    Logs and PID files live under %TEMP%\sakadesk-dev\.

.PARAMETER Action
    start | stop | restart | status | logs   (default: start)

.EXAMPLE
    .\dev.ps1              # start both servers
    .\dev.ps1 status       # show what's running + recent log tails
    .\dev.ps1 logs         # follow backend+frontend logs (Ctrl+C to exit)
    .\dev.ps1 stop

.NOTES
    If PowerShell blocks the script, run it as:
        powershell -ExecutionPolicy Bypass -File .\dev.ps1 start
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'restart', 'status', 'logs')]
    [string]$Action = 'start',

    [int]$BackendPort  = 8000,
    [int]$FrontendPort = 5173
)

$ErrorActionPreference = 'Stop'
# In PS7 a native command's non-zero exit throws when EAP=Stop. taskkill returns
# non-zero for already-dead or protected (svchost) PIDs, which must NOT abort us.
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$ScriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendDir  = Join-Path $ScriptDir 'frontend'

$LogDir       = Join-Path $env:TEMP 'sakadesk-dev'
$BackendLog   = Join-Path $LogDir 'backend.log'
$FrontendLog  = Join-Path $LogDir 'frontend.log'
$BackendPidF  = Join-Path $LogDir 'backend.pid'
$FrontendPidF = Join-Path $LogDir 'frontend.pid'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# One API token per launch (security audit 2026-11-13). 'start' and 'restart'
# draw a fresh token every time (Initialize-ApiToken) and overwrite the
# git-ignored .dev-api-token, locked to the current user, so an old URL in the
# browser history stops working. A SAKADESK_API_TOKEN already set in the
# environment is used instead, unchanged (manual override). The browser gets the
# token only through the app URL's #t= fragment, which Start-Frontend opens
# (never written to a log file). The rule matches the page's
# (frontend/src/core/api/launchAuth.ts): 16-128 of A-Z a-z 0-9 _ -.
$TokenFile = Join-Path $ScriptDir '.dev-api-token'
$TokenPattern = '^[A-Za-z0-9_-]{16,128}$'
function Initialize-ApiToken {
    if ($env:SAKADESK_API_TOKEN) {
        if ($env:SAKADESK_API_TOKEN -cnotmatch $TokenPattern) {
            Write-Host "ERROR: SAKADESK_API_TOKEN must be 16-128 characters of A-Z, a-z, 0-9, _ or -."
            Write-Host "       Unset it to use the generated .dev-api-token instead."
            exit 1
        }
        return
    }
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $tok = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    # Create the file empty, lock it to the current user, then write the token,
    # so it is never readable through an inherited ACL (e.g. a checkout under C:\D\).
    if (Test-Path $TokenFile) { Remove-Item $TokenFile -Force }
    New-Item -ItemType File -Path $TokenFile | Out-Null
    $who = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    icacls $TokenFile /inheritance:r /grant:r "${who}:F" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Remove-Item $TokenFile -Force -ErrorAction SilentlyContinue
        Write-Error "Could not restrict .dev-api-token to the current user (icacls exit $LASTEXITCODE); no token file was kept."
        exit 1
    }
    Set-Content -Path $TokenFile -Value $tok -NoNewline -Encoding ascii
    $env:SAKADESK_API_TOKEN = $tok
}

# --- helpers ---------------------------------------------------------------

function Invoke-Kill([int]$ProcId) {
    # Recursively kill a process tree using ONLY PowerShell cmdlets (no taskkill),
    # so there is no native stderr to leak and nothing that can throw — children
    # (uvicorn --reload workers, vite's esbuild) are reached before their parents.
    if (-not $ProcId) { return }
    foreach ($child in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcId" -ErrorAction SilentlyContinue)) {
        Invoke-Kill ([int]$child.ProcessId)
    }
    Stop-Process -Id $ProcId -Force -ErrorAction SilentlyContinue
}

function Test-HttpOk([string]$Url) {
    # True only if the URL actually answers with an HTTP status (not a ghost port).
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
        return [bool]$r.StatusCode
    }
    catch {
        # A 4xx/5xx still means something is serving; only connection failures are "down".
        return [bool]$_.Exception.Response
    }
}

function Get-PortOwners([int]$Port) {
    try {
        Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
            Select-Object -ExpandProperty OwningProcess -Unique
    }
    catch { @() }
}

function Stop-Tree([string]$PidFile, [int]$Port, [string]$Name) {
    # 1) Kill the tree we launched (from the PID file) — this reaches reload workers.
    if (Test-Path $PidFile) {
        $tracked = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($tracked) { Invoke-Kill ([int]$tracked) }
        Remove-Item $PidFile -ErrorAction SilentlyContinue
    }
    # 2) Fallback: kill leftover *dev* processes still on the port, but only known
    #    dev binaries — never a protected system process like svchost/services.
    foreach ($procId in @(Get-PortOwners $Port)) {
        if (-not $procId) { continue }
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
        if ($proc -and $proc.Name -match '^(cmd|uv|python|pythonw|node|npm)\.exe$') {
            Invoke-Kill ([int]$procId)
        }
    }
    Write-Host "  $Name stopped."
}

# Needs $env:SAKADESK_API_TOKEN from Initialize-ApiToken (called once per start/restart).
function Start-Backend {
    if (-not $env:SAKADESK_API_TOKEN) { Write-Error "No API token prepared for the backend."; exit 1 }
    Write-Host "Starting backend on port $BackendPort..."
    # cmd /c merges stdout+stderr into one log; taskkill /T later kills uv+uvicorn children.
    # --timeout-keep-alive must match KEEP_ALIVE_TIMEOUT_S in desktop.py (outlast the
    # browser's 300 s idle sockets so the server never closes a reused one).
    $cmd = "uv run uvicorn backend.main:app --host 127.0.0.1 --port $BackendPort " +
           "--timeout-keep-alive 600 " +
           "--reload --reload-dir backend --reload-dir ..\pysaka\src " +
           "--reload-exclude `"output/*`" --reload-exclude `"auth_data/*`" > `"$BackendLog`" 2>&1"
    $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $cmd `
            -WorkingDirectory $ScriptDir -WindowStyle Hidden -PassThru
    $p.Id | Set-Content $BackendPidF

    # Poll the health endpoint briefly for a friendly confirmation.
    for ($i = 0; $i -lt 10; $i++) {
        Start-Sleep -Milliseconds 700
        try {
            $r = Invoke-WebRequest -Uri "http://127.0.0.1:$BackendPort/health" -UseBasicParsing -TimeoutSec 2
            if ($r.StatusCode -eq 200) { Write-Host "  Backend healthy (/health 200)."; return }
        }
        catch { }
    }
    Write-Host "  Backend starting... (tail $BackendLog if it doesn't come up)"
}

function Start-Frontend {
    Write-Host "Starting frontend on port $FrontendPort..."
    # Vite binds 127.0.0.1 (vite.config.ts) and never reads the token.
    $cmd = "npm run dev -- --port $FrontendPort --strictPort > `"$FrontendLog`" 2>&1"
    $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $cmd `
            -WorkingDirectory $FrontendDir -WindowStyle Hidden -PassThru
    $p.Id | Set-Content $FrontendPidF

    # Verify it actually came up (vite with --strictPort fails hard if the port is taken).
    for ($i = 0; $i -lt 12; $i++) {
        Start-Sleep -Milliseconds 800
        if (Test-HttpOk "http://127.0.0.1:$FrontendPort") {
            Write-Host "  Frontend serving on http://127.0.0.1:$FrontendPort"
            # The URL carries this run's API token: hand it to the browser only,
            # never to Write-Host or a log file.
            $AppUrl = "http://127.0.0.1:$FrontendPort/#t=$($env:SAKADESK_API_TOKEN)"
            Start-Process $AppUrl
            Write-Host "  Opened SakaDesk in your browser with this run's new token (close any older"
            Write-Host "  tab: it gets 401 on changes)."
            return
        }
        # If the launcher already exited, vite bailed — surface the reason from the log.
        if (-not (Get-Process -Id $p.Id -ErrorAction SilentlyContinue)) {
            $err = ''
            if (Test-Path $FrontendLog) {
                $err = (Select-String -Path $FrontendLog -Pattern 'already in use|EADDRINUSE|Error' -SimpleMatch:$false |
                        Select-Object -First 1).Line
            }
            Write-Host "  ERROR: frontend failed to start. $err"
            Write-Host "         (see $FrontendLog)"
            if ($err -match 'already in use|EADDRINUSE') {
                Write-Host "         Port $FrontendPort is held by another process (possibly a stale WSL relay)."
            }
            return
        }
    }
    Write-Host "  Frontend still starting... (tail $FrontendLog if it doesn't come up)"
}

function Show-Status {
    Write-Host "=== SakaDesk Dev Server Status ==="
    # Use real HTTP responses so a ghost/relay port never reads as RUNNING.
    if (Test-HttpOk "http://127.0.0.1:$BackendPort/health") {
        Write-Host "Backend:  RUNNING on http://127.0.0.1:$BackendPort"
    } else { Write-Host "Backend:  STOPPED" }
    if (Test-HttpOk "http://127.0.0.1:$FrontendPort") {
        Write-Host "Frontend: RUNNING on http://127.0.0.1:$FrontendPort"
    } else { Write-Host "Frontend: STOPPED" }
    Write-Host ""
    Write-Host "Logs:"
    Write-Host "  Backend:  $BackendLog"
    Write-Host "  Frontend: $FrontendLog"
    foreach ($pair in @(@('Backend', $BackendLog), @('Frontend', $FrontendLog))) {
        if (Test-Path $pair[1]) {
            Write-Host ""
            Write-Host "--- $($pair[0]) (last 5 lines) ---"
            Get-Content $pair[1] -Tail 5 -ErrorAction SilentlyContinue
        }
    }
}

# --- dispatch --------------------------------------------------------------

switch ($Action) {
    'start' {
        Initialize-ApiToken  # this launch's token, drawn before anything is stopped
        Stop-Tree $BackendPidF  $BackendPort  'Backend'
        Stop-Tree $FrontendPidF $FrontendPort 'Frontend'
        Start-Sleep -Seconds 1
        Start-Backend
        Start-Frontend
        Write-Host ""
        Write-Host "=== Dev servers started ==="
        Write-Host "Frontend: http://127.0.0.1:$FrontendPort"
        Write-Host "Backend:  http://127.0.0.1:$BackendPort"
    }
    'stop' {
        Stop-Tree $BackendPidF  $BackendPort  'Backend'
        Stop-Tree $FrontendPidF $FrontendPort 'Frontend'
    }
    'restart' {
        Initialize-ApiToken  # this launch's token, drawn before anything is stopped
        Stop-Tree $BackendPidF  $BackendPort  'Backend'
        Stop-Tree $FrontendPidF $FrontendPort 'Frontend'
        Start-Sleep -Seconds 1
        Start-Backend
        Start-Frontend
        Write-Host ""
        Write-Host "=== Dev servers restarted ==="
    }
    'status' { Show-Status }
    'logs' {
        Write-Host "Following logs (Ctrl+C to stop)..."
        $existing = @($BackendLog, $FrontendLog | Where-Object { Test-Path $_ })
        if (-not $existing.Count) { Write-Host "No logs yet. Run '.\dev.ps1 start' first."; break }
        Get-Content $existing -Tail 20 -Wait
    }
}
