from unittest.mock import AsyncMock, patch

import pytest

from backend.services.memories import oshi


@pytest.fixture(autouse=True)
def _clear_members_cache():
    oshi._members_cache.clear()
    yield
    oshi._members_cache.clear()


@pytest.mark.asyncio
async def test_resolves_blog_ids_to_normalized_names():
    with (
        patch.object(
            oshi,
            "load_config",
            AsyncMock(return_value={"oshi_members": {"hinatazaka46": ["12", "99"]}}),
        ),
        patch.object(
            oshi, "_blog_members", AsyncMock(return_value={"12": "金村 美玖"})
        ),
    ):
        assert await oshi.oshi_names("hinatazaka46") == {"金村美玖"}


@pytest.mark.asyncio
async def test_no_setting_is_empty():
    with patch.object(oshi, "load_config", AsyncMock(return_value={})):
        assert await oshi.oshi_names("hinatazaka46") == set()


@pytest.mark.asyncio
async def test_blog_members_failure_is_empty():
    with (
        patch.object(
            oshi, "load_config", AsyncMock(return_value={"oshi_members": {"s": ["1"]}})
        ),
        patch.object(oshi, "_blog_members", AsyncMock(return_value={})),
    ):
        assert await oshi.oshi_names("s") == set()


@pytest.mark.asyncio
async def test_blog_members_swallows_errors():
    class Boom:
        async def get_blog_members(self, service):
            raise RuntimeError("x")

    with patch.object(oshi, "BlogService", Boom):
        assert await oshi._blog_members("s") == {}


class _Counting:
    calls = 0
    result: dict = {"12": "金村 美玖"}

    async def get_blog_members(self, service):
        type(self).calls += 1
        return type(self).result


@pytest.mark.asyncio
async def test_blog_members_cached_for_an_hour():
    _Counting.calls = 0
    _Counting.result = {"12": "金村 美玖"}
    now = [1000.0]
    with (
        patch.object(oshi, "BlogService", _Counting),
        patch.object(oshi.time, "monotonic", lambda: now[0]),
    ):
        assert await oshi._blog_members("s") == {"12": "金村 美玖"}
        now[0] += 3599
        await oshi._blog_members("s")
        assert _Counting.calls == 1
        assert await oshi._blog_members("other") == {"12": "金村 美玖"}
        assert _Counting.calls == 2  # per service
        now[0] += 2
        await oshi._blog_members("s")
        assert _Counting.calls == 3  # expired


@pytest.mark.asyncio
async def test_blog_members_empty_is_not_cached():
    _Counting.calls = 0
    _Counting.result = {}
    with patch.object(oshi, "BlogService", _Counting):
        await oshi._blog_members("s")
        await oshi._blog_members("s")
    assert _Counting.calls == 2


@pytest.mark.asyncio
async def test_blog_members_single_flight():
    import asyncio

    calls = 0
    gate = asyncio.Event()

    class Slow:
        async def get_blog_members(self, service):
            nonlocal calls
            calls += 1
            await gate.wait()
            return {"12": "金村 美玖"}

    with patch.object(oshi, "BlogService", Slow):
        tasks = [asyncio.create_task(oshi._blog_members("s")) for _ in range(5)]
        await asyncio.sleep(0)
        gate.set()
        results = await asyncio.gather(*tasks)
    assert calls == 1 and all(r == {"12": "金村 美玖"} for r in results)


@pytest.mark.asyncio
async def test_blog_members_empty_logs_breadcrumb():
    from structlog.testing import capture_logs

    _Counting.result = {}
    with patch.object(oshi, "BlogService", _Counting), capture_logs() as logs:
        assert await oshi._blog_members("s") == {}
    assert any(e["event"] == "oshi_members_empty" and e["service"] == "s" for e in logs)
