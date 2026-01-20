"""Tests for backend/api/profile.py - User profile endpoint."""

import json
from pathlib import Path
from unittest.mock import patch, MagicMock, AsyncMock
import tempfile

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
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({"user_nicknames": {"hinatazaka46": "TestUser"}}, f)
            temp_path = Path(f.name)

        try:
            with patch("backend.api.profile.get_settings_path", return_value=temp_path):
                response = client.get("/api/profile?service=hinatazaka46")

            assert response.status_code == 200
            data = response.json()
            assert data["nickname"] == "TestUser"
        finally:
            temp_path.unlink()

    def test_returns_error_when_not_authenticated(self, client):
        """Endpoint should return error when no auth token."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({}, f)  # No cached nickname
            temp_path = Path(f.name)

        mock_tm = MagicMock()
        mock_tm.load_session.return_value = None

        try:
            with patch("backend.api.profile.get_settings_path", return_value=temp_path):
                with patch("backend.api.profile.get_token_manager", return_value=mock_tm):
                    response = client.get("/api/profile?service=hinatazaka46")

            assert response.status_code == 200
            data = response.json()
            assert data["error"] == "Not authenticated"
            assert data["nickname"] is None
        finally:
            temp_path.unlink()

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
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({"user_nicknames": {"hinatazaka46": "OldNickname", "sakurazaka46": "OtherNickname"}}, f)
            temp_path = Path(f.name)

        mock_tm = MagicMock()
        mock_tm.load_session.return_value = None

        try:
            with patch("backend.api.profile.get_settings_path", return_value=temp_path):
                with patch("backend.api.profile.get_token_manager", return_value=mock_tm):
                    response = client.post("/api/profile/refresh?service=hinatazaka46")

            assert response.status_code == 200

            # Check that only hinatazaka46 cache was cleared
            with open(temp_path, 'r', encoding='utf-8') as f:
                saved_config = json.load(f)
            assert "hinatazaka46" not in saved_config.get("user_nicknames", {})
            assert saved_config["user_nicknames"]["sakurazaka46"] == "OtherNickname"
        finally:
            temp_path.unlink()

    def test_refresh_requires_service_param(self, client):
        """Refresh should require service parameter."""
        response = client.post("/api/profile/refresh")
        # FastAPI returns 422 for missing required query param
        assert response.status_code == 422
