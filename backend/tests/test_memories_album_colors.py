"""Album colour ribbon (``backend/services/memories/album_colors.py``)."""

from __future__ import annotations

import os
import warnings
from pathlib import Path

import pytest
from PIL import Image
from structlog.testing import capture_logs

from backend.services.memories import album_colors as ac
from backend.services.memories import index as mi
from backend.services.memories import people
from backend.tests.memories_archive import msg, write_room

SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
ROOM = "messages/34 金村 美玖/58 金村 美玖"

RED = (220, 30, 30)
BLUE = (30, 60, 200)
GREEN = (40, 180, 60)


def jpeg(path: Path, color, size=(120, 90)) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, color).save(path, "JPEG", quality=95)
    return path


def png(path: Path, color, size) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, color).save(path, "PNG")
    return path


def is_reddish(hex_: str) -> bool:
    r, g, b = (int(hex_[i : i + 2], 16) for i in (1, 3, 5))
    return r > 150 and g < 90 and b < 90


def log_values(logs) -> str:
    return " ".join(str(v) for entry in logs for v in entry.values())


# --- probe_image --------------------------------------------------------------------


def test_probe_red_jpeg_is_reddish(tmp_path):
    p = ac.probe_image(jpeg(tmp_path / "red.jpg", RED, size=(400, 300)))
    assert p is not None
    assert (p.width, p.height, p.fmt) == (400, 300, "JPEG")
    assert p.rgb is not None and is_reddish(ac.hex_of(p.rgb))
    assert not ac.is_screenshot_like(p)


def test_probe_tall_png_is_screenshot_like(tmp_path):
    tall = ac.probe_image(png(tmp_path / "tall.png", BLUE, (100, 190)))
    assert tall is not None and tall.fmt == "PNG"
    assert ac.is_screenshot_like(tall)
    square = ac.probe_image(png(tmp_path / "sq.png", BLUE, (100, 100)))
    assert square is not None and not ac.is_screenshot_like(square)
    tall_jpeg = ac.probe_image(jpeg(tmp_path / "tall.jpg", BLUE, (100, 300)))
    assert tall_jpeg is not None and not ac.is_screenshot_like(tall_jpeg)


def test_probe_prefers_a_saturated_colour(tmp_path):
    # mostly white (value > 0.95) with a blue band: the blue wins
    img = Image.new("RGB", (100, 100), (250, 250, 250))
    img.paste(Image.new("RGB", (100, 30), BLUE), (0, 0))
    path = tmp_path / "band.png"
    img.save(path, "PNG")
    p = ac.probe_image(path)
    assert p is not None and p.rgb is not None
    r, g, b = p.rgb
    assert b > 150 and r < 90


def test_probe_grey_falls_back_to_most_frequent(tmp_path):
    p = ac.probe_image(png(tmp_path / "grey.png", (128, 128, 128), (50, 50)))
    assert p is not None and p.rgb == (128, 128, 128)


def test_probe_corrupt_file_is_none_and_logs_without_path(tmp_path):
    path = tmp_path / "秘密" / "broken.jpg"
    path.parent.mkdir()
    path.write_bytes(b"\xff\xd8\xff\xe0 not really a jpeg")
    with capture_logs() as logs:
        assert ac.probe_image(path) is None
    (skip,) = [e for e in logs if e["event"] == "memories_skip"]
    assert skip["view"] == "album_color" and skip["reason"] == "unreadable"
    assert skip["error_type"]
    text = log_values(logs)
    assert "broken" not in text and "秘密" not in text and str(tmp_path) not in text


def test_probe_decompression_bomb_is_none(tmp_path, monkeypatch):
    path = jpeg(tmp_path / "big.jpg", RED, size=(400, 300))
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1000)
    with capture_logs() as logs:
        assert ac.probe_image(path) is None
    (skip,) = [e for e in logs if e["event"] == "memories_skip"]
    assert skip["error_type"] == "DecompressionBombError"


