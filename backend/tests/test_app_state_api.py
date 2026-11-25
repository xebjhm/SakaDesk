# backend/tests/test_app_state_api.py
from structlog.testing import capture_logs

from backend.api.app_state import MAX_TRANSLATION_KEYS
from backend.services import app_state


def test_prefs_and_migrate_endpoints(client, tmp_path):
    app_state.set_db_path(tmp_path / "app_state.db")
    app_state.init_db()

    assert client.get("/api/app-state/migrate").json() == {"migrated": False}
    client.patch("/api/app-state/prefs", json={"language": "ja"})
    assert client.get("/api/app-state/prefs").json()["language"] == "ja"

    client.post("/api/app-state/migrate", json={"prefs": {"volume": 0.5}})
    assert client.get("/api/app-state/migrate").json() == {"migrated": True}
    assert client.get("/api/app-state/prefs").json()["volume"] == 0.5


def test_conversation_and_translations_endpoints(client, tmp_path):
    app_state.set_db_path(tmp_path / "app_state.db")
    app_state.init_db()
    client.patch("/api/app-state/conversation?path=a/1", json={"read_up_to": 9})
    assert client.get("/api/app-state/conversation?path=a/1").json()["read_up_to"] == 9
    client.patch("/api/app-state/translations", json={"1:ja": "hi"})
    assert client.get("/api/app-state/translations?keys=1:ja").json() == {"1:ja": "hi"}


def test_translations_clear_endpoint(client, tmp_path):
    app_state.set_db_path(tmp_path / "app_state.db")
    app_state.init_db()
    client.patch("/api/app-state/translations", json={"1:ja": "hi"})
    assert client.get("/api/app-state/translations?keys=1:ja").json() == {"1:ja": "hi"}
    resp = client.post("/api/app-state/translations/clear")
    assert resp.json() == {"ok": True}
    assert client.get("/api/app-state/translations?keys=1:ja").json() == {}


def test_conversation_all_endpoint(client, tmp_path):
    app_state.set_db_path(tmp_path / "app_state.db")
    app_state.init_db()
    client.patch("/api/app-state/conversation?path=a/1", json={"read_up_to": 9})
    client.patch("/api/app-state/conversation?path=b/2", json={"scroll_msg_id": 3})
    got = client.get("/api/app-state/conversation-all").json()
    assert got["a/1"] == {"read_up_to": 9}
    assert got["b/2"] == {"scroll_msg_id": 3}


def test_translations_batch_lookup_returns_only_known_keys(client, tmp_path):
    app_state.set_db_path(tmp_path / "app_state.db")
    app_state.init_db()
    client.patch("/api/app-state/translations", json={"a:1": "x", "a:2": "y"})
    got = client.get("/api/app-state/translations?keys=a:1,a:2,a:3,a:1,,").json()
    assert got == {"a:1": "x", "a:2": "y"}


def test_translations_batch_accepts_exactly_max_keys(client, tmp_path):
    app_state.set_db_path(tmp_path / "app_state.db")
    app_state.init_db()
    keys = ",".join(f"k:{i}" for i in range(MAX_TRANSLATION_KEYS))
    assert client.get(f"/api/app-state/translations?keys={keys}").json() == {}


def test_translations_batch_over_max_is_rejected_and_logged(client, tmp_path):
    app_state.set_db_path(tmp_path / "app_state.db")
    app_state.init_db()
    keys = ",".join(f"k:{i}" for i in range(MAX_TRANSLATION_KEYS + 1))
    with capture_logs() as logs:
        resp = client.get(f"/api/app-state/translations?keys={keys}")
    assert resp.status_code == 422
    [entry] = [e for e in logs if e["event"] == "translations_lookup_rejected"]
    assert entry["log_level"] == "warning"
    assert entry["count"] == MAX_TRANSLATION_KEYS + 1
    assert "k:0" not in str(entry)


def test_translations_batch_duplicates_do_not_count_toward_max(client, tmp_path):
    app_state.set_db_path(tmp_path / "app_state.db")
    app_state.init_db()
    keys = ",".join(["k:1"] * (MAX_TRANSLATION_KEYS * 2))
    assert client.get(f"/api/app-state/translations?keys={keys}").status_code == 200


def test_prefs_api_hides_and_refuses_internal_memories_keys(client, tmp_path):
    app_state.set_db_path(tmp_path / "app_state.db")
    app_state.init_db()
    app_state.set_prefs({"memories_gacha_salt": "0123456789abcdef", "language": "ja"})

    got = client.get("/api/app-state/prefs").json()
    assert got == {"language": "ja"}

    resp = client.patch(
        "/api/app-state/prefs",
        json={"memories_gacha_salt": "ffffffffffffffff", "language": "en"},
    )
    assert resp.status_code == 400
    prefs = app_state.get_prefs()
    assert prefs["memories_gacha_salt"] == "0123456789abcdef"
    assert prefs["language"] == "ja"  # rejected as a whole


def test_migrate_dump_drops_internal_memories_keys(client, tmp_path):
    app_state.set_db_path(tmp_path / "app_state.db")
    app_state.init_db()
    app_state.set_prefs({"memories_gacha_salt": "0123456789abcdef"})
    client.post(
        "/api/app-state/migrate",
        json={"prefs": {"memories_gacha_salt": "ffffffffffffffff", "volume": 0.5}},
    )
    prefs = app_state.get_prefs()
    assert prefs["memories_gacha_salt"] == "0123456789abcdef"
    assert prefs["volume"] == 0.5
