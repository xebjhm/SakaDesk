"""The album's monthly colour ribbon and the per-photo probe cache (spec 8).

- :func:`probe_image` (blocking) opens one picture with Pillow and returns an
  :class:`ImageProbe`: size, format and a representative colour. The picture
  is untrusted input: it is opened only as one of
  ``photo_thumb.picture_formats()`` (no EPS or other exotic decoder is ever
  reached), and ``DecompressionBombError`` and pictures whose header size is
  over the pixel bound are refused before any decode. The bound is Pillow's
  ``MAX_IMAGE_PIXELS`` for draft formats: a picture in Pillow's warning band
  still makes ``Image.open`` emit its ``DecompressionBombWarning`` but is
  refused and never decoded. :data:`PROBE_MAX_PIXELS` caps the formats without
  draft decoding. No ``warnings`` filter is touched (process-wide state);
  JPEG / MPO pictures are decoded at draft size. Every failure gives ``None``
  plus a ``memories_skip`` breadcrumb (``view=album_color``, ``error_type``)
  that never carries the path: ``reason=unreadable`` for a decode failure,
  ``reason=unavailable`` for a transient one (the file cannot be opened, or a
  ``PermissionError``).
- :func:`probes` validates each ``media_file`` against the output dir
  (``archive_urls.archive_file_ok``) and caches probes per photo in the
  memory-index DB, keyed by ``stat_key`` = ``f"{size}:{mtime_ns}"``::

      memories_photo_probe(service_dir, media_file, stat_key, width, height,
                           fmt, rgb, PRIMARY KEY(service_dir, media_file))
                           WITHOUT ROWID

  A decode failure is stored too (``width`` NULL), so a broken file is not
  decoded again until it changes; a transient failure is not stored and is
  retried on the next request. Misses are probed in worker threads, at
  most :data:`PROBE_BATCH` files per thread.
- :func:`month_color` buckets colours by 4-bit RGB and averages the most
  frequent bucket (ties: the bucket seen first, i.e. the higher-score photo).
- :func:`month_colors_for` -- ``{"colors": {"YYYY-MM": "#rrggbb" | None}}``
  for every month with a picture or video, from up to
  :data:`MONTH_SAMPLE` non-promo pictures with the highest ``photo_score``
  (ties: the earlier; videos are never sampled); screenshot-like ones among
  them are dropped from the sample. Cached text-free (view
  ``album_colors``, key = ``person_key`` or ``"all"``, hash over the room
  hashes and ``people.media_dir_mtimes``, so media repair that adds files
  without rewriting ``messages.json`` re-colours the ribbon).

Logs carry counts and codes only: ``memories_album_probe`` (``hits``,
``probed``, ``failed``, ``missing``) and ``memories_album_probe_failed``
(``op``, ``error_type``) for SQLite errors, which never raise.
"""

from __future__ import annotations

import asyncio
import colorsys
import contextlib
import sqlite3
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO, cast

import structlog
from PIL import Image

from backend.services.archive_urls import ArchiveReadError, archive_file_ok
from backend.services.photo_thumb import picture_formats
from backend.services.memories import index as mi
from backend.services.memories import people
from backend.services.memories.facts import Fact
from backend.services.memories.view_cache import Uncacheable, cached_view, view_hash

logger = structlog.get_logger(__name__)

VIEW = "album_color"
VIEW_COLORS = "album_colors"
# Bump on any rule or payload change of the ribbon (its cache hash has it).
# 3: ribbons built from transiently unreadable probes are no longer cached;
# the bump drops any such entry cached before (they heal on the next open).
COLORS_VERSION = 3
MONTH_SAMPLE = 8
PROBE_BATCH_DEFAULT = 64
PROBE_BATCH = PROBE_BATCH_DEFAULT
# Decoded-size bound for formats without draft decoding (JPEG / MPO use draft).
PROBE_MAX_PIXELS = 25_000_000
DRAFT_FORMATS = frozenset({"JPEG", "MPO"})
DRAFT_SIZE = (64, 64)
THUMB_SIZE = (48, 48)
PALETTE_COLORS = 8
MIN_SATURATION = 0.15
MIN_VALUE = 0.15
MAX_VALUE = 0.95

_SCHEMA = (
    "CREATE TABLE IF NOT EXISTS memories_photo_probe (service_dir TEXT, "
    "media_file TEXT, stat_key TEXT, width INTEGER, height INTEGER, fmt TEXT, "
    "rgb INTEGER, PRIMARY KEY(service_dir, media_file)) WITHOUT ROWID"
)

RGB = tuple[int, int, int]


