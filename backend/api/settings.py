"""
Settings API for SakaDesk
Handles output folder configuration and auto-sync settings.
Uses platform-appropriate paths for Windows deployment.
"""

import asyncio
import json
import sys
import threading
import time
import structlog
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator
from typing import Any, Optional

from backend.services.platform import (
    get_settings_path,
    get_default_output_dir as _platform_default_output_dir,
)
from backend.services.service_utils import (
    validate_service,
)
from backend.services import autostart, desktop_bridge, output_dir_policy
from backend.services.i18n import get_strings, resolve_ui_language
from backend.services.memories import notify_scheduler
from backend.services.auto_sync_scheduler import wake_scheduler
from backend.services.call_popup import get_call_popup_controller
from backend.services.notification_service import set_notifications_enabled
from backend.services.path_resolver import output_dir_value
from backend.services.settings_store import (
    MEMORIES_NOTIFY_TIME_DEFAULT,
    resolve_memories_notify_time,
    load_config as _store_load,
    update_config as _store_update,
    _write_file_locked,
)

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])

MAX_SYNC_INTERVAL_MINUTES = 1440
"""A day; a larger value only made the scheduler skip every launch (report-hardening #54)."""
MAX_OSHI_SERVICES = 8
MAX_OSHI_PER_SERVICE = 100
MAX_OSHI_TEXT_CHARS = 64

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
    # Atomic (tmp file + os.replace) under the cross-thread lock, like every
    # other settings writer: a reader never sees a half-written file.
    _write_file_locked(SETTINGS_FILE, config)
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
    # (rate-limit / account-flag risk). A value over a day is refused too
    # (audit 2026-11-13).
    sync_interval_minutes: Optional[int] = None
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

    @field_validator("sync_interval_minutes")
    @classmethod
    def _interval_in_range(cls, value: Optional[int]) -> Optional[int]:
        if value is not None and not 1 <= value <= MAX_SYNC_INTERVAL_MINUTES:
            logger.info(
                "settings_rejected", field="sync_interval_minutes", reason="range"
            )
            raise ValueError("sync_interval_minutes must be between 1 and 1440")
        return value

    @field_validator("oshi_members")
    @classmethod
    def _oshi_bounded(
        cls, value: Optional[dict[str, list[str]]]
    ) -> Optional[dict[str, list[str]]]:
        if value is None:
            return value
        too_large = len(value) > MAX_OSHI_SERVICES or any(
            len(key) > MAX_OSHI_TEXT_CHARS
            or len(names) > MAX_OSHI_PER_SERVICE
            or any(len(name) > MAX_OSHI_TEXT_CHARS for name in names)
            for key, names in value.items()
        )
        if too_large:
            logger.info("settings_rejected", field="oshi_members", reason="too_large")
            raise ValueError("oshi_members is too large")
        return value


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
    saved = config.get("output_dir")
    return SettingsResponse(
        # The saved text exactly (POST compares against it), else the default.
        output_dir=saved
        if isinstance(saved, str) and saved.strip()
        else get_default_output_dir(),
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


def _output_dir_refused(reason: str, source: str) -> HTTPException:
    """Log a refused ``output_dir`` (codes only) and build its 400."""
    logger.warning("output_dir_rejected", reason=reason, source=source)
    return HTTPException(
        status_code=400, detail={"code": "output_dir_rejected", "reason": reason}
    )


async def _accept_output_dir(raw: str) -> Optional[str]:
    """The value to save for a requested ``output_dir``, ``None`` for "keep what is saved", or raise HTTP 400 (security audit 2026-11-13).

    - The saved value itself (``output_dir_policy.same_dir``): ``None``, so
      the caller never writes ``output_dir`` back (a request that read the
      old value cannot undo a folder saved meanwhile), and no check runs.
    - The default folder: the form ``output_dir_policy.check_output_dir``
      returns, if it passes.
    - A folder the folder picker returned in this process
      (``POST /api/settings/select-folder``): the exact string the picker
      returned, if it passes. Each pick is used once, atomically
      (``output_dir_policy.take_grant``: of simultaneous requests one wins),
      and expires after ``output_dir_policy.GRANT_LIFETIME_SECONDS``.
    - Anything else is refused with ``not_picked``: a page cannot name a
      folder, only the user can, in the native picker.

    Logs ``output_dir_accepted`` (``source``) or ``output_dir_rejected``
    (``reason``, ``source``); never the path.
    """
    config = await _store_load()
    current = config.get("output_dir")
    if (
        isinstance(current, str)
        and current
        and output_dir_policy.same_dir(raw, current)
    ):
        logger.info("output_dir_accepted", source="current")
        return None
    if output_dir_policy.same_dir(raw, get_default_output_dir()):
        source = "default"
        candidate = raw
    elif output_dir_policy.has_grant(raw):
        source = "picker"
        # Atomic and authoritative: the has_grant above is only a cheap early exit.
        granted = output_dir_policy.take_grant(raw)
        if granted is None:
            raise _output_dir_refused("not_picked", "api")
        candidate = granted
    else:
        raise _output_dir_refused("not_picked", "api")
    try:
        value = await asyncio.to_thread(output_dir_policy.check_output_dir, candidate)
    except output_dir_policy.OutputDirRejected as e:
        raise _output_dir_refused(e.reason, source) from None
    logger.info("output_dir_accepted", source=source)
    return value


@router.post("", response_model=SettingsResponse)
async def update_settings(update: SettingsUpdate):
    """Update settings.

    ``output_dir`` (the archive root every containment check trusts) is
    accepted only as :func:`_accept_output_dir` allows; a refused value
    answers 400 ``{"detail": {"code": "output_dir_rejected", "reason": ...}}``
    and nothing in the request is saved. Posting the saved folder leaves
    ``output_dir`` untouched; saving a new one forgets every other pick.
    """
    new_output_dir: Optional[str] = None
    if update.output_dir is not None:
        # Before anything is written: a refused folder fails the whole request.
        new_output_dir = await _accept_output_dir(update.output_dir)
    autostart_change: Optional[bool] = None
    call_popup_change: Optional[bool] = None
    schedule_changed = False
    memories_notify_changed = False

    def _apply(config: dict) -> None:
        nonlocal autostart_change, call_popup_change, schedule_changed
        nonlocal memories_notify_changed
        before = tuple(config.get(key) for key in _SCHEDULE_KEYS)
        notify_before = tuple(config.get(key) for key in _MEMORIES_NOTIFY_KEYS)
        notifications_before = config.get("notifications_enabled")
        if new_output_dir is not None:
            config["output_dir"] = new_output_dir
            config["is_configured"] = True
        elif update.output_dir is not None:
            config["is_configured"] = True  # the saved folder, confirmed; not rewritten
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
        # The global switch gates every Memories toast too: wake on its change,
        # so turning it on delivers a still-open occasion now, not ≤15 min later.
        memories_notify_changed = notify_before != tuple(
            config.get(key) for key in _MEMORIES_NOTIFY_KEYS
        ) or notifications_before != config.get("notifications_enabled")

    config = await _store_update(_apply)

    if new_output_dir is not None:
        output_dir_policy.clear_grants()  # a pick is for one save

    if schedule_changed:
        # The scheduler would otherwise only notice after its current wait.
        wake_scheduler()

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
    output_path = output_dir_value(
        config.get("output_dir"), Path(get_default_output_dir())
    )

    # Fresh if: doesn't exist, is empty, or only has sync_metadata.json
    is_fresh = True
    if output_path.exists():
        contents = list(output_path.iterdir())
        # Filter out metadata files
        data_contents = [
            c for c in contents if c.name not in ("sync_metadata.json", ".gitkeep")
        ]
        is_fresh = len(data_contents) == 0

    return FreshCheckResponse(is_fresh=is_fresh, output_dir=str(output_path))


class _PickerUnavailable(Exception):
    """This build has no tkinter, so no native folder picker."""


def _ask_directory(title: str, initialdir: Optional[str] = None) -> Optional[str]:
    """Show the native folder dialog above other windows, opened at ``initialdir`` (the folder already in use, so a reflexive Enter keeps it); the chosen folder or None. Blocking.

    Raises :class:`_PickerUnavailable` when tkinter is missing.
    """
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError:
        raise _PickerUnavailable() from None
    root = tk.Tk()
    try:
        root.withdraw()  # no empty Tk window, only the dialog
        root.attributes("-topmost", True)
        folder = filedialog.askdirectory(
            title=title, mustexist=True, initialdir=initialdir
        )
    finally:
        root.destroy()
    return folder or None


_PICKER_TIMEOUT_SECONDS = 300.0
"""How long one request waits for the dialog (it may stay open longer: see :func:`_start_picker`)."""

_PICKER_COOLDOWN_SECONDS = 2.0
"""After a cancel, ``select-folder`` answers ``cooldown`` for this long (a held Enter or Esc cannot reopen the dialog)."""

_monotonic = time.monotonic
"""The cooldown clock (tests replace it)."""

_picker_cooldown_until = 0.0
"""``_monotonic()`` value before which ``select-folder`` answers ``cooldown``."""

_picker_lock = threading.Lock()
"""Held while a folder dialog is open, from the request that opens it until the dialog closes."""


def _start_picker(
    title: str, initialdir: Optional[str] = None
) -> "asyncio.Future[Optional[str]]":
    """Run :func:`_ask_directory` on a daemon thread; a future for its result.

    The caller holds :data:`_picker_lock`; the thread releases it when the
    dialog closes, also after the request stopped waiting, so a second dialog
    never opens over a forgotten one. A daemon thread never delays the app's
    exit.
    """
    loop = asyncio.get_running_loop()
    future: "asyncio.Future[Optional[str]]" = loop.create_future()

    def settle(result: Optional[str], error: Optional[Exception]) -> None:
        if future.done():
            return
        if error is not None:
            future.set_exception(error)
        else:
            future.set_result(result)

    def worker() -> None:
        result: Optional[str] = None
        error: Optional[Exception] = None
        try:
            result = _ask_directory(title, initialdir)
        except Exception as e:  # noqa: BLE001 - handed to the request
            error = e
        finally:
            _picker_lock.release()
        try:
            loop.call_soon_threadsafe(settle, result, error)
        except RuntimeError:
            pass  # the request's loop is gone (it timed out, or the app is exiting)

    threading.Thread(target=worker, name="folder-picker", daemon=True).start()
    return future


@router.post("/select-folder")
async def select_folder():
    """Open the native folder picker; a folder it returns may then be saved as ``output_dir``.

    The chosen folder is checked (``output_dir_policy.check_output_dir``) and,
    if it passes, remembered as picked (``output_dir_policy.grant``): one later
    ``POST /api/settings`` may save it (security audit 2026-11-13). The dialog
    title follows the UI language (``backend/i18n/<lang>/folder_picker.json``).

    Answers ``{"path": <folder>}`` (the normalised form to save),
    ``{"path": None}`` when the user cancelled, or ``{"path": None, "error":
    <code>}``: ``busy`` (a dialog is already open), ``unavailable`` (no
    tkinter), ``timeout`` (no answer within 5 minutes; that dialog keeps the
    picker busy until it is closed), ``cooldown`` (asked again within 2 s of
    a cancel), ``failed`` (the dialog could not open),
    or a rule's reason (``network``, ``root``, ``profile``...). Every outcome
    logs ``output_dir_picker`` with ``outcome`` (and ``reason`` or
    ``error_type``); never a path.
    """
    global _picker_cooldown_until
    config = await _store_load()
    lang = await asyncio.to_thread(resolve_ui_language, config)
    title = get_strings("folder_picker", lang)["title"]
    if _monotonic() < _picker_cooldown_until:
        logger.info("output_dir_picker", outcome="cooldown")
        return {"path": None, "error": "cooldown"}
    if not _picker_lock.acquire(blocking=False):
        logger.info("output_dir_picker", outcome="busy")
        return {"path": None, "error": "busy"}
    try:
        initialdir = str(
            output_dir_value(config.get("output_dir"), Path(get_default_output_dir()))
        )
        pending = _start_picker(title, initialdir)
    except Exception as e:  # noqa: BLE001 - the thread never started
        _picker_lock.release()
        logger.error("output_dir_picker", outcome="failed", error_type=type(e).__name__)
        return {"path": None, "error": "failed"}
    try:
        chosen = await asyncio.wait_for(pending, timeout=_PICKER_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        logger.warning("output_dir_picker", outcome="timeout")
        return {"path": None, "error": "timeout"}
    except _PickerUnavailable:
        logger.warning("output_dir_picker", outcome="unavailable")
        return {"path": None, "error": "unavailable"}
    except Exception as e:  # noqa: BLE001 - one code, never the error text
        logger.error("output_dir_picker", outcome="failed", error_type=type(e).__name__)
        return {"path": None, "error": "failed"}
    if not chosen:
        _picker_cooldown_until = _monotonic() + _PICKER_COOLDOWN_SECONDS
        logger.info("output_dir_picker", outcome="cancelled")
        return {"path": None}
    try:
        value = await asyncio.to_thread(output_dir_policy.check_output_dir, chosen)
    except output_dir_policy.OutputDirRejected as e:
        logger.warning("output_dir_picker", outcome="rejected", reason=e.reason)
        return {"path": None, "error": e.reason}
    output_dir_policy.grant(value)
    logger.info("output_dir_picker", outcome="picked")
    return {"path": value}


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
