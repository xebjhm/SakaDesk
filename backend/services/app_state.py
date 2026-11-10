# backend/services/app_state.py
"""Port-independent app state (SQLite, WAL). Source of truth for state the
frontend used to keep in origin-scoped localStorage, and for the fan's own
Memories state (capsule notes, cover overrides, gacha pulls). None of it ever
goes into the archive.

Schema versions (``PRAGMA user_version``):

======= =================================================================
Version Change
======= =================================================================
0       Base tables created by ``init_db``: ``prefs``,
        ``conversation_state``, ``translation_cache``, ``favorite_log``.
1       Memories user state: ``memories_capsule_notes`` (+ two indexes),
        ``memories_cover_overrides``, ``memories_gacha_pulls``.
======= =================================================================

Rule: **append a step, never edit one.** A new schema change is a new
function appended to ``_MIGRATIONS`` (``SCHEMA_VERSION`` follows its length)
and the tables / indexes it creates added to ``_REQUIRED_SCHEMA``. Every
step must be idempotent (``CREATE ... IF NOT EXISTS``): when a required
object is missing (half-applied or hand-damaged DB) ``_migrate`` re-runs
**all** steps from 1 to heal it. A future step that is not naturally
idempotent (e.g. ``ALTER TABLE ... ADD COLUMN``) must guard itself (check
``PRAGMA table_info`` first) or that re-run fails. Steps run inside one
``BEGIN IMMEDIATE`` transaction and must use ``Connection.execute``
(``executescript`` would commit mid-migration).

Prefs keys starting with ``memories_`` (``INTERNAL_PREF_PREFIX``) are
backend-internal (e.g. the gacha salt): the prefs API never returns or
accepts them, and ``migrate_dump`` drops them.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from contextlib import closing
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import structlog

from backend.services.platform import get_app_data_dir

logger = structlog.get_logger(__name__)

_db_path: Optional[Path] = None
_MAX_TRANSLATIONS = 50000


def set_db_path(path: Path) -> None:
    global _db_path
    _db_path = path


def _path() -> Path:
    return _db_path or (get_app_data_dir() / "app_state.db")


def connect() -> sqlite3.Connection:
    """New connection. Callers use ``with closing(connect()) as c, c:`` --
    the inner ``with`` commits (or rolls back) and ``closing`` releases the
    handle, which sqlite3's own context manager does not."""
    conn = sqlite3.connect(_path())
    # busy_timeout first, so a concurrent first start waits on the WAL switch.
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


# Kept for existing callers; new code uses :func:`connect`.
_connect = connect


