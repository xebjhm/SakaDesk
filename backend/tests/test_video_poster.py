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


def _shell_threads() -> list[threading.Thread]:
    return [
        t
        for t in threading.enumerate()
        if t.name == "video_poster_shell" and t.is_alive()
    ]


def test_a_hang_opens_the_breaker_and_bounds_threads(env):
    """One hang: the video is a crash suspect, Shell is off, one blocked thread at most."""
    video_poster.reset_for_tests()
    for t in _shell_threads():  # earlier tests' runners have been told to stop
        t.join(2)
    src, rel = _video(env)
    release = threading.Event()
    calls: list[str] = []

    def hang(path, size):
        calls.append(path.name)
        release.wait(10)
        return Image.new("RGB", (64, 64), (100, 100, 100))

    with (
        patch.object(win_shell_thumb, "available", return_value=True),
        patch.object(win_shell_thumb, "shell_thumbnail", side_effect=hang),
        patch.object(video_poster, "SHELL_TIMEOUT_S", 0.2),
        capture_logs() as logs,
    ):
        assert video_poster.generate_shell(src, rel) is None
        row = _row(rel)
        assert (row.poster, row.poster_source, row.reason) == (
            "failed",
            "shell",
            "shell_crash_suspect",
        )
        assert {
            "event": "video_poster_shell_off",
            "reason": "timeout",
            "hung_threads": 1,
            "log_level": "warning",
        } in logs
        assert logs[-1]["reason"] == "timeout"
        # the breaker: later videos make no Shell call and leave their rows alone
        others = [_video(env, f"{i}.mp4") for i in range(2, 6)]
        for s2, r2 in others:
            assert video_poster.generate_shell(s2, r2) is None
        assert calls == ["1.mp4"]
        assert media_meta.get_many([r for _, r in others]) == {}
        assert len(_shell_threads()) == 1  # the bound: only the hung one
        assert video_poster.shell_state() == {"off": True, "skipped": 4}
        assert sum(e["event"] == "video_poster_shell_off" for e in logs) == 1
        # the client capture still covers the hung video
        assert video_poster.ingest_client(src, rel, _bytes("JPEG"), "image/jpeg")[
            0
        ] == ("ready")
        assert (_row(rel).poster, _row(rel).poster_source) == ("ready", "client")
        release.set()
    # the hung thread was told to stop: it exits once the call returns
    for t in _shell_threads():
        t.join(2)
    assert _shell_threads() == []
    client_poster = video_poster.poster_path(src, rel)
    assert client_poster is not None and video_poster._source_of(client_poster) == (
        "client"
    )


def test_an_existing_poster_still_repairs_with_the_breaker_open(env, shell):
    src, rel = _video(env)
    assert video_poster.ingest_client(src, rel, _bytes("JPEG"), "image/jpeg")[0] == (
        "ready"
    )
    media_meta.clear()
    with patch.object(video_poster, "_shell_off", True):
        assert video_poster.generate_shell(src, rel) is not None
    assert _row(rel).poster == "ready"


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
    # 3 posters > cap: one is evicted down to CACHE_LOW_WATER (0.75 x cap)
    with patch.object(video_poster, "POSTER_CACHE_CAP_BYTES", int(one * 2.8)):
        for i, (src, rel) in enumerate(videos[1:], start=1):
            os.utime(env / "posters" / names[i - 1], ns=(i * 10**9, i * 10**9))
            assert (
                video_poster.ingest_client(src, rel, body, "image/jpeg")[0] == "ready"
            )
    alive = [(env / "posters" / n).exists() for n in names]
    assert alive == [False, False, True, True]


# --- repairing the meta row from an existing poster (I-3) ---------------------------------


def test_generate_shell_repairs_a_cleared_row(env, shell):
    src, rel = _video(env)
    assert video_poster.ingest_client(src, rel, _bytes("JPEG"), "image/jpeg")[0] == (
        "ready"
    )
    media_meta.clear()  # e.g. a media_meta.db reset: the poster file survives
    shell.order.clear()
    with capture_logs() as logs:
        out = video_poster.generate_shell(src, rel)
    assert out == video_poster.poster_path(src, rel)
    assert shell.order == []  # no Shell call
    row = _row(rel)
    assert (row.poster, row.poster_source, row.stat_key) == (
        "ready",
        "client",
        _key(src),
    )
    assert logs[-1] == {
        "event": "video_poster",
        "source": "client",
        "outcome": "repaired",
        "reason": None,
        "log_level": "info",
    }
    _no_path(logs)


@pytest.mark.parametrize("state", ["none", "failed", "pending"])
def test_generate_shell_repairs_a_disagreeing_row_with_the_files_source(
    env, shell, state
):
    src, rel = _video(env)
    assert video_poster.generate_shell(src, rel) is not None  # a Shell poster
    media_meta.set_poster(rel, _key(src), state, "client")
    shell.order.clear()
    assert video_poster.generate_shell(src, rel) is not None
    assert shell.order == []
    assert (_row(rel).poster, _row(rel).poster_source) == ("ready", "shell")


def test_a_ready_row_is_not_rewritten(env, shell):
    src, rel = _video(env)
    assert video_poster.generate_shell(src, rel) is not None
    with (
        patch.object(media_meta, "set_poster", side_effect=AssertionError),
        capture_logs() as logs,
    ):
        assert video_poster.generate_shell(src, rel) is not None
    assert not [e for e in logs if e.get("outcome") == "repaired"]


def test_ingest_exists_repairs_the_row(env, shell):
    src, rel = _video(env)
    assert video_poster.generate_shell(src, rel) is not None
    media_meta.set_poster(rel, _key(src), "failed", "shell")
    outcome, _ = video_poster.ingest_client(src, rel, _bytes("WEBP"), "image/webp")
    assert outcome == "exists"
    assert (_row(rel).poster, _row(rel).poster_source) == ("ready", "shell")


