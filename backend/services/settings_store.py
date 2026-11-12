"""
Centralized settings file access with asyncio.Lock.

All reads and writes to ~/.SakaDesk/settings.json MUST go through this module
to prevent TOCTOU race conditions during concurrent login/sync operations.
"""

import json
import asyncio
import tempfile
import os
import re
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable

import structlog

from backend.services.platform import get_settings_path

logger = structlog.get_logger(__name__)

_lock = asyncio.Lock()

# Serializes every read-modify-write / write of settings.json across threads.
# The asyncio lock above only orders coroutines on the event loop; the GUI
# thread (window geometry, tray hint) and executor threads need this one.
# Never held across an ``await``; only ever taken inside synchronous code.
_file_lock = threading.Lock()

# Single source of truth for settings defaults.
# All callers of load_config() get these automatically.
_SETTINGS_DEFAULTS: dict[str, Any] = {
    "auto_sync_enabled": True,
    "sync_interval_minutes": 15,
    "adaptive_sync_enabled": True,
    "is_configured": False,
    "notifications_enabled": True,
    "notifications_hide_content": False,  # Toasts show a generic body instead of the message preview
    "blogs_full_backup": False,
    "auto_download_updates": False,
    "sync_read_to_phone": False,  # Opt-in: opening a chat in SakaDesk clears its unread on the official app
    "incoming_call_enabled": True,  # Ring an in-app call for the newest unheard voice message when opening a chat
    "call_popup_enabled": True,  # Ring a background call in a bottom-right popup when a 1:1 voice arrives while the app is not in front
    "close_to_tray": True,  # The window's close button hides it to the tray instead of quitting
    "autostart": False,  # Start at Windows sign-in, hidden in the tray
    "tray_hint_shown": False,  # Internal: the "still running" toast has been shown once
    # Memories notifications (spec 15): one toggle per kind, plus the JST daily time.
    "memories_notify_on_this_day": True,
    "memories_notify_birthday": True,  # Day-of plus the 7-day and 1-day reminders
    "memories_notify_anniversary": True,  # Subscription anniversaries and milestones
    "memories_notify_recap": True,  # Recap open / Christmas / ready
    "memories_notify_cards": False,  # Foil card unlocks (opt-in)
    "memories_notify_time": "12:00",  # JST "HH:MM"; read via resolve_memories_notify_time
    "translation_provider": None,  # "gemini" or "openai"
    "translation_model": None,  # e.g., "gemini-3.1-flash-lite", "gpt-4o-mini"
    "translation_target_language": None,  # Defaults to UI language at runtime
    # Note: translation API key stored in OS credential manager, not here
}


MEMORIES_NOTIFY_TIME_DEFAULT = "12:00"
# Strict JST "HH:MM", 00:00-23:59. ``\Z`` (not ``$``) so a trailing newline fails;
# ``[0-9]`` (not ``\d``) so full-width or other Unicode digits fail too.
MEMORIES_NOTIFY_TIME_RE = re.compile(r"\A([01][0-9]|2[0-3]):[0-5][0-9]\Z")


# Invalid stored times already warned about (``repr``, kept in memory only and
# never logged), so a hand-edited value warns once, not on every read.
_warned_notify_times: set[str] = set()


def resolve_memories_notify_time(value: Any) -> str:
    """The stored ``memories_notify_time`` if valid, else ``"12:00"``.

    settings.json can be hand-edited, so the read side validates too. An
    invalid value logs ``memories_notify_time_invalid`` with its type only
    (never the value), once per distinct value per process, and falls back
    to the default.
    """
    if isinstance(value, str) and MEMORIES_NOTIFY_TIME_RE.match(value):
        return value
    seen = f"{type(value).__name__}:{value!r}"
    if seen not in _warned_notify_times:
        _warned_notify_times.add(seen)
        logger.warning(
            "memories_notify_time_invalid",
            value_type=type(value).__name__,
            fallback=MEMORIES_NOTIFY_TIME_DEFAULT,
        )
    return MEMORIES_NOTIFY_TIME_DEFAULT


def reset_notify_time_warnings_for_tests() -> None:
    """Test-only: forget which invalid times were already warned about."""
    _warned_notify_times.clear()


_READ_RETRIES = 3

# path -> the JSON last read from it by :func:`read_settings_file` (a copy is
# served when a later read fails; see there).
_last_good_files: dict[str, Any] = {}


def _open_json(path: Path) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _on_event_loop() -> bool:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return False
    return True


def _load_json(path: Path) -> Any:
    """Parse ``path``, retrying a ``PermissionError`` on Windows. Blocking; raises.

    On Windows a reader can hit a sharing violation while ``os.replace``
    swaps the file in (another process, or antivirus / the indexer holding
    it). In-process writers are excluded by ``_file_lock``; this retry covers
    the rest, like :func:`_replace_with_retry` does for writes. It never
    sleeps on the event loop thread (one attempt there) or off Windows.
    """
    for attempt in range(_READ_RETRIES):
        try:
            return _open_json(path)
        except PermissionError:
            if (
                attempt == _READ_RETRIES - 1
                or sys.platform != "win32"
                or _on_event_loop()
            ):
                raise
            time.sleep(0.05 * (attempt + 1))
    raise AssertionError("unreachable")  # pragma: no cover


def _read_file(path: Path) -> dict:
    if path.exists():
        return {**_SETTINGS_DEFAULTS, **_load_json(path)}
    return dict(_SETTINGS_DEFAULTS)


