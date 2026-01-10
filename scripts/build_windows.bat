@echo off
REM HakoDesk Windows Build and Test Script
REM Run this from Windows (double-click or cmd.exe)
REM Works from any location - auto-detects project path

REM Get the directory where this script is located
set SCRIPT_DIR=%~dp0
set PROJECT_DIR=%SCRIPT_DIR%..
set BUILD_DIR=%PROJECT_DIR%\dist

echo ============================================
echo  HakoDesk Windows Build ^& Test
echo ============================================
echo.

REM Check if uv is installed
where uv >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: uv not found. Install from: https://docs.astral.sh/uv/
    pause
    exit /b 1
)

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
set WORKSPACE_ROOT=%TEMP%\HakoDesk_Workspace
set WORKSPACE_APP=%WORKSPACE_ROOT%\HakoDesk
set WORKSPACE_LIB=%WORKSPACE_ROOT%\PyHako

if exist "%WORKSPACE_ROOT%" rmdir /s /q "%WORKSPACE_ROOT%"
mkdir "%WORKSPACE_ROOT%"

@REM Robocopy flags:
@REM /E - recursive, /XD - exclude dirs, /R:1 /W:1 - retry once wait 1s
@REM Exclude: .venv, dist, build, .git, auth_data, output, __pycache__, .pytest_cache

echo      Copying HakoDesk to workspace...
robocopy "%PROJECT_DIR%" "%WORKSPACE_APP%" /E /XD .venv dist build .git auth_data output __pycache__ .pytest_cache .idea .vscode node_modules /R:1 /W:1 /NFL /NDL /NJH /NJS
if %ERRORLEVEL% geq 8 (
    echo ERROR: Robocopy failed for HakoDesk
    pause
    exit /b 1
)

echo      Copying PyHako (dependency) to workspace...
robocopy "%PROJECT_DIR%\..\PyHako" "%WORKSPACE_LIB%" /E /XD .venv dist build .git auth_data output __pycache__ .pytest_cache .idea .vscode /R:1 /W:1 /NFL /NDL /NJH /NJS
if %ERRORLEVEL% geq 8 (
    echo ERROR: Robocopy failed for PyHako
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
copy /Y "%WORKSPACE_APP%\dist\hakodesk-setup.exe" "%BUILD_DIR%\" >nul 2>&1
if exist "%BUILD_DIR%\hakodesk-setup.exe" (
    echo      Installer copied to %BUILD_DIR%
) else (
    echo      WARNING: Installer not found, copying raw build...
    xcopy /E /Y "%WORKSPACE_APP%\dist\HakoDesk\*" "%BUILD_DIR%\HakoDesk\" >nul
)

popd

echo.
echo ============================================
echo  Build complete!
if exist "%BUILD_DIR%\hakodesk-setup.exe" (
    echo  Installer: %BUILD_DIR%\hakodesk-setup.exe
) else (
    echo  Executable: %BUILD_DIR%\HakoDesk\HakoDesk.exe
)
echo ============================================
echo.
exit /b 0
