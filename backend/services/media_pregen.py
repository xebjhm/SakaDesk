"""Background thumbnail pre-generation: idle, throttled, quiesced on shutdown.

Every gallery tile asks ``GET /api/content/thumb`` for a small WebP variant.
On a cold cache each of those requests decodes a full-size photo, so a first
open of the album or a gallery paints slowly. This worker makes those
variants ahead of time, **the same files under the same keys** the route
serves (``photo_thumb.make_set`` with the ``photo_thumb.archive_rel`` key),
so a pre-generated variant is a route hit and the route's miss path is only a
safety net. It also stores each item's placeholder (``media_meta``) and makes
video posters with the Windows Shell (``video_poster.generate_shell``).

**Never in the way.**

- One plain daemon ``threading.Thread`` (``media_pregen``) does the blocking
  work, fed by a ``queue.SimpleQueue``. Not a ``ThreadPoolExecutor``: its
  threads are joined at interpreter exit, so a hung Shell call would block
  app exit. The thread's first act is ``low_priority.enter_background_mode``
  (Windows background mode: lower CPU, IO and memory priority). COM is
  entered per Shell call by ``win_shell_thumb`` (an STA for that call only),
  so this thread holds no apartment while it waits.
- An asyncio task on the server loop decides what to do. It hands the thread
  :data:`PREGEN_BATCH` files at a time and awaits each batch through an
  ``asyncio.Future`` completed with ``loop.call_soon_threadsafe``.
- **Duty cycle:** after a batch that took *t* seconds the task sleeps
  ``max(PREGEN_MIN_PAUSE_S, PREGEN_DUTY_SLEEP * t)``, so the thread works at
  most a third of the time.
- **Pause predicate** (:func:`default_is_busy`, first match wins):
  ``shutdown``, ``sync`` (a sync job runs or waits), ``refresh`` (a Memories
  refresh is pending or a sync is writing), ``blog_backup``, ``foreground``
  (a thumbnail, media or meta request came in during the last
  :data:`IDLE_AFTER_S`; :func:`note_foreground`) and ``budget_full`` (the
  thumbnail cache passed :data:`PREGEN_FILL_RATIO` of its cap, so on-demand
  misses and toasts keep headroom and the worker never evicts what it just
  made). It is checked before every batch; the batch in flight always
  finishes. ``budget_full`` alone does **not** pause: batches then run
  with no new variants, so hints, placeholders and Shell posters (their own
  cache) still get made. An eviction trims to ``photo_thumb.CACHE_LOW_WATER``
  (0.75), below the fill line, so the worker adds again afterwards. While paused the task polls every :data:`POLL_PAUSED_S`. Each
  pause and each resume logs ``media_pregen_pause`` once (``state``,
  ``reason``, ``paused_ms``), never every poll.
- **Shutdown:** the thread checks ``shutdown_state.shutdown_event()`` before
  every file, and :func:`stop` (a ``_writer_stops`` hook that runs before
  ``drain_background_tasks``) cancels the task and waits at most
  :data:`STOP_TIMEOUT_S` for the thread. A thread still stuck in a call is
  abandoned (it is a daemon; it can only finish its own atomic write).
- **Shell watchdog:** each batch is awaited for at most
  ``video_poster.SHELL_TIMEOUT_S * len(batch) + WATCHDOG_GRACE_S``. On a
  timeout the task logs ``media_pregen_pause reason=shell_hung``, turns the
  Shell off for the session (``video_poster.disable_shell``), abandons that
  thread and starts a fresh one. ``generate_shell``'s own hang guard trips
  first for a single Shell hang (the grace keeps the two apart); the
  worker then logs ``shell_hung`` too, once. A hung batch of pictures only
  logs ``reason=batch_hung`` and leaves the Shell on.
- **Clearing** (:func:`clear_caches`) is safe at any point: the pass in
  flight is dropped, the batch in flight is abandoned after its current
  file, and every service is passed over again.

**What it makes, in order.** At startup it runs
``media_meta.recover_pending`` (a ``pending`` poster means the process died
inside the Shell: that video becomes ``shell_crash_suspect`` and never goes
to the Shell again), waits :data:`STARTUP_DELAY_S`, measures both caches,
then makes one full pass
over every service. Afterwards it runs only on :func:`request` (a finished
sync's index build, a finished blog backup) or :func:`hint`.

**Pass order** (:meth:`MediaPregen._order`): the requested services first,
then the others; within each group the oshi services first
(:func:`default_oshi_services`: a service with an oshi member in the
``oshi_members`` setting), then ``sync_coordinator.order_services`` order.
The pass runs in two rounds: phases 0-3 (message media) of **every** service
in that order, then phase 4 (blogs) of every service in the same order. On a
large archive the thumbnail fill line can be reached inside one service's
blogs, so blogs never run before another service's message media (D-M2).
Logged once per pass as ``media_pregen_order`` (``services``, ``oshi``
count). Without an oshi, or when the setting cannot be read
(``media_pregen_oshi_failed``), the order is the stable one.

Per service the phases are (:func:`default_enumerate`):

0. ``warm_album``: D4's ``album.warm_album`` (the 全員 album caches), then
   ``album.album_months`` (a cache hit) for every month's cover, which joins
   phase 1.
1. ``newest``: message media within :data:`NEWEST_DAYS` of the newest item
   of its room, newest first, at ``photo_thumb.PREGEN_WIDTHS`` (480 px; the
   route derives 320 / 160 from it on demand).
2. ``favorites``: the other ★ items.
3. ``messages``: every other message media, newest first.
4. ``blogs``: every cached blog image of the service, newest first, at
   ``PREGEN_WIDTHS``. It is listed lazily (:meth:`MediaPregen._expand_blogs`)
   with ``blog_service``'s gallery building blocks, one step at a time on
   the worker thread (background priority) and with a pause check before
   each step, so a sync or a gallery opened meanwhile pauses it. Archive
   paths come straight from the scan (no per-image resolve). A logged no-op
   while full blog backup is off (``reason=backup_off``), when the blog
   listing is unchanged since the last completed blog phase of the service
   (``reason=unchanged``: the same ``blog_service.gallery_signature``; see
   *Persisted blog signatures* below), when
   there is no blog index (``reason=no_index``), or when the listing fails
   (``reason=failed``, ``media_pregen_blogs_failed``).

**Persisted blog signatures** (D-M4). A completed blog phase stores its
listing signature (in memory and on disk) only when it ran clean: a phase
that ran at the fill line (placeholders only), lost a batch to the watchdog
or had a failed item stores none (``media_pregen_blog_sig state=skipped
reason=degraded``), so the next pass walks it again. The signature goes
in ``media_meta.db`` (``media_meta.kv_set``, key :data:`BLOG_SIG_PREFIX` +
service; value: a hash of the blogs base, the index mtime and the
cached-blog count, never a path), so the "unchanged"
skip survives a restart instead of re-walking every cached blog image. The
in-session ``gallery_version`` is not stored: it restarts at every launch.
Instead the stored rows are removed whenever that version would move:

- every blog write (``blog_service.invalidate_gallery``) calls
  :func:`forget_blog_signatures` for its service, which deletes that
  service's row only (once per save, off the event loop; a write of unknown
  service deletes every row), so one new blog in one group never makes the
  other groups list again (N3);
- a signature is saved only when no blog was written since its listing,
  and deleted again if one was written (or the caches were cleared) while
  it was being saved;
- a service's signature loaded at start is trusted only while its
  ``gallery_version`` has not moved since (a blog of that service written
  this session lists it again);
- :func:`clear_caches` and a ``media_meta`` schema reset empty the table.

Logged as ``media_pregen_blog_sig`` (``state=loaded|saved|skipped|forgotten``,
``count``, ``bad``, ``reason``).

Hinted files (``media_meta`` hints missing and stale rows of a meta batch)
jump the queue at every batch boundary, deduplicated and capped at
:data:`HINTS_MAX`. A video that can only wait for a client capture is not
re-queued from hints for :data:`HINT_COOLDOWN_S`.

Every item, ★ items and covers included, is made at
``photo_thumb.PREGEN_WIDTHS`` only (D-M7: covers ask for 320 and tiles for
at most 480, both served from the 480). 640 stays a width the route renders
on demand for ``large`` requests; it is never pre-generated.

**Per file** (:func:`default_process`, on the thread): one stat; a file
whose variants and fresh meta row are all present is ``skipped`` with no
decode. A picture goes through ``photo_thumb.make_set`` (one decode for every
width plus the placeholder). A video needs a poster first: an existing one,
else the Shell (not for a Shell-failed or crash-suspect version; a ``none``
row is retried), else the row is set to ``poster='none'`` and the video
waits for a client capture. Its variants are rendered from the poster but
keyed by the **video's** stat (``make_set(..., key_stat=)``); a poster file
that cannot be decoded is deleted and the poster set to ``none``.
Enumeration (the media rows and the phase lists) runs in worker threads. A failed row
always carries a ``reason``; a transient failure (``unavailable``) stores
nothing, so a later pass retries it.

Nothing is ever written to the archive. Logs carry ids, codes and counts
only, never a path, ``rel`` or name: ``media_pregen_state`` (``state``),
``media_pregen_pass`` (``service``, ``phase``, ``queued``, ``done``,
``skipped``, ``failed``, ``waiting``, ``bytes``, ``elapsed_ms``, ``reason``),
``media_pregen_pause``, ``media_pregen_budget`` (``state=full|ok``),
``media_pregen_item_failed`` (debug: ``kind``,
``reason``, ``error_type``), ``media_pregen_warm_failed``,
``media_pregen_recovered`` (``count``), ``media_pregen_cache_cleared``
(``freed_bytes``, ``count``), ``media_pregen_failed``,
``media_pregen_request_failed`` (``service``, ``error_type``),
``media_pregen_order`` (``services``, ``oshi``), ``media_pregen_oshi_none``
(``reason``) and ``media_pregen_oshi_failed`` (``error_type``).
"""

