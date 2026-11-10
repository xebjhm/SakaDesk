import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from structlog.testing import capture_logs

from backend.services.memories import oshi

_REAL_NAMES_PATH = oshi._names_path
_REAL_BLOG_CACHE_PATH = oshi._blog_cache_path


@pytest.fixture(autouse=True)
def _isolate(tmp_path):
    oshi._members_cache.clear()
    oshi._failed_until.clear()
    oshi._refreshing.clear()
    with (
        patch.object(oshi, "_names_path", lambda: tmp_path / "oshi_member_names.json"),
        patch.object(
            oshi, "_blog_cache_path", lambda service: tmp_path / f"{service}_mc.json"
        ),
    ):
        yield tmp_path
    oshi._members_cache.clear()
    oshi._failed_until.clear()
    oshi._refreshing.clear()


async def _drain():
    """Let the background refresh (if any) finish."""
    for task in list(oshi._refreshing.values()):
        await task
    await asyncio.sleep(0)


def _fetcher(result=None, exc=None, gate=None):
    calls = {"n": 0}

    class Fetch:
        async def get_blog_members(self, service):
            calls["n"] += 1
            if gate is not None:
                await gate.wait()
            if exc is not None:
                raise exc
            return result

    return Fetch, calls


# --- oshi_names ------------------------------------------------------------


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


# --- never waits on the network --------------------------------------------


@pytest.mark.asyncio
async def test_slow_network_returns_saved_names_immediately(_isolate):
    (_isolate / "oshi_member_names.json").write_text(
        json.dumps({"s": {"12": "金村 美玖"}}), encoding="utf-8"
    )
    gate = asyncio.Event()  # never set: the fetch hangs
    fetch, calls = _fetcher({"12": "x"}, gate=gate)
    with patch.object(oshi, "BlogService", fetch):
        got = await asyncio.wait_for(oshi._blog_members("s"), timeout=1)
        assert got == {"12": "金村 美玖"}
        await asyncio.sleep(0)
        assert calls["n"] == 1  # refresh started in the background
        # Repeat callers are served from memory and share the one refresh.
        assert await oshi._blog_members("s") == {"12": "金村 美玖"}
        assert calls["n"] == 1
        oshi._refreshing["s"].cancel()


@pytest.mark.asyncio
async def test_falls_back_to_blog_members_cache(_isolate):
    (_isolate / "s_mc.json").write_text(
        json.dumps(
            {
                "hash": "h",
                "members": [
                    {"id": "12", "name": "金村 美玖", "thumbnail": None},
                    {"id": "", "name": "skip"},
                    "junk",
                ],
            }
        ),
        encoding="utf-8",
    )
    fetch, _ = _fetcher(exc=RuntimeError("down"))
    with patch.object(oshi, "BlogService", fetch), capture_logs() as logs:
        assert await oshi._blog_members("s") == {"12": "金村 美玖"}
        await _drain()
    disk = [e for e in logs if e["event"] == "oshi_members_from_disk"]
    assert disk[0]["source"] == "blog_cache" and disk[0]["count"] == 1


@pytest.mark.asyncio
async def test_nothing_known_returns_empty_without_waiting():
    gate = asyncio.Event()
    fetch, calls = _fetcher({"12": "金村 美玖"}, gate=gate)
    with patch.object(oshi, "BlogService", fetch):
        assert await asyncio.wait_for(oshi._blog_members("s"), timeout=1) == {}
        gate.set()
        await _drain()
        # Next call has the refreshed names.
        assert await oshi._blog_members("s") == {"12": "金村 美玖"}
    assert calls["n"] == 1


@pytest.mark.asyncio
async def test_refresh_times_out_and_failure_is_cached():
    gate = asyncio.Event()
    fetch, calls = _fetcher({"12": "x"}, gate=gate)
    now = [1000.0]
    with (
        patch.object(oshi, "BlogService", fetch),
        patch.object(oshi, "_REFRESH_TIMEOUT_SECONDS", 0.01),
        patch.object(oshi, "_now", lambda: now[0]),
        capture_logs() as logs,
    ):
        assert await oshi._blog_members("s") == {}
        await _drain()
        assert any(
            e["event"] == "oshi_members_unavailable"
            and e["error_type"] == "TimeoutError"
            for e in logs
        )
        now[0] += 299
        await oshi._blog_members("s")
        assert "s" not in oshi._refreshing  # failure cached: no new fetch
        assert calls["n"] == 1
        assert any(e["event"] == "oshi_refresh_skipped" for e in logs)
        now[0] += 2
        gate.set()
        await oshi._blog_members("s")
        await _drain()
    assert calls["n"] == 2  # retried after five minutes


