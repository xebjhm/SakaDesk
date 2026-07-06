# backend/tests/test_app_state_api.py
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
