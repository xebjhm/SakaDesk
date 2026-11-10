"""``backend.services.video_poster``: Shell posters (fake Shell) and client uploads."""

from __future__ import annotations

import io
import os
import threading
from pathlib import Path
from unittest.mock import patch

import pytest
from PIL import Image
from structlog.testing import capture_logs

from backend.services import media_meta, photo_thumb, video_poster, win_shell_thumb

SECRET = "秘密の部屋"


@pytest.fixture(autouse=True)
def env(tmp_path):
    photo_thumb.reset_cache_state()
    media_meta.set_db_path(tmp_path / "cache" / media_meta.DB_NAME)
    with patch.object(video_poster, "poster_dir", return_value=tmp_path / "posters"):
        yield tmp_path
    media_meta.set_db_path(None)
    photo_thumb.reset_cache_state()
    video_poster.reset_for_tests()


def _video(tmp_path: Path, name: str = "1.mp4") -> tuple[Path, str]:
    src = tmp_path / "out" / SECRET / "video" / name
    src.parent.mkdir(parents=True, exist_ok=True)
    src.write_bytes(b"\x00\x00\x00\x18ftypmp42" + name.encode())
    return src, f"{SECRET}/video/{name}"


def _row(rel: str) -> media_meta.MetaRow:
    return media_meta.get_many([rel])[rel]


def _key(src: Path) -> str:
    return media_meta.stat_key_of(src.stat())


def _bytes(fmt: str, size=(800, 450), color=(200, 100, 50)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format=fmt)
    return buf.getvalue()


def _no_path(logs: list[dict]) -> None:
    text = repr(logs)
    assert SECRET not in text and "1.mp4" not in text and "video/" not in text


# --- names and lookup -----------------------------------------------------------------


def test_constants():
    assert video_poster.POSTER_CACHE_CAP_BYTES == 256 * 1024**2
    assert video_poster.POSTER_PX == 640
    assert video_poster.POSTER_UPLOAD_MAX_BYTES == 1024**2
    assert video_poster.UPLOAD_MAX_PIXELS == 16_000_000
    assert video_poster.UPLOAD_FORMATS == ("WEBP", "JPEG", "PNG")
    assert video_poster.SHELL_TIMEOUT_S == 20


def test_poster_name_is_a_hash_of_the_version():
    a = video_poster.poster_name("x/1.mp4", 10, 20)
    assert a.endswith(".webp") and len(a) == 64 + 5 and "1.mp4" not in a
    assert a != video_poster.poster_name("x/1.mp4", 10, 21)
    assert a != video_poster.poster_name("x/2.mp4", 10, 20)


def test_default_poster_dir_is_beside_the_thumbnails():
    with patch.object(video_poster, "poster_dir", video_poster._default_poster_dir):
        assert video_poster.poster_dir() == (
            photo_thumb.cache_dir().parent / "video_posters"
        )


def test_poster_path_none_when_absent_or_unstatable(env):
    src, rel = _video(env)
    assert video_poster.poster_path(src, rel) is None
    assert video_poster.poster_path(env / "gone.mp4", rel) is None


# --- generate_shell -------------------------------------------------------------------


class Recorder:
    def __init__(self, img: Image.Image | None):
        self.img = img
        self.order: list[str] = []
        self.threads: list[str] = []

    def shell(self, path, size):
        self.order.append("shell")
        self.threads.append(threading.current_thread().name)
        assert size == video_poster.POSTER_PX
        return self.img


@pytest.fixture
def shell(env):
    rec = Recorder(Image.new("RGB", (1280, 720), (30, 160, 90)))
    real_pending = media_meta.mark_poster_pending

    def pending(rel, key):
        rec.order.append("pending")
        real_pending(rel, key)
        assert _row(rel).poster == "pending"  # committed before the call

    with (
        patch.object(win_shell_thumb, "available", return_value=True),
        patch.object(win_shell_thumb, "shell_thumbnail", side_effect=rec.shell),
        patch.object(media_meta, "mark_poster_pending", side_effect=pending),
    ):
        yield rec


