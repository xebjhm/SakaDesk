"""Tests for favorites API."""

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from main import app
from api.favorites import _get_output_dir, _update_local_favorite


class TestFavoritesAPI:
    """Tests for favorites API endpoints."""

    @pytest.fixture
    def client(self):
        return TestClient(app)

    def test_add_favorite_invalid_service(self, client):
        """Test add favorite with invalid service returns 400."""
        response = client.post("/api/favorites/12345?service=invalid_service")
        assert response.status_code == 400

    def test_remove_favorite_invalid_service(self, client):
        """Test remove favorite with invalid service returns 400."""
        response = client.delete("/api/favorites/12345?service=invalid_service")
        assert response.status_code == 400

    def test_add_favorite_missing_service(self, client):
        """Test add favorite without service parameter."""
        response = client.post("/api/favorites/12345")
        assert response.status_code == 422  # Missing required query param

    def test_remove_favorite_missing_service(self, client):
        """Test remove favorite without service parameter."""
        response = client.delete("/api/favorites/12345")
        assert response.status_code == 422  # Missing required query param


class TestLocalFavoriteUpdate:
    """Tests for local favorite file updates."""

    def test_get_output_dir_from_settings(self):
        """Test reading output_dir from settings file."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            settings_path = Path(tmp_dir) / "settings.json"
            settings = {"output_dir": "/custom/output"}
            settings_path.write_text(json.dumps(settings), encoding="utf-8")

            with patch("api.favorites.get_settings_path", return_value=settings_path):
                result = _get_output_dir()
                assert result == Path("/custom/output")

    def test_get_output_dir_default(self):
        """Test default output_dir when settings missing."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            nonexistent = Path(tmp_dir) / "nonexistent.json"
            with patch("api.favorites.get_settings_path", return_value=nonexistent):
                result = _get_output_dir()
                assert result == Path.home() / "Documents" / "SakaDesk"

    def test_update_local_favorite_message_found(self):
        """Test updating favorite in local messages.json."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            # Create test directory structure
            member_dir = (
                Path(tmp_dir) / "日向坂46" / "messages" / "1 Group" / "40 Member"
            )
            member_dir.mkdir(parents=True)

            messages_data = {
                "messages": [
                    {"id": 12345, "text": "Hello", "is_favorite": False},
                    {"id": 12346, "text": "World", "is_favorite": False},
                ]
            }
            msg_file = member_dir / "messages.json"
            msg_file.write_text(json.dumps(messages_data), encoding="utf-8")

            with patch("api.favorites._get_output_dir", return_value=Path(tmp_dir)):
                result = _update_local_favorite(12345, True, "hinatazaka46")

            assert result is True

            # Verify the file was updated
            updated = json.loads(msg_file.read_text(encoding="utf-8"))
            assert updated["messages"][0]["is_favorite"] is True
            assert updated["messages"][1]["is_favorite"] is False
            # Atomic write must not leave a temp file behind.
            assert not list(member_dir.glob("*.tmp"))

    def test_update_local_favorite_message_not_found(self):
        """Test updating favorite when message doesn't exist."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            # Create test directory structure with different message
            member_dir = (
                Path(tmp_dir) / "日向坂46" / "messages" / "1 Group" / "40 Member"
            )
            member_dir.mkdir(parents=True)

            messages_data = {
                "messages": [
                    {"id": 99999, "text": "Different", "is_favorite": False},
                ]
            }
            msg_file = member_dir / "messages.json"
            msg_file.write_text(json.dumps(messages_data), encoding="utf-8")

            with patch("api.favorites._get_output_dir", return_value=Path(tmp_dir)):
                result = _update_local_favorite(12345, True, "hinatazaka46")

            assert result is False

    def test_update_local_favorite_no_messages_dir(self):
        """Test updating favorite when output dir is empty."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            with patch("api.favorites._get_output_dir", return_value=Path(tmp_dir)):
                result = _update_local_favorite(12345, True, "hinatazaka46")
            assert result is False

    def test_update_local_favorite_scoped_to_service(self):
        """SD-BE-API-05: message_id is only unique per (service, id). The update
        must touch ONLY the named service's file, even when another service holds
        a message with the same id — otherwise a cross-service id collision flips
        the wrong message's favorite on disk."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            # SAME message id 12345 exists in BOTH services.
            for service in ["日向坂46", "櫻坂46"]:
                member_dir = (
                    Path(tmp_dir) / service / "messages" / "1 Group" / "40 Member"
                )
                member_dir.mkdir(parents=True)
                (member_dir / "messages.json").write_text(
                    json.dumps(
                        {
                            "messages": [
                                {"id": 12345, "text": service, "is_favorite": False}
                            ]
                        }
                    ),
                    encoding="utf-8",
                )

            # Favorite it for sakurazaka46 only.
            with patch("api.favorites._get_output_dir", return_value=Path(tmp_dir)):
                result = _update_local_favorite(12345, True, "sakurazaka46")

            assert result is True

            def read(service):
                p = (
                    Path(tmp_dir)
                    / service
                    / "messages"
                    / "1 Group"
                    / "40 Member"
                    / "messages.json"
                )
                return json.loads(p.read_text(encoding="utf-8"))["messages"][0][
                    "is_favorite"
                ]

            assert read("櫻坂46") is True  # sakurazaka46 updated
            assert read("日向坂46") is False  # hinatazaka46 NOT touched

    def test_update_local_favorite_unknown_service(self):
        """An unknown service id returns False without scanning anything."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            with patch("api.favorites._get_output_dir", return_value=Path(tmp_dir)):
                result = _update_local_favorite(12345, True, "not_a_service")
            assert result is False