from __future__ import annotations

import asyncio
import itertools
import os
import queue
import threading
import time
from collections import Counter
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath
from typing import Any

import structlog

from backend.services import (
    low_priority,
    media_meta,
    photo_thumb,
    shutdown_state,
    video_poster,
    win_shell_thumb,
)
from backend.services.memories.index import MediaRow
from backend.services.service_utils import get_all_services, get_service_display_name

logger = structlog.get_logger(__name__)

STARTUP_DELAY_S = 45
"""Seconds after start before the first pass (the app's own startup work first)."""
IDLE_AFTER_S = 3.0
"""Quiet seconds after the last foreground media request before work resumes."""
POLL_PAUSED_S = 2.0
"""Seconds between pause-predicate checks while paused."""
PREGEN_BATCH = 8
"""Files per thread hop."""
PREGEN_DUTY_SLEEP = 2.0
"""Sleep this many times the batch's work time (at most a third of a core)."""
PREGEN_MIN_PAUSE_S = 0.05
"""Shortest sleep between batches."""
PREGEN_FILL_RATIO = 0.85
"""Stop adding once the thumbnail cache passes this share of
``photo_thumb.CACHE_CAP_BYTES`` (870 MiB of 1 GiB; plan "Cache budget")."""
STOP_TIMEOUT_S = 5.0
"""Longest :func:`stop` waits for the thread before abandoning it."""
ALBUM_WARM_MONTHS = 3
"""The plan's album warm-up depth. D4's ``album.warm_album`` already warms the
album after each index build (its own ``WARM_MONTHS``), so phase 0 calls that
code instead of warming months itself, as the plan prescribes."""
NEWEST_DAYS = 62
"""Phase 1 window: days before the newest item of each room."""
HINTS_MAX = 2000
"""Pending hints kept at most (more are dropped until the queue drains)."""
HINT_COOLDOWN_S = 600.0
"""A video waiting for a client poster is not re-queued from hints for this long."""
COOLDOWN_MAX = 10_000
"""Entries in the cooldown memo at most (expired ones are dropped first)."""
WATCHDOG_GRACE_S = 5.0
BLOG_SCAN_CHUNK = 50
"""``blog.json`` files read per worker step of the blog phase (a pause check runs between steps)."""
BLOG_SIG_PREFIX = "blog_sig:"
"""Key prefix of the persisted blog signatures in ``media_meta``'s key-value table."""
SCAN_STEP_TIMEOUT_S = 120.0
"""One blog-listing step on the thread longer than this (a stalled drive) fails the blog phase."""
"""Added to the batch watchdog so ``generate_shell``'s own hang guard trips first."""

PHASE_WARM = "warm_album"
PHASE_NEWEST = "newest"
PHASE_FAVORITES = "favorites"
PHASE_MESSAGES = "messages"
PHASE_BLOGS = "blogs"

_TERMINAL_REASONS = frozenset({"too_large", "unreadable"})
"""``make_set`` reasons stored as a failed row (a new file version retries)."""


@dataclass(frozen=True)
class Item:
    """One file to process: ``root`` is the output dir, ``path`` inside it."""

    root: Path
    path: Path
    kind: str
    widths: tuple[int, ...]


@dataclass(frozen=True)
class ItemResult:
    """The outcome of one file: ``done|skipped|failed|waiting``.

    ``waiting`` is a video with no poster yet (the client capture fills it);
    ``rel`` is set for it, so hints for it cool down.
    """

    outcome: str
    bytes: int = 0
    rel: str | None = None


@dataclass(frozen=True)
class BlogSource:
    """Phase 4's items are listed when the phase runs (:meth:`MediaPregen._expand_blogs`)."""

    service: str


@dataclass
class Phase:
    """One phase of a service's pass; ``reason`` makes it a logged no-op.

    ``source`` (the blog phase) lists the items lazily, on the worker thread.
    """

    name: str
    items: list[Item]
    reason: str | None = None
    source: BlogSource | None = None


ClockFn = Callable[[], float]
SleepFn = Callable[[float], Awaitable[Any]]
IsBusyFn = Callable[[], "str | None"]
EnumerateFn = Callable[[str, Path], Awaitable[list[Phase]]]
ProcessFn = Callable[[Item], ItemResult]
OshiFn = Callable[[], Awaitable[Sequence[str]]]


async def default_oshi_services() -> list[str]:
    """Service ids with at least one oshi member in the ``oshi_members`` setting.

    The frontend mirrors its oshi list (blog member ids per service) to
    settings; any non-empty list marks the service as an oshi service. Never
    raises: an unreadable setting logs ``media_pregen_oshi_failed`` and an
    absent or malformed one ``media_pregen_oshi_none`` (``reason``); both
    give ``[]`` (the stable order).
    """
    from backend.services import settings_store

    try:
        config = await settings_store.load_config()
    except Exception as e:  # noqa: BLE001 - the order falls back, never fails
        logger.warning("media_pregen_oshi_failed", error_type=type(e).__name__)
        return []
    raw = config.get("oshi_members")
    if raw is None:
        logger.info("media_pregen_oshi_none", reason="unset")
        return []
    if not isinstance(raw, dict):
        logger.info("media_pregen_oshi_none", reason="malformed")
        return []
    return [
        s
        for s, ids in raw.items()
        if isinstance(ids, list) and ids  # JSON keys are str
    ]