def test_generate_shell_writes_a_bounded_webp(env, shell):
    src, rel = _video(env)
    with capture_logs() as logs:
        out = video_poster.generate_shell(src, rel)
    assert out is not None and out.parent == env / "posters"
    assert out.name == video_poster.poster_name(rel, *_stat(src))
    with Image.open(out) as img:
        assert img.format == "WEBP" and max(img.size) == 640 and img.size == (640, 360)
    assert shell.order == ["pending", "shell"]
    assert shell.threads[0].startswith("video_poster_shell")
    row = _row(rel)
    assert (row.poster, row.poster_source, row.stat_key) == (
        "ready",
        "shell",
        _key(src),
    )
    assert video_poster.poster_path(src, rel) == out
    assert {
        "event": "video_poster",
        "source": "shell",
        "outcome": "ready",
        "reason": None,
        "log_level": "info",
    } in logs
    _no_path(logs)


def _stat(src: Path) -> tuple[int, int]:
    st = src.stat()
    return st.st_size, st.st_mtime_ns


def test_generate_shell_keeps_a_small_frame_small(env, shell):
    shell.img = Image.new("RGB", (320, 240), (90, 90, 90))
    src, rel = _video(env)
    out = video_poster.generate_shell(src, rel)
    assert out is not None
    with Image.open(out) as img:
        assert img.size == (320, 240)


def test_generate_shell_failure_ends_failed(env, shell):
    shell.img = None
    src, rel = _video(env)
    with capture_logs() as logs:
        assert video_poster.generate_shell(src, rel) is None
    row = _row(rel)
    assert (row.poster, row.poster_source) == ("failed", "shell")
    assert not (env / "posters").exists() or not any((env / "posters").iterdir())
    # the Shell module logs its own reason; generate_shell adds no second event
    assert not [e for e in logs if e["event"] == "video_poster"]


def test_generate_shell_reuses_an_existing_poster(env, shell):
    src, rel = _video(env)
    first = video_poster.generate_shell(src, rel)
    shell.order.clear()
    assert video_poster.generate_shell(src, rel) == first
    assert shell.order == []


def test_generate_shell_unavailable_does_nothing(env):
    src, rel = _video(env)
    with (
        patch.object(win_shell_thumb, "available", return_value=False),
        patch.object(win_shell_thumb, "shell_thumbnail", side_effect=AssertionError),
    ):
        assert video_poster.generate_shell(src, rel) is None
    assert media_meta.get_many([rel]) == {}


def test_generate_shell_missing_source(env, shell):
    assert video_poster.generate_shell(env / "gone.mp4", "gone.mp4") is None
    assert shell.order == []


def test_generate_shell_refuses_a_non_video(env, shell):
    pic = env / "a.jpg"
    pic.write_bytes(_bytes("JPEG"))
    assert video_poster.generate_shell(pic, "a.jpg") is None
    assert shell.order == []


def test_generate_shell_times_out_on_a_hung_handler(env):
    src, rel = _video(env)
    release = threading.Event()
    calls: list[int] = []

    def hang(path, size):
        calls.append(1)
        if len(calls) == 1:
            release.wait(10)
            return Image.new("RGB", (64, 64), (100, 100, 100))
        return Image.new("RGB", (64, 64), (120, 120, 120))

    with (
        patch.object(win_shell_thumb, "available", return_value=True),
        patch.object(win_shell_thumb, "shell_thumbnail", side_effect=hang),
        patch.object(video_poster, "SHELL_TIMEOUT_S", 0.2),
        capture_logs() as logs,
    ):
        assert video_poster.generate_shell(src, rel) is None
        row = _row(rel)
        assert (row.poster, row.poster_source) == ("failed", "shell")
        assert logs[-1]["reason"] == "timeout"
        # the hung thread is abandoned: the next video gets a fresh runner
        src2, rel2 = _video(env, "2.mp4")
        assert video_poster.generate_shell(src2, rel2) is not None
        release.set()
    assert video_poster.poster_path(src, rel) is None  # the late frame is dropped


