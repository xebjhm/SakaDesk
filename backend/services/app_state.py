# backend/services/app_state.py
"""Port-independent app state (SQLite, WAL). Source of truth for state the
frontend used to keep in origin-scoped localStorage."""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any, Optional

from backend.services.platform import get_app_data_dir

_db_path: Optional[Path] = None
_MAX_TRANSLATIONS = 50000


def set_db_path(path: Path) -> None:
    global _db_path
    _db_path = path


def _path() -> Path:
    return _db_path or (get_app_data_dir() / "app_state.db")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_path())
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init_db() -> None:
    with _connect() as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS prefs (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE IF NOT EXISTS conversation_state (path TEXT PRIMARY KEY, data TEXT);
            CREATE TABLE IF NOT EXISTS translation_cache (
                k TEXT PRIMARY KEY, v TEXT, last_used REAL
            );
            """
        )


def get_prefs() -> dict[str, Any]:
    with _connect() as c:
        rows = c.execute("SELECT key, value FROM prefs").fetchall()
    return {k: json.loads(v) for k, v in rows}


def set_prefs(patch: dict[str, Any]) -> None:
    with _connect() as c:
        for k, v in patch.items():
            c.execute(
                "INSERT INTO prefs(key,value) VALUES(?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (k, json.dumps(v)),
            )


def get_conversation(path: str) -> dict[str, Any]:
    with _connect() as c:
        row = c.execute(
            "SELECT data FROM conversation_state WHERE path=?", (path,)
        ).fetchone()
    return json.loads(row[0]) if row else {}


def set_conversation(path: str, patch: dict[str, Any]) -> None:
    merged = get_conversation(path)
    merged.update(patch)
    with _connect() as c:
        c.execute(
            "INSERT INTO conversation_state(path,data) VALUES(?,?) "
            "ON CONFLICT(path) DO UPDATE SET data=excluded.data",
            (path, json.dumps(merged)),
        )


def get_all_conversations() -> dict[str, dict]:
    """Every conversation_state row as {path: data-dict}. Small; loaded once at startup."""
    with _connect() as c:
        rows = c.execute("SELECT path, data FROM conversation_state").fetchall()
    return {path: json.loads(data) for path, data in rows}


def get_translations(keys: list[str]) -> dict[str, str]:
    if not keys:
        return {}
    q = ",".join("?" * len(keys))
    now = time.time()
    with _connect() as c:
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
    with _connect() as c:
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
    with _connect() as c:
        c.execute("DELETE FROM translation_cache")


def is_migrated() -> bool:
    return bool(get_prefs().get("_migrated"))


def migrate_dump(dump: dict) -> None:
    if is_migrated():
        return
    set_prefs(dump.get("prefs", {}))
    for path, data in dump.get("conversations", {}).items():
        set_conversation(path, data)
    if dump.get("translations"):
        put_translations(dump["translations"])
    set_prefs({"_migrated": True})
