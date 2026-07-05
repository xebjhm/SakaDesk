"""Blog backup fail-safe: atomic writes + validated (self-healing) resume."""

import os

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


def test_replace_with_retry_survives_transient_windows_lock(monkeypatch, tmp_path):
    """On Windows os.replace raises PermissionError when another handle briefly holds
    the destination (a concurrent reader, an antivirus scan, or the Search indexer) --
    the [WinError 5] Access is denied ... tmpXXXX.tmp -> index.json seen in the wild.
    Such a transient lock must be retried, not surfaced as a failed write."""
    from backend.services import blog_service

    src = tmp_path / "a.tmp"
    src.write_text("payload", encoding="utf-8")
    dst = tmp_path / "index.json"

    calls = {"n": 0}
    real_replace = os.replace

    def flaky_replace(a, b):
        calls["n"] += 1
        if calls["n"] < 3:
            raise PermissionError(13, "Access is denied")
        real_replace(a, b)

    monkeypatch.setattr(os, "replace", flaky_replace)

    blog_service._replace_with_retry(str(src), str(dst), attempts=5, base_delay=0)

    assert calls["n"] == 3  # failed twice, succeeded on the third try
    assert dst.read_text(encoding="utf-8") == "payload"


def test_replace_with_retry_reraises_when_lock_never_clears(monkeypatch):
    """A lock that never clears must still surface (raise) after the retries are
    exhausted -- we retry transient contention, we do not silently drop the write."""
    from backend.services import blog_service

    def always_locked(a, b):
        raise PermissionError(13, "Access is denied")

    monkeypatch.setattr(os, "replace", always_locked)

    with pytest.raises(PermissionError):
        blog_service._replace_with_retry("a", "b", attempts=3, base_delay=0)
