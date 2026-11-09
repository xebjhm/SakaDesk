import pytest
import asyncio
from unittest.mock import ANY, AsyncMock, patch
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
