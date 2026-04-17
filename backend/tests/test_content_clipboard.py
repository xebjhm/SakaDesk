from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_clipboard_requires_media_url():
    """POST /api/content/clipboard requires media_url in body."""
    response = client.post("/api/content/clipboard", json={})
    assert response.status_code == 422


def test_clipboard_non_windows_returns_501():
    """On non-Windows, the endpoint returns 501."""
    with patch("backend.api.content.is_windows", return_value=False):
        response = client.post(
            "/api/content/clipboard",
            json={
                "media_url": "/api/content/media/hinatazaka46/messages/test/video/1.mp4"
            },
        )
    assert response.status_code == 501


def test_clipboard_file_not_found(tmp_path):
    """Returns 404 when the resolved file doesn't exist."""
    with (
        patch("backend.api.content.is_windows", return_value=True),
        patch("backend.api.content.get_output_dir", return_value=tmp_path),
    ):
        response = client.post(
            "/api/content/clipboard",
            json={
                "media_url": "/api/content/media/hinatazaka46/messages/test/video/1.mp4"
            },
        )
    assert response.status_code == 404
