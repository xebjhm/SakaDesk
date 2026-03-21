"""Tests for backend/api/profile.py - User profile endpoint."""

from unittest.mock import patch, MagicMock, AsyncMock

import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture
def client():
    """Create test client."""
    return TestClient(app)


class TestProfileEndpoint:
    """Test GET /api/profile endpoint."""

    def test_returns_cached_nickname(self, client):
        """Endpoint should return cached nickname from settings (per-service)."""
        mock_config = {"user_nicknames": {"hinatazaka46": "TestUser"}}

        with patch(
            "backend.api.profile._store_load",
            new_callable=AsyncMock,
            return_value=mock_config,
        ):
            response = client.get("/api/profile?service=hinatazaka46")

        assert response.status_code == 200
        data = response.json()
        assert data["nickname"] == "TestUser"

    def test_returns_error_when_not_authenticated(self, client):
        """Endpoint should return error when no auth token."""
        mock_tm = MagicMock()
        mock_tm.load_session.return_value = None

        with patch(
            "backend.api.profile._store_load", new_callable=AsyncMock, return_value={}
        ):
            with patch("backend.api.profile.get_token_manager", return_value=mock_tm):
                response = client.get("/api/profile?service=hinatazaka46")

        assert response.status_code == 200
        data = response.json()
        assert data["error"] == "Not authenticated"
        assert data["nickname"] is None

    def test_returns_error_for_invalid_service(self, client):
        """Endpoint should return error for invalid service."""
        response = client.get("/api/profile?service=invalid_service")
        assert response.status_code == 200
        data = response.json()
        assert data["error"] is not None
        assert data["nickname"] is None

    def test_requires_service_param(self, client):
        """Endpoint should require service parameter."""
        response = client.get("/api/profile")
        # FastAPI returns 422 for missing required query param
        assert response.status_code == 422


class TestProfileRefresh:
    """Test POST /api/profile/refresh endpoint."""

    def test_refresh_clears_cache(self, client):
        """Refresh should clear cached nickname for the specific service."""
        original_config = {
            "user_nicknames": {
                "hinatazaka46": "OldNickname",
                "sakurazaka46": "OtherNickname",
            }
        }
        captured_config = {}

        async def mock_update(updater):
            """Simulate atomic read-modify-write."""
            import copy

            config = copy.deepcopy(original_config)
            updater(config)
            captured_config.update(config)
            return config

        mock_tm = MagicMock()
        mock_tm.load_session.return_value = None

        with patch("backend.api.profile._store_update", side_effect=mock_update):
            # After clearing, _store_load returns the updated config (no hinatazaka46)
            with patch(
                "backend.api.profile._store_load",
                new_callable=AsyncMock,
                return_value={"user_nicknames": {"sakurazaka46": "OtherNickname"}},
            ):
                with patch(
                    "backend.api.profile.get_token_manager", return_value=mock_tm
                ):
                    response = client.post("/api/profile/refresh?service=hinatazaka46")

        assert response.status_code == 200

        # Verify the updater cleared hinatazaka46 but kept sakurazaka46
        assert "hinatazaka46" not in captured_config.get("user_nicknames", {})
        assert captured_config["user_nicknames"]["sakurazaka46"] == "OtherNickname"

    def test_refresh_requires_service_param(self, client):
        """Refresh should require service parameter."""
        response = client.post("/api/profile/refresh")
        # FastAPI returns 422 for missing required query param
        assert response.status_code == 422
