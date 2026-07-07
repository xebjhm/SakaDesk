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
    def test_message_dates_rejects_path_traversal(self, mock_output, tmp_path):
        """A traversal member_path is rejected before touching disk (API-I2)."""
        # A readable messages.json OUTSIDE the output dir; a naive join would
        # serve it via ../ escape.
        secret = tmp_path.parent / "sakadesk_secret_dir"
        secret.mkdir(parents=True, exist_ok=True)
        (secret / "messages.json").write_text('{"messages": []}', encoding="utf-8")

        mock_output.return_value = tmp_path
        response = client.get(f"/api/chat/message_dates/..%2f{secret.name}")
        assert response.status_code == 403

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
        # Dates are bucketed by LOCAL date (SD-FE-CORE-02); compute the expected
        # buckets the same way so the test holds in any runner timezone.
        from backend.api.chat_features import _local_date

        d15 = _local_date("2025-01-15T10:00:00Z")
        d16 = _local_date("2025-01-16T09:00:00Z")
        dates_map = {d["date"]: d["count"] for d in data["dates"]}
        assert dates_map[d15] == 2
        assert dates_map[d16] == 1

    @patch("backend.api.chat_features._get_output_dir")
    def test_message_dates_group_path(self, mock_output, tmp_path):
        """Returns aggregated dates from multiple member directories."""
        group_dir = tmp_path / "service" / "group"
        m1 = group_dir / "member1"
        m2 = group_dir / "member2"
        m1.mkdir(parents=True)
        m2.mkdir(parents=True)

        # Both at midday UTC so they share a local calendar day in any timezone
        # (the endpoint buckets by LOCAL date; see SD-FE-CORE-02).
        m1_messages = {"messages": [{"id": 1, "timestamp": "2025-02-01T12:00:00Z"}]}
        m2_messages = {"messages": [{"id": 2, "timestamp": "2025-02-01T13:00:00Z"}]}
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


class TestLocalDateBucketing:
    """SD-FE-CORE-02 (Theme C): message_dates buckets by LOCAL date, matching the
    bubbles and calendar, not the raw UTC prefix."""

    def test_local_date_matches_local_conversion(self):
        from datetime import datetime

        from backend.api.chat_features import _local_date

        ts = "2025-01-15T23:30:00Z"
        # The helper's result must equal the machine-local date of that instant —
        # the same conversion the frontend does with new Date(ts).getDate().
        expected = (
            datetime.fromisoformat(ts.replace("Z", "+00:00"))
            .astimezone()
            .strftime("%Y-%m-%d")
        )
        assert _local_date(ts) == expected

    def test_local_date_handles_offset_suffix(self):
        from datetime import datetime

        from backend.api.chat_features import _local_date

        ts = "2025-06-30T20:00:00+09:00"  # JST (blog-style offset)
        expected = datetime.fromisoformat(ts).astimezone().strftime("%Y-%m-%d")
        assert _local_date(ts) == expected

    def test_local_date_empty_and_malformed(self):
        from backend.api.chat_features import _local_date

        assert _local_date("") is None
        # Unparseable but has a date-like prefix → still buckets on the prefix.
        assert _local_date("2025-03-04 garbage") == "2025-03-04"

    @patch("backend.api.chat_features._get_output_dir")
    def test_message_dates_buckets_by_local_date(self, mock_output, tmp_path):
        """Two messages one hour apart on the same instant-day land in the same
        local-date bucket (regardless of the runner's timezone)."""
        from backend.api.chat_features import _local_date

        member_dir = tmp_path / "hinatazaka46" / "member1"
        member_dir.mkdir(parents=True)
        messages = {
            "messages": [
                {"id": 1, "timestamp": "2025-01-15T23:00:00Z"},
                {"id": 2, "timestamp": "2025-01-15T23:59:00Z"},
            ]
        }
        (member_dir / "messages.json").write_text(
            json.dumps(messages), encoding="utf-8"
        )
        mock_output.return_value = tmp_path
        response = client.get("/api/chat/message_dates/hinatazaka46/member1")
        assert response.status_code == 200
        data = response.json()
        # Both messages share the same local calendar day → one bucket, count 2.
        expected_date = _local_date("2025-01-15T23:00:00Z")
        assert data["total_dates"] == 1
        assert data["dates"][0]["date"] == expected_date
        assert data["dates"][0]["count"] == 2


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


