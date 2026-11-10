# backend/tests/test_memories_notify_store.py
"""M4 storage: the Memories notify ledger, the card baseline and settings keys."""

from __future__ import annotations

import asyncio
import json
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta, timezone

import pytest
from structlog.testing import capture_logs

from backend.services import app_state, settings_store
from backend.services.memories import notify_scheduler

M4_TABLES = {"memories_notify_log", "memories_card_baseline"}

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

AT = datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc)


def _tables(path) -> set[str]:
    with closing(sqlite3.connect(path)) as c:
        rows = c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    return {r[0] for r in rows}


def _version(path) -> int:
    with closing(sqlite3.connect(path)) as c:
        return int(c.execute("PRAGMA user_version").fetchone()[0])


@pytest.fixture
def db(tmp_path):
    path = tmp_path / "app_state.db"
    app_state.set_db_path(path)
    return path


@pytest.fixture
def fresh(db):
    app_state.init_db()
    return db


# ---------------------------------------------------------------------------
# Migration step 2
# ---------------------------------------------------------------------------


def test_schema_version_is_two_and_tables_required():
    assert app_state.SCHEMA_VERSION == len(app_state._MIGRATIONS) == 2
    assert M4_TABLES <= app_state._REQUIRED_SCHEMA


def test_fresh_db_has_m4_tables(fresh):
    assert M4_TABLES <= _tables(fresh)
    assert _version(fresh) == 2


def test_version0_db_with_old_tables_gains_m4_tables(db):
    with closing(sqlite3.connect(db)) as c, c:
        c.executescript(_V0_SCHEMA)
        c.execute("INSERT INTO favorite_log VALUES('hinatazaka46', 7, 't')")
    app_state.init_db()
    assert M4_TABLES <= _tables(db)
    assert _version(db) == 2
    assert app_state.favorited_at("hinatazaka46", [7]) == {7: "t"}


def test_version1_db_goes_to_version2_and_keeps_rows(db):
    with closing(sqlite3.connect(db)) as c, c:
        c.executescript(_V0_SCHEMA)
        app_state._step1_memories_user_state(c)
        c.execute("INSERT INTO favorite_log VALUES('hinatazaka46', 7, 't')")
        c.execute(
            "INSERT INTO memories_gacha_pulls VALUES"
            "('hinatazaka46','2026-11-10',0,'r',1,'n','x','t')"
        )
        c.execute("PRAGMA user_version = 1")
    with capture_logs() as logs:
        app_state.init_db()
    assert _version(db) == 2
    assert M4_TABLES <= _tables(db)
    assert app_state.favorited_at("hinatazaka46", [7]) == {7: "t"}
    with closing(sqlite3.connect(db)) as c:
        assert c.execute("SELECT COUNT(*) FROM memories_gacha_pulls").fetchone()[0] == 1
    ev = [e for e in logs if e["event"] == "app_state_migrate"][-1]
    assert (ev["outcome"], ev["from_version"], ev["to_version"], ev["steps"]) == (
        "migrated",
        1,
        2,
        1,
    )


def test_second_init_is_a_noop(fresh):
    app_state.claim_memory_notification("on_this_day", "*", "", "2026-11-10", at=AT)
    with capture_logs() as logs:
        app_state.init_db()
    ev = [e for e in logs if e["event"] == "app_state_migrate"][-1]
    assert ev["outcome"] == "current"
    assert app_state.memory_notifications_done(
        [("on_this_day", "*", "", "2026-11-10")]
    ) == {("on_this_day", "*", "", "2026-11-10")}


def test_dropped_m4_table_heals_and_keeps_other(fresh):
    app_state.put_card_baseline("hinatazaka46", "58", ["a"], "h")
    with closing(sqlite3.connect(fresh)) as c, c:
        c.execute("DROP TABLE memories_notify_log")
    with capture_logs() as logs:
        app_state.init_db()
    assert M4_TABLES <= _tables(fresh)
    assert app_state.get_card_baseline("hinatazaka46", "58") == (frozenset({"a"}), "h")
    ev = [e for e in logs if e["event"] == "app_state_migrate"][-1]
    assert ev["outcome"] == "healed" and ev["missing"] == 1


