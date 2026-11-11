"""``backend.services.media_pregen``: the idle, throttled thumbnail pre-generation worker."""

from __future__ import annotations

import asyncio
import threading
import time
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from structlog.testing import capture_logs

from backend.services import (
    low_priority,
    media_meta,
    media_pregen,
    photo_thumb,
    shutdown_state,
    video_poster,
    win_shell_thumb,
)
from backend.services.media_pregen import Item, ItemResult, MediaPregen, Phase

HINATA = "hinatazaka46"
SAKURA = "sakurazaka46"
ROOM = "messages/34 金村 美玖/58 金村 美玖"
SECRET = "金村"


# --- fixtures -------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def env(tmp_path):
    photo_thumb.reset_cache_state()
    video_poster.reset_for_tests()
    media_meta.set_db_path(tmp_path / "cache" / media_meta.DB_NAME)
    media_pregen._reset_for_tests()
    with (
        patch.object(
            photo_thumb, "cache_dir", return_value=tmp_path / "cache" / "thumbs"
        ),
        patch.object(
            video_poster, "poster_dir", return_value=tmp_path / "cache" / "posters"
        ),
    ):
        yield tmp_path
    media_pregen._reset_for_tests()
    media_meta.set_db_path(None)
    photo_thumb.reset_cache_state()
    video_poster.reset_for_tests()
    shutdown_state.reset_for_tests()


@pytest.fixture
def out(tmp_path):
    root = tmp_path / "out"
    (root / "日向坂46" / ROOM).mkdir(parents=True)
    with patch("backend.api.content.get_output_dir", return_value=root):
        yield root


def _jpeg(path: Path, size=(800, 600), color=(10, 120, 200)) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, color).save(path, format="JPEG")
    return path


