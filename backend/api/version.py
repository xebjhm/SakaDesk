"""
Version Check API for SakaDesk.
Checks GitHub releases for updates with caching to respect rate limits.
Also provides in-place upgrade functionality for Windows.
"""

import asyncio
import os
import re

import httpx
import structlog
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel

from backend.services.upgrade_service import (
    GITHUB_REPO,
    get_installer_info,
    download_installer,
    launch_installer,
    cleanup_upgrade_files,
    is_upgrade_supported,
)
from backend.services.shutdown_state import is_shutting_down

from backend.version import APP_VERSION

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/api/version", tags=["version"])

# GitHub API settings (GITHUB_REPO imported from upgrade_service)
GITHUB_API_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"

# Cache settings
CACHE_DURATION = timedelta(hours=1)
ERROR_CACHE_DURATION = timedelta(minutes=5)

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
}


def _parse_version(version_str: str) -> tuple:
    """Parse a version string into a comparable ``(major, minor, patch, rank)``.

    XREPO-10 / SD-BE-API-21: the build tooling explicitly allows suffixed
    versions (e.g. ``0.3.3-hotfix1``, ``v0.4.0-rc1``, ``0.3.2.dev0``). The old
    parser did ``int(p)`` over the dotted parts and collapsed the WHOLE version
    to ``(0, 0, 0)`` on any non-numeric component, so a suffixed release was
    silently never offered (``_is_newer`` -> False) and a suffixed *current*
    version saw every release as an upgrade forever.

    This parses the leading numeric component of each of the first three
    dot-separated fields (so ``0.4.0rc1`` -> patch 0) and appends a
    ``release_rank``: ``1`` for a final release, ``0`` when a pre-release
    suffix is present (``-``, or a PEP 440 ``a``/``b``/``rc``/``.dev`` marker).
    That ranks a pre-release BELOW the same ``X.Y.Z`` final release while
    keeping plain numeric ordering (``0.3.10`` > ``0.3.9``) correct. A tag with
    no leading digits at all is unparseable -> ``(0, 0, 0, 0)`` (never newer)
    and is logged rather than silently swallowed.
    """
    # Remove a leading 'v'/'V' prefix if present.
    v = version_str.lstrip("vV").strip()

    # A pre-release marker anywhere (hyphen, or PEP 440 a/b/rc/dev separators)
    # ranks the version below the same X.Y.Z final release.
    is_prerelease = bool(re.search(r"(-|\.dev|[abc]\d|rc\d)", v, re.IGNORECASE))

    parts = v.split(".")
    nums = []
    for part in parts[:3]:
        m = re.match(r"\d+", part)
        if m is None:
            break
        nums.append(int(m.group()))

    if not nums:
        # No leading numeric component at all — not a usable version.
        logger.warning("Could not parse version string", version=version_str)
        return (0, 0, 0, 0)

    # Pad missing components (e.g. "1" -> (1, 0, 0), "1.2" -> (1, 2, 0)).
    while len(nums) < 3:
        nums.append(0)

    return (nums[0], nums[1], nums[2], 0 if is_prerelease else 1)


def _is_newer(latest: str, current: str) -> bool:
    """Check if latest version is newer than current."""
    return _parse_version(latest) > _parse_version(current)