def test_newer_db_is_left_untouched(db):
    with closing(sqlite3.connect(db)) as c, c:
        c.executescript(_V0_SCHEMA)
        c.execute("PRAGMA user_version = 3")
    app_state.init_db()
    assert _version(db) == 3
    assert not (M4_TABLES & _tables(db))


def test_tables_store_no_names(fresh):
    """Only ids / codes / keys: no name, nickname, title, body or path column."""
    with closing(sqlite3.connect(fresh)) as c:
        cols = {
            t: {r[1] for r in c.execute(f"PRAGMA table_info({t})").fetchall()}
            for t in M4_TABLES
        }
    assert cols["memories_notify_log"] == {
        "kind",
        "service",
        "subject",
        "occasion",
        "outcome",
        "at",
    }
    assert cols["memories_card_baseline"] == {
        "service",
        "member_id",
        "keys",
        "data_hash",
        "at",
    }


# ---------------------------------------------------------------------------
# Notify ledger
# ---------------------------------------------------------------------------


def _row(path, key):
    with closing(sqlite3.connect(path)) as c:
        return c.execute(
            "SELECT outcome, at FROM memories_notify_log "
            "WHERE kind=? AND service=? AND subject=? AND occasion=?",
            key,
        ).fetchone()


def test_claim_once_then_finish(fresh):
    key = ("birthday", "hinatazaka46", "58", "2026-11-10")
    assert app_state.claim_memory_notification(*key, at=AT) is True
    assert _row(fresh, key) == ("pending", AT.isoformat())
    later = AT + timedelta(minutes=1)
    assert app_state.claim_memory_notification(*key, "empty", at=later) is False
    assert _row(fresh, key) == ("pending", AT.isoformat())
    app_state.finish_memory_notification(*key, "sent", at=later)
    assert _row(fresh, key) == ("sent", later.isoformat())


def test_claim_with_terminal_outcome_and_default_time(fresh):
    key = ("on_this_day", "*", "", "2026-11-10")
    before = datetime.now(timezone.utc)
    assert app_state.claim_memory_notification(*key, "empty") is True
    outcome, at = _row(fresh, key)
    assert outcome == "empty"
    assert datetime.fromisoformat(at) >= before
    app_state.finish_memory_notification(*key, "suppressed")
    assert _row(fresh, key)[0] == "suppressed"


def test_naive_or_offset_times_are_stored_as_utc(fresh):
    key = ("recap", "hinatazaka46", "open", "2026")
    jst = timezone(timedelta(hours=9))
    app_state.claim_memory_notification(*key, at=AT.astimezone(jst))
    assert _row(fresh, key)[1] == AT.isoformat()


@pytest.mark.parametrize("outcome", ["done", "", "SENT"])
def test_unknown_outcome_is_rejected(fresh, outcome):
    key = ("card", "hinatazaka46", "58", "moment.synchro")
    with pytest.raises(ValueError):
        app_state.claim_memory_notification(*key, outcome)
    with pytest.raises(ValueError):
        app_state.finish_memory_notification(*key, outcome)


def test_done_returns_only_claimed_keys_across_chunks(fresh):
    keys = [
        ("anniversary", "hinatazaka46", str(i), f"d100@2026-11-{i % 28 + 1:02d}")
        for i in range(1200)
    ]
    claimed = set(keys[::2])
    for k in claimed:
        app_state.claim_memory_notification(*k, at=AT)
    assert app_state.memory_notifications_done(keys + keys[:3]) == claimed
    assert app_state.memory_notifications_done([]) == set()


def test_non_ascii_and_dotted_keys_round_trip(fresh):
    key = ("card", "日向坂46", "58", "special.birthday@2026")
    assert app_state.claim_memory_notification(*key, at=AT) is True
    assert app_state.memory_notifications_done([key]) == {key}


