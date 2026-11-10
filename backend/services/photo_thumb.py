"""Downscaled WebP thumbnails of archived pictures, cached on disk.

The Memories album, On This Day and the day view show thousands of message
pictures as small tiles. Serving the ~1-2 MP originals makes the WebView decode
hundreds of megabytes of bitmaps per screen, so ``GET /api/content/thumb``
serves a WebP no wider or taller than one of :data:`ALLOWED_WIDTHS` instead
(aspect kept, never upscaled, EXIF orientation applied).

- **Pictures, and videos through their poster.** A source whose suffix is in
  neither :data:`PICTURE_SUFFIXES` nor :data:`VIDEO_SUFFIXES` (a voice note,
  anything unknown) gets ``None`` (the route answers 404 and the frontend
  falls back to the full media URL) without being opened. A video's variant
  is rendered from its cached poster frame (``video_poster.poster_path``,
  opened with ``formats=("WEBP",)``) under the **video's** key
  (``variant_name(rel, video size, video mtime_ns, w)``), and ``v`` is the
  video's version. Without a poster a video gets ``None``: the request path
  never calls the Windows Shell (posters are made by the background worker
  or uploaded by the client, see ``backend.services.video_poster``).
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
- **Toast images.** :func:`toast_image` writes a JPEG variant (no WebP: a
  Windows toast cannot show one) no larger than :data:`TOAST_WIDTH` px on the
  long side, for the Hero image of a Memories notification. It shares the
  cache dir, the size cap, the eviction and the safety rules above; a variant
  over :data:`TOAST_MAX_BYTES` (Windows refuses toast images over 3 MB) is
  refused like any other failure. A failure gives ``None``, never the
  original.
- **One decode for every size.** :func:`make_set` stats a source once, skips
  it when every requested variant is already cached (unless
  ``need_placeholder=True``), otherwise decodes it **once** (draft scale for
  JPEG / MPO) at the largest missing width and downsizes that image in memory
  for each smaller width; it also returns the source's :class:`Placeholder`
  (:func:`placeholder_of`: mean colour and a 16 px WebP blur of at most
  :data:`BLUR_MAX_BYTES`) and its display size (the header size with EXIF
  orientation applied). The background pre-generation
  worker (``media_pregen``) writes :data:`PREGEN_WIDTHS` (480 px; plus
  :data:`LARGE_WIDTH` for starred items and covers; 320 / 160 px are derived
  on demand from the 480) through it: the **same
  files under the same keys** the route serves, so a pre-generated variant is
  a route hit. The key's ``rel_path`` always comes from :func:`archive_rel`
  (the resolved, output-dir-relative POSIX path), for the route and the
  worker alike. ``formats=`` narrows the decoder allowlist (video posters
  pass ``("WEBP",)``), and ``key_stat=`` keys a video's variants by the
  video's stat while they are rendered from its poster.
  :func:`cache_total` reads the accounted bytes (``measure=False`` never
  scans, for the worker's fill-line check on the event loop).
- **Derived misses.** On a miss, :func:`thumbnail` first looks for a cached
  **larger** variant of the same key (the smallest one above the request)
  and renders from it, opened with ``formats=("WEBP",)`` (our own file, but
  the allowlist and the pixel bound still apply), logging
  ``photo_thumb_cache outcome=derived``. Only when there is none, or it
  cannot be read, is the source decoded (``outcome=miss``).
- **Content version.** :func:`version_token` is the first 12 hex chars of
  ``sha256("size:mtime_ns")`` of the source. :func:`thumbnail_with_token`
  returns it with the variant (from the stat the lookup already does), so
  the route can mark a URL whose ``v`` matches as immutable.
- **Concurrency.** :func:`thumbnail` and :func:`toast_image` run their blocking
  work on a dedicated pool of :data:`IO_WORKERS` threads (:func:`run_io`), never
  the default executor the Memories views share, and decode under a
  per-event-loop semaphore of :data:`DECODE_SLOTS`, so one album scroll cannot
  occupy every worker thread nor delay the month grids. A cache hit never waits
  for a slot.

Logs carry counts and codes only: ``photo_thumb_cache``
(``outcome=hit|miss|derived``, ``width``), ``photo_thumb_evict`` (``count``, ``bytes``), ``photo_thumb_sweep``
(``count``) and ``photo_thumb_failed`` (``op``, ``error_type``, ``suppressed``)
for cache file errors.
"""

