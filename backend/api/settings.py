"""
Settings API for SakaDesk
Handles output folder configuration and auto-sync settings.
Uses platform-appropriate paths for Windows deployment.
"""

import json
import structlog
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any, Optional

from backend.services.platform import (
    get_settings_path,
    get_default_output_dir as _platform_default_output_dir,
)
from backend.services.service_utils import (
    validate_service,
)
from backend.services.notification_service import set_notifications_enabled
from backend.services.settings_store import (
    load_config as _store_load,
    update_config as _store_update,
)

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])

# Get settings file path from platform utilities
SETTINGS_FILE = get_settings_path()


def get_default_output_dir() -> str:
    """Returns the default output directory path."""
    return str(_platform_default_output_dir())


# ---------------------------------------------------------------------------
# Backward-compatible sync helpers (used by tests that patch SETTINGS_FILE).
# Production code should use the async _store_* functions instead.
# ---------------------------------------------------------------------------


def load_config() -> dict[str, Any]:
    """Load configuration from file (sync, for tests only)."""
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                result: dict[str, Any] = json.load(f)
                logger.debug(
                    "Settings loaded",
                    settings_file=str(SETTINGS_FILE),
                    keys=list(result.keys()),
                    is_configured=result.get("is_configured"),
                )
                return result
        except Exception as e:
            logger.error(
                "Failed to load settings",
                settings_file=str(SETTINGS_FILE),
                error=str(e),
            )
    return {}


def save_config(config: dict):
    """Save configuration to file (sync, for tests only)."""
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)
    logger.debug(
        "Settings saved",
        settings_file=str(SETTINGS_FILE),
        keys=list(config.keys()),
        is_configured=config.get("is_configured"),
    )


class SettingsResponse(BaseModel):
    output_dir: str
    auto_sync_enabled: bool
    sync_interval_minutes: int
    adaptive_sync_enabled: bool = True  # Randomize intervals based on activity patterns
    is_configured: bool  # True if user has set up the app
    user_nickname: Optional[str] = (
        None  # User's nickname for %%% placeholder replacement (legacy)
    )
    user_nicknames: Optional[dict[str, str]] = (
        None  # Per-service nicknames for %%% placeholder replacement
    )
    notifications_enabled: bool = True  # Desktop notifications for new messages
    blogs_full_backup: bool = False  # Global blog full backup — applies to all services
    language: Optional[str] = None  # UI language set by installer or user
    auto_download_updates: bool = False  # Auto-download new versions in background
    sync_read_to_phone: bool = (
        False  # Opt-in: opening a chat here clears its unread on the official app
    )


class SettingsUpdate(BaseModel):
    output_dir: Optional[str] = None
    auto_sync_enabled: Optional[bool] = None
    sync_interval_minutes: Optional[int] = None
    adaptive_sync_enabled: Optional[bool] = None
    notifications_enabled: Optional[bool] = None
    blogs_full_backup: Optional[bool] = None
    auto_download_updates: Optional[bool] = None
    sync_read_to_phone: Optional[bool] = None


class FreshCheckResponse(BaseModel):
    is_fresh: bool  # True if output folder is empty or doesn't exist
    output_dir: str


class ServiceSettings(BaseModel):
    """Per-service settings model."""

    sync_enabled: bool = True
    adaptive_sync_enabled: bool = True
    last_sync: Optional[str] = None
    blogs_full_backup: bool = False


@router.get("", response_model=SettingsResponse)
async def get_settings():
    """Get current settings."""
    config = await _store_load()
    output_dir = config.get("output_dir", get_default_output_dir())

    # Sync notification service state with persisted setting
    set_notifications_enabled(config["notifications_enabled"])

    return SettingsResponse(
        output_dir=output_dir,
        auto_sync_enabled=config["auto_sync_enabled"],
        sync_interval_minutes=config["sync_interval_minutes"],
        adaptive_sync_enabled=config["adaptive_sync_enabled"],
        is_configured=config["is_configured"],
        user_nickname=config.get("user_nickname"),
        user_nicknames=config.get("user_nicknames"),
        notifications_enabled=config["notifications_enabled"],
        blogs_full_backup=config["blogs_full_backup"],
        language=config.get("language"),
        auto_download_updates=config["auto_download_updates"],
        sync_read_to_phone=config.get("sync_read_to_phone", False),
    )


