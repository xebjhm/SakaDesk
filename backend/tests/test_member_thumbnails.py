"""Member thumbnails stay inside member_thumbnails and are served only as pictures
(security audit 2026-11-13: backend/services/blog_service.py:remote-blog-identifiers-as-path-segments,
backend/services/blog_service.py:get_member_thumbnail_path:member_id-unvalidated-path-join;
Plan B leftovers B-T1 and B-T2).

The Nogizaka46 member ``code`` named the thumbnail file and, for a non-image
Content-Type, the remote URL's suffix became its extension: ``../../x`` + ``.cmd``
wrote a batch file outside the archive. The reader joined the request's
member_id the same way, so on Windows ``..\\``, drive and UNC forms left the
folder. The route served a hard-coded type map without the sandbox CSP.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.main import app
from backend.security_headers import SANDBOX_CSP
from backend.services.blog_service import BlogService, _thumbnail_ext

pytestmark = pytest.mark.usefixtures("session_image_fetch")

client = TestClient(app)

ESCAPE_MEMBER = "../../../../escape_target/v3thumb"


def _session(status=200, content_type="image/jpeg", body=b"\xff\xd8\xff\xe0jpeg"):
    resp = AsyncMock()
    resp.status = status
    resp.headers = {"Content-Type": content_type}
    resp.read = AsyncMock(return_value=body)
    resp.__aenter__ = AsyncMock(return_value=resp)
    resp.__aexit__ = AsyncMock(return_value=False)
    session = MagicMock()
    session.get = MagicMock(return_value=resp)
    return session


@pytest.mark.parametrize(
    "content_type,url,ext,reason",
    [
        ("image/jpeg", "https://x/v3payload.cmd", ".jpg", None),
        ("image/png; charset=binary", "https://x/a", ".png", None),
        ("IMAGE/WEBP", "https://x/a", ".webp", None),
        ("text/plain", "https://x/v3payload.cmd", ".jpg", "not_image"),
        ("", "https://x/a.webp?v=2", ".webp", None),
        ("application/octet-stream", "https://x/a.JPEG", ".jpg", None),
        ("application/octet-stream", "https://x/a", ".jpg", "no_suffix"),
        ("", "http://[::1/a.png", ".jpg", "no_suffix"),
    ],
)
def test_thumbnail_ext_keeps_only_picture_extensions(content_type, url, ext, reason):
    with capture_logs() as logs:
        assert _thumbnail_ext(content_type, url) == ext
    defaulted = [e for e in logs if e["event"] == "member_thumbnail_ext_defaulted"]
    assert [e["reason"] for e in defaulted] == ([reason] if reason else [])
    assert "x/" not in str(logs)


@pytest.mark.asyncio
async def test_an_unsafe_member_code_is_never_fetched_or_written(tmp_path):
    thumbs = tmp_path / "out" / "乃木坂46" / "blogs" / "member_thumbnails"
    thumbs.mkdir(parents=True)
    (tmp_path / "escape_target").mkdir()
    session = _session(content_type="text/plain", body=b"@echo off\r\nrem MARKER\r\n")
    with capture_logs() as logs:
        name = await BlogService()._download_member_thumbnail(
            session, ESCAPE_MEMBER, "http://127.0.0.1:1/v3payload.cmd", thumbs
        )
    assert name is None
    session.get.assert_not_called()
    assert list((tmp_path / "escape_target").iterdir()) == []
    assert [e["reason"] for e in logs if e["event"] == "member_thumbnail_rejected"] == [
        "member_id"
    ]


@pytest.mark.asyncio
async def test_a_thumbnail_is_saved_only_under_a_picture_extension(tmp_path):
    session = _session(content_type="text/plain", body=b"@echo off\r\n")
    name = await BlogService()._download_member_thumbnail(
        session, "55401", "https://img.nogizaka46.com/x/v3payload.cmd", tmp_path
    )
    assert name == "55401.jpg"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["55401.jpg"]


@pytest.mark.asyncio
async def test_a_failed_thumbnail_logs_the_status_only(tmp_path):
    with capture_logs() as logs:
        name = await BlogService()._download_member_thumbnail(
            _session(status=404), "55401", "https://x/a.jpg", tmp_path
        )
    assert name is None
    (event,) = [e for e in logs if e["event"] == "thumbnail_download_failed"]
    assert event["status"] == 404 and "member_id" not in event
    assert list(tmp_path.iterdir()) == []


@pytest.mark.asyncio
async def test_a_thumbnail_error_logs_the_error_type_only(tmp_path):
    session = MagicMock()
    session.get = MagicMock(side_effect=OSError("C:\\Users\\victim"))
    with capture_logs() as logs:
        name = await BlogService()._download_member_thumbnail(
            session, "55401", "https://x/a.jpg", tmp_path
        )
    assert name is None
    (event,) = [e for e in logs if e["event"] == "thumbnail_download_error"]
    assert event["error_type"] == "OSError" and "victim" not in str(logs)


@pytest.mark.asyncio
async def test_a_member_without_a_url_is_skipped(tmp_path):
    session = _session()
    with capture_logs() as logs:
        assert (
            await BlogService()._download_member_thumbnail(
                session, "55401", None, tmp_path
            )
            is None
        )
    session.get.assert_not_called()
    assert [e["reason"] for e in logs if e["event"] == "member_thumbnail_rejected"] == [
        "url"
    ]


@pytest.mark.asyncio
async def test_members_with_unsafe_codes_are_dropped_before_any_download(tmp_path):
    svc = BlogService()
    scraper = MagicMock()
    scraper.get_members_with_thumbnails = AsyncMock(
        return_value=[
            SimpleNamespace(
                id="55401",
                name="金村 美玖",
                thumbnail_url="https://img.nogizaka46.com/a.jpg",
            ),
            SimpleNamespace(
                id=ESCAPE_MEMBER,
                name="Evil Member",
                thumbnail_url="http://127.0.0.1:1/v3payload.cmd",
            ),
        ]
    )
    download = AsyncMock(return_value="55401.jpg")
    with (
        patch("backend.services.blog_service.get_scraper", return_value=scraper),
        patch.object(
            svc, "get_member_thumbnails_path", return_value=tmp_path / "thumbs"
        ),
        patch.object(svc, "_download_member_thumbnail", download),
        capture_logs() as logs,
    ):
        members = await svc.get_members_with_thumbnails("nogizaka46")
    assert members == [{"id": "55401", "name": "金村 美玖", "thumbnail": "55401.jpg"}]
    assert download.await_count == 1
    (event,) = [e for e in logs if e["event"] == "member_thumbnail_rejected"]
    assert (event["reason"], event["count"]) == ("member_id", 1)
    assert "Evil" not in str(logs)


@pytest.mark.parametrize(
    "member_id",
    [
        "..\\..\\Pictures\\private",
        "C:\\Users\\victim\\x",
        "\\\\attacker.example\\share\\x",
        "../x",
        "CON",
        "",
        "a:b",
    ],
)
def test_member_thumbnail_path_refuses_other_paths_before_touching_disk(member_id):
    svc = BlogService()
    with patch.object(
        svc, "get_member_thumbnails_path", side_effect=AssertionError("disk reached")
    ):
        assert svc.get_member_thumbnail_path("hinatazaka46", member_id) is None


@patch("backend.api.blogs.blog_service")
def test_the_thumbnail_route_serves_only_passive_pictures(
    mock_svc, tmp_path, monkeypatch
):
    from PIL import Image

    from backend.services import avatar_resize

    monkeypatch.setattr(avatar_resize, "cache_dir", lambda: tmp_path / "cache")
    thumb = tmp_path / "55401.jpg"
    Image.new("RGB", (400, 600)).save(thumb)
    mock_svc.get_member_thumbnail_path = MagicMock(return_value=thumb)
    for url, media_type in (
        ("/api/blogs/member-thumbnail/nogizaka46/55401", "image/jpeg"),
        ("/api/blogs/member-thumbnail/nogizaka46/55401?w=64", "image/webp"),
    ):
        response = client.get(url)
        assert response.status_code == 200
        assert response.headers["content-type"].startswith(media_type)
        assert response.headers["content-security-policy"] == SANDBOX_CSP
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["cache-control"] == "public, max-age=86400"


@pytest.mark.parametrize(
    "member_id",
    [
        "..%5C..%5C..%5C..%5C..%5CPictures%5Cprivate",
        "C:%5CUsers%5Cvictim%5CPictures%5Cprivate",
        "%5C%5Cattacker.example%5Cshare%5Cx",
        "CON",
        "a:b",
    ],
)
def test_the_thumbnail_route_refuses_ids_that_name_other_paths(member_id):
    with capture_logs() as logs:
        response = client.get(f"/api/blogs/member-thumbnail/hinatazaka46/{member_id}")
    assert response.status_code == 404
    assert [e["reason"] for e in logs if e["event"] == "member_thumbnail_rejected"] == [
        "member_id"
    ]


from backend.services import blog_service as _bs  # noqa: E402


def test_one_thumbnail_extension_list():
    """C-T3: the writer's and the reader's extension lists must agree."""
    assert set(_bs._THUMBNAIL_EXT_BY_TYPE.values()) == set(_bs._THUMBNAIL_EXTS)
    assert set(_bs._THUMBNAIL_EXT_BY_SUFFIX.values()) == set(_bs._THUMBNAIL_EXTS)


@pytest.mark.asyncio
async def test_writing_a_thumbnail_removes_its_other_extensions(tmp_path):
    (tmp_path / "55401.jpg").write_bytes(b"old")
    (tmp_path / "55401.webp").write_bytes(b"old")
    (tmp_path / "99.jpg").write_bytes(b"other member")
    name = await BlogService()._download_member_thumbnail(
        _session(content_type="image/png", body=b"\x89PNG"),
        "55401",
        "https://img.nogizaka46.com/a",
        tmp_path,
    )
    assert name == "55401.png"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["55401.png", "99.jpg"]


@pytest.mark.asyncio
async def test_a_failed_thumbnail_leaves_the_cache_unhashed_so_it_is_retried(tmp_path):
    svc = BlogService()
    listed = [
        SimpleNamespace(
            id="1", name="a", thumbnail_url="https://img.nogizaka46.com/1.jpg"
        ),
        SimpleNamespace(
            id="2", name="b", thumbnail_url="https://img.nogizaka46.com/2.jpg"
        ),
    ]
    scraper = MagicMock()
    scraper.get_members_with_thumbnails = AsyncMock(return_value=listed)
    download = AsyncMock(
        side_effect=lambda _s, mid, _u, _d: "1.jpg" if mid == "1" else None
    )
    with (
        patch("backend.services.blog_service.get_scraper", return_value=scraper),
        patch.object(
            svc, "get_member_thumbnails_path", return_value=tmp_path / "thumbs"
        ),
        patch.object(
            svc, "get_members_cache_path", return_value=tmp_path / "members.json"
        ),
        patch.object(svc, "_download_member_thumbnail", download),
        capture_logs() as logs,
    ):
        await svc.get_members_with_thumbnails("nogizaka46")
        cache = json.loads((tmp_path / "members.json").read_text(encoding="utf-8"))
        assert cache["hash"] is None
        await svc.get_members_with_thumbnails("nogizaka46")
    assert download.await_count == 4  # the second call downloaded again
    incomplete = [e for e in logs if e["event"] == "members_thumbnails_incomplete"]
    assert incomplete and (incomplete[0]["failed"], incomplete[0]["count"]) == (1, 2)


@pytest.mark.asyncio
async def test_a_complete_download_is_cached_by_hash(tmp_path):
    svc = BlogService()
    listed = [
        SimpleNamespace(
            id="1", name="a", thumbnail_url="https://img.nogizaka46.com/1.jpg"
        )
    ]
    scraper = MagicMock()
    scraper.get_members_with_thumbnails = AsyncMock(return_value=listed)
    download = AsyncMock(return_value="1.jpg")
    with (
        patch("backend.services.blog_service.get_scraper", return_value=scraper),
        patch.object(
            svc, "get_member_thumbnails_path", return_value=tmp_path / "thumbs"
        ),
        patch.object(
            svc, "get_members_cache_path", return_value=tmp_path / "members.json"
        ),
        patch.object(svc, "_download_member_thumbnail", download),
    ):
        await svc.get_members_with_thumbnails("nogizaka46")
        await svc.get_members_with_thumbnails("nogizaka46")
    assert download.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "member",
    [
        SimpleNamespace(id="2", name="b", thumbnail_url=""),
        SimpleNamespace(id="2", name="b", thumbnail_url=None),
        SimpleNamespace(
            id="../2", name="b", thumbnail_url="https://img.nogizaka46.com/2.jpg"
        ),
        SimpleNamespace(
            id="2", name="b", thumbnail_url="https://elsewhere.example/2.jpg"
        ),
    ],
)
async def test_a_member_with_nothing_to_fetch_does_not_block_the_cache(
    tmp_path, member
):
    """No URL, an unsafe id or an off-list host never downloads: not a failure to retry."""
    svc = BlogService()
    listed = [
        SimpleNamespace(
            id="1", name="a", thumbnail_url="https://img.nogizaka46.com/1.jpg"
        ),
        member,
    ]
    scraper = MagicMock()
    scraper.get_members_with_thumbnails = AsyncMock(return_value=listed)
    download = AsyncMock(
        side_effect=lambda _s, mid, _u, _d: "1.jpg" if mid == "1" else None
    )
    with (
        patch("backend.services.blog_service.get_scraper", return_value=scraper),
        patch.object(
            svc, "get_member_thumbnails_path", return_value=tmp_path / "thumbs"
        ),
        patch.object(
            svc, "get_members_cache_path", return_value=tmp_path / "members.json"
        ),
        patch.object(svc, "_download_member_thumbnail", download),
    ):
        await svc.get_members_with_thumbnails("nogizaka46")
        first = download.await_count
        await svc.get_members_with_thumbnails("nogizaka46")
    cache = json.loads((tmp_path / "members.json").read_text(encoding="utf-8"))
    assert cache["hash"] is not None
    assert download.await_count == first  # the second call was a cache hit
