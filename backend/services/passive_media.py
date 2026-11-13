"""Archive and remote files are served only as passive media (security audit 2026-11-13).

The archive holds files whose names and bytes a remote party chose: a blog
image URL ending in ``.html`` or ``.svg`` was stored under that extension.
Served inline on the app origin with a type derived from the name, such a file
became a page whose script could drive the local API. Every route that streams
such a file takes its type and headers from :func:`passive_media`:

- a name whose extension is in ``INLINE_MEDIA_TYPES`` (the picture, video and
  voice extensions pysaka archives; never SVG, HTML or XML) is served inline
  with that exact type;
- anything else is served as ``application/octet-stream`` with
  ``Content-Disposition: attachment`` and logs ``media_type_refused`` with the
  route code (never the name or path);
- both carry ``X-Content-Type-Options: nosniff`` and ``SANDBOX_CSP``
  (``backend/security_headers.py``): opened as a page, the file runs no script
  and loads nothing.

The map is explicit rather than ``mimetypes``: on Windows ``mimetypes`` reads
the registry, which other software can change.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import PurePath

import structlog

from backend.security_headers import SANDBOX_CSP

logger = structlog.get_logger(__name__)

INLINE_MEDIA_TYPES: dict[str, str] = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
}
"""File extension (lower case) → the exact type a passive file is served inline as."""

OPAQUE_TYPE = "application/octet-stream"


@dataclass(frozen=True)
class PassiveMedia:
    """How to serve one file: its type, whether inline, and the response headers."""

    media_type: str
    inline: bool
    headers: dict[str, str]


def passive_media(name: str, *, route: str) -> PassiveMedia:
    """Type and headers for serving the file called ``name`` from ``route`` (a log code)."""
    headers = {
        "x-content-type-options": "nosniff",
        "content-security-policy": SANDBOX_CSP,
    }
    media_type = INLINE_MEDIA_TYPES.get(PurePath(name).suffix.lower())
    if media_type is not None:
        return PassiveMedia(media_type, True, headers)
    logger.info("media_type_refused", route=route)
    return PassiveMedia(
        OPAQUE_TYPE, False, {**headers, "content-disposition": "attachment"}
    )