from __future__ import annotations

import asyncio
import functools
import hashlib
import io
import os
import tempfile
import threading
import time
import weakref
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import TypeVar

import structlog
from PIL import Image, ImageOps, ImageStat

from backend.services.platform import get_app_data_dir

logger = structlog.get_logger(__name__)

VIEW = "photo_thumb"
ALLOWED_WIDTHS: frozenset[int] = frozenset({160, 320, 480, 640})
"""Longest-side bounds the route accepts; mirrors ``THUMB_WIDTHS`` in the frontend."""

PICTURE_SUFFIXES: frozenset[str] = frozenset(
    {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif", ".avif"}
)
VIDEO_SUFFIXES: frozenset[str] = frozenset({".mp4", ".mov", ".m4v"})
"""Videos whose thumbnail comes from a poster frame. Owned here (with
:data:`PICTURE_SUFFIXES`) so ``media_meta`` and ``video_poster`` import both
from one place without an import cycle."""
BASE_FORMATS: tuple[str, ...] = ("JPEG", "MPO", "PNG", "WEBP", "GIF")
OPTIONAL_FORMATS: tuple[str, ...] = ("HEIF", "AVIF")
DRAFT_FORMATS = frozenset({"JPEG", "MPO"})
MAX_SOURCE_PIXELS = 50_000_000
"""Header-size bound (capped by Pillow's ``MAX_IMAGE_PIXELS``); larger sources are refused."""

CACHE_CAP_BYTES = 1 * 1024**3
"""1 GiB. Sized in the media pipeline plan's "Cache budget" table
(``docs/superpowers/plans/2026-11-11-media-pipeline.md``): one 480 px WebP
is about 35 KB per item (to be measured in M9), so one large service's
messages (~14k pictures, ~490 MB) plus its starred / cover 640 px variants
(~40 MB) fit under the pre-generation fill line (0.85 of the cap, 870 MiB);
its blog images (~525 MB more) and a second large service do not fit
completely, and LRU eviction keeps what was viewed last. 320 / 160 px
requests are rendered on demand from the cached 480 (derived misses)."""
PREGEN_WIDTHS: tuple[int, ...] = (480,)
"""The variant pre-generated for every picture (smaller widths derive from it)."""
LARGE_WIDTH = 640
"""The extra variant pre-generated for starred items and album covers."""
BLUR_MAX_BYTES = 600
"""Largest placeholder blur kept; a bigger one (a very noisy picture) becomes ``None``."""
BLUR_PX = 16
_BLUR_QUALITY = 40
CACHE_LOW_WATER = 0.75
"""An eviction trims the cache to this share of its cap. Below the
pre-generation fill line (``media_pregen.PREGEN_FILL_RATIO`` = 0.85) on
purpose: after an eviction the worker may add again (hysteresis), so a full
cache never parks the worker for good."""
DECODE_SLOTS = 2
TMP_MAX_AGE_S = 3600
WRITE_WARN_INTERVAL_S = 600
_WEBP_QUALITY = 82
_JPEG_QUALITY = 85

TOAST_WIDTH = 1024
"""Longest-side bound of a toast Hero image (Windows shows it at most ~1:2 of that)."""
TOAST_MAX_BYTES = 3 * 1024 * 1024
"""Windows refuses a toast image over 3 MB."""

FORMAT_WEBP = "webp"
FORMAT_JPEG = "jpeg"
_SUFFIX = {FORMAT_WEBP: ".webp", FORMAT_JPEG: ".jpg"}
_VARIANT_SUFFIXES = tuple(_SUFFIX.values())


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


def is_video(path: Path) -> bool:
    return path.suffix.lower() in VIDEO_SUFFIXES


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


def variant_name(
    rel_path: str, size: int, mtime_ns: int, width: int, fmt: str = FORMAT_WEBP
) -> str:
    """The cache file name of one variant (a hash; the path never appears)."""
    key = f"{rel_path}|{size}|{mtime_ns}|{width}"
    if fmt != FORMAT_WEBP:  # WebP names predate the format field: keep them
        key += f"|{fmt}"
    return f"{hashlib.sha256(key.encode()).hexdigest()}-{width}{_SUFFIX[fmt]}"


def version_token(size: int, mtime_ns: int) -> str:
    """The content version ``v`` of a source: 12 hex chars of ``sha256("size:mtime_ns")``."""
    return hashlib.sha256(f"{size}:{mtime_ns}".encode()).hexdigest()[:12]


def archive_rel(output_dir: Path, path: Path) -> str:
    """The cache key path: ``path`` resolved, relative to the resolved ``output_dir``, POSIX.

    Symlinks and ``..`` are resolved the way the media route resolves them,
    so the route and the pre-generation worker compute the same key for one
    file. Raises ``ValueError`` when ``path`` is outside ``output_dir``.
    Blocking (it resolves).
    """
    return path.resolve().relative_to(output_dir.resolve()).as_posix()


RGB = tuple[int, int, int]


@dataclass(frozen=True)
class Placeholder:
    """What a tile paints before its thumbnail: the mean colour and a tiny WebP blur."""

    rgb: RGB
    blur: bytes | None


def placeholder_of(img: Image.Image) -> Placeholder:
    """The mean colour of ``img`` and a :data:`BLUR_PX` px WebP of it (``quality=40``).

    Transparency is flattened over white first (as for a toast JPEG,
    :func:`_flatten`), so a transparent pixel counts as white, not as its
    hidden colour. A blur over :data:`BLUR_MAX_BYTES` is dropped (``None``).
    ``img`` is not modified. Pure and blocking.
    """
    rgb_img = _flatten(img)
    if rgb_img is img:  # already RGB: copy, thumbnail() works in place
        rgb_img = img.copy()
    mean = ImageStat.Stat(rgb_img).mean
    r, g, b = (max(0, min(255, round(c))) for c in mean[:3])
    rgb_img.thumbnail((BLUR_PX, BLUR_PX), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    rgb_img.save(buf, format="WEBP", quality=_BLUR_QUALITY)
    data = buf.getvalue()
    return Placeholder((r, g, b), data if len(data) <= BLUR_MAX_BYTES else None)


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
            return [e for e in it if e.name.endswith(_VARIANT_SUFFIXES) and e.is_file()]
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


def cache_state_add(root: Path, size: int, cap: int) -> None:
    """Account ``size`` new bytes in the cache ``root``; evict down when over ``cap``. Blocking.

    Public so other bounded caches (video posters) reuse the accounting with
    their own root and cap.
    """
    with _state_lock:
        state = _state(root)
        state.total += size
        if state.total > cap:
            _evict(root, state, cap)


_added = cache_state_add


def cache_total(root: Path, *, measure: bool = True) -> int | None:
    """The accounted bytes of the cache ``root``.

    ``measure=True`` measures the directory on first use (blocking: a scan);
    ``measure=False`` never touches the disk and gives ``None`` while ``root``
    has not been measured yet, so the pre-generation worker can read it on
    the event loop.
    """
    with _state_lock:
        if not measure:
            state = _states.get(root)
            return None if state is None else state.total
        return _state(root).total


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


_EXIF_ORIENTATION = 0x0112
_SWAPPED_ORIENTATIONS = frozenset({5, 6, 7, 8})


def _decode(
    source: Path, width: int, formats: tuple[str, ...] | None = None
) -> tuple[Image.Image, tuple[int, int]]:
    """``(image downscaled to fit width, source size as displayed)``; raises on any failure.

    ``formats`` is the decoder allowlist (default :func:`picture_formats`).
    The pixel bound is checked from the header before any pixel is decoded.
    The returned size is the header size with EXIF orientation applied.
    Blocking.
    """
    allowed = picture_formats() if formats is None else formats
    with Image.open(source, formats=allowed) as opened:
        w, h = opened.size
        if w * h > _pixel_limit():
            raise Image.DecompressionBombError("pixel bound")
        swapped = opened.getexif().get(_EXIF_ORIENTATION) in _SWAPPED_ORIENTATIONS
        if opened.format in DRAFT_FORMATS:
            # libjpeg decodes at 1/2, 1/4 or 1/8 scale while keeping >= 2x the target.
            opened.draft("RGB", (2 * width, 2 * width))
        img = ImageOps.exif_transpose(opened)
        has_alpha = img.mode in ("RGBA", "LA", "PA") or "transparency" in img.info
        img = img.convert("RGBA" if has_alpha else "RGB")
    img.thumbnail((width, width), Image.Resampling.LANCZOS)
    return img, ((h, w) if swapped else (w, h))


def _render(
    source: Path, width: int, formats: tuple[str, ...] | None = None
) -> Image.Image:
    """Decode and downscale ``source``; raises on any failure. Blocking."""
    return _decode(source, width, formats)[0]


def _flatten(img: Image.Image) -> Image.Image:
    """``img`` as RGB, any transparency over white (JPEG has no alpha)."""
    if img.mode == "RGB":
        return img
    rgba = img.convert("RGBA")
    flat = Image.new("RGB", rgba.size, (255, 255, 255))
    flat.paste(rgba, mask=rgba.getchannel("A"))
    return flat


def _write(
    img: Image.Image,
    root: Path,
    target: Path,
    fmt: str = FORMAT_WEBP,
    exif: bytes | None = None,
) -> int:
    """Write ``img`` to ``target`` atomically; the bytes written. Blocking.

    ``exif`` (WebP only) embeds an EXIF block, e.g. a video poster's source tag.
    """
    root.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=root, suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as out:
            if fmt == FORMAT_JPEG:
                _flatten(img).save(out, format="JPEG", quality=_JPEG_QUALITY)
            else:
                extra = {} if exif is None else {"exif": exif}
                img.save(out, format="WEBP", quality=_WEBP_QUALITY, method=4, **extra)
        size = Path(tmp_name).stat().st_size
        os.replace(tmp_name, target)
        return size
    finally:
        Path(tmp_name).unlink(missing_ok=True)


def _mark_used(root: Path, name: str | None) -> None:
    """Remember a hit for the eviction order (and measure ``root`` on first use)."""
    with _state_lock:
        state = _state(root)
        if name is not None:
            state.used[name] = time.time_ns()


def probe(
    source: Path, rel_path: str, width: int, root: Path, fmt: str = FORMAT_WEBP
) -> tuple[Path | None, Path | None, tuple[int, int] | None]:
    """``(hit, target, (size, mtime_ns))``: :func:`lookup` plus the source stat it took.

    All three are ``None`` when ``source`` cannot be stat-ed. Blocking.
    """
    try:
        st = source.stat()
    except OSError as e:
        _skip("unavailable", e)
        return None, None, None
    stat = (st.st_size, st.st_mtime_ns)
    target = root / variant_name(rel_path, *stat, width, fmt)
    hit = target.is_file()
    _mark_used(root, target.name if hit else None)
    return (target if hit else None), target, stat


def lookup(
    source: Path, rel_path: str, width: int, root: Path, fmt: str = FORMAT_WEBP
) -> tuple[Path | None, Path | None]:
    """``(hit, target)``: the cached variant if present, and where it belongs.

    A hit is remembered in memory for the eviction order; the file itself is
    not touched (its ETag stays stable). ``target`` is ``None`` when ``source``
    cannot be stat-ed. Blocking.
    """
    hit, target, _ = probe(source, rel_path, width, root, fmt)
    return hit, target


def _larger_variant(
    rel_path: str, stat: tuple[int, int], width: int, root: Path
) -> Path | None:
    """The smallest cached WebP variant of the key wider than ``width``, if any. Blocking."""
    for w in sorted(ALLOWED_WIDTHS):
        if w <= width:
            continue
        candidate = root / variant_name(rel_path, *stat, w)
        if candidate.is_file():
            _mark_used(root, candidate.name)
            return candidate
    return None


def read_variant(path: Path) -> bytes | None:
    """A variant's bytes for the response; ``None`` (with a breadcrumb) if it vanished. Blocking."""
    try:
        return path.read_bytes()
    except OSError as e:  # evicted (or held) between the lookup and the send
        _skip("vanished", e)
        return None


def _decode_failure(e: BaseException) -> str:
    """The skip reason of a decode failure (logged as a breadcrumb)."""
    if isinstance(e, Image.DecompressionBombError):
        reason = "too_large"
    elif isinstance(e, PermissionError):
        reason = "unavailable"
    else:
        reason = "unreadable"
    _skip(reason, e)
    return reason


def _store(
    img: Image.Image, root: Path, target: Path, cap: int, fmt: str = FORMAT_WEBP
) -> tuple[Path | None, bool]:
    """Write and account one variant: ``(path or None, written by us)``. Blocking."""
    try:
        size = _write(img, root, target, fmt)
    except PermissionError as e:
        # Windows: another request is reading the same variant; same key, same content.
        if target.exists():
            return target, False
        _write_failed(e)
        return None, False
    except OSError as e:
        _write_failed(e)
        return None, False
    _added(root, size, cap)
    return target, True


def make(
    source: Path,
    target: Path,
    width: int,
    root: Path,
    cap: int = CACHE_CAP_BYTES,
    fmt: str = FORMAT_WEBP,
    formats: tuple[str, ...] | None = None,
) -> Path | None:
    """Render ``source`` into ``target``; ``None`` on any failure. Blocking; never raises.

    ``formats`` narrows the decoder allowlist (default :func:`picture_formats`).
    """
    try:
        img = _render(source, width, formats)
    except Exception as e:  # noqa: BLE001 - untrusted input: any failure is a skip
        _decode_failure(e)
        return None
    return _store(img, root, target, cap, fmt)[0]


@dataclass(frozen=True)
class SetResult:
    """The outcome of :func:`make_set`.

    ``stat`` is the source ``(size, mtime_ns)`` (``None`` when it cannot be
    stat-ed); ``written`` the variants this call wrote and ``present`` those
    already cached (width -> path); ``placeholder`` and ``size`` (the source
    size as displayed) are set only when the source was decoded; ``reason``
    is a skip code (``unsupported|unavailable|too_large|unreadable``) or
    ``None``. A failed write is neither written nor present.
    """

    stat: tuple[int, int] | None
    written: dict[int, Path]
    present: dict[int, Path]
    placeholder: Placeholder | None
    size: tuple[int, int] | None
    reason: str | None


def _failed_set(
    reason: str,
    stat: tuple[int, int] | None = None,
    present: dict[int, Path] | None = None,
) -> SetResult:
    return SetResult(stat, {}, present or {}, None, None, reason)


def _variant_targets(
    rel_path: str, stat: tuple[int, int], widths: list[int], root: Path
) -> dict[int, Path]:
    return {w: root / variant_name(rel_path, *stat, w) for w in widths}


def make_set(
    source: Path,
    rel_path: str,
    widths: tuple[int, ...] | list[int],
    root: Path,
    cap: int = CACHE_CAP_BYTES,
    *,
    formats: tuple[str, ...] | None = None,
    need_placeholder: bool = False,
    key_stat: tuple[int, int] | None = None,
) -> SetResult:
    """Write every missing WebP variant of ``source`` in ``widths`` from **one** decode.

    ``rel_path`` is the cache key (:func:`archive_rel`). The source is stat-ed
    once; when every variant is already cached nothing is opened, unless
    ``need_placeholder`` asks for the :class:`Placeholder` anyway. Otherwise
    the source is decoded once at the largest missing width (the smallest
    allowed width when only the placeholder is needed), each smaller width is
    downsized from that image in memory, and the variants are written
    atomically and accounted toward ``cap``. ``formats=None`` means
    :func:`picture_formats`.

    ``key_stat`` overrides the ``(size, mtime_ns)`` the variants are keyed by
    (and :attr:`SetResult.stat`): a video's variants are rendered from its
    poster but keyed by the **video's** stat, the key the route looks up.
    The source is still stat-ed (a missing one is ``unavailable``).
    Blocking; never raises.
    """
    try:
        return _make_set(
            source, rel_path, widths, root, cap, formats, need_placeholder, key_stat
        )
    except Exception as e:  # noqa: BLE001 - never raises: an unexpected failure is a skip
        _skip("unreadable", e)
        return _failed_set("unreadable")


def _make_set(
    source: Path,
    rel_path: str,
    widths: tuple[int, ...] | list[int],
    root: Path,
    cap: int,
    formats: tuple[str, ...] | None,
    need_placeholder: bool,
    key_stat: tuple[int, int] | None = None,
) -> SetResult:
    wanted = sorted(set(widths), reverse=True)
    if any(w not in ALLOWED_WIDTHS for w in wanted):
        _skip("unsupported")
        return _failed_set("unsupported")
    try:
        st = source.stat()
    except OSError as e:
        _skip("unavailable", e)
        return _failed_set("unavailable")
    stat = (st.st_size, st.st_mtime_ns) if key_stat is None else key_stat
    # Measure the cache before writing, so the first writes are not counted twice.
    _mark_used(root, None)
    targets = _variant_targets(rel_path, stat, wanted, root)
    present = {w: p for w, p in targets.items() if p.is_file()}
    missing = [w for w in wanted if w not in present]
    if not missing and not need_placeholder:
        return SetResult(stat, {}, present, None, None, None)
    try:
        img, size = _decode(
            source, missing[0] if missing else min(ALLOWED_WIDTHS), formats
        )
    except Exception as e:  # noqa: BLE001 - untrusted input: any failure is a skip
        return _failed_set(_decode_failure(e), stat, present)
    placeholder = placeholder_of(img)
    written: dict[int, Path] = {}
    for w in missing:
        variant = img
        if max(img.size) > w:
            variant = img.copy()
            variant.thumbnail((w, w), Image.Resampling.LANCZOS)
        path, fresh = _store(variant, root, targets[w], cap)
        if path is not None:
            (written if fresh else present)[w] = path
    return SetResult(stat, written, present, placeholder, size, None)


_slots: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore] = (
    weakref.WeakKeyDictionary()
)


IO_WORKERS = DECODE_SLOTS + 2
"""Threads of the thumbnail pool: the decode slots plus two for cache lookups and reads."""

_T = TypeVar("_T")
_io_pool: ThreadPoolExecutor | None = None
_io_pool_lock = threading.Lock()


def _io_executor() -> ThreadPoolExecutor:
    global _io_pool
    with _io_pool_lock:
        if _io_pool is None:
            _io_pool = ThreadPoolExecutor(
                max_workers=IO_WORKERS, thread_name_prefix="photo_thumb"
            )
        return _io_pool


async def run_io(fn: Callable[..., _T], *args: object) -> _T:
    """Run blocking thumbnail work (path checks, cache lookups, decodes, reads)
    on the thumbnail pool, never the default executor.

    An album screen asks for hundreds of thumbnails at once. On the shared
    default pool their lookups queued ahead of every ``asyncio.to_thread`` hop
    of the Memories views (index checks, fact reads), so the month grids
    waited behind the thumbnails; on their own small pool they cannot.
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_io_executor(), functools.partial(fn, *args))


def _decode_slots() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    sem = _slots.get(loop)
    if sem is None:
        sem = _slots[loop] = asyncio.Semaphore(DECODE_SLOTS)
    return sem


@dataclass(frozen=True)
class ThumbResult:
    """A served variant and the current content version (:func:`version_token`) of its source."""

    path: Path
    token: str


async def thumbnail_with_token(
    source: Path,
    rel_path: str,
    width: int,
    root: Path | None = None,
    cap: int = CACHE_CAP_BYTES,
) -> ThumbResult | None:
    """:func:`thumbnail` plus the source's current :func:`version_token`.

    The token comes from the stat the cache lookup already takes (no second
    stat). ``None`` exactly when :func:`thumbnail` gives ``None``.
    """
    if width not in ALLOWED_WIDTHS:
        raise ValueError(f"unsupported thumbnail width: {width}")
    video = is_video(source)
    if not video and not is_picture(source):
        _skip("not_picture")
        return None
    root = cache_dir() if root is None else root
    hit, target, stat = await run_io(probe, source, rel_path, width, root)
    if target is None or stat is None:
        return None
    token = version_token(*stat)
    if hit is not None:
        logger.debug("photo_thumb_cache", outcome="hit", width=width)
        return ThumbResult(hit, token)
    larger = await run_io(_larger_variant, rel_path, stat, width, root)
    formats: tuple[str, ...] | None = None
    if video and larger is None:
        poster = await run_io(_poster_of, rel_path, stat)
        if poster is None:  # no poster yet: 404, the client falls back
            _no_poster()
            return None
        source, formats = poster, ("WEBP",)
    async with _decode_slots():
        if larger is not None:
            # Our own WebP, still opened under an allowlist and the pixel bound.
            made = await run_io(
                make, larger, target, width, root, cap, FORMAT_WEBP, ("WEBP",)
            )
            if made is not None:
                logger.debug("photo_thumb_cache", outcome="derived", width=width)
                return ThumbResult(made, token)
        if video and formats is None:  # the larger variant vanished: use the poster
            poster = await run_io(_poster_of, rel_path, stat)
            if poster is None:
                _no_poster()
                return None
            source, formats = poster, ("WEBP",)
        logger.debug("photo_thumb_cache", outcome="miss", width=width)
        made = await run_io(
            make, source, target, width, root, cap, FORMAT_WEBP, formats
        )
    return None if made is None else ThumbResult(made, token)


def _no_poster() -> None:
    # Debug, not info: before pre-generation finishes every video tile asks.
    logger.debug("memories_skip", view=VIEW, reason="no_poster", error_type=None)


def _poster_of(rel_path: str, stat: tuple[int, int]) -> Path | None:
    """The cached poster of a video version, if any. Blocking; never calls Shell."""
    from backend.services import video_poster  # lazy: video_poster imports this module

    return video_poster.poster_for_stat(rel_path, *stat)


async def thumbnail(
    source: Path,
    rel_path: str,
    width: int,
    root: Path | None = None,
    cap: int = CACHE_CAP_BYTES,
) -> Path | None:
    """The WebP thumbnail of ``source`` (a validated archive file) at ``width``, or ``None``.

    ``rel_path`` is its output-dir-relative POSIX path (the cache key, from
    :func:`archive_rel`). A hit is served as is; a miss is rendered from a
    cached larger variant when there is one, else from the source (a video:
    from its cached poster). ``None`` for a source that is neither a picture
    nor a video, a video without a poster, or any failure (see the module
    docstring). Raises
    ``ValueError`` for a width outside :data:`ALLOWED_WIDTHS`.
    """
    res = await thumbnail_with_token(source, rel_path, width, root, cap)
    return None if res is None else res.path


async def toast_image(
    source: Path, root: Path | None = None, cap: int = CACHE_CAP_BYTES
) -> Path | None:
    """A JPEG of ``source`` for a toast Hero image, or ``None`` (see the module docstring).

    At most :data:`TOAST_WIDTH` px on the long side and :data:`TOAST_MAX_BYTES`.
    The cache key is the absolute source path (hashed, never logged). ``None``
    for a non-picture, any decode or write failure and an oversized result,
    never the original.
    """
    if not is_picture(source):
        _skip("not_picture")
        return None
    root = cache_dir() if root is None else root
    key = source.resolve().as_posix()
    hit, target = await run_io(lookup, source, key, TOAST_WIDTH, root, FORMAT_JPEG)
    if hit is not None:
        logger.debug("photo_thumb_cache", outcome="hit", width=TOAST_WIDTH)
    elif target is None:
        return None
    else:
        logger.debug("photo_thumb_cache", outcome="miss", width=TOAST_WIDTH)
        async with _decode_slots():
            hit = await run_io(
                make, source, target, TOAST_WIDTH, root, cap, FORMAT_JPEG
            )
        if hit is None:
            return None
    size = await run_io(_size_or_none, hit)
    if size is None or size > TOAST_MAX_BYTES:
        _skip("too_large" if size is not None else "vanished")
        return None
    return hit


def _size_or_none(path: Path) -> int | None:
    try:
        return path.stat().st_size
    except OSError:
        return None