async def _fetch_latest_release(force: bool = False) -> dict:
    """Fetch latest release from GitHub API.

    force=True skips the cache (used by the manual "Check for updates" action so
    it always does a live fetch). Automatic startup/hourly checks leave it False
    to respect GitHub's unauthenticated rate limit.
    """
    global _cache

    now = datetime.now(timezone.utc)

    # Check cache first — use shorter TTL for errors so transient failures retry
    # sooner. A forced (manual) check bypasses the cache entirely.
    if not force and _cache["last_check"]:
        cache_age = now - _cache["last_check"]
        ttl = ERROR_CACHE_DURATION if _cache["error"] else CACHE_DURATION
        if cache_age < ttl:
            return _cache

    # Fetch from GitHub
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                GITHUB_API_URL,
                headers={
                    "Accept": "application/vnd.github.v3+json",
                    "User-Agent": f"SakaDesk/{APP_VERSION}",
                },
            )

            if response.status_code == 200:
                data = response.json()
                _cache["latest_version"] = data.get("tag_name", "").lstrip("v")
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
async def check_version(force: bool = False):
    """Check for updates from GitHub releases.

    force=true bypasses the 1-hour cache — the manual "Check for updates" button
    uses it so a user-initiated check is always live, while the automatic
    startup/hourly checks stay cached.
    """
    cache = await _fetch_latest_release(force=force)

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

    # C1c: refuse to spawn a NEW writer once shutdown has begun -- the download
    # runs as an untracked background task that streams the installer into
    # get_app_data_dir()/"upgrade" (inside the lock-protected data dir). If
    # started after this point it would still be running (and writing) after
    # quiesce_writers()/data_lock.release(), escaping the barrier entirely.
    # Mirrors the same guard on /api/sync/start and /api/sync/verify.
    if is_shutting_down():
        return {"success": False, "error": "Application is shutting down"}

    if not is_upgrade_supported():
        return {"success": False, "error": "Upgrade not supported on this platform"}

    if _upgrade_state["state"] == "downloading":
        return {"success": False, "error": "Upgrade already in progress"}

    # SD-BE-API-06: claim the "downloading" state SYNCHRONOUSLY, before the first
    # await. The version fetch below awaits a network call (up to 10s); without
    # claiming the state first, two rapid POSTs (double-click / UI retry) both
    # pass the guard above and both schedule a download into the same installer
    # path. We record the state the request started from so we can roll back to
    # exactly that on any early-return error (never clobber a state a concurrent
    # request may have advanced past "downloading").
    _prev_state = dict(_upgrade_state)
    _upgrade_state = {
        "state": "downloading",
        "progress": 0.0,
        "error": None,
        "version": None,
        "installer_path": None,
    }

    def _rollback(error: str) -> dict:
        global _upgrade_state
        # Only roll back if we still own the "downloading" claim we set above --
        # a concurrent cancel/install may have moved the state on.
        if _upgrade_state["state"] == "downloading":
            _upgrade_state = _prev_state
        return {"success": False, "error": error}

    # Get the latest version
    cache = await _fetch_latest_release()
    if cache["error"] or not cache["latest_version"]:
        return _rollback(cache["error"] or "No version available")

    version = cache["latest_version"]

    if not _is_newer(version, APP_VERSION):
        return _rollback("Already up to date")

    # Commit the resolved version into the download state.
    _upgrade_state["version"] = version

    # Start download in background
    background_tasks.add_task(_download_and_prepare_upgrade, version)

    return {"success": True, "message": "Upgrade started", "version": version}


async def _download_and_prepare_upgrade(version: str):
    """Background task to download and verify the installer."""
    global _upgrade_state

    try:
        # Get installer info (URL, size, SHA-256 digest)
        info = await get_installer_info(version)
        if not info:
            _upgrade_state["state"] = "error"
            _upgrade_state["error"] = "Could not find installer for this version"
            return

        # Download with progress tracking
        def progress_callback(downloaded: int, total: int):
            if total > 0:
                _upgrade_state["progress"] = (downloaded / total) * 100

        installer_path = await download_installer(info, progress_callback)

        if not installer_path:
            _upgrade_state["state"] = "error"
            _upgrade_state["error"] = "Failed to download or verify installer"
            return

        _upgrade_state["installer_path"] = installer_path
        _upgrade_state["state"] = "ready"
        _upgrade_state["progress"] = 100.0

        logger.info(f"Upgrade ready: {installer_path}")

    except Exception as e:
        logger.error(f"Upgrade preparation failed: {e}")
        _upgrade_state["state"] = "error"
        _upgrade_state["error"] = str(e)