@pytest.mark.asyncio
async def test_empty_result_is_cached_as_failure():
    fetch, calls = _fetcher({})
    with patch.object(oshi, "BlogService", fetch), capture_logs() as logs:
        await oshi._blog_members("s")
        await _drain()
        await oshi._blog_members("s")
        await _drain()
    assert calls["n"] == 1
    assert any(e["event"] == "oshi_members_empty" and e["service"] == "s" for e in logs)


@pytest.mark.asyncio
async def test_concurrent_calls_make_one_fetch():
    gate = asyncio.Event()
    fetch, calls = _fetcher({"12": "金村 美玖"}, gate=gate)
    with patch.object(oshi, "BlogService", fetch):
        results = await asyncio.gather(*[oshi._blog_members("s") for _ in range(5)])
        await asyncio.sleep(0)
        gate.set()
        await _drain()
    assert calls["n"] == 1 and results == [{}] * 5


@pytest.mark.asyncio
async def test_success_is_cached_for_an_hour_and_saved(_isolate):
    fetch, calls = _fetcher({"12": "金村 美玖"})
    now = [1000.0]
    with (
        patch.object(oshi, "BlogService", fetch),
        patch.object(oshi, "_now", lambda: now[0]),
    ):
        await oshi._blog_members("s")
        await _drain()
        assert json.loads(
            (_isolate / "oshi_member_names.json").read_text(encoding="utf-8")
        ) == {"s": {"12": "金村 美玖"}}
        now[0] += 3599
        assert await oshi._blog_members("s") == {"12": "金村 美玖"}
        assert calls["n"] == 1
        now[0] += 2
        # Stale: served at once, refreshed behind.
        assert await oshi._blog_members("s") == {"12": "金村 美玖"}
        await _drain()
    assert calls["n"] == 2


@pytest.mark.asyncio
async def test_save_merges_services_and_heals_bad_file(_isolate):
    path = _isolate / "oshi_member_names.json"
    path.write_text("[1, 2]", encoding="utf-8")
    oshi._write_disk_members("a", {"1": "A"})
    oshi._write_disk_members("b", {"2": "B"})
    assert json.loads(path.read_text(encoding="utf-8")) == {
        "a": {"1": "A"},
        "b": {"2": "B"},
    }
    path.write_text("{not json", encoding="utf-8")
    oshi._write_disk_members("a", {"1": "A"})
    assert json.loads(path.read_text(encoding="utf-8")) == {"a": {"1": "A"}}


@pytest.mark.asyncio
async def test_save_failure_is_logged_not_raised():
    fetch, _ = _fetcher({"12": "金村 美玖"})
    with (
        patch.object(oshi, "BlogService", fetch),
        patch.object(oshi, "_write_disk_members", side_effect=OSError("ro")),
        capture_logs() as logs,
    ):
        await oshi._blog_members("s")
        await _drain()
    assert any(
        e["event"] == "oshi_names_save_failed" and e["error_type"] == "OSError"
        for e in logs
    )
    assert oshi._members_cache["s"][1] == {"12": "金村 美玖"}


@pytest.mark.asyncio
async def test_unreadable_disk_files_are_logged(_isolate):
    (_isolate / "oshi_member_names.json").write_text("{bad", encoding="utf-8")
    (_isolate / "s_mc.json").write_text("{bad", encoding="utf-8")
    with capture_logs() as logs:
        assert oshi._read_disk_members("s") == ({}, "none")
    events = {e["event"] for e in logs}
    assert {"oshi_names_file_unreadable", "oshi_blog_cache_unreadable"} <= events


def test_saved_names_ignore_non_string_values(_isolate):
    (_isolate / "oshi_member_names.json").write_text(
        json.dumps({"s": {"1": "A", "2": 3, "3": ""}, "t": ["x"]}), encoding="utf-8"
    )
    assert oshi._read_disk_members("s") == ({"1": "A"}, "saved")
    assert oshi._read_disk_members("t") == ({}, "none")


@pytest.mark.asyncio
async def test_refresh_from_another_loop_is_replaced():
    class _Done:
        def done(self):
            return False

        def get_loop(self):
            return object()

    oshi._refreshing["s"] = _Done()  # type: ignore[assignment]
    fetch, calls = _fetcher({"12": "金村 美玖"})
    with patch.object(oshi, "BlogService", fetch):
        await oshi._blog_members("s")
        await _drain()
    assert calls["n"] == 1


def test_default_paths():
    with patch.object(oshi, "get_settings_path", lambda: Path("/x/settings.json")):
        assert _REAL_NAMES_PATH() == Path("/x/oshi_member_names.json")
    with patch.object(
        oshi.BlogService, "get_members_cache_path", lambda self, s: Path(s)
    ):
        assert _REAL_BLOG_CACHE_PATH("svc") == Path("svc")
