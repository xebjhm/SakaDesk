"""Downscaled copies of archived avatars, cached on disk.

Member-list avatars are archived at ~1000 px but shown at 64 CSS px. Letting
the browser shrink them ~9x in one pass looks soft, so the
``/api/content/avatar`` route serves a square, Lanczos-downscaled WebP at one
of a few fixed widths instead.

Variants live under ``<app data dir>/cache/avatars/`` and are named by a hash
of the source's resolved path, its mtime and the width, so a re-archived image
gets a fresh variant and an unchanged one is resized only once. A source whose
short side is not larger than the width is served unchanged (never upscaled),
and any Pillow failure falls back to the original file.

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

ALLOWED_WIDTHS: frozenset[int] = frozenset({64, 128, 192, 256})
"""Widths the route accepts (CSS px x device pixel ratio, rounded up)."""

_WEBP_QUALITY = 90


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
    short side is not larger than ``width`` or Pillow cannot read or write it
    (a structured warning is logged; no path is included).

    Raises ``ValueError`` for a width outside ``ALLOWED_WIDTHS``.
    """
    if width not in ALLOWED_WIDTHS:
        raise ValueError(f"unsupported avatar width: {width}")
    if root is None:
        root = cache_dir()

    target = _variant_path(source, source.stat().st_mtime_ns, width, root)
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
            img = ImageOps.exif_transpose(opened)
            img = img.convert("RGBA" if _has_alpha(img) else "RGB")
            img = ImageOps.fit(img, (width, width), method=Image.Resampling.LANCZOS)
        root.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(dir=root, suffix=".tmp")
        with os.fdopen(fd, "wb") as out:
            img.save(out, format="WEBP", quality=_WEBP_QUALITY, method=6)
        os.replace(tmp_name, target)
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
