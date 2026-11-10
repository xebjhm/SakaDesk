"""Share GIF assembly: ``POST /api/memories/share/gif`` and ``share_gif.assemble_gif``."""

from __future__ import annotations

import base64
import io
import json
import struct
import zlib

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.main import app
from backend.services.memories import exports, share_gif

client = TestClient(app)


@pytest.fixture(autouse=True)
def _empty_store():
    exports.store.clear()
    yield
    exports.store.clear()


def png(width: int = 54, height: int = 96, shade: int = 0) -> str:
    """A base64 PNG frame of one flat colour."""
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (shade, 120, 200 - shade)).save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def header_only_png(width: int, height: int) -> str:
    """A base64 PNG that declares a size in its IHDR but carries no pixel rows.

    Pillow reads chunks up to the first IDAT on open, so an empty IDAT and IEND follow
    the header; decoding it would fail, which is the point: only the header is read.
    """

    def chunk(cid: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(cid + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + cid + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    raw = (
        share_gif.PNG_MAGIC
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(b""))
        + chunk(b"IEND", b"")
    )
    return base64.b64encode(raw).decode("ascii")


def body(frames: list[str], **over) -> dict:
    return {"frames": frames, "fps": 15, "width": 54, "height": 96, **over}


def post(payload: dict | bytes, headers: dict | None = None):
    content = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
    return client.post(
        "/api/memories/share/gif",
        content=content,
        headers={"Content-Type": "application/json", **(headers or {})},
    )


def stored_gif(token: str) -> Image.Image:
    entry = exports.store.get(token)
    assert entry is not None and entry.kind == "gif"
    return Image.open(io.BytesIO(entry.data))


def test_three_frames_make_a_looping_gif_of_the_declared_size():
    r = post(body([png(shade=0), png(shade=60), png(shade=120)]))
    assert r.status_code == 200
    gif = stored_gif(r.json()["token"])
    assert gif.format == "GIF"
    assert gif.size == (54, 96)
    assert gif.n_frames == 3
    assert gif.info.get("loop") == 0
    assert gif.info.get("duration") == pytest.approx(1000 / 15, abs=10)


def test_the_token_downloads_through_the_export_handoff():
    token = post(body([png(), png(shade=90)])).json()["token"]
    g = client.get(f"/api/memories/export/{token}", params={"filename": "recap.gif"})
    assert g.status_code == 200
    assert g.headers["content-type"] == "image/gif"
    assert g.content.startswith(b"GIF89a")


def test_per_frame_durations_hold_a_scene():
    r = post(body([png(), png(shade=90)], durations_ms=[200, 1500]))
    assert r.status_code == 200
    gif = stored_gif(r.json()["token"])
    gif.seek(1)
    assert gif.info["duration"] == 1500


def test_too_many_frames_is_rejected():
    r = post(body([png()] * (share_gif.MAX_FRAMES + 1)))
    assert r.status_code == 400
    assert r.json()["detail"] == "too_many_frames"


def test_no_frames_is_rejected():
    assert post(body([])).json()["detail"] == "no_frames"


def test_a_frame_of_another_size_is_rejected():
    r = post(body([png(), png(width=60)]))
    assert r.status_code == 400
    assert r.json()["detail"] == "frame_size"


def test_a_frame_that_is_not_a_png_is_rejected():
    jpeg = io.BytesIO()
    Image.new("RGB", (54, 96)).save(jpeg, "JPEG")
    r = post(body([png(), base64.b64encode(jpeg.getvalue()).decode()]))
    assert r.status_code == 400
    assert r.json()["detail"] == "not_png"


def test_bad_base64_is_rejected():
    assert post(body(["@@@not base64@@@"])).json()["detail"] == "bad_frame"


def test_a_png_that_does_not_decode_is_rejected():
    broken = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 40).decode()
    assert post(body([broken])).json()["detail"] == "bad_frame"


@pytest.mark.parametrize(
    ("over", "code"),
    [
        ({"fps": 0}, "bad_fps"),
        ({"fps": 61}, "bad_fps"),
        ({"width": 0}, "bad_size"),
        ({"width": share_gif.MAX_SIDE + 1}, "bad_size"),
        ({"durations_ms": [100]}, "bad_durations"),
        ({"durations_ms": [100, 200, 300]}, "bad_durations"),
        ({"durations_ms": []}, "bad_durations"),
        ({"durations_ms": [100, 0]}, "bad_durations"),
        ({"durations_ms": [100, share_gif.MIN_DURATION_MS - 1]}, "bad_durations"),
        ({"durations_ms": [100, share_gif.MAX_DURATION_MS + 1]}, "bad_durations"),
        ({"durations_ms": [100, -50]}, "bad_durations"),
        ({"durations_ms": [100, 66.5]}, "bad_durations"),
        ({"durations_ms": [100, "66"]}, "bad_durations"),
        ({"durations_ms": [100, True]}, "bad_durations"),
        ({"durations_ms": [100, None]}, "bad_durations"),
        ({"durations_ms": "100,200"}, "bad_durations"),
        ({"durations_ms": {"0": 100, "1": 200}}, "bad_durations"),
        ({"durations_ms": 100}, "bad_durations"),
    ],
)
def test_bad_parameters_are_rejected(over, code):
    r = post(body([png(), png(shade=50)], **over))
    assert r.status_code == 400
    assert r.json()["detail"] == code