def test_prune_removes_old_rows_only(fresh):
    old = ("on_this_day", "*", "", "2025-01-01")
    new = ("on_this_day", "*", "", "2026-11-10")
    app_state.claim_memory_notification(*old, at=AT - timedelta(days=500))
    app_state.claim_memory_notification(*new, at=AT)
    assert app_state.prune_memory_notifications(AT - timedelta(days=400)) == 1
    assert app_state.memory_notifications_done([old, new]) == {new}
    assert app_state.prune_memory_notifications(AT - timedelta(days=400)) == 0


# ---------------------------------------------------------------------------
# Card baseline
# ---------------------------------------------------------------------------


def test_card_baseline_round_trip_sorted(fresh):
    assert app_state.get_card_baseline("hinatazaka46", "58") is None
    app_state.put_card_baseline(
        "hinatazaka46", "58", ["moment.synchro", "first.nickname", "a"], "h1"
    )
    assert app_state.get_card_baseline("hinatazaka46", "58") == (
        frozenset({"a", "first.nickname", "moment.synchro"}),
        "h1",
    )
    with closing(sqlite3.connect(fresh)) as c:
        raw = c.execute("SELECT keys FROM memories_card_baseline").fetchone()[0]
    assert json.loads(raw) == ["a", "first.nickname", "moment.synchro"]
    app_state.put_card_baseline("hinatazaka46", "58", {"special.birthday@2026"}, "h2")
    assert app_state.get_card_baseline("hinatazaka46", "58") == (
        frozenset({"special.birthday@2026"}),
        "h2",
    )


def test_clear_card_baselines_returns_count(fresh):
    app_state.put_card_baseline("hinatazaka46", "58", [], "h")
    app_state.put_card_baseline("sakurazaka46", "7", ["a"], "h")
    assert app_state.clear_card_baselines() == 2
    assert app_state.get_card_baseline("hinatazaka46", "58") is None
    assert app_state.clear_card_baselines() == 0


def test_async_wrappers(fresh):
    key = ("birthday_soon", "hinatazaka46", "58", "2026-11-17:7")

    async def run():
        assert await app_state.aclaim_memory_notification(*key, at=AT) is True
        await app_state.afinish_memory_notification(*key, "failed", at=AT)
        assert await app_state.amemory_notifications_done([key]) == {key}
        await app_state.aput_card_baseline("hinatazaka46", "58", ["b", "a"], "h")
        assert await app_state.aget_card_baseline("hinatazaka46", "58") == (
            frozenset({"a", "b"}),
            "h",
        )
        assert await app_state.aclear_card_baselines() == 1
        assert await app_state.aprune_memory_notifications(AT + timedelta(1)) == 1

    asyncio.run(run())
    assert _row(fresh, key) is None


# ---------------------------------------------------------------------------
# Settings keys
# ---------------------------------------------------------------------------

NOTIFY_DEFAULTS = {
    "memories_notify_on_this_day": True,
    "memories_notify_birthday": True,
    "memories_notify_anniversary": True,
    "memories_notify_recap": True,
    "memories_notify_cards": False,
    "memories_notify_time": "12:00",
}


def test_store_defaults():
    for key, value in NOTIFY_DEFAULTS.items():
        assert settings_store._SETTINGS_DEFAULTS[key] == value


@pytest.mark.parametrize("value", ["00:00", "07:30", "23:59", "12:00"])
def test_resolve_notify_time_accepts_valid(value):
    assert settings_store.resolve_memories_notify_time(value) == value


@pytest.mark.parametrize(
    "value",
    [
        "24:00",
        "7:30",
        "12:00:00",
        "12:60",
        "12:00\n",
        "",
        None,
        1200,
        "１２:００",
        "1٢:00",
        "1２:3０",
    ],
)
def test_resolve_notify_time_falls_back_with_breadcrumb(value):
    settings_store.reset_notify_time_warnings_for_tests()
    with capture_logs() as logs:
        assert settings_store.resolve_memories_notify_time(value) == "12:00"
    ev = [e for e in logs if e["event"] == "memories_notify_time_invalid"]
    assert ev and ev[-1]["fallback"] == "12:00"
    assert ev[-1]["value_type"] == type(value).__name__


