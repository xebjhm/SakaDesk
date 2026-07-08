# backend/tests/test_app_state_integration.py
"""Integration test for the core promise of the app-state feature: a value
written via the API/store is still readable after a "reopen" — i.e. a fresh
store handle (as would exist after the app closes and relaunches on a
different port) pointed at the same on-disk db file.
"""

from backend.services import app_state


def test_reopen_sees_prior_state(client, tmp_path):
    db_path = tmp_path / "app_state.db"

    # "Instance A": app launches on some port, initializes the db, writes state.
    app_state.set_db_path(db_path)
    app_state.init_db()
    client.patch("/api/app-state/prefs", json={"tos_accepted_at": "t"})
    client.patch("/api/app-state/conversation?path=a/1", json={"read_up_to": 9})
    client.patch("/api/app-state/translations", json={"1:ja": "hi"})

    # "Reopen": app closes and relaunches, possibly on a different port. A
    # fresh store handle is pointed at the same data-dir db file.
    app_state.set_db_path(db_path)

    assert app_state.get_prefs()["tos_accepted_at"] == "t"
    assert app_state.get_conversation("a/1") == {"read_up_to": 9}
    assert app_state.get_translations(["1:ja"]) == {"1:ja": "hi"}


def test_reopen_sees_prior_state_via_api(client, tmp_path):
    """Same promise, but reading back through the HTTP API rather than the
    store directly, since that's the path the frontend actually uses."""
    db_path = tmp_path / "app_state.db"

    app_state.set_db_path(db_path)
    app_state.init_db()
    client.patch("/api/app-state/prefs", json={"language": "ja"})

    # Simulate reopen on a different port: nothing but the db path is shared.
    app_state.set_db_path(db_path)

    assert client.get("/api/app-state/prefs").json()["language"] == "ja"
