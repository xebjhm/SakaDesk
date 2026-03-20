"""Comprehensive tests for BlogService core business logic.

Covers: content processing, image download, path resolution, index operations,
member name sanitization, removed-blog tracking, and service validation.
"""

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.services.blog_service import (
    BLOG_SUPPORTED_GROUPS,
    BlogDownloadItem,
    BlogService,
    _build_blog_content,
    _is_blog_supported,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def svc():
    return BlogService()


# ---------------------------------------------------------------------------
# _is_blog_supported
# ---------------------------------------------------------------------------


class TestIsBlogSupported:
    """Validate _is_blog_supported against every known service."""

    def test_hinatazaka_supported(self):
        assert _is_blog_supported("hinatazaka46") is True

    def test_sakurazaka_supported(self):
        assert _is_blog_supported("sakurazaka46") is True

    def test_nogizaka_supported(self):
        assert _is_blog_supported("nogizaka46") is True

    def test_yodel_not_supported(self):
        assert _is_blog_supported("yodel") is False

    def test_unknown_service_not_supported(self):
        assert _is_blog_supported("unknown_group") is False

    def test_empty_string_not_supported(self):
        assert _is_blog_supported("") is False

    def test_supported_groups_frozenset(self):
        assert isinstance(BLOG_SUPPORTED_GROUPS, frozenset)


# ---------------------------------------------------------------------------
# _build_blog_content
# ---------------------------------------------------------------------------


class TestBuildBlogContent:
    """Verify the helper that assembles the canonical blog content dict."""

    def test_basic_structure(self):
        result = _build_blog_content(
            blog_id="b123",
            member_name="Test",
            title="Hello",
            published_at="2025-01-01T00:00:00Z",
            url="https://example.com/b123",
            html="<p>body</p>",
            images=[{"original_url": "https://img/1.jpg", "local_path": None}],
        )
        assert result["meta"]["id"] == "b123"
        assert result["meta"]["member_name"] == "Test"
        assert result["meta"]["title"] == "Hello"
        assert result["meta"]["published_at"] == "2025-01-01T00:00:00Z"
        assert result["meta"]["url"] == "https://example.com/b123"
        assert result["content"]["html"] == "<p>body</p>"
        assert len(result["images"]) == 1

    def test_empty_images(self):
        result = _build_blog_content(
            blog_id="b0",
            member_name="A",
            title="T",
            published_at="2025-01-01",
            url="http://u",
            html="",
            images=[],
        )
        assert result["images"] == []

    def test_cjk_content(self):
        result = _build_blog_content(
            blog_id="c1",
            member_name="金村 美玖",
            title="今日のブログ",
            published_at="2025-03-20T09:00:00+09:00",
            url="https://example.com/c1",
            html="<p>こんにちは</p>",
            images=[],
        )
        assert result["meta"]["member_name"] == "金村 美玖"
        assert result["meta"]["title"] == "今日のブログ"
        assert result["content"]["html"] == "<p>こんにちは</p>"


# ---------------------------------------------------------------------------
# Path helpers (get_blog_cache_path, get_blog_index_path, etc.)
# ---------------------------------------------------------------------------


class TestPathHelpers:
    """Cache and index path construction with edge-case inputs."""

    def test_cache_path_basic(self, svc):
        path = svc.get_blog_cache_path("hinatazaka46", "金村 美玖", "12345", "20240101")
        assert path.name == "20240101_12345"
        assert "金村 美玖" in str(path)
        assert "blogs" in str(path)

    def test_cache_path_strips_trailing_whitespace(self, svc):
        """Trailing spaces are unsafe on Windows file systems."""
        path = svc.get_blog_cache_path("hinatazaka46", "Name  ", "1", "20240101")
        # The member folder should have trailing whitespace stripped
        member_part = path.parent.name
        assert member_part == "Name"

    def test_cache_path_replaces_slash(self, svc):
        """Forward slashes in names must be replaced for valid paths."""
        path = svc.get_blog_cache_path("hinatazaka46", "A/B", "1", "20240101")
        member_part = path.parent.name
        assert "/" not in member_part
        assert member_part == "A_B"

    def test_cache_path_cjk_characters(self, svc):
        """CJK names must survive path construction."""
        path = svc.get_blog_cache_path("sakurazaka46", "田村 保乃", "999", "20250320")
        assert "田村 保乃" in str(path)
        assert path.name == "20250320_999"

    def test_cache_path_windows_unsafe_chars(self, svc):
        """Names with slash + trailing spaces get sanitized."""
        path = svc.get_blog_cache_path("nogizaka46", " Foo/Bar ", "7", "20250101")
        member_part = path.parent.name
        # strip + slash->underscore
        assert member_part == "Foo_Bar"

    def test_index_path(self, svc):
        path = svc.get_blog_index_path("hinatazaka46")
        assert path.name == "index.json"
        assert "blogs" in str(path)

    def test_blogs_base_path_per_service(self, svc):
        hinata = svc.get_blogs_base_path("hinatazaka46")
        sakura = svc.get_blogs_base_path("sakurazaka46")
        assert "日向坂46" in str(hinata)
        assert "櫻坂46" in str(sakura)
        assert hinata != sakura

    def test_member_thumbnails_path(self, svc):
        path = svc.get_member_thumbnails_path("hinatazaka46")
        assert path.name == "member_thumbnails"
        assert "blogs" in str(path)

    def test_members_cache_path(self, svc):
        path = svc.get_members_cache_path("hinatazaka46")
        assert path.name == "members_cache.json"

    def test_invalid_service_raises(self, svc):
        with pytest.raises(ValueError, match="Unknown service"):
            svc.get_blogs_base_path("invalid_service")


# ---------------------------------------------------------------------------
# Blog index load / save (real temp files, JSON round-trip)
# ---------------------------------------------------------------------------


class TestBlogIndexOperations:
    """Index persistence with atomic writes, corrupt handling, and unicode."""

    @pytest.mark.asyncio
    async def test_load_missing_returns_default(self, svc, tmp_path):
        with patch.object(
            svc,
            "get_blog_index_path",
            return_value=tmp_path / "nonexistent" / "index.json",
        ):
            result = await svc.load_blog_index("hinatazaka46")
        assert result == {"members": {}, "last_sync": None, "last_download": None}

    @pytest.mark.asyncio
    async def test_save_and_load_roundtrip(self, svc, tmp_path):
        index_path = tmp_path / "index.json"
        data = {
            "members": {"m1": {"name": "Test", "blogs": []}},
            "last_sync": "2025-01-01T00:00:00Z",
            "last_download": None,
        }
        with patch.object(svc, "get_blog_index_path", return_value=index_path):
            await svc.save_blog_index("hinatazaka46", data)
            loaded = await svc.load_blog_index("hinatazaka46")
        assert loaded == data

    @pytest.mark.asyncio
    async def test_save_creates_parent_dirs(self, svc, tmp_path):
        deep_path = tmp_path / "deep" / "nested" / "index.json"
        with patch.object(svc, "get_blog_index_path", return_value=deep_path):
            await svc.save_blog_index("hinatazaka46", {"members": {}})
        assert deep_path.exists()

    @pytest.mark.asyncio
    async def test_save_atomic_no_partial_on_error(self, svc, tmp_path):
        """If writing fails, the original file must remain intact."""
        index_path = tmp_path / "index.json"
        original = {"members": {"old": {"name": "Original"}}}

        with patch.object(svc, "get_blog_index_path", return_value=index_path):
            await svc.save_blog_index("hinatazaka46", original)

        # Corrupt the write by making the data non-serializable
        bad_data = {"members": object()}
        with patch.object(svc, "get_blog_index_path", return_value=index_path):
            with pytest.raises(TypeError):
                await svc.save_blog_index("hinatazaka46", bad_data)

        # Original file should still be valid
        raw = index_path.read_text(encoding="utf-8")
        assert json.loads(raw) == original

    @pytest.mark.asyncio
    async def test_load_corrupt_json_returns_default(self, svc, tmp_path):
        index_path = tmp_path / "index.json"
        index_path.write_text("{invalid json!!!}", encoding="utf-8")
        with patch.object(svc, "get_blog_index_path", return_value=index_path):
            result = await svc.load_blog_index("hinatazaka46")
        assert result == {"members": {}, "last_sync": None, "last_download": None}

    @pytest.mark.asyncio
    async def test_roundtrip_cjk_content(self, svc, tmp_path):
        index_path = tmp_path / "index.json"
        data = {
            "members": {
                "m1": {
                    "name": "齊藤 京子",
                    "blogs": [
                        {
                            "id": "b1",
                            "title": "今日は楽しかった",
                            "published_at": "2025-03-20T09:00:00+09:00",
                            "url": "https://example.com/b1",
                            "thumbnail": None,
                        }
                    ],
                }
            },
            "last_sync": "2025-03-20T00:00:00Z",
            "last_download": None,
        }
        with patch.object(svc, "get_blog_index_path", return_value=index_path):
            await svc.save_blog_index("hinatazaka46", data)
            loaded = await svc.load_blog_index("hinatazaka46")
        assert loaded["members"]["m1"]["name"] == "齊藤 京子"
        assert loaded["members"]["m1"]["blogs"][0]["title"] == "今日は楽しかった"

    @pytest.mark.asyncio
    async def test_save_uses_utf8_encoding(self, svc, tmp_path):
        """Verify ensure_ascii=False so CJK is stored literally (not escaped)."""
        index_path = tmp_path / "index.json"
        data = {"members": {"m1": {"name": "上村 ひなの"}}}
        with patch.object(svc, "get_blog_index_path", return_value=index_path):
            await svc.save_blog_index("hinatazaka46", data)
        raw = index_path.read_bytes().decode("utf-8")
        # Must contain the actual CJK characters, not \u escapes
        assert "上村 ひなの" in raw


# ---------------------------------------------------------------------------
# _mark_blog_removed / _promote_fully_removed_members
# ---------------------------------------------------------------------------


class TestRemovedBlogTracking:
    """Verify removed-blog marking and member-level promotion logic."""

    def test_mark_blog_removed_sets_flag(self, svc):
        index = {
            "members": {
                "m1": {
                    "name": "A",
                    "blogs": [
                        {"id": "b1", "title": "T1"},
                        {"id": "b2", "title": "T2"},
                    ],
                }
            }
        }
        svc._mark_blog_removed(index, "m1", "b1")
        assert index["members"]["m1"]["blogs"][0]["removed"] is True
        assert "removed" not in index["members"]["m1"]["blogs"][1]

    def test_mark_nonexistent_blog_is_noop(self, svc):
        index = {"members": {"m1": {"name": "A", "blogs": [{"id": "b1"}]}}}
        svc._mark_blog_removed(index, "m1", "b999")
        assert "removed" not in index["members"]["m1"]["blogs"][0]

    def test_mark_nonexistent_member_is_noop(self, svc):
        index = {"members": {}}
        svc._mark_blog_removed(index, "no_member", "b1")
        # Should not raise

    def test_promote_fully_removed_members(self, svc):
        index = {
            "members": {
                "m1": {
                    "name": "Full Removed",
                    "blogs": [
                        {"id": "b1", "removed": True},
                        {"id": "b2", "removed": True},
                    ],
                },
                "m2": {
                    "name": "Partial",
                    "blogs": [
                        {"id": "b3", "removed": True},
                        {"id": "b4"},
                    ],
                },
            }
        }
        svc._promote_fully_removed_members(index)
        assert index["members"]["m1"].get("blogs_removed") is True
        assert index["members"]["m2"].get("blogs_removed") is None

    def test_promote_skips_already_promoted(self, svc):
        index = {
            "members": {
                "m1": {
                    "name": "Already",
                    "blogs_removed": True,
                    "blogs": [{"id": "b1", "removed": True}],
                }
            }
        }
        svc._promote_fully_removed_members(index)
        assert index["members"]["m1"]["blogs_removed"] is True

    def test_promote_empty_blogs_not_promoted(self, svc):
        """A member with no blogs at all should NOT be promoted."""
        index = {"members": {"m1": {"name": "Empty", "blogs": []}}}
        svc._promote_fully_removed_members(index)
        assert index["members"]["m1"].get("blogs_removed") is None


# ---------------------------------------------------------------------------
# build_download_queue
# ---------------------------------------------------------------------------


class TestBuildDownloadQueue:
    """Verify queue construction from index, with skip/removed logic."""

    def test_basic_queue_build(self, svc, tmp_path):
        index = {
            "members": {
                "m1": {
                    "name": "Test Member",
                    "blogs": [
                        {
                            "id": "b1",
                            "title": "Blog 1",
                            "published_at": "2025-01-15T10:00:00Z",
                            "url": "https://example.com/b1",
                        }
                    ],
                }
            }
        }
        with patch.object(svc, "get_blog_cache_path", return_value=tmp_path / "no"):
            queue = svc.build_download_queue("hinatazaka46", index, skip_cached=True)
        assert len(queue) == 1
        assert isinstance(queue[0], BlogDownloadItem)
        assert queue[0].blog_id == "b1"
        assert queue[0].member_name == "Test Member"

    def test_skips_cached_when_flag_set(self, svc, tmp_path):
        cache_dir = tmp_path / "cached"
        cache_dir.mkdir(parents=True)
        (cache_dir / "blog.json").write_text("{}", encoding="utf-8")

        index = {
            "members": {
                "m1": {
                    "name": "Test",
                    "blogs": [
                        {
                            "id": "b1",
                            "title": "T",
                            "published_at": "2025-01-01T00:00:00Z",
                            "url": "http://u",
                        }
                    ],
                }
            }
        }
        with patch.object(svc, "get_blog_cache_path", return_value=cache_dir):
            queue = svc.build_download_queue("hinatazaka46", index, skip_cached=True)
        assert len(queue) == 0

    def test_includes_cached_when_flag_off(self, svc, tmp_path):
        cache_dir = tmp_path / "cached"
        cache_dir.mkdir(parents=True)
        (cache_dir / "blog.json").write_text("{}", encoding="utf-8")

        index = {
            "members": {
                "m1": {
                    "name": "Test",
                    "blogs": [
                        {
                            "id": "b1",
                            "title": "T",
                            "published_at": "2025-01-01T00:00:00Z",
                            "url": "http://u",
                        }
                    ],
                }
            }
        }
        with patch.object(svc, "get_blog_cache_path", return_value=cache_dir):
            queue = svc.build_download_queue("hinatazaka46", index, skip_cached=False)
        assert len(queue) == 1

    def test_skips_removed_blogs(self, svc, tmp_path):
        index = {
            "members": {
                "m1": {
                    "name": "Test",
                    "blogs": [
                        {
                            "id": "b1",
                            "title": "T",
                            "published_at": "2025-01-01T00:00:00Z",
                            "url": "http://u",
                            "removed": True,
                        }
                    ],
                }
            }
        }
        with patch.object(svc, "get_blog_cache_path", return_value=tmp_path / "no"):
            queue = svc.build_download_queue("hinatazaka46", index, skip_cached=False)
        assert len(queue) == 0

    def test_skips_fully_removed_member(self, svc, tmp_path):
        index = {
            "members": {
                "m1": {
                    "name": "Graduated",
                    "blogs_removed": True,
                    "blogs": [
                        {
                            "id": "b1",
                            "title": "T",
                            "published_at": "2025-01-01T00:00:00Z",
                            "url": "http://u",
                        }
                    ],
                }
            }
        }
        with patch.object(svc, "get_blog_cache_path", return_value=tmp_path / "no"):
            queue = svc.build_download_queue("hinatazaka46", index, skip_cached=False)
        assert len(queue) == 0

    def test_empty_index_returns_empty_queue(self, svc):
        queue = svc.build_download_queue("hinatazaka46", {"members": {}})
        assert queue == []


# ---------------------------------------------------------------------------
# _download_images (image download logic)
# ---------------------------------------------------------------------------


class TestDownloadImages:
    """Mock HTTP to test image download success, failure, non-200, semaphore."""

    @pytest.mark.asyncio
    async def test_successful_download(self, svc, tmp_path):
        images_dir = tmp_path / "images"
        image_urls = ["https://example.com/img_0.jpg"]

        mock_resp = AsyncMock()
        mock_resp.status = 200
        mock_resp.read = AsyncMock(return_value=b"\xff\xd8\xff\xe0fake-jpeg")
        mock_resp.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_resp.__aexit__ = AsyncMock(return_value=False)

        mock_session = MagicMock()
        mock_session.get = MagicMock(return_value=mock_resp)

        results = await svc._download_images(mock_session, image_urls, images_dir)
        assert len(results) == 1
        assert results[0]["original_url"] == "https://example.com/img_0.jpg"
        assert results[0]["local_path"] == "./images/img_0.jpg"
        assert (images_dir / "img_0.jpg").exists()

    @pytest.mark.asyncio
    async def test_non_200_status(self, svc, tmp_path):
        images_dir = tmp_path / "images"
        image_urls = ["https://example.com/missing.jpg"]

        mock_resp = AsyncMock()
        mock_resp.status = 404
        mock_resp.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_resp.__aexit__ = AsyncMock(return_value=False)

        mock_session = MagicMock()
        mock_session.get = MagicMock(return_value=mock_resp)

        results = await svc._download_images(mock_session, image_urls, images_dir)
        assert len(results) == 1
        # Non-200 results in None for the slot (the results array keeps order)
        assert results[0] is None

    @pytest.mark.asyncio
    async def test_network_error_returns_fallback(self, svc, tmp_path):
        images_dir = tmp_path / "images"
        image_urls = ["https://example.com/timeout.jpg"]

        mock_resp = MagicMock()
        mock_resp.__aenter__ = AsyncMock(side_effect=ConnectionError("timeout"))
        mock_resp.__aexit__ = AsyncMock(return_value=False)

        mock_session = MagicMock()
        mock_session.get = MagicMock(return_value=mock_resp)

        results = await svc._download_images(mock_session, image_urls, images_dir)
        assert len(results) == 1
        assert results[0]["original_url"] == "https://example.com/timeout.jpg"
        assert results[0]["local_path"] is None

    @pytest.mark.asyncio
    async def test_semaphore_bounds_concurrency(self, svc, tmp_path):
        """Verify semaphore limits concurrent image fetches."""
        images_dir = tmp_path / "images"
        image_urls = [f"https://example.com/img_{i}.jpg" for i in range(5)]
        semaphore = asyncio.Semaphore(2)
        max_concurrent = 0
        current_concurrent = 0
        lock = asyncio.Lock()

        original_get = MagicMock()

        async def tracked_fetch(*args, **kwargs):
            nonlocal max_concurrent, current_concurrent
            async with lock:
                current_concurrent += 1
                max_concurrent = max(max_concurrent, current_concurrent)

            await asyncio.sleep(0.01)  # Simulate I/O

            async with lock:
                current_concurrent -= 1

            resp = AsyncMock()
            resp.status = 200
            resp.read = AsyncMock(return_value=b"fake-image-data")
            return resp

        mock_session = MagicMock()
        ctx = AsyncMock()
        ctx.__aenter__ = tracked_fetch
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_session.get = MagicMock(return_value=ctx)

        results = await svc._download_images(
            mock_session, image_urls, images_dir, semaphore=semaphore
        )
        assert len(results) == 5
        # With a semaphore of 2, max concurrent should not exceed 2
        assert max_concurrent <= 2

    @pytest.mark.asyncio
    async def test_multiple_images_mixed_results(self, svc, tmp_path):
        images_dir = tmp_path / "images"
        image_urls = [
            "https://example.com/ok.jpg",
            "https://example.com/fail.png",
        ]

        call_count = 0

        def make_response():
            nonlocal call_count
            call_count += 1
            resp = AsyncMock()
            if call_count == 1:
                resp.status = 200
                resp.read = AsyncMock(return_value=b"image-bytes")
            else:
                resp.status = 500
            resp.__aenter__ = AsyncMock(return_value=resp)
            resp.__aexit__ = AsyncMock(return_value=False)
            return resp

        mock_session = MagicMock()
        mock_session.get = MagicMock(side_effect=lambda *a, **kw: make_response())

        results = await svc._download_images(mock_session, image_urls, images_dir)
        assert len(results) == 2
        # First succeeded
        assert results[0]["local_path"] is not None
        # Second failed (500)
        assert results[1] is None

    @pytest.mark.asyncio
    async def test_url_query_params_stripped_from_extension(self, svc, tmp_path):
        """Image URLs with query strings should have clean file extensions."""
        images_dir = tmp_path / "images"
        image_urls = ["https://cdn.example.com/photo.png?token=abc123&w=800"]

        mock_resp = AsyncMock()
        mock_resp.status = 200
        mock_resp.read = AsyncMock(return_value=b"png-data")
        mock_resp.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_resp.__aexit__ = AsyncMock(return_value=False)

        mock_session = MagicMock()
        mock_session.get = MagicMock(return_value=mock_resp)

        results = await svc._download_images(mock_session, image_urls, images_dir)
        assert results[0]["local_path"] == "./images/img_0.png"


# ---------------------------------------------------------------------------
# _rewrite_local_images
# ---------------------------------------------------------------------------


class TestRewriteLocalImages:
    """Verify HTML image URL rewriting for cached blogs."""

    def test_rewrites_existing_local_image(self, svc, tmp_path):
        # Create the cached image file
        images_dir = tmp_path / "images"
        images_dir.mkdir()
        (images_dir / "img_0.jpg").write_bytes(b"fake")

        content = {
            "content": {
                "html": '<img src="https://ext.com/photo.jpg">',
            },
            "images": [
                {
                    "original_url": "https://ext.com/photo.jpg",
                    "local_path": "./images/img_0.jpg",
                }
            ],
        }

        result = svc._rewrite_local_images(content, tmp_path, "hinatazaka46", "b123")
        assert "/api/blogs/image" in result["content"]["html"]
        assert "https://ext.com/photo.jpg" not in result["content"]["html"]
        assert result["images"][0].get("local_url") is not None

    def test_no_rewrite_when_local_file_missing(self, svc, tmp_path):
        content = {
            "content": {
                "html": '<img src="https://ext.com/photo.jpg">',
            },
            "images": [
                {
                    "original_url": "https://ext.com/photo.jpg",
                    "local_path": "./images/img_0.jpg",
                }
            ],
        }

        result = svc._rewrite_local_images(content, tmp_path, "hinatazaka46", "b123")
        # Original URL stays because local file doesn't exist
        assert "https://ext.com/photo.jpg" in result["content"]["html"]

    def test_no_rewrite_when_no_local_path(self, svc, tmp_path):
        content = {
            "content": {"html": '<img src="https://ext.com/photo.jpg">'},
            "images": [
                {"original_url": "https://ext.com/photo.jpg", "local_path": None}
            ],
        }

        result = svc._rewrite_local_images(content, tmp_path, "hinatazaka46", "b123")
        assert "https://ext.com/photo.jpg" in result["content"]["html"]

    def test_rewrite_multiple_images(self, svc, tmp_path):
        images_dir = tmp_path / "images"
        images_dir.mkdir()
        (images_dir / "img_0.jpg").write_bytes(b"a")
        (images_dir / "img_1.png").write_bytes(b"b")

        content = {
            "content": {
                "html": (
                    '<img src="https://a.com/1.jpg">'
                    '<img src="https://b.com/2.png">'
                ),
            },
            "images": [
                {
                    "original_url": "https://a.com/1.jpg",
                    "local_path": "./images/img_0.jpg",
                },
                {
                    "original_url": "https://b.com/2.png",
                    "local_path": "./images/img_1.png",
                },
            ],
        }

        result = svc._rewrite_local_images(content, tmp_path, "hinatazaka46", "b1")
        assert "https://a.com/1.jpg" not in result["content"]["html"]
        assert "https://b.com/2.png" not in result["content"]["html"]
        assert result["content"]["html"].count("/api/blogs/image") == 2


# ---------------------------------------------------------------------------
# get_recent_posts
# ---------------------------------------------------------------------------


class TestGetRecentPosts:
    """Test query operations against the blog index."""

    @pytest.mark.asyncio
    async def test_returns_sorted_by_date_descending(self, svc, tmp_path):
        index = {
            "members": {
                "m1": {
                    "name": "Test",
                    "blogs": [
                        {
                            "id": "b1",
                            "title": "Old",
                            "published_at": "2025-01-01",
                            "url": "http://u1",
                        },
                        {
                            "id": "b2",
                            "title": "New",
                            "published_at": "2025-03-01",
                            "url": "http://u2",
                        },
                    ],
                }
            },
            "last_sync": None,
            "last_download": None,
        }
        with patch.object(svc, "load_blog_index", new_callable=AsyncMock, return_value=index):
            posts = await svc.get_recent_posts("hinatazaka46", limit=10)
        assert posts[0]["id"] == "b2"
        assert posts[1]["id"] == "b1"

    @pytest.mark.asyncio
    async def test_respects_limit(self, svc):
        blogs = [
            {
                "id": f"b{i}",
                "title": f"T{i}",
                "published_at": f"2025-01-{i+1:02d}",
                "url": f"http://u{i}",
            }
            for i in range(30)
        ]
        index = {
            "members": {"m1": {"name": "Test", "blogs": blogs}},
            "last_sync": None,
            "last_download": None,
        }
        with patch.object(svc, "load_blog_index", new_callable=AsyncMock, return_value=index):
            posts = await svc.get_recent_posts("hinatazaka46", limit=5)
        assert len(posts) == 5

    @pytest.mark.asyncio
    async def test_filters_by_member_ids(self, svc):
        index = {
            "members": {
                "m1": {
                    "name": "Keep",
                    "blogs": [
                        {
                            "id": "b1",
                            "title": "T1",
                            "published_at": "2025-01-01",
                            "url": "http://u1",
                        }
                    ],
                },
                "m2": {
                    "name": "Skip",
                    "blogs": [
                        {
                            "id": "b2",
                            "title": "T2",
                            "published_at": "2025-01-02",
                            "url": "http://u2",
                        }
                    ],
                },
            },
            "last_sync": None,
            "last_download": None,
        }
        with patch.object(svc, "load_blog_index", new_callable=AsyncMock, return_value=index):
            posts = await svc.get_recent_posts("hinatazaka46", member_ids=["m1"])
        assert len(posts) == 1
        assert posts[0]["member_name"] == "Keep"

    @pytest.mark.asyncio
    async def test_skips_removed_blogs(self, svc):
        index = {
            "members": {
                "m1": {
                    "name": "Test",
                    "blogs": [
                        {
                            "id": "b1",
                            "title": "T1",
                            "published_at": "2025-01-01",
                            "url": "http://u1",
                            "removed": True,
                        },
                        {
                            "id": "b2",
                            "title": "T2",
                            "published_at": "2025-01-02",
                            "url": "http://u2",
                        },
                    ],
                }
            },
            "last_sync": None,
            "last_download": None,
        }
        with patch.object(svc, "load_blog_index", new_callable=AsyncMock, return_value=index):
            posts = await svc.get_recent_posts("hinatazaka46")
        assert len(posts) == 1
        assert posts[0]["id"] == "b2"

    @pytest.mark.asyncio
    async def test_skips_fully_removed_member(self, svc):
        index = {
            "members": {
                "m1": {
                    "name": "Graduated",
                    "blogs_removed": True,
                    "blogs": [
                        {
                            "id": "b1",
                            "title": "T1",
                            "published_at": "2025-01-01",
                            "url": "http://u1",
                        }
                    ],
                }
            },
            "last_sync": None,
            "last_download": None,
        }
        with patch.object(svc, "load_blog_index", new_callable=AsyncMock, return_value=index):
            posts = await svc.get_recent_posts("hinatazaka46")
        assert len(posts) == 0

    @pytest.mark.asyncio
    async def test_deduplicates_by_blog_id(self, svc):
        """Same blog appearing under multiple members should be deduped."""
        index = {
            "members": {
                "m1": {
                    "name": "A",
                    "blogs": [
                        {
                            "id": "b1",
                            "title": "T",
                            "published_at": "2025-01-01",
                            "url": "http://u",
                        }
                    ],
                },
                "m2": {
                    "name": "B",
                    "blogs": [
                        {
                            "id": "b1",
                            "title": "T",
                            "published_at": "2025-01-01",
                            "url": "http://u",
                        }
                    ],
                },
            },
            "last_sync": None,
            "last_download": None,
        }
        with patch.object(svc, "load_blog_index", new_callable=AsyncMock, return_value=index):
            posts = await svc.get_recent_posts("hinatazaka46")
        assert len(posts) == 1


# ---------------------------------------------------------------------------
# _compute_members_hash
# ---------------------------------------------------------------------------


class TestComputeMembersHash:
    """Verify content hashing for change detection."""

    def test_deterministic(self, svc):
        members = [
            {"id": "1", "name": "A", "thumbnail_url": "http://a"},
            {"id": "2", "name": "B", "thumbnail_url": "http://b"},
        ]
        h1 = svc._compute_members_hash(members)
        h2 = svc._compute_members_hash(members)
        assert h1 == h2

    def test_order_independent(self, svc):
        """Hashing sorts by ID, so order should not matter."""
        members_a = [
            {"id": "1", "name": "A", "thumbnail_url": "http://a"},
            {"id": "2", "name": "B", "thumbnail_url": "http://b"},
        ]
        members_b = [
            {"id": "2", "name": "B", "thumbnail_url": "http://b"},
            {"id": "1", "name": "A", "thumbnail_url": "http://a"},
        ]
        assert svc._compute_members_hash(members_a) == svc._compute_members_hash(
            members_b
        )

    def test_different_content_different_hash(self, svc):
        m1 = [{"id": "1", "name": "A", "thumbnail_url": "http://a"}]
        m2 = [{"id": "1", "name": "A", "thumbnail_url": "http://different"}]
        assert svc._compute_members_hash(m1) != svc._compute_members_hash(m2)

    def test_returns_16_char_hex(self, svc):
        members = [{"id": "1", "name": "A", "thumbnail_url": "http://a"}]
        h = svc._compute_members_hash(members)
        assert len(h) == 16
        assert all(c in "0123456789abcdef" for c in h)


# ---------------------------------------------------------------------------
# get_member_thumbnail_path
# ---------------------------------------------------------------------------


class TestGetMemberThumbnailPath:
    """Test thumbnail path lookup with various extensions."""

    def test_finds_jpg(self, svc, tmp_path):
        with patch.object(svc, "get_member_thumbnails_path", return_value=tmp_path):
            (tmp_path / "m1.jpg").write_bytes(b"jpg")
            result = svc.get_member_thumbnail_path("hinatazaka46", "m1")
        assert result is not None
        assert result.suffix == ".jpg"

    def test_finds_png(self, svc, tmp_path):
        with patch.object(svc, "get_member_thumbnails_path", return_value=tmp_path):
            (tmp_path / "m1.png").write_bytes(b"png")
            result = svc.get_member_thumbnail_path("hinatazaka46", "m1")
        assert result is not None
        assert result.suffix == ".png"

    def test_finds_webp(self, svc, tmp_path):
        with patch.object(svc, "get_member_thumbnails_path", return_value=tmp_path):
            (tmp_path / "m1.webp").write_bytes(b"webp")
            result = svc.get_member_thumbnail_path("hinatazaka46", "m1")
        assert result is not None
        assert result.suffix == ".webp"

    def test_returns_none_when_not_found(self, svc, tmp_path):
        with patch.object(svc, "get_member_thumbnails_path", return_value=tmp_path):
            result = svc.get_member_thumbnail_path("hinatazaka46", "m1")
        assert result is None

    def test_returns_none_when_dir_missing(self, svc, tmp_path):
        nonexistent = tmp_path / "nonexistent"
        with patch.object(svc, "get_member_thumbnails_path", return_value=nonexistent):
            result = svc.get_member_thumbnail_path("hinatazaka46", "m1")
        assert result is None


# ---------------------------------------------------------------------------
# Members cache load/save
# ---------------------------------------------------------------------------


class TestMembersCache:
    """Test _load_members_cache and _save_members_cache with real files."""

    @pytest.mark.asyncio
    async def test_load_returns_none_when_missing(self, svc, tmp_path):
        with patch.object(
            svc, "get_members_cache_path", return_value=tmp_path / "no.json"
        ):
            result = await svc._load_members_cache("hinatazaka46")
        assert result is None

    @pytest.mark.asyncio
    async def test_save_and_load_roundtrip(self, svc, tmp_path):
        cache_path = tmp_path / "members_cache.json"
        cache = {
            "hash": "abc123",
            "members": [
                {"id": "1", "name": "金村 美玖", "thumbnail": "1.jpg"},
            ],
        }
        with patch.object(svc, "get_members_cache_path", return_value=cache_path):
            await svc._save_members_cache("hinatazaka46", cache)
            loaded = await svc._load_members_cache("hinatazaka46")
        assert loaded == cache

    @pytest.mark.asyncio
    async def test_load_corrupt_returns_none(self, svc, tmp_path):
        cache_path = tmp_path / "members_cache.json"
        cache_path.write_text("{bad json", encoding="utf-8")
        with patch.object(svc, "get_members_cache_path", return_value=cache_path):
            result = await svc._load_members_cache("hinatazaka46")
        assert result is None