def test_durations_at_the_bounds_are_accepted():
    r = post(
        body(
            [png(), png(shade=50)],
            durations_ms=[share_gif.MIN_DURATION_MS, share_gif.MAX_DURATION_MS],
        )
    )
    assert r.status_code == 200


@pytest.mark.parametrize(
    ("side", "label"),
    [(20_000, "error"), (10_000, "warning")],  # > 2× and 1–2× MAX_IMAGE_PIXELS
)
def test_a_decompression_bomb_header_is_rejected_and_logged(side, label):
    from structlog.testing import capture_logs

    assert side * side > Image.MAX_IMAGE_PIXELS, label
    with capture_logs() as logs:
        r = post(body([header_only_png(side, side)]))
    assert r.status_code == 400
    assert r.json()["detail"] == "decompression_bomb"
    rejects = [e for e in logs if e["event"] == "memories.share.reject"]
    assert [e["reason"] for e in rejects] == ["decompression_bomb"]


def test_a_decompression_bomb_never_escapes_assemble_gif():
    with pytest.raises(share_gif.ShareGifError) as exc:
        share_gif.assemble_gif(
            json.dumps(body([header_only_png(20_000, 20_000)])).encode()
        )
    assert exc.value.code == "decompression_bomb"
    assert exc.value.status == 400


def test_the_total_pixel_budget_is_checked_before_any_frame_is_opened(monkeypatch):
    opened: list[int] = []
    real_open = Image.open

    def counting_open(*a, **kw):
        opened.append(1)
        return real_open(*a, **kw)

    monkeypatch.setattr(share_gif.Image, "open", counting_open)
    frames = [header_only_png(1920, 1080)] * 100  # 100 × 1920 × 1080 ≈ 207 Mpx
    from structlog.testing import capture_logs

    with capture_logs() as logs:
        r = post(body(frames, width=1920, height=1080))
    assert r.status_code == 400
    assert r.json()["detail"] == "pixel_budget"
    assert opened == []
    assert [e["reason"] for e in logs if e["event"] == "memories.share.reject"] == [
        "pixel_budget"
    ]


def test_the_pixel_budget_admits_the_frontends_full_gif():
    assert share_gif.MAX_FRAMES * 540 * 960 <= share_gif.MAX_TOTAL_PIXELS
    with pytest.raises(share_gif.ShareGifError) as exc:
        share_gif.assemble_gif(
            json.dumps(
                body(
                    [header_only_png(540, 961)] * share_gif.MAX_FRAMES,
                    width=540,
                    height=961,
                )
            ).encode()
        )
    assert exc.value.code == "pixel_budget"


def test_a_body_that_is_not_json_is_rejected():
    assert post(b"frames=1").json()["detail"] == "bad_json"


def test_a_declared_body_over_the_cap_is_rejected_before_reading():
    r = post(
        body([png()]),
        headers={"Content-Length": str(share_gif.MAX_BODY_BYTES + 1)},
    )
    assert r.status_code == 413


def test_a_streamed_body_over_the_cap_is_rejected(monkeypatch):
    monkeypatch.setattr(share_gif, "MAX_BODY_BYTES", 1024)
    r = post(body([png()] * 20))
    assert r.status_code == 413


def test_a_gif_over_the_store_cap_is_rejected(monkeypatch):
    monkeypatch.setattr(exports, "MAX_BYTES", 10)
    r = post(body([png(), png(shade=90)]))
    assert r.status_code == 413
    assert len(exports.store) == 0


def test_assemble_gif_is_pure():
    data, frames = share_gif.assemble_gif(
        json.dumps(body([png(), png(shade=30), png(shade=60)])).encode()
    )
    assert frames == 3
    assert data.startswith(b"GIF89a")


def test_logs_carry_counts_and_codes_only(caplog):
    from structlog.testing import capture_logs

    with capture_logs() as logs:
        post(body([png(), png(shade=90)]))
        post(body([png(), png(width=60)]))
    events = [e for e in logs if e["event"].startswith("memories.share")]
    assert {e["event"] for e in events} == {
        "memories.share.gif",
        "memories.share.reject",
    }
    ok = next(e for e in events if e["event"] == "memories.share.gif")
    assert ok["frames"] == 2 and "size_kb" in ok and ok["outcome"] == "stored"
    bad = next(e for e in events if e["event"] == "memories.share.reject")
    assert bad["reason"] == "frame_size"
    for e in events:
        assert set(e) <= {
            "event",
            "log_level",
            "frames",
            "size_kb",
            "outcome",
            "reason",
            "evicted",
        }
