# backend/tests/test_memories_favorite_log.py
from datetime import datetime, timezone

from backend.services import app_state


def _fresh(tmp_path):
    app_state.set_db_path(tmp_path / "app_state.db")
    app_state.init_db()
    return app_state


def test_favorite_log_roundtrip(tmp_path):
    s = _fresh(tmp_path)
    at = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)
    s.record_favorite("hinatazaka46", 101, True, at=at)
    assert s.favorited_at("hinatazaka46", [101, 102]) == {101: at.isoformat()}
    s.record_favorite("hinatazaka46", 101, False)
    assert s.favorited_at("hinatazaka46", [101]) == {}


def test_favorite_log_is_scoped_per_service(tmp_path):
    s = _fresh(tmp_path)
    at = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)
    s.record_favorite("hinatazaka46", 7, True, at=at)
    assert s.favorited_at("sakurazaka46", [7]) == {}


def test_favorite_log_upsert_keeps_latest_time(tmp_path):
    s = _fresh(tmp_path)
    first = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)
    later = datetime(2026, 11, 11, 9, 30, tzinfo=timezone.utc)
    s.record_favorite("hinatazaka46", 5, True, at=first)
    s.record_favorite("hinatazaka46", 5, True, at=later)
    assert s.favorited_at("hinatazaka46", [5]) == {5: later.isoformat()}


def test_favorite_log_defaults_to_utc_now(tmp_path):
    s = _fresh(tmp_path)
    before = datetime.now(timezone.utc)
    s.record_favorite("hinatazaka46", 9, True)
    after = datetime.now(timezone.utc)
    stored = datetime.fromisoformat(s.favorited_at("hinatazaka46", [9])[9])
    assert stored.tzinfo is not None
    assert before <= stored <= after


def test_favorite_log_empty_input_and_unknown_ids(tmp_path):
    s = _fresh(tmp_path)
    assert s.favorited_at("hinatazaka46", []) == {}
    assert s.favorited_at("hinatazaka46", [404]) == {}


def test_favorite_log_unfavorite_missing_row_is_noop(tmp_path):
    s = _fresh(tmp_path)
    s.record_favorite("hinatazaka46", 33, False)
    assert s.favorited_at("hinatazaka46", [33]) == {}


def test_favorited_at_chunks_large_id_lists(tmp_path):
    s = _fresh(tmp_path)
    at = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)
    logged = {5, 499, 500, 501, 999, 1000, 1199}
    for mid in logged:
        s.record_favorite("hinatazaka46", mid, True, at=at)
    result = s.favorited_at("hinatazaka46", list(range(1200)))
    assert set(result) == logged
    assert all(v == at.isoformat() for v in result.values())


def test_app_state_closes_every_connection(tmp_path, monkeypatch):
    import sqlite3

    opened: list = []
    real_connect = sqlite3.connect

    class Tracked:
        def __init__(self, conn):
            self.conn, self.closed = conn, False

        def close(self):
            self.closed = True
            self.conn.close()

        def __getattr__(self, name):
            return getattr(self.conn, name)

        def __enter__(self):
            return self.conn.__enter__()

        def __exit__(self, *a):
            return self.conn.__exit__(*a)

    def tracking(*a, **kw):
        t = Tracked(real_connect(*a, **kw))
        opened.append(t)
        return t

    s = _fresh(tmp_path)
    monkeypatch.setattr(app_state.sqlite3, "connect", tracking)
    s.init_db()
    s.record_favorite("hinatazaka46", 1, True)
    s.record_favorite("hinatazaka46", 1, False)
    s.favorited_at("hinatazaka46", [1])
    s.set_prefs({"a": 1})
    s.get_prefs()
    s.set_conversation("p", {"k": "日本語"})
    s.get_conversation("p")
    s.put_translations({"k": "v"})
    s.get_translations(["k"])
    assert len(opened) == 10 and all(t.closed for t in opened)