def test_generate_shell_write_failure_leaves_it_retryable(env, shell):
    src, rel = _video(env)
    with (
        patch.object(photo_thumb, "_write", side_effect=OSError("disk full")),
        capture_logs() as logs,
    ):
        assert video_poster.generate_shell(src, rel) is None
    assert _row(rel).poster == "none"
    assert logs[-1]["reason"] == "write_failed"


def test_shell_runner_enters_background_mode_and_com(env, shell):
    src, rel = _video(env)
    entered: list[str] = []
    with (
        patch(
            "backend.services.low_priority.enter_background_mode",
            side_effect=lambda: entered.append("bg") or False,
        ),
    ):
        video_poster.reset_for_tests()
        assert video_poster.generate_shell(src, rel) is not None
    assert entered == ["bg"]


def test_shell_runner_survives_an_exception(env):
    src, rel = _video(env)
    with (
        patch.object(win_shell_thumb, "available", return_value=True),
        patch.object(win_shell_thumb, "shell_thumbnail", side_effect=RuntimeError),
        capture_logs() as logs,
    ):
        assert video_poster.generate_shell(src, rel) is None
    assert _row(rel).poster == "failed"
    assert logs[-1]["reason"] == "error" and logs[-1]["error_type"] == "RuntimeError"


# --- ingest_client ----------------------------------------------------------------------


@pytest.mark.parametrize("fmt, ctype", [("WEBP", "image/webp"), ("JPEG", "image/jpeg")])
def test_ingest_accepts_and_reencodes(env, fmt, ctype):
    src, rel = _video(env)
    body = _bytes(fmt, (1280, 720))
    with capture_logs() as logs:
        outcome, v = video_poster.ingest_client(src, rel, body, ctype)
    assert outcome == "ready"
    assert v == photo_thumb.version_token(*_stat(src))
    out = video_poster.poster_path(src, rel)
    assert out is not None
    stored = out.read_bytes()
    assert stored != body
    with Image.open(out) as img:
        assert img.format == "WEBP" and img.size == (640, 360)
    row = _row(rel)
    assert (row.poster, row.poster_source) == ("ready", "client")
    assert {
        "event": "video_poster",
        "source": "client",
        "outcome": "ready",
        "reason": None,
        "log_level": "info",
    } in logs
    _no_path(logs)


def test_ingest_accepts_a_content_type_with_parameters(env):
    src, rel = _video(env)
    body = _bytes("JPEG")
    assert video_poster.ingest_client(src, rel, body, "Image/JPEG; q=1")[0] == "ready"


def test_ingest_flattens_transparency(env):
    src, rel = _video(env)
    buf = io.BytesIO()
    Image.new("RGBA", (40, 30), (0, 0, 0, 0)).save(buf, format="WEBP", lossless=True)
    assert (
        video_poster.ingest_client(src, rel, buf.getvalue(), "image/webp")[0] == "ready"
    )
    out = video_poster.poster_path(src, rel)
    assert out is not None
    with Image.open(out) as img:
        assert img.convert("RGB").getpixel((5, 5)) == (255, 255, 255)


def test_second_upload_is_exists(env):
    src, rel = _video(env)
    body = _bytes("WEBP")
    assert video_poster.ingest_client(src, rel, body, "image/webp")[0] == "ready"
    first = video_poster.poster_path(src, rel)
    assert first is not None
    before = first.read_bytes()
    with capture_logs() as logs:
        outcome, v = video_poster.ingest_client(
            src, rel, _bytes("WEBP", color=(1, 2, 3)), "image/webp"
        )
    assert outcome == "exists" and v == photo_thumb.version_token(*_stat(src))
    assert first.read_bytes() == before
    assert logs[-1]["outcome"] == "exists"


def _jpeg_with_header_size(w: int, h: int) -> bytes:
    data = bytearray(_bytes("JPEG", (16, 16)))
    sof = data.index(b"\xff\xc0")
    data[sof + 5 : sof + 7] = h.to_bytes(2, "big")
    data[sof + 7 : sof + 9] = w.to_bytes(2, "big")
    return bytes(data)