@pytest.fixture
def settings_env(tmp_path, monkeypatch, db):
    monkeypatch.setenv("SAKADESK_DATA_DIR", str(tmp_path))
    app_state.init_db()
    calls: list[int] = []
    monkeypatch.setattr(
        notify_scheduler,
        "memories_notify_settings_changed",
        lambda: calls.append(1),
    )
    return tmp_path, calls


def test_get_settings_has_notify_defaults(client, settings_env):
    body = client.get("/api/settings").json()
    for key, value in NOTIFY_DEFAULTS.items():
        assert body[key] == value


def test_get_settings_invalid_stored_time_falls_back(client, settings_env):
    tmp_path, _ = settings_env
    (tmp_path / "settings.json").write_text(
        json.dumps({"memories_notify_time": "25:99"}), encoding="utf-8"
    )
    assert client.get("/api/settings").json()["memories_notify_time"] == "12:00"


def test_post_notify_time_persists_and_wakes(client, settings_env):
    tmp_path, calls = settings_env
    r = client.post("/api/settings", json={"memories_notify_time": "07:30"})
    assert r.status_code == 200
    assert r.json()["memories_notify_time"] == "07:30"
    saved = json.loads((tmp_path / "settings.json").read_text(encoding="utf-8"))
    assert saved["memories_notify_time"] == "07:30"
    assert calls == [1]


def test_post_all_toggles_round_trip(client, settings_env):
    patch = {
        "memories_notify_on_this_day": False,
        "memories_notify_birthday": False,
        "memories_notify_anniversary": False,
        "memories_notify_recap": False,
    }
    body = client.post("/api/settings", json=patch).json()
    for key, value in patch.items():
        assert body[key] is value


@pytest.mark.parametrize(
    "value", ["24:00", "7:30", "12:00:00", "12:00\n", "１２:００", "0٧:30", "1２:3０"]
)
def test_post_bad_notify_time_is_422(client, settings_env, value):
    _, calls = settings_env
    r = client.post("/api/settings", json={"memories_notify_time": value})
    assert r.status_code == 422
    assert calls == []


def test_unchanged_notify_value_does_not_wake(client, settings_env):
    _, calls = settings_env
    client.post("/api/settings", json={"memories_notify_birthday": True})
    client.post("/api/settings", json={"close_to_tray": False})
    assert calls == []


def test_enabling_cards_clears_baselines(client, settings_env):
    _, calls = settings_env
    app_state.put_card_baseline("hinatazaka46", "58", ["a"], "h")
    with capture_logs() as logs:
        r = client.post("/api/settings", json={"memories_notify_cards": True})
    assert r.json()["memories_notify_cards"] is True
    assert app_state.get_card_baseline("hinatazaka46", "58") is None
    ev = [e for e in logs if e["event"] == "memories_notify_cards_enabled"]
    assert ev and ev[-1]["cleared"] == 1
    assert calls == [1]


def test_cards_true_to_true_keeps_baselines(client, settings_env):
    client.post("/api/settings", json={"memories_notify_cards": True})
    app_state.put_card_baseline("hinatazaka46", "58", ["a"], "h")
    client.post("/api/settings", json={"memories_notify_cards": True})
    assert app_state.get_card_baseline("hinatazaka46", "58") == (
        frozenset({"a"}),
        "h",
    )
    client.post("/api/settings", json={"memories_notify_cards": False})
    assert app_state.get_card_baseline("hinatazaka46", "58") is not None


def test_settings_changed_stub_logs_not_woken():
    with capture_logs() as logs:
        notify_scheduler.memories_notify_settings_changed()
    ev = [e for e in logs if e["event"] == "memories_notify_wake_requested"]
    assert ev and ev[-1]["woken"] is False


