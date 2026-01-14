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
        """Endpoint should return cached nickname from settings."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({"user_nickname": "TestUser"}, f)
            temp_path = Path(f.name)

        try:
            with patch("backend.api.profile.get_settings_path", return_value=temp_path):
                response = client.get("/api/profile")

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
                    response = client.get("/api/profile")

            assert response.status_code == 200
            data = response.json()
            assert data["error"] == "Not authenticated"
            assert data["nickname"] is None
        finally:
            temp_path.unlink()


class TestProfileRefresh:
    """Test POST /api/profile/refresh endpoint."""

    def test_refresh_clears_cache(self, client):
        """Refresh should clear cached nickname."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({"user_nickname": "OldNickname"}, f)
            temp_path = Path(f.name)

        mock_tm = MagicMock()
        mock_tm.load_session.return_value = None

        try:
            with patch("backend.api.profile.get_settings_path", return_value=temp_path):
                with patch("backend.api.profile.get_token_manager", return_value=mock_tm):
                    response = client.post("/api/profile/refresh")

            assert response.status_code == 200

            # Check that the cache was cleared
            with open(temp_path, 'r') as f:
                saved_config = json.load(f)
            assert "user_nickname" not in saved_config
        finally:
            temp_path.unlink()
