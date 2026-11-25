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
        "rejected": 0,
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
        "rejected": 0,
        "unresolved": 0,
        "unresolved_items": [],
    }
    assert svc.running is True  # unchanged — guard returned before touching state


def _make_member(output_dir: Path, gid: int, mid: int, msg_ids: list[int]) -> Path:
    """Lay out a member dir whose pictures (all absent) are the gaps."""
    member_dir = output_dir / "日向坂46" / "messages" / f"{gid} G" / f"{mid} M"
    (member_dir / "picture").mkdir(parents=True)
    (member_dir / "messages.json").write_text(
        json.dumps(
            {
                "messages": [
                    {
                        "id": i,
                        "type": "picture",
                        "media_file": f"messages/{gid} G/{mid} M/picture/{i}.jpg",
                        "timestamp": "2026-01-03T00:00:00Z",
                    }
                    for i in msg_ids
                ]
            }
        ),
        encoding="utf-8",
    )
    return member_dir


def _verify_service(tmp_path, monkeypatch, client):
    from backend.services.sync_service import SyncService

    output_dir = tmp_path / "out"
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
    monkeypatch.setattr(svc, "_authenticated_client", _async(client))
    return svc, output_dir


class _FlakyClient:
    """get_messages raises per group id; healthy groups return a fresh URL."""

    def __init__(self, errors: dict):
        self.errors = errors
        self.fetched: list[int] = []

    async def get_messages(self, session, gid, since_ts=None):
        self.fetched.append(gid)
        if gid in self.errors:
            raise self.errors[gid]
        return [
            {"id": 100 + gid, "file": f"https://cdn/fresh-{gid}.jpg", "type": "picture"}
        ]

    async def download_file(self, session, url, path, timestamp=None, **kw):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_bytes(b"FRESH")
        return True


@pytest.mark.asyncio
async def test_verify_group_fetch_failure_skips_group_and_completes(
    tmp_path, monkeypatch
):
    from pysaka import ApiError
    from structlog.testing import capture_logs

    client = _FlakyClient({10: ApiError("secret text https://cdn/x.jpg")})
    svc, output_dir = _verify_service(tmp_path, monkeypatch, client)
    bad = _make_member(output_dir, 10, 20, [110, 111])
    good = _make_member(output_dir, 11, 21, [111])

    with capture_logs() as logs:
        result = await svc.verify_and_fix_media()

    assert client.fetched == [10, 11]
    assert result["missing"] == 3
    assert result["repaired"] == 1
    assert result["still_missing"] == 2
    assert not list((bad / "picture").iterdir())
    assert (good / "picture" / "111.jpg").read_bytes() == b"FRESH"
    (failed,) = [e for e in logs if e["event"] == "verify_group_fetch_failed"]
    assert failed["group_id"] == 10 and failed["error_type"] == "ApiError"
    # Never log message text or URLs.
    assert "secret" not in repr(failed) and "cdn" not in repr(failed)
    assert any(e["event"] == "verify_complete" for e in logs)
    assert svc.running is False


@pytest.mark.asyncio
async def test_verify_unexpected_fetch_error_skips_group(tmp_path, monkeypatch):
    from structlog.testing import capture_logs

    client = _FlakyClient({10: ValueError("boom")})
    svc, output_dir = _verify_service(tmp_path, monkeypatch, client)
    _make_member(output_dir, 10, 20, [110])
    _make_member(output_dir, 11, 21, [111])

    with capture_logs() as logs:
        result = await svc.verify_and_fix_media()

    assert result["repaired"] == 1 and result["still_missing"] == 1
    (failed,) = [e for e in logs if e["event"] == "verify_group_fetch_failed"]
    assert failed["error_type"] == "ValueError"


