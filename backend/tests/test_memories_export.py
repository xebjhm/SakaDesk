"""Export handoff: ``POST /api/memories/export`` and ``GET /api/memories/export/{token}``."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from urllib.parse import quote

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
