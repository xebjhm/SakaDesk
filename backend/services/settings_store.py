"""
Centralized settings file access with asyncio.Lock.

All reads and writes to ~/.ZakaDesk/settings.json MUST go through this module
to prevent TOCTOU race conditions during concurrent login/sync operations.
"""
import json
import asyncio
import tempfile
import os
from pathlib import Path
from typing import Any, Callable

import structlog

from backend.services.platform import get_settings_path

logger = structlog.get_logger(__name__)

_lock = asyncio.Lock()


def _read_file(path: Path) -> dict:
    if path.exists():
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def _write_file(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=path.parent, suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_path, path)
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


async def load_config() -> dict[str, Any]:
    """Load settings.json under async lock."""
    async with _lock:
        return _read_file(get_settings_path())


async def save_config(config: dict) -> None:
    """Save settings.json atomically under async lock."""
    async with _lock:
        _write_file(get_settings_path(), config)


async def update_config(updater: Callable[[dict], None]) -> dict:
    """Atomic read-modify-write: load, apply updater function, save, return result.

    This is the preferred way to modify settings -- it holds the lock for the
    entire read-modify-write cycle, preventing lost updates.
    """
    async with _lock:
        path = get_settings_path()
        config = _read_file(path)
        updater(config)
        _write_file(path, config)
        return config