@pytest.mark.asyncio
async def test_verify_rate_limited_stops_fetching_further_groups(tmp_path, monkeypatch):
    from pysaka import RateLimitedError
    from structlog.testing import capture_logs

    client = _FlakyClient({10: RateLimitedError("429", retry_after=30.0)})
    svc, output_dir = _verify_service(tmp_path, monkeypatch, client)
    _make_member(output_dir, 10, 20, [110])
    _make_member(output_dir, 11, 21, [111, 112])
    _make_member(output_dir, 12, 22, [112])

    with capture_logs() as logs:
        result = await svc.verify_and_fix_media()

    assert client.fetched == [10]  # groups 11 and 12 never fetched
    assert result["missing"] == 4
    assert result["repaired"] == 0
    assert result["still_missing"] == 4
    limited = [e for e in logs if e["event"] == "verify_rate_limited"]
    assert len(limited) == 1
    assert limited[0]["group_id"] == 10 and limited[0]["retry_after"] == 30.0
    assert any(e["event"] == "verify_complete" for e in logs)
    assert svc.running is False


@pytest.mark.asyncio
@pytest.mark.parametrize("exc_name", ["SessionExpiredError", "RefreshFailedError"])
async def test_verify_auth_errors_still_propagate(tmp_path, monkeypatch, exc_name):
    import pysaka

    exc_cls = getattr(pysaka, exc_name)
    client = _FlakyClient({10: exc_cls("expired")})
    svc, output_dir = _verify_service(tmp_path, monkeypatch, client)
    _make_member(output_dir, 10, 20, [110])

    with pytest.raises(exc_cls):
        await svc.verify_and_fix_media()
    assert svc.running is False


def _scan_stub(good, bad):
    def scan(self, member_dir):
        return {"checked": 5, "missing": [*good, *bad], "unresolved": []}

    return scan


def _gap_service(tmp_path, monkeypatch):
    from backend.services.sync_service import SyncService

    output_dir = tmp_path / "out"
    member_dir = output_dir / "日向坂46" / "messages" / "10 G" / "20 M"
    member_dir.mkdir(parents=True)
    (member_dir / "messages.json").write_text('{"messages": []}', encoding="utf-8")
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

    class StubClient:
        async def get_messages(self, session, gid, since_ts=None):
            return []

    monkeypatch.setattr(svc, "_authenticated_client", _async(StubClient()))
    return svc, output_dir, member_dir


@pytest.mark.asyncio
async def test_verify_counts_items_the_containment_filter_dropped(
    tmp_path, monkeypatch
):
    from pysaka import SyncManager

    svc, output_dir, member_dir = _gap_service(tmp_path, monkeypatch)
    inside = {"path": member_dir / "picture" / "1.jpg", "timestamp": "2026-01-01"}
    outside = {"path": output_dir / "elsewhere" / "2.jpg", "timestamp": "2026-01-02"}
    monkeypatch.setattr(
        SyncManager, "scan_member_media", _scan_stub([inside], [outside])
    )

    async def reconcile(self, session, member_dir, missing, timeline, **kw):
        return {"repaired": 0, "failed": 0, "still_missing": len(missing)}

    monkeypatch.setattr(SyncManager, "reconcile_member_media", reconcile)

    result = await svc.verify_and_fix_media()

    assert result["checked"] == 5
    assert result["missing"] == 1 and result["still_missing"] == 1
    assert result["rejected"] == 1
    assert result["repaired"] == 0 and result["failed"] == 0


@pytest.mark.asyncio
async def test_verify_with_only_rejected_items_ends_with_rejected(
    tmp_path, monkeypatch
):
    from pysaka import SyncManager

    svc, output_dir, _ = _gap_service(tmp_path, monkeypatch)
    outside = {"path": output_dir / "elsewhere" / "2.jpg", "timestamp": "2026-01-02"}
    monkeypatch.setattr(SyncManager, "scan_member_media", _scan_stub([], [outside]))

    result = await svc.verify_and_fix_media()

    assert (result["missing"], result["rejected"]) == (0, 1)


@pytest.mark.asyncio
async def test_verify_skips_the_filter_when_nothing_is_missing(tmp_path, monkeypatch):
    from pysaka import SyncManager

    svc, _, _ = _gap_service(tmp_path, monkeypatch)
    monkeypatch.setattr(SyncManager, "scan_member_media", _scan_stub([], []))
    calls = []
    monkeypatch.setattr(svc, "_contained_media", lambda *a, **k: calls.append(1) or [])

    result = await svc.verify_and_fix_media()

    assert calls == []
    assert result["missing"] == 0 and result["rejected"] == 0
