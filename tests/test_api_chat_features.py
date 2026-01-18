"""Tests for backend/api/chat_features.py - Chat features endpoints."""

from fastapi.testclient import TestClient
import pytest

from backend.main import app


@pytest.fixture
def client():
    """Create test client."""
    return TestClient(app)


class TestLettersEndpoint:
    """Test GET /api/chat/letters/{group_id} endpoint."""

    def test_requires_service_param(self, client):
        """Endpoint should require service parameter."""
        response = client.get("/api/chat/letters/123")
        # FastAPI returns 422 for missing required query param
        assert response.status_code == 422

    def test_rejects_invalid_service(self, client):
        """Endpoint should reject invalid service."""
        response = client.get("/api/chat/letters/123?service=invalid_service")
        assert response.status_code == 400
        data = response.json()
        assert "Unknown service" in data["detail"]


class TestStreakEndpoint:
    """Test GET /api/chat/streak/{group_id} endpoint."""

    def test_requires_service_param(self, client):
        """Endpoint should require service parameter."""
        response = client.get("/api/chat/streak/123")
        # FastAPI returns 422 for missing required query param
        assert response.status_code == 422

    def test_rejects_invalid_service(self, client):
        """Endpoint should reject invalid service."""
        response = client.get("/api/chat/streak/123?service=invalid_service")
        assert response.status_code == 400
        data = response.json()
        assert "Unknown service" in data["detail"]


class TestMessageDatesEndpoint:
    """Test GET /api/chat/message_dates/{member_path} endpoint."""

    def test_returns_404_for_missing_path(self, client):
        """Endpoint should return 404 for non-existent path."""
        response = client.get("/api/chat/message_dates/nonexistent/path")
        assert response.status_code == 404
