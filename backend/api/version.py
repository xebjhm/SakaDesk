"""
Version Check API for SakaDesk.
Checks GitHub releases for updates with caching to respect rate limits.
Also provides in-place upgrade functionality for Windows.
"""
import httpx
import structlog
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel

from backend.services.upgrade_service import (
    get_installer_download_url,
    download_installer,
    generate_upgrade_script,
    launch_upgrade,
    cleanup_upgrade_files,
    is_upgrade_supported,
)

from backend.version import APP_VERSION

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/api/version", tags=["version"])

# GitHub API settings
GITHUB_REPO = "xebjhm/SakaDesk"
GITHUB_API_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"

# Cache settings - check at most once per hour
CACHE_DURATION = timedelta(hours=1)

# In-memory cache
_cache: dict = {
    "last_check": None,
    "latest_version": None,
    "release_url": None,
    "release_notes": None,
    "error": None,
}


class VersionInfo(BaseModel):
    """Current and latest version information."""
    current_version: str
    latest_version: Optional[str] = None
    update_available: bool = False
    release_url: Optional[str] = None
    release_notes: Optional[str] = None
    last_checked: Optional[str] = None
    error: Optional[str] = None
    upgrade_supported: bool = False


class UpgradeStatus(BaseModel):
    """Status of an ongoing upgrade operation."""
    state: str  # idle, downloading, ready, launching, error
    progress: float = 0.0  # 0-100 for download progress
    error: Optional[str] = None
    version: Optional[str] = None


# Upgrade state tracking
_upgrade_state: dict = {
    "state": "idle",
    "progress": 0.0,
    "error": None,
    "version": None,
    "installer_path": None,
    "script_path": None,
}


def _parse_version(version_str: str) -> tuple:
    """Parse version string like 'v0.1.0' or '0.1.0' into tuple for comparison."""
    # Remove 'v' prefix if present
    v = version_str.lstrip('v')
    try:
        parts = v.split('.')
        return tuple(int(p) for p in parts[:3])
    except (ValueError, IndexError):
        return (0, 0, 0)


def _is_newer(latest: str, current: str) -> bool:
    """Check if latest version is newer than current."""
    return _parse_version(latest) > _parse_version(current)


async def _fetch_latest_release() -> dict:
    """Fetch latest release from GitHub API."""
    global _cache

    now = datetime.now(timezone.utc)

    # Check cache first
    if _cache["last_check"]:
        cache_age = now - _cache["last_check"]
        if cache_age < CACHE_DURATION:
            return _cache

    # Fetch from GitHub
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                GITHUB_API_URL,
                headers={
                    "Accept": "application/vnd.github.v3+json",
                    "User-Agent": f"SakaDesk/{APP_VERSION}"
                }
            )

            if response.status_code == 200:
                data = response.json()
                _cache["latest_version"] = data.get("tag_name", "").lstrip('v')
                _cache["release_url"] = data.get("html_url")
                _cache["release_notes"] = data.get("body", "")[:500]  # Truncate
                _cache["error"] = None
            elif response.status_code == 404:
                _cache["error"] = "No releases found"
            elif response.status_code == 403:
                _cache["error"] = "Rate limited - try again later"
            else:
                _cache["error"] = f"GitHub API error: {response.status_code}"

    except httpx.TimeoutException:
        _cache["error"] = "Request timed out"
    except Exception as e:
        _cache["error"] = f"Failed to check: {str(e)}"

    _cache["last_check"] = now
    return _cache


@router.get("", response_model=VersionInfo)
async def check_version():
    """Check for updates from GitHub releases."""
    cache = await _fetch_latest_release()

    update_available = False
    if cache["latest_version"] and not cache["error"]:
        update_available = _is_newer(cache["latest_version"], APP_VERSION)

    return VersionInfo(
        current_version=APP_VERSION,
        latest_version=cache["latest_version"],
        update_available=update_available,
        release_url=cache["release_url"],
        release_notes=cache["release_notes"],
        last_checked=cache["last_check"].isoformat() if cache["last_check"] else None,
        error=cache["error"],
        upgrade_supported=is_upgrade_supported(),
    )


