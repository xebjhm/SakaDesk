"""Tests for blogs API endpoints."""

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


def test_blogs_members_requires_service():
    """Test that /api/blogs/members requires service parameter."""
    response = client.get("/api/blogs/members")
    assert response.status_code == 422


def test_blogs_list_requires_params():
    """Test that /api/blogs/list requires service and member_id parameters."""
    response = client.get("/api/blogs/list")
    assert response.status_code == 422


def test_blogs_cache_size_endpoint():
    """Test that /api/blogs/cache-size returns cache size info."""
    response = client.get("/api/blogs/cache-size?service=hinatazaka46")
    assert response.status_code == 200
    assert "size_bytes" in response.json()


def test_blogs_invalid_service():
    """Test that invalid service returns 400 error."""
    response = client.get("/api/blogs/cache-size?service=invalid_service")
    assert response.status_code == 400


def test_blogs_clear_cache_endpoint():
    """Test that DELETE /api/blogs/cache clears cache for a service."""
    response = client.delete("/api/blogs/cache?service=hinatazaka46")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["service"] == "hinatazaka46"


def test_blogs_clear_cache_invalid_service():
    """Test that DELETE /api/blogs/cache returns 400 for invalid service."""
    response = client.delete("/api/blogs/cache?service=invalid_service")
    assert response.status_code == 400
