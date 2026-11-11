import pytest
import asyncio
import json
from unittest.mock import ANY, AsyncMock, patch

from PIL import Image
from structlog.testing import capture_logs

from backend.services.blog_service import BlogService


@pytest.fixture
def blog_service():
    return BlogService()


def test_get_blog_index_path(blog_service):
    """get_blog_index_path returns correct path."""
    path = blog_service.get_blog_index_path("hinatazaka46")
    assert path.name == "index.json"
    assert "blogs" in str(path)


def test_get_blogs_base_path(blog_service):
    """get_blogs_base_path returns correct path."""
    path = blog_service.get_blogs_base_path("hinatazaka46")
    assert "blogs" in str(path)
    assert "日向坂46" in str(path)


def test_invalid_service_raises(blog_service):
    """Invalid service raises ValueError."""
    with pytest.raises(ValueError):
        blog_service.get_blogs_base_path("invalid_service")


def test_get_blog_cache_path(blog_service):
    """get_blog_cache_path returns correct path structure."""
    path = blog_service.get_blog_cache_path(
        "hinatazaka46", "金村 美玖", "12345", "20240101"
    )
    assert "金村 美玖" in str(path)
    assert "20240101_12345" in str(path)


def test_load_blog_index_default_when_missing(blog_service, tmp_path):
    """load_blog_index returns default dict when index doesn't exist."""
    with patch.object(
        blog_service,
        "get_blog_index_path",
        return_value=tmp_path / "nonexistent" / "index.json",
    ):
        result = asyncio.run(blog_service.load_blog_index("hinatazaka46"))
        assert result == {"members": {}, "last_sync": None, "last_download": None}


def test_save_and_load_blog_index(blog_service, tmp_path):
    """save_blog_index persists data that can be loaded."""
    index_path = tmp_path / "index.json"

    with patch.object(blog_service, "get_blog_index_path", return_value=index_path):
        test_index = {
            "members": {"123": {"name": "Test", "blogs": []}},
            "last_sync": "2024-01-01T00:00:00Z",
        }
        asyncio.run(blog_service.save_blog_index("hinatazaka46", test_index))

        loaded = asyncio.run(blog_service.load_blog_index("hinatazaka46"))
        assert loaded == test_index


def test_get_cache_size_empty(blog_service, tmp_path):
    """get_cache_size returns 0 for non-existent path."""
    with patch.object(
        blog_service, "get_blogs_base_path", return_value=tmp_path / "nonexistent"
    ):
        result = asyncio.run(blog_service.get_cache_size("hinatazaka46"))
        assert result == 0


def test_get_cache_size_with_files(blog_service, tmp_path):
    """get_cache_size counts file sizes correctly."""
    # Create test files
    (tmp_path / "member1").mkdir()
    (tmp_path / "member1" / "file1.txt").write_text("hello")  # 5 bytes
    (tmp_path / "member1" / "file2.txt").write_text("world!!")  # 7 bytes

    with patch.object(blog_service, "get_blogs_base_path", return_value=tmp_path):
        result = asyncio.run(blog_service.get_cache_size("hinatazaka46"))
        assert result == 12


def test_get_cache_size_walks_nested_dirs(blog_service, tmp_path):
    """get_cache_size sums files at every depth, including non-ASCII names."""
    blog = tmp_path / "日向坂 メンバー" / "20250101_123"
    blog.mkdir(parents=True)
    (blog / "blog.json").write_bytes(b"x" * 10)
    (blog / "images").mkdir()
    (blog / "images" / "写真😀.jpg").write_bytes(b"y" * 20)
    (tmp_path / "index.json").write_bytes(b"z" * 3)

    with patch.object(blog_service, "get_blogs_base_path", return_value=tmp_path):
        result = asyncio.run(blog_service.get_cache_size("hinatazaka46"))
    assert result == 33