def _video(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x00\x00\x00\x18ftypmp42" + path.name.encode())
    return path


def _room(out: Path) -> Path:
    return out / "日向坂46" / ROOM


def _rel(out: Path, path: Path) -> str:
    return photo_thumb.archive_rel(out, path)


def _item(root: Path, name: str, widths=photo_thumb.PREGEN_WIDTHS) -> Item:
    kind = "video" if name.endswith(".mp4") else "picture"
    return Item(root, root / "日向坂46" / name, kind, tuple(widths))


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


class Harness:
    """Fake clock, sleep, busy predicate, enumeration and processing."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.clock = Clock()
        self.sleeps: list[float] = []
        self.on_sleep = None
        self.busy: str | None = None
        self.phases: dict[str, list[Phase]] = {}
        self.processed: list[str] = []
        self.threads: list[str] = []
        self.work = 0.0
        self.on_process = None

    async def sleep(self, s: float) -> None:
        self.sleeps.append(s)
        if self.on_sleep is not None:
            self.on_sleep(s)
        await asyncio.sleep(0)

    def is_busy(self) -> str | None:
        return self.busy

    async def enumerate(self, service: str, root: Path) -> list[Phase]:
        return self.phases.get(service, [])

    def process(self, item: Item) -> ItemResult:
        if self.on_process is not None:
            self.on_process(item)
        self.processed.append(item.path.name)
        self.threads.append(threading.current_thread().name)
        self.clock.t += self.work
        return ItemResult("done", 10)

    def make(self, services=(HINATA,), **kw) -> MediaPregen:
        args = dict(
            is_busy=self.is_busy,
            clock=self.clock,
            sleep=self.sleep,
            enumerate_fn=self.enumerate,
            process_fn=self.process,
            output_dir_fn=lambda: self.root,
        )
        args.update(kw)
        return MediaPregen(services, **args)


@pytest.fixture
def h(tmp_path):
    return Harness(tmp_path / "out")


async def _idle(p: MediaPregen) -> None:
    await asyncio.wait_for(p.wait_idle(), 10)


def _events(logs: list[dict], name: str) -> list[dict]:
    return [e for e in logs if e["event"] == name]


# --- constants ------------------------------------------------------------------------


def test_constants_are_the_plan_values():
    assert media_pregen.STARTUP_DELAY_S == 45
    assert media_pregen.IDLE_AFTER_S == 3.0
    assert media_pregen.POLL_PAUSED_S == 2.0
    assert media_pregen.PREGEN_BATCH == 8
    assert media_pregen.PREGEN_DUTY_SLEEP == 2.0
    assert media_pregen.PREGEN_MIN_PAUSE_S == 0.05
    assert media_pregen.PREGEN_FILL_RATIO == 0.85
    assert media_pregen.STOP_TIMEOUT_S == 5.0
    assert media_pregen.ALBUM_WARM_MONTHS == 3
    assert media_pregen.NEWEST_DAYS == 62
    assert media_pregen.HINTS_MAX == 2000


# --- order ----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_phases_run_in_order_and_a_requested_service_first(h):
    for service, tag in ((HINATA, "h"), (SAKURA, "s")):
        h.phases[service] = [
            Phase(
                "newest", [_item(h.root, f"{tag}n1.jpg"), _item(h.root, f"{tag}n2.jpg")]
            ),
            Phase("favorites", [_item(h.root, f"{tag}f1.jpg", (160, 320, 640))]),
            Phase("messages", [_item(h.root, f"{tag}m1.jpg")]),
            Phase("blogs", [], reason="not_available"),
        ]
    p = h.make((HINATA, SAKURA))
    with capture_logs() as logs:
        p.start()
        p.request(SAKURA)  # before the startup pass begins
        await _idle(p)
        await p.stop()
    assert h.processed == [
        "sn1.jpg", "sn2.jpg", "sf1.jpg", "sm1.jpg",
        "hn1.jpg", "hn2.jpg", "hf1.jpg", "hm1.jpg",
    ]  # fmt: skip
    passes = _events(logs, "media_pregen_pass")
    assert [(e["service"], e["phase"]) for e in passes] == [
        (SAKURA, "newest"),
        (SAKURA, "favorites"),
        (SAKURA, "messages"),
        (SAKURA, "blogs"),
        (HINATA, "newest"),
        (HINATA, "favorites"),
        (HINATA, "messages"),
        (HINATA, "blogs"),
    ]
    first = passes[0]
    assert (first["queued"], first["done"], first["skipped"], first["failed"]) == (
        2,
        2,
        0,
        0,
    )
    assert first["bytes"] == 20 and "elapsed_ms" in first
    assert passes[3]["reason"] == "not_available" and passes[3]["queued"] == 0
    assert p.status_snapshot()["services"] == {
        SAKURA: {"done": 4, "total": 4},
        HINATA: {"done": 4, "total": 4},
    }
    states = [e["state"] for e in _events(logs, "media_pregen_state")]
    assert states[0] == "running" and "idle" in states and states[-1] == "stopped"


@pytest.mark.asyncio
async def test_after_the_startup_pass_only_requests_run(h):
    h.phases[HINATA] = [Phase("newest", [_item(h.root, "a.jpg")])]
    h.phases[SAKURA] = [Phase("newest", [_item(h.root, "b.jpg")])]
    p = h.make((HINATA, SAKURA))
    p.start()
    await _idle(p)
    assert h.processed == ["b.jpg", "a.jpg"]  # the sync order: 櫻坂46 first
    p.request(HINATA)
    p.request("unknown")  # not a known service: ignored
    await asyncio.sleep(0)
    await _idle(p)
    assert h.processed == ["b.jpg", "a.jpg", "a.jpg"]
    await p.stop()


def _media_row(member, media_file, type_, ts, fav=False):
    from backend.services.memories.index import MediaRow

    return MediaRow(member, media_file, type_, ts, fav)


@pytest.mark.asyncio
async def test_default_enumerate_builds_the_phases(out):
    """Phase 0 warms the album (D4's warm_album) and adds the covers at 640."""
    from backend.services.memories import album
    from backend.services.memories import index as memory_index

    sdir = out / "日向坂46"
    rows = [  # as media_rows returns them: starred first, then newest
        _media_row(
            "a", "a/picture/fav.jpg", "picture", "2025-01-01T00:00:00+00:00", True
        ),
        _media_row("a", "a/picture/new.jpg", "picture", "2026-09-30T00:00:00+00:00"),
        _media_row("a", "a\\video\\new.mp4", "video", "2026-09-29T00:00:00+00:00"),
        _media_row("a", "a/picture/mid.jpg", "picture", "2026-08-01T00:00:00+00:00"),
        _media_row("a", "a/picture/old.jpg", "picture", "2026-06-01T00:00:00+00:00"),
        _media_row("a", "a/picture/cover.jpg", "picture", "2026-05-01T00:00:00+00:00"),
        _media_row("b", "b/picture/only.jpg", "picture", "2024-03-01T00:00:00+00:00"),
        _media_row("b", "b/picture/bad.jpg", "picture", "not a date"),
        _media_row("b", "b/voice/x.m4a", "picture", "2024-03-01T00:00:00+00:00"),
    ]
    warmed: list[tuple[str, Path]] = []

    async def warm(service, s):
        warmed.append((service, s))

    async def months(service, s, *, member, kind, texts=True):
        assert (member, kind, texts) == (None, "all", False)
        return {
            "months": [
                {"month": "2026-05", "cover": {"media_file": "a/picture/cover.jpg"}},
                {"month": "2026-04", "cover": {"media_file": None}},
                {"month": "2026-03", "cover": {}},
            ]
        }

    with (
        patch.object(memory_index, "media_rows", return_value=rows),
        patch.object(album, "warm_album", side_effect=warm),
        patch.object(album, "album_months", side_effect=months),
        capture_logs() as logs,
    ):
        phases = await media_pregen.default_enumerate(HINATA, out)
    assert warmed == [(HINATA, sdir)]
    names = {p.name: p for p in phases}
    assert [p.name for p in phases] == ["newest", "favorites", "messages", "blogs"]

    def shape(phase):
        return [
            (i.path.relative_to(sdir).as_posix(), i.kind, i.widths) for i in phase.items
        ]

    base = photo_thumb.PREGEN_WIDTHS
    big = base + (photo_thumb.LARGE_WIDTH,)
    assert shape(names["newest"]) == [
        ("a/picture/new.jpg", "picture", base),
        ("a/video/new.mp4", "video", base),
        ("a/picture/mid.jpg", "picture", base),
        ("b/picture/only.jpg", "picture", base),
        ("a/picture/cover.jpg", "picture", big),
    ]
    assert shape(names["favorites"]) == [("a/picture/fav.jpg", "picture", big)]
    assert shape(names["messages"]) == [
        ("a/picture/old.jpg", "picture", base),
        ("b/picture/bad.jpg", "picture", base),
    ]
    # Blog backup is off in the test settings: the blog phase is a logged no-op.
    assert names["blogs"].items == [] and names["blogs"].reason == "backup_off"
    assert all(i.root == out for p in phases for i in p.items)
    [warm_log] = _events(logs, "media_pregen_pass")
    assert warm_log["phase"] == "warm_album" and warm_log["queued"] == 1


@pytest.mark.asyncio
async def test_default_enumerate_without_media_or_service(out):
    from backend.services.memories import album
    from backend.services.memories import index as memory_index

    with (
        patch.object(memory_index, "media_rows", return_value=[]),
        patch.object(album, "warm_album", side_effect=AssertionError),
    ):
        assert await media_pregen.default_enumerate(HINATA, out) == []
        assert await media_pregen.default_enumerate("nope", out) == []


def _blog_image(out: Path, member: str, folder: str, name: str) -> tuple[Path, str]:
    from backend.services import archive_urls

    path = _jpeg(out / "日向坂46" / "blogs" / member / folder / "images" / name)
    url = archive_urls.media_url(HINATA, ["blogs", member, folder, "images", name])
    return path, url


@pytest.mark.asyncio
async def test_default_enumerate_blog_phase_comes_from_gallery_images(out):
    """M7: phase 4 is every cached blog image of the service (gallery_images(service, None))."""
    from backend.services import blog_service
    from backend.services.memories import index as memory_index

    new, new_url = _blog_image(out, SECRET + " 美玖", "20260205_b2", "img_0.jpg")
    old, old_url = _blog_image(out, SECRET + " 美玖", "20260103_b1", "img_0.jpg")
    (out / "日向坂46" / "blogs" / "x" / "a.txt").parent.mkdir(parents=True)
    (out / "日向坂46" / "blogs" / "x" / "a.txt").write_text("x", encoding="utf-8")
    images = [
        {"media_url": new_url},
        {"media_url": new_url},  # a duplicate: once
        {"media_url": old_url},
        {"media_url": "/api/content/media/hinatazaka46/../../../secret.jpg"},
        {"media_url": "/api/content/media/hinatazaka46/blogs/x/a.txt"},
    ]
    gallery = patch.object(blog_service, "gallery_images", return_value=images)
    with (
        patch.object(memory_index, "media_rows", return_value=[]),
        patch.object(blog_service, "blog_backup_enabled", side_effect=_on),
        gallery as called,
        capture_logs() as logs,
    ):
        phases = await media_pregen.default_enumerate(HINATA, out)
    called.assert_awaited_once_with(HINATA, None)
    [blogs] = phases
    assert blogs.name == "blogs" and blogs.reason is None
    assert [(i.path, i.kind, i.widths, i.root) for i in blogs.items] == [
        (new.resolve(), "picture", photo_thumb.PREGEN_WIDTHS, out),
        (old.resolve(), "picture", photo_thumb.PREGEN_WIDTHS, out),
    ]
    assert SECRET not in repr(logs)
    # The worker makes the blog image's thumbnail like any other picture.
    item = blogs.items[0]
    result = media_pregen.default_process(item)
    assert result.outcome == "done"
    st = item.path.stat()
    name = photo_thumb.variant_name(
        _rel(out, item.path), st.st_size, st.st_mtime_ns, photo_thumb.PREGEN_WIDTHS[0]
    )
    assert (photo_thumb.cache_dir() / name).is_file()


async def _on():
    return True


async def _off():
    return False


@pytest.mark.asyncio
async def test_blog_phase_with_messages_and_a_failed_gallery_read(out):
    from backend.services import blog_service
    from backend.services.memories import album
    from backend.services.memories import index as memory_index

    rows = [_media_row("a", "a/p/1.jpg", "picture", "2026-01-01T00:00:00+00:00")]

    async def warm(service, s):
        return None

    async def months(*a, **kw):
        return {"months": []}

    async def boom(service, member):
        raise RuntimeError(SECRET)

    with (
        patch.object(memory_index, "media_rows", return_value=rows),
        patch.object(album, "warm_album", side_effect=warm),
        patch.object(album, "album_months", side_effect=months),
        patch.object(blog_service, "blog_backup_enabled", side_effect=_on),
        patch.object(blog_service, "gallery_images", side_effect=boom),
        capture_logs() as logs,
    ):
        phases = await media_pregen.default_enumerate(HINATA, out)
    assert phases[-1].name == "blogs" and phases[-1].reason == "failed"
    assert phases[-1].items == []
    assert {
        "event": "media_pregen_blogs_failed",
        "service": HINATA,
        "error_type": "RuntimeError",
        "log_level": "warning",
    } in logs
    assert SECRET not in repr(logs)


@pytest.mark.asyncio
async def test_blog_phase_is_skipped_while_blog_backup_is_off(out):
    from backend.services import blog_service
    from backend.services.memories import index as memory_index

    _blog_image(out, "m", "20260205_b2", "img_0.jpg")
    with (
        patch.object(memory_index, "media_rows", return_value=[]),
        patch.object(blog_service, "blog_backup_enabled", side_effect=_off),
        patch.object(blog_service, "gallery_images", side_effect=AssertionError),
    ):
        assert await media_pregen.default_enumerate(HINATA, out) == []


@pytest.mark.asyncio
async def test_blog_items_are_built_off_the_event_loop(out):
    from backend.services import blog_service
    from backend.services.memories import index as memory_index

    _, url = _blog_image(out, "m", "20260205_b2", "img_0.jpg")
    loop_thread = threading.get_ident()
    seen: dict[str, int] = {}
    real = media_pregen._blog_items

    def items(*args):
        seen["thread"] = threading.get_ident()
        return real(*args)

    with (
        patch.object(memory_index, "media_rows", return_value=[]),
        patch.object(blog_service, "blog_backup_enabled", side_effect=_on),
        patch.object(blog_service, "gallery_images", return_value=[{"media_url": url}]),
        patch.object(media_pregen, "_blog_items", side_effect=items),
    ):
        phases = await media_pregen.default_enumerate(HINATA, out)
    assert len(phases[0].items) == 1
    assert seen["thread"] != loop_thread


@pytest.mark.asyncio
async def test_default_enumerate_survives_a_failed_cover_read(out):
    from backend.services.memories import album
    from backend.services.memories import index as memory_index

    rows = [_media_row("a", "a/p/1.jpg", "picture", "2026-01-01T00:00:00+00:00")]

    async def warm(service, s):
        return None

    with (
        patch.object(memory_index, "media_rows", return_value=rows),
        patch.object(album, "warm_album", side_effect=warm),
        patch.object(album, "album_months", side_effect=RuntimeError("x")),
        capture_logs() as logs,
    ):
        phases = await media_pregen.default_enumerate(HINATA, out)
    assert [i.path.name for i in phases[0].items] == ["1.jpg"]
    assert {
        "event": "media_pregen_warm_failed",
        "service": HINATA,
        "error_type": "RuntimeError",
        "log_level": "warning",
    } in logs


# --- hints ----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_hint_jumps_the_queue_at_the_next_batch_and_is_deduplicated(h):
    h.root.mkdir(parents=True)
    h.phases[HINATA] = [
        Phase("messages", [_item(h.root, f"{i:02d}.jpg") for i in range(12)])
    ]
    gate = threading.Event()
    entered = threading.Event()

    def first(item):
        if item.path.name == "00.jpg":
            entered.set()
            gate.wait(5)

    h.on_process = first
    p = h.make()
    p.start()
    await asyncio.wait_for(asyncio.to_thread(entered.wait, 5), 6)
    p.hint(HINATA, ["日向坂46/h1.jpg", "日向坂46/h1.jpg", "日向坂46/h2.mp4"])
    p.hint(HINATA, ["櫻坂46/x.jpg"])  # another service's folder: dropped
    p.hint("unknown", ["日向坂46/y.jpg"])  # unknown service: dropped
    p.hint(HINATA, ["日向坂46/z.txt"])  # neither picture nor video: dropped
    gate.set()
    await _idle(p)
    await p.stop()
    first_batch = [f"{i:02d}.jpg" for i in range(8)]
    assert h.processed[:8] == first_batch
    assert h.processed[8:10] == ["h1.jpg", "h2.mp4"]
    assert h.processed[10:] == ["08.jpg", "09.jpg", "10.jpg", "11.jpg"]


def test_hints_are_capped(h):
    p = h.make()
    p.hint(HINATA, [f"日向坂46/{i}.jpg" for i in range(media_pregen.HINTS_MAX + 500)])
    assert p.pending_hints() == media_pregen.HINTS_MAX


@pytest.mark.asyncio
async def test_a_hint_wakes_an_idle_worker(h):
    h.root.mkdir(parents=True)
    p = h.make()
    p.start()
    await _idle(p)
    assert h.processed == []
    p.hint(HINATA, ["日向坂46/late.jpg"])
    await asyncio.sleep(0)
    await _idle(p)
    assert h.processed == ["late.jpg"]
    await p.stop()


@pytest.mark.asyncio
async def test_a_video_waiting_for_its_poster_is_not_re_hinted_for_a_while(h):
    h.root.mkdir(parents=True)

    def waiting(item):
        return None

    calls: list[str] = []

    def process(item):
        calls.append(item.path.name)
        return ItemResult("waiting", rel=f"日向坂46/{item.path.name}")

    p = h.make(process_fn=process)
    p.start()
    await _idle(p)
    p.hint(HINATA, ["日向坂46/v.mp4"])
    await asyncio.sleep(0)
    await _idle(p)
    assert calls == ["v.mp4"]
    p.hint(HINATA, ["日向坂46/v.mp4"])  # cooling down: dropped
    assert p.pending_hints() == 0
    h.clock.t += media_pregen.HINT_COOLDOWN_S + 1
    p.hint(HINATA, ["日向坂46/v.mp4"])
    assert p.pending_hints() == 1
    await asyncio.sleep(0)
    await _idle(p)
    assert calls == ["v.mp4", "v.mp4"]
    await p.stop()


def test_the_cooldown_memo_is_bounded(h):
    p = h.make()
    with patch.object(media_pregen, "COOLDOWN_MAX", 3):
        for i in range(3):
            p._cool(f"r{i}")
        h.clock.t += media_pregen.HINT_COOLDOWN_S + 1
        p._cool("fresh")
        assert set(p._cooldown) == {"fresh"}
        p._cool("b")
        p._cool("c")
        p._cool("d")  # all recent: the oldest goes
        assert list(p._cooldown) == ["b", "c", "d"]


# --- pausing --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_sync_mid_pass_stops_new_batches_and_the_pass_resumes(h):
    h.phases[HINATA] = [
        Phase("messages", [_item(h.root, f"{i:02d}.jpg") for i in range(10)])
    ]
    polls: list[int] = []

    def go_busy(item):
        if item.path.name == "00.jpg":
            h.busy = "sync"

    def on_sleep(s):
        if s == media_pregen.POLL_PAUSED_S:
            polls.append(len(h.processed))
            h.clock.t += s
            if len(polls) == 3:
                h.busy = None

    h.on_process = go_busy
    h.on_sleep = on_sleep
    p = h.make()
    with capture_logs() as logs:
        p.start()
        await _idle(p)
        await p.stop()
    assert polls == [8, 8, 8]  # the in-flight batch finished; nothing new started
    assert len(h.processed) == 10
    pauses = _events(logs, "media_pregen_pause")
    assert pauses == [
        {
            "event": "media_pregen_pause",
            "state": "paused",
            "reason": "sync",
            "paused_ms": 0,
            "log_level": "info",
        },
        {
            "event": "media_pregen_pause",
            "state": "resumed",
            "reason": "sync",
            "paused_ms": 6000,
            "log_level": "info",
        },
    ]


@pytest.mark.asyncio
async def test_status_while_paused(h):
    h.phases[HINATA] = [Phase("messages", [_item(h.root, "a.jpg")])]
    h.busy = "blog_backup"
    seen: list[dict] = []

    def on_sleep(s):
        if s == media_pregen.POLL_PAUSED_S:
            seen.append(p.status_snapshot())
            h.busy = None

    h.on_sleep = on_sleep
    p = h.make()
    p.start()
    await _idle(p)
    await p.stop()
    assert seen[0]["state"] == "paused" and seen[0]["paused_reason"] == "blog_backup"
    assert p.status_snapshot()["state"] == "stopped"


@pytest.mark.asyncio
async def test_a_changed_pause_reason_is_one_more_transition(h):
    h.phases[HINATA] = [Phase("messages", [_item(h.root, "a.jpg")])]
    reasons = iter(["sync", "refresh", None])
    h.busy = "sync"

    def on_sleep(s):
        if s == media_pregen.POLL_PAUSED_S:
            h.busy = next(reasons)

    h.on_sleep = on_sleep
    p = h.make()
    with capture_logs() as logs:
        p.start()
        await _idle(p)
        await p.stop()
    pauses = [(e["state"], e["reason"]) for e in _events(logs, "media_pregen_pause")]
    assert pauses == [
        ("paused", "sync"),
        ("paused", "refresh"),
        ("resumed", "refresh"),
    ]


def test_default_is_busy_precedence(monkeypatch):
    from backend.services import blog_service, sync_coordinator
    from backend.services.memories import index as memory_index

    class Coord:
        busy_now = False

        def busy(self):
            return self.busy_now

    class Blogs:
        running: list[str] = []

        def running_services(self):
            return self.running

    coord, blogs = Coord(), Blogs()
    monkeypatch.setattr(sync_coordinator, "get_coordinator", lambda: coord)
    monkeypatch.setattr(blog_service, "get_blog_backup_manager", lambda: blogs)
    refresh = {"on": False}
    monkeypatch.setattr(memory_index, "any_refresh_pending", lambda: refresh["on"])
    clock = Clock()
    busy = lambda: media_pregen.default_is_busy(clock)  # noqa: E731

    assert busy() is None
    photo_thumb.cache_state_add(photo_thumb.cache_dir(), 900, 10**12)
    monkeypatch.setattr(photo_thumb, "CACHE_CAP_BYTES", 1000)
    assert busy() == "budget_full"
    media_pregen._last_foreground = clock()
    assert busy() == "foreground"
    clock.t += media_pregen.IDLE_AFTER_S + 0.01
    assert busy() == "budget_full"
    media_pregen._last_foreground = clock()
    blogs.running = [HINATA]
    assert busy() == "blog_backup"
    refresh["on"] = True
    assert busy() == "refresh"
    coord.busy_now = True
    assert busy() == "sync"
    shutdown_state.begin_shutdown()
    assert busy() == "shutdown"


@pytest.mark.asyncio
async def test_foreground_backoff_pauses_for_idle_after_s(h):
    h.phases[HINATA] = [Phase("messages", [_item(h.root, "a.jpg")])]
    polls: list[float] = []

    def on_sleep(s):
        if s == media_pregen.POLL_PAUSED_S:
            polls.append(s)
            h.clock.t += s

    h.on_sleep = on_sleep
    with patch.object(
        media_pregen, "default_is_busy", wraps=media_pregen.default_is_busy
    ):
        p = media_pregen.start(
            [HINATA],
            clock=h.clock,
            sleep=h.sleep,
            enumerate_fn=h.enumerate,
            process_fn=h.process,
            output_dir_fn=lambda: h.root,
        )
        media_pregen.note_foreground()
        with capture_logs() as logs:
            await _idle(p)
        await media_pregen.stop()
    assert polls == [2.0, 2.0]  # 4 s of quiet passes IDLE_AFTER_S (3 s)
    assert h.processed == ["a.jpg"]
    assert [e["reason"] for e in _events(logs, "media_pregen_pause")] == [
        "foreground",
        "foreground",
    ]


@pytest.mark.asyncio
async def test_budget_full_stops_adding_variants_but_keeps_working(h, monkeypatch):
    """At the fill line the worker never pauses: it runs on with no new variants
    (placeholders, posters and hints still get made) and logs the change once."""
    h.phases[HINATA] = [
        Phase("messages", [_item(h.root, "a.jpg"), _item(h.root, "b.mp4")])
    ]
    photo_thumb.cache_state_add(photo_thumb.cache_dir(), 900, 10**12)
    monkeypatch.setattr(photo_thumb, "CACHE_CAP_BYTES", 1000)
    seen: list[tuple[str, tuple[int, ...]]] = []
    h.on_process = lambda item: seen.append((item.path.name, item.widths))
    p = h.make(is_busy=None)
    with capture_logs() as logs:
        p.start()
        await _idle(p)
        # an eviction (or a clear) brings the cache back under the line
        monkeypatch.setattr(photo_thumb, "CACHE_CAP_BYTES", 10**12)
        p.hint(HINATA, ["日向坂46/c.jpg"])
        await asyncio.sleep(0)
        await _idle(p)
        await p.stop()
    assert seen == [("a.jpg", ()), ("b.mp4", ()), ("c.jpg", photo_thumb.PREGEN_WIDTHS)]
    assert _events(logs, "media_pregen_pause") == []
    assert [e["state"] for e in _events(logs, "media_pregen_budget")] == ["full", "ok"]


def test_widthless_items_make_only_the_placeholder(out):
    """What a full-budget batch does to a picture: a placeholder, no variant."""
    pic = _jpeg(_room(out) / "picture" / "1.jpg")
    res = media_pregen.default_process(Item(out, pic, "picture", ()))
    assert (res.outcome, res.bytes) == ("done", 0)
    assert not photo_thumb.cache_dir().exists() or not list(
        photo_thumb.cache_dir().glob("*.webp")
    )
    rel = _rel(out, pic)
    assert media_meta.get_many([rel])[rel].status == "ready"
    with patch.object(photo_thumb.Image, "open", side_effect=AssertionError):
        assert media_pregen.default_process(Item(out, pic, "picture", ())).outcome == (
            "skipped"
        )


def test_status_reports_a_full_thumbnail_cache(env, monkeypatch):
    photo_thumb.cache_state_add(photo_thumb.cache_dir(), 900, 10**12)
    monkeypatch.setattr(photo_thumb, "CACHE_CAP_BYTES", 1000)
    assert media_pregen.status()["thumbs_full"] is True
    monkeypatch.setattr(photo_thumb, "CACHE_CAP_BYTES", 10**12)
    assert media_pregen.status()["thumbs_full"] is False


# --- duty cycle -----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_duty_cycle_sleeps_twice_the_work_time(h):
    h.phases[HINATA] = [
        Phase("messages", [_item(h.root, f"{i:02d}.jpg") for i in range(9)])
    ]
    h.work = 0.1  # per item: a full batch of 8 takes 0.8 s
    p = h.make()
    p.start()
    await _idle(p)
    await p.stop()
    duty = [s for s in h.sleeps if s not in (media_pregen.STARTUP_DELAY_S,)]
    assert duty[0] == pytest.approx(1.6)  # >= max(0.05, 2t)
    assert duty[1] == pytest.approx(0.2)


@pytest.mark.asyncio
async def test_a_fast_batch_still_yields_the_minimum_pause(h):
    h.phases[HINATA] = [Phase("messages", [_item(h.root, "a.jpg")])]
    p = h.make()
    p.start()
    await _idle(p)
    await p.stop()
    assert h.sleeps == [media_pregen.STARTUP_DELAY_S, media_pregen.PREGEN_MIN_PAUSE_S]


# --- shutdown -------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_shutdown_event_stops_the_worker_before_the_next_file(h):
    h.phases[HINATA] = [
        Phase("messages", [_item(h.root, f"{i}.jpg") for i in range(5)])
    ]
    h.on_process = lambda item: shutdown_state.begin_shutdown()
    p = h.make()
    with capture_logs() as logs:
        p.start()
        await asyncio.wait_for(p._task, 5)
    assert h.processed == ["0.jpg"]
    assert p.status_snapshot()["state"] == "stopped"
    assert _events(logs, "media_pregen_state")[-1]["state"] == "stopped"
    await p.stop()  # already finished: still fine


@pytest.mark.asyncio
async def test_stop_returns_in_time_with_a_hung_process(h, monkeypatch):
    monkeypatch.setattr(media_pregen, "STOP_TIMEOUT_S", 0.3)
    h.phases[HINATA] = [
        Phase("messages", [_item(h.root, "a.jpg"), _item(h.root, "b.jpg")])
    ]
    hang = threading.Event()
    entered = threading.Event()

    def block(item):
        entered.set()
        hang.wait(10)

    h.on_process = block
    p = h.make()
    try:
        p.start()
        await asyncio.wait_for(asyncio.to_thread(entered.wait, 5), 6)
        t0 = time.monotonic()
        with capture_logs() as logs:
            await asyncio.wait_for(p.stop(), 3)
        assert time.monotonic() - t0 < 2
        [state] = _events(logs, "media_pregen_state")
        assert state["state"] == "stopped" and state["abandoned"] is True
        assert h.processed == []  # the hung item never finished before stop returned
    finally:
        hang.set()


@pytest.mark.asyncio
async def test_stop_before_start_and_module_calls_are_safe():
    await media_pregen.stop()
    media_pregen.request(HINATA)
    media_pregen.hint(HINATA, ["日向坂46/a.jpg"])
    media_pregen.note_foreground()
    assert media_pregen.status()["state"] == "stopped"
    p = MediaPregen([HINATA])
    await p.stop()
    p.request(HINATA)


@pytest.mark.asyncio
async def test_module_start_twice_keeps_one_worker(h):
    kw = dict(
        clock=h.clock,
        sleep=h.sleep,
        enumerate_fn=h.enumerate,
        process_fn=h.process,
        output_dir_fn=lambda: h.root,
        is_busy=h.is_busy,
    )
    a = media_pregen.start([HINATA], **kw)
    assert media_pregen.start([HINATA], **kw) is a
    task = a._task
    a.start()  # already started: the same task
    assert a._task is task
    media_pregen.request(HINATA)
    media_pregen.hint(HINATA, [])
    await media_pregen.stop()
    await media_pregen.stop()


@pytest.mark.asyncio
async def test_the_worker_thread_enters_background_mode(h):
    h.phases[HINATA] = [Phase("messages", [_item(h.root, "a.jpg")])]
    entered: list[str] = []
    with patch.object(
        low_priority,
        "enter_background_mode",
        side_effect=lambda: entered.append(threading.current_thread().name),
    ):
        p = h.make()
        p.start()
        await _idle(p)
        await p.stop()
    assert entered == ["media_pregen"]
    assert h.threads == ["media_pregen"]


# --- the Shell watchdog ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_hung_batch_disables_the_shell_and_starts_a_fresh_thread(
    h, monkeypatch
):
    monkeypatch.setattr(video_poster, "SHELL_TIMEOUT_S", 0.05)
    monkeypatch.setattr(media_pregen, "WATCHDOG_GRACE_S", 0.0)
    items = [_item(h.root, f"{i:02d}.mp4") for i in range(10)]
    h.phases[HINATA] = [Phase("messages", items)]
    hang = threading.Event()
    made: list[threading.Thread] = []

    def factory(**kw):
        t = threading.Thread(**kw)
        made.append(t)
        return t

    def block(item):
        if item.path.name == "00.mp4":
            hang.wait(10)

    h.on_process = block
    p = h.make(thread_factory=factory)
    try:
        with capture_logs() as logs:
            p.start()
            await _idle(p)
            processed = list(h.processed)
            await p.stop()
    finally:
        hang.set()
    assert len(made) == 2
    assert video_poster.shell_state()["off"] is True
    assert {
        "event": "media_pregen_pause",
        "state": "paused",
        "reason": "shell_hung",
        "paused_ms": 0,
        "log_level": "warning",
    } in logs
    assert processed == ["08.mp4", "09.mp4"]  # the next batch, on the new thread


@pytest.mark.asyncio
async def test_a_hanging_shell_turns_the_rest_of_the_videos_to_poster_none(
    out, monkeypatch
):
    room = _room(out)
    videos = [_video(room / "video" / f"{i}.mp4") for i in range(3)]
    release = threading.Event()
    calls: list[str] = []

    def hang(path, size):
        calls.append(path.name)
        release.wait(10)
        return None

    monkeypatch.setattr(video_poster, "SHELL_TIMEOUT_S", 0.2)
    items = [Item(out, v, "video", photo_thumb.PREGEN_WIDTHS) for v in videos]
    h = Harness(out)
    h.phases[HINATA] = [Phase("messages", items)]
    p = h.make(process_fn=media_pregen.default_process)
    try:
        with (
            patch.object(win_shell_thumb, "available", return_value=True),
            patch.object(win_shell_thumb, "shell_thumbnail", side_effect=hang),
            capture_logs() as logs,
        ):
            p.start()
            await _idle(p)
            await p.stop()
    finally:
        release.set()
    assert calls == ["0.mp4"]
    rows = media_meta.get_many([_rel(out, v) for v in videos])
    first = rows[_rel(out, videos[0])]
    assert (first.poster, first.reason) == ("failed", "shell_crash_suspect")
    assert [rows[_rel(out, v)].poster for v in videos[1:]] == ["none", "none"]
    hung = [
        e for e in _events(logs, "media_pregen_pause") if e["reason"] == "shell_hung"
    ]
    assert len(hung) == 1


# --- default_process ------------------------------------------------------------------


class FakeShell:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def __call__(self, path, size):
        self.calls.append(path.name)
        return Image.new("RGB", (640, 360), (40, 80, 160))


@pytest.mark.asyncio
async def test_crash_recovery_and_video_posters_end_to_end(out):
    room = _room(out)
    crashed = _video(room / "video" / "1.mp4")
    fresh = _video(room / "video" / "2.mp4")
    crashed_rel, fresh_rel = _rel(out, crashed), _rel(out, fresh)
    media_meta.mark_poster_pending(crashed_rel, media_meta.stat_key_of(crashed.stat()))
    shell = FakeShell()
    h = Harness(out)
    h.phases[HINATA] = [
        Phase(
            "messages",
            [
                Item(out, v, "video", photo_thumb.PREGEN_WIDTHS)
                for v in (crashed, fresh)
            ],
        )
    ]
    p = h.make(process_fn=media_pregen.default_process)
    with (
        patch.object(win_shell_thumb, "available", return_value=True),
        patch.object(win_shell_thumb, "shell_thumbnail", side_effect=shell),
        capture_logs() as logs,
    ):
        p.start()
        await _idle(p)
        await p.stop()
    assert shell.calls == ["2.mp4"]  # never the crash suspect
    rows = media_meta.get_many([crashed_rel, fresh_rel])
    assert (rows[crashed_rel].poster, rows[crashed_rel].reason) == (
        "failed",
        "shell_crash_suspect",
    )
    row = rows[fresh_rel]
    assert (row.status, row.poster, row.poster_source) == ("ready", "ready", "shell")
    assert (row.width, row.height) == (640, 360) and row.rgb is not None
    st = fresh.stat()
    assert row.stat_key == f"{st.st_size}:{st.st_mtime_ns}"
    for w in photo_thumb.PREGEN_WIDTHS:  # keyed by the video, not the poster
        name = photo_thumb.variant_name(fresh_rel, st.st_size, st.st_mtime_ns, w)
        assert (photo_thumb.cache_dir() / name).is_file()
    [msgs] = [e for e in _events(logs, "media_pregen_pass")]
    assert (msgs["done"], msgs["waiting"]) == (1, 1)
    _no_paths(logs, out)


@pytest.mark.asyncio
async def test_without_the_shell_a_video_waits_with_poster_none(out):
    v = _video(_room(out) / "video" / "1.mp4")
    rel = _rel(out, v)
    with patch.object(win_shell_thumb, "available", return_value=False):
        res = media_pregen.default_process(Item(out, v, "video", (160, 320)))
        assert res.outcome == "waiting" and res.rel == rel
        assert media_meta.get_many([rel])[rel].poster == "none"
        # poster 'none' is retried; the row is not rewritten while it already says none
        with patch.object(media_meta, "set_poster", side_effect=AssertionError):
            assert media_pregen.default_process(
                Item(out, v, "video", (160,))
            ).outcome == ("waiting")


def test_a_shell_failed_video_is_never_given_to_the_shell_again(out):
    v = _video(_room(out) / "video" / "1.mp4")
    rel = _rel(out, v)
    media_meta.set_poster(rel, media_meta.stat_key_of(v.stat()), "failed", "shell")
    with (
        patch.object(win_shell_thumb, "available", return_value=True),
        patch.object(video_poster, "generate_shell", side_effect=AssertionError),
    ):
        assert media_pregen.default_process(Item(out, v, "video", (160,))).outcome == (
            "waiting"
        )


def test_a_client_poster_completes_the_video(out):
    v = _video(_room(out) / "video" / "1.mp4")
    rel = _rel(out, v)
    import io

    buf = io.BytesIO()
    Image.new("RGB", (320, 180), (9, 9, 9)).save(buf, format="WEBP")
    assert (
        video_poster.ingest_client(v, rel, buf.getvalue(), "image/webp")[0] == "ready"
    )
    with patch.object(win_shell_thumb, "available", side_effect=AssertionError):
        res = media_pregen.default_process(Item(out, v, "video", (160, 320)))
    assert res.outcome == "done" and res.bytes > 0
    row = media_meta.get_many([rel])[rel]
    assert (row.status, row.poster, row.poster_source) == ("ready", "ready", "client")
    # everything present now: one stat, no decode
    with patch.object(photo_thumb.Image, "open", side_effect=AssertionError):
        again = media_pregen.default_process(Item(out, v, "video", (160, 320)))
    assert again.outcome == "skipped"


def test_a_corrupt_poster_is_dropped_and_the_video_waits(out):
    v = _video(_room(out) / "video" / "1.mp4")
    rel = _rel(out, v)
    st = v.stat()
    posters = video_poster.poster_dir()
    posters.mkdir(parents=True)
    bad = posters / video_poster.poster_name(rel, st.st_size, st.st_mtime_ns)
    bad.write_bytes(b"not a webp")
    res = media_pregen.default_process(Item(out, v, "video", (160,)))
    assert (res.outcome, res.rel) == ("waiting", rel)
    assert not bad.exists()  # a client capture or a Shell retry can replace it
    row = media_meta.get_many([rel])[rel]
    assert row.poster == "none" and row.reason == media_meta.NO_PLACEHOLDER


def test_a_picture_is_skipped_with_no_decode_once_complete(out):
    pic = _jpeg(_room(out) / "picture" / "1.jpg")
    item = Item(out, pic, "picture", (160, 320))
    first = media_pregen.default_process(item)
    assert first.outcome == "done" and first.bytes > 0
    rel = _rel(out, pic)
    row = media_meta.get_many([rel])[rel]
    assert (row.status, row.width, row.height) == ("ready", 800, 600)
    assert row.rgb is not None and row.blur is not None
    with patch.object(photo_thumb.Image, "open", side_effect=AssertionError):
        assert media_pregen.default_process(item).outcome == "skipped"


def test_a_missing_placeholder_is_made_even_with_every_variant_cached(out):
    pic = _jpeg(_room(out) / "picture" / "1.jpg")
    item = Item(out, pic, "picture", (160,))
    assert media_pregen.default_process(item).outcome == "done"
    media_meta.clear()
    res = media_pregen.default_process(item)
    assert res.outcome == "done" and res.bytes == 0
    assert media_meta.get_many([_rel(out, pic)])[_rel(out, pic)].status == "ready"


def test_a_broken_picture_is_stored_failed_with_a_reason(out):
    pic = _room(out) / "picture" / "bad.jpg"
    pic.parent.mkdir(parents=True, exist_ok=True)
    pic.write_bytes(b"\xff\xd8 not really")
    rel = _rel(out, pic)
    res = media_pregen.default_process(Item(out, pic, "picture", (160,)))
    assert res.outcome == "failed"
    row = media_meta.get_many([rel])[rel]
    assert (row.status, row.reason) == ("failed", "unreadable")
    # a terminal failure of this version is not retried
    with patch.object(photo_thumb, "make_set", side_effect=AssertionError):
        assert media_pregen.default_process(
            Item(out, pic, "picture", (160,))
        ).outcome == ("skipped")


def test_a_transient_failure_stores_nothing(out):
    pic = _jpeg(_room(out) / "picture" / "1.jpg")
    rel = _rel(out, pic)
    failed = photo_thumb.SetResult(None, {}, {}, None, None, "unavailable")
    with patch.object(photo_thumb, "make_set", return_value=failed):
        assert media_pregen.default_process(
            Item(out, pic, "picture", (160,))
        ).outcome == ("failed")
    assert media_meta.get_many([rel]) == {}


def test_a_missing_file_or_an_error_is_a_failure_never_raised(out):
    gone = Item(out, _room(out) / "picture" / "gone.jpg", "picture", (160,))
    with capture_logs() as logs:
        assert media_pregen.default_process(gone).outcome == "failed"
        outside = Item(out, out.parent / "elsewhere.jpg", "picture", (160,))
        _jpeg(outside.path)
        assert media_pregen.default_process(outside).outcome == "failed"
    reasons = [e["reason"] for e in _events(logs, "media_pregen_item_failed")]
    assert reasons == ["unavailable", "error"]
    assert {e["error_type"] for e in _events(logs, "media_pregen_item_failed")} == {
        "FileNotFoundError",
        "ValueError",
    }
    _no_paths(logs, out)


def test_process_checks_the_shutdown_event_first(out):
    pic = _jpeg(_room(out) / "picture" / "1.jpg")
    shutdown_state.begin_shutdown()
    with patch.object(photo_thumb, "make_set", side_effect=AssertionError):
        assert media_pregen.default_process(
            Item(out, pic, "picture", (160,))
        ).outcome == ("skipped")


@pytest.mark.asyncio
async def test_a_raising_process_fn_is_counted_failed(h):
    h.phases[HINATA] = [
        Phase("messages", [_item(h.root, "a.jpg"), _item(h.root, "b.jpg")])
    ]

    def boom(item):
        if item.path.name == "a.jpg":
            raise RuntimeError("x")
        return ItemResult("done")

    p = h.make(process_fn=boom)
    with capture_logs() as logs:
        p.start()
        await _idle(p)
        await p.stop()
    [msgs] = _events(logs, "media_pregen_pass")
    assert (msgs["done"], msgs["failed"]) == (1, 1)
    assert {
        "event": "media_pregen_item_failed",
        "kind": "picture",
        "reason": "error",
        "error_type": "RuntimeError",
        "log_level": "debug",
    } in logs


# --- end to end with the thumbnail route ----------------------------------------------


def _no_paths(logs, out: Path) -> None:
    text = repr(logs)
    assert str(out) not in text and SECRET not in text and "日向坂46/" not in text
    assert ".jpg" not in text and ".mp4" not in text


@pytest.mark.asyncio
async def test_after_a_pass_the_route_is_a_cache_hit(out):
    from backend.main import app

    pic = _jpeg(_room(out) / "picture" / "1.jpg")
    h = Harness(out)
    h.phases[HINATA] = [
        Phase("newest", [Item(out, pic, "picture", photo_thumb.PREGEN_WIDTHS)])
    ]
    p = h.make(process_fn=media_pregen.default_process)
    with capture_logs() as logs:
        p.start()
        await _idle(p)
        await p.stop()
    _no_paths(logs, out)
    base = f"/api/content/thumb/{HINATA}/{ROOM}/picture/1.jpg?w="
    outcomes = []
    for width in (480, 320, 160):
        with capture_logs() as logs:
            r = await asyncio.to_thread(TestClient(app).get, f"{base}{width}")
        assert r.status_code == 200
        [cache] = [e for e in logs if e["event"] == "photo_thumb_cache"]
        outcomes.append((cache["width"], cache["outcome"]))
    # the pre-generated 480 is a hit; 320 / 160 derive from it (no source decode)
    assert outcomes == [(480, "hit"), (320, "derived"), (160, "derived")]


# --- clearing the caches --------------------------------------------------------------


@pytest.mark.asyncio
async def test_clear_caches_frees_the_bytes_and_the_worker_runs_again(out):
    pic = _jpeg(_room(out) / "picture" / "1.jpg")
    h = Harness(out)
    h.phases[HINATA] = [Phase("newest", [Item(out, pic, "picture", (160, 320))])]
    kw = dict(
        clock=h.clock,
        sleep=h.sleep,
        enumerate_fn=h.enumerate,
        process_fn=media_pregen.default_process,
        output_dir_fn=lambda: out,
        is_busy=h.is_busy,
    )
    p = media_pregen.start([HINATA], **kw)
    await _idle(p)
    posters = video_poster.poster_dir()
    posters.mkdir(parents=True)
    (posters / "x.webp").write_bytes(b"p" * 10)
    thumbs = list(photo_thumb.cache_dir().iterdir())
    expected = sum(f.stat().st_size for f in thumbs) + 10
    with capture_logs() as logs:
        freed = await media_pregen.clear_caches()
    assert freed == expected
    assert media_meta.counts()["rows"] == 0
    assert list(posters.iterdir()) == []
    assert {
        "event": "media_pregen_cache_cleared",
        "freed_bytes": expected,
        "count": len(thumbs) + 1,
        "log_level": "info",
    } in logs
    await asyncio.sleep(0)
    await _idle(p)
    assert len(list(photo_thumb.cache_dir().iterdir())) == 2  # made again
    assert media_meta.counts()["ready"] == 1
    await media_pregen.stop()


@pytest.mark.asyncio
async def test_clear_caches_without_a_worker_and_with_a_held_file(env):
    thumbs = photo_thumb.cache_dir()
    thumbs.mkdir(parents=True)
    (thumbs / "a-160.webp").write_bytes(b"x" * 5)
    (thumbs / "b-160.webp").write_bytes(b"x" * 7)
    (thumbs / "sub").mkdir()  # never recursed into
    real_unlink = Path.unlink

    def held(self, missing_ok=False):
        if self.name == "b-160.webp":
            raise PermissionError("held by a reader")
        return real_unlink(self, missing_ok=missing_ok)

    with patch.object(Path, "unlink", held):
        assert await media_pregen.clear_caches() == 5
    assert sorted(f.name for f in thumbs.iterdir()) == ["b-160.webp", "sub"]


# --- status ---------------------------------------------------------------------------


def test_status_without_a_worker(env):
    s = media_pregen.status()
    assert s["state"] == "stopped" and s["services"] == {}
    assert s["cache"]["thumbs_bytes"] == 0 and s["cache"]["posters_bytes"] == 0
    assert s["posters"] == {
        "ready": 0,
        "failed": 0,
        "pending_client": 0,
        "shell_off": False,
    }


@pytest.mark.asyncio
async def test_status_with_a_worker(h):
    h.phases[HINATA] = [Phase("messages", [_item(h.root, "a.jpg")])]
    p = media_pregen.start(
        [HINATA],
        clock=h.clock,
        sleep=h.sleep,
        enumerate_fn=h.enumerate,
        process_fn=h.process,
        output_dir_fn=lambda: h.root,
        is_busy=h.is_busy,
    )
    await _idle(p)
    s = await asyncio.to_thread(media_pregen.status)
    assert s["state"] == "idle" and s["services"] == {HINATA: {"done": 1, "total": 1}}
    await media_pregen.stop()


# --- the thread hand-off --------------------------------------------------------------


def test_delivery_to_a_closed_loop_or_a_cancelled_future_is_dropped():
    loop = asyncio.new_event_loop()
    fut = loop.create_future()
    fut.cancel()
    media_pregen._deliver(loop, fut, [])  # cancelled: nothing to set
    loop.run_until_complete(asyncio.sleep(0))
    loop.close()
    media_pregen._deliver(loop, fut, [])  # closed: dropped, never raises


def test_a_wake_from_another_thread_after_the_loop_closed_is_dropped(h):
    p = h.make()
    loop = asyncio.new_event_loop()
    p._loop = loop
    loop.close()
    p.request(HINATA)  # never raises
    assert HINATA in p._requested


# --- stop paths -----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_shutdown_reason_ends_the_task_before_the_pass(h):
    h.phases[HINATA] = [Phase("messages", [_item(h.root, "a.jpg")])]
    h.busy = "shutdown"
    p = h.make()
    p.start()
    await asyncio.wait_for(p._task, 5)
    assert h.processed == [] and p.status_snapshot()["state"] == "stopped"


@pytest.mark.asyncio
async def test_shutdown_while_paused_ends_the_task(h):
    h.phases[HINATA] = [Phase("messages", [_item(h.root, "a.jpg")])]
    h.busy = "sync"
    h.on_sleep = lambda s: (
        shutdown_state.begin_shutdown() if s == media_pregen.POLL_PAUSED_S else None
    )
    p = h.make()
    p.start()
    await asyncio.wait_for(p._task, 5)
    assert h.processed == []


@pytest.mark.asyncio
async def test_shutdown_during_a_pass_stops_before_the_next_batch(h):
    h.phases[HINATA] = [
        Phase("newest", [_item(h.root, "a.jpg")]),
        Phase("messages", [_item(h.root, "b.jpg")]),
    ]

    async def enumerate_then_shut(service, root):
        h.busy = "shutdown"
        return h.phases[service]

    p = h.make(enumerate_fn=enumerate_then_shut)
    p.start()
    await asyncio.wait_for(p._task, 5)
    assert h.processed == []


@pytest.mark.asyncio
async def test_shutdown_before_a_hint_batch_ends_the_task(h):
    h.root.mkdir(parents=True)
    p = h.make()
    p.start()
    await _idle(p)
    h.busy = "shutdown"
    p.hint(HINATA, ["日向坂46/a.jpg"])
    await asyncio.wait_for(p._task, 5)
    assert h.processed == []


@pytest.mark.asyncio
async def test_an_unexpected_error_is_logged_and_the_worker_carries_on(h):
    calls: list[str] = []

    async def flaky(service, root):
        calls.append(service)
        if len(calls) == 1:
            raise RuntimeError("x")
        return [Phase("messages", [_item(h.root, "a.jpg")])]

    p = h.make(enumerate_fn=flaky)
    with capture_logs() as logs:
        p.start()
        await _idle(p)
        assert p.status_snapshot()["state"] == "idle"
        p.request(HINATA)
        await asyncio.sleep(0)
        await _idle(p)
        await p.stop()
    assert {
        "event": "media_pregen_failed",
        "error_type": "RuntimeError",
        "log_level": "warning",
    } in logs
    assert h.processed == ["a.jpg"]


@pytest.mark.asyncio
async def test_clear_on_an_unstarted_worker_still_clears(h, env):
    thumbs = photo_thumb.cache_dir()
    thumbs.mkdir(parents=True)
    (thumbs / "a-160.webp").write_bytes(b"x" * 4)
    assert await h.make().clear() == 4


def test_request_safely_logs_and_swallows(monkeypatch):
    monkeypatch.setattr(
        media_pregen, "request", lambda s: (_ for _ in ()).throw(OSError())
    )
    with capture_logs() as logs:
        media_pregen.request_safely(HINATA)
    assert logs == [
        {
            "event": "media_pregen_request_failed",
            "service": HINATA,
            "error_type": "OSError",
            "log_level": "warning",
        }
    ]


def test_an_unexpected_process_error_is_a_failure(out):
    pic = _jpeg(_room(out) / "picture" / "1.jpg")
    with (
        patch.object(media_meta, "get_many", side_effect=RuntimeError("x")),
        capture_logs() as logs,
    ):
        assert media_pregen.default_process(
            Item(out, pic, "picture", (160,))
        ).outcome == ("failed")
    assert _events(logs, "media_pregen_item_failed")[0]["error_type"] == "RuntimeError"


def test_a_variant_evicted_at_once_counts_no_bytes(out, tmp_path):
    pic = _jpeg(_room(out) / "picture" / "1.jpg")
    st = pic.stat()
    made = photo_thumb.SetResult(
        (st.st_size, st.st_mtime_ns),
        {160: tmp_path / "gone-160.webp"},
        {},
        photo_thumb.Placeholder((1, 2, 3), None),
        (8, 6),
        None,
    )
    with patch.object(photo_thumb, "make_set", return_value=made):
        res = media_pregen.default_process(Item(out, pic, "picture", (160,)))
    assert (res.outcome, res.bytes) == ("done", 0)
    row = media_meta.get_many([_rel(out, pic)])[_rel(out, pic)]
    assert (row.rgb, row.width, row.height) == (0x010203, 8, 6)


# --- fix round 1 ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_clearing_mid_pass_keeps_the_worker_alive_and_it_finishes(h, env):
    """Critical 1: clear() during a pass dropped the progress entry -> KeyError."""
    items = [_item(h.root, f"{i:02d}.jpg") for i in range(40)]
    h.phases[HINATA] = [Phase("messages", items)]
    cleared: list[int] = []

    clearing: list[asyncio.Task] = []

    def on_sleep(s):
        # the first duty sleep (after batch 1): clear the caches mid-pass
        if s == media_pregen.PREGEN_MIN_PAUSE_S and not cleared:
            cleared.append(len(h.processed))
            clearing.append(asyncio.get_running_loop().create_task(p.clear()))

    h.on_sleep = on_sleep
    p = h.make()
    with capture_logs() as logs:
        p.start()
        while not clearing:
            await asyncio.sleep(0)
        await asyncio.wait_for(clearing[0], 5)
        await _idle(p)
        snapshot = p.status_snapshot()
        await p.stop()
    assert cleared == [8]
    assert _events(logs, "media_pregen_failed") == []
    assert _events(logs, "media_pregen_cache_cleared")
    # the stale pass was dropped after its batch; the re-requested pass ran in full
    assert h.processed[:8] == [f"{i:02d}.jpg" for i in range(8)]
    assert h.processed[-40:] == [i.path.name for i in items]
    assert snapshot["state"] == "idle"
    assert snapshot["services"] == {HINATA: {"done": 40, "total": 40}}


@pytest.mark.asyncio
async def test_clearing_abandons_the_batch_in_flight(h, env):
    h.phases[HINATA] = [
        Phase("messages", [_item(h.root, f"{i}.jpg") for i in range(4)])
    ]
    gate = threading.Event()
    entered = threading.Event()

    def block_first(item):
        if item.path.name == "0.jpg" and not entered.is_set():
            entered.set()
            gate.wait(5)

    h.on_process = block_first
    p = h.make()
    p.start()
    await asyncio.wait_for(asyncio.to_thread(entered.wait, 5), 6)
    clearing = asyncio.ensure_future(p.clear())
    await asyncio.wait_for(asyncio.shield(clearing), 2)  # never waits for the batch
    gate.set()
    await _idle(p)
    await p.stop()
    # the abandoned batch stopped after its current file; the new pass did all four
    assert h.processed == ["0.jpg", "0.jpg", "1.jpg", "2.jpg", "3.jpg"]


@pytest.mark.asyncio
async def test_enumeration_never_runs_on_the_event_loop(out):
    """Critical 2: building the phases (CPU-bound on a large service) runs in a thread."""
    from backend.services.memories import album
    from backend.services.memories import index as memory_index

    loop_thread = threading.get_ident()
    threads: dict[str, int] = {}
    real_phases = media_pregen._phases
    real_rows = memory_index.media_rows

    def phases(*args):
        threads["phases"] = threading.get_ident()
        return real_phases(*args)

    def rows(sdir):
        threads["rows"] = threading.get_ident()
        return [_media_row("a", "a/p/1.jpg", "picture", "2026-01-01T00:00:00+00:00")]

    async def warm(service, s):
        return None

    async def months(*a, **kw):
        return {
            "months": [{"cover": {"media_file": f"a/p/c{i}.jpg"}} for i in range(200)]
        }

    with (
        patch.object(media_pregen, "_phases", side_effect=phases),
        patch.object(memory_index, "media_rows", side_effect=rows),
        patch.object(album, "warm_album", side_effect=warm),
        patch.object(album, "album_months", side_effect=months),
    ):
        result = await media_pregen.default_enumerate(HINATA, out)
    assert real_rows is not None
    assert threads["phases"] != loop_thread and threads["rows"] != loop_thread
    assert len(result[0].items) == 201


def test_covers_deduplicate_against_phase_1_in_linear_time(out):
    """14k rows and 110 covers took ~2.8 s with the old any() scan."""
    sdir = out / "日向坂46"
    rows = [
        _media_row(
            f"r{i % 40}", f"r{i % 40}/p/{i}.jpg", "picture", "2026-09-01T00:00:00+00:00"
        )
        for i in range(14_000)
    ]
    covers = [f"r{i % 40}/p/{i}.jpg" for i in range(110)]
    t0 = time.perf_counter()
    phases = media_pregen._phases(out, sdir, rows, covers)
    assert time.perf_counter() - t0 < 1.5
    assert len(phases[0].items) == 14_000  # covers already in phase 1: no duplicates


@pytest.mark.asyncio
async def test_a_hinted_starred_item_keeps_its_640(h):
    h.root.mkdir(parents=True)
    star = Item(h.root, h.root / "日向坂46" / "s.jpg", "picture", (480, 640))
    h.phases[HINATA] = [Phase("favorites", [star])]
    seen: list[tuple[str, tuple[int, ...]]] = []
    h.on_process = lambda item: seen.append((item.path.name, item.widths))
    p = h.make()
    p.start()
    await _idle(p)
    p.hint(HINATA, ["日向坂46/s.jpg", "日向坂46/plain.jpg"])
    await asyncio.sleep(0)
    await _idle(p)
    await p.stop()
    assert seen[1:] == [("s.jpg", (480, 640)), ("plain.jpg", (480,))]


def test_large_rels_skip_items_outside_their_root(tmp_path):
    inside = Item(tmp_path, tmp_path / "a" / "1.jpg", "picture", (480, 640))
    outside = Item(tmp_path / "x", tmp_path / "b.jpg", "picture", (480, 640))
    plain = Item(tmp_path, tmp_path / "c.jpg", "picture", (480,))
    assert media_pregen._large_rels([Phase("p", [inside, outside, plain])]) == {
        "a/1.jpg"
    }


@pytest.mark.asyncio
async def test_a_hung_picture_batch_leaves_the_shell_on(h, monkeypatch):
    monkeypatch.setattr(video_poster, "SHELL_TIMEOUT_S", 0.05)
    monkeypatch.setattr(media_pregen, "WATCHDOG_GRACE_S", 0.0)
    h.phases[HINATA] = [
        Phase("messages", [_item(h.root, "a.jpg"), _item(h.root, "b.jpg")])
    ]
    hang = threading.Event()
    h.on_process = lambda item: hang.wait(10) if item.path.name == "a.jpg" else None
    p = h.make()
    try:
        with capture_logs() as logs:
            p.start()
            await _idle(p)
            await p.stop()
    finally:
        hang.set()
    assert video_poster.shell_state()["off"] is False
    assert [e["reason"] for e in _events(logs, "media_pregen_pause")] == ["batch_hung"]


@pytest.mark.asyncio
async def test_the_caches_are_measured_after_the_startup_delay(h):
    order: list[str] = []
    h.on_sleep = lambda s: order.append(f"sleep:{s}")
    real = photo_thumb.cache_total

    def measured(root, *, measure=True):
        if measure:
            order.append("measure")
        return real(root, measure=measure)

    with patch.object(photo_thumb, "cache_total", side_effect=measured):
        p = h.make()
        p.start()
        await _idle(p)
        await p.stop()
    assert order[:3] == [f"sleep:{media_pregen.STARTUP_DELAY_S}", "measure", "measure"]


@pytest.mark.asyncio
async def test_wait_idle_returns_when_the_task_ended_with_work_queued(h):
    p = h.make()
    h.busy = "shutdown"
    p.start()
    await asyncio.wait_for(p._task, 5)
    p.hint(HINATA, ["日向坂46/a.jpg"])
    assert p.pending_hints() == 1
    await asyncio.wait_for(p.wait_idle(), 2)
