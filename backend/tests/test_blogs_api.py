"""Tests for blogs API endpoints."""
import pytest
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