# --- the pause predicate ------------------------------------------------------------------

_last_foreground: float | None = None


def default_is_busy(clock: ClockFn = time.monotonic) -> str | None:
    """Why the worker must pause now, or ``None`` (first match wins; see the module).

    Reads in-memory state only (no IO), so it runs on the event loop. The
    fill line uses the measured cache total (``photo_thumb.cache_total``
    with ``measure=False``; the worker measures it once at start).
    """
    if shutdown_state.is_shutting_down():
        return "shutdown"
    from backend.services.sync_coordinator import get_coordinator

    if get_coordinator().busy():
        return "sync"
    from backend.services.memories import index as memory_index

    if memory_index.any_refresh_pending():
        return "refresh"
    from backend.services.blog_service import get_blog_backup_manager

    if get_blog_backup_manager().running_services():
        return "blog_backup"
    if _last_foreground is not None and clock() - _last_foreground < IDLE_AFTER_S:
        return "foreground"
    total = photo_thumb.cache_total(photo_thumb.cache_dir(), measure=False)
    if total is not None and total >= PREGEN_FILL_RATIO * photo_thumb.CACHE_CAP_BYTES:
        return "budget_full"
    return None


# --- enumeration ---------------------------------------------------------------------------


def _norm(media_file: str) -> str:
    return "/".join(p for p in media_file.replace("\\", "/").split("/") if p)


