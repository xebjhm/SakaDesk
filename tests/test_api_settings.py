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
