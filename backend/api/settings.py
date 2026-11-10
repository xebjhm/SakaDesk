"""
Settings API for SakaDesk
Handles output folder configuration and auto-sync settings.
Uses platform-appropriate paths for Windows deployment.
"""

import asyncio
import json
import sys
import structlog
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Any, Optional

from backend.services.platform import (
    get_settings_path,
    get_default_output_dir as _platform_default_output_dir,
)
from backend.services.service_utils import (
    validate_service,
)
from backend.services import app_state, autostart, desktop_bridge
from backend.services.memories import notify_scheduler
from backend.services.auto_sync_scheduler import wake_scheduler
from backend.services.call_popup import get_call_popup_controller
from backend.services.notification_service import set_notifications_enabled
from backend.services.settings_store import (
    MEMORIES_NOTIFY_TIME_DEFAULT,
    resolve_memories_notify_time,
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
    oshi_members: Optional[dict[str, list[str]]] = (
        None  # Per-service oshi blog member ids, mirrored from the frontend
    )
    notifications_enabled: bool = True  # Desktop notifications for new messages
    notifications_hide_content: bool = (
        False  # Toasts show a generic body instead of the message preview
    )
    blogs_full_backup: bool = False  # Global blog full backup — applies to all services
    language: Optional[str] = None  # UI language set by installer or user
    auto_download_updates: bool = False  # Auto-download new versions in background
    sync_read_to_phone: bool = (
        False  # Opt-in: opening a chat here clears its unread on the official app
    )
    incoming_call_enabled: bool = (
        True  # Ring when opening a 1:1 chat whose newest voice is unheard
    )
    call_popup_enabled: bool = (
        True  # Ring a background call in a bottom-right popup (app not in front)
    )
    close_to_tray: bool = True  # Closing the window hides it to the tray
    autostart: bool = False  # Start at Windows sign-in, hidden in the tray
    # Memories notifications (spec 15)
    memories_notify_on_this_day: bool = True
    memories_notify_birthday: bool = True
    memories_notify_anniversary: bool = True
    memories_notify_recap: bool = True
    memories_notify_cards: bool = False
    memories_notify_time: str = MEMORIES_NOTIFY_TIME_DEFAULT  # JST "HH:MM"


class SettingsUpdate(BaseModel):
    output_dir: Optional[str] = None
    auto_sync_enabled: Optional[bool] = None
    # SD-BE-API-22: reject a zero/negative interval. A non-positive value was
    # accepted, persisted, and echoed by /api/sync/next_interval, driving the
    # auto-sync scheduler into an immediate-retry loop against the official API
    # (rate-limit / account-flag risk).
    sync_interval_minutes: Optional[int] = Field(default=None, ge=1)
    adaptive_sync_enabled: Optional[bool] = None
    notifications_enabled: Optional[bool] = None
    notifications_hide_content: Optional[bool] = None
    blogs_full_backup: Optional[bool] = None
    auto_download_updates: Optional[bool] = None
    sync_read_to_phone: Optional[bool] = None
    incoming_call_enabled: Optional[bool] = None
    call_popup_enabled: Optional[bool] = None
    close_to_tray: Optional[bool] = None
    autostart: Optional[bool] = None
    oshi_members: Optional[dict[str, list[str]]] = None
    memories_notify_on_this_day: Optional[bool] = None
    memories_notify_birthday: Optional[bool] = None
    memories_notify_anniversary: Optional[bool] = None
    memories_notify_recap: Optional[bool] = None
    memories_notify_cards: Optional[bool] = None
    # JST "HH:MM", 00:00-23:59 in ASCII digits ([0-9], not the Unicode \d);
    # anything else is a 422.
    memories_notify_time: Optional[str] = Field(
        default=None, pattern=r"^([01][0-9]|2[0-3]):[0-5][0-9]$"
    )


class FreshCheckResponse(BaseModel):
    is_fresh: bool  # True if output folder is empty or doesn't exist
    output_dir: str


class ServiceSettings(BaseModel):
    """Per-service settings model."""

    sync_enabled: bool = True
    adaptive_sync_enabled: bool = True
    last_sync: Optional[str] = None
    blogs_full_backup: bool = False


# Settings that change when the auto-sync scheduler should next run.
_SCHEDULE_KEYS = ("auto_sync_enabled", "sync_interval_minutes", "adaptive_sync_enabled")

# Settings that change what / when the Memories notify scheduler delivers.
_MEMORIES_NOTIFY_KEYS = (
    "memories_notify_on_this_day",
    "memories_notify_birthday",
    "memories_notify_anniversary",
    "memories_notify_recap",
    "memories_notify_cards",
    "memories_notify_time",
)


def _settings_response(config: dict[str, Any]) -> SettingsResponse:
    """Build the response from a loaded config (defaults already merged)."""
    return SettingsResponse(
        output_dir=config.get("output_dir", get_default_output_dir()),
        auto_sync_enabled=config["auto_sync_enabled"],
        sync_interval_minutes=config["sync_interval_minutes"],
        adaptive_sync_enabled=config["adaptive_sync_enabled"],
        is_configured=config["is_configured"],
        user_nickname=config.get("user_nickname"),
        user_nicknames=config.get("user_nicknames"),
        oshi_members=config.get("oshi_members"),
        notifications_enabled=config["notifications_enabled"],
        notifications_hide_content=config.get("notifications_hide_content", False),
        blogs_full_backup=config["blogs_full_backup"],
        language=config.get("language"),
        auto_download_updates=config["auto_download_updates"],
        sync_read_to_phone=config.get("sync_read_to_phone", False),
        incoming_call_enabled=config.get("incoming_call_enabled", True),
        call_popup_enabled=config.get("call_popup_enabled", True),
        close_to_tray=config.get("close_to_tray", True),
        autostart=config.get("autostart", False),
        memories_notify_on_this_day=config.get("memories_notify_on_this_day", True),
        memories_notify_birthday=config.get("memories_notify_birthday", True),
        memories_notify_anniversary=config.get("memories_notify_anniversary", True),
        memories_notify_recap=config.get("memories_notify_recap", True),
        memories_notify_cards=config.get("memories_notify_cards", False),
        memories_notify_time=resolve_memories_notify_time(
            config.get("memories_notify_time", MEMORIES_NOTIFY_TIME_DEFAULT)
        ),
    )


async def _apply_autostart(enabled: bool) -> None:
    """Sync the Windows Run value with the saved setting, off the event loop.

    ``autostart.apply`` never raises and logs its own outcome; the guard here
    only keeps an unexpected error from failing a settings update that was
    already saved.
    """
    try:
        await asyncio.to_thread(
            autostart.apply,
            enabled,
            frozen=bool(getattr(sys, "frozen", False)),
            exe=Path(sys.executable),
        )
    except Exception as e:
        logger.warning("autostart", action="failed", error_type=type(e).__name__)


@router.get("", response_model=SettingsResponse)
async def get_settings():
    """Get current settings."""
    config = await _store_load()

    # Sync notification service state with persisted setting
    set_notifications_enabled(config["notifications_enabled"])

    return _settings_response(config)


@router.post("", response_model=SettingsResponse)
async def update_settings(update: SettingsUpdate):
    """Update settings."""
    autostart_change: Optional[bool] = None
    call_popup_change: Optional[bool] = None
    schedule_changed = False
    memories_notify_changed = False
    cards_enabled = False

    def _apply(config: dict) -> None:
        nonlocal autostart_change, call_popup_change, schedule_changed
        nonlocal memories_notify_changed, cards_enabled
        before = tuple(config.get(key) for key in _SCHEDULE_KEYS)
        notify_before = tuple(config.get(key) for key in _MEMORIES_NOTIFY_KEYS)
        cards_before = bool(config.get("memories_notify_cards", False))
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
        if update.notifications_hide_content is not None:
            config["notifications_hide_content"] = update.notifications_hide_content
        if update.blogs_full_backup is not None:
            config["blogs_full_backup"] = update.blogs_full_backup
        if update.auto_download_updates is not None:
            config["auto_download_updates"] = update.auto_download_updates
        if update.sync_read_to_phone is not None:
            config["sync_read_to_phone"] = update.sync_read_to_phone
        if update.incoming_call_enabled is not None:
            config["incoming_call_enabled"] = update.incoming_call_enabled
        if update.call_popup_enabled is not None:
            if update.call_popup_enabled != config.get("call_popup_enabled", True):
                call_popup_change = update.call_popup_enabled
            config["call_popup_enabled"] = update.call_popup_enabled
        if update.close_to_tray is not None:
            config["close_to_tray"] = update.close_to_tray
        if update.autostart is not None:
            if update.autostart != config.get("autostart", False):
                autostart_change = update.autostart
            config["autostart"] = update.autostart
        if update.oshi_members is not None:
            config["oshi_members"] = update.oshi_members
        for key in _MEMORIES_NOTIFY_KEYS:
            value = getattr(update, key)
            if value is not None:
                config[key] = value
        schedule_changed = before != tuple(config.get(key) for key in _SCHEDULE_KEYS)
        memories_notify_changed = notify_before != tuple(
            config.get(key) for key in _MEMORIES_NOTIFY_KEYS
        )
        cards_enabled = not cards_before and bool(config.get("memories_notify_cards"))

    config = await _store_update(_apply)

    if schedule_changed:
        # The scheduler would otherwise only notice after its current wait.
        wake_scheduler()

    if cards_enabled:
        # Re-seed silently: history earned while the toggle was off never floods in.
        cleared = await app_state.aclear_card_baselines()
        logger.info("memories_notify_cards_enabled", cleared=cleared)

    if memories_notify_changed:
        notify_scheduler.memories_notify_settings_changed()

    if autostart_change is not None:
        await _apply_autostart(autostart_change)

    if call_popup_change is True:
        # Create the popup window now (in a thread; never blocks this response).
        desktop_bridge.call_popup_ensure()
    elif call_popup_change is False:
        await get_call_popup_controller().cancel(reason="disabled")

    return _settings_response(config)


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


@router.post("/select-folder")
async def select_folder():
    """Open a native folder picker dialog."""
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError as e:
        logger.warning(f"Tkinter not available: {e}")
        return {"path": None, "error": "Folder picker not available (tkinter missing)"}

    def open_dialog() -> Optional[str]:
        """Open a tkinter folder dialog. Runs in an executor thread."""
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

    # Timeout after 5 minutes (user should have selected a folder by then)
    DIALOG_TIMEOUT_SECONDS = 300

    try:
        loop = asyncio.get_event_loop()
        result = await asyncio.wait_for(
            loop.run_in_executor(None, open_dialog),
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