def _step1_memories_user_state(c: sqlite3.Connection) -> None:
    """Version 1: Memories capsule notes, cover overrides and gacha pulls."""
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS memories_capsule_notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          service TEXT NOT NULL,
          anchor_kind TEXT NOT NULL CHECK (anchor_kind IN ('day','card')),
          anchor_date TEXT NOT NULL,
          member_path TEXT,
          card_key TEXT,
          body TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """
    )
    c.execute(
        "CREATE INDEX IF NOT EXISTS memories_capsule_by_anchor "
        "ON memories_capsule_notes(service, anchor_date)"
    )
    c.execute(
        "CREATE INDEX IF NOT EXISTS memories_capsule_by_created "
        "ON memories_capsule_notes(service, created_at)"
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS memories_cover_overrides (
          service_dir TEXT NOT NULL, scope TEXT NOT NULL, month TEXT NOT NULL,
          room TEXT NOT NULL, message_id INTEGER NOT NULL, set_at TEXT NOT NULL,
          PRIMARY KEY (service_dir, scope, month)
        ) WITHOUT ROWID
        """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS memories_gacha_pulls (
          service TEXT NOT NULL, jst_date TEXT NOT NULL, pull_index INTEGER NOT NULL,
          room TEXT NOT NULL, message_id INTEGER NOT NULL,
          rarity TEXT NOT NULL CHECK (rarity IN ('n','r','sr')), reason TEXT NOT NULL,
          pulled_at TEXT NOT NULL,
          PRIMARY KEY (service, jst_date, pull_index)
        ) WITHOUT ROWID
        """
    )


# Append-only: step N (1-based) brings the DB from version N-1 to N.
_MIGRATIONS: tuple[Callable[[sqlite3.Connection], None], ...] = (
    _step1_memories_user_state,
)
SCHEMA_VERSION = len(_MIGRATIONS)
# Tables and indexes the migration steps create; a missing one after the
# pending steps ran (half-applied / hand-damaged DB) re-runs all steps.
_REQUIRED_SCHEMA: frozenset[str] = frozenset(
    {
        "memories_capsule_notes",
        "memories_cover_overrides",
        "memories_gacha_pulls",
        "memories_capsule_by_anchor",
        "memories_capsule_by_created",
    }
)

INTERNAL_PREF_PREFIX = "memories_"


def is_internal_pref(key: str) -> bool:
    """True for backend-internal prefs keys the frontend must never see or set."""
    return key.startswith(INTERNAL_PREF_PREFIX)


def _missing_schema(c: sqlite3.Connection) -> int:
    present = {
        r[0]
        for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table','index')"
        ).fetchall()
    }
    return len(_REQUIRED_SCHEMA - present)


def _migrate(c: sqlite3.Connection) -> None:
    """Run pending steps in one ``BEGIN IMMEDIATE`` transaction.

    - ``user_version > SCHEMA_VERSION`` (a newer app wrote this DB): touch
      nothing, never lower the version.
    - otherwise run steps ``user_version+1 .. SCHEMA_VERSION``; then, if any
      ``_REQUIRED_SCHEMA`` object is still missing, re-run all steps (they
      are idempotent) to heal it; then set ``user_version``.
    - Any ``sqlite3.Error`` (including failing to take the lock) rolls
      everything back, is logged and is re-raised.
    """
    step = 0
    try:
        c.execute("BEGIN IMMEDIATE")
        current = int(c.execute("PRAGMA user_version").fetchone()[0])
        if current > SCHEMA_VERSION:
            c.rollback()
            logger.warning(
                "app_state_migrate",
                outcome="newer_schema",
                from_version=current,
                to_version=SCHEMA_VERSION,
            )
            return
        for step in range(current + 1, SCHEMA_VERSION + 1):
            _MIGRATIONS[step - 1](c)
        missing = _missing_schema(c)
        if missing:
            for step in range(1, SCHEMA_VERSION + 1):
                _MIGRATIONS[step - 1](c)
        if current == SCHEMA_VERSION and not missing:
            c.rollback()
            logger.debug("app_state_migrate", outcome="current", from_version=current)
            return
        c.execute(f"PRAGMA user_version = {int(SCHEMA_VERSION)}")
        c.commit()
    except sqlite3.Error as exc:
        c.rollback()
        logger.error(
            "app_state_migrate",
            outcome="error",
            step=step,
            error_type=type(exc).__name__,
        )
        raise
    if missing:
        logger.warning(
            "app_state_migrate",
            outcome="healed",
            from_version=current,
            steps=SCHEMA_VERSION - current,
            missing=missing,
        )
    else:
        logger.info(
            "app_state_migrate",
            outcome="migrated",
            from_version=current,
            to_version=SCHEMA_VERSION,
            steps=SCHEMA_VERSION - current,
        )


def init_db() -> None:
    """Create the version-0 tables, then apply pending migrations."""
    with closing(connect()) as c, c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS prefs (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE IF NOT EXISTS conversation_state (path TEXT PRIMARY KEY, data TEXT);
            CREATE TABLE IF NOT EXISTS translation_cache (
                k TEXT PRIMARY KEY, v TEXT, last_used REAL
            );
            CREATE TABLE IF NOT EXISTS favorite_log (
                service TEXT, message_id INTEGER, favorited_at TEXT,
                PRIMARY KEY(service, message_id)
            );
            """
        )
        _migrate(c)