async def _quiesce_workers_before_exit() -> None:
    """Run the write barrier and kill index-worker children before a hard exit.

    SD-BE-SVC-01: ``/upgrade/install`` hard-exits the parent with ``os._exit(0)``,
    which bypasses the entire lifespan shutdown (write barrier, search-service
    teardown, ``data_lock.release``) AND desktop.py's ``_kill_children`` (that
    only runs after ``webview.start()`` returns). The idle ``ProcessPoolExecutor``
    index-build worker is left orphaned holding ``_internal`` DLLs open; because
    that worker does NOT hold ``SakaDeskInstanceMutex`` (only the parent does),
    the Inno installer sees the mutex released, proceeds, hits the orphan's
    locked DLLs, and the in-place upgrade rolls back.

    Mirror main.py's ordered barrier (begin_shutdown -> quiesce_writers ->
    release) here, then belt-and-suspenders terminate any remaining
    multiprocessing children so the installer never races a live worker. Imports
    are local: ``backend.main`` imports this module at load time, so importing it
    at module top would be circular.
    """
    import multiprocessing

    from backend.services.shutdown_state import begin_shutdown

    # 1. Refuse to spawn any NEW writer (read paths check this flag).
    begin_shutdown()

    # 2. Drain every registered data-dir writer -- this includes
    #    stop_search_service, which terminates+joins the ProcessPoolExecutor
    #    build worker (the process holding _internal DLLs open). Isolate failures
    #    so one hung hook can't skip the child-kill / lock release below.
    try:
        from backend.main import quiesce_writers, data_lock

        await quiesce_writers()
    except Exception as e:  # pragma: no cover - defensive
        logger.error(f"Writer barrier failed before upgrade exit: {e}")
        data_lock = None  # type: ignore[assignment]

    # 3. Belt-and-suspenders: terminate any multiprocessing children still
    #    alive (e.g. a worker not owned by the search executor). Joining them
    #    is what guarantees the installer won't hit a live process holding DLLs.
    try:
        for child in multiprocessing.active_children():
            try:
                child.terminate()
                child.join(timeout=3)
                if child.is_alive():
                    # Survived terminate+join — it may still hold _internal DLLs,
                    # which is exactly what makes the in-place upgrade roll back.
                    # Don't let that happen silently: log it and escalate to kill().
                    logger.error(
                        "child_alive_after_terminate_installer_may_fail",
                        pid=child.pid,
                        name=child.name,
                    )
                    try:
                        child.kill()
                        child.join(timeout=2)
                    except Exception as kill_err:
                        logger.error(
                            "child_kill_failed", pid=child.pid, error=str(kill_err)
                        )
            except Exception as e:
                logger.warning(
                    "child_terminate_failed",
                    pid=getattr(child, "pid", None),
                    error=str(e),
                )
    except Exception as e:  # pragma: no cover - defensive
        logger.error(f"Failed to terminate child processes before exit: {e}")

    # 4. Release the data-dir lock so the incoming (installed) instance can
    #    acquire it immediately on relaunch.
    try:
        if data_lock is not None:
            data_lock.release()
    except Exception as e:  # pragma: no cover - defensive
        logger.error(f"Failed to release data lock before exit: {e}")


@router.post("/upgrade/install")
async def install_upgrade():
    """
    Launch the installer directly.

    Inno Setup handles closing the running app (CloseApplications=yes)
    and relaunching after install ([Run] section).

    Call this only after /upgrade/status shows state="ready".
    """
    global _upgrade_state

    if _upgrade_state["state"] != "ready":
        return {
            "success": False,
            "error": f"Cannot install in state: {_upgrade_state['state']}",
        }

    installer_path = _upgrade_state.get("installer_path")
    if not installer_path or not installer_path.exists():
        return {"success": False, "error": "Installer not found"}

    success = launch_installer(installer_path)

    if success:
        _upgrade_state["state"] = "launching"

        # Schedule hard app exit after a short delay so the response reaches
        # the frontend first. os._exit bypasses finalizers intentionally —
        # sys.exit can hang during async shutdown, and the installer is
        # already waiting to take over the process.
        #
        # SD-BE-SVC-01: run the write barrier + kill the index-worker children
        # BEFORE os._exit, so the installer never races an orphaned worker that
        # still holds _internal DLLs locked (which would roll back the upgrade).
        async def _delayed_exit():
            try:
                await asyncio.sleep(2)
                logger.info("Shutting down for upgrade...")
                await _quiesce_workers_before_exit()
            except Exception as e:
                logger.error(f"Error during delayed exit: {e}")
            finally:
                os._exit(0)

        asyncio.create_task(_delayed_exit())

        return {
            "success": True,
            "message": "Installer launched. The app will close and restart automatically.",
        }
    else:
        _upgrade_state["state"] = "error"
        _upgrade_state["error"] = "Failed to launch installer"
        return {"success": False, "error": "Failed to launch installer"}


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
    }

    return {"success": True, "message": "Upgrade cancelled"}