def test_probe_bounds_non_jpeg_pixels(tmp_path, monkeypatch):
    path = png(tmp_path / "wide.png", RED, (300, 300))
    monkeypatch.setattr(ac, "PROBE_MAX_PIXELS", 10_000)
    with capture_logs() as logs:
        assert ac.probe_image(path) is None
    (skip,) = [e for e in logs if e["event"] == "memories_skip"]
    assert skip["error_type"] == "DecompressionBombError"


def test_probe_bomb_warning_band_is_an_error(tmp_path, monkeypatch):
    # 120 000 px: over MAX_IMAGE_PIXELS but under twice it, where Pillow only
    # warns; the probe turns that warning into a refusal
    path = jpeg(tmp_path / "band.jpg", RED, size=(400, 300))
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 100_000)
    with warnings.catch_warnings(record=True) as seen:
        warnings.simplefilter("always")
        with capture_logs() as logs:
            assert ac.probe_image(path) is None
    (skip,) = [e for e in logs if e["event"] == "memories_skip"]
    assert skip["error_type"] == "DecompressionBombWarning"
    assert skip["reason"] == "unreadable"
    assert not [w for w in seen if w.category is Image.DecompressionBombWarning]


def test_probe_mpo_uses_draft(tmp_path, monkeypatch):
    from PIL import JpegImagePlugin

    path = tmp_path / "phone.jpg"
    frame = Image.new("RGB", (400, 300), RED)
    frame.save(path, "MPO", save_all=True, append_images=[frame])
    drafts: list[str] = []
    real = JpegImagePlugin.JpegImageFile.draft

    def spy(self, mode, size):
        drafts.append(self.format)
        return real(self, mode, size)

    monkeypatch.setattr(JpegImagePlugin.JpegImageFile, "draft", spy)
    p = ac.probe_image(path)
    assert p is not None and p.fmt == "MPO" and drafts == ["MPO"]
    assert p.rgb is not None and is_reddish(ac.hex_of(p.rgb))
    # MPO is bounded like JPEG (draft), not by the non-draft pixel bound
    monkeypatch.setattr(ac, "PROBE_MAX_PIXELS", 10)
    assert ac.probe_image(path) is not None


def test_probe_open_failure_is_transient(tmp_path):
    with capture_logs() as logs:
        probe, cacheable = ac._probe_image(tmp_path / "gone.jpg")
    assert probe is None and cacheable is False
    (skip,) = [e for e in logs if e["event"] == "memories_skip"]
    assert skip["reason"] == "unavailable"
    assert skip["error_type"] == "FileNotFoundError"


def test_probe_permission_error_while_reading_is_transient(tmp_path, monkeypatch):
    path = jpeg(tmp_path / "locked.jpg", RED)

    def locked(fh):
        raise PermissionError("sharing violation")

    monkeypatch.setattr(ac, "_decode", locked)
    with capture_logs() as logs:
        assert ac._probe_image(path) == (None, False)
    (skip,) = [e for e in logs if e["event"] == "memories_skip"]
    assert skip["reason"] == "unavailable"


# --- month_color --------------------------------------------------------------------


def test_month_color_majority_bucket_average():
    rgbs = [(10, 200, 10), (250, 0, 0), (254, 4, 4), (12, 198, 12), (252, 2, 2)]
    assert ac.month_color(rgbs) == "#fc0202"


def test_month_color_tie_goes_to_the_earlier_photo():
    # two buckets of two: the first input (higher score) decides
    rgbs = [(10, 200, 10), (250, 0, 0), (254, 4, 4), (12, 198, 12)]
    assert ac.month_color(rgbs) == "#0bc70b"
    red_first = [(250, 0, 0), (10, 200, 10), (12, 198, 12), (254, 4, 4)]
    assert ac.month_color(red_first) == "#fc0202"


def test_month_color_empty_is_none():
    assert ac.month_color([]) is None


# --- probes (cache) ------------------------------------------------------------------