def test_get_cache_size_logs_scan_breadcrumb(blog_service, tmp_path):
    """The size scan leaves a breadcrumb with the file count and duration."""
    (tmp_path / "a.txt").write_bytes(b"abc")
    with (
        patch.object(blog_service, "get_blogs_base_path", return_value=tmp_path),
        patch("backend.services.blog_service.logger") as log,
    ):
        asyncio.run(blog_service.get_cache_size("hinatazaka46"))
    log.debug.assert_any_call(
        "blog_cache_size_scanned",
        service="hinatazaka46",
        files=1,
        duration_ms=ANY,
    )


def test_get_cache_stats_counts_cached_without_walking_tree(blog_service, tmp_path):
    """Stats count cached blogs from the index and never walk the whole tree."""
    index = {
        "members": {
            "1": {
                "name": "メンバー ",
                "blogs": [
                    {"id": "10", "published_at": "2025-01-02T00:00:00"},
                    {"id": "11", "published_at": "2025-01-03T00:00:00"},
                    {
                        "id": "12",
                        "published_at": "2025-01-04T00:00:00",
                        "removed": True,
                    },
                ],
            },
            "2": {
                "name": "卒業生",
                "blogs_removed": True,
                "blogs": [{"id": "20", "published_at": "2024-01-01T00:00:00"}],
            },
        },
        "last_sync": "2025-01-05T00:00:00Z",
    }
    cached = tmp_path / "メンバー" / "20250102_10"
    cached.mkdir(parents=True)
    (cached / "blog.json").write_text("{}", encoding="utf-8")

    with (
        patch.object(blog_service, "get_blogs_base_path", return_value=tmp_path),
        patch.object(blog_service, "load_blog_index", AsyncMock(return_value=index)),
        patch.object(blog_service, "get_cache_size", AsyncMock()) as size,
    ):
        stats = asyncio.run(blog_service.get_cache_stats("hinatazaka46"))

    size.assert_not_called()
    assert "cache_size_bytes" not in stats
    assert stats == {
        "total_blogs": 4,
        "available_blogs": 2,
        "cached_blogs": 1,
        "removed_blogs": 2,
        "pending_download": 1,
        "last_sync": "2025-01-05T00:00:00Z",
        "last_download": None,
    }


def test_clear_cache_preserves_index(blog_service, tmp_path):
    """clear_cache removes cache files but preserves index.json."""
    # Set up test directory structure
    blogs_dir = tmp_path / "blogs"
    blogs_dir.mkdir()
    index_path = blogs_dir / "index.json"

    # Create index file
    index_content = '{"members": {}, "last_sync": "2024-01-01T00:00:00Z"}'
    index_path.write_text(index_content, encoding="utf-8")

    # Create cache files
    cache_dir = blogs_dir / "member1" / "20240101_12345"
    cache_dir.mkdir(parents=True)
    (cache_dir / "blog.json").write_text('{"test": true}', encoding="utf-8")

    # Verify files exist
    assert index_path.exists()
    assert cache_dir.exists()

    # Mock paths to use tmp_path
    with patch.object(blog_service, "get_blogs_base_path", return_value=blogs_dir):
        with patch.object(blog_service, "get_blog_index_path", return_value=index_path):
            asyncio.run(blog_service.clear_cache("hinatazaka46"))

    # Verify cache is cleared but index is preserved
    assert index_path.exists()
    assert index_path.read_text(encoding="utf-8") == index_content
    assert not cache_dir.exists()  # Cache should be deleted


def _index_with_blogs(count: int) -> dict:
    return {
        "members": {
            "1": {
                "name": "メンバー",
                "blogs": [
                    {
                        "id": str(i),
                        "title": f"t{i}",
                        "url": f"https://example.invalid/{i}",
                        "published_at": "2025-01-02T00:00:00",
                    }
                    for i in range(count)
                ],
            }
        }
    }


