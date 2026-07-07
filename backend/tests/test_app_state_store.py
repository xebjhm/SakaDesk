# backend/tests/test_app_state_store.py
from backend.services import app_state


def _fresh(tmp_path):
    app_state.set_db_path(tmp_path / "app_state.db")
    app_state.init_db()
    return app_state


def test_prefs_round_trip_and_partial_update(tmp_path):
    s = _fresh(tmp_path)
    assert s.get_prefs() == {}
    s.set_prefs({"tos_accepted_at": "2026-07-07T00:00:00Z", "language": "zh-TW"})
    s.set_prefs({"language": "ja"})  # partial: keeps tos
    p = s.get_prefs()
    assert p["tos_accepted_at"] == "2026-07-07T00:00:00Z"
    assert p["language"] == "ja"


def test_conversation_state_round_trip(tmp_path):
    s = _fresh(tmp_path)
    s.set_conversation("hinatazaka46/1", {"scroll_msg_id": 42, "read_up_to": 41})
    s.set_conversation("hinatazaka46/1", {"background": "dark"})
    assert s.get_conversation("hinatazaka46/1") == {
        "scroll_msg_id": 42,
        "read_up_to": 41,
        "background": "dark",
    }
    assert s.get_conversation("unknown") == {}


def test_translation_cache_and_lru(tmp_path, monkeypatch):
    s = _fresh(tmp_path)
    monkeypatch.setattr(s, "_MAX_TRANSLATIONS", 2)
    s.put_translations({"1:ja": "A", "2:ja": "B"})
    assert s.get_translations(["1:ja", "2:ja"]) == {"1:ja": "A", "2:ja": "B"}
    s.get_translations(["1:ja"])  # touch 1 -> newest
    s.put_translations({"3:ja": "C"})  # over cap -> evict LRU (2)
    got = s.get_translations(["1:ja", "2:ja", "3:ja"])
    assert "2:ja" not in got and got["1:ja"] == "A" and got["3:ja"] == "C"


def test_get_all_conversations_returns_all_rows_keyed_by_path(tmp_path):
    s = _fresh(tmp_path)
    assert s.get_all_conversations() == {}
    s.set_conversation("hinatazaka46/1", {"scroll_msg_id": 42})
    s.set_conversation("sakurazaka46/2", {"read_up_to": 7})
    assert s.get_all_conversations() == {
        "hinatazaka46/1": {"scroll_msg_id": 42},
        "sakurazaka46/2": {"read_up_to": 7},
    }


def test_migrate_dump_is_idempotent(tmp_path):
    s = _fresh(tmp_path)
    assert s.is_migrated() is False
    s.migrate_dump(
        {
            "prefs": {"language": "yue"},
            "conversations": {"a/1": {"read_up_to": 9}},
            "translations": {"5:ja": "x"},
        }
    )
    assert s.is_migrated() is True
    s.migrate_dump({"prefs": {"language": "en"}})  # ignored once migrated
    assert s.get_prefs()["language"] == "yue"