def record_favorite(
    service: str, message_id: int, is_favorite: bool, *, at: datetime | None = None
) -> None:
    """Record when a message was favourited (UTC ISO string).

    ``is_favorite`` in ``messages.json`` / the favourites API is the truth
    about WHETHER a message is favourited; ``favorite_log.favorited_at`` is
    only a hint about WHEN. Rows exist only for favourites toggled in this
    app since the log was added, so a missing row means "unknown time" (use
    the message time), never "not favourited".

    Re-favouriting upserts the timestamp; un-favouriting deletes the row.
    ``at`` defaults to the current UTC time. Blocking I/O: call via
    ``asyncio.to_thread`` from async handlers.
    """
    with closing(_connect()) as c, c:
        if not is_favorite:
            c.execute(
                "DELETE FROM favorite_log WHERE service=? AND message_id=?",
                (service, message_id),
            )
            return
        when = (at or datetime.now(timezone.utc)).astimezone(timezone.utc)
        c.execute(
            "INSERT INTO favorite_log(service,message_id,favorited_at) VALUES(?,?,?) "
            "ON CONFLICT(service,message_id) DO UPDATE SET favorited_at=excluded.favorited_at",
            (service, message_id, when.isoformat()),
        )


_IN_CHUNK = 500


def favorited_at(service: str, message_ids: list[int]) -> dict[int, str]:
    """Map of message_id -> UTC ISO favourite time, for the ids that are logged.

    A hint only: check ``is_favorite`` for whether a message is favourited.
    """
    if not message_ids:
        return {}
    out: dict[int, str] = {}
    with closing(_connect()) as c, c:
        # Chunked: SQLite caps bound variables per statement.
        for i in range(0, len(message_ids), _IN_CHUNK):
            chunk = message_ids[i : i + _IN_CHUNK]
            q = ",".join("?" * len(chunk))
            rows = c.execute(
                f"SELECT message_id, favorited_at FROM favorite_log "
                f"WHERE service=? AND message_id IN ({q})",
                [service, *chunk],
            ).fetchall()
            out.update((mid, ts) for mid, ts in rows)
    return out


def get_prefs() -> dict[str, Any]:
    with closing(_connect()) as c, c:
        rows = c.execute("SELECT key, value FROM prefs").fetchall()
    return {k: json.loads(v) for k, v in rows}


def set_prefs(patch: dict[str, Any]) -> None:
    with closing(_connect()) as c, c:
        for k, v in patch.items():
            c.execute(
                "INSERT INTO prefs(key,value) VALUES(?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (k, json.dumps(v)),
            )


def get_conversation(path: str) -> dict[str, Any]:
    with closing(_connect()) as c, c:
        row = c.execute(
            "SELECT data FROM conversation_state WHERE path=?", (path,)
        ).fetchone()
    return json.loads(row[0]) if row else {}


def set_conversation(path: str, patch: dict[str, Any]) -> None:
    # SD-BE-SVC-10: do the read-modify-write inside ONE connection/transaction.
    # Previously the read (get_conversation) and the write used two separate
    # connections, so concurrent PATCHes to the same path could drop keys the
    # moment these ran off the single event-loop thread. `dict.update` semantics
    # are preserved (a null/None value SETS the key, it is not a delete).
    with closing(_connect()) as c, c:
        row = c.execute(
            "SELECT data FROM conversation_state WHERE path=?", (path,)
        ).fetchone()
        merged = json.loads(row[0]) if row else {}
        merged.update(patch)
        c.execute(
            "INSERT INTO conversation_state(path,data) VALUES(?,?) "
            "ON CONFLICT(path) DO UPDATE SET data=excluded.data",
            (path, json.dumps(merged)),
        )


def get_all_conversations() -> dict[str, dict]:
    """Every conversation_state row as {path: data-dict}. Small; loaded once at startup."""
    with closing(_connect()) as c, c:
        rows = c.execute("SELECT path, data FROM conversation_state").fetchall()
    return {path: json.loads(data) for path, data in rows}


