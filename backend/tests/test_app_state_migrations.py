# backend/tests/test_app_state_migrations.py
"""Versioned ``app_state`` migrations (``PRAGMA user_version``)."""

from __future__ import annotations

import sqlite3
import threading
from contextlib import closing

import pytest
from structlog.testing import capture_logs

from backend.services import app_state

NEW_TABLES = {
    "memories_capsule_notes",
    "memories_cover_overrides",
    "memories_gacha_pulls",
}
NEW_INDEXES = {"memories_capsule_by_anchor", "memories_capsule_by_created"}
OLD_TABLES = {"prefs", "conversation_state", "translation_cache", "favorite_log"}

# The version-0 schema exactly as the pre-migration ``init_db`` created it.
_V0_SCHEMA = """
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


def _names(path, kind: str) -> set[str]:
    with closing(sqlite3.connect(path)) as c:
        rows = c.execute(
            "SELECT name FROM sqlite_master WHERE type=? AND name NOT LIKE 'sqlite_%'",
            (kind,),
        ).fetchall()
    return {r[0] for r in rows}


def _version(path) -> int:
    with closing(sqlite3.connect(path)) as c:
        return int(c.execute("PRAGMA user_version").fetchone()[0])


@pytest.fixture
def db(tmp_path):
    path = tmp_path / "app_state.db"
    app_state.set_db_path(path)
    return path


def test_schema_version_matches_step_count():
    assert app_state.SCHEMA_VERSION == len(app_state._MIGRATIONS) == 1
    assert NEW_TABLES | NEW_INDEXES <= app_state._REQUIRED_SCHEMA


def test_fresh_db_ends_at_current_version_with_all_tables(db):
    app_state.init_db()
    assert _version(db) == app_state.SCHEMA_VERSION == 1
    assert OLD_TABLES | NEW_TABLES <= _names(db, "table")
    assert NEW_INDEXES <= _names(db, "index")


def test_version0_db_keeps_rows_and_gains_tables(db):
    with closing(sqlite3.connect(db)) as c, c:
        c.executescript(_V0_SCHEMA)
        c.execute("INSERT INTO prefs VALUES('language', '\"ja\"')")
        c.execute("INSERT INTO favorite_log VALUES('hinatazaka46', 7, 't')")
        c.execute("INSERT INTO translation_cache VALUES('1:ja', 'こんにちは🌸', 1.0)")
    assert _version(db) == 0

    with capture_logs() as logs:
        app_state.init_db()

    assert _version(db) == 1
    assert NEW_TABLES <= _names(db, "table")
    assert app_state.get_prefs() == {"language": "ja"}
    assert app_state.favorited_at("hinatazaka46", [7]) == {7: "t"}
    assert app_state.get_translations(["1:ja"]) == {"1:ja": "こんにちは🌸"}
    migrated = [e for e in logs if e["event"] == "app_state_migrate"]
    assert migrated and migrated[-1]["from_version"] == 0
    assert migrated[-1]["to_version"] == 1
    assert migrated[-1]["steps"] == 1


def test_init_db_twice_is_a_noop(db):
    app_state.init_db()
    app_state.set_prefs({"k": 1})
    with capture_logs() as logs:
        app_state.init_db()
    assert _version(db) == 1
    assert app_state.get_prefs() == {"k": 1}
    events = [e for e in logs if e["event"] == "app_state_migrate"]
    assert events and events[-1]["outcome"] == "current"
    assert "steps" not in events[-1]


def test_dropped_table_at_current_version_heals(db):
    app_state.init_db()
    with closing(sqlite3.connect(db)) as c, c:
        c.execute("DROP TABLE memories_capsule_notes")
    assert _version(db) == 1
    with capture_logs() as logs:
        app_state.init_db()
    assert _version(db) == 1
    assert NEW_TABLES <= _names(db, "table")
    assert NEW_INDEXES <= _names(db, "index")
    events = [e for e in logs if e["event"] == "app_state_migrate"]
    assert events[-1]["outcome"] == "healed"
    assert events[-1]["missing"] == 3  # the table and its two indexes


def test_half_applied_step_at_old_version_heals(db):
    app_state.init_db()
    with closing(sqlite3.connect(db)) as c, c:
        c.execute("DROP TABLE memories_capsule_notes")
        c.execute("PRAGMA user_version = 0")
    app_state.init_db()
    assert _version(db) == 1
    assert NEW_TABLES <= _names(db, "table")
    assert NEW_INDEXES <= _names(db, "index")


def test_newer_version_db_is_left_untouched(db):
    """A DB written by a newer app (downgrade) is neither re-migrated nor lowered."""
    with closing(sqlite3.connect(db)) as c, c:
        c.executescript(_V0_SCHEMA)
        c.execute("PRAGMA user_version = 99")
    with capture_logs() as logs:
        app_state.init_db()
    assert _version(db) == 99
    assert not (NEW_TABLES & _names(db, "table"))
    events = [e for e in logs if e["event"] == "app_state_migrate"]
    assert events[-1]["outcome"] == "newer_schema"
    assert events[-1]["from_version"] == 99


def test_failing_step_rolls_back_and_reraises(db, monkeypatch):
    def boom(c: sqlite3.Connection) -> None:
        c.execute("CREATE TABLE half (x)")
        raise sqlite3.OperationalError("boom")

    monkeypatch.setattr(app_state, "_MIGRATIONS", (boom,))
    monkeypatch.setattr(app_state, "SCHEMA_VERSION", 1)
    with capture_logs() as logs, pytest.raises(sqlite3.OperationalError):
        app_state.init_db()
    assert _version(db) == 0
    assert "half" not in _names(db, "table")
    err = [e for e in logs if e.get("outcome") == "error"]
    assert err and err[-1]["error_type"] == "OperationalError"
    assert err[-1]["step"] == 1


def test_connect_alias_kept():
    assert app_state._connect is app_state.connect


def test_dropped_index_at_current_version_heals(db):
    app_state.init_db()
    with closing(sqlite3.connect(db)) as c, c:
        c.execute("DROP INDEX memories_capsule_by_created")
    with capture_logs() as logs:
        app_state.init_db()
    assert NEW_INDEXES <= _names(db, "index")
    events = [e for e in logs if e["event"] == "app_state_migrate"]
    assert events[-1]["outcome"] == "healed"


def test_begin_lock_failure_leaves_breadcrumb(db, monkeypatch):
    app_state.init_db()

    class LockedConn:
        def execute(self, sql, *a):
            raise sqlite3.OperationalError("database is locked")

        def rollback(self):
            pass

    with capture_logs() as logs, pytest.raises(sqlite3.OperationalError):
        app_state._migrate(LockedConn())  # type: ignore[arg-type]
    err = [e for e in logs if e.get("outcome") == "error"]
    assert err and err[-1]["step"] == 0
    assert err[-1]["error_type"] == "OperationalError"


def test_concurrent_first_start(db):
    n = 8
    barrier = threading.Barrier(n)
    errors: list[BaseException] = []

    def worker():
        barrier.wait()
        try:
            app_state.init_db()
        except BaseException as exc:  # noqa: BLE001 - collected for the assert
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert _version(db) == 1
    assert OLD_TABLES | NEW_TABLES <= _names(db, "table")
    assert NEW_INDEXES <= _names(db, "index")
