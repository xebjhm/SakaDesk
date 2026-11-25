"""D18: the post-sync Memories refresh builds the index once, after profiles."""

import pytest

from backend.services import sync_service
from backend.services.sync_service import SyncService


@pytest.mark.asyncio
async def test_index_builds_after_member_profiles(tmp_path, monkeypatch):
    calls: list[str] = []

    async def profiles(service, sdir):
        calls.append("profiles")
        return True

    async def build(sdir):
        calls.append("index")
        return 0

    async def warm(service, sdir):
        calls.append("warm")

    monkeypatch.setattr(sync_service, "refresh_member_profiles", profiles)
    monkeypatch.setattr(sync_service, "build_memory_index", build)
    monkeypatch.setattr(sync_service, "warm_album", warm)
    svc = SyncService("hinatazaka46")
    svc.service_data_dir = tmp_path
    await svc._refresh_memories()
    # Birthdays are in the index hash: building first meant a second rebuild.
    # The album caches are warmed on the fresh index (D4).
    assert calls == ["profiles", "index", "warm"]


@pytest.mark.asyncio
async def test_failed_profile_refresh_still_builds_index(tmp_path, monkeypatch):
    from structlog.testing import capture_logs

    built: list[object] = []

    async def profiles(service, sdir):
        raise RuntimeError("boom")

    async def build(sdir):
        built.append(sdir)
        return 0

    monkeypatch.setattr(sync_service, "refresh_member_profiles", profiles)
    monkeypatch.setattr(sync_service, "build_memory_index", build)
    svc = SyncService("hinatazaka46")
    svc.service_data_dir = tmp_path
    with capture_logs() as logs:
        await svc._refresh_memories()
    assert built == [tmp_path]
    (ev,) = [e for e in logs if e["event"] == "memories_member_profiles_failed"]
    assert ev["error_type"] == "RuntimeError"


@pytest.mark.asyncio
async def test_refresh_is_pending_from_scheduling_until_the_index_is_built(
    tmp_path, monkeypatch
):
    """D9: the hub asks again while the refresh is pending; the mark covers
    the gap between the sync's end and the task's first step."""
    from backend.services.memories import index as mi

    seen: list[bool] = []
    tasks: list = []

    async def profiles(service, sdir):
        seen.append(mi.refresh_pending(sdir))
        return True

    async def build(sdir):
        seen.append(mi.refresh_pending(sdir))
        return 0

    monkeypatch.setattr(sync_service, "refresh_member_profiles", profiles)
    monkeypatch.setattr(sync_service, "build_memory_index", build)
    monkeypatch.setattr(
        sync_service,
        "track_background_task",
        lambda coro, name=None: tasks.append(coro),
    )
    monkeypatch.setattr(sync_service, "request_card_check", lambda s: None)
    svc = SyncService("hinatazaka46")
    svc.service_data_dir = tmp_path
    svc._schedule_memories_refresh()
    assert mi.refresh_pending(tmp_path)  # before the task ran at all
    for coro in tasks:
        await coro
    assert seen == [True, True]
    assert not mi.refresh_pending(tmp_path)


def test_failed_scheduling_clears_the_pending_mark(tmp_path, monkeypatch):
    from backend.services.memories import index as mi

    def boom(coro, name=None):
        coro.close()
        raise RuntimeError("no loop")

    monkeypatch.setattr(sync_service, "track_background_task", boom)
    svc = SyncService("hinatazaka46")
    svc.service_data_dir = tmp_path
    svc._schedule_memories_refresh()
    assert not mi.refresh_pending(tmp_path)


@pytest.mark.asyncio
async def test_a_built_index_requests_thumbnail_pregen(tmp_path, monkeypatch):
    """M4: the worker is asked for a pass only after the index built."""
    from backend.services import media_pregen

    calls: list[str] = []

    async def build(sdir):
        calls.append("index")
        return 0

    monkeypatch.setattr(sync_service, "build_memory_index", build)
    monkeypatch.setattr(media_pregen, "request", lambda s: calls.append(f"req:{s}"))
    svc = SyncService("hinatazaka46")
    svc.service_data_dir = tmp_path
    await svc._refresh_memories()
    assert calls == ["index", "req:hinatazaka46"]


@pytest.mark.asyncio
async def test_a_failed_index_build_requests_nothing(tmp_path, monkeypatch):
    from backend.services import media_pregen

    calls: list[str] = []

    async def build(sdir):
        raise RuntimeError("boom")

    monkeypatch.setattr(sync_service, "build_memory_index", build)
    monkeypatch.setattr(media_pregen, "request", lambda s: calls.append(s))
    svc = SyncService("hinatazaka46")
    svc.service_data_dir = tmp_path
    with pytest.raises(RuntimeError):
        await svc._refresh_memories()
    assert calls == []


@pytest.mark.asyncio
async def test_a_failed_pregen_request_never_fails_the_refresh(tmp_path, monkeypatch):
    from structlog.testing import capture_logs

    from backend.services import media_pregen

    def boom(service):
        raise RuntimeError("x")

    monkeypatch.setattr(media_pregen, "request", boom)
    svc = SyncService("hinatazaka46")
    svc.service_data_dir = tmp_path
    with capture_logs() as logs:
        await svc._refresh_memories()
    assert {
        "event": "media_pregen_request_failed",
        "service": "hinatazaka46",
        "error_type": "RuntimeError",
        "log_level": "warning",
    } in logs