@router.post("", response_model=SettingsResponse)
async def update_settings(update: SettingsUpdate):
    """Update settings."""

    def _apply(config: dict) -> None:
        if update.output_dir is not None:
            config["output_dir"] = update.output_dir
            config["is_configured"] = True
        if update.auto_sync_enabled is not None:
            config["auto_sync_enabled"] = update.auto_sync_enabled
        if update.sync_interval_minutes is not None:
            config["sync_interval_minutes"] = update.sync_interval_minutes
        if update.adaptive_sync_enabled is not None:
            config["adaptive_sync_enabled"] = update.adaptive_sync_enabled
        if update.notifications_enabled is not None:
            config["notifications_enabled"] = update.notifications_enabled
            set_notifications_enabled(update.notifications_enabled)
        if update.blogs_full_backup is not None:
            config["blogs_full_backup"] = update.blogs_full_backup
        if update.auto_download_updates is not None:
            config["auto_download_updates"] = update.auto_download_updates
        if update.sync_read_to_phone is not None:
            config["sync_read_to_phone"] = update.sync_read_to_phone

    config = await _store_update(_apply)

    return SettingsResponse(
        output_dir=config.get("output_dir", get_default_output_dir()),
        auto_sync_enabled=config["auto_sync_enabled"],
        sync_interval_minutes=config["sync_interval_minutes"],
        adaptive_sync_enabled=config["adaptive_sync_enabled"],
        is_configured=config["is_configured"],
        user_nickname=config.get("user_nickname"),
        user_nicknames=config.get("user_nicknames"),
        notifications_enabled=config["notifications_enabled"],
        blogs_full_backup=config["blogs_full_backup"],
        language=config.get("language"),
        auto_download_updates=config["auto_download_updates"],
        sync_read_to_phone=config.get("sync_read_to_phone", False),
    )


@router.get("/fresh", response_model=FreshCheckResponse)
async def check_fresh_install():
    """Check if output folder is empty (fresh install)."""
    config = await _store_load()
    output_dir = config.get("output_dir", get_default_output_dir())
    output_path = Path(output_dir)

    # Fresh if: doesn't exist, is empty, or only has sync_metadata.json
    is_fresh = True
    if output_path.exists():
        contents = list(output_path.iterdir())
        # Filter out metadata files
        data_contents = [
            c for c in contents if c.name not in ("sync_metadata.json", ".gitkeep")
        ]
        is_fresh = len(data_contents) == 0

    return FreshCheckResponse(is_fresh=is_fresh, output_dir=output_dir)


def _pywebview_pick_folder() -> Optional[str]:
    """Open a folder picker via the pywebview window, if one is running.

    pywebview's ``create_file_dialog`` marshals to the GUI (main) thread
    internally, so it is safe to call from an executor thread — unlike raw
    ``tk.Tk()``, which requires the main thread on macOS. Returns the selected
    path, or None if no folder was chosen. Raises RuntimeError when no pywebview
    window is available so the caller can fall back.
    """
    try:
        import webview
    except ImportError as e:
        raise RuntimeError(f"pywebview not available: {e}")

    if not getattr(webview, "windows", None):
        raise RuntimeError("No pywebview window available")

    window = webview.windows[0]
    result = window.create_file_dialog(webview.FOLDER_DIALOG)
    # create_file_dialog returns a tuple/list of paths, or None on cancel.
    if result:
        return result[0] if isinstance(result, (list, tuple)) else str(result)
    return None


def _tk_pick_folder() -> Optional[str]:
    """Open a tkinter folder dialog. Runs in an executor thread.

    NOTE: tkinter must run on the main thread on macOS; callers must not use
    this off-main-thread on Darwin (see select_folder).
    """
    import tkinter as tk
    from tkinter import filedialog

    try:
        root = tk.Tk()
        root.withdraw()  # Hide the main window
        root.attributes("-topmost", True)  # Bring to front

        folder = filedialog.askdirectory(title="Select Output Folder")
        root.destroy()
        return folder if folder else None
    except Exception as e:
        logger.error(f"Dialog error: {e}")
        return None