def get_translations(keys: list[str]) -> dict[str, str]:
    if not keys:
        return {}
    q = ",".join("?" * len(keys))
    now = time.time()
    with closing(_connect()) as c, c:
        rows = c.execute(
            f"SELECT k, v FROM translation_cache WHERE k IN ({q})", keys
        ).fetchall()
        if rows:
            row_q = ",".join("?" * len(rows))
            c.execute(
                f"UPDATE translation_cache SET last_used=? WHERE k IN ({row_q})",
                [now, *[k for k, _ in rows]],
            )
    return {k: v for k, v in rows}


def put_translations(items: dict[str, str]) -> None:
    now = time.time()
    with closing(_connect()) as c, c:
        for k, v in items.items():
            c.execute(
                "INSERT INTO translation_cache(k,v,last_used) VALUES(?,?,?) "
                "ON CONFLICT(k) DO UPDATE SET v=excluded.v, last_used=excluded.last_used",
                (k, v, now),
            )
        (count,) = c.execute("SELECT COUNT(*) FROM translation_cache").fetchone()
        if count > _MAX_TRANSLATIONS:
            c.execute(
                "DELETE FROM translation_cache WHERE k IN ("
                "SELECT k FROM translation_cache ORDER BY last_used ASC LIMIT ?)",
                (count - _MAX_TRANSLATIONS,),
            )


def clear_translations() -> None:
    with closing(_connect()) as c, c:
        c.execute("DELETE FROM translation_cache")


def is_migrated() -> bool:
    return bool(get_prefs().get("_migrated"))


def migrate_dump(dump: dict) -> None:
    if is_migrated():
        return
    prefs = dump.get("prefs", {})
    public = {k: v for k, v in prefs.items() if not is_internal_pref(k)}
    if len(public) != len(prefs):
        logger.warning(
            "app_state_internal_prefs_dropped",
            source="migrate",
            count=len(prefs) - len(public),
        )
    set_prefs(public)
    for path, data in dump.get("conversations", {}).items():
        set_conversation(path, data)
    if dump.get("translations"):
        put_translations(dump["translations"])
    set_prefs({"_migrated": True})


# ---------------------------------------------------------------------------
# SD-BE-SVC-10: async off-loop wrappers.
#
# Every function above opens a fresh connection and does blocking SQLite I/O
# (worst case a `busy_timeout=5000` stall). The FastAPI handlers run on the
# event loop, so they must call these `a*` wrappers — each runs the sync body
# in a worker thread via `asyncio.to_thread`, keeping the UI backend responsive.
# The sync functions remain the source of truth (and stay usable from non-async
# callers such as startup migration); these are thin thread hops.
# ---------------------------------------------------------------------------


async def aget_prefs() -> dict[str, Any]:
    return await asyncio.to_thread(get_prefs)


async def aset_prefs(patch: dict[str, Any]) -> None:
    await asyncio.to_thread(set_prefs, patch)


async def aget_conversation(path: str) -> dict[str, Any]:
    return await asyncio.to_thread(get_conversation, path)


async def aset_conversation(path: str, patch: dict[str, Any]) -> None:
    await asyncio.to_thread(set_conversation, path, patch)


async def aget_all_conversations() -> dict[str, dict]:
    return await asyncio.to_thread(get_all_conversations)


async def aget_translations(keys: list[str]) -> dict[str, str]:
    return await asyncio.to_thread(get_translations, keys)


async def aput_translations(items: dict[str, str]) -> None:
    await asyncio.to_thread(put_translations, items)


async def aclear_translations() -> None:
    await asyncio.to_thread(clear_translations)


async def ais_migrated() -> bool:
    return await asyncio.to_thread(is_migrated)


async def amigrate_dump(dump: dict) -> None:
    await asyncio.to_thread(migrate_dump, dump)
