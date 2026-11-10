"""Text-free view cache (``backend/services/memories/view_cache.py``)."""

from __future__ import annotations

import sqlite3

import pytest
from structlog.testing import capture_logs

from backend.services.memories import index as mi
from backend.services.memories import view_cache as vc


@pytest.fixture
def sdir(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    return tmp_path / "日向坂46"


def builder(payload):
    calls = []

    async def build():
        calls.append(1)
        return payload

    return build, calls


def outcomes(logs):
    return [e["outcome"] for e in logs if e["event"] == "memories_view_cache"]


@pytest.mark.asyncio
async def test_miss_builds_and_writes_then_hit_skips_build(sdir):
    payload = {"items": [{"id": 1, "text": None, "caption": None}], "n": 3}
    build, calls = builder(payload)
    with capture_logs() as logs:
        assert await vc.cached_view(sdir, "binder", "k", "h1", build) == payload
        assert await vc.cached_view(sdir, "binder", "k", "h1", build) == payload
    assert len(calls) == 1
    assert outcomes(logs) == ["miss", "hit"]
    ev = next(e for e in logs if e["event"] == "memories_view_cache")
    assert set(ev) == {"event", "log_level", "view", "outcome"}


@pytest.mark.asyncio
async def test_changed_hash_rebuilds(sdir):
    build, calls = builder({"v": 1})
    await vc.cached_view(sdir, "binder", "k", "h1", build)
    await vc.cached_view(sdir, "binder", "k", "h2", build)
    await vc.cached_view(sdir, "binder", "k", "h2", build)
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_views_keys_and_services_are_separate(sdir):
    build, calls = builder({"v": 1})
    await vc.cached_view(sdir, "binder", "k", "h", build)
    await vc.cached_view(sdir, "album", "k", "h", build)
    await vc.cached_view(sdir, "binder", "k2", "h", build)
    await vc.cached_view(sdir.parent / "櫻坂46", "binder", "k", "h", build)
    assert len(calls) == 4


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {"text": "彼女の言葉"},
        {"items": [{"caption": "見せたかった"}]},
        {"a": {"b": [{"sentence": "ありがとう"}]}},
    ],
)
async def test_payload_with_text_is_not_stored(sdir, payload):
    build, calls = builder(payload)
    with capture_logs() as logs:
        assert await vc.cached_view(sdir, "binder", "k", "h", build) == payload
        await vc.cached_view(sdir, "binder", "k", "h", build)
    assert len(calls) == 2
    assert outcomes(logs) == ["uncacheable", "uncacheable"]
    blob = repr(logs)
    assert "彼女" not in blob and "見せた" not in blob and "ありがとう" not in blob


def test_contains_text():
    assert not vc.contains_text({"text": None, "caption": None, "sentence": None})
    assert not vc.contains_text([{"id": 1}, "text", {"title": "x"}])
    assert vc.contains_text([[{"text": ""}]])  # non-null counts


@pytest.mark.asyncio
async def test_sqlite_error_still_returns_the_build_result(sdir, monkeypatch):
    def broken():
        raise sqlite3.OperationalError("disk I/O error")

    monkeypatch.setattr(vc.mi, "_connect", broken)
    build, calls = builder({"v": 1})
    with capture_logs() as logs:
        assert await vc.cached_view(sdir, "binder", "k", "h", build) == {"v": 1}
    assert len(calls) == 1
    fails = [e for e in logs if e["event"] == "memories_view_cache_failed"]
    assert {e["op"] for e in fails} == {"read", "write"}
    assert all(e["error_type"] == "OperationalError" for e in fails)


@pytest.mark.asyncio
async def test_corrupt_row_is_a_miss(sdir):
    build, calls = builder({"v": 1})
    await vc.cached_view(sdir, "binder", "k", "h", build)
    import contextlib

    with contextlib.closing(mi._connect()) as c, c:
        c.execute("UPDATE memories_view_cache SET payload='[1'")
    assert await vc.cached_view(sdir, "binder", "k", "h", build) == {"v": 1}
    assert len(calls) == 2


def test_view_hash():
    h = vc.view_hash("a", 1, None)
    assert len(h) == 16 and h == vc.view_hash("a", 1, None)
    assert h != vc.view_hash("a", 2, None)
