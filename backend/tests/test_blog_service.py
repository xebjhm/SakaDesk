import pytest
import asyncio
from unittest.mock import patch
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