@dataclass(frozen=True)
class ImageProbe:
    """Size, Pillow format name and representative colour of one picture."""

    width: int
    height: int
    fmt: str
    rgb: RGB | None


def hex_of(rgb: RGB) -> str:
    """``#rrggbb`` of an RGB triple."""
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def is_screenshot_like(p: ImageProbe) -> bool:
    """A tall PNG (height / width >= 1.9): most likely a phone screenshot."""
    return p.fmt == "PNG" and p.width > 0 and p.height / p.width >= 1.9


def _qualifies(rgb: RGB) -> bool:
    _, s, v = colorsys.rgb_to_hsv(*(c / 255 for c in rgb))
    return s >= MIN_SATURATION and MIN_VALUE <= v <= MAX_VALUE


def _dominant(img: Image.Image) -> RGB | None:
    """The most frequent qualifying palette colour, else the most frequent one."""
    quant = img.quantize(colors=PALETTE_COLORS)
    palette = quant.getpalette() or []
    colors = quant.getcolors() or []
    ranked: list[RGB] = []
    for _, entry in sorted(colors, key=lambda c: (-c[0], c[1])):
        index = cast(int, entry)  # a "P" image's colours are palette indexes
        r, g, b = palette[index * 3 : index * 3 + 3]
        ranked.append((r, g, b))
    if not ranked:
        return None
    return next((c for c in ranked if _qualifies(c)), ranked[0])


def _pixel_limit(fmt: str) -> int | None:
    if fmt in DRAFT_FORMATS:  # decoded at draft size: Pillow's own bound
        return Image.MAX_IMAGE_PIXELS
    limit = Image.MAX_IMAGE_PIXELS
    return PROBE_MAX_PIXELS if limit is None else min(limit, PROBE_MAX_PIXELS)


def _skip(reason: str, e: BaseException) -> None:
    logger.info("memories_skip", view=VIEW, reason=reason, error_type=type(e).__name__)


def _decode(fh: BinaryIO) -> ImageProbe:
    """Decode an open picture; raises on any failure. Blocking.

    The size bound is checked from the header before any pixel is decoded.
    It equals Pillow's ``MAX_IMAGE_PIXELS`` for draft formats (lower for the
    rest), so a picture in Pillow's warning band is refused here as a
    ``DecompressionBombError`` (``Image.open`` has already emitted Pillow's
    warning for it, but nothing is decoded). Only the formats of
    ``photo_thumb.picture_formats()`` are tried. No ``warnings`` filter is
    installed: filters are process-wide and not thread-safe in a worker.
    """
    with Image.open(fh, formats=picture_formats()) as img:
        fmt = img.format or ""
        width, height = img.size
        limit = _pixel_limit(fmt)
        if limit is not None and width * height > limit:
            raise Image.DecompressionBombError("pixel bound")
        if fmt in DRAFT_FORMATS:
            img.draft("RGB", DRAFT_SIZE)
        rgb_img = img.convert("RGB")
    rgb_img.thumbnail(THUMB_SIZE)
    return ImageProbe(width=width, height=height, fmt=fmt, rgb=_dominant(rgb_img))


def _probe_image(path: Path) -> tuple[ImageProbe | None, bool]:
    """``(probe or None, cacheable)``. Blocking; never raises.

    A failure to open the file, or a ``PermissionError`` while reading it, is
    transient (another process may hold it): ``reason=unavailable``, not
    cacheable. Any decode failure is ``reason=unreadable`` and cacheable.
    """
    try:
        fh = open(path, "rb")  # noqa: SIM115 - closed by the with below
    except OSError as e:
        _skip("unavailable", e)
        return None, False
    try:
        with fh:
            return _decode(fh), True
    except PermissionError as e:
        _skip("unavailable", e)
        return None, False
    except Exception as e:  # noqa: BLE001 - untrusted input: any failure is a skip
        _skip("unreadable", e)
        return None, True


def probe_image(path: Path) -> ImageProbe | None:
    """Probe one picture (see the module docstring). Blocking; never raises."""
    return _probe_image(path)[0]


# --- probe cache --------------------------------------------------------------------


def _stat_keys(
    sdir: Path, media_files: Sequence[str]
) -> tuple[dict[str, str | None], int]:
    """``media_file -> stat_key`` (``None`` for absent / outside / unreadable) and
    the count that failed transiently. Blocking.

    An absent file is a real answer. A file outside the output dir or one
    that cannot be stat'ed is counted transient: a settings read that failed
    for a moment (the output dir then reads as the default) or a held file
    looks exactly like that, so a view built from it must not be cached.
    """
    root = people.output_dir()
    out: dict[str, str | None] = {}
    transient = 0
    for mf in media_files:
        path = sdir / mf
        try:
            if not archive_file_ok(root, path):
                out[mf] = None
                continue
            st = path.stat()
        except (ArchiveReadError, OSError):
            out[mf] = None
            transient += 1
            continue
        out[mf] = f"{st.st_size}:{st.st_mtime_ns}"
    return out, transient