@router.post("/select-folder")
async def select_folder():
    """Open a native folder picker dialog.

    Prefers the pywebview main-thread dialog API (works on all platforms,
    including macOS). Falls back to a tkinter dialog only where that is safe:
    tkinter's ``tk.Tk()`` crashes/hangs when created off the main thread on
    macOS, so on macOS without a pywebview window we return a clear error
    instead of triggering that crash.
    """
    import asyncio
    import sys

    # Timeout after 5 minutes (user should have selected a folder by then)
    DIALOG_TIMEOUT_SECONDS = 300
    loop = asyncio.get_event_loop()

    # Preferred path: pywebview's dialog (safe on the GUI thread on every OS).
    try:
        result = await asyncio.wait_for(
            loop.run_in_executor(None, _pywebview_pick_folder),
            timeout=DIALOG_TIMEOUT_SECONDS,
        )
        return {"path": result} if result else {"path": None}
    except asyncio.TimeoutError:
        logger.warning("Folder dialog timed out after 5 minutes")
        return {"path": None, "error": "Dialog timed out"}
    except RuntimeError as e:
        # No pywebview window — fall through to the tkinter fallback below.
        logger.debug(f"pywebview folder dialog unavailable: {e}")

    # Fallback: tkinter. Creating tk.Tk() off the main thread crashes on macOS,
    # so guard against it rather than hang/crash the process.
    if sys.platform == "darwin":
        logger.warning(
            "Folder picker unavailable: no pywebview window and tkinter is "
            "unsafe off the main thread on macOS"
        )
        return {
            "path": None,
            "error": "Folder picker not available on macOS outside the app window",
        }

    try:
        import tkinter  # noqa: F401
    except ImportError as e:
        logger.warning(f"Tkinter not available: {e}")
        return {"path": None, "error": "Folder picker not available (tkinter missing)"}

    try:
        result = await asyncio.wait_for(
            loop.run_in_executor(None, _tk_pick_folder),
            timeout=DIALOG_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        logger.warning("Folder dialog timed out after 5 minutes")
        return {"path": None, "error": "Dialog timed out"}
    except Exception as e:
        logger.error(f"Executor error: {e}")
        return {"path": None, "error": str(e)}

    if result:
        return {"path": result}
    return {"path": None}


def _service_settings_response(stored: dict) -> "ServiceSettings":
    """Build a ServiceSettings from stored per-service config."""
    return ServiceSettings(
        sync_enabled=stored.get("sync_enabled", True),
        adaptive_sync_enabled=stored.get("adaptive_sync_enabled", True),
        last_sync=stored.get("last_sync"),
        blogs_full_backup=stored.get("blogs_full_backup", False),
    )


@router.get("/service/{service}", response_model=ServiceSettings)
async def get_service_settings(service: str):
    """Get settings for a specific service."""
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    config = await _store_load()
    service_config = config.get("services", {}).get(service, {})
    return _service_settings_response(service_config)


@router.post("/service/{service}", response_model=ServiceSettings)
async def update_service_settings(service: str, update: ServiceSettings):
    """Update settings for a specific service."""
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    def _apply(config: dict) -> None:
        config.setdefault("services", {}).setdefault(service, {})
        config["services"][service].update(
            {
                "sync_enabled": update.sync_enabled,
                "adaptive_sync_enabled": update.adaptive_sync_enabled,
                "last_sync": update.last_sync,
                "blogs_full_backup": update.blogs_full_backup,
            }
        )

    config = await _store_update(_apply)
    return _service_settings_response(config["services"][service])


@router.post("/service/{service}/init", response_model=ServiceSettings)
async def init_service_settings(service: str):
    """Initialize settings for a newly connected service.

    Called after successful login to ensure the service has an entry in settings.
    Uses default values if not already configured.
    """
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    initialized = False

    def _apply(config: dict) -> None:
        nonlocal initialized
        if "services" not in config:
            config["services"] = {}
        # Only initialize if not already configured
        if service not in config["services"]:
            config["services"][service] = {
                "sync_enabled": True,
                "adaptive_sync_enabled": True,
                "last_sync": None,
                "blogs_full_backup": False,
            }
            initialized = True

    config = await _store_update(_apply)

    if initialized:
        logger.info(f"Initialized settings for newly connected service: {service}")

    return _service_settings_response(config["services"][service])
