"""
In-place Upgrade Service for ZakaDesk.

Handles downloading new versions and triggering the upgrade process on Windows.
The upgrade flow:
1. Download new installer to temp directory
2. Generate a batch script that waits for app to close and runs installer
3. App spawns the upgrade script and exits
4. Upgrade script takes over, runs installer, cleans up
"""

import structlog
import subprocess
import sys
from pathlib import Path
from typing import Optional, cast
import httpx

from backend.services.platform import is_windows, get_app_data_dir

logger = structlog.get_logger(__name__)

# GitHub release asset pattern
GITHUB_REPO = "xebjhm/ZakaDesk"


def _installer_asset_name(version: str) -> str:
    """Build expected installer filename for a given version.

    Matches Inno Setup OutputBaseFilename: ZakaDesk-{version}-Setup
    """
    bare = version.lstrip("v")
    return f"ZakaDesk-{bare}-Setup.exe"


async def get_installer_download_url(version: str) -> Optional[str]:
    """
    Get the download URL for the installer of a specific version.

    Args:
        version: Version tag (e.g., "v0.2.0" or "0.2.0")

    Returns:
        Download URL for the installer, or None if not found
    """
    expected_name = _installer_asset_name(version)

    # Ensure version has 'v' prefix for GitHub tag
    tag = version if version.startswith("v") else f"v{version}"

    api_url = f"https://api.github.com/repos/{GITHUB_REPO}/releases/tags/{tag}"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                api_url,
                headers={
                    "Accept": "application/vnd.github.v3+json",
                    "User-Agent": "ZakaDesk-Updater",
                },
            )

            if response.status_code != 200:
                logger.error(f"Failed to fetch release info: {response.status_code}")
                return None

            data = response.json()
            assets = data.get("assets", [])

            # Find the installer asset (case-insensitive for robustness)
            for asset in assets:
                name = asset.get("name", "")
                if name == expected_name or name.lower() == expected_name.lower():
                    return cast(Optional[str], asset.get("browser_download_url"))

            logger.error(f"Installer asset '{expected_name}' not found in release")
            return None

    except Exception as e:
        logger.error(f"Error fetching installer URL: {e}")
        return None


async def download_installer(url: str, progress_callback=None) -> Optional[Path]:
    """
    Download the installer to a temp directory.

    Args:
        url: Download URL for the installer
        progress_callback: Optional callback(downloaded_bytes, total_bytes)

    Returns:
        Path to downloaded installer, or None on failure
    """
    # Create temp directory in app data (survives reboot better than system temp)
    upgrade_dir = cast(Path, get_app_data_dir() / "upgrade")
    upgrade_dir.mkdir(parents=True, exist_ok=True)

    # Use filename from URL (e.g., ZakaDesk-0.2.0-Setup.exe)
    filename = url.rsplit("/", 1)[-1] if "/" in url else "ZakaDesk-Setup.exe"
    installer_path = upgrade_dir / filename

    try:
        async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
            async with client.stream("GET", url) as response:
                if response.status_code != 200:
                    logger.error(f"Download failed with status: {response.status_code}")
                    return None

                total = int(response.headers.get("content-length", 0))
                downloaded = 0

                with open(installer_path, "wb") as f:
                    async for chunk in response.aiter_bytes(chunk_size=8192):
                        f.write(chunk)
                        downloaded += len(chunk)
                        if progress_callback:
                            progress_callback(downloaded, total)

        logger.info(f"Installer downloaded to: {installer_path}")
        return installer_path

    except Exception as e:
        logger.error(f"Error downloading installer: {e}")
        # Clean up partial download
        if installer_path.exists():
            installer_path.unlink()
        return None


def generate_upgrade_script(installer_path: Path) -> Path:
    """
    Generate a batch script that handles the upgrade process.

    The script:
    1. Waits for ZakaDesk to close
    2. Runs the installer silently
    3. Cleans up the upgrade files
    4. Optionally restarts the app

    Args:
        installer_path: Path to the downloaded installer

    Returns:
        Path to the generated upgrade script
    """
    upgrade_dir = installer_path.parent
    script_path = upgrade_dir / "upgrade.bat"

    # Get the current executable path for restart
    if getattr(sys, "frozen", False):
        app_exe = Path(sys.executable)
    else:
        app_exe = Path(sys.executable)  # Python interpreter in dev mode

    script_content = f'''@echo off
setlocal

:: ZakaDesk Upgrade Script
:: Generated automatically - do not edit

echo ZakaDesk Upgrade in Progress...
echo.

:: Wait for the app to close (check every second, max 30 seconds)
set /a attempts=0
:waitloop
tasklist /fi "imagename eq ZakaDesk.exe" 2>nul | find /i "ZakaDesk.exe" >nul
if errorlevel 1 goto :install
set /a attempts+=1
if %attempts% geq 30 (
    echo Warning: ZakaDesk did not close in time. Attempting to continue...
    goto :install
)
timeout /t 1 /nobreak >nul
goto :waitloop

:install
echo Installing update...

:: Run the installer silently
:: /VERYSILENT = no UI at all
:: /SUPPRESSMSGBOXES = no message boxes
:: /NORESTART = don't restart Windows
:: /CLOSEAPPLICATIONS = close running apps
"{installer_path}" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS

if errorlevel 1 (
    echo.
    echo ERROR: Installation failed with code %errorlevel%
    echo Press any key to exit...
    pause >nul
    goto :cleanup
)

echo.
echo Update installed successfully!

:: Launch the updated app
echo Starting ZakaDesk...
start "" "{app_exe}"

:cleanup
:: Clean up upgrade files (after a short delay to ensure installer is done)
timeout /t 2 /nobreak >nul
del /q "{installer_path}" 2>nul
del /q "%~f0" 2>nul

endlocal
'''

    with open(script_path, "w", encoding="utf-8") as f:
        f.write(script_content)

    logger.info(f"Upgrade script generated: {script_path}")
    return script_path


def launch_upgrade(script_path: Path) -> bool:
    """
    Launch the upgrade script and prepare for app exit.

    The script runs in a new process that's detached from the current app,
    so it can continue after ZakaDesk exits.

    Args:
        script_path: Path to the upgrade batch script

    Returns:
        True if script was launched successfully
    """
    if not is_windows():
        logger.error("In-place upgrade only supported on Windows")
        return False

    if not script_path.exists():
        logger.error(f"Upgrade script not found: {script_path}")
        return False

    try:
        # Use START to launch in a new window, detached from parent
        # /MIN = start minimized (user sees progress)
        # Note: DETACHED_PROCESS and CREATE_NEW_PROCESS_GROUP are Windows-only flags
        subprocess.Popen(
            ["cmd", "/c", "start", "/MIN", "ZakaDesk Upgrade", str(script_path)],
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,  # type: ignore[attr-defined]
            close_fds=True,
        )

        logger.info("Upgrade script launched successfully")
        return True

    except Exception as e:
        logger.error(f"Failed to launch upgrade script: {e}")
        return False


def cleanup_upgrade_files():
    """Clean up any leftover upgrade files from a previous upgrade attempt."""
    upgrade_dir = get_app_data_dir() / "upgrade"
    if upgrade_dir.exists():
        try:
            import shutil
            shutil.rmtree(upgrade_dir)
            logger.info("Cleaned up upgrade directory")
        except Exception as e:
            logger.warning(f"Failed to clean up upgrade directory: {e}")


def is_upgrade_supported() -> bool:
    """Check if in-place upgrade is supported on this platform."""
    return cast(bool, is_windows())
