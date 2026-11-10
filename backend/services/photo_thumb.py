"""Downscaled WebP thumbnails of archived pictures, cached on disk.

The Memories album, On This Day and the day view show thousands of message
pictures as small tiles. Serving the ~1-2 MP originals makes the WebView decode
hundreds of megabytes of bitmaps per screen, so ``GET /api/content/thumb``
serves a WebP no wider or taller than one of :data:`ALLOWED_WIDTHS` instead
(aspect kept, never upscaled, EXIF orientation applied).

- **Pictures only.** A source whose suffix is not in :data:`PICTURE_SUFFIXES`
  (a video, a voice note, anything unknown) gets ``None`` (the route answers
  404 and the frontend falls back to the full media URL) without being opened.
- **Untrusted input.** The pixel bound :data:`MAX_SOURCE_PIXELS` is checked
  from the header size before any pixel is decoded, and is never above
  Pillow's own ``MAX_IMAGE_PIXELS``, so Pillow's warning band is refused too.
  No ``warnings`` filter is touched (process-wide, not thread-safe). JPEG / MPO
  are decoded at draft scale. Every failure (bomb, decode error, unreadable
  file) gives ``None`` plus a ``memories_skip`` breadcrumb (``view=photo_thumb``,
  ``reason``, ``error_type``) that never carries the path.
- **Cache.** Variants live under ``<app data dir>/cache/photo_thumbs/`` (a
  sibling of the avatar cache), named by a hash of (service-relative path,
  size, ``mtime_ns``, width), so a re-archived file gets a new key. Writes are
  atomic (temp file + ``os.replace``). A hit refreshes the file's mtime, and
  when the total size passes :data:`CACHE_CAP_BYTES` the oldest variants are
  deleted until it is under :data:`CACHE_LOW_WATER` of the cap. The running
  total is measured once per cache dir, then kept in memory.
- **Concurrency.** :func:`thumbnail` decodes in ``asyncio.to_thread`` under a
  per-event-loop semaphore of :data:`DECODE_SLOTS`, so one album scroll cannot
  occupy every worker thread. A cache hit never waits for a slot.

Logs carry counts and codes only: ``photo_thumb_cache`` (``outcome=hit|miss``,
``width``), ``photo_thumb_evict`` (``count``, ``bytes``) and
``photo_thumb_failed`` (``op``, ``error_type``) for cache file errors.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import tempfile
import threading
import weakref
from dataclasses import dataclass
from pathlib import Path

import structlog
from PIL import Image, ImageOps

from backend.services.platform import get_app_data_dir

logger = structlog.get_logger(__name__)

VIEW = "photo_thumb"
ALLOWED_WIDTHS: frozenset[int] = frozenset({160, 320, 640})
"""Longest-side bounds the route accepts; mirrors ``THUMB_WIDTHS`` in the frontend."""

PICTURE_SUFFIXES: frozenset[str] = frozenset(
    {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
)
DRAFT_FORMATS = frozenset({"JPEG", "MPO"})
MAX_SOURCE_PIXELS = 50_000_000
"""Header-size bound (capped by Pillow's ``MAX_IMAGE_PIXELS``); larger sources are refused."""

CACHE_CAP_BYTES = 300 * 1024 * 1024
CACHE_LOW_WATER = 0.9
DECODE_SLOTS = 2
_WEBP_QUALITY = 82


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


_states: dict[Path, _CacheState] = {}
_state_lock = threading.Lock()


def _variants(root: Path) -> list[os.DirEntry[str]]:
    try:
        with os.scandir(root) as it:
            return [e for e in it if e.name.endswith(".webp") and e.is_file()]
    except FileNotFoundError:
        return []


def _state(root: Path) -> _CacheState:
    """The running total of ``root`` (measured on first use). Call under the lock."""
    state = _states.get(root)
    if state is None:
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
        entries.append((st.st_mtime_ns, st.st_size, Path(e.path)))
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
    """Forget the measured totals (tests; a cache dir wiped from outside)."""
    with _state_lock:
        _states.clear()


# --- decode --------------------------------------------------------------------------


def _render(source: Path, width: int) -> Image.Image:
    """Decode and downscale ``source``; raises on any failure. Blocking."""
    with Image.open(source) as opened:
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
    """``(hit, target)``: the cached variant if present (its mtime refreshed), and where it belongs.

    ``target`` is ``None`` when ``source`` cannot be stat-ed. Blocking.
    """
    try:
        st = source.stat()
    except OSError as e:
        _skip("unavailable", e)
        return None, None
    target = root / variant_name(rel_path, st.st_size, st.st_mtime_ns, width)
    try:
        os.utime(target)
    except FileNotFoundError:
        return None, target
    except OSError as e:  # still servable; only the LRU order is stale
        logger.debug("photo_thumb_failed", op="touch", error_type=type(e).__name__)
    return target, target


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
        logger.warning("photo_thumb_failed", op="write", error_type=type(e).__name__)
        return None
    except OSError as e:
        logger.warning("photo_thumb_failed", op="write", error_type=type(e).__name__)
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
