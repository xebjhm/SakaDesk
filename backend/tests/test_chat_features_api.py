"""Tests for chat features API endpoints (/api/chat/*)."""

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


class TestGetLetters:
    """Tests for GET /api/chat/letters/{group_id}."""

    def test_letters_missing_service(self):
        """Missing service parameter returns 422."""
        response = client.get("/api/chat/letters/40")
        assert response.status_code == 422

    def test_letters_invalid_service(self):
        """Invalid service returns 400."""
        response = client.get("/api/chat/letters/40?service=invalid_service")
        assert response.status_code == 400

    @patch("backend.api.chat_features.is_test_mode", return_value=True)
    def test_letters_test_mode(self, mock_test):
        """Returns 503 in test mode."""
        response = client.get("/api/chat/letters/40?service=hinatazaka46")
        assert response.status_code == 503

    @patch("backend.api.chat_features._get_client_and_session")
    def test_letters_success(self, mock_get_client):
        """Returns letters on success."""
        mock_session = AsyncMock()
        mock_client = MagicMock()
        mock_client.get_letters = AsyncMock(
            return_value=[
                {
                    "id": 1,
                    "text": "Hello!",
                    "created_at": "2025-01-01T00:00:00Z",
                    "updated_at": "2025-01-01T00:00:00Z",
                    "file": "https://example.com/img.jpg",
                    "thumbnail": None,
                },
            ]
        )
        mock_get_client.return_value = (mock_client, mock_session)
        response = client.get("/api/chat/letters/40?service=hinatazaka46")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert data["letters"][0]["content"] == "Hello!"
        assert data["letters"][0]["image"] == "https://example.com/img.jpg"
        mock_session.close.assert_called_once()

    @patch("backend.api.chat_features._get_client_and_session")
    def test_letters_empty(self, mock_get_client):
        """Returns empty list when no letters exist."""
        mock_session = AsyncMock()
        mock_client = MagicMock()
        mock_client.get_letters = AsyncMock(return_value=[])
        mock_get_client.return_value = (mock_client, mock_session)
        response = client.get("/api/chat/letters/40?service=hinatazaka46")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0
        assert data["letters"] == []

    @patch("backend.api.chat_features._get_client_and_session")
    def test_letters_api_error(self, mock_get_client):
        """Returns 500 on API error."""
        mock_session = AsyncMock()
        mock_client = MagicMock()
        mock_client.get_letters = AsyncMock(side_effect=RuntimeError("API down"))
        mock_get_client.return_value = (mock_client, mock_session)
        response = client.get("/api/chat/letters/40?service=hinatazaka46")
        assert response.status_code == 500
        mock_session.close.assert_called_once()


class TestGetStreak:
    """Tests for GET /api/chat/streak/{group_id}."""

    def test_streak_missing_service(self):
        """Missing service parameter returns 422."""
        response = client.get("/api/chat/streak/40")
        assert response.status_code == 422

    def test_streak_invalid_service(self):
        """Invalid service returns 400."""
        response = client.get("/api/chat/streak/40?service=invalid_service")
        assert response.status_code == 400

    @patch("backend.api.chat_features._get_client_and_session")
    def test_streak_success(self, mock_get_client):
        """Returns streak data on success."""
        mock_session = AsyncMock()
        mock_client = MagicMock()
        mock_client.get_subscription_streak = AsyncMock(
            return_value={
                "current": 15,
                "current_start_at_date": "2024-12-15",
            }
        )
        mock_get_client.return_value = (mock_client, mock_session)
        response = client.get("/api/chat/streak/40?service=hinatazaka46")
        assert response.status_code == 200
        data = response.json()
        assert data["days"] == 15
        assert data["is_active"] is True
        assert data["start_date"] == "2024-12-15"
        mock_session.close.assert_called_once()

    @patch("backend.api.chat_features._get_client_and_session")
    def test_streak_empty(self, mock_get_client):
        """Returns zero streak when no data."""
        mock_session = AsyncMock()
        mock_client = MagicMock()
        mock_client.get_subscription_streak = AsyncMock(return_value=None)
        mock_get_client.return_value = (mock_client, mock_session)
        response = client.get("/api/chat/streak/40?service=hinatazaka46")
        assert response.status_code == 200
        data = response.json()
        assert data["days"] == 0
        assert data["is_active"] is False

    @patch("backend.api.chat_features._get_client_and_session")
    def test_streak_api_error(self, mock_get_client):
        """Returns 500 on API error."""
        mock_session = AsyncMock()
        mock_client = MagicMock()
        mock_client.get_subscription_streak = AsyncMock(
            side_effect=RuntimeError("fail")
        )
        mock_get_client.return_value = (mock_client, mock_session)
        response = client.get("/api/chat/streak/40?service=hinatazaka46")
        assert response.status_code == 500