def _parse_ts(ts: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


_OLDEST = datetime.min.replace(tzinfo=timezone.utc)


def _phases(
    root: Path, sdir: Path, rows: Sequence[MediaRow], covers: Sequence[str]
) -> list[Phase]:
    """Phases 1-3 from the media rows and the album covers (the blog phase: :func:`_blog_phase`).

    Pure (no IO) but CPU-bound on a large service (~14k rows): run it in a
    worker thread, never on the event loop (:func:`default_enumerate`).
    """
    base = photo_thumb.PREGEN_WIDTHS
    stamped = [(r, _parse_ts(r.ts_utc)) for r in rows]
    latest: dict[str, datetime] = {}
    for r, ts in stamped:
        if ts is not None and (r.member_dir not in latest or ts > latest[r.member_dir]):
            latest[r.member_dir] = ts
    window = timedelta(days=NEWEST_DAYS)
    cover_set = {_norm(c) for c in covers}
    newest: list[tuple[datetime, Item]] = []
    favorites: list[tuple[datetime, Item]] = []
    rest: list[tuple[datetime, Item]] = []
    seen: set[str] = set()
    for r, ts in stamped:
        mf = _norm(r.media_file)
        path = sdir / mf
        kind = media_meta.kind_of(path)
        if kind is None or mf in seen:
            continue
        seen.add(mf)
        item = Item(root, path, kind, base)
        key = ts if ts is not None else _OLDEST
        if ts is not None and ts >= latest[r.member_dir] - window:
            newest.append((key, item))
        elif r.favorited:
            favorites.append((key, item))
        elif mf in cover_set:
            continue  # joins phase 1 below, with the covers
        else:
            rest.append((key, item))
    in_newest = {i.path for _, i in newest}  # a set: O(1) per cover
    cover_items = [
        Item(root, sdir / c, kind, base)
        for c in dict.fromkeys(_norm(c) for c in covers)
        if (kind := media_meta.kind_of(sdir / c)) is not None
        and sdir / c not in in_newest
    ]

    def ordered(pairs: list[tuple[datetime, Item]]) -> list[Item]:
        return [i for _, i in sorted(pairs, key=lambda p: p[0], reverse=True)]

    return [
        Phase(PHASE_NEWEST, ordered(newest) + cover_items),
        Phase(PHASE_FAVORITES, ordered(favorites)),
        Phase(PHASE_MESSAGES, ordered(rest)),
    ]


async def _album_covers(service: str, sdir: Path) -> list[str]:
    """Phase 0: D4's album warm-up, then every month's cover ``media_file``.

    Runs on the loop, as the album API does (both are cached views). Never
    raises: a failure logs ``media_pregen_warm_failed`` and gives no covers.
    """
    from backend.services.memories import album

    start = time.perf_counter()
    covers: list[str] = []
    try:
        await album.warm_album(service, sdir)
        months = await album.album_months(
            service, sdir, member=None, kind="all", texts=False
        )
        for row in months["months"]:
            mf = (row.get("cover") or {}).get("media_file")
            if mf:
                covers.append(mf)
    except Exception as e:  # noqa: BLE001 - warming is best effort
        logger.warning(
            "media_pregen_warm_failed", service=service, error_type=type(e).__name__
        )
    _log_pass(service, PHASE_WARM, len(covers), Counter(), start)
    return covers


async def _blog_phase(service: str) -> Phase:
    """Phase 4: a logged no-op while full blog backup is off, else listed lazily (:class:`BlogSource`)."""
    from backend.services import blog_service

    if not await blog_service.blog_backup_enabled():
        return Phase(PHASE_BLOGS, [], reason="backup_off")
    return Phase(PHASE_BLOGS, [], source=BlogSource(service))


async def default_enumerate(service: str, root: Path) -> list[Phase]:
    """The phases of one service's pass (see the module); ``[]`` with nothing to make.

    The media rows come from the memory index (``index.media_rows``) and the
    phases are built (:func:`_phases`), both in a worker thread: only phase 0
    (cached album views, as the album API runs them) runs on the loop, and
    only when the service has media. The blog phase (:func:`_blog_phase`,
    listed when it runs) follows; a service with no message media and blog
    backup off gives ``[]``.
    """
    from backend.services.memories import index as memory_index
    from backend.services.memories import people

    try:
        sdir = people.service_data_dir(service, base=root)
    except ValueError:
        return []
    rows = await asyncio.to_thread(memory_index.media_rows, sdir)
    phases: list[Phase] = []
    if rows:
        covers = await _album_covers(service, sdir)
        phases = await asyncio.to_thread(_phases, root, sdir, rows, covers)
    blogs = await _blog_phase(service)
    if not phases and blogs.source is None:
        return []
    return [*phases, blogs]


# --- processing one file (blocking, on the worker thread) --------------------------------


def _item_failed(kind: str, reason: str, e: BaseException | None = None) -> None:
    logger.debug(
        "media_pregen_item_failed",
        kind=kind,
        reason=reason,
        error_type=type(e).__name__ if e is not None else None,
    )


def _all_present(
    rel: str, stat: tuple[int, int], widths: tuple[int, ...], root: Path
) -> bool:
    return all(
        (root / photo_thumb.variant_name(rel, *stat, w)).is_file() for w in widths
    )


def _record(item: Item, rel: str, res: photo_thumb.SetResult) -> ItemResult:
    """Store the outcome of ``make_set`` in ``media_meta``; the item's result."""
    if res.reason is not None:
        if res.reason in _TERMINAL_REASONS and res.stat is not None:
            media_meta.put(
                media_meta.MetaRow(
                    rel,
                    f"{res.stat[0]}:{res.stat[1]}",
                    item.kind,
                    None,
                    None,
                    None,
                    None,
                    "failed",
                    res.reason,  # a failed row always carries its reason
                    None,
                    None,
                )
            )
        _item_failed(item.kind, res.reason)
        return ItemResult("failed")
    if res.placeholder is not None and res.stat is not None:
        r, g, b = res.placeholder.rgb
        width, height = res.size if res.size is not None else (None, None)
        media_meta.put(
            media_meta.MetaRow(
                rel,
                f"{res.stat[0]}:{res.stat[1]}",
                item.kind,
                width,
                height,
                (r << 16) | (g << 8) | b,
                res.placeholder.blur,
                "ready",
                None,
                None,  # poster=None keeps the stored poster state
                None,
            )
        )
    written = 0
    for path in res.written.values():
        try:
            written += path.stat().st_size
        except OSError:  # evicted at once by another writer: nothing to count
            continue
    return ItemResult("done", written)


def _shell_poster(
    path: Path, rel: str, key: str, row: media_meta.MetaRow | None
) -> Path | None:
    """A poster from the Shell, or ``None`` (the video waits for a client capture).

    ``row`` is the meta row of this version, if any. Never the Shell for a
    Shell-failed (``poster='failed'``) or crash-suspect version; a ``none``
    row is retried. Without a usable Shell the row becomes ``poster='none'``.
    """
    if row is not None and (
        row.poster == "failed" or row.reason == media_meta.SHELL_CRASH_SUSPECT
    ):
        return None
    if win_shell_thumb.available() and not video_poster.shell_state()["off"]:
        return video_poster.generate_shell(path, rel)
    if row is None or row.poster != "none":
        media_meta.set_poster(rel, key, "none", "shell")
    return None


def _process(item: Item, rel: str, st: os.stat_result) -> ItemResult:
    key = media_meta.stat_key_of(st)
    stat = (st.st_size, st.st_mtime_ns)
    found = media_meta.get_many([rel]).get(rel)
    row = found if found is not None and found.stat_key == key else None
    fresh = row is not None and not media_meta.placeholder_pending(row)
    if fresh and row is not None and row.status == "failed":
        return ItemResult("skipped")  # a terminal failure of this version
    cache = photo_thumb.cache_dir()
    if fresh and _all_present(rel, stat, item.widths, cache):
        return ItemResult("skipped")  # one stat, no decode
    if item.kind == "picture":
        res = photo_thumb.make_set(
            item.path, rel, item.widths, cache, need_placeholder=not fresh
        )
        return _record(item, rel, res)
    poster = video_poster.poster_for_stat(rel, *stat)
    if poster is None:
        poster = _shell_poster(item.path, rel, key, row)
        if poster is None:
            return ItemResult("waiting", rel=rel)
    res = photo_thumb.make_set(
        poster,
        rel,
        item.widths,
        cache,
        formats=("WEBP",),
        need_placeholder=not fresh,
        key_stat=stat,  # keyed by the video, not the poster
    )
    if res.reason in _TERMINAL_REASONS:
        # A broken poster file (our own cache): drop it and mark the poster
        # ``none``, so a Shell retry or a client capture can replace it. The
        # video is not marked failed: the video itself was never decoded.
        poster.unlink(missing_ok=True)
        media_meta.set_poster(rel, key, "none", "shell")
        _item_failed(item.kind, "bad_poster")
        return ItemResult("waiting", rel=rel)
    return _record(item, rel, res)


def default_process(item: Item) -> ItemResult:
    """Make one file's variants, placeholder and (for a video) poster. Blocking; never raises.

    Checks ``shutdown_state.shutdown_event()`` first (``skipped`` once
    shutdown began). See the module docstring for the rules.
    """
    if shutdown_state.shutdown_event().is_set():
        return ItemResult("skipped")
    try:
        rel = photo_thumb.archive_rel(item.root, item.path)
        st = item.path.stat()
    except OSError as e:
        _item_failed(item.kind, "unavailable", e)
        return ItemResult("failed")
    except ValueError as e:  # outside the output dir
        _item_failed(item.kind, "error", e)
        return ItemResult("failed")
    try:
        return _process(item, rel, st)
    except Exception as e:  # noqa: BLE001 - one file must never stop the pass
        _item_failed(item.kind, "error", e)
        return ItemResult("failed")


def _safe_process(process: ProcessFn, item: Item) -> ItemResult:
    try:
        return process(item)
    except Exception as e:  # noqa: BLE001 - an injected process_fn may raise
        _item_failed(item.kind, "error", e)
        return ItemResult("failed")


# --- the worker thread --------------------------------------------------------------------


def _deliver(
    loop: asyncio.AbstractEventLoop,
    fut: asyncio.Future[Any],
    results: Any,
    error: BaseException | None = None,
) -> None:
    """Complete ``fut`` on its loop (``error`` raises there); dropped when it was cancelled or the loop closed."""

    def complete() -> None:
        if fut.done():
            return
        if error is not None:
            fut.set_exception(error)
        else:
            fut.set_result(results)

    try:
        loop.call_soon_threadsafe(complete)
    except RuntimeError:  # the loop closed (shutdown): nobody waits any more
        pass


_Job = tuple[Callable[[], Any], asyncio.AbstractEventLoop, "asyncio.Future[Any]"]


class _Worker:
    """The ``media_pregen`` daemon thread: runs batches, stops before the next file."""

    def __init__(
        self, process: ProcessFn, factory: Callable[..., threading.Thread]
    ) -> None:
        self._process = process
        self._jobs: queue.SimpleQueue[_Job | None] = queue.SimpleQueue()
        self._abandoned = threading.Event()
        self.thread = factory(target=self._run, name="media_pregen", daemon=True)
        self.thread.start()

    def _run(self) -> None:
        low_priority.enter_background_mode()
        while True:
            job = self._jobs.get()
            if job is None:
                return
            work, loop, fut = job
            try:
                result = work()
            except Exception as e:  # noqa: BLE001 - a listing step failed: raise it on the loop
                _deliver(loop, fut, None, e)
                continue
            _deliver(loop, fut, result)

    def _batch(self, batch: list[Item]) -> list[ItemResult]:
        stop = shutdown_state.shutdown_event()
        results: list[ItemResult] = []
        for item in batch:
            if self._abandoned.is_set() or stop.is_set():
                break
            results.append(_safe_process(self._process, item))
        return results

    def submit(
        self,
        batch: list[Item],
        loop: asyncio.AbstractEventLoop,
        fut: asyncio.Future[list[ItemResult]],
    ) -> None:
        self._jobs.put((lambda: self._batch(batch), loop, fut))

    def call(
        self,
        fn: Callable[[], Any],
        loop: asyncio.AbstractEventLoop,
        fut: asyncio.Future[Any],
    ) -> None:
        """Run ``fn`` (one short blocking step) on the thread; its result or error completes ``fut``."""
        self._jobs.put((fn, loop, fut))

    def abandon(self) -> None:
        """Stop before the next file and exit after the current one (if it ever returns)."""
        self._abandoned.set()
        self._jobs.put(None)


# --- the scheduler -----------------------------------------------------------------------


class _PassAborted(Exception):
    """The caches were cleared while a pass ran: drop it (the passes are re-requested)."""


def _log_pass(
    service: str,
    phase: str,
    queued: int,
    counts: Counter[str],
    start: float,
    reason: str | None = None,
) -> None:
    fields: dict[str, Any] = {
        "service": service,
        "phase": phase,
        "queued": queued,
        "done": counts["done"],
        "skipped": counts["skipped"],
        "failed": counts["failed"],
        "waiting": counts["waiting"],
        "bytes": counts["bytes"],
        "elapsed_ms": round((time.perf_counter() - start) * 1000),
    }
    if reason is not None:
        fields["reason"] = reason
    logger.info("media_pregen_pass", **fields)


class MediaPregen:
    """The pre-generation worker (see the module). Every dependency is injectable for tests.

    ``services`` are service ids (unknown ones are kept, ordered last);
    ``is_busy`` returns the pause reason (default :func:`default_is_busy`
    with ``clock``); ``sleep`` paces the task; ``enumerate_fn(service,
    output_dir)`` gives the phases; ``process_fn(item)`` runs on the thread;
    ``thread_factory`` makes it; ``output_dir_fn`` is blocking (run in a
    worker thread); ``oshi_fn`` gives the oshi service ids (default
    :func:`default_oshi_services`).
    """

    def __init__(
        self,
        services: Sequence[str],
        *,
        is_busy: IsBusyFn | None = None,
        clock: ClockFn = time.monotonic,
        sleep: SleepFn = asyncio.sleep,
        enumerate_fn: EnumerateFn | None = None,
        process_fn: ProcessFn | None = None,
        thread_factory: Callable[..., threading.Thread] = threading.Thread,
        output_dir_fn: Callable[[], Path] | None = None,
        oshi_fn: OshiFn | None = None,
    ) -> None:
        from backend.services.sync_coordinator import order_services

        self._services = order_services(services)
        self._known = set(self._services)
        self._clock = clock
        self._is_busy: IsBusyFn = (
            is_busy if is_busy is not None else (lambda: default_is_busy(self._clock))
        )
        self._sleep = sleep
        self._enumerate = enumerate_fn or default_enumerate
        self._process = process_fn or default_process
        self._thread_factory = thread_factory
        self._output_dir = output_dir_fn or media_meta._output_dir
        self._oshi = oshi_fn or default_oshi_services
        # hints, requests, the cooldown memo and the progress (any thread)
        self._lock = threading.Lock()
        self._hints: dict[str, str] = {}  # rel -> service, in arrival order
        self._requested: list[str] = []
        self._cooldown: dict[str, float] = {}
        self._progress: dict[str, list[int]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        # bound to the loop on first use (Python 3.10+)
        self._wake = asyncio.Event()
        self._idle = asyncio.Event()
        self._task: asyncio.Task[None] | None = None
        self._worker: _Worker | None = None
        self._root: Path | None = None
        self._full_pass_due = True
        self._stopping = False
        self._state = "stopped"
        self._paused_reason: str | None = None
        self._paused_at = 0.0
        self._shell_off_seen = False
        self._thumbs_full = False
        # Set by _run_batch when a batch made no variants (fill line) or was lost
        # to the watchdog; _run_phase then keeps a blog listing as not done.
        self._phase_degraded = False
        self._generation = 0  # bumped by clear(): the pass in flight is dropped
        self._turn_generation = 0
        # service -> the blog listing signature of its last completed blog phase
        self._blog_sig: dict[str, tuple[str, int, int, int]] = {}
        # service -> the persisted form loaded at start (trusted while the
        # gallery version has not moved since; see the module)
        self._loaded_sig: dict[str, tuple[str, int, int]] = {}
        # Each service's gallery version when the worker started (D-M4, N3).
        self._start_versions: dict[str, int] = {}

    # --- public ---------------------------------------------------------------------

    def start(self) -> None:
        """Start the task on the running loop (once)."""
        if self._task is not None:
            return
        self._loop = asyncio.get_running_loop()
        from backend.services import blog_service

        self._start_versions = {
            s: blog_service.gallery_version(s) for s in get_all_services()
        }
        self._shell_off_seen = bool(video_poster.shell_state()["off"])
        self._set_state("running")
        self._task = self._loop.create_task(self._main(), name="media_pregen")

    async def stop(self) -> None:
        """Cancel the task and wait at most :data:`STOP_TIMEOUT_S` for the thread.

        A thread still stuck in a call is abandoned (logged ``abandoned=True``).
        A no-op before :meth:`start`.
        """
        task = self._task
        if task is None:
            return
        self._stopping = True
        deadline = time.monotonic() + STOP_TIMEOUT_S
        worker = self._worker
        if worker is not None:
            worker.abandon()
        if not task.done():
            task.cancel()
            await asyncio.wait({task}, timeout=STOP_TIMEOUT_S)
        abandoned = False
        if worker is not None:
            remaining = max(0.0, deadline - time.monotonic())
            await asyncio.to_thread(worker.thread.join, remaining)
            abandoned = worker.thread.is_alive()
        self._set_state("stopped", abandoned=abandoned)

    def request(self, service: str) -> None:
        """Ask for a pass over ``service`` (an unknown service is ignored). Thread-safe."""
        if service not in self._known:
            return
        with self._lock:
            if service not in self._requested:
                self._requested.append(service)
        self._wake_up()

    def hint(self, service: str, rels: Sequence[str]) -> None:
        """Queue ``rels`` (``archive_rel`` keys) before the pass's next batch.

        Cheap, non-blocking and thread-safe (``media_meta`` calls it on the
        loop). Dropped: an unknown service, a rel outside that service's
        folder, a rel that is neither picture nor video, a rel already
        queued, a video cooling down (:data:`HINT_COOLDOWN_S`) and anything
        past :data:`HINTS_MAX`.
        """
        if service not in self._known or not rels:
            return
        prefix = get_service_display_name(service) + "/"
        now = self._clock()
        added = False
        with self._lock:
            for rel in rels:
                if len(self._hints) >= HINTS_MAX:
                    break
                if (
                    rel in self._hints
                    or not rel.startswith(prefix)
                    or media_meta.kind_of(Path(PurePosixPath(rel).name)) is None
                ):
                    continue
                cooled = self._cooldown.get(rel)
                if cooled is not None and now - cooled < HINT_COOLDOWN_S:
                    continue
                self._hints[rel] = service
                added = True
        if added:
            self._wake_up()

    def pending_hints(self) -> int:
        with self._lock:
            return len(self._hints)

    def status_snapshot(self) -> dict[str, Any]:
        """``state``, ``paused_reason`` and per-service ``done`` / ``total``. No IO; any thread."""
        with self._lock:
            services = {
                s: {"done": d, "total": t} for s, (d, t) in self._progress.items()
            }
        return {
            "state": self._state,
            "paused_reason": self._paused_reason,
            "services": services,
        }

    async def wait_idle(self) -> None:
        """Return once the worker is idle with nothing queued, or its task ended (tests)."""
        while True:
            await self._idle.wait()
            if not self._has_work() or self._task is None or self._task.done():
                return
            await asyncio.sleep(0)

    async def clear(self) -> int:
        """Delete both caches and the meta rows at any point, then pass over everything again.

        Safe mid-pass: the pass in flight is dropped (a generation counter),
        and the batch in flight is abandoned, so it stops after its current
        file instead of being waited for. The requested passes then start
        from scratch. Returns the bytes freed (see :func:`clear_caches`).
        """
        if self._task is None:
            return await asyncio.to_thread(_clear_files)
        self._generation += 1
        worker, self._worker = self._worker, None
        if worker is not None:
            worker.abandon()
        freed = await asyncio.to_thread(_clear_files)
        with self._lock:
            self._progress.clear()
            self._cooldown.clear()
        self._blog_sig.clear()  # the blog thumbnails are gone too: list them again
        self._loaded_sig.clear()  # (and _clear_files emptied the persisted ones)
        for service in self._services:
            self.request(service)
        return freed

    # --- the task -------------------------------------------------------------------

    def _has_work(self) -> bool:
        with self._lock:
            return bool(self._hints) or bool(self._requested)

    def _wake_up(self) -> None:
        loop = self._loop
        if loop is None:
            return
        try:
            loop.call_soon_threadsafe(self._wake.set)
        except RuntimeError:  # the loop closed (shutdown)
            pass

    def _set_state(self, state: str, **extra: Any) -> None:
        if state == self._state:
            return
        self._state = state
        logger.info("media_pregen_state", state=state, **extra)

    def _cool(self, rel: str) -> None:
        now = self._clock()
        with self._lock:
            if len(self._cooldown) >= COOLDOWN_MAX:
                self._cooldown = {
                    r: t for r, t in self._cooldown.items() if now - t < HINT_COOLDOWN_S
                }
                while len(self._cooldown) >= COOLDOWN_MAX:
                    self._cooldown.pop(next(iter(self._cooldown)))
            self._cooldown[rel] = now

    def _recover(self) -> None:
        """Startup, blocking: Shell crash recovery (one UPDATE), then the persisted blog signatures."""
        recovered = media_meta.recover_pending()
        if recovered:
            logger.info("media_pregen_recovered", count=recovered)
        self._loaded_sig, bad = _load_blog_sigs()
        logger.info(
            "media_pregen_blog_sig",
            state="loaded",
            count=len(self._loaded_sig),
            bad=bad,
        )

    def _measure(self) -> None:
        """Measure both caches once (a directory scan), after the startup delay."""
        photo_thumb.cache_total(photo_thumb.cache_dir())
        photo_thumb.cache_total(video_poster.poster_dir())

    async def _turn(self) -> bool | None:
        """One unit of work: ``True`` again, ``False`` stop, ``None`` nothing to do.

        A :meth:`clear` during the turn makes every later batch of it raise
        :class:`_PassAborted` (``_turn_generation`` no longer matches).
        """
        self._turn_generation = self._generation
        requested, rest = self._take_services()
        if requested or rest:
            return await self._run_pass(await self._order(requested, rest))
        if self._has_work():
            return await self._step([])
        return None

    async def _main(self) -> None:
        try:
            await asyncio.to_thread(self._recover)
            await self._sleep(STARTUP_DELAY_S)
            await asyncio.to_thread(self._measure)
            while not self._stopping and not shutdown_state.is_shutting_down():
                self._wake.clear()
                try:
                    outcome = await self._turn()
                except _PassAborted:  # the caches were cleared: start over
                    continue
                except Exception as e:  # noqa: BLE001 - logged; the worker carries on
                    logger.warning("media_pregen_failed", error_type=type(e).__name__)
                    continue
                if outcome is False:
                    break
                if outcome:
                    continue
                self._set_state("idle")
                self._idle.set()
                await self._wake.wait()
                self._idle.clear()
                self._root = None  # re-read the output dir after a quiet spell
                self._set_state("running")
        finally:
            if not self._stopping:  # stop() logs its own (with ``abandoned``)
                self._set_state("stopped")
            self._idle.set()

    def _take_services(self) -> tuple[list[str], list[str]]:
        """``(requested, rest)`` of this pass, each in the stable service order."""
        with self._lock:
            requested = list(self._requested)
            self._requested.clear()
        first = [s for s in self._services if s in requested]
        if self._full_pass_due:
            self._full_pass_due = False
            return first, [s for s in self._services if s not in requested]
        return first, []

    async def _order(self, requested: list[str], rest: list[str]) -> list[str]:
        """The pass order: requested first, then the rest; oshi first within each (see the module)."""
        try:
            oshi = set(await self._oshi()) & self._known
        except Exception as e:  # noqa: BLE001 - an injected oshi_fn may raise
            logger.warning("media_pregen_oshi_failed", error_type=type(e).__name__)
            oshi = set()

        def oshi_first(group: list[str]) -> list[str]:
            return [s for s in group if s in oshi] + [s for s in group if s not in oshi]

        ordered = oshi_first(requested) + oshi_first(rest)
        logger.info("media_pregen_order", services=ordered, oshi=len(oshi))
        return ordered

    async def _ready(self) -> bool:
        """Wait while the pause predicate holds; ``False`` when the worker must stop.

        ``budget_full`` does not pause: the thumbnail cache is at its fill
        line, so batches run without new variants (placeholders and Shell
        posters only; :meth:`_run_batch`). It is logged once per change
        (``media_pregen_budget state=full|ok``).
        """
        while True:
            if self._stopping or shutdown_state.is_shutting_down():
                return False
            reason = self._is_busy()
            if reason == "shutdown":
                return False
            full = reason == "budget_full"
            if full or reason is None:
                if full != self._thumbs_full:
                    self._thumbs_full = full
                    logger.info("media_pregen_budget", state="full" if full else "ok")
                if self._paused_reason is not None:
                    logger.info(
                        "media_pregen_pause",
                        state="resumed",
                        reason=self._paused_reason,
                        paused_ms=round((self._clock() - self._paused_at) * 1000),
                    )
                    self._paused_reason = None
                    self._set_state("running")
                return True
            if reason != self._paused_reason:
                if self._paused_reason is None:
                    self._paused_at = self._clock()
                logger.info(
                    "media_pregen_pause", state="paused", reason=reason, paused_ms=0
                )
                self._paused_reason = reason
                self._set_state("paused")
            await self._sleep(POLL_PAUSED_S)

    async def _root_dir(self) -> Path:
        if self._root is None:
            self._root = await asyncio.to_thread(self._output_dir)
        return self._root

    async def _run_pass(self, services: list[str]) -> bool:
        """Message media (phases 0-3) of every service, then every blog phase, both in ``services`` order."""
        blogs: list[tuple[str, Phase]] = []
        for service in services:
            if not await self._ready():
                return False
            self._root = None
            root = await self._root_dir()
            phases = await self._enumerate(service, root)
            with self._lock:
                self._progress[service] = [0, sum(len(p.items) for p in phases)]
            for phase in phases:
                if phase.name == PHASE_BLOGS:
                    blogs.append((service, phase))  # after every service's messages
                elif not await self._run_phase(service, phase):
                    return False
        for service, phase in blogs:
            if not await self._run_phase(service, phase):
                return False
        return True

    async def _run_phase(self, service: str, phase: Phase) -> bool:
        start = time.perf_counter()
        counts: Counter[str] = Counter()
        signature = None
        if phase.source is not None:
            expanded = await self._expand_blogs(phase.source)
            if expanded is None:
                return False
            phase, signature = expanded
            with self._lock:
                entry = self._progress.get(service)
                if entry is not None:
                    entry[1] += len(phase.items)
        if phase.reason is not None:
            _log_pass(service, phase.name, 0, counts, start, phase.reason)
            return True
        items = list(phase.items)
        self._phase_degraded = False
        for i in range(0, len(items), PREGEN_BATCH):
            if not await self._step(items[i : i + PREGEN_BATCH], counts, service):
                return False
        _log_pass(service, phase.name, len(items), counts, start)
        if signature is None:
            return True
        if self._phase_degraded or counts["failed"] > 0:
            # Placeholders only (fill line), a batch lost to the watchdog or a
            # failed item: the listing is not done, so it is neither remembered
            # nor persisted, and the next pass walks it again.
            logger.info("media_pregen_blog_sig", state="skipped", reason="degraded")
            return True
        # Completed: an unchanged listing is skipped next time.
        self._blog_sig[service] = signature
        await self._save_blog_sig(service, signature)
        return True

    async def _save_blog_sig(
        self, service: str, signature: tuple[str, int, int, int]
    ) -> None:
        """Persist a completed blog phase's signature (see the module); never raises."""
        from backend.services import blog_service as bs

        if bs.gallery_version(service) != signature[3]:
            logger.info("media_pregen_blog_sig", state="skipped", reason="blog_written")
            return
        await asyncio.to_thread(
            media_meta.kv_set, BLOG_SIG_PREFIX + service, _sig_value(signature)
        )
        _note_persisted(service)
        if (
            bs.gallery_version(service) != signature[3]
            or self._turn_generation != self._generation
        ):  # a blog write or a clear raced the save: it must not outlive them
            await asyncio.to_thread(
                media_meta.kv_delete_prefix, BLOG_SIG_PREFIX + service
            )
            logger.info("media_pregen_blog_sig", state="skipped", reason="raced")
            return
        logger.info("media_pregen_blog_sig", state="saved", count=1)

    def _unchanged(self, service: str, signature: tuple[str, int, int, int]) -> bool:
        """The listing equals the last completed one (this session, or persisted and still valid)."""
        if self._blog_sig.get(service) == signature:
            return True
        from backend.services import blog_service as bs

        return bs.gallery_version(service) == self._start_versions.get(
            service
        ) and self._loaded_sig.get(service) == _sig_form(signature)

    async def _call(self, fn: Callable[[], Any]) -> Any:
        """Run one short blocking step on the worker thread (background priority).

        Raises ``TimeoutError`` after :data:`SCAN_STEP_TIMEOUT_S` (the thread is
        then abandoned, like a hung batch) and :class:`_PassAborted` when the
        caches were cleared meanwhile.
        """
        loop = asyncio.get_running_loop()
        worker = self._worker
        if worker is None:
            worker = self._worker = _Worker(self._process, self._thread_factory)
        fut: asyncio.Future[Any] = loop.create_future()
        worker.call(fn, loop, fut)
        try:
            result = await asyncio.wait_for(fut, SCAN_STEP_TIMEOUT_S)
        except asyncio.TimeoutError:
            logger.warning(
                "media_pregen_pause", state="paused", reason="batch_hung", paused_ms=0
            )
            worker.abandon()
            self._worker = None
            raise
        if self._turn_generation != self._generation:
            raise _PassAborted
        return result

    async def _expand_blogs(
        self, source: BlogSource
    ) -> tuple[Phase, tuple[str, int, int, int] | None] | None:
        """List the blog phase's items step by step; ``None`` when the worker must stop.

        Each step (the index read, one member's folder listing, then
        :data:`BLOG_SCAN_CHUNK` ``blog.json`` reads) runs on the worker thread
        after a pause check (:meth:`_ready`). Archive paths come straight from
        the scan, under the worker's output dir. Returns the phase and the
        listing signature (``None`` for a no-op phase): ``reason=unchanged``
        when the signature matches the last completed blog phase,
        ``no_index`` without an index, ``failed`` on an error
        (``media_pregen_blogs_failed``, codes only).
        """
        from functools import partial

        from backend.services import blog_service as bs

        service = source.service
        try:
            if not await self._ready():
                return None
            root = await self._root_dir()
            version = bs.gallery_version(service)
            index = await self._call(partial(bs.gallery_index, service, None, root))
            if index is None:
                return Phase(PHASE_BLOGS, [], reason="no_index"), None
            cached: list[bs.CachedBlog] = []
            for member in index.members:
                if not await self._ready():
                    return None
                cached += await self._call(
                    partial(bs.gallery_member_blogs, index.base, member)
                )
            signature = bs.gallery_signature(index, len(cached), version)
            if self._unchanged(service, signature):
                return Phase(PHASE_BLOGS, [], reason="unchanged"), None
            cached = await self._call(partial(bs.gallery_newest_first, cached))
            items: list[Item] = []
            widths = photo_thumb.PREGEN_WIDTHS
            for i in range(0, len(cached), BLOG_SCAN_CHUNK):
                if not await self._ready():
                    return None
                found, _skipped = await self._call(
                    partial(
                        bs.gallery_local_images,
                        service,
                        cached[i : i + BLOG_SCAN_CHUNK],
                    )
                )
                items.extend(Item(root, img.path, "picture", widths) for img in found)
            return Phase(PHASE_BLOGS, items), signature
        except _PassAborted:
            raise
        except Exception as e:  # noqa: BLE001 - the other phases already ran
            logger.warning(
                "media_pregen_blogs_failed",
                service=service,
                error_type=type(e).__name__,
            )
            return Phase(PHASE_BLOGS, [], reason="failed"), None

    def _take_hints(self, root: Path) -> list[Item]:
        with self._lock:
            rels = list(itertools.islice(self._hints, PREGEN_BATCH))
            for rel in rels:
                del self._hints[rel]
        items = []
        for rel in rels:
            kind = media_meta.kind_of(Path(PurePosixPath(rel).name))
            if kind is not None:  # checked in hint(); kept for the type
                items.append(Item(root, root / rel, kind, photo_thumb.PREGEN_WIDTHS))
        return items

    async def _step(
        self,
        batch: list[Item],
        counts: Counter[str] | None = None,
        service: str | None = None,
    ) -> bool:
        """Hints first (they jump the queue at every batch boundary), then ``batch``."""
        while self.pending_hints():
            hinted = self._take_hints(await self._root_dir())
            if not await self._run_batch(hinted, None, None):
                return False
        if batch:
            return await self._run_batch(batch, counts, service)
        return True

    async def _run_batch(
        self, batch: list[Item], counts: Counter[str] | None, service: str | None
    ) -> bool:
        if not await self._ready():
            return False
        if self._turn_generation != self._generation:
            raise _PassAborted  # cleared since this pass began: it is stale
        if self._thumbs_full:  # at the fill line: placeholders and posters only
            batch = [replace(i, widths=()) for i in batch]
            self._phase_degraded = True
        started = self._clock()
        results = await self._execute(batch)
        work = self._clock() - started
        if self._turn_generation != self._generation:
            raise _PassAborted  # cleared during this batch
        if results is None:  # the watchdog fired; this batch is lost for the pass
            self._phase_degraded = True
            return True
        for res in results:
            if counts is not None:
                counts[res.outcome] += 1
                counts["bytes"] += res.bytes
            if service is not None:
                with self._lock:
                    entry = self._progress.get(service)
                    if entry is not None:
                        entry[0] += 1
            if res.outcome == "waiting" and res.rel is not None:
                self._cool(res.rel)
        self._note_shell()
        await self._sleep(max(PREGEN_MIN_PAUSE_S, PREGEN_DUTY_SLEEP * work))
        return True

    def _note_shell(self) -> None:
        """Log ``shell_hung`` once when ``generate_shell``'s breaker opened during a batch."""
        if self._shell_off_seen or not video_poster.shell_state()["off"]:
            return
        self._shell_off_seen = True
        logger.warning(
            "media_pregen_pause", state="paused", reason="shell_hung", paused_ms=0
        )

    async def _execute(self, batch: list[Item]) -> list[ItemResult] | None:
        """Run ``batch`` on the thread under the watchdog; ``None`` when it hung."""
        loop = asyncio.get_running_loop()
        worker = self._worker
        if worker is None:
            worker = self._worker = _Worker(self._process, self._thread_factory)
        fut: asyncio.Future[list[ItemResult]] = loop.create_future()
        worker.submit(batch, loop, fut)
        timeout = video_poster.SHELL_TIMEOUT_S * max(1, len(batch)) + WATCHDOG_GRACE_S
        try:
            return await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            # Only a batch with a video can have hung in the Shell; a stall on
            # pictures (a sleeping archive drive) leaves the Shell on.
            if any(i.kind == "video" for i in batch):
                self._shell_off_seen = True
                logger.warning(
                    "media_pregen_pause",
                    state="paused",
                    reason="shell_hung",
                    paused_ms=0,
                )
                video_poster.disable_shell("pregen_watchdog")
            else:
                logger.warning(
                    "media_pregen_pause",
                    state="paused",
                    reason="batch_hung",
                    paused_ms=0,
                )
            worker.abandon()
            self._worker = None
            return None


# --- persisted blog signatures --------------------------------------------------------------


def _sig_form(signature: tuple[str, int, int, int]) -> tuple[str, int, int]:
    """The persisted form: a hash of the blogs base (never the path), the index mtime and the count."""
    import hashlib

    base = hashlib.sha256(signature[0].encode("utf-8")).hexdigest()[:16]
    return (base, signature[1], signature[2])


def _sig_value(signature: tuple[str, int, int, int]) -> str:
    import json

    return json.dumps(list(_sig_form(signature)))


def _load_blog_sigs() -> tuple[dict[str, tuple[str, int, int]], int]:
    """The persisted signatures by service and the count of unreadable ones. Blocking."""
    import json

    out: dict[str, tuple[str, int, int]] = {}
    bad = 0
    for key, value in media_meta.kv_get_prefix(BLOG_SIG_PREFIX).items():
        try:
            base, mtime_ns, count = json.loads(value)
            if not (
                isinstance(base, str)
                and isinstance(mtime_ns, int)
                and isinstance(count, int)
            ):
                raise ValueError
        except (ValueError, TypeError):
            bad += 1
            continue
        out[key[len(BLOG_SIG_PREFIX) :]] = (base, mtime_ns, count)
    return out, bad


_forgotten: set[str] = set()
"""Services whose persisted row :func:`forget_blog_signatures` deleted, none saved since."""


def _note_persisted(service: str) -> None:
    _forgotten.discard(service)


def forget_blog_signatures(service: str | None = None) -> None:
    """A blog of ``service`` was written: delete its persisted blog signature.

    Called by ``blog_service.invalidate_gallery``. Only that service's row
    goes (N3: the other services' listings are unchanged); ``None`` (a write
    of unknown service) deletes every row. Cheap and never raises. A
    service's delete runs once per saved signature: on the default executor
    when called on the event loop, inline otherwise (the caller is then
    already off the loop). Logs ``media_pregen_blog_sig state=forgotten``
    with ``scope=service|all`` (never the service name).
    """
    if service is not None:
        if service in _forgotten:
            return
        _forgotten.add(service)
    key = BLOG_SIG_PREFIX if service is None else BLOG_SIG_PREFIX + service
    logger.info(
        "media_pregen_blog_sig",
        state="forgotten",
        scope="all" if service is None else "service",
    )
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:  # not on the loop: already off it, delete inline
        media_meta.kv_delete_prefix(key)
        return
    try:
        loop.run_in_executor(None, media_meta.kv_delete_prefix, key)
    except RuntimeError as e:  # the executor shut down (app exit): delete inline
        logger.info(
            "media_pregen_blog_sig",
            state="forgotten",
            reason="inline",
            error_type=type(e).__name__,
        )
        media_meta.kv_delete_prefix(key)


# --- clearing ------------------------------------------------------------------------------


def _clear_files() -> int:
    """Delete both cache dirs' files and every meta row; the bytes freed. Blocking.

    Only regular files directly in ``photo_thumbs/`` and ``video_posters/``
    are removed (never recursive, never a symlink target). A file held by a
    reader (Windows) is skipped; LRU eviction removes it later.
    """
    freed = count = 0
    for root in (photo_thumb.cache_dir(), video_poster.poster_dir()):
        try:
            with os.scandir(root) as it:
                entries = list(it)
        except FileNotFoundError:
            continue
        for e in entries:
            try:
                if not e.is_file(follow_symlinks=False):
                    continue
                size = e.stat(follow_symlinks=False).st_size
                Path(e.path).unlink()
            except OSError:
                continue
            freed += size
            count += 1
    media_meta.clear()
    photo_thumb.reset_cache_state()
    logger.info("media_pregen_cache_cleared", freed_bytes=freed, count=count)
    return freed


# --- the module API ------------------------------------------------------------------------

_active: MediaPregen | None = None


def start(services: Sequence[str], **kwargs: Any) -> MediaPregen:
    """Create and start the app's worker on the running loop (once; later calls return it)."""
    global _active
    if _active is None:
        _active = MediaPregen(services, **kwargs)
        _active.start()
    return _active


async def stop() -> None:
    """Stop the worker (the ``_writer_stops`` hook). A no-op when none runs."""
    global _active
    worker, _active = _active, None
    if worker is not None:
        await worker.stop()


def request(service: str) -> None:
    """Ask for a pass over ``service``. Thread-safe; a no-op without a worker."""
    if _active is not None:
        _active.request(service)


def request_safely(service: str) -> None:
    """:func:`request` that never raises (sync and blog-backup hooks).

    A failure is logged as ``media_pregen_request_failed`` (``service``,
    ``error_type``).
    """
    try:
        request(service)
    except Exception as e:  # noqa: BLE001 - a hint must never fail its caller
        logger.warning(
            "media_pregen_request_failed", service=service, error_type=type(e).__name__
        )


def hint(service: str, rels: Sequence[str]) -> None:
    """Queue ``rels`` first (see :meth:`MediaPregen.hint`). A no-op without a worker."""
    if _active is not None:
        _active.hint(service, rels)


def note_foreground() -> None:
    """A gallery is in use: the worker yields for :data:`IDLE_AFTER_S`. One clock read."""
    global _last_foreground
    worker = _active
    _last_foreground = worker._clock() if worker is not None else time.monotonic()


def status() -> dict[str, Any]:
    """``GET /api/media/status`` (see the plan's shared contracts). Blocking: run it in a thread.

    ``state`` is ``stopped`` when no worker runs. ``posters.pending_client``
    counts videos waiting for a client capture (``failed`` or ``none``);
    ``posters.shell_off`` is the session Shell breaker; ``thumbs_full`` is
    true while the thumbnail cache is at the fill line (the worker then makes
    no new variants; Settings shows the cache as full instead of progress).
    """
    worker = _active
    snap = (
        worker.status_snapshot()
        if worker is not None
        else {"state": "stopped", "paused_reason": None, "services": {}}
    )
    counts = media_meta.counts()
    thumbs_bytes = photo_thumb.cache_total(photo_thumb.cache_dir()) or 0
    return {
        **snap,
        "thumbs_full": thumbs_bytes >= PREGEN_FILL_RATIO * photo_thumb.CACHE_CAP_BYTES,
        "posters": {
            "ready": counts["poster_ready"],
            "failed": counts["poster_failed"],
            "pending_client": counts["poster_failed"] + counts["poster_none"],
            "shell_off": bool(video_poster.shell_state()["off"]),
        },
        "cache": {
            "thumbs_bytes": thumbs_bytes,
            "posters_bytes": photo_thumb.cache_total(video_poster.poster_dir()) or 0,
            "thumbs_cap": photo_thumb.CACHE_CAP_BYTES,
            "posters_cap": video_poster.POSTER_CACHE_CAP_BYTES,
        },
    }


async def clear_caches() -> int:
    """``DELETE /api/media/cache``: pause, empty both caches and ``media_meta.db``, resume.

    Returns the bytes freed. Resets the ``photo_thumb`` cache accounting;
    the worker then passes over every service again. Works without a worker.
    """
    worker = _active
    if worker is not None:
        return await worker.clear()
    return await asyncio.to_thread(_clear_files)


def _reset_for_tests() -> None:
    global _active, _last_foreground
    _active = None
    _last_foreground = None
    _forgotten.clear()


__all__ = [
    "Item",
    "ItemResult",
    "MediaPregen",
    "Phase",
    "clear_caches",
    "default_enumerate",
    "default_is_busy",
    "default_oshi_services",
    "default_process",
    "forget_blog_signatures",
    "hint",
    "note_foreground",
    "request",
    "request_safely",
    "start",
    "status",
    "stop",
]