def test_blog_loops_read_the_output_dir_once(blog_service, tmp_path):
    """Per-blog loops resolve the output folder once, not once per blog.

    ``get_output_dir`` reads settings.json from disk; per-blog calls on a full
    archive blocked the event loop for seconds.
    """
    index = _index_with_blogs(5)
    with (
        patch(
            "backend.services.blog_service.get_output_dir", return_value=tmp_path
        ) as out,
        patch.object(blog_service, "load_blog_index", AsyncMock(return_value=index)),
    ):
        asyncio.run(blog_service.get_cache_stats("hinatazaka46"))
        assert out.call_count == 1
        out.reset_mock()
        asyncio.run(blog_service.get_blog_list("hinatazaka46", "1"))
        assert out.call_count == 1
        out.reset_mock()
        queue = blog_service.build_download_queue("hinatazaka46", index)
        assert out.call_count == 1
        assert len(queue) == 5
        assert queue[0].cache_path == blog_service.get_blog_cache_path(
            "hinatazaka46", "メンバー", "0", "20250102"
        )


def test_get_blog_list_marks_cached_blogs(blog_service, tmp_path):
    """get_blog_list flags blogs whose blog.json exists."""
    index = _index_with_blogs(2)
    with (
        patch("backend.services.blog_service.get_output_dir", return_value=tmp_path),
        patch.object(blog_service, "load_blog_index", AsyncMock(return_value=index)),
    ):
        cached = blog_service.get_blog_cache_path(
            "hinatazaka46", "メンバー", "1", "20250102"
        )
        cached.mkdir(parents=True)
        (cached / "blog.json").write_text("{}", encoding="utf-8")
        result = asyncio.run(blog_service.get_blog_list("hinatazaka46", "1"))
    flags = {b["id"]: b["cached"] for b in result["blogs"]}
    assert flags == {"0": False, "1": True}


# --- gallery_images (media pipeline M7) ------------------------------------------------

MEMBER = "金村 美玖"
TITLE_NEW = "🌸 春のおさんぽ"
TITLE_OLD = "冬の日記 ❄️"


def _blog_json(folder, images, raw=None):
    folder.mkdir(parents=True, exist_ok=True)
    body = (
        raw
        if raw is not None
        else json.dumps(
            {"meta": {}, "content": {"html": ""}, "images": images}, ensure_ascii=False
        )
    )
    (folder / "blog.json").write_text(body, encoding="utf-8")


def _img(folder, name):
    (folder / "images").mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (40, 30), (200, 100, 50)).save(folder / "images" / name, "JPEG")


@pytest.fixture
def gallery_archive(tmp_path):
    """Two cached blogs with local images, one blog without blog.json, one other member."""
    from backend.services import blog_service as bs

    out = tmp_path / "out"
    base = out / "日向坂46" / "blogs"
    base.mkdir(parents=True)
    index = {
        "members": {
            "58": {
                "name": MEMBER + " ",  # trailing space: the folder strips it
                "blogs": [
                    {
                        "id": "b1",
                        "title": TITLE_OLD,
                        "published_at": "2026-01-03T10:00:00+09:00",
                        "url": "u1",
                    },
                    {
                        "id": "b2",
                        "title": TITLE_NEW,
                        "published_at": "2026-02-05T10:00:00+09:00",
                        "url": "u2",
                    },
                    {
                        "id": "b3",
                        "title": "not cached",
                        "published_at": "2026-03-01T10:00:00+09:00",
                        "url": "u3",
                    },
                ],
            },
            "61": "not a member",
            "62": {"name": "x", "blogs": ["not a blog", {"id": 5}, {"id": "n"}]},
            "63": {"name": None, "blogs": []},  # malformed: skipped, not a 500
            "64": {"name": "y", "blogs": None},
            "65": {"name": "..", "blogs": [{"id": "z", "published_at": "2026"}]},
            "66": {
                "name": "w",
                "blogs": [{"id": "../up", "published_at": "2026-01-01T00:00:00Z"}],
            },
            "60": {
                "name": "上村 ひなの",
                "blogs": [
                    {
                        "id": "c1",
                        "title": "other",
                        "published_at": "2025-12-01T10:00:00+09:00",
                        "url": "u4",
                    }
                ],
            },
        }
    }
    (base / "index.json").write_text(
        json.dumps(index, ensure_ascii=False), encoding="utf-8"
    )
    b1 = base / MEMBER / "20260103_b1"
    b2 = base / MEMBER / "20260205_b2"
    c1 = base / "上村 ひなの" / "20251201_c1"
    _blog_json(
        b1,
        [
            {"original_url": "https://x/0.jpg", "local_path": "./images/img_0.jpg"},
            # no local file: not in the gallery
            {"original_url": "https://x/1.jpg", "local_path": "./images/img_1.jpg"},
        ],
    )
    _img(b1, "img_0.jpg")
    _blog_json(
        b2,
        [
            {"original_url": "https://y/0.jpg", "local_path": "./images/img_0.jpg"},
            {"original_url": "https://y/1.jpg", "local_path": "./images/img_1.jpg"},
            "not a dict",
            {"original_url": "https://y/2.jpg"},  # never downloaded
            {"original_url": "https://y/3.jpg", "local_path": "../../escape.jpg"},
        ],
    )
    _img(b2, "img_0.jpg")
    _img(b2, "img_1.jpg")
    _blog_json(
        c1, [{"original_url": "https://z/0.jpg", "local_path": "./images/img_0.jpg"}]
    )
    _img(c1, "img_0.jpg")
    bs.reset_gallery_memo_for_tests()
    with patch("backend.services.blog_service.get_output_dir", return_value=out):
        yield out
    bs.reset_gallery_memo_for_tests()


