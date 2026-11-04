"""Helpers for read-only endpoints that expose files of the local archive.

URLs point at the existing media route (``/api/content/media/<service id>/...``),
which maps the service id to its display-name folder and re-validates that the
path stays inside the output directory. Containment in the service folder holds
because callers build URL parts only from already validated paths.

Reads of archive files go through :func:`read_archive_json` and
:func:`archive_file_ok`, which resolve symlinks and require the file to stay
inside the output directory.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

from fastapi import HTTPException

MEDIA_PREFIX = "/api/content/media/"

# Upper bound for one archive JSON file; larger files are treated as invalid.
MAX_JSON_BYTES = 20 * 1024 * 1024


class ArchiveReadError(Exception):
    """An archive file is unreadable, too large, malformed or outside the output dir."""


class _Missing:
    """Type of the :data:`MISSING` sentinel."""


MISSING = _Missing()


def resolve_within(output_dir: Path, path: Path) -> Path:
    """Resolved ``path`` if it stays inside ``output_dir`` (symlinks followed).

    Raises :class:`ArchiveReadError` otherwise. Nothing about the path is put in
    the error.
    """
    from backend.api.content import validate_path_within_dir

    try:
        return validate_path_within_dir(output_dir, str(path))
    except (HTTPException, OSError, ValueError, RuntimeError):
        raise ArchiveReadError("outside output dir") from None


def archive_file_ok(output_dir: Path, path: Path) -> bool:
    """True if ``path`` is a regular file inside ``output_dir``; False if absent.

    Raises :class:`ArchiveReadError` for a path outside ``output_dir`` or a
    filesystem error such as PermissionError.
    """
    resolved = resolve_within(output_dir, path)
    try:
        return resolved.is_file()
    except OSError:
        raise ArchiveReadError("unreadable") from None


def read_archive_json(output_dir: Path, path: Path) -> object:
    """Parsed JSON of an archive file, or :data:`MISSING` when it does not exist.

    Raises :class:`ArchiveReadError` when the file is outside ``output_dir``
    (symlink), larger than :data:`MAX_JSON_BYTES`, unreadable, not valid JSON or
    nested too deeply.
    """
    if not archive_file_ok(output_dir, path):
        return MISSING
    resolved = resolve_within(output_dir, path)
    try:
        if resolved.stat().st_size > MAX_JSON_BYTES:
            raise ArchiveReadError("too large")
        with open(resolved, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError, RecursionError):
        raise ArchiveReadError("unreadable") from None


def media_url(service: str, parts: Iterable[str]) -> str:
    """Media-route URL of ``<service folder>/<parts...>``; every segment is percent-encoded."""
    return MEDIA_PREFIX + "/".join(quote(p, safe="") for p in [service, *parts])


def parse_iso(value: object) -> datetime | None:
    """Timezone-aware datetime of an ISO-8601 string (``Z`` = UTC); None otherwise.

    Archive timestamps always carry an offset, so naive values are rejected.
    """
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None
