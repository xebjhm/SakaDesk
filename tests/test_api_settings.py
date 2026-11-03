import asyncio

import pytest
from unittest.mock import patch
import json


@pytest.fixture
def isolated_settings(tmp_path):
    """Redirect all settings file access to a temporary file.

    Patches ``get_settings_path`` at every import site so that
    ``settings_store`` (which uses ``os.fdopen`` via ``tempfile.mkstemp``)
    and the ``settings`` API module both write to a throw-away file
    instead of the real ``~/.sakadesk/settings.json``.
    """
    settings_file = tmp_path / "settings.json"
    settings_file.write_text("{}", encoding="utf-8")

    with (
        patch(
            "backend.services.settings_store.get_settings_path",
            return_value=settings_file,
        ),
        patch(
            "backend.services.platform.get_settings_path",
            return_value=settings_file,
        ),
        patch(
            "backend.api.settings.get_settings_path",
            return_value=settings_file,
        ),
        patch(
            "backend.api.settings.SETTINGS_FILE",
            settings_file,
        ),
    ):
        yield settings_file


@pytest.mark.asyncio
async def test_get_settings_defaults(client, isolated_settings):
    """Test getting settings returns defaults when config is empty."""
    response = client.get("/api/settings")
    assert response.status_code == 200
    data = response.json()
    # output_dir defaults to cwd/output when not set
    assert data["auto_sync_enabled"] is True
    assert data["is_configured"] is False


@pytest.mark.asyncio
async def test_update_settings(client, isolated_settings):
    """Test updating settings saves to the isolated file."""
    payload = {
        "output_dir": "/tmp/custom_output",
        "auto_sync_enabled": False,
        "sync_interval_minutes": 15,
    }

    response = client.post("/api/settings", json=payload)

    assert response.status_code == 200
    data = response.json()
    assert data["output_dir"] == "/tmp/custom_output"
    assert data["auto_sync_enabled"] is False
    assert data["is_configured"] is True

    # Verify the isolated file was actually written
    saved = json.loads(isolated_settings.read_text(encoding="utf-8"))
    assert saved["output_dir"] == "/tmp/custom_output"
    assert saved["auto_sync_enabled"] is False


@pytest.mark.asyncio
async def test_check_fresh_install(client, isolated_settings):
    """Test fresh install detection logic."""
    # First set an output dir that exists
    tmp_output = isolated_settings.parent / "test_output"
    tmp_output.mkdir()

    # Write settings with this output dir
    isolated_settings.write_text(
        json.dumps({"output_dir": str(tmp_output)}), encoding="utf-8"
    )

    # Case 1: Empty directory → fresh
    response = client.get("/api/settings/fresh")
    assert response.status_code == 200
    assert response.json()["is_fresh"] is True

    # Case 2: Only metadata file → still fresh
    (tmp_output / "sync_metadata.json").write_text("{}")
    response = client.get("/api/settings/fresh")
    assert response.json()["is_fresh"] is True

    # Case 3: Has actual data → not fresh
    (tmp_output / "some_folder").mkdir()
    response = client.get("/api/settings/fresh")
    assert response.json()["is_fresh"] is False


@pytest.mark.asyncio
async def test_incoming_call_enabled_defaults_true(client, isolated_settings):
    response = client.get("/api/settings")
    assert response.status_code == 200
    assert response.json()["incoming_call_enabled"] is True


@pytest.mark.asyncio
async def test_incoming_call_enabled_round_trips(client, isolated_settings):
    response = client.post("/api/settings", json={"incoming_call_enabled": False})
    assert response.status_code == 200
    assert response.json()["incoming_call_enabled"] is False
    assert client.get("/api/settings").json()["incoming_call_enabled"] is False
    saved = json.loads(isolated_settings.read_text(encoding="utf-8"))
    assert saved["incoming_call_enabled"] is False


@pytest.mark.asyncio
async def test_tray_settings_defaults(client, isolated_settings):
    data = client.get("/api/settings").json()
    assert data["close_to_tray"] is True
    assert data["autostart"] is False
    assert "tray_hint_shown" not in data


@pytest.mark.asyncio
async def test_close_to_tray_round_trips_without_touching_autostart(
    client, isolated_settings
):
    with patch("backend.services.autostart.apply") as apply:
        response = client.post("/api/settings", json={"close_to_tray": False})
    assert response.status_code == 200
    assert response.json()["close_to_tray"] is False
    assert client.get("/api/settings").json()["close_to_tray"] is False
    saved = json.loads(isolated_settings.read_text(encoding="utf-8"))
    assert saved["close_to_tray"] is False
    apply.assert_not_called()


@pytest.mark.asyncio
async def test_autostart_change_calls_apply_off_the_loop(client, isolated_settings):
    import sys
    import threading
    from pathlib import Path

    seen: dict = {}
    handler_thread: list = []

    def fake_apply(enabled, *, frozen, exe, reg=None):
        seen["thread"] = threading.get_ident()
        seen["args"] = (enabled, frozen, exe)
        return "enabled"

    real_to_thread = asyncio.to_thread

    async def recording_to_thread(fn, /, *args, **kwargs):
        # Called on the event-loop thread; remember which one that is.
        handler_thread.append(threading.get_ident())
        return await real_to_thread(fn, *args, **kwargs)

    with (
        patch("backend.services.autostart.apply", fake_apply),
        patch("asyncio.to_thread", recording_to_thread),
    ):
        response = client.post("/api/settings", json={"autostart": True})
    assert response.status_code == 200
    assert response.json()["autostart"] is True
    assert seen["args"] == (
        True,
        getattr(sys, "frozen", False),
        Path(sys.executable),
    )
    # apply ran on a worker thread, not on the event-loop thread that awaited it.
    assert handler_thread, "loop thread was not recorded"
    assert seen["thread"] != handler_thread[0]
    saved = json.loads(isolated_settings.read_text(encoding="utf-8"))
    assert saved["autostart"] is True


@pytest.mark.asyncio
async def test_autostart_unchanged_value_does_not_call_apply(client, isolated_settings):
    isolated_settings.write_text(json.dumps({"autostart": True}), encoding="utf-8")
    with patch("backend.services.autostart.apply") as apply:
        client.post("/api/settings", json={"autostart": True})
    apply.assert_not_called()
    with patch("backend.services.autostart.apply") as apply:
        client.post("/api/settings", json={"autostart": False})
    apply.assert_called_once()
    assert apply.call_args.args == (False,)


@pytest.mark.asyncio
async def test_autostart_apply_failure_does_not_break_the_update(
    client, isolated_settings
):
    with patch("backend.services.autostart.apply", side_effect=OSError("x")):
        response = client.post("/api/settings", json={"autostart": True})
    assert response.status_code == 200
    assert response.json()["autostart"] is True


@pytest.mark.asyncio
async def test_tray_hint_shown_cannot_be_set_via_the_api(client, isolated_settings):
    response = client.post("/api/settings", json={"tray_hint_shown": True})
    assert response.status_code == 200
    saved = json.loads(isolated_settings.read_text(encoding="utf-8"))
    assert saved.get("tray_hint_shown", False) is False
