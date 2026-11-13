"""Remote identifiers as path parts, and containment of paths built from them
(security audit 2026-11-13: backend/services/blog_service.py:remote-blog-identifiers-as-path-segments,
backend/services/sync_service.py:media_queue:remote-ids-unvalidated-paths-escape-service-data-dir).

Ids and names from the official sites and APIs become folder and file names in
the archive. A value such as ``../../x``, ``C:\\x``, ``\\\\host\\share`` or ``CON``
would leave its folder (or name a device) once joined to a base. Every such
value passes one of these gates before it touches the filesystem:

- :func:`is_safe_id`: a blog or member id from the blog sites;
- :func:`is_int_id`: a group, member or message id from the message API;
- :func:`plain_segment`: a folder name such as a member's name;
- :func:`join_within` / :func:`is_within`: the containment backstop for a path
  built from such parts.

All checks are lexical (no filesystem call), so they are cheap enough for every
item of a sync's media queue and never open a network path. Following links is
the readers' job (``archive_urls.resolve_within``): planting a link needs write
access to the archive, which only the user has.
"""

from __future__ import annotations

import re
from pathlib import Path

from backend.services.archive_urls import is_plain_relative

MAX_SEGMENT_CHARS = 255

_SAFE_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
_FORBIDDEN_CHARS = frozenset('<>:"/\\|?*')
_DEVICE_NAMES = frozenset(
    {"CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"}
    | {f"{port}{n}" for port in ("COM", "LPT") for n in "0123456789¹²³"}
)


class UnsafePath(ValueError):
    """A remote value would leave its folder; ``reason`` is a log code."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _is_device_name(name: str) -> bool:
    """True for a Windows device name in any case, with or without an extension (``nul.txt``)."""
    return name.split(".", 1)[0].rstrip(" ").upper() in _DEVICE_NAMES


def is_safe_id(value: object) -> bool:
    """True for a blog or member id that may be (part of) one path segment.

    A ``str`` of 1-64 ASCII letters, digits, ``_`` or ``-`` that is not a
    Windows device name (``CON``, ``nul``...). The official sites use digit
    strings; anything else is a hostile or broken value.
    """
    return (
        isinstance(value, str)
        and _SAFE_ID.fullmatch(value) is not None
        and not _is_device_name(value)
    )


def is_int_id(value: object) -> bool:
    """True for a message-API id: a true ``int`` (``bool`` is not one)."""
    return isinstance(value, int) and not isinstance(value, bool)


def plain_segment(name: object) -> bool:
    """True for one folder or file name that cannot leave its folder on any platform.

    A non-empty ``str`` of at most 255 characters, not ``.`` or ``..``, with no
    separator, ``:`` or other character Windows forbids in names
    (``<>:"/\\|?*``), no control character, no trailing dot or space (Windows
    drops them, so ``a.`` would name ``a``) and not a Windows device name. On
    Windows ``base / "C:x"`` replaces the drive and ``a:b`` names a data stream.
    """
    return (
        isinstance(name, str)
        and 0 < len(name) <= MAX_SEGMENT_CHARS
        and name not in (".", "..")
        and not any(c in _FORBIDDEN_CHARS or ord(c) < 0x20 for c in name)
        and not name.endswith((".", " "))
        and not _is_device_name(name)
    )


def join_within(base: Path, *parts: str) -> Path:
    """``base / parts...``, every part a :func:`plain_segment`; else raise ``UnsafePath("segment")``.

    With every part plain the result lies inside ``base`` by construction.
    """
    if not parts or not all(plain_segment(p) for p in parts):
        raise UnsafePath("segment")
    return base.joinpath(*parts)


def member_folder_name(member_name: object) -> str:
    """The folder name of a member under a service's blogs folder.

    The name with surrounding whitespace stripped (Windows cannot create a
    folder ending in a space) and ``/`` replaced by ``_``, as archives have
    always been laid out; ``""`` (never a ``plain_segment``) for a non-``str``.
    """
    return member_name.strip().replace("/", "_") if isinstance(member_name, str) else ""


def blog_date(published_at: object) -> str:
    """The ``YYYYMMDD`` date part of an ISO ``published_at``; ``""`` for a non-``str``.

    ``"2026-01-17T22:21:00+09:00"`` gives ``"20260117"``. Not validated here:
    the result is checked as part of the folder name (:func:`blog_folder`).
    """
    return published_at[:10].replace("-", "") if isinstance(published_at, str) else ""


def blog_folder_name(published_at: object, blog_id: object) -> str:
    """The name of one cached blog's folder: ``<date>_<blog id>`` (:func:`blog_date`).

    Not validated here (:func:`blog_folder` does that); a gallery listing
    that already validated both parts uses it to find the folder.
    """
    return f"{blog_date(published_at)}_{blog_id}"


def member_folder(base: Path, member_name: object) -> Path:
    """``base / <member folder name>``; else raise ``UnsafePath("segment")``."""
    return join_within(base, member_folder_name(member_name))


def blog_folder(base: Path, member_name: object, blog_id: object, date: str) -> Path:
    """``base / <member folder name> / <date>_<blog id>`` for one cached blog.

    Raises ``UnsafePath`` with reason ``blog_id`` when ``blog_id`` is not
    :func:`is_safe_id`, or ``segment`` when either folder name is not a
    :func:`plain_segment`. Every reader and writer of blog folders builds the
    path here, so the derivation lives in one place.
    """
    if not is_safe_id(blog_id):
        raise UnsafePath("blog_id")
    return join_within(base, member_folder_name(member_name), f"{date}_{blog_id}")


def blog_folder_or_none(
    base: Path, member_name: object, blog_id: object, date: str
) -> Path | None:
    """:func:`blog_folder`, or ``None`` when the index entry is unsafe."""
    try:
        return blog_folder(base, member_name, blog_id, date)
    except UnsafePath:
        return None


def member_folder_or_none(base: Path, member_name: object) -> Path | None:
    """:func:`member_folder`, or ``None`` when the member name is unsafe."""
    try:
        return member_folder(base, member_name)
    except UnsafePath:
        return None


def is_within(base: Path, path: Path) -> bool:
    """True if ``path`` lies strictly inside ``base``, judged on the text alone.

    ``path`` must start with ``base`` (``PurePath.relative_to``, which does not
    fold ``..``) and the rest must be ``archive_urls.is_plain_relative`` with no
    empty, ``.`` or ``..`` segment, splitting on both ``/`` and ``\\`` so a
    Windows separator inside a name counts on every platform. It is an escape
    backstop, not a name validator: device names or trailing dots inside
    ``path`` are left to :func:`plain_segment` where the path is built.
    """
    try:
        rest = path.relative_to(base).as_posix()
    except ValueError:
        return False
    if rest in ("", ".") or not is_plain_relative(rest):
        return False
    return all(seg not in ("", ".", "..") for seg in rest.replace("\\", "/").split("/"))