def _gallery(service="hinatazaka46", member_id="58"):
    from backend.services import blog_service as bs

    return asyncio.run(bs.gallery_images(service, member_id))


def _src(blog_id, name):
    return f"/api/blogs/image?service=hinatazaka46&blog_id={blog_id}&filename={name}"


def test_gallery_images_newest_first_with_local_files_only(gallery_archive):
    from backend.services import archive_urls

    images = _gallery()
    media = [
        archive_urls.media_url(
            "hinatazaka46", ["blogs", MEMBER, folder, "images", name]
        )
        for folder, name in (
            ("20260205_b2", "img_0.jpg"),
            ("20260205_b2", "img_1.jpg"),
            ("20260103_b1", "img_0.jpg"),
        )
    ]
    assert images == [
        {
            "blog_id": "b2",
            "published_at": "2026-02-05T10:00:00+09:00",
            "title": TITLE_NEW,
            "image_index": 0,
            "media_url": media[0],
            "src": _src("b2", "img_0.jpg"),
        },
        {
            "blog_id": "b2",
            "published_at": "2026-02-05T10:00:00+09:00",
            "title": TITLE_NEW,
            "image_index": 1,
            "media_url": media[1],
            "src": _src("b2", "img_1.jpg"),
        },
        {
            "blog_id": "b1",
            "published_at": "2026-01-03T10:00:00+09:00",
            "title": TITLE_OLD,
            "image_index": 0,
            "media_url": media[2],
            "src": _src("b1", "img_0.jpg"),
        },
    ]


def test_gallery_images_every_member_without_a_member_id(gallery_archive):
    images = _gallery(member_id=None)
    assert [(i["blog_id"], i["image_index"]) for i in images] == [
        ("b2", 0),
        ("b2", 1),
        ("b1", 0),
        ("c1", 0),
    ]
    assert _gallery(member_id="unknown") == []


def test_gallery_media_url_resolves_to_the_file_and_the_thumb_route_serves_it(
    gallery_archive, tmp_path
):
    from fastapi.testclient import TestClient

    from backend.main import app
    from backend.services import archive_urls, photo_thumb

    first = _gallery()[0]
    path = archive_urls.media_route_path(gallery_archive, first["media_url"])
    want = gallery_archive / "日向坂46" / "blogs" / MEMBER / "20260205_b2"
    assert path == (want / "images" / "img_0.jpg").resolve()
    rest = first["media_url"][len(archive_urls.MEDIA_PREFIX) :]
    photo_thumb.reset_cache_state()
    try:
        with (
            patch("backend.api.content.get_output_dir", return_value=gallery_archive),
            patch.object(photo_thumb, "cache_dir", return_value=tmp_path / "thumbs"),
        ):
            r = TestClient(app).get(f"/api/content/thumb/{rest}?w=160")
    finally:
        photo_thumb.reset_cache_state()
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/webp"