def _gif() -> bytes:
    buf = io.BytesIO()
    Image.new("P", (10, 10)).save(buf, format="GIF")
    return buf.getvalue()


class Decoded(BaseException):
    """Raised if a refused upload were decoded (escapes ``except Exception``)."""


EPS = b"%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\nshowpage\n"


@pytest.mark.parametrize(
    "body, ctype",
    [
        (_bytes("WEBP"), "image/png"),
        (_bytes("PNG"), "image/png"),
        (_gif(), "image/webp"),
        (EPS, "image/jpeg"),
        (b"garbage", "image/jpeg"),
        (_jpeg_with_header_size(4096, 4000), "image/jpeg"),  # 16.4 MP: pixel bound
        (_jpeg_with_header_size(5000, 10), "image/jpeg"),  # side bound
        (_jpeg_with_header_size(10, 4097), "image/jpeg"),
        (_bytes("JPEG"), ""),
    ],
    ids=[
        "png-type-webp-bytes",
        "png",
        "gif",
        "eps",
        "garbage",
        "header-bomb",
        "wide",
        "tall",
        "no-type",
    ],
)
def test_ingest_refuses_bad_images(env, body, ctype):
    src, rel = _video(env)
    with (
        patch.object(Image.Image, "load", side_effect=Decoded),
        capture_logs() as logs,
    ):
        outcome, v = video_poster.ingest_client(src, rel, body, ctype)
    assert (outcome, v) == ("bad_image", None)
    assert video_poster.poster_path(src, rel) is None
    assert logs[-1]["event"] == "video_poster" and logs[-1]["outcome"] == "failed"
    assert media_meta.get_many([rel]) == {}
    _no_path(logs)


def test_ingest_refuses_an_over_limit_body(env):
    src, rel = _video(env)
    body = b"\xff" * (video_poster.POSTER_UPLOAD_MAX_BYTES + 1)
    assert video_poster.ingest_client(src, rel, body, "image/jpeg") == (
        "too_large",
        None,
    )


def test_ingest_refuses_a_non_video_target(env):
    pic = env / "out" / "a.jpg"
    pic.parent.mkdir(parents=True, exist_ok=True)
    pic.write_bytes(_bytes("JPEG"))
    assert video_poster.ingest_client(pic, "a.jpg", _bytes("JPEG"), "image/jpeg") == (
        "not_video",
        None,
    )


def test_ingest_missing_target(env):
    gone = env / "out" / "gone.mp4"
    assert video_poster.ingest_client(
        gone, "gone.mp4", _bytes("JPEG"), "image/jpeg"
    ) == (
        "missing",
        None,
    )


def test_ingest_write_failure(env):
    src, rel = _video(env)
    with (
        patch.object(photo_thumb, "_write", side_effect=OSError("disk full")),
        capture_logs() as logs,
    ):
        assert video_poster.ingest_client(src, rel, _bytes("JPEG"), "image/jpeg") == (
            "write_failed",
            None,
        )
    assert logs[-1]["reason"] == "write_failed"
    assert media_meta.get_many([rel]) == {}


# --- the bounded cache ------------------------------------------------------------------


def test_the_poster_cache_evicts_the_oldest(env):
    body = _bytes("JPEG", (640, 360))
    videos = [_video(env, f"{i}.mp4") for i in range(4)]
    src, rel = videos[0]
    assert video_poster.ingest_client(src, rel, body, "image/jpeg")[0] == "ready"
    names = [video_poster.poster_name(r, *_stat(s)) for s, r in videos]
    one = (env / "posters" / names[0]).stat().st_size
    with patch.object(video_poster, "POSTER_CACHE_CAP_BYTES", int(one * 2.5)):
        for i, (src, rel) in enumerate(videos[1:], start=1):
            os.utime(env / "posters" / names[i - 1], ns=(i * 10**9, i * 10**9))
            assert (
                video_poster.ingest_client(src, rel, body, "image/jpeg")[0] == "ready"
            )
    alive = [(env / "posters" / n).exists() for n in names]
    assert alive == [False, False, True, True]
