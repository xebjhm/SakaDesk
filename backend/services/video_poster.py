"""Video poster frames: generated once, cached in their own bounded cache.

A gallery tile of a video shows a still instead of mounting a ``<video>``.
That still is the video's **poster**, one WebP of at most :data:`POSTER_PX`
px per video version, kept under ``<app data dir>/cache/video_posters/``
(:func:`poster_dir`) as ``sha256(rel|size|mtime_ns).webp``
(:func:`poster_name`; the key is the video's ``photo_thumb.archive_rel``
path and stat, so a re-archived video gets a new poster). Once a poster
exists, ``GET /api/content/thumb`` renders the video's thumbnail variants
from it (``photo_thumb.thumbnail``).

**Fallback order** (a tile never breaks):

1. **Windows Shell** (:func:`generate_shell`, background worker only):
   ``win_shell_thumb.shell_thumbnail`` asks the OS thumbnail provider for a
   frame. Windows only; a codec without a provider (HEVC without the Store
   extension), a black frame or a broken provider gives no poster.
2. **Client capture** (:func:`ingest_client`, ``PUT /api/media/poster``):
   the UI grabs a frame of a *visible* tile with ``<video>`` + canvas and
   uploads it. The upload is untrusted: only ``image/webp`` / ``image/jpeg``
   bodies of at most :data:`POSTER_UPLOAD_MAX_BYTES`, opened with the
   :data:`UPLOAD_FORMATS` allowlist, with the pixel bound
   (:data:`UPLOAD_MAX_PIXELS`) and the side bound (:data:`MAX_SIDE`)
   checked from the header before any decode, and always **re-encoded**
   (the client's bytes are never stored). The first poster of a version
   wins; a later upload answers ``exists``.
3. The film tile, then the full player when the user opens it (frontend).

**Crash and hang guards** for the in-process Shell call:

- *crash*: :func:`generate_shell` commits ``media_meta.mark_poster_pending``
  before the call. If the process dies inside the provider, the row stays
  ``pending`` and ``media_meta.recover_pending`` (worker start) turns it into
  ``failed`` with ``reason=shell_crash_suspect``, so that file is never
  given to the Shell again; the client capture covers it.
- *hang*: the call runs on a dedicated daemon thread (background priority;
  it enters a COM apartment only for each call, see ``win_shell_thumb``)
  and is waited for at most :data:`SHELL_TIMEOUT_S`. A timeout marks the
  video ``shell_crash_suspect`` (``media_meta.mark_shell_suspect``: the same
  marker as a crash) and opens a **session circuit breaker**: the hung
  thread is told to stop (it exits if the call ever returns; the late frame
  is dropped), no Shell job starts again until the app restarts, and one
  ``video_poster_shell_off`` breadcrumb is logged. So at most one blocked
  thread exists per process, and every later video falls through to the
  client capture (:func:`shell_state` reports the breaker). A daemon thread
  never blocks process exit.

**One writer, and the file wins.** Shell and client writes (and their meta
updates) are serialised by one lock, and the first poster of a version
wins. Each poster carries its source in an EXIF tag (:data:`SOURCE_TAG`).
Whenever a poster file exists but the meta row disagrees (after a
``media_meta.db`` reset or prune, or a client upload that landed during a
Shell call), the row is repaired to ``ready`` with that source; a Shell
failure never overwrites a client poster.

**Bounded.** Posters are accounted with ``photo_thumb.cache_state_add``
against :data:`POSTER_CACHE_CAP_BYTES` (their own cap, so thumbnail churn
never evicts a poster, which costs a Shell call or a capture to recreate);
the least recently used posters are evicted first. Writes are atomic
(``photo_thumb._write``).

Nothing is ever written to the archive. Logs carry codes only:
``video_poster`` (``source=shell|client``,
``outcome=ready|failed|exists|repaired``, ``reason``, ``error_type``) and
``video_poster_shell_off`` (``reason``, ``hung_threads``).
"""

from __future__ import annotations

import hashlib
import io
import queue
import threading
from dataclasses import dataclass, field
from pathlib import Path

import structlog
from PIL import Image

from backend.services import low_priority, media_meta, photo_thumb, win_shell_thumb

logger = structlog.get_logger(__name__)

