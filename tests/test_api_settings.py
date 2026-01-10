
import pytest
from unittest.mock import mock_open, patch
import json
from pathlib import Path

@pytest.fixture
def mock_open_settings():
    """Mock file operations for settings."""
    with patch("builtins.open", mock_open(read_data='{}')) as m:
        yield m

@pytest.mark.asyncio
async def test_get_settings_defaults(client, mock_open_settings):
    """Test getting settings returns defaults when config is empty."""
    # Mock exists to return False first (default path) or True with empty content
    with patch("pathlib.Path.exists", return_value=False):
        response = client.get("/api/settings")
        assert response.status_code == 200
        data = response.json()
        assert data["output_dir"] == str(Path.cwd() / "output")
        assert data["auto_sync_enabled"] is True
        assert data["is_configured"] is False

@pytest.mark.asyncio
async def test_update_settings(client):
    """Test updating settings saves to file."""
    mock_file = mock_open(read_data=json.dumps({}))
    
    with patch("builtins.open", mock_file), \
         patch("pathlib.Path.exists", return_value=True), \
         patch("pathlib.Path.mkdir") as mock_mkdir:
        
        payload = {
            "output_dir": "/tmp/custom_output",
            "auto_sync_enabled": False,
            "sync_interval_minutes": 15
        }
        
        response = client.post("/api/settings", json=payload)
        
        assert response.status_code == 200
        data = response.json()
        assert data["output_dir"] == "/tmp/custom_output"
        assert data["auto_sync_enabled"] is False
        assert data["is_configured"] is True
        
        # Verify write
        mock_file.assert_called()
        # Get the handle to check write calls
        handle = mock_file()
        handle.write.assert_called()
        
        # Check that written content contains our updates
        written_data = "".join(call.args[0] for call in handle.write.call_args_list)
        saved_json = json.loads(written_data)
        assert saved_json["output_dir"] == "/tmp/custom_output"
        assert saved_json["auto_sync_enabled"] is False

@pytest.mark.asyncio
async def test_check_fresh_install(client):
    """Test fresh install detection logic."""
    with patch("backend.api.settings.load_config", return_value={"output_dir": "/tmp/test"}), \
         patch("pathlib.Path.exists", return_value=True), \
         patch("pathlib.Path.iterdir") as mock_iterdir:
        
        # Case 1: Empty directory
        mock_iterdir.return_value = []
        response = client.get("/api/settings/fresh")
        assert response.status_code == 200
        assert response.json()["is_fresh"] is True
        
        # Case 2: Only metadata file
        p1 = Path("/tmp/test/sync_metadata.json")
        mock_iterdir.return_value = [p1]
        response = client.get("/api/settings/fresh")
        assert response.json()["is_fresh"] is True
        
        # Case 3: Has data
        p1 = Path("/tmp/test/some_folder")
        mock_iterdir.return_value = [p1]
        response = client.get("/api/settings/fresh")
        assert response.json()["is_fresh"] is False