class TestMarkRoomReadRemote:
    """Tests for POST /api/chat/mark-room-read-remote (opt-in sync read to phone)."""

    @patch("backend.api.chat_features.is_test_mode", return_value=False)
    def test_noop_when_setting_off(self, _mock_test):
        """Default: sync_read_to_phone off → no-op (never touches the official app)."""
        with patch(
            "backend.services.settings_store.load_config",
            new=AsyncMock(return_value={"sync_read_to_phone": False}),
        ):
            with patch("backend.api.chat_features.get_token_manager") as mock_tm:
                res = client.post(
                    "/api/chat/mark-room-read-remote",
                    json={"service": "hinatazaka46", "group_id": 70},
                )
                assert res.status_code == 200
                assert res.json() == {"ok": True, "skipped": True}
                mock_tm.assert_not_called()  # never even looked up credentials

    @patch("backend.api.chat_features.is_test_mode", return_value=False)
    def test_marks_when_setting_on(self, _mock_test):
        """When sync_read_to_phone on, it clears the room via mark_group_read."""
        with (
            patch(
                "backend.services.settings_store.load_config",
                new=AsyncMock(return_value={"sync_read_to_phone": True}),
            ),
            patch("backend.api.chat_features.get_token_manager") as mock_tm,
            patch("backend.api.chat_features.Client") as MockClient,
        ):
            mock_tm.return_value.load_session.return_value = {
                "access_token": "tok",
                "cookies": {},
            }
            MockClient.return_value.mark_group_read = AsyncMock(return_value=True)
            res = client.post(
                "/api/chat/mark-room-read-remote",
                json={"service": "hinatazaka46", "group_id": 70},
            )
            assert res.status_code == 200
            assert res.json() == {"ok": True}
            MockClient.return_value.mark_group_read.assert_awaited_once()

    @patch("backend.api.chat_features.is_test_mode", return_value=True)
    def test_noop_in_test_mode(self, _mock_test):
        """Test mode must never fire a live mutation, even with the setting on."""
        with patch("backend.api.chat_features.get_token_manager") as mock_tm:
            res = client.post(
                "/api/chat/mark-room-read-remote",
                json={"service": "hinatazaka46", "group_id": 70},
            )
            assert res.status_code == 200
            assert res.json() == {"ok": True, "skipped": True}
            mock_tm.assert_not_called()

    @patch("backend.api.chat_features.is_test_mode", return_value=False)
    def test_invalid_service_returns_400(self, _mock_test):
        """An unknown service is rejected with 400, not swallowed into {ok: false}."""
        with patch(
            "backend.services.settings_store.load_config",
            new=AsyncMock(return_value={"sync_read_to_phone": True}),
        ):
            res = client.post(
                "/api/chat/mark-room-read-remote",
                json={"service": "not_a_real_service", "group_id": 70},
            )
            assert res.status_code == 400

    def test_rejects_non_positive_group_id(self):
        """group_id must be positive (Field gt=0) → 422 on 0 or negative."""
        res = client.post(
            "/api/chat/mark-room-read-remote",
            json={"service": "hinatazaka46", "group_id": 0},
        )
        assert res.status_code == 422

    @patch("backend.api.chat_features.is_test_mode", return_value=False)
    def test_no_session_returns_ok_false(self, _mock_test):
        """No stored session → ok:false (never raises). The service rail's
        disconnect badge is the user-facing surface for the re-login case."""
        with (
            patch(
                "backend.services.settings_store.load_config",
                new=AsyncMock(return_value={"sync_read_to_phone": True}),
            ),
            patch("backend.api.chat_features.get_token_manager") as mock_tm,
        ):
            mock_tm.return_value.load_session.return_value = None
            res = client.post(
                "/api/chat/mark-room-read-remote",
                json={"service": "hinatazaka46", "group_id": 70},
            )
            assert res.status_code == 200
            assert res.json() == {"ok": False}

    @patch("backend.api.chat_features.is_test_mode", return_value=False)
    def test_server_refusal_returns_ok_false(self, _mock_test):
        """Valid session but the server refuses the clear → ok:false (no raise)."""
        with (
            patch(
                "backend.services.settings_store.load_config",
                new=AsyncMock(return_value={"sync_read_to_phone": True}),
            ),
            patch("backend.api.chat_features.get_token_manager") as mock_tm,
            patch("backend.api.chat_features.Client") as MockClient,
        ):
            mock_tm.return_value.load_session.return_value = {
                "access_token": "tok",
                "cookies": {},
            }
            MockClient.return_value.mark_group_read = AsyncMock(return_value=False)
            res = client.post(
                "/api/chat/mark-room-read-remote",
                json={"service": "hinatazaka46", "group_id": 70},
            )
            assert res.status_code == 200
            assert res.json() == {"ok": False}
