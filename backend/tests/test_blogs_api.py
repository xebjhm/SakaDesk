"""Tests for blogs API endpoints."""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from structlog.testing import capture_logs

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


# --- GET /api/blogs/gallery (media pipeline M7) ----------------------------------------

GALLERY = "/api/blogs/gallery"
IMAGE = {
    "blog_id": "b1",
    "published_at": "2026-02-05T10:00:00+09:00",
    "title": "🌸 春のおさんぽ",
    "image_index": 0,
    "media_url": "/api/content/media/hinatazaka46/blogs/x/20260205_b1/images/img_0.jpg",
    "src": "/api/blogs/image?service=hinatazaka46&blog_id=b1&filename=img_0.jpg",
}


def _backup(on: bool):
    return patch("backend.api.blogs.blog_backup_enabled", AsyncMock(return_value=on))


def test_gallery_unknown_service_is_400():
    with _backup(True):
        r = client.get(GALLERY, params={"service": "nope", "member_id": "58"})
    assert r.status_code == 400


def test_gallery_requires_a_member_id():
    r = client.get(GALLERY, params={"service": "hinatazaka46"})
    assert r.status_code == 422


def test_gallery_is_empty_without_blog_backup():
    gallery = AsyncMock(return_value=[IMAGE])
    with _backup(False), patch("backend.api.blogs.gallery_images", gallery):
        r = client.get(GALLERY, params={"service": "hinatazaka46", "member_id": "58"})
    assert r.status_code == 200
    assert r.json() == {"images": []}
    gallery.assert_not_called()


def test_gallery_returns_the_images_for_the_member():
    gallery = AsyncMock(return_value=[IMAGE])
    with _backup(True), patch("backend.api.blogs.gallery_images", gallery):
        r = client.get(GALLERY, params={"service": "hinatazaka46", "member_id": "58"})
    assert r.status_code == 200
    assert r.json() == {"images": [IMAGE]}
    gallery.assert_awaited_once_with("hinatazaka46", "58")


def test_gallery_unexpected_failure_is_500_with_codes_only():
    gallery = AsyncMock(side_effect=RuntimeError("金村 secret"))
    with (
        _backup(True),
        patch("backend.api.blogs.gallery_images", gallery),
        capture_logs() as logs,
    ):
        r = client.get(GALLERY, params={"service": "hinatazaka46", "member_id": "58"})
    assert r.status_code == 500
    assert "金村" not in r.text and "金村" not in repr(logs)
    assert {
        "event": "blog_gallery_failed",
        "service": "hinatazaka46",
        "error_type": "RuntimeError",
        "log_level": "error",
    } in logs
