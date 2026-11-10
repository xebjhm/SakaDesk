"""Downscaled WebP thumbnails of archived pictures, cached on disk.

The Memories album, On This Day and the day view show thousands of message
pictures as small tiles. Serving the ~1-2 MP originals makes the WebView decode
hundreds of megabytes of bitmaps per screen, so ``GET /api/content/thumb``
serves a WebP no wider or taller than one of :data:`ALLOWED_WIDTHS` instead
(aspect kept, never upscaled, EXIF orientation applied).

- **Pictures only.** A source whose suffix is not in :data:`PICTURE_SUFFIXES`
  (a video, a voice note, anything unknown) gets ``None`` (the route answers
  404 and the frontend falls back to the full media URL) without being opened.
- **Untrusted input.** ``Image.open`` only tries the formats of
  :func:`picture_formats` (JPEG, MPO, PNG, WebP, GIF, plus HEIF / AVIF when a
  plugin provides them), so EPS and other exotic decoders are never reached
  whatever the file holds. The pixel bound :data:`MAX_SOURCE_PIXELS` is checked
  from the header size before any pixel is decoded and is never above Pillow's
  own ``MAX_IMAGE_PIXELS``: a source in Pillow's warning band still makes
  ``Image.open`` emit its ``DecompressionBombWarning`` (Pillow checks the
  header size itself), but it is refused and never decoded. No ``warnings``
  filter is touched (process-wide, not thread-safe). JPEG / MPO are decoded at
  draft scale. Every failure (bomb, decode error, unreadable file) gives
  ``None`` plus a ``memories_skip`` breadcrumb (``view=photo_thumb``,
  ``reason``, ``error_type``) that never carries the path.
- **Cache.** Variants live under ``<app data dir>/cache/photo_thumbs/`` (a
  sibling of the avatar cache), named by a hash of (service-relative path,
  size, ``mtime_ns``, width), so a re-archived file gets a new key. Writes are
  atomic (temp file + ``os.replace``). A variant file is never touched after it
  is written, so its ETag stays stable; hits are remembered in memory instead,
  and when the total size passes :data:`CACHE_CAP_BYTES` the least recently
  used variants (last hit, else creation time) are deleted until it is under
  :data:`CACHE_LOW_WATER` of the cap. The running total is measured once per
  cache dir, then kept in memory; that first pass also deletes temp files older
  than :data:`TMP_MAX_AGE_S` (left by a crash mid-write). A full disk logs one
  warning per :data:`WRITE_WARN_INTERVAL_S` (with the number suppressed), not
  one per tile. :func:`read_variant` reads a variant for the response, so an
  eviction between the lookup and the send gives a 404, never a 500.
- **Concurrency.** :func:`thumbnail` decodes in ``asyncio.to_thread`` under a
  per-event-loop semaphore of :data:`DECODE_SLOTS`, so one album scroll cannot
  occupy every worker thread. A cache hit never waits for a slot.

Logs carry counts and codes only: ``photo_thumb_cache`` (``outcome=hit|miss``,
``width``), ``photo_thumb_evict`` (``count``, ``bytes``), ``photo_thumb_sweep``
(``count``) and ``photo_thumb_failed`` (``op``, ``error_type``, ``suppressed``)
for cache file errors.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import tempfile
import threading
import time
import weakref
from dataclasses import dataclass, field
from pathlib import Path

import structlog
from PIL import Image, ImageOps

from backend.services.platform import get_app_data_dir

logger = structlog.get_logger(__name__)

VIEW = "photo_thumb"
ALLOWED_WIDTHS: frozenset[int] = frozenset({160, 320, 640})
"""Longest-side bounds the route accepts; mirrors ``THUMB_WIDTHS`` in the frontend."""

PICTURE_SUFFIXES: frozenset[str] = frozenset(
    {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif", ".avif"}
)
BASE_FORMATS: tuple[str, ...] = ("JPEG", "MPO", "PNG", "WEBP", "GIF")
OPTIONAL_FORMATS: tuple[str, ...] = ("HEIF", "AVIF")
DRAFT_FORMATS = frozenset({"JPEG", "MPO"})
MAX_SOURCE_PIXELS = 50_000_000
"""Header-size bound (capped by Pillow's ``MAX_IMAGE_PIXELS``); larger sources are refused."""

CACHE_CAP_BYTES = 300 * 1024 * 1024
CACHE_LOW_WATER = 0.9
DECODE_SLOTS = 2
TMP_MAX_AGE_S = 3600
WRITE_WARN_INTERVAL_S = 600
_WEBP_QUALITY = 82


def picture_formats() -> tuple[str, ...]:
    """The Pillow formats a picture may be opened as (``Image.open(..., formats=)``).

    The registered ones among :data:`BASE_FORMATS` (Pillow opens MPO files
    through its JPEG plugin, so MPO need not be registered itself) and
    :data:`OPTIONAL_FORMATS` (only when their plugin is installed). Shared
    with ``memories.album_colors``.
    """
    Image.init()
    return tuple(f for f in BASE_FORMATS + OPTIONAL_FORMATS if f in Image.OPEN)


def cache_dir() -> Path:
    """Directory holding the thumbnails (created on first write)."""
    return get_app_data_dir() / "cache" / "photo_thumbs"


def is_picture(path: Path) -> bool:
    return path.suffix.lower() in PICTURE_SUFFIXES


def _skip(reason: str, e: BaseException | None = None) -> None:
    logger.info(
        "memories_skip",
        view=VIEW,
        reason=reason,
        error_type=type(e).__name__ if e is not None else None,
    )


def _pixel_limit() -> int:
    limit = Image.MAX_IMAGE_PIXELS
    return MAX_SOURCE_PIXELS if limit is None else min(limit, MAX_SOURCE_PIXELS)


def variant_name(rel_path: str, size: int, mtime_ns: int, width: int) -> str:
    """The cache file name of one variant (a hash; the path never appears)."""
    key = f"{rel_path}|{size}|{mtime_ns}|{width}".encode()
    return f"{hashlib.sha256(key).hexdigest()}-{width}.webp"


# --- the size-capped cache ---------------------------------------------------------


@dataclass
class _CacheState:
    total: int
    # variant name -> time.time_ns() of its last hit (the files stay untouched)
    used: dict[str, int] = field(default_factory=dict)


_states: dict[Path, _CacheState] = {}
_state_lock = threading.Lock()


def _variants(root: Path) -> list[os.DirEntry[str]]:
    try:
        with os.scandir(root) as it:
            return [e for e in it if e.name.endswith(".webp") and e.is_file()]
    except FileNotFoundError:
        return []


def _sweep_tmp(root: Path) -> None:
    """Delete temp files older than :data:`TMP_MAX_AGE_S` (a crash mid-write). Blocking."""
    cutoff = time.time() - TMP_MAX_AGE_S
    count = 0
    try:
        with os.scandir(root) as it:
            stale = [e for e in it if e.name.endswith(".tmp")]
    except FileNotFoundError:
        return
    for e in stale:
        try:
            if e.stat().st_mtime < cutoff:
                os.unlink(e.path)
                count += 1
        except OSError:
            continue
    if count:
        logger.info("photo_thumb_sweep", count=count)


def _state(root: Path) -> _CacheState:
    """The running total of ``root`` (measured on first use). Call under the lock."""
    state = _states.get(root)
    if state is None:
        _sweep_tmp(root)
        total = 0
        for e in _variants(root):
            try:
                total += e.stat().st_size
            except OSError:
                continue
        state = _states[root] = _CacheState(total)
    return state


def _evict(root: Path, state: _CacheState, cap: int) -> None:
    """Delete the oldest variants until the total is under the low-water mark. Under the lock."""
    entries: list[tuple[int, int, Path]] = []
    for e in _variants(root):
        try:
            st = e.stat()
        except OSError:
            continue
        used = max(st.st_mtime_ns, state.used.get(e.name, 0))
        entries.append((used, st.st_size, Path(e.path)))
    entries.sort(key=lambda t: (t[0], t[2].name))
    state.total = sum(size for _, size, _ in entries)
    target = int(cap * CACHE_LOW_WATER)
    count = freed = 0
    for _, size, path in entries:
        if state.total <= target:
            break
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        except OSError as e:  # Windows: a reader holds it open; try the next one
            logger.debug("photo_thumb_failed", op="evict", error_type=type(e).__name__)
            continue
        state.used.pop(path.name, None)
        state.total -= size
        count += 1
        freed += size
    logger.info("photo_thumb_evict", count=count, bytes=freed)


def _added(root: Path, size: int, cap: int) -> None:
    with _state_lock:
        state = _state(root)
        state.total += size
        if state.total > cap:
            _evict(root, state, cap)


def reset_cache_state() -> None:
    """Forget the measured totals and the write-warning window (tests; a cache dir wiped from outside)."""
    global _last_write_warn, _write_suppressed
    with _state_lock:
        _states.clear()
        _last_write_warn = None
        _write_suppressed = 0


_last_write_warn: float | None = None
_write_suppressed = 0


def _write_failed(e: BaseException) -> None:
    """Warn about a failed cache write at most once per :data:`WRITE_WARN_INTERVAL_S`."""
    global _last_write_warn, _write_suppressed
    with _state_lock:
        now = time.monotonic()
        if (
            _last_write_warn is not None
            and now - _last_write_warn < WRITE_WARN_INTERVAL_S
        ):
            _write_suppressed += 1
            logger.debug("photo_thumb_failed", op="write", error_type=type(e).__name__)
            return
        suppressed, _write_suppressed = _write_suppressed, 0
        _last_write_warn = now
    logger.warning(
        "photo_thumb_failed",
        op="write",
        error_type=type(e).__name__,
        suppressed=suppressed,
    )


# --- decode --------------------------------------------------------------------------


def _render(source: Path, width: int) -> Image.Image:
    """Decode and downscale ``source``; raises on any failure. Blocking."""
    with Image.open(source, formats=picture_formats()) as opened:
        w, h = opened.size
        if w * h > _pixel_limit():
            raise Image.DecompressionBombError("pixel bound")
        if opened.format in DRAFT_FORMATS:
            # libjpeg decodes at 1/2, 1/4 or 1/8 scale while keeping >= 2x the target.
            opened.draft("RGB", (2 * width, 2 * width))
        img = ImageOps.exif_transpose(opened)
        has_alpha = img.mode in ("RGBA", "LA", "PA") or "transparency" in img.info
        img = img.convert("RGBA" if has_alpha else "RGB")
    img.thumbnail((width, width), Image.Resampling.LANCZOS)
    return img


def _write(img: Image.Image, root: Path, target: Path) -> int:
    """Write ``img`` to ``target`` atomically; the bytes written. Blocking."""
    root.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=root, suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as out:
            img.save(out, format="WEBP", quality=_WEBP_QUALITY, method=4)
        size = Path(tmp_name).stat().st_size
        os.replace(tmp_name, target)
        return size
    finally:
        Path(tmp_name).unlink(missing_ok=True)


def lookup(
    source: Path, rel_path: str, width: int, root: Path
) -> tuple[Path | None, Path | None]:
    """``(hit, target)``: the cached variant if present, and where it belongs.

    A hit is remembered in memory for the eviction order; the file itself is
    not touched (its ETag stays stable). ``target`` is ``None`` when ``source``
    cannot be stat-ed. Blocking.
    """
    try:
        st = source.stat()
    except OSError as e:
        _skip("unavailable", e)
        return None, None
    target = root / variant_name(rel_path, st.st_size, st.st_mtime_ns, width)
    hit = target.is_file()
    with _state_lock:
        state = _state(root)
        if hit:
            state.used[target.name] = time.time_ns()
    return (target if hit else None), target


def read_variant(path: Path) -> bytes | None:
    """A variant's bytes for the response; ``None`` (with a breadcrumb) if it vanished. Blocking."""
    try:
        return path.read_bytes()
    except OSError as e:  # evicted (or held) between the lookup and the send
        _skip("vanished", e)
        return None


def make(
    source: Path, target: Path, width: int, root: Path, cap: int = CACHE_CAP_BYTES
) -> Path | None:
    """Render ``source`` into ``target``; ``None`` on any failure. Blocking; never raises."""
    try:
        img = _render(source, width)
    except Image.DecompressionBombError as e:
        _skip("too_large", e)
        return None
    except PermissionError as e:
        _skip("unavailable", e)
        return None
    except Exception as e:  # noqa: BLE001 - untrusted input: any failure is a skip
        _skip("unreadable", e)
        return None
    try:
        size = _write(img, root, target)
    except PermissionError as e:
        # Windows: another request is reading the same variant; same key, same content.
        if target.exists():
            return target
        _write_failed(e)
        return None
    except OSError as e:
        _write_failed(e)
        return None
    _added(root, size, cap)
    return target


_slots: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore] = (
    weakref.WeakKeyDictionary()
)


