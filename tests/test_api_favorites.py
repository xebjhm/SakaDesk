"""Tests for backend/api/favorites.py - Favorites endpoints."""

from fastapi.testclient import TestClient
import pytest

from backend.main import app


@pytest.fixture
def client():
    """Create test client."""
    return TestClient(app)


class TestAddFavoriteEndpoint:
    """Test POST /api/favorites/{message_id} endpoint."""

    def test_requires_service_param(self, client):
        """Endpoint should require service parameter."""
        response = client.post("/api/favorites/123")
        # FastAPI returns 422 for missing required query param
        assert response.status_code == 422

    def test_rejects_invalid_service(self, client):
        """Endpoint should reject invalid service."""
        response = client.post("/api/favorites/123?service=invalid_service")
        assert response.status_code == 400
        data = response.json()
        assert "Unknown service" in data["detail"]


class TestRemoveFavoriteEndpoint:
    """Test DELETE /api/favorites/{message_id} endpoint."""

    def test_requires_service_param(self, client):
        """Endpoint should require service parameter."""
        response = client.delete("/api/favorites/123")
        # FastAPI returns 422 for missing required query param
        assert response.status_code == 422

    def test_rejects_invalid_service(self, client):
        """Endpoint should reject invalid service."""
        response = client.delete("/api/favorites/123?service=invalid_service")
        assert response.status_code == 400
        data = response.json()
        assert "Unknown service" in data["detail"]
