"""Archive files are served only as passive media (security audit 2026-11-13,
backend/services/media_range.py:MediaFileResponse:extension-derived-active-content-type).

A blog image URL ending in .html or .svg was stored under that extension and the
media route served it inline as text/html / image/svg+xml on the app origin, where
its script could drive the local API. Every archive-file route now serves pictures,
video and voice inline with an exact type and anything else as an opaque
attachment, always with nosniff and the sandbox CSP.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.main import app
from backend.security_headers import SANDBOX_CSP
from backend.services.passive_media import (
    INLINE_MEDIA_TYPES,
    OPAQUE_TYPE,
    passive_media,
)

client = TestClient(app)

ACTIVE_NAMES = [
    "img_1.html",
    "img_2.svg",
    "a.xhtml",
    "a.xml",
    "a.htm",
    "a.js",
    "a.bin",
    "noext",
]


class TestPassiveMedia:
    @pytest.mark.parametrize(
        "name,media_type",
        [
            ("a.jpg", "image/jpeg"),
            ("a.JPEG", "image/jpeg"),
            ("a.png", "image/png"),
            ("a.gif", "image/gif"),
            ("a.webp", "image/webp"),
            ("a.mp4", "video/mp4"),
            ("a.mov", "video/quicktime"),
            ("a.webm", "video/webm"),
            ("a.m4a", "audio/mp4"),
            ("a.mp3", "audio/mpeg"),
            ("a.wav", "audio/wav"),
        ],
    )
    def test_archive_media_is_inline_with_an_exact_type(self, name, media_type):
        result = passive_media(name, route="media")
        assert result.inline is True
        assert result.media_type == media_type
        assert result.headers == {
            "x-content-type-options": "nosniff",
            "content-security-policy": SANDBOX_CSP,
        }

    def test_inline_types_are_the_extensions_pysaka_archives(self):
        # pysaka.utils.get_media_extension keeps exactly these for message media.
        assert set(INLINE_MEDIA_TYPES) == {
            ".jpg",
            ".jpeg",
            ".png",
            ".gif",
            ".webp",
            ".m4a",
            ".mp3",
            ".wav",
            ".mp4",
            ".mov",
            ".webm",
        }

    @pytest.mark.parametrize("name", ACTIVE_NAMES)
    def test_anything_else_is_an_opaque_attachment(self, name):
        with capture_logs() as logs:
            result = passive_media(name, route="blog_image")
        assert result.inline is False
        assert result.media_type == OPAQUE_TYPE
        assert result.headers == {
            "x-content-type-options": "nosniff",
            "content-security-policy": SANDBOX_CSP,
            "content-disposition": "attachment",
        }
        assert logs == [
            {"event": "media_type_refused", "route": "blog_image", "log_level": "info"}
        ]

    def test_sandbox_policy_runs_nothing_and_only_the_app_may_frame(self):
        assert SANDBOX_CSP == "default-src 'none'; sandbox; frame-ancestors 'self'"


def _media(path: Path, headers: dict[str, str] | None = None):
    with patch("backend.api.content._resolve_media_path", return_value=path):
        return client.get("/api/content/media/svc/x", headers=headers or {})


class TestMediaRoute:
    @pytest.mark.parametrize("name", ["img_1.html", "img_2.svg"])
    def test_active_files_are_never_served_inline(self, tmp_path, name):
        f = tmp_path / name
        f.write_text("<script>fetch('/api/settings')</script>", encoding="utf-8")
        resp = _media(f)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/octet-stream"
        assert resp.headers["content-disposition"] == "attachment"
        assert resp.headers.get_list("content-security-policy") == [SANDBOX_CSP]
        assert resp.headers["x-content-type-options"] == "nosniff"

    def test_pictures_stay_inline_with_the_sandbox_policy(self, tmp_path):
        f = tmp_path / "pic.jpg"
        f.write_bytes(b"\xff\xd8\xff\xe0")
        resp = _media(f)
        assert resp.headers["content-type"] == "image/jpeg"
        assert "content-disposition" not in resp.headers
        assert resp.headers.get_list("content-security-policy") == [SANDBOX_CSP]

    def test_ranges_keep_the_passive_headers(self, tmp_path):
        f = tmp_path / "clip.mp4"
        f.write_bytes(b"\x00" * 5000)
        resp = _media(f, {"Range": "bytes=0-99"})
        assert resp.status_code == 206
        assert resp.headers["content-type"] == "video/mp4"
        assert resp.headers.get_list("content-security-policy") == [SANDBOX_CSP]


class TestAvatarRoute:
    def test_an_undecodable_source_is_never_served_inline(self, tmp_path):
        src = tmp_path / "a.html"
        src.write_text("<script></script>", encoding="utf-8")
        with (
            patch("backend.api.content._resolve_media_path", return_value=src),
            patch("backend.services.avatar_resize.resized_avatar", return_value=src),
        ):
            resp = client.get("/api/content/avatar/svc/a.html?w=64")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/octet-stream"
        assert resp.headers["content-disposition"] == "attachment"
        assert resp.headers["content-security-policy"] == SANDBOX_CSP

    def test_a_resized_avatar_is_webp_with_the_sandbox_policy(self, tmp_path):
        src = tmp_path / "a.png"
        src.write_bytes(b"\x89PNG")
        variant = tmp_path / "abc-64.webp"
        variant.write_bytes(b"RIFF")
        with (
            patch("backend.api.content._resolve_media_path", return_value=src),
            patch(
                "backend.services.avatar_resize.resized_avatar", return_value=variant
            ),
        ):
            resp = client.get("/api/content/avatar/svc/a.png?w=64")
        assert resp.headers["content-type"] == "image/webp"
        assert resp.headers["content-security-policy"] == SANDBOX_CSP


def _blog_index() -> dict:
    return {
        "members": {
            "9": {
                "name": "春野 ひなた",
                "blogs": [{"id": "142", "published_at": "2026-11-03T09:00:00Z"}],
            }
        }
    }


class TestBlogImageRoute:
    def _get(
        self, tmp_path: Path, filename: str, body: bytes, download: str | None = None
    ):
        images = tmp_path / "images"
        images.mkdir(exist_ok=True)
        (images / filename).write_bytes(body)
        svc = MagicMock()
        svc.load_blog_index = AsyncMock(return_value=_blog_index())
        svc.get_blog_cache_path = MagicMock(return_value=tmp_path)
        url = f"/api/blogs/image?service=hinatazaka46&blog_id=142&filename={filename}"
        if download:
            url += f"&download={download}"
        with patch("backend.api.blogs.blog_service", svc):
            return client.get(url)

    def test_a_cached_html_file_is_an_opaque_attachment(self, tmp_path):
        resp = self._get(tmp_path, "img_1.html", b"<script></script>")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/octet-stream"
        assert resp.headers["content-disposition"] == "attachment"
        assert resp.headers["content-security-policy"] == SANDBOX_CSP

    def test_a_cached_picture_is_inline_and_cacheable(self, tmp_path):
        resp = self._get(tmp_path, "img_0.jpg", b"\xff\xd8")
        assert resp.headers["content-type"] == "image/jpeg"
        assert resp.headers["cache-control"] == "public, max-age=604800"
        assert resp.headers["content-security-policy"] == SANDBOX_CSP
        assert "content-disposition" not in resp.headers

    def test_download_keeps_the_save_as_attachment(self, tmp_path):
        resp = self._get(tmp_path, "img_0.jpg", b"\xff\xd8", download="photo.jpg")
        assert resp.headers["content-type"] == "application/octet-stream"
        assert resp.headers["content-disposition"].startswith("attachment")
        assert "photo.jpg" in resp.headers["content-disposition"]


def test_media_type_refused_is_throttled():
    """B-T1: each opaque request logged one line; a page could flood debug.log."""
    from backend.services import passive_media as pm

    pm._refusal_logs.reset()
    with capture_logs() as logs:
        for _ in range(pm._refusal_logs.limit + 5):
            pm.passive_media("x.html", route="media")
    refused = [e for e in logs if e["event"] == "media_type_refused"]
    assert len(refused) == pm._refusal_logs.limit
