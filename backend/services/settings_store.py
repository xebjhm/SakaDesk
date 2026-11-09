"""
Centralized settings file access with asyncio.Lock.

All reads and writes to ~/.SakaDesk/settings.json MUST go through this module
to prevent TOCTOU race conditions during concurrent login/sync operations.
"""

import json
import asyncio
import tempfile
import os
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
    "translation_provider": None,  # "gemini" or "openai"
    "translation_model": None,  # e.g., "gemini-3.1-flash-lite", "gpt-4o-mini"
    "translation_target_language": None,  # Defaults to UI language at runtime
    # Note: translation API key stored in OS credential manager, not here
}


def _read_file(path: Path) -> dict:
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return {**_SETTINGS_DEFAULTS, **json.load(f)}
    return dict(_SETTINGS_DEFAULTS)


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
        return await loop.run_in_executor(None, _read_file, get_settings_path())


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
                loaded = json.loads(path.read_text(encoding="utf-8"))
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