def test_gallery_loads_the_index_once_and_resolves_the_base_once(gallery_archive):
    from backend.services import blog_service as bs

    real = bs._read_gallery_index
    calls = []

    def counting(path):
        calls.append(path)
        return real(path)

    with (
        patch.object(bs, "_read_gallery_index", side_effect=counting),
        patch(
            "backend.services.blog_service.get_output_dir",
            return_value=gallery_archive,
        ) as out,
    ):
        _gallery(member_id=None)
    assert len(calls) == 1
    assert out.call_count == 1


def test_gallery_memo_hit_then_invalidated_by_the_index_mtime(gallery_archive):
    import os

    from backend.services import blog_service as bs

    real = bs._read_blog_json
    reads = []

    def counting(path):
        reads.append(path)
        return real(path)

    with patch.object(bs, "_read_blog_json", side_effect=counting):
        first = _gallery()
        assert len(reads) == 2
        with capture_logs() as logs:
            again = _gallery()
        assert again == first and len(reads) == 2  # memo hit: no blog.json read
        assert [e["memo"] for e in logs if e["event"] == "blog_gallery"] == ["hit"]
        index = gallery_archive / "日向坂46" / "blogs" / "index.json"
        st = index.stat()
        os.utime(index, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
        _gallery()
        assert len(reads) == 4  # the index changed: read again


def test_gallery_memo_invalidated_when_a_blog_json_appears(gallery_archive):
    _gallery()
    b3 = gallery_archive / "日向坂46" / "blogs" / MEMBER / "20260301_b3"
    _blog_json(
        b3, [{"original_url": "https://w/0.jpg", "local_path": "./images/img_0.jpg"}]
    )
    _img(b3, "img_0.jpg")
    assert [i["blog_id"] for i in _gallery()][0] == "b3"


def test_gallery_memo_is_bounded(gallery_archive):
    from backend.services import blog_service as bs

    with patch.object(bs, "GALLERY_MEMO_MAX", 1):
        _gallery(member_id="58")
        _gallery(member_id="60")
        assert list(bs._gallery_memo) == [("hinatazaka46", "60")]


def test_gallery_skips_an_unreadable_blog_json_and_logs_codes_only(gallery_archive):
    bad = gallery_archive / "日向坂46" / "blogs" / MEMBER / "20260103_b1"
    _blog_json(bad, [], raw="{not json")
    not_a_dict = gallery_archive / "日向坂46" / "blogs" / "上村 ひなの" / "20251201_c1"
    _blog_json(not_a_dict, [], raw="[1, 2]")
    with capture_logs() as logs:
        images = _gallery(member_id=None)
    assert [i["blog_id"] for i in images] == ["b2", "b2"]
    skips = [e for e in logs if e["event"] == "blog_gallery_skip"]
    assert sorted(e["error_type"] for e in skips) == ["JSONDecodeError", "ValueError"]
    assert all(e["reason"] == "unreadable" for e in skips)
    [summary] = [e for e in logs if e["event"] == "blog_gallery"]
    assert (summary["blogs"], summary["images"], summary["skipped"]) == (3, 2, 2)
    assert summary["memo"] == "off" and summary["service"] == "hinatazaka46"


def test_gallery_cjk_and_emoji_survive_in_the_response_but_never_in_logs(
    gallery_archive,
):
    with capture_logs() as logs:
        images = _gallery()
    assert images[0]["title"] == TITLE_NEW
    assert "%E9%87%91%E6%9D%91" in images[0]["media_url"]  # 金村, percent-encoded
    text = repr(logs)
    for secret in (MEMBER, "金村", TITLE_NEW, TITLE_OLD, "🌸", "img_0", "blogs/"):
        assert secret not in text


def test_gallery_without_an_index_or_with_a_broken_one(gallery_archive):
    index = gallery_archive / "日向坂46" / "blogs" / "index.json"
    index.write_text("{broken", encoding="utf-8")
    with capture_logs() as logs:
        assert _gallery() == []
    assert {
        "event": "blog_gallery_index_unreadable",
        "service": "hinatazaka46",
        "error_type": "JSONDecodeError",
        "log_level": "warning",
    } in logs
    index.write_text("[]", encoding="utf-8")
    assert _gallery() == []
    index.unlink()
    assert _gallery() == []


def test_gallery_rejects_an_unknown_service():
    from backend.services import blog_service as bs

    with pytest.raises(ValueError):
        asyncio.run(bs.gallery_images("nope", "58"))


def test_gallery_scan_runs_off_the_event_loop(gallery_archive):
    import threading

    from backend.services import blog_service as bs

    real = bs._gallery_scan
    seen = {}

    def scan(*args):
        seen["thread"] = threading.get_ident()
        return real(*args)

    async def run():
        seen["loop"] = threading.get_ident()
        return await bs.gallery_images("hinatazaka46", "58")

    with patch.object(bs, "_gallery_scan", side_effect=scan):
        assert len(asyncio.run(run())) == 3
    assert seen["thread"] != seen["loop"]


def test_blog_backup_enabled_reads_the_setting():
    from backend.services import blog_service as bs

    with patch(
        "backend.services.settings_store.load_config",
        AsyncMock(return_value={"blogs_full_backup": True}),
    ):
        assert asyncio.run(bs.blog_backup_enabled()) is True
    with patch(
        "backend.services.settings_store.load_config", AsyncMock(return_value={})
    ):
        assert asyncio.run(bs.blog_backup_enabled()) is False


def test_gallery_ignores_a_blog_json_without_an_image_list(gallery_archive):
    b1 = gallery_archive / "日向坂46" / "blogs" / MEMBER / "20260103_b1"
    _blog_json(b1, [], raw=json.dumps({"images": "none"}))
    assert [i["blog_id"] for i in _gallery()] == ["b2", "b2"]


def test_gallery_sorts_by_parsed_time_across_mixed_offsets(gallery_archive):
    """2026-02-05T01:00+09:00 (= 02-04 16:00 UTC) is older than 2026-02-04T20:00Z."""
    import json as _json

    index_path = gallery_archive / "日向坂46" / "blogs" / "index.json"
    index = _json.loads(index_path.read_text(encoding="utf-8"))
    index["members"]["58"]["blogs"] = [
        {"id": "jst", "title": "a", "published_at": "2026-02-05T01:00:00+09:00"},
        {"id": "utc", "title": "b", "published_at": "2026-02-04T20:00:00Z"},
    ]
    index_path.write_text(_json.dumps(index, ensure_ascii=False), encoding="utf-8")
    for folder in ("20260205_jst", "20260204_utc"):
        f = gallery_archive / "日向坂46" / "blogs" / MEMBER / folder
        _blog_json(
            f, [{"original_url": "https://q/0.jpg", "local_path": "./images/img_0.jpg"}]
        )
        _img(f, "img_0.jpg")
    # As strings "2026-02-05T01…" > "2026-02-04T20…"; as instants utc is newer.
    assert [i["blog_id"] for i in _gallery()] == ["utc", "jst"]


def test_gallery_memo_hit_reports_the_skips_of_the_scan_it_reuses(gallery_archive):
    bad = gallery_archive / "日向坂46" / "blogs" / MEMBER / "20260103_b1"
    _blog_json(bad, [], raw="{not json")
    _gallery()
    with capture_logs() as logs:
        _gallery()
    [summary] = [e for e in logs if e["event"] == "blog_gallery"]
    assert (summary["memo"], summary["skipped"]) == ("hit", 1)


def test_gallery_whole_service_listing_is_not_memoised(gallery_archive):
    from backend.services import blog_service as bs

    _gallery(member_id=None)
    assert ("hinatazaka46", None) not in bs._gallery_memo


def test_gallery_version_bump_invalidates_the_memo(gallery_archive):
    from backend.services import blog_service as bs

    real = bs._read_blog_json
    reads = []
    with patch.object(
        bs, "_read_blog_json", side_effect=lambda p: reads.append(p) or real(p)
    ):
        _gallery()
        _gallery()
        assert len(reads) == 2  # hit
        bs.invalidate_gallery()
        _gallery()
        assert len(reads) == 4  # a blog was written: read again


def test_every_blog_write_bumps_the_gallery_version(tmp_path):
    """Backup and on-demand fetch both end in _download_single_blog (no index save needed)."""
    from types import SimpleNamespace

    from backend.services import blog_service as bs

    class Scraper:
        async def get_blog_detail(self, blog_id, member_id=None):
            return SimpleNamespace(images=[], content="<p>x</p>")

    item = bs.BlogDownloadItem(
        "b1", "58", MEMBER, TITLE_NEW, "2026-02-05T10:00:00+09:00", "u", tmp_path / "b"
    )
    before = bs.gallery_version()
    asyncio.run(
        BlogService()._download_single_blog(
            None, Scraper(), item, download_images=False
        )
    )
    assert (tmp_path / "b" / "blog.json").is_file()
    assert bs.gallery_version() == before + 1


def test_gallery_counts_with_one_listing_per_member_and_ignores_empty_blog_json(
    gallery_archive,
):
    import os as _os

    from backend.services import blog_service as bs

    real = _os.scandir
    listed = []

    def counting(path):
        listed.append(path)
        return real(path)

    with patch.object(bs.os, "scandir", side_effect=counting):
        _gallery(member_id=None)
    # One listing per well-formed member (58, 60, 62, 66), none per blog entry.
    assert len(listed) == 4
    # An interrupted download (empty blog.json) is not cached; completing it changes the count.
    b3 = gallery_archive / "日向坂46" / "blogs" / MEMBER / "20260301_b3"
    _blog_json(b3, [], raw="")
    _img(b3, "img_0.jpg")
    assert "b3" not in [i["blog_id"] for i in _gallery()]
    _blog_json(
        b3, [{"original_url": "https://w/0.jpg", "local_path": "./images/img_0.jpg"}]
    )
    assert [i["blog_id"] for i in _gallery()][0] == "b3"


def test_gallery_index_reads_a_given_output_dir(gallery_archive):
    """The worker passes its own output dir, so no settings read happens on its thread."""
    from backend.services import blog_service as bs

    with patch(
        "backend.services.blog_service.get_output_dir", side_effect=AssertionError
    ):
        index = bs.gallery_index("hinatazaka46", "58", gallery_archive)
    assert index is not None and index.base == gallery_archive / "日向坂46" / "blogs"
    assert [m.folder for m in index.members] == [MEMBER]


def test_gallery_orders_naive_as_utc_and_unparsable_last_and_skips_a_folder_without_json(
    gallery_archive,
):
    import json as _json

    index_path = gallery_archive / "日向坂46" / "blogs" / "index.json"
    index = _json.loads(index_path.read_text(encoding="utf-8"))
    index["members"]["58"]["blogs"] = [
        {"id": "bad", "title": "a", "published_at": "someday"},
        {"id": "naive", "title": "b", "published_at": "2026-03-01T00:00:00"},
        {"id": "aware", "title": "c", "published_at": "2026-02-28T23:00:00-02:00"},
        {"id": "nojson", "title": "d", "published_at": "2026-04-01T00:00:00Z"},
    ]
    index_path.write_text(_json.dumps(index, ensure_ascii=False), encoding="utf-8")
    for folder in ("someday_bad", "20260301_naive", "20260228_aware"):
        f = gallery_archive / "日向坂46" / "blogs" / MEMBER / folder
        _blog_json(
            f, [{"original_url": "https://q/0.jpg", "local_path": "./images/img_0.jpg"}]
        )
        _img(f, "img_0.jpg")
    _img(
        gallery_archive / "日向坂46" / "blogs" / MEMBER / "20260401_nojson", "img_0.jpg"
    )
    # aware = 03-01 01:00 UTC > naive (03-01 00:00, read as UTC) > unparsable.
    assert [i["blog_id"] for i in _gallery()] == ["aware", "naive", "bad"]
