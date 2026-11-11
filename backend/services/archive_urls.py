"""Helpers for read-only endpoints that expose files of the local archive.

URLs point at the existing media route (``/api/content/media/<service id>/...``),
which maps the service id to its display-name folder and re-validates that the
path stays inside the output directory. URLs built here by :func:`media_url`
stay in their service folder because callers build URL parts only from already
validated paths; URLs sent back by a client are re-checked against both the
output directory and the service folder by :func:`classify_media_route`.

Reads of archive files go through :func:`read_archive_json` and
:func:`archive_file_ok`, which resolve symlinks and require the file to stay
inside the output directory.

:func:`is_plain_relative` is the lexical gate every client path passes before
anything resolves it: on Windows a rooted, drive or UNC path joined to a base
replaces the base, and resolving ``//host/share`` would open an SMB
connection (leaking the user's NTLM hash) before any containment check.

:func:`media_disk_path` is the one translation of a media-route path
(``<service id>/<rest>``) to its on-disk path (``<display name>/<rest>``),
shared by the media route and :func:`classify_media_route` (which maps a whole
media-route URL sent by a client back to the archive file).
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from datetime import datetime
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Literal
from urllib.parse import quote, unquote, urlsplit

from fastapi import HTTPException

MEDIA_PREFIX = "/api/content/media/"

# Upper bound for one archive JSON file; larger files are treated as invalid.
MAX_JSON_BYTES = 20 * 1024 * 1024


class ArchiveReadError(Exception):
    """An archive file is unreadable, too large, malformed or outside the output dir."""


class _Missing:
    """Type of the :data:`MISSING` sentinel."""


MISSING = _Missing()


def is_plain_relative(path: str) -> bool:
    """True if ``path`` is a plain relative path that cannot replace a base it is joined to.

    Lexical only (never touches the filesystem), and the same on every
    platform. False when the path has a Windows drive or root
    (``C:x``, ``C:/x``, ``\\\\host\\share``), is POSIX-absolute, starts
    with ``/`` or ``\\``, has an empty segment before its last
    (``a//host/share``), or has a ``:`` anywhere (a drive or an alternate data
    stream). ``"."``, ``""`` and a trailing separator are plain.
    """
    if path.startswith(("/", "\\")) or ":" in path:
        return False
    win = PureWindowsPath(path)
    if win.drive or win.root or PurePosixPath(path).is_absolute():
        return False
    segments = path.replace("\\", "/").split("/")
    return all(segments[:-1]) or segments == [""]


def resolve_within(output_dir: Path, path: Path) -> Path:
    """Resolved ``path`` if it stays inside ``output_dir`` (symlinks followed).

    ``path`` may be absolute (a server-built archive path). It must lie
    lexically under ``output_dir`` (as given or resolved) and its part below it
    must be :func:`is_plain_relative`; both are checked before ``path`` is
    resolved. Raises :class:`ArchiveReadError` otherwise. Nothing about the
    path is put in the error.
    """
    from backend.api.content import validate_path_within_dir

    try:
        if path.is_absolute():
            try:
                rel = path.relative_to(output_dir)
            except ValueError:
                rel = path.relative_to(output_dir.resolve())
        else:
            rel = path
        return validate_path_within_dir(output_dir, rel.as_posix())
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


def media_disk_path(file_path: str) -> tuple[str, str | None]:
    """``(on-disk path, service id)`` of a media-route path ``<service id>/<rest>``.

    A known service id (any case) is replaced by its display-name folder and
    returned normalised (``hinatazaka46``); otherwise ``file_path`` comes back
    unchanged with ``None`` (the media route then reads it as relative to the
    output dir, as it always has). Nothing is validated here.
    """
    from backend.services.service_utils import (
        get_service_display_name,
        get_service_enum,
    )

    parts = file_path.split("/", 1)
    if len(parts) == 2:
        service_part, rest = parts
        try:
            display_name = get_service_display_name(service_part)
        except ValueError:
            return file_path, None
        return f"{display_name}/{rest}", get_service_enum(service_part).value
    return file_path, None


MediaRouteRejection = Literal["invalid", "outside"]
_BAD_PATH_CHARS = ("\x00", "\n", "\r")


def classify_media_route(
    output_dir: Path, url: str
) -> tuple[str, Path] | MediaRouteRejection:
    """``(service id, resolved archive path)`` of a client media-route URL, or why not.

    Accepts only a same-origin path ``/api/content/media/<service id>/<rest>``
    (percent-decoded once, like the route; a query or fragment is ignored)
    with a known service id and a non-empty ``rest``. After resolving
    (symlinks followed) the file must lie strictly inside the service's
    display-name folder, which itself must lie inside ``output_dir``.

    - ``"invalid"``: not such a URL (another route, an absolute or
      cross-origin URL, an unknown service, an empty ``rest``, control
      characters, or a ``rest`` that is not :func:`is_plain_relative`, which
      is checked before anything is resolved);
    - ``"outside"``: it resolves outside the service folder or the output
      dir (traversal, a symlink out, or the folder itself).

    Never raises and never logs (a batch caller logs one summary). Whether
    the file exists is not checked. Blocking (it resolves).
    """
    try:
        parts = urlsplit(url)
    except ValueError:
        return "invalid"
    if parts.scheme or parts.netloc or not parts.path.startswith(MEDIA_PREFIX):
        return "invalid"
    file_path = unquote(parts.path[len(MEDIA_PREFIX) :])
    if any(c in file_path for c in _BAD_PATH_CHARS):
        return "invalid"
    disk_path, service = media_disk_path(file_path)
    if service is None:
        return "invalid"
    display_name, rest = disk_path.split("/", 1)
    if not rest or not is_plain_relative(rest):
        return "invalid"
    try:
        base = output_dir.resolve()
        folder = (output_dir / display_name).resolve()
        target = (folder / rest).resolve()
    except (OSError, ValueError, RuntimeError):
        return "invalid"
    if not folder.is_relative_to(base) or folder == base:
        return "outside"
    if not target.is_relative_to(folder) or target == folder:
        return "outside"
    return service, target


def media_route_target(output_dir: Path, url: str) -> tuple[str, Path] | None:
    """``(service id, resolved archive path)`` of a client media-route URL, or ``None``.

    :func:`classify_media_route` without the rejection reason.
    """
    found = classify_media_route(output_dir, url)
    return None if isinstance(found, str) else found


def media_route_path(output_dir: Path, url: str) -> Path | None:
    """The resolved archive path of a media-route URL, or ``None`` (:func:`media_route_target`)."""
    target = media_route_target(output_dir, url)
    return None if target is None else target[1]


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