@router.get("/current")
async def get_current_version():
    """Get current app version without checking for updates."""
    return {"version": APP_VERSION}


@router.get("/upgrade/status", response_model=UpgradeStatus)
async def get_upgrade_status():
    """Get the current status of an ongoing upgrade operation."""
    return UpgradeStatus(
        state=_upgrade_state["state"],
        progress=_upgrade_state["progress"],
        error=_upgrade_state["error"],
        version=_upgrade_state["version"],
    )


@router.post("/upgrade/start")
async def start_upgrade(background_tasks: BackgroundTasks):
    """
    Start the upgrade process.

    This will:
    1. Fetch the download URL for the latest version
    2. Download the installer in the background
    3. Return immediately with status "downloading"

    Poll /upgrade/status to check progress.
    """
    global _upgrade_state

    if not is_upgrade_supported():
        return {"success": False, "error": "Upgrade not supported on this platform"}

    if _upgrade_state["state"] == "downloading":
        return {"success": False, "error": "Upgrade already in progress"}

    # Get the latest version
    cache = await _fetch_latest_release()
    if cache["error"] or not cache["latest_version"]:
        return {"success": False, "error": cache["error"] or "No version available"}

    version = cache["latest_version"]

    # Reset state
    _upgrade_state = {
        "state": "downloading",
        "progress": 0.0,
        "error": None,
        "version": version,
        "installer_path": None,
        "script_path": None,
    }

    # Start download in background
    background_tasks.add_task(_download_and_prepare_upgrade, version)

    return {"success": True, "message": "Upgrade started", "version": version}


async def _download_and_prepare_upgrade(version: str):
    """Background task to download installer and prepare upgrade."""
    global _upgrade_state

    try:
        # Get download URL
        url = await get_installer_download_url(version)
        if not url:
            _upgrade_state["state"] = "error"
            _upgrade_state["error"] = "Could not find installer for this version"
            return

        # Download with progress tracking
        def progress_callback(downloaded: int, total: int):
            if total > 0:
                _upgrade_state["progress"] = (downloaded / total) * 100

        installer_path = await download_installer(url, progress_callback)

        if not installer_path:
            _upgrade_state["state"] = "error"
            _upgrade_state["error"] = "Failed to download installer"
            return

        # Generate upgrade script
        script_path = generate_upgrade_script(installer_path)

        _upgrade_state["installer_path"] = installer_path
        _upgrade_state["script_path"] = script_path
        _upgrade_state["state"] = "ready"
        _upgrade_state["progress"] = 100.0

        logger.info(f"Upgrade ready: {installer_path}")

    except Exception as e:
        logger.error(f"Upgrade preparation failed: {e}")
        _upgrade_state["state"] = "error"
        _upgrade_state["error"] = str(e)


@router.post("/upgrade/launch")
async def launch_upgrade_process():
    """
    Launch the upgrade process.

    This will:
    1. Launch the upgrade script
    2. Return success - the app should then exit
    3. The upgrade script will wait for app to close, then run installer

    Call this only after /upgrade/status shows state="ready".
    """
    global _upgrade_state

    if _upgrade_state["state"] != "ready":
        return {
            "success": False,
            "error": f"Cannot launch upgrade in state: {_upgrade_state['state']}",
        }

    script_path = _upgrade_state.get("script_path")
    if not script_path or not script_path.exists():
        return {"success": False, "error": "Upgrade script not found"}

    success = launch_upgrade(script_path)

    if success:
        _upgrade_state["state"] = "launching"
        return {
            "success": True,
            "message": "Upgrade launched. Please close the application to complete the upgrade.",
        }
    else:
        _upgrade_state["state"] = "error"
        _upgrade_state["error"] = "Failed to launch upgrade script"
        return {"success": False, "error": "Failed to launch upgrade script"}


@router.post("/upgrade/cancel")
async def cancel_upgrade():
    """Cancel an ongoing upgrade and clean up files."""
    global _upgrade_state

    cleanup_upgrade_files()

    _upgrade_state = {
        "state": "idle",
        "progress": 0.0,
        "error": None,
        "version": None,
        "installer_path": None,
        "script_path": None,
    }

    return {"success": True, "message": "Upgrade cancelled"}
