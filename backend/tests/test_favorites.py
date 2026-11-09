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

    def test_update_local_favorite_uses_locked_writer(self):
        """The write goes through pysaka's per-file-locked writer, not a private
        read-modify-write that could drop messages a concurrent sync wrote."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            member_dir = (
                Path(tmp_dir) / "日向坂46" / "messages" / "1 Group" / "40 Member"
            )
            member_dir.mkdir(parents=True)
            msg_file = member_dir / "messages.json"
            msg_file.write_text(
                json.dumps({"messages": [{"id": 12345, "is_favorite": False}]}),
                encoding="utf-8",
            )

            with (
                patch("api.favorites._get_output_dir", return_value=Path(tmp_dir)),
                patch(
                    "api.favorites.SyncManager.update_message_fields_sync",
                    return_value=True,
                ) as writer,
            ):
                assert _update_local_favorite(12345, True, "hinatazaka46") is True

            writer.assert_called_once_with(msg_file, 12345, {"is_favorite": True})

    def test_update_local_favorite_skips_writer_when_id_absent(self):
        """Files that do not contain the id are never handed to the writer."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            member_dir = (
                Path(tmp_dir) / "日向坂46" / "messages" / "1 Group" / "40 Member"
            )
            member_dir.mkdir(parents=True)
            (member_dir / "messages.json").write_text(
                json.dumps({"messages": [{"id": 1}]}), encoding="utf-8"
            )

            with (
                patch("api.favorites._get_output_dir", return_value=Path(tmp_dir)),
                patch("api.favorites.SyncManager.update_message_fields_sync") as writer,
            ):
                assert _update_local_favorite(12345, True, "hinatazaka46") is False

            writer.assert_not_called()

    def test_update_local_favorite_malformed_file_is_logged_and_skipped(self):
        """A broken file does not stop the scan of the other members."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            group = Path(tmp_dir) / "日向坂46" / "messages" / "1 Group"
            bad = group / "40 Bad"
            good = group / "41 Good"
            bad.mkdir(parents=True)
            good.mkdir(parents=True)
            (bad / "messages.json").write_text("{not json", encoding="utf-8")
            good_file = good / "messages.json"
            good_file.write_text(
                json.dumps({"messages": [{"id": 12345, "is_favorite": False}]}),
                encoding="utf-8",
            )

            with patch("api.favorites._get_output_dir", return_value=Path(tmp_dir)):
                assert _update_local_favorite(12345, True, "hinatazaka46") is True

            data = json.loads(good_file.read_text(encoding="utf-8"))
            assert data["messages"][0]["is_favorite"] is True


class TestFavoriteLog:
    """Toggling a favourite records (or clears) its favorite_log row."""

    @pytest.fixture
    def api_env(self, tmp_path):
        """Stub the pysaka client/session so the endpoint runs without network."""
        from unittest.mock import AsyncMock, MagicMock

        from backend.services import app_state

        app_state.set_db_path(tmp_path / "app_state.db")
        app_state.init_db()
        client = MagicMock()
        client.add_favorite = AsyncMock(return_value=True)
        client.remove_favorite = AsyncMock(return_value=True)
        session = MagicMock()
        session.close = AsyncMock()
        with (
            patch(
                "backend.api.favorites._get_client_and_session",
                new=AsyncMock(return_value=(client, session)),
            ),
            patch("backend.api.favorites._update_local_favorite", return_value=True),
        ):
            yield TestClient(app), app_state

    def test_add_records_favorite(self, api_env):
        client, app_state = api_env
        resp = client.post("/api/favorites/101?service=hinatazaka46")
        assert resp.status_code == 200
        assert resp.json()["is_favorite"] is True
        assert list(app_state.favorited_at("hinatazaka46", [101])) == [101]

    def test_remove_clears_favorite(self, api_env):
        client, app_state = api_env
        client.post("/api/favorites/101?service=hinatazaka46")
        resp = client.delete("/api/favorites/101?service=hinatazaka46")
        assert resp.status_code == 200
        assert app_state.favorited_at("hinatazaka46", [101]) == {}

    def test_record_failure_does_not_fail_request(self, api_env):
        from unittest.mock import patch as mpatch

        from structlog.testing import capture_logs

        client, _ = api_env
        with (
            mpatch(
                "backend.api.favorites.app_state.record_favorite",
                side_effect=RuntimeError("disk gone"),
            ),
            capture_logs() as logs,
        ):
            resp = client.post("/api/favorites/101?service=hinatazaka46")
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        failed = [e for e in logs if e.get("event") == "favorite_log_failed"]
        assert failed and failed[0]["error_type"] == "RuntimeError"
