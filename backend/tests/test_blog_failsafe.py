"""Blog backup fail-safe: atomic writes + validated (self-healing) resume."""

import pytest

from backend.services.blog_service import BlogService


def test_is_blog_cached_requires_nonempty_blog_json(tmp_path):
    d = tmp_path / "blog"
    d.mkdir()
    # No blog.json -> not cached.
    assert BlogService._is_blog_cached(d) is False
    # Zero-byte (interrupted write) -> not cached, so it gets re-downloaded.
    (d / "blog.json").write_text("")
    assert BlogService._is_blog_cached(d) is False
    # Real content -> cached (skipped on resume).
    (d / "blog.json").write_text('{"id": 1}')
    assert BlogService._is_blog_cached(d) is True


@pytest.mark.asyncio
async def test_atomic_write_text_and_bytes_leave_no_temp(tmp_path):
    svc = BlogService()

    await svc._atomic_write(tmp_path / "sub" / "blog.json", '{"a": 1}')
    assert (tmp_path / "sub" / "blog.json").read_text() == '{"a": 1}'

    await svc._atomic_write(tmp_path / "img.bin", b"\x00\x01\x02")
    assert (tmp_path / "img.bin").read_bytes() == b"\x00\x01\x02"

    # No leftover .tmp files from either write.
    assert list(tmp_path.rglob("*.tmp")) == []