POSTER_CACHE_CAP_BYTES = 256 * 1024**2
"""256 MiB. At about 45 KB per 640 px WebP poster this holds ~5,800 videos,
every service's videos with headroom (plan "Cache budget" table). Separate
from the thumbnail cap because a poster is expensive to recreate."""
POSTER_PX = 640
"""Longest side of a stored poster (the largest thumbnail width)."""
POSTER_UPLOAD_MAX_BYTES = 1024**2
"""Largest client upload body (a 640 px WebP / JPEG is far smaller)."""
UPLOAD_MAX_PIXELS = 16_000_000
"""Header pixel bound of an uploaded frame (a 4K frame is 8.3 MP)."""
UPLOAD_FORMATS: tuple[str, ...] = ("WEBP", "JPEG", "PNG")
"""Pillow decoders an upload may be opened with."""
UPLOAD_CONTENT_TYPES = frozenset({"image/webp", "image/jpeg"})
"""Content types an upload may declare."""
MAX_SIDE = win_shell_thumb.MAX_SIDE
"""Largest side of an uploaded frame (the same bound as a Shell bitmap)."""
SHELL_TIMEOUT_S = 20
"""Longest wait for one Shell thumbnail call before the provider counts as hung."""


def _default_poster_dir() -> Path:
    return photo_thumb.cache_dir().parent / "video_posters"


def poster_dir() -> Path:
    """``<app data dir>/cache/video_posters/`` (created on first write)."""
    return _default_poster_dir()


def poster_name(rel_path: str, size: int, mtime_ns: int) -> str:
    """The poster file name of one video version (a hash; the path never appears)."""
    key = f"{rel_path}|{size}|{mtime_ns}"
    return f"{hashlib.sha256(key.encode()).hexdigest()}.webp"


def poster_for_stat(rel_path: str, size: int, mtime_ns: int) -> Path | None:
    """The existing poster of this video version, else ``None``. Blocking.

    A hit is remembered for the eviction order (the file is not touched).
    """
    root = poster_dir()
    path = root / poster_name(rel_path, size, mtime_ns)
    if not path.is_file():
        return None
    photo_thumb._mark_used(root, path.name)
    return path


def poster_path(source: Path, rel_path: str) -> Path | None:
    """The existing poster of ``source``'s current version, else ``None``. Blocking."""
    try:
        st = source.stat()
    except OSError:
        return None
    return poster_for_stat(rel_path, st.st_size, st.st_mtime_ns)


def _log(
    source: str, outcome: str, reason: str | None = None, error_type: str | None = None
) -> None:
    fields: dict[str, str | None] = {
        "source": source,
        "outcome": outcome,
        "reason": reason,
    }
    if error_type is not None:
        fields["error_type"] = error_type
    logger.info("video_poster", **fields)


SOURCE_TAG = 0x0131
"""EXIF ``Software`` tag of a stored poster: ``SakaDesk poster:<shell|client>``."""
_SOURCE_PREFIX = "SakaDesk poster:"
_SOURCES = ("shell", "client")


def _source_exif(source: str) -> bytes:
    exif = Image.Exif()
    exif[SOURCE_TAG] = _SOURCE_PREFIX + source
    return exif.tobytes()


def _source_of(path: Path) -> str:
    """Which source made the poster file (its EXIF tag); ``client`` when unknown. Blocking.

    Reads the WebP header and EXIF chunk only (``formats=("WEBP",)``; no pixel decode).
    """
    try:
        with Image.open(path, formats=("WEBP",)) as img:
            tag = img.getexif().get(SOURCE_TAG)
    except Exception:  # noqa: BLE001 - unreadable or evicted: the safe default
        return "client"
    source = tag[len(_SOURCE_PREFIX) :] if isinstance(tag, str) else ""
    return source if source in _SOURCES else "client"


def _repair(rel_path: str, key: str, path: Path) -> None:
    """Make the meta row say ``ready`` for an existing poster file. Blocking.

    The row can disagree after a ``media_meta.db`` reset or prune, or when a
    Shell attempt ended while a client poster landed. The source comes from
    the file's tag. Nothing is written when the row already says ``ready``
    for this version.
    """
    row = media_meta.get_many([rel_path]).get(rel_path)
    if row is not None and row.stat_key == key and row.poster == "ready":
        return
    source = _source_of(path)
    media_meta.set_poster(rel_path, key, "ready", source)
    _log(source, "repaired")


def _store(img: Image.Image, rel_path: str, stat: tuple[int, int], source: str) -> Path:
    """Downsize to :data:`POSTER_PX` and write atomically (tagged with ``source``).

    Raises ``OSError``. Call under :data:`_write_lock`. Blocking.
    """
    img.thumbnail((POSTER_PX, POSTER_PX), Image.Resampling.LANCZOS)
    root = poster_dir()
    target = root / poster_name(rel_path, *stat)
    size = photo_thumb._write(img, root, target, exif=_source_exif(source))
    photo_thumb.cache_state_add(root, size, POSTER_CACHE_CAP_BYTES)
    return target


# --- the Shell runner (hang guard and circuit breaker) --------------------------------------


