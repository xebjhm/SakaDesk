"""Cache of text-free Memories view payloads (binder, timeline, album, hub, ...).

Table ``memories_view_cache`` lives in the memory-index DB
(:func:`index._connect`); it is created on first use::

    memories_view_cache(service_dir TEXT, view TEXT, key TEXT, data_hash TEXT,
                        payload TEXT, PRIMARY KEY(service_dir, view, key))
                        WITHOUT ROWID

A row is a hit only when its ``data_hash`` equals the caller's. Payloads must
not hold her words: views store message objects with ``text`` / ``caption``
set to ``None`` and call ``people.attach_texts`` after the cache read. As a
bug guard, :func:`cached_view` refuses to store a payload in which any dict has
a non-null ``text``, ``caption`` or ``sentence`` (``outcome=uncacheable``).

Every read logs ``memories_view_cache`` with ``view`` and ``outcome``
(``hit`` / ``miss`` / ``uncacheable``). The key is never logged: it may be
derived from room folders. SQLite errors are logged
(``memories_view_cache_failed``, ``op=read|write``) and never raise.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import sqlite3
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import structlog

from backend.services.memories import index as mi

logger = structlog.get_logger(__name__)

_SCHEMA = (
    "CREATE TABLE IF NOT EXISTS memories_view_cache (service_dir TEXT, view TEXT, "
    "key TEXT, data_hash TEXT, payload TEXT, "
    "PRIMARY KEY(service_dir, view, key)) WITHOUT ROWID"
)
_TEXT_KEYS = ("text", "caption", "sentence")


def view_hash(*parts: object) -> str:
    """Short hash of ``parts`` (sha256 of their ``repr``, first 16 hex chars)."""
    return hashlib.sha256(repr(parts).encode("utf-8")).hexdigest()[:16]


def contains_text(payload: Any) -> bool:
    """True when any dict in ``payload`` has a non-null text-bearing value."""
    stack = [payload]
    while stack:
        item = stack.pop()
        if isinstance(item, dict):
            if any(item.get(k) is not None for k in _TEXT_KEYS):
                return True
            stack.extend(item.values())
        elif isinstance(item, (list, tuple)):
            stack.extend(item)
    return False


def _read(service_dir: str, view: str, key: str, data_hash: str) -> dict | None:
    """The cached payload when its hash matches, else ``None``. Blocking."""
    try:
        with contextlib.closing(mi._connect()) as c:
            c.execute(_SCHEMA)
            row = c.execute(
                "SELECT data_hash, payload FROM memories_view_cache "
                "WHERE service_dir=? AND view=? AND key=?",
                (service_dir, view, key),
            ).fetchone()
        if row is None or row[0] != data_hash:
            return None
        payload = json.loads(row[1])
    except (sqlite3.Error, ValueError) as e:
        logger.warning(
            "memories_view_cache_failed",
            view=view,
            op="read",
            error_type=type(e).__name__,
        )
        return None
    return payload if isinstance(payload, dict) else None


def _write(
    service_dir: str, view: str, key: str, data_hash: str, payload: dict
) -> None:
    """Store ``payload``. Blocking; errors are logged, never raised."""
    try:
        with contextlib.closing(mi._connect()) as c, c:
            c.execute(_SCHEMA)
            c.execute(
                "INSERT OR REPLACE INTO memories_view_cache"
                "(service_dir, view, key, data_hash, payload) VALUES (?,?,?,?,?)",
                (
                    service_dir,
                    view,
                    key,
                    data_hash,
                    json.dumps(payload, ensure_ascii=False),
                ),
            )
    except sqlite3.Error as e:
        logger.warning(
            "memories_view_cache_failed",
            view=view,
            op="write",
            error_type=type(e).__name__,
        )


async def cached_view(
    sdir: Path,
    view: str,
    key: str,
    data_hash: str,
    build: Callable[[], Awaitable[dict]],
) -> dict:
    """The payload of ``view`` / ``key`` for ``sdir``: cached, or built and stored.

    On a miss ``build()`` is awaited; its payload is stored unless it contains
    text (see the module docstring). The DB is read and written in a worker.
    """
    service_dir = str(sdir)
    hit = await asyncio.to_thread(_read, service_dir, view, key, data_hash)
    if hit is not None:
        logger.info("memories_view_cache", view=view, outcome="hit")
        return hit
    payload = await build()
    if contains_text(payload):
        logger.warning("memories_view_cache", view=view, outcome="uncacheable")
        return payload
    logger.info("memories_view_cache", view=view, outcome="miss")
    await asyncio.to_thread(_write, service_dir, view, key, data_hash, payload)
    return payload


__all__ = ["cached_view", "contains_text", "view_hash"]