def _decode_slots() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    sem = _slots.get(loop)
    if sem is None:
        sem = _slots[loop] = asyncio.Semaphore(DECODE_SLOTS)
    return sem


async def thumbnail(
    source: Path,
    rel_path: str,
    width: int,
    root: Path | None = None,
    cap: int = CACHE_CAP_BYTES,
) -> Path | None:
    """The WebP thumbnail of ``source`` (a validated archive file) at ``width``, or ``None``.

    ``rel_path`` is its output-dir-relative POSIX path (the cache key). ``None``
    for a non-picture or any failure (see the module docstring). Raises
    ``ValueError`` for a width outside :data:`ALLOWED_WIDTHS`.
    """
    if width not in ALLOWED_WIDTHS:
        raise ValueError(f"unsupported thumbnail width: {width}")
    if not is_picture(source):
        _skip("not_picture")
        return None
    root = cache_dir() if root is None else root
    hit, target = await asyncio.to_thread(lookup, source, rel_path, width, root)
    if hit is not None:
        logger.debug("photo_thumb_cache", outcome="hit", width=width)
        return hit
    if target is None:
        return None
    logger.debug("photo_thumb_cache", outcome="miss", width=width)
    async with _decode_slots():
        return await asyncio.to_thread(make, source, target, width, root, cap)
