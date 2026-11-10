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

    monkeypatch.setattr(sync_service, "refresh_member_profiles", profiles)
    monkeypatch.setattr(sync_service, "build_memory_index", build)
    svc = SyncService("hinatazaka46")
    svc.service_data_dir = tmp_path
    await svc._refresh_memories()
    # Birthdays are in the index hash: building first meant a second rebuild.
    assert calls == ["profiles", "index"]


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