@pytest.fixture
def svc(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    out = tmp_path / "out"
    sdir = out / SVC_NAME
    sdir.mkdir(parents=True)
    monkeypatch.setattr(people, "output_dir", lambda: out)
    return sdir


@pytest.fixture
def counted(monkeypatch):
    calls: list[str] = []
    real = ac._probe_image

    def spy(path):
        calls.append(path.name)
        return real(path)

    monkeypatch.setattr(ac, "_probe_image", spy)
    return calls


@pytest.mark.asyncio
async def test_probes_cache_hit_skips_pillow(svc, counted):
    jpeg(svc / ROOM / "picture" / "1.jpg", RED)
    jpeg(svc / ROOM / "picture" / "2.jpg", BLUE)
    files = [f"{ROOM}/picture/1.jpg", f"{ROOM}/picture/2.jpg"]
    with capture_logs() as logs:
        first = await ac.probes(svc, files)
    assert counted == ["1.jpg", "2.jpg"]
    assert all(first[f] is not None for f in files)
    (log,) = [e for e in logs if e["event"] == "memories_album_probe"]
    assert (log["hits"], log["probed"], log["failed"]) == (0, 2, 0)
    counted.clear()
    with capture_logs() as logs:
        second = await ac.probes(svc, files)
    assert counted == []
    assert second == first
    (log,) = [e for e in logs if e["event"] == "memories_album_probe"]
    assert (log["hits"], log["probed"]) == (2, 0)


@pytest.mark.asyncio
async def test_probes_changed_mtime_reprobes(svc, counted):
    path = jpeg(svc / ROOM / "picture" / "1.jpg", RED)
    rel = f"{ROOM}/picture/1.jpg"
    await ac.probes(svc, [rel])
    jpeg(path, BLUE)
    st = path.stat()
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    counted.clear()
    again = await ac.probes(svc, [rel])
    assert counted == ["1.jpg"]
    p = again[rel]
    assert p is not None and p.rgb is not None and p.rgb[2] > 150


@pytest.mark.asyncio
async def test_probes_outside_or_absent_is_none(svc, counted, tmp_path):
    jpeg(tmp_path / "outside.jpg", RED)
    files = ["../../outside.jpg", f"{ROOM}/picture/missing.jpg"]
    with capture_logs() as logs:
        got = await ac.probes(svc, files)
    assert got == {f: None for f in files}
    assert counted == []
    (log,) = [e for e in logs if e["event"] == "memories_album_probe"]
    assert log["missing"] == 2
    assert "outside" not in log_values(logs)


@pytest.mark.asyncio
async def test_probes_failure_is_cached(svc, counted):
    bad = svc / ROOM / "picture" / "3.jpg"
    bad.parent.mkdir(parents=True)
    bad.write_bytes(b"junk")
    rel = f"{ROOM}/picture/3.jpg"
    with capture_logs() as logs:
        assert await ac.probes(svc, [rel]) == {rel: None}
    (log,) = [e for e in logs if e["event"] == "memories_album_probe"]
    assert log["failed"] == 1
    counted.clear()
    assert await ac.probes(svc, [rel]) == {rel: None}
    assert counted == []  # a broken file is not decoded again


@pytest.mark.asyncio
async def test_probes_runs_in_batches(svc, counted, monkeypatch):
    monkeypatch.setattr(ac, "PROBE_BATCH", 2)
    batches: list[int] = []
    real = ac._probe_batch

    def spy(paths):
        batches.append(len(paths))
        return real(paths)

    monkeypatch.setattr(ac, "_probe_batch", spy)
    files = []
    for i in range(5):
        jpeg(svc / ROOM / "picture" / f"{i}.jpg", RED)
        files.append(f"{ROOM}/picture/{i}.jpg")
    await ac.probes(svc, files)
    assert batches == [2, 2, 1]
    assert ac.PROBE_BATCH_DEFAULT == 64


@pytest.mark.asyncio
async def test_probes_empty_list(svc):
    assert await ac.probes(svc, []) == {}


@pytest.mark.asyncio
async def test_probes_db_error_degrades(svc, counted, monkeypatch):
    jpeg(svc / ROOM / "picture" / "1.jpg", RED)
    rel = f"{ROOM}/picture/1.jpg"

    def boom():
        import sqlite3

        raise sqlite3.OperationalError("locked")

    monkeypatch.setattr(ac.mi, "_connect", boom)
    with capture_logs() as logs:
        got = await ac.probes(svc, [rel])
    assert got[rel] is not None  # still probed, just not cached
    ops = {e["op"] for e in logs if e["event"] == "memories_album_probe_failed"}
    assert ops == {"read", "write"}


@pytest.mark.asyncio
async def test_probes_unreadable_dir_is_none(svc, monkeypatch, counted):
    from backend.services.archive_urls import ArchiveReadError

    def bad(root, path):
        raise ArchiveReadError("unreadable")

    monkeypatch.setattr(ac, "archive_file_ok", bad)
    assert await ac.probes(svc, ["x.jpg"]) == {"x.jpg": None}


# --- month_colors_for -----------------------------------------------------------------


def pic(i, ts, *, fav=False, content="", type_="picture", ext="jpg"):
    return msg(
        i,
        ts,
        type_,
        content=content,
        fav=fav,
        media_file=f"{ROOM}/{type_}/{i}.{ext}".replace("/", "\\"),
    )


@pytest.mark.asyncio
async def test_month_colors_for(svc, counted, monkeypatch):
    from backend.services.memories import oshi as oshi_mod

    async def no_oshi(service):
        return set()

    monkeypatch.setattr(oshi_mod, "oshi_names", no_oshi)
    write_room(
        svc,
        "34 金村 美玖",
        "58 金村 美玖",
        [
            # 2024-09: two red, one favourited blue (highest score)
            pic(1, "2024-09-01T03:00:00Z"),
            pic(2, "2024-09-05T03:00:00Z"),
            pic(3, "2024-09-09T03:00:00Z", fav=True),
            # a video and a promo picture are never sampled
            pic(4, "2024-09-12T03:00:00Z", type_="video", ext="mp4"),
            pic(5, "2024-09-20T03:00:00Z", content="https://example.jp/shop"),
            # 2024-10: one unreadable picture -> null
            pic(6, "2024-10-02T03:00:00Z"),
            # 2024-11: 10 green pictures -> only 8 sampled
            *(pic(10 + k, f"2024-11-{k + 1:02d}T03:00:00Z") for k in range(10)),
            msg(99, "2024-12-01T03:00:00Z", content="テキストだけ"),
        ],
    )
    room = svc / ROOM
    jpeg(room / "picture" / "1.jpg", RED)
    jpeg(room / "picture" / "2.jpg", RED)
    jpeg(room / "picture" / "3.jpg", BLUE)
    jpeg(room / "picture" / "5.jpg", BLUE)
    (room / "picture" / "6.jpg").write_bytes(b"junk")
    for k in range(10):
        jpeg(room / "picture" / f"{10 + k}.jpg", GREEN)
    summary = (await mi.list_members(svc))[0]

    body = await ac.month_colors_for(SERVICE, svc, summary)
    colors = body["colors"]
    assert list(colors) == ["2024-09", "2024-10", "2024-11"]
    assert is_reddish(colors["2024-09"])  # 2 red beat 1 blue
    assert colors["2024-10"] is None
    g = colors["2024-11"]
    assert int(g[3:5], 16) > 120
    assert "4.mp4" not in counted and "5.jpg" not in counted
    assert len([c for c in counted if int(c.split(".")[0]) >= 10]) == 8

    counted.clear()
    with capture_logs() as logs:
        again = await ac.month_colors_for(SERVICE, svc, None)  # all members
    assert again == body
    assert counted == []  # the probe cache answers
    assert [e["outcome"] for e in logs if e["event"] == "memories_view_cache"] == [
        "miss"
    ]
    with capture_logs() as logs:
        await ac.month_colors_for(SERVICE, svc, None)
    assert [e["outcome"] for e in logs if e["event"] == "memories_view_cache"] == [
        "hit"
    ]


def test_dominant_of_an_empty_palette_is_none():
    class Empty:
        def getpalette(self):
            return None

        def getcolors(self):
            return None

    class Img:
        def quantize(self, colors):
            assert colors == 8
            return Empty()

    assert ac._dominant(Img()) is None  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_probes_cache_round_trips_a_colourless_probe(svc, monkeypatch):
    jpeg(svc / ROOM / "picture" / "1.jpg", RED)
    rel = f"{ROOM}/picture/1.jpg"
    blank = ac.ImageProbe(width=10, height=20, fmt="GIF", rgb=None)
    monkeypatch.setattr(ac, "_probe_image", lambda path: (blank, True))
    assert await ac.probes(svc, [rel]) == {rel: blank}

    def fail(path):
        raise AssertionError("must come from the cache")

    monkeypatch.setattr(ac, "_probe_image", fail)
    assert await ac.probes(svc, [rel]) == {rel: blank}


@pytest.mark.asyncio
async def test_probes_transient_failure_is_retried(svc, monkeypatch):
    jpeg(svc / ROOM / "picture" / "1.jpg", RED)
    rel = f"{ROOM}/picture/1.jpg"
    real = ac._probe_image
    monkeypatch.setattr(ac, "_probe_image", lambda path: (None, False))
    with capture_logs() as logs:
        assert await ac.probes(svc, [rel]) == {rel: None}
    (log,) = [e for e in logs if e["event"] == "memories_album_probe"]
    assert log["failed"] == 1
    monkeypatch.setattr(ac, "_probe_image", real)
    again = await ac.probes(svc, [rel])  # not cached: probed again, now fine
    assert again[rel] is not None


def _ribbon_room(svc, msgs):
    write_room(svc, "34 金村 美玖", "58 金村 美玖", msgs)
    return svc / ROOM


@pytest.mark.asyncio
async def test_ribbon_drops_screenshots(svc, monkeypatch):
    from backend.services.memories import oshi as oshi_mod

    async def no_oshi(service):
        return set()

    monkeypatch.setattr(oshi_mod, "oshi_names", no_oshi)
    room = _ribbon_room(
        svc,
        [
            # two tall blue PNG screenshots outnumber one red photo
            pic(1, "2024-09-01T03:00:00Z", ext="png"),
            pic(2, "2024-09-02T03:00:00Z", ext="png"),
            pic(3, "2024-09-03T03:00:00Z"),
        ],
    )
    png(room / "picture" / "1.png", BLUE, (100, 220))
    png(room / "picture" / "2.png", BLUE, (100, 220))
    jpeg(room / "picture" / "3.jpg", RED)
    body = await ac.month_colors_for(SERVICE, svc, None)
    assert is_reddish(body["colors"]["2024-09"])


@pytest.mark.asyncio
async def test_ribbon_recolours_after_media_repair(svc, monkeypatch):
    from backend.services.memories import oshi as oshi_mod

    async def no_oshi(service):
        return set()

    monkeypatch.setattr(oshi_mod, "oshi_names", no_oshi)
    room = _ribbon_room(svc, [pic(1, "2024-09-01T03:00:00Z")])
    (room / "picture").mkdir(parents=True, exist_ok=True)
    first = await ac.month_colors_for(SERVICE, svc, None)
    assert first == {"colors": {"2024-09": None}}  # the file is not there yet
    # media repair adds the file; messages.json is not rewritten
    jpeg(room / "picture" / "1.jpg", RED)
    st = (room / "picture").stat()
    os.utime(room / "picture", ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    again = await ac.month_colors_for(SERVICE, svc, None)
    assert is_reddish(again["colors"]["2024-09"])
