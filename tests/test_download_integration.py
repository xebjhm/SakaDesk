import pytest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient


@pytest.fixture
def media_dir(tmp_path):
    """Create a temp output dir with test media files."""
    service_dir = tmp_path / "日向坂46" / "messages" / "90 高井 俐香" / "picture"
    service_dir.mkdir(parents=True)
    test_file = service_dir / "12345.jpg"
    test_file.write_bytes(b'\xff\xd8\xff\xe0fake-jpeg-content')
    return tmp_path


class TestMediaEndpoint:
    def test_serves_file_inline(self, client, media_dir):
        with patch("backend.api.content.get_output_dir", return_value=media_dir):
            resp = client.get("/api/content/media/hinatazaka46/messages/90 高井 俐香/picture/12345.jpg")
            assert resp.status_code == 200
            assert b'fake-jpeg-content' in resp.content

    def test_translates_service_id_to_display_name(self, client, media_dir):
        """hinatazaka46 -> 日向坂46 for disk lookup."""
        with patch("backend.api.content.get_output_dir", return_value=media_dir):
            resp = client.get("/api/content/media/hinatazaka46/messages/90 高井 俐香/picture/12345.jpg")
            assert resp.status_code == 200

    def test_404_for_missing_file(self, client, media_dir):
        with patch("backend.api.content.get_output_dir", return_value=media_dir):
            resp = client.get("/api/content/media/hinatazaka46/messages/nonexistent.jpg")
            assert resp.status_code == 404


class TestDownloadEndpoint:
    def test_returns_attachment_disposition(self, client, media_dir):
        with patch("backend.api.content.get_output_dir", return_value=media_dir):
            resp = client.get("/api/content/download/hinatazaka46/messages/90 高井 俐香/picture/12345.jpg")
            assert resp.status_code == 200
            assert 'attachment' in resp.headers.get('content-disposition', '')

    def test_custom_filename_in_disposition(self, client, media_dir):
        with patch("backend.api.content.get_output_dir", return_value=media_dir):
            resp = client.get(
                "/api/content/download/hinatazaka46/messages/90 高井 俐香/picture/12345.jpg"
                "?filename=2026-03-18_1221_12345.jpg"
            )
            assert resp.status_code == 200
            assert '2026-03-18_1221_12345.jpg' in resp.headers.get('content-disposition', '')

    def test_default_filename_when_not_specified(self, client, media_dir):
        with patch("backend.api.content.get_output_dir", return_value=media_dir):
            resp = client.get("/api/content/download/hinatazaka46/messages/90 高井 俐香/picture/12345.jpg")
            assert resp.status_code == 200
            assert '12345.jpg' in resp.headers.get('content-disposition', '')

    def test_octet_stream_media_type(self, client, media_dir):
        with patch("backend.api.content.get_output_dir", return_value=media_dir):
            resp = client.get("/api/content/download/hinatazaka46/messages/90 高井 俐香/picture/12345.jpg")
            assert resp.headers.get('content-type', '').startswith('application/octet-stream')

    def test_404_for_missing_file(self, client, media_dir):
        with patch("backend.api.content.get_output_dir", return_value=media_dir):
            resp = client.get("/api/content/download/hinatazaka46/nonexistent.jpg")
            assert resp.status_code == 404
