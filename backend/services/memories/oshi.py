"""The user's oshi (favourite) members, mirrored from the frontend.

The frontend keeps the list as blog member ids per service; it is mirrored to
settings (``oshi_members``) so backend features (year recap, notifications)
can match members by normalized name.

Resolving those ids to names never waits on the network. Names come from
memory, else from disk: ``oshi_member_names.json`` next to ``settings.json``
(written here after each successful refresh), else the blog page's
``members_cache.json``. A refresh from the official site runs in the
background with a short timeout; a failed refresh is not retried for five
minutes, and concurrent callers share one refresh per service.
"""

import asyncio
import json
import threading
import time
from pathlib import Path
from typing import Any

import structlog

from backend.services.blog_service import BlogService
from backend.services.memories.names import normalize_member_name
from backend.services.platform import get_settings_path
from backend.services.settings_store import _write_file, load_config

logger = structlog.get_logger(__name__)


_MEMBERS_TTL_SECONDS = 3600.0
_REFRESH_TIMEOUT_SECONDS = 5.0
_FAILURE_TTL_SECONDS = 300.0
_NAMES_FILE = "oshi_member_names.json"

# service -> (monotonic expiry, blog member id -> name). An expiry of 0 marks
# names read from disk: served at once, refreshed in the background.
_members_cache: dict[str, tuple[float, dict[str, str]]] = {}
# service -> monotonic time before which no refresh is attempted.
_failed_until: dict[str, float] = {}
# service -> the in-flight refresh (single-flight).
_refreshing: dict[str, asyncio.Task[None]] = {}
_write_lock = threading.Lock()


def _now() -> float:
    return time.monotonic()


def _names_path() -> Path:
    return get_settings_path().parent / _NAMES_FILE


def _blog_cache_path(service: str) -> Path:
    return BlogService().get_members_cache_path(service)


def _read_json(path: Path) -> Any:
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _str_map(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    return {str(k): v for k, v in raw.items() if isinstance(v, str) and v}


def _read_disk_members(service: str) -> tuple[dict[str, str], str]:
    """Names on disk for ``service`` and their source (``none`` when absent)."""
    try:
        saved = _str_map((_read_json(_names_path()) or {}).get(service))
        if saved:
            return saved, "saved"
    except Exception as exc:
        logger.warning(
            "oshi_names_file_unreadable",
            service=service,
            error_type=type(exc).__name__,
        )
    try:
        cache = _read_json(_blog_cache_path(service)) or {}
        members = cache.get("members") or []
        from_blog = {
            str(m["id"]): m["name"]
            for m in members
            if isinstance(m, dict) and m.get("id") and isinstance(m.get("name"), str)
        }
        if from_blog:
            return from_blog, "blog_cache"
    except Exception as exc:
        logger.warning(
            "oshi_blog_cache_unreadable",
            service=service,
            error_type=type(exc).__name__,
        )
    return {}, "none"


def _write_disk_members(service: str, members: dict[str, str]) -> None:
    path = _names_path()
    with _write_lock:
        try:
            data = _read_json(path)
        except Exception:
            data = None
        if not isinstance(data, dict):
            data = {}
        data[service] = members
        _write_file(path, data)


async def _refresh(service: str) -> None:
    """Fetch names from the official site; never raises."""
    try:
        members = await asyncio.wait_for(
            BlogService().get_blog_members(service),
            timeout=_REFRESH_TIMEOUT_SECONDS,
        )
    except Exception as exc:  # TimeoutError included
        _failed_until[service] = _now() + _FAILURE_TTL_SECONDS
        logger.warning(
            "oshi_members_unavailable",
            service=service,
            error_type=type(exc).__name__,
        )
        return
    if not members:
        _failed_until[service] = _now() + _FAILURE_TTL_SECONDS
        logger.info("oshi_members_empty", service=service)
        return
    _failed_until.pop(service, None)
    _members_cache[service] = (_now() + _MEMBERS_TTL_SECONDS, members)
    logger.info("oshi_members_refreshed", service=service, count=len(members))
    try:
        await asyncio.to_thread(_write_disk_members, service, members)
    except Exception as exc:
        logger.warning(
            "oshi_names_save_failed",
            service=service,
            error_type=type(exc).__name__,
        )


def _start_refresh(service: str) -> asyncio.Task[None] | None:
    """Start a background refresh unless one runs or a failure is cached."""
    running = _refreshing.get(service)
    loop = asyncio.get_running_loop()
    if running is not None and not running.done() and running.get_loop() is loop:
        return running
    if _failed_until.get(service, 0.0) > _now():
        logger.debug("oshi_refresh_skipped", service=service, reason="recent_failure")
        return None
    task = loop.create_task(_refresh(service))
    _refreshing[service] = task

    def _done(t: asyncio.Task[None]) -> None:
        if _refreshing.get(service) is t:
            del _refreshing[service]

    task.add_done_callback(_done)
    return task


async def _blog_members(service: str) -> dict[str, str]:
    """Blog member id -> name for ``service``; ``{}`` when none are known yet.

    Returns at once from memory or disk and never waits on the network. When
    the names are older than an hour (or only on disk), a background refresh
    is started; see the module docstring.
    """
    hit = _members_cache.get(service)
    if hit is not None and hit[0] > _now():
        return hit[1]
    if hit is not None:
        names = hit[1]
    else:
        names, source = await asyncio.to_thread(_read_disk_members, service)
        logger.info(
            "oshi_members_from_disk", service=service, source=source, count=len(names)
        )
        if names:
            _members_cache[service] = (0.0, names)
    _start_refresh(service)
    return names


async def oshi_names(service: str) -> set[str]:
    """Normalized names of the oshi members for ``service``."""
    config = await load_config()
    ids = (config.get("oshi_members") or {}).get(service) or []
    if not ids:
        logger.info("oshi_names_empty", service=service)
        return set()
    members = await _blog_members(service)
    names: set[str] = set()
    unresolved = 0
    for member_id in ids:
        name = members.get(member_id)
        if name:
            names.add(normalize_member_name(name))
        else:
            unresolved += 1
    if unresolved:
        logger.info("oshi_unresolved", service=service, count=unresolved)
    return names
