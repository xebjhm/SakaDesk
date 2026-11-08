"""Downscaled copies of archived avatars, cached on disk.

Avatars are archived at ~1000 px but shown at 40-64 CSS px (member list, chat
messages, chat header). Letting the browser shrink them ~9x in one pass looks
soft, so the ``/api/content/avatar`` route serves a square, Lanczos-downscaled
WebP at one of a few fixed widths instead. The frontend asks for the smallest
width that covers the drawn size in device pixels, so the browser has little or
nothing left to scale.

Variants live under ``<app data dir>/cache/avatars/`` and are named by a hash
of the source's resolved path, its mtime and the width, so a re-archived image
gets a fresh variant and an unchanged one is resized only once. A source whose
short side is not larger than the width is served unchanged (never upscaled),
as is one above ``MAX_SOURCE_PIXELS`` (not worth decoding for a thumbnail);
JPEGs are decoded at a reduced scale (``draft``) before the Lanczos pass. Any
Pillow or file failure (including a source that vanished) falls back to the
original file.

Cached variants are never evicted. Each is a few KB and a re-archived source
simply gets a new key (the old variant becomes an orphan), so the cache stays
small; that trade-off is accepted over the complexity of an eviction policy.

``resized_avatar`` does blocking file and image work: call it from a thread
(``asyncio.to_thread``), never on the event loop.
"""

from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path

import structlog
from PIL import Image, ImageOps

from backend.services.platform import get_app_data_dir

logger = structlog.get_logger(__name__)

ALLOWED_WIDTHS: frozenset[int] = frozenset({64, 80, 96, 112, 128, 160, 192, 256})
"""Widths the route accepts; mirrors ``AVATAR_WIDTHS`` in the frontend.

The frontend picks the smallest one at or above CSS px x device pixel ratio.
16 px steps up to 128 keep that close at common display scales (64 CSS px at
125 / 150 / 175 / 200 % = 80 / 96 / 112 / 128; 40 CSS px at 175 % = 70 -> 80).
"""

_WEBP_QUALITY = 90

MAX_SOURCE_PIXELS = 40_000_000
"""Sources with more pixels than this are served unchanged, never decoded."""


def cache_dir() -> Path:
    """Directory holding the resized variants (created on first write)."""
    return get_app_data_dir() / "cache" / "avatars"


def _variant_path(source: Path, mtime_ns: int, width: int, root: Path) -> Path:
    key = f"{source.resolve()}|{mtime_ns}|{width}".encode("utf-8")
    return root / f"{hashlib.sha256(key).hexdigest()}-{width}.webp"


def _has_alpha(img: Image.Image) -> bool:
    return img.mode in ("RGBA", "LA", "PA") or "transparency" in img.info


def resized_avatar(source: Path, width: int, root: Path | None = None) -> Path:
    """Return the file to serve for ``source`` at ``width`` px.

    That is the cached square WebP variant under ``root`` (default
    ``cache_dir()``; made now if missing), or ``source`` itself when its
    short side is not larger than ``width``, it has more than
    ``MAX_SOURCE_PIXELS`` pixels, it cannot be stat-ed (e.g. it vanished), or
    Pillow cannot read or write it (a structured warning is logged for the
    last three; no path is included). If another reader holds the variant
    open when it is moved into place (``PermissionError`` on Windows) and it
    already exists, the existing variant is served.

    Raises ``ValueError`` for a width outside ``ALLOWED_WIDTHS``.
    """
    if width not in ALLOWED_WIDTHS:
        raise ValueError(f"unsupported avatar width: {width}")
    if root is None:
        root = cache_dir()

    try:
        mtime_ns = source.stat().st_mtime_ns
    except OSError as e:  # vanished or unreadable between validation and now
        logger.warning(
            "avatar_resize_failed",
            reason="stat",
            width=width,
            suffix=source.suffix.lower(),
            error=type(e).__name__,
        )
        return source

    target = _variant_path(source, mtime_ns, width, root)
    if target.exists():
        logger.debug("avatar_resize_cache_hit", width=width)
        return target

    tmp_name: str | None = None
    try:
        with Image.open(source) as opened:
            if min(opened.size) <= width:
                logger.debug(
                    "avatar_resize_skipped", reason="source_small", width=width
                )
                return source
            if opened.size[0] * opened.size[1] > MAX_SOURCE_PIXELS:
                logger.warning(
                    "avatar_resize_skipped", reason="source_large", width=width
                )
                return source
            if opened.format == "JPEG":
                # Let libjpeg decode at 1/2, 1/4 or 1/8 scale while keeping
                # at least 2x the target: far less memory, same final quality.
                opened.draft("RGB", (2 * width, 2 * width))
            img = ImageOps.exif_transpose(opened)
            img = img.convert("RGBA" if _has_alpha(img) else "RGB")
            img = ImageOps.fit(img, (width, width), method=Image.Resampling.LANCZOS)
        root.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(dir=root, suffix=".tmp")
        with os.fdopen(fd, "wb") as out:
            img.save(out, format="WEBP", quality=_WEBP_QUALITY, method=6)
        try:
            os.replace(tmp_name, target)
        except PermissionError:
            # Windows: another request is reading the variant it just wrote.
            # Same key, same content, so serve that one.
            if not target.exists():
                raise
            logger.debug("avatar_resize_replace_raced", width=width)
            return target
        tmp_name = None
    except Exception as e:  # any Pillow / file error: serve the original
        logger.warning(
            "avatar_resize_failed",
            width=width,
            suffix=source.suffix.lower(),
            error=type(e).__name__,
        )
        return source
    finally:
        if tmp_name is not None:
            Path(tmp_name).unlink(missing_ok=True)

    logger.debug("avatar_resize_created", width=width)
    return target