def test_ingest_exists_after_the_decode_repairs_the_row(env):
    """A poster written between the pre-check and the write lock: exists, row repaired."""
    src, rel = _video(env)
    real_decode = video_poster._decode_upload

    def decode_then_race(body):
        img = real_decode(body)
        with patch.object(media_meta, "set_poster"):  # the other writer's row is lost
            video_poster._store(Image.new("RGB", (64, 64)), rel, _stat(src), "shell")
        return img

    with patch.object(video_poster, "_decode_upload", side_effect=decode_then_race):
        outcome, _ = video_poster.ingest_client(src, rel, _bytes("JPEG"), "image/jpeg")
    assert outcome == "exists"
    assert (_row(rel).poster, _row(rel).poster_source) == ("ready", "shell")


def test_a_client_poster_during_a_shell_failure_stays_ready(env, shell):
    src, rel = _video(env)

    def client_then_fail(path, size):
        shell.order.append("shell")
        assert video_poster.ingest_client(src, rel, _bytes("JPEG"), "image/jpeg")[
            0
        ] == ("ready")
        return None  # the Shell then gives no frame

    with patch.object(win_shell_thumb, "shell_thumbnail", side_effect=client_then_fail):
        out = video_poster.generate_shell(src, rel)
    assert out is not None and video_poster._source_of(out) == "client"
    assert (_row(rel).poster, _row(rel).poster_source) == ("ready", "client")


def test_a_client_poster_during_a_shell_success_wins(env, shell):
    src, rel = _video(env)

    def client_then_frame(path, size):
        assert video_poster.ingest_client(src, rel, _bytes("JPEG"), "image/jpeg")[
            0
        ] == ("ready")
        return Image.new("RGB", (640, 360), (1, 200, 3))

    with patch.object(
        win_shell_thumb, "shell_thumbnail", side_effect=client_then_frame
    ):
        out = video_poster.generate_shell(src, rel)
    assert out is not None and video_poster._source_of(out) == "client"
    assert (_row(rel).poster, _row(rel).poster_source) == ("ready", "client")


def test_a_client_poster_during_a_hang_stays_ready(env):
    video_poster.reset_for_tests()
    src, rel = _video(env)
    release = threading.Event()

    def client_then_hang(path, size):
        assert video_poster.ingest_client(src, rel, _bytes("JPEG"), "image/jpeg")[
            0
        ] == ("ready")
        release.wait(10)
        return None

    with (
        patch.object(win_shell_thumb, "available", return_value=True),
        patch.object(win_shell_thumb, "shell_thumbnail", side_effect=client_then_hang),
        patch.object(video_poster, "SHELL_TIMEOUT_S", 0.2),
    ):
        assert video_poster.generate_shell(src, rel) is not None
        assert (_row(rel).poster, _row(rel).poster_source) == ("ready", "client")
        assert video_poster.shell_state()["off"] is True
        release.set()


def test_source_tag(env, shell):
    src, rel = _video(env)
    out = video_poster.generate_shell(src, rel)
    assert out is not None and video_poster._source_of(out) == "shell"
    plain = env / "plain.webp"
    Image.new("RGB", (8, 8)).save(plain, format="WEBP")
    assert video_poster._source_of(plain) == "client"  # untagged: the default
    exif = Image.Exif()
    exif[video_poster.SOURCE_TAG] = "SakaDesk poster:other"
    Image.new("RGB", (8, 8)).save(plain, format="WEBP", exif=exif.tobytes())
    assert video_poster._source_of(plain) == "client"
    assert video_poster._source_of(env / "gone.webp") == "client"


# --- M4 carry-overs ---------------------------------------------------------------------


def test_shell_state_never_waits_for_the_shell_lock():
    """The status endpoint reads it; the lock can be held for SHELL_TIMEOUT_S."""
    got: list[dict] = []
    with video_poster._shell_lock:
        t = threading.Thread(target=lambda: got.append(video_poster.shell_state()))
        t.start()
        t.join(1)
        assert not t.is_alive()
    assert got == [{"off": False, "skipped": 0}]


def test_disable_shell_opens_the_breaker_once(env):
    src, rel = _video(env)
    with capture_logs() as logs:
        video_poster.disable_shell("pregen_watchdog")
        video_poster.disable_shell("pregen_watchdog")
    assert video_poster.shell_state()["off"] is True
    assert [e for e in logs if e["event"] == "video_poster_shell_off"] == [
        {
            "event": "video_poster_shell_off",
            "reason": "pregen_watchdog",
            "hung_threads": 0,
            "log_level": "warning",
        }
    ]
    with patch.object(win_shell_thumb, "available", return_value=True):
        assert video_poster.generate_shell(src, rel) is None
    assert media_meta.get_many([rel]) == {}


def test_client_upload_decodes_are_bounded(env):
    """A burst of uploads decodes at most UPLOAD_DECODE_SLOTS frames at once."""
    assert video_poster.UPLOAD_DECODE_SLOTS == 2
    active = 0
    peak = 0
    lock = threading.Lock()
    gate = threading.Event()
    real = video_poster._decode_upload

    def slow(body):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        gate.wait(0.3)
        try:
            return real(body)
        finally:
            with lock:
                active -= 1

    videos = [_video(env, f"{i}.mp4") for i in range(6)]
    body = _bytes("JPEG", (64, 36))
    with patch.object(video_poster, "_decode_upload", side_effect=slow):
        threads = [
            threading.Thread(
                target=video_poster.ingest_client, args=(s, r, body, "image/jpeg")
            )
            for s, r in videos
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(5)
    assert peak == 2
    assert all(_row(r).poster == "ready" for _, r in videos)
