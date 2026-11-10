"""Export handoff: ``POST /api/memories/export`` and ``GET /api/memories/export/{token}``."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import asyncio

import pytest
import time_machine
from fastapi.testclient import TestClient

from backend.main import app
from backend.services.memories import exports

client = TestClient(app)

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
GIF = b"GIF89a" + b"\x00" * 32
WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 32
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 32
T0 = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _empty_store():
    exports.store.clear()
    yield
    exports.store.clear()


def post(data: bytes, kind: str = "png"):
    return client.post(
        "/api/memories/export",
        params={"kind": kind},
        content=data,
        headers={"Content-Type": "application/octet-stream"},
    )


@pytest.mark.parametrize(
    ("kind", "data", "media"),
    [
        ("png", PNG, "image/png"),
        ("gif", GIF, "image/gif"),
        ("webm", WEBM, "video/webm"),
        ("mp4", MP4, "video/mp4"),
    ],
)
def test_round_trip_serves_attachment(kind, data, media):
    r = post(data, kind)
    assert r.status_code == 200
    token = r.json()["token"]
    assert len(token) >= 32
    g = client.get(
        f"/api/memories/export/{token}", params={"filename": f"poster.{kind}"}
    )
    assert g.status_code == 200
    assert g.content == data
    assert g.headers["content-type"] == media
    disposition = g.headers["content-disposition"]
    assert disposition.startswith("attachment;")
    assert f"filename*=UTF-8''poster.{kind}" in disposition


def test_entry_survives_a_repeated_request():
    token = post(PNG).json()["token"]
    assert client.get(f"/api/memories/export/{token}").status_code == 200
    assert client.get(f"/api/memories/export/{token}").status_code == 200


def test_magic_mismatch_is_rejected():
    assert post(PNG, "gif").status_code == 400
    assert post(b"not an image", "png").status_code == 400
    assert post(GIF, "mp4").status_code == 400
    assert len(exports.store) == 0


def test_unknown_kind_is_rejected():
    assert post(PNG, "exe").status_code == 422


def test_oversize_is_rejected(monkeypatch):
    monkeypatch.setattr(exports, "MAX_BYTES", 128)
    assert post(PNG + b"\x00" * 200).status_code == 413
    assert len(exports.store) == 0


def test_real_cap_is_60_mb():
    assert exports.MAX_BYTES == 60 * 1024 * 1024
    big = PNG + b"\x00" * (exports.MAX_BYTES + 1 - len(PNG))
    assert post(big).status_code == 413


def test_unknown_token_is_404():
    assert client.get("/api/memories/export/nope").status_code == 404


def test_expired_token_is_404():
    with time_machine.travel(T0, tick=False):
        token = post(PNG).json()["token"]
    with time_machine.travel(T0 + timedelta(minutes=9, seconds=59), tick=False):
        assert client.get(f"/api/memories/export/{token}").status_code == 200
    with time_machine.travel(T0 + timedelta(minutes=10), tick=False):
        assert client.get(f"/api/memories/export/{token}").status_code == 404
    assert len(exports.store) == 0


def test_eviction_keeps_the_newest_eight():
    tokens = [post(PNG).json()["token"] for _ in range(exports.MAX_ENTRIES + 2)]
    assert len(exports.store) == exports.MAX_ENTRIES
    assert client.get(f"/api/memories/export/{tokens[0]}").status_code == 404
    assert client.get(f"/api/memories/export/{tokens[1]}").status_code == 404
    for token in tokens[2:]:
        assert client.get(f"/api/memories/export/{token}").status_code == 200


def test_cjk_filename_is_kept_and_extension_forced():
    token = post(PNG).json()["token"]
    name = "2026年 金村 美玖🌸.gif"
    g = client.get(f"/api/memories/export/{token}", params={"filename": name})
    disposition = g.headers["content-disposition"]
    expected = quote("2026年 金村 美玖🌸.png", safe="")
    assert f"filename*=UTF-8''{expected}" in disposition
    # The ASCII fallback keeps only what ASCII can carry.
    assert 'filename="2026.png"' in disposition


@pytest.mark.parametrize(
    ("raw", "kind", "expected"),
    [
        ("../../etc/passwd", "png", "etcpasswd.png"),
        ("..\\..\\win.ini", "png", "win.png"),
        ("a\x00b\r\nc‮.png", "png", "abc.png"),
        ('re<cap>:"x"|?*.mp4', "mp4", "recapx.mp4"),
        ("poster.exe", "gif", "poster.gif"),
        ("...", "png", "sakadesk-memories.png"),
        (None, "webm", "sakadesk-memories.webm"),
        ("金村 美玖", "png", "金村 美玖.png"),
        ("x" * 300, "png", "x" * exports.MAX_STEM_CHARS + ".png"),
    ],
)
def test_sanitize_filename(raw, kind, expected):
    assert exports.sanitize_filename(raw, kind) == expected


def test_logs_carry_no_token_or_filename(caplog, capsys):
    from structlog.testing import capture_logs

    with capture_logs() as logs:
        token = post(PNG).json()["token"]
        client.get(f"/api/memories/export/{token}", params={"filename": "金村.png"})
        client.get("/api/memories/export/missing")
    events = [e for e in logs if e["event"].startswith("memories.export")]
    assert [e["outcome"] for e in events] == ["stored", "served", "not_found"]
    for e in events:
        flat = repr(e)
        assert token not in flat
        assert "金村" not in flat
        assert set(e) <= {"event", "log_level", "kind", "size_kb", "evicted", "outcome"}


def test_total_byte_cap_evicts_the_oldest():
    store = exports.ExportStore(max_total_bytes=250)
    blob = PNG + b"\x00" * (100 - len(PNG))  # 100 bytes
    first, _ = store.put("png", blob)
    second, _ = store.put("png", blob)
    third, evicted = store.put("png", blob)  # 300 > 250: drop the oldest
    assert evicted == 1
    assert store.get(first) is None
    assert store.get(second) is not None and store.get(third) is not None
    assert len(store) == 2


def test_total_cap_default_is_150_mb():
    assert exports.MAX_TOTAL_BYTES == 150 * 1024 * 1024


def test_sweep_frees_expired_entries_without_a_request():
    store = exports.ExportStore()
    with time_machine.travel(T0, tick=False):
        store.put("png", PNG)
        assert store.purge() == 0
    with time_machine.travel(T0 + timedelta(minutes=10), tick=False):
        assert store.purge() == 1
    assert len(store) == 0
    assert store._total == 0


@pytest.mark.asyncio
async def test_sweep_loop_purges_and_stops_on_cancel(monkeypatch):
    fresh = exports.ExportStore()
    monkeypatch.setattr(exports, "store", fresh)
    with time_machine.travel(
        datetime.now(timezone.utc) - timedelta(minutes=11), tick=False
    ):
        fresh.put("png", PNG)
    task = asyncio.create_task(exports.sweep_loop(interval=0.01))
    for _ in range(100):
        await asyncio.sleep(0.01)
        if len(fresh) == 0:
            break
    assert len(fresh) == 0
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert task.cancelled()


def test_lifespan_starts_and_cancels_the_sweep_task(monkeypatch):
    from backend.services import shutdown_state

    seen = {}
    real = exports.sweep_loop

    async def spy(*a, **k):
        try:
            await real(*a, **k)
        except asyncio.CancelledError:
            seen["cancelled"] = True
            raise

    async def started_probe():
        seen["started"] = True
        await spy()

    monkeypatch.setattr(exports, "sweep_loop", started_probe)
    with TestClient(app):
        pass
    shutdown_state.reset_for_tests()  # the lifespan flips the process-wide flag
    assert seen == {"started": True, "cancelled": True}
