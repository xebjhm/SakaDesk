import json
from pathlib import Path

import pytest


def _async(value):
    async def _f(*a, **k):
        return value

    return _f


@pytest.mark.asyncio
async def test_verify_and_fix_repairs_missing_media(tmp_path, monkeypatch):
    from backend.services.sync_service import SyncService

    # --- lay out a service tree with one member missing image 103 ---
    output_dir = tmp_path / "out"
    service_display = "日向坂46"
    member_dir = output_dir / service_display / "messages" / "10 G" / "20 M"
    (member_dir / "picture").mkdir(parents=True)
    (member_dir / "picture" / "101.jpg").write_bytes(b"IMG")  # present
    # 103 absent -> the gap
    (member_dir / "messages.json").write_text(
        json.dumps(
            {
                "messages": [
                    {
                        "id": 101,
                        "type": "picture",
                        "media_file": "messages/10 G/20 M/picture/101.jpg",
                    },
                    {
                        "id": 103,
                        "type": "picture",
                        "media_file": "messages/10 G/20 M/picture/103.jpg",
                        "timestamp": "2026-01-03T00:00:00Z",
                    },
                ]
            }
        ),
        encoding="utf-8",
    )

    svc = SyncService(service="hinatazaka46")
    monkeypatch.setattr(
        svc,
        "load_app_settings",
        _async({"output_dir": str(output_dir), "is_configured": True}),
    )
    monkeypatch.setattr(
        "backend.services.sync_service.get_service_display_name",
        lambda service: service_display,
    )

    # Stub the authenticated client: get_messages returns a fresh URL for 103;
    # download_file writes bytes to the destination. verify_and_fix_media
    # constructs the real SyncManager itself (self.manager is None), so
    # fake_auth only needs to hand back the (stub) client.
    class StubClient:
        async def get_messages(self, session, gid, since_ts=None):
            return [{"id": 103, "file": "https://cdn/fresh-103.jpg", "type": "picture"}]

        async def download_file(self, session, url, path, timestamp=None, **kw):
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            Path(path).write_bytes(b"FRESH")
            return True

    async def fake_auth(session):
        return StubClient()

    monkeypatch.setattr(svc, "_authenticated_client", fake_auth)

    result = await svc.verify_and_fix_media()

    assert result["missing"] == 1
    assert result["repaired"] == 1
    assert result["failed"] == 0
    assert result["still_missing"] == 0
    assert result["members"] == 1
    assert result["checked"] == 2
    assert (member_dir / "picture" / "103.jpg").read_bytes() == b"FRESH"

    # Idempotent: svc.running must be reset so a subsequent run is allowed.
    assert svc.running is False


@pytest.mark.asyncio
async def test_verify_and_fix_no_messages_root_returns_zero_totals(
    tmp_path, monkeypatch
):
    from backend.services.sync_service import SyncService

    output_dir = tmp_path / "out"
    output_dir.mkdir()

    svc = SyncService(service="hinatazaka46")
    monkeypatch.setattr(
        svc,
        "load_app_settings",
        _async({"output_dir": str(output_dir), "is_configured": True}),
    )
    monkeypatch.setattr(
        "backend.services.sync_service.get_service_display_name",
        lambda service: "日向坂46",
    )

    result = await svc.verify_and_fix_media()

    assert result == {
        "members": 0,
        "checked": 0,
        "missing": 0,
        "repaired": 0,
        "failed": 0,
        "still_missing": 0,
        "unresolved": 0,
        "unresolved_items": [],
    }
    assert svc.running is False


@pytest.mark.asyncio
async def test_verify_and_fix_returns_zero_totals_when_already_running(tmp_path):
    from backend.services.sync_service import SyncService

    svc = SyncService(service="hinatazaka46")
    svc.running = True

    result = await svc.verify_and_fix_media()

    assert result == {
        "members": 0,
        "checked": 0,
        "missing": 0,
        "repaired": 0,
        "failed": 0,
        "still_missing": 0,
        "unresolved": 0,
        "unresolved_items": [],
    }
    assert svc.running is True  # unchanged — guard returned before touching state
