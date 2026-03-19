@echo off
REM SakaDesk Windows Build and Test Script
REM Run this from Windows (double-click or cmd.exe)
REM Works from any location - auto-detects project path

REM Get the directory where this script is located
set SCRIPT_DIR=%~dp0
set PROJECT_DIR=%SCRIPT_DIR%..
set BUILD_DIR=%PROJECT_DIR%\dist

echo ============================================
echo  SakaDesk Windows Build ^& Test
echo ============================================
echo.

REM Check if uv is installed
where uv >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: uv not found. Install from: https://docs.astral.sh/uv/
    pause
    exit /b 1
)

REM Ensure Python 3.12 is available (pythonnet doesn't support 3.14 yet)
echo Ensuring Python 3.12 is available...
uv python install 3.12 >nul 2>&1

echo [1/5] Navigating to project...
pushd "%PROJECT_DIR%"
if %ERRORLEVEL% neq 0 (
    echo ERROR: Cannot access project path: %PROJECT_DIR%
    pause
    exit /b 1
)

echo      Project: %CD%
echo.

echo [2/5] Preparing workspace...
set WORKSPACE_ROOT=%TEMP%\SakaDesk_Workspace
set WORKSPACE_APP=%WORKSPACE_ROOT%\SakaDesk
set WORKSPACE_LIB=%WORKSPACE_ROOT%\pyzaka

if exist "%WORKSPACE_ROOT%" rmdir /s /q "%WORKSPACE_ROOT%"
mkdir "%WORKSPACE_ROOT%"

@REM Robocopy flags:
@REM /E - recursive, /XD - exclude dirs, /R:1 /W:1 - retry once wait 1s
@REM Exclude: .venv, dist, build, .git, auth_data, output, __pycache__, .pytest_cache

echo      Copying SakaDesk to workspace...
robocopy "%PROJECT_DIR%" "%WORKSPACE_APP%" /E /XD .venv dist build .git auth_data output __pycache__ .pytest_cache .idea .vscode node_modules /R:1 /W:1 /NFL /NDL /NJH /NJS
if %ERRORLEVEL% geq 8 (
    echo ERROR: Robocopy failed for SakaDesk
    pause
    exit /b 1
)

echo      Copying pyzaka (dependency) to workspace...
robocopy "%PROJECT_DIR%\..\pyzaka" "%WORKSPACE_LIB%" /E /XD .venv dist build .git auth_data output __pycache__ .pytest_cache .idea .vscode /R:1 /W:1 /NFL /NDL /NJH /NJS
if %ERRORLEVEL% geq 8 (
    echo ERROR: Robocopy failed for pyzaka
    pause
    exit /b 1
)

echo.
echo [3/5] Building frontend...
pushd "%WORKSPACE_APP%\frontend"
call npm ci
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm ci failed!
    popd
    popd
    pause
    exit /b 1
)
call npm run build
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm build failed!
    popd
    popd
    pause
    exit /b 1
)
popd

echo.
echo [4/5] Building Windows executable...
pushd "%WORKSPACE_APP%"

REM Unset inherited environment variables from parent 'uv run'
set VIRTUAL_ENV=
set UV_PROJECT_ENVIRONMENT=

REM Pin to Python 3.12 (pythonnet doesn't support 3.14 yet)
uv python pin 3.12
if %ERRORLEVEL% neq 0 (
    echo ERROR: Failed to pin Python 3.12!
    popd
    popd
    pause
    exit /b 1
)

REM Install build dependencies (not in pyproject.toml)
uv add --dev pyinstaller pywebview
if %ERRORLEVEL% neq 0 (
    echo ERROR: Failed to install build dependencies!
    popd
    popd
    pause
    exit /b 1
)

uv run python tooling/windows/build_windows.py
if %ERRORLEVEL% neq 0 (
    echo ERROR: Build failed!
    popd
    popd
    pause
    exit /b 1
)
popd

echo.
echo [5/5] Copying artifacts back...
if not exist "%BUILD_DIR%" mkdir "%BUILD_DIR%"
copy /Y "%WORKSPACE_APP%\dist\zakadesk-setup.exe" "%BUILD_DIR%\" >nul 2>&1
if exist "%BUILD_DIR%\zakadesk-setup.exe" (
    echo      Installer copied to %BUILD_DIR%
) else (
    echo      WARNING: Installer not found, copying raw build...
    xcopy /E /Y "%WORKSPACE_APP%\dist\SakaDesk\*" "%BUILD_DIR%\SakaDesk\" >nul
)

popd

echo.
echo ============================================
echo  Build complete!
if exist "%BUILD_DIR%\zakadesk-setup.exe" (
    echo  Installer: %BUILD_DIR%\zakadesk-setup.exe
) else (
    echo  Executable: %BUILD_DIR%\SakaDesk\SakaDesk.exe
)
echo ============================================
echo.
exit /b 0