@dataclass
class _Job:
    source: Path
    done: threading.Event = field(default_factory=threading.Event)
    image: Image.Image | None = None
    error: BaseException | None = None


class _ShellRunner:
    """One daemon thread at background priority that makes the Shell calls."""

    def __init__(self) -> None:
        self._jobs: queue.Queue[_Job | None] = queue.Queue()
        self.thread = threading.Thread(
            target=self._loop, name="video_poster_shell", daemon=True
        )
        self.thread.start()

    def _loop(self) -> None:
        low_priority.enter_background_mode()
        while True:
            job = self._jobs.get()
            if job is None:
                return
            try:
                job.image = win_shell_thumb.shell_thumbnail(job.source, POSTER_PX)
            except BaseException as e:  # noqa: BLE001 - reported to the waiting caller
                job.error = e
            finally:
                job.done.set()

    def submit(self, job: _Job) -> None:
        self._jobs.put(job)

    def stop(self) -> None:
        """Ask the thread to exit after its current job (a hung one exits if it ever returns)."""
        self._jobs.put(None)


_runner: _ShellRunner | None = None
_hung: _ShellRunner | None = None
"""The abandoned runner after a hang (at most one per process: the breaker opens)."""
_shell_off = False
"""Session circuit breaker: set by the first hang, never reset while the app runs."""
_skipped = 0
_shell_lock = threading.Lock()
"""Serialises Shell jobs (and the breaker state)."""
_write_lock = threading.Lock()
"""Serialises poster writes and their meta updates, Shell and client alike."""


def shell_state() -> dict[str, object]:
    """``{"off": bool, "skipped": int}``: the session breaker, for the status endpoint (M4)."""
    with _shell_lock:
        return {"off": _shell_off, "skipped": _skipped}


def reset_for_tests() -> None:
    """Stop the Shell runner thread, forget a hung one and close the breaker (tests)."""
    global _runner, _hung, _shell_off, _skipped
    with _shell_lock:
        if _runner is not None:
            _runner.stop()
        _runner, _hung, _shell_off, _skipped = None, None, False, 0


def _run_shell_locked(source: Path) -> _Job | None:
    """One Shell call on the runner; ``None`` on a timeout. Call under :data:`_shell_lock`.

    A timeout opens the session breaker: the hung runner is told to stop
    (it exits if the call ever returns; its late frame is dropped) and kept
    as the only abandoned thread, and no Shell job starts again this session.
    """
    global _runner, _hung, _shell_off
    if _runner is None:
        _runner = _ShellRunner()
    job = _Job(source)
    _runner.submit(job)
    if job.done.wait(SHELL_TIMEOUT_S):
        return job
    _runner.stop()
    _hung, _runner, _shell_off = _runner, None, True
    logger.warning("video_poster_shell_off", reason="timeout", hung_threads=1)
    return None


def generate_shell(source: Path, rel_path: str) -> Path | None:
    """Make ``source``'s poster with the Windows Shell; the poster path or ``None``.

    Blocking: call it from the background worker thread only. ``rel_path``
    is the video's ``photo_thumb.archive_rel`` key.

    - Does nothing (``None``, the row untouched) for a non-video, a missing
      source, where the Shell is unavailable, or once the session breaker is
      open (after a hang); the client capture covers those videos.
    - An existing poster is returned without a Shell call, and a meta row
      that disagrees with it is repaired to ``ready``.
    - Otherwise it marks the poster ``pending`` (committed: the crash guard)
      and calls the Shell (hang guard: :data:`SHELL_TIMEOUT_S`). Then, under
      the write lock: a poster that a client upload stored meanwhile wins
      (the row is repaired to ``ready``, never overwritten); a hang marks the
      video ``shell_crash_suspect`` (``media_meta.mark_shell_suspect``) and
      opens the breaker; another failure records ``failed``; a frame is
      written and recorded ``ready`` (source ``shell``); a failed cache
      write records ``none`` so a later pass may retry.

    Never raises.
    """
    global _skipped
    if not photo_thumb.is_video(source) or not win_shell_thumb.available():
        return None
    try:
        st = source.stat()
    except OSError:
        return None
    stat = (st.st_size, st.st_mtime_ns)
    key = media_meta.stat_key_of(st)
    existing = poster_for_stat(rel_path, *stat)
    if existing is not None:
        _repair(rel_path, key, existing)
        return existing
    with _shell_lock:
        if _shell_off:
            _skipped += 1
            return None
        media_meta.mark_poster_pending(rel_path, key)
        job = _run_shell_locked(source)
    with _write_lock:
        made = poster_for_stat(rel_path, *stat)
        if made is not None:  # a client poster landed during the Shell call
            _repair(rel_path, key, made)
            return made
        return _finish_shell(job, rel_path, key, stat)