def _read_file_locked(path: Path) -> dict:
    with _file_lock:
        return _read_file(path)


def read_settings_file(path: Path) -> Any:
    """The raw parsed JSON of the settings file at ``path`` (``None`` when absent).

    For readers outside this module (bug report, diagnostics, window
    geometry). Takes ``_file_lock`` and retries a held file
    (:func:`_load_json`). If the read still fails, it returns a copy of the
    last value read from ``path`` instead of failing or silently using
    defaults, and logs ``settings_read_failed`` (``error_type``,
    ``fallback=last_good``). With no last value it logs ``fallback=none``
    and raises; the caller decides. Blocking.
    """
    import copy

    key = str(path)
    try:
        with _file_lock:
            if not path.exists():
                return None
            data = _load_json(path)
    except (OSError, ValueError) as e:
        last = _last_good_files.get(key)
        logger.warning(
            "settings_read_failed",
            error_type=type(e).__name__,
            fallback="last_good" if last is not None else "none",
        )
        if last is None:
            raise
        return copy.deepcopy(last)
    _last_good_files[key] = copy.deepcopy(data)
    return data


def _replace_with_retry(src: str, dst: Path, retries: int = 3) -> None:
    """os.replace with retry for Windows, where antivirus/indexer can
    briefly lock the destination file causing PermissionError.

    Uses time.sleep (blocking) intentionally — this function runs inside
    an executor thread via run_in_executor, so the event loop is not blocked.
    """
    for attempt in range(retries):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if attempt == retries - 1 or sys.platform != "win32":
                raise
            time.sleep(0.05 * (attempt + 1))


def _write_file(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        _replace_with_retry(tmp_path, path)
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


async def load_config() -> dict[str, Any]:
    """Load settings.json under async lock."""
    async with _lock:
        loop = asyncio.get_running_loop()
        # Under ``_file_lock`` too: a thread writer (GUI, executor) swaps the
        # file in with os.replace, and on Windows a read mid-swap fails.
        return await loop.run_in_executor(None, _read_file_locked, get_settings_path())


def _write_file_locked(path: Path, data: dict) -> None:
    with _file_lock:
        _write_file(path, data)


def _read_update_write(path: Path, updater: Callable[[dict], None]) -> dict:
    """One whole read -> updater -> write cycle under ``_file_lock``."""
    with _file_lock:
        config = _read_file(path)
        updater(config)
        _write_file(path, config)
    return config


async def save_config(config: dict) -> None:
    """Save settings.json atomically under async lock."""
    async with _lock:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None, _write_file_locked, get_settings_path(), config
        )


async def update_config(updater: Callable[[dict], None]) -> dict:
    """Atomic read-modify-write: load, apply updater function, save, return result.

    This is the preferred way to modify settings. The asyncio lock orders
    callers on the event loop and the whole read -> ``updater`` -> write cycle
    runs as one executor job under the cross-thread ``_file_lock``, so neither
    another coroutine nor a non-loop thread (see :func:`mark_tray_hint_shown`)
    can slip in between and cause a lost update. ``updater`` must be a plain
    synchronous function; it runs on an executor thread.
    """
    async with _lock:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, _read_update_write, get_settings_path(), updater
        )


def update_raw_sync(path: Path, updates: dict[str, Any]) -> bool:
    """Merge top-level ``updates`` into the settings file at ``path``.

    Synchronous, for callers outside the event loop (the GUI thread saving
    window geometry). Takes the same ``_file_lock`` as :func:`update_config`.
    Operates on the raw file contents (no defaults are merged in, so keys the
    user never set are not materialised). A missing file is treated as empty
    and created. A file that exists but cannot be read, parsed, or does not
    hold a JSON object is left untouched: writing would replace every setting
    with ``updates`` alone. That case logs ``settings_raw_update_skipped``
    (reason and error type only) and returns ``False``. The write is atomic.
    Returns ``True`` when the file was written; a write failure raises.
    """
    with _file_lock:
        raw: dict = {}
        if path.exists():
            try:
                loaded = _load_json(path)
            except Exception as e:
                logger.warning(
                    "settings_raw_update_skipped",
                    reason="unreadable",
                    error_type=type(e).__name__,
                )
                return False
            if not isinstance(loaded, dict):
                logger.warning(
                    "settings_raw_update_skipped",
                    reason="not_object",
                    error_type=type(loaded).__name__,
                )
                return False
            raw = loaded
        raw.update(updates)
        _write_file(path, raw)
    return True


def read_config_sync() -> dict[str, Any]:
    """Load settings.json (defaults merged in) from a non-async thread.

    For the GUI thread (the tray and the closing handler), which has no event
    loop. Takes ``_file_lock`` so it never reads a half-written update.
    Raises if the file is unreadable; callers decide the fallback.
    """
    with _file_lock:
        return _read_file(get_settings_path())


def mark_tray_hint_shown() -> bool:
    """Persist ``tray_hint_shown=True``; return whether it was saved.

    Synchronous on purpose: the closing handler calls it from the GUI thread,
    outside the event loop. The read-modify-write takes ``_file_lock``, the
    same lock :func:`update_config` holds for its whole cycle, so a concurrent
    settings update is never lost. Never raises: a failure logs
    ``tray_hint_persist_failed`` (error type only) and returns ``False``.
    """

    def _set(config: dict) -> None:
        config["tray_hint_shown"] = True

    try:
        _read_update_write(get_settings_path(), _set)
    except Exception as e:
        logger.warning("tray_hint_persist_failed", error_type=type(e).__name__)
        return False
    return True