def _rgb_to_int(rgb: RGB | None) -> int | None:
    return None if rgb is None else (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]


def _int_to_rgb(value: int | None) -> RGB | None:
    if value is None:
        return None
    return (value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF


_Row = tuple[str, int | None, int | None, str | None, int | None]


def _read_rows(service_dir: str, media_files: Iterable[str]) -> dict[str, _Row]:
    """``media_file -> (stat_key, width, height, fmt, rgb)``. Blocking; ``{}`` on error."""
    files = list(media_files)
    try:
        # One query per file: many row steps, so it takes the row-read lock.
        with mi.row_reads(), contextlib.closing(mi._connect()) as c:
            c.execute(_SCHEMA)
            out: dict[str, _Row] = {}
            for mf in files:
                row = c.execute(
                    "SELECT stat_key, width, height, fmt, rgb FROM "
                    "memories_photo_probe WHERE service_dir=? AND media_file=?",
                    (service_dir, mf),
                ).fetchone()
                if row is not None:
                    out[mf] = row
            return out
    except sqlite3.Error as e:
        logger.warning(
            "memories_album_probe_failed", op="read", error_type=type(e).__name__
        )
        return {}


def _write_rows(
    service_dir: str, rows: list[tuple[str, str, ImageProbe | None]]
) -> None:
    """Store ``(media_file, stat_key, probe)`` rows. Blocking; errors are logged."""
    try:
        with contextlib.closing(mi._connect()) as c, c:
            c.execute(_SCHEMA)
            c.executemany(
                "INSERT OR REPLACE INTO memories_photo_probe(service_dir, media_file, "
                "stat_key, width, height, fmt, rgb) VALUES (?,?,?,?,?,?,?)",
                [
                    (
                        service_dir,
                        mf,
                        key,
                        p.width if p else None,
                        p.height if p else None,
                        p.fmt if p else None,
                        _rgb_to_int(p.rgb) if p else None,
                    )
                    for mf, key, p in rows
                ],
            )
    except sqlite3.Error as e:
        logger.warning(
            "memories_album_probe_failed", op="write", error_type=type(e).__name__
        )


def _row_probe(row: _Row) -> ImageProbe | None:
    _, width, height, fmt, rgb = row
    if width is None or height is None:
        return None
    return ImageProbe(width=width, height=height, fmt=fmt or "", rgb=_int_to_rgb(rgb))


def _probe_batch(paths: Sequence[Path]) -> list[tuple[ImageProbe | None, bool]]:
    """``_probe_image`` of each path. Blocking (one worker thread per batch)."""
    return [_probe_image(p) for p in paths]


class Probes(dict[str, "ImageProbe | None"]):
    """:func:`probes`' result: ``media_file -> probe`` plus ``transient``.

    ``transient`` counts files that could not be checked or read just now
    (outside the output dir, unstat-able, held). A view built from a result
    with ``transient > 0`` must not be cached (``view_cache.Uncacheable``).
    """

    def __init__(self, *args: Any, transient: int = 0) -> None:
        super().__init__(*args)
        self.transient = transient


async def probes(sdir: Path, media_files: list[str]) -> Probes:
    """``media_file -> probe`` (``None`` when absent, outside, or unreadable), cached.

    The result's ``transient`` counts the transient failures (see :class:`Probes`).
    """
    if not media_files:
        return Probes()
    files = list(dict.fromkeys(media_files))
    service_dir = str(sdir)
    keys, transient = await asyncio.to_thread(_stat_keys, sdir, files)
    present = [mf for mf in files if keys[mf] is not None]
    rows = await asyncio.to_thread(_read_rows, service_dir, present)
    out = Probes({mf: None for mf in files})
    misses: list[str] = []
    for mf in present:
        row = rows.get(mf)
        if row is not None and row[0] == keys[mf]:
            out[mf] = _row_probe(row)
        else:
            misses.append(mf)
    fresh: list[tuple[str, str, ImageProbe | None]] = []
    failed = 0
    for start in range(0, len(misses), PROBE_BATCH):
        chunk = misses[start : start + PROBE_BATCH]
        results = await asyncio.to_thread(_probe_batch, [sdir / mf for mf in chunk])
        for mf, (probe, cacheable) in zip(chunk, results):
            out[mf] = probe
            failed += probe is None
            if cacheable:  # a transient failure is retried next time
                fresh.append((mf, keys[mf] or "", probe))
            else:
                transient += 1
    if fresh:
        await asyncio.to_thread(_write_rows, service_dir, fresh)
    logger.info(
        "memories_album_probe",
        hits=len(present) - len(misses),
        probed=len(misses),
        failed=failed,
        missing=len(files) - len(present),
        transient=transient,
    )
    out.transient = transient
    return out


# --- the ribbon ----------------------------------------------------------------------


def month_color(rgbs: list[RGB]) -> str | None:
    """Average of the most frequent 4-bit RGB bucket as ``#rrggbb``; ``None`` if empty.

    ``rgbs`` come best photo first: a tie goes to the bucket seen first.
    """
    if not rgbs:
        return None
    buckets: dict[RGB, list[RGB]] = {}
    for rgb in rgbs:
        key = (rgb[0] >> 4, rgb[1] >> 4, rgb[2] >> 4)
        buckets.setdefault(key, []).append(rgb)
    counts = Counter({k: len(v) for k, v in buckets.items()})
    best_n = max(counts.values())
    best = next(k for k in buckets if counts[k] == best_n)  # insertion order
    members = buckets[best]
    avg = tuple(round(sum(c[i] for c in members) / len(members)) for i in range(3))
    return hex_of((avg[0], avg[1], avg[2]))


_Tagged = tuple[str, Fact]


def _month_samples(tagged: Sequence[_Tagged]) -> dict[str, list[str]]:
    """``month -> media files`` to sample, best first, for every media month. Pure."""
    by_month: dict[str, list[_Tagged]] = {}
    for t in tagged:
        if t[1].type in people.MEDIA_TYPES:
            by_month.setdefault(_month(t[1]), []).append(t)
    out: dict[str, list[str]] = {}
    for month in sorted(by_month):
        pics = [
            t
            for t in by_month[month]
            if t[1].type == "picture"
            and not t[1].is_promo
            and people.media_file_for(t[1]) is not None
        ]
        pics.sort(key=lambda t: (-(t[1].photo_score or 0), t[1].ts, t[1].id, t[0]))
        out[month] = [
            mf for t in pics[:MONTH_SAMPLE] if (mf := people.media_file_for(t[1]))
        ]
    return out


def _month(f: Fact) -> str:
    return f"{f.jst_date.year:04d}-{f.jst_date.month:02d}"


async def month_colors_for(
    service: str, sdir: Path, member: mi.MemberSummary | None
) -> dict:
    """``{"colors": {month: "#rrggbb" | None}}`` for one person or everyone, cached.

    ``service`` is unused (the ribbon has no URLs); it keeps the signature
    uniform with the other album services.
    """
    return (await month_colors_status(service, sdir, member))[0]


async def month_colors_status(
    service: str, sdir: Path, member: mi.MemberSummary | None
) -> tuple[dict, bool]:
    """:func:`month_colors_for` and whether it was built from transient probe failures.

    A transient ribbon is not cached here; a caller that folds it into its
    own cached view (radio cassettes) must not cache that view either.
    """
    transient = False
    persons, scope, hashes = await people.album_scope(sdir, member)
    data_hash = view_hash(
        COLORS_VERSION, hashes, await people.media_dir_mtimes(sdir, persons)
    )

    async def build() -> dict | Uncacheable:
        nonlocal transient
        tagged = await people.scope_facts(sdir, persons, types=people.MEDIA_TYPES)
        samples = await asyncio.to_thread(_month_samples, tagged)
        found = await probes(sdir, [mf for files in samples.values() for mf in files])
        colors: dict[str, str | None] = {}
        for month, files in samples.items():
            rgbs = [
                p.rgb
                for mf in files
                if (p := found.get(mf)) and p.rgb and not is_screenshot_like(p)
            ]
            colors[month] = month_color(rgbs)
        logger.info(
            "memories_album_colors",
            months=len(colors),
            colored=sum(1 for c in colors.values() if c is not None),
        )
        if found.transient:
            transient = True
            return Uncacheable({"colors": colors}, "probe_unavailable")
        return {"colors": colors}

    payload = await cached_view(sdir, VIEW_COLORS, scope, data_hash, build)
    return payload, transient


__all__ = [
    "ImageProbe",
    "Probes",
    "hex_of",
    "is_screenshot_like",
    "month_color",
    "month_colors_for",
    "month_colors_status",
    "probe_image",
    "probes",
]