def _finish_shell(
    job: _Job | None, rel_path: str, key: str, stat: tuple[int, int]
) -> Path | None:
    """Record the Shell outcome (no poster exists yet). Under :data:`_write_lock`."""
    if job is None:
        media_meta.mark_shell_suspect(rel_path, key)
        _log("shell", "failed", "timeout")
        return None
    if job.error is not None or job.image is None:
        media_meta.set_poster(rel_path, key, "failed", "shell")
        if job.error is not None:
            _log("shell", "failed", "error", type(job.error).__name__)
        # job.image is None: shell_thumbnail already logged its reason
        return None
    try:
        target = _store(job.image, rel_path, stat, "shell")
    except OSError as e:
        media_meta.set_poster(rel_path, key, "none", "shell")
        _log("shell", "failed", "write_failed", type(e).__name__)
        return None
    media_meta.set_poster(rel_path, key, "ready", "shell")
    _log("shell", "ready")
    return target


# --- client uploads -----------------------------------------------------------------------


class _TooLarge(Exception):
    """An upload over the pixel or side bound (refused before any decode)."""


def _decode_upload(body: bytes) -> Image.Image:
    """The upload as RGB (transparency over white); raises on any refusal. Blocking."""
    limit = Image.MAX_IMAGE_PIXELS
    max_pixels = UPLOAD_MAX_PIXELS if limit is None else min(limit, UPLOAD_MAX_PIXELS)
    with Image.open(io.BytesIO(body), formats=UPLOAD_FORMATS) as opened:
        w, h = opened.size
        if w * h > max_pixels or w > MAX_SIDE or h > MAX_SIDE:
            raise _TooLarge
        has_alpha = opened.mode in ("RGBA", "LA", "PA") or "transparency" in opened.info
        img = opened.convert("RGBA" if has_alpha else "RGB")
    return photo_thumb._flatten(img)


def ingest_client(
    source: Path, rel_path: str, body: bytes, content_type: str
) -> tuple[str, str | None]:
    """Store a client-captured poster of the video ``source``: ``(outcome, v)``.

    ``outcome`` is ``ready`` (stored; ``v`` is the video's
    ``photo_thumb.version_token``), ``exists`` (this version already has a
    poster; ``v`` too), or a refusal with ``v=None``: ``not_video``,
    ``missing``, ``too_large`` (body over :data:`POSTER_UPLOAD_MAX_BYTES`),
    ``bad_image`` (content type, decode, format or a bound) or
    ``write_failed``. A stored poster is re-encoded WebP of at most
    :data:`POSTER_PX` px and recorded with ``media_meta.set_poster(...,
    "ready", "client")``; on ``exists`` a meta row that disagrees with the
    poster file is repaired to ``ready``. The decode runs outside the write
    lock; the existence check is repeated under it. Blocking; never raises.
    """
    if not photo_thumb.is_video(source):
        _log("client", "failed", "not_video")
        return "not_video", None
    if len(body) > POSTER_UPLOAD_MAX_BYTES:
        _log("client", "failed", "body_too_large")
        return "too_large", None
    try:
        st = source.stat()
    except OSError as e:
        _log("client", "failed", "missing", type(e).__name__)
        return "missing", None
    stat = (st.st_size, st.st_mtime_ns)
    v = photo_thumb.version_token(*stat)
    if content_type.split(";", 1)[0].strip().lower() not in UPLOAD_CONTENT_TYPES:
        _log("client", "failed", "content_type")
        return "bad_image", None
    key = media_meta.stat_key_of(st)
    existing = poster_for_stat(rel_path, *stat)
    if existing is not None:  # cheap pre-check: no decode for a known poster
        return _exists(rel_path, key, existing, v)
    try:  # outside the write lock: uploads of several tiles decode in parallel
        img = _decode_upload(body)
    except _TooLarge:
        _log("client", "failed", "too_large")
        return "bad_image", None
    except Exception as e:  # noqa: BLE001 - untrusted input: any failure is a refusal
        _log("client", "failed", "undecodable", type(e).__name__)
        return "bad_image", None
    with _write_lock:  # first poster wins; no two writers of one version
        existing = poster_for_stat(rel_path, *stat)
        if existing is not None:
            return _exists(rel_path, key, existing, v)
        try:
            _store(img, rel_path, stat, "client")
        except OSError as e:
            _log("client", "failed", "write_failed", type(e).__name__)
            return "write_failed", None
        media_meta.set_poster(rel_path, key, "ready", "client")
    _log("client", "ready")
    return "ready", v


def _exists(rel_path: str, key: str, path: Path, v: str) -> tuple[str, str | None]:
    _repair(rel_path, key, path)
    _log("client", "exists")
    return "exists", v