class TestGetMessageDates:
    """Tests for GET /api/chat/message_dates/{member_path}."""

    @patch("backend.api.chat_features._get_output_dir")
    def test_message_dates_not_found(self, mock_output, tmp_path):
        """Returns 404 for nonexistent path."""
        mock_output.return_value = tmp_path
        response = client.get("/api/chat/message_dates/nonexistent/member")
        assert response.status_code == 404

    @patch("backend.api.chat_features._get_output_dir")
    def test_message_dates_single_member(self, mock_output, tmp_path):
        """Returns date counts from a single member's messages.json."""
        member_dir = tmp_path / "hinatazaka46" / "member1"
        member_dir.mkdir(parents=True)
        messages = {
            "messages": [
                {"id": 1, "timestamp": "2025-01-15T10:00:00Z", "text": "a"},
                {"id": 2, "timestamp": "2025-01-15T11:00:00Z", "text": "b"},
                {"id": 3, "timestamp": "2025-01-16T09:00:00Z", "text": "c"},
            ]
        }
        (member_dir / "messages.json").write_text(
            json.dumps(messages), encoding="utf-8"
        )
        mock_output.return_value = tmp_path
        response = client.get("/api/chat/message_dates/hinatazaka46/member1")
        assert response.status_code == 200
        data = response.json()
        assert data["total_dates"] == 2
        # Find the date with count 2
        dates_map = {d["date"]: d["count"] for d in data["dates"]}
        assert dates_map["2025-01-15"] == 2
        assert dates_map["2025-01-16"] == 1

    @patch("backend.api.chat_features._get_output_dir")
    def test_message_dates_group_path(self, mock_output, tmp_path):
        """Returns aggregated dates from multiple member directories."""
        group_dir = tmp_path / "service" / "group"
        m1 = group_dir / "member1"
        m2 = group_dir / "member2"
        m1.mkdir(parents=True)
        m2.mkdir(parents=True)

        m1_messages = {"messages": [{"id": 1, "timestamp": "2025-02-01T00:00:00Z"}]}
        m2_messages = {"messages": [{"id": 2, "timestamp": "2025-02-01T10:00:00Z"}]}
        (m1 / "messages.json").write_text(json.dumps(m1_messages), encoding="utf-8")
        (m2 / "messages.json").write_text(json.dumps(m2_messages), encoding="utf-8")

        mock_output.return_value = tmp_path
        response = client.get("/api/chat/message_dates/service/group")
        assert response.status_code == 200
        data = response.json()
        assert data["total_dates"] == 1
        assert data["dates"][0]["count"] == 2

    @patch("backend.api.chat_features._get_output_dir")
    def test_message_dates_empty_dir(self, mock_output, tmp_path):
        """Returns empty dates for directory with no messages."""
        empty_dir = tmp_path / "service" / "empty"
        empty_dir.mkdir(parents=True)
        mock_output.return_value = tmp_path
        response = client.get("/api/chat/message_dates/service/empty")
        assert response.status_code == 200
        data = response.json()
        assert data["total_dates"] == 0
        assert data["dates"] == []


class TestGetOutputDir:
    """Tests for the _get_output_dir helper."""

    def test_output_dir_from_settings(self, tmp_path):
        from backend.api.chat_features import _get_output_dir

        settings_path = tmp_path / "settings.json"
        settings_path.write_text(
            json.dumps({"output_dir": "/custom/path"}),
            encoding="utf-8",
        )
        with patch(
            "backend.api.chat_features.get_settings_path", return_value=settings_path
        ):
            result = _get_output_dir()
        assert result == Path("/custom/path")

    def test_output_dir_default(self, tmp_path):
        from backend.api.chat_features import _get_output_dir

        with patch(
            "backend.api.chat_features.get_settings_path",
            return_value=tmp_path / "missing.json",
        ):
            result = _get_output_dir()
        assert "SakaDesk" in str(result)


class TestGetClientAndSession:
    """Tests for the _get_client_and_session helper via endpoint behavior."""

    @patch("backend.api.chat_features.is_test_mode", return_value=True)
    def test_rejects_test_mode_via_streak(self, mock_test):
        """Streak endpoint returns 503 in test mode (exercises _get_client_and_session)."""
        response = client.get("/api/chat/streak/40?service=hinatazaka46")
        assert response.status_code == 503

    @patch("backend.api.chat_features.is_test_mode", return_value=False)
    @patch("backend.api.chat_features.get_token_manager")
    def test_rejects_unauthenticated_via_streak(self, mock_tm, mock_test):
        """Streak endpoint returns 401 when no token is available."""
        mock_tm.return_value = MagicMock(load_session=MagicMock(return_value=None))
        response = client.get("/api/chat/streak/40?service=hinatazaka46")
        assert response.status_code == 401