# ---------------------------------------------------------------------------
# Task 1 review carry-overs (fixed in Task 5)


def test_invalid_notify_time_warns_once_per_value():
    settings_store.reset_notify_time_warnings_for_tests()
    with capture_logs() as logs:
        for _ in range(3):
            settings_store.resolve_memories_notify_time("25:99")
        settings_store.resolve_memories_notify_time([1])
        settings_store.resolve_memories_notify_time([1])
        settings_store.resolve_memories_notify_time("7:30")
    ev = [e for e in logs if e["event"] == "memories_notify_time_invalid"]
    assert [e["value_type"] for e in ev] == ["str", "list", "str"]


def test_get_settings_invalid_time_warns_once(client, settings_env):
    tmp_path, _ = settings_env
    settings_store.reset_notify_time_warnings_for_tests()
    (tmp_path / "settings.json").write_text(
        json.dumps({"memories_notify_time": "99:99"}), encoding="utf-8"
    )
    with capture_logs() as logs:
        client.get("/api/settings")
        client.get("/api/settings")
    assert len([e for e in logs if e["event"] == "memories_notify_time_invalid"]) == 1


def test_enabling_cards_clears_baselines_before_saving(
    client, settings_env, monkeypatch
):
    tmp_path, calls = settings_env
    seen: list[object] = []
    real = app_state.clear_card_baselines

    def spy() -> int:
        path = tmp_path / "settings.json"
        saved = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        seen.append(saved.get("memories_notify_cards", False))
        return real()

    monkeypatch.setattr(app_state, "clear_card_baselines", spy)
    r = client.post("/api/settings", json={"memories_notify_cards": True})
    assert r.status_code == 200
    assert seen == [False]  # cleared while the stored toggle was still off
    assert calls == [1]


def test_cards_clear_failure_is_a_clean_error_and_saves_nothing(
    client, settings_env, monkeypatch
):
    tmp_path, calls = settings_env

    def boom() -> int:
        raise sqlite3.OperationalError("locked")

    monkeypatch.setattr(app_state, "clear_card_baselines", boom)
    with capture_logs() as logs:
        r = client.post(
            "/api/settings",
            json={"memories_notify_cards": True, "close_to_tray": False},
        )
    assert r.status_code == 503
    assert r.json()["detail"] == "memories_cards_reset_failed"
    path = tmp_path / "settings.json"
    saved = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    assert not saved.get("memories_notify_cards", False)
    assert saved.get("close_to_tray", True) is True
    ev = [e for e in logs if e["event"] == "memories_notify_cards_enabled_failed"]
    assert ev and ev[-1]["error_type"] == "OperationalError"
    assert calls == []
    assert client.get("/api/settings").json()["memories_notify_cards"] is False


def test_concurrent_claims_of_one_occasion_yield_one_true(fresh):
    from concurrent.futures import ThreadPoolExecutor

    key = ("on_this_day", "*", "", "2026-11-10")
    for attempt in range(5):
        k = (*key[:3], f"{key[3]}#{attempt}")
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(
                pool.map(lambda _: app_state.claim_memory_notification(*k), range(8))
            )
        assert results.count(True) == 1


@pytest.mark.asyncio
async def test_concurrent_async_claims_yield_one_true(fresh):
    key = ("birthday", "hinatazaka46", "58", "2026-09-10")
    results = await asyncio.gather(
        *(app_state.aclaim_memory_notification(*key) for _ in range(6))
    )
    assert results.count(True) == 1


def test_global_notifications_switch_wakes_the_memories_scheduler(client, settings_env):
    _, calls = settings_env
    client.post("/api/settings", json={"notifications_enabled": False})
    assert calls == [1]
    client.post("/api/settings", json={"notifications_enabled": False})
    assert calls == [1]  # unchanged: no wake
    client.post("/api/settings", json={"notifications_enabled": True})
    assert calls == [1, 1]
