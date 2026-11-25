"""Read pysaka's ``profile_images/index.json`` for the UI.

pysaka (>= 0.4.5) archives each member's list icon (``group_thumbnail``), chat
icon (``thumbnail``) and call-screen image (``phone_image``) under
``<member_dir>/profile_images/<kind>/<basename>`` and keeps an index whose
``current`` map holds each kind's latest API URL. This module turns that into
media URLs served by ``/api/content/media``.

``local_urls`` runs for every member on every sidebar poll, so it is a lexical
fast path: the index is parsed once per stat key, a file name is accepted only
when it is exactly what pysaka would have written (``kind/<sanitize_name>``),
and the URL is built from the member's relative path as a string -- no
``resolve()`` and no mixing of resolved and unresolved bases. The
filesystem-resolving containment check is kept for the on-demand
``list_images`` route only.
"""

from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping, Optional
from urllib.parse import quote

import structlog
from pysaka.profile_images import relative_file
from pysaka.utils import sanitize_name

from backend.services.messages_cache import StatKey, stat_key
from backend.services.service_utils import get_service_identifier

logger = structlog.get_logger(__name__)

KINDS = ("group_thumbnail", "thumbnail", "phone_image")
DIR_NAME = "profile_images"
INDEX_NAME = "index.json"
_MEDIA_PREFIX = "/api/content/media/"


@dataclass(frozen=True)
class _IndexView:
    """Validated, query-ready form of one ``index.json``."""

    # Entries of the index (valid kind and file name only), newest first.
    entries: list[dict[str, Any]] = field(default_factory=list)
    # kind -> latest API URL, as a string.
    current: dict[str, str] = field(default_factory=dict)
    # kind -> archived file (relative to ``profile_images/``) of the current URL.
    current_rel: dict[str, str] = field(default_factory=dict)
    # kind -> (absolute file, URL tail) for current images that are in the index.
    local: dict[str, tuple[Path, str]] = field(default_factory=dict)


_VIEWS: dict[str, tuple[StatKey, Optional[_IndexView]]] = {}
_VIEWS_LOCK = threading.Lock()
_GUARD_WARNED: set[str] = set()


def rel_path(output_dir: Path, path: Path) -> Optional[str]:
    """``path`` relative to ``output_dir`` as a ``/`` string, or None.

    Tries both sides as given, then both sides resolved, so a symlinked or
    otherwise aliased output directory never makes the two bases disagree.
    """
    try:
        return path.relative_to(output_dir).as_posix()
    except ValueError:
        pass
    try:
        return path.resolve().relative_to(output_dir.resolve()).as_posix()
    except (ValueError, OSError):
        return None


@lru_cache(maxsize=2048)
def _url_prefix(member_rel: str) -> Optional[str]:
    """Media URL of ``<member_rel>/profile_images/``, or None for unknown services."""
    parts = [p for p in member_rel.replace("\\", "/").split("/") if p]
    service_id = get_service_identifier(parts[0]) if parts else None
    if not service_id:
        return None
    segments = [quote(service_id, safe=""), *(quote(p, safe="") for p in parts[1:])]
    return _MEDIA_PREFIX + "/".join(segments) + "/" + DIR_NAME + "/"


def _canonical(kind: str, file: Any) -> bool:
    """True when ``file`` is exactly ``kind/<sanitize_name(name)>``.

    That is the only shape pysaka writes, and it cannot hold ``..`` segments,
    separators or Windows-forbidden characters.
    """
    if not isinstance(file, str) or not file.startswith(kind + "/"):
        return False
    name = file[len(kind) + 1 :]
    return bool(name) and name != "." and sanitize_name(name) == name


def _parse(member_dir: Path, data: Any) -> Optional[_IndexView]:
    if not isinstance(data, dict) or not isinstance(data.get("images"), list):
        return None
    raw_current = data.get("current")
    current = (
        {
            k: v
            for k, v in raw_current.items()
            if isinstance(k, str) and isinstance(v, str) and v
        }
        if isinstance(raw_current, dict)
        else {}
    )
    entries: list[dict[str, Any]] = []
    files: dict[str, set[str]] = {k: set() for k in KINDS}
    for e in data["images"]:
        if not isinstance(e, dict):
            continue
        kind, file = e.get("kind"), e.get("file")
        if kind not in KINDS or not isinstance(file, str):
            continue
        if not _canonical(kind, file):
            continue
        first_seen = e.get("first_seen")
        entries.append(
            {
                "kind": kind,
                "file": file,
                "first_seen": first_seen if isinstance(first_seen, str) else None,
            }
        )
        files[kind].add(file)
    entries.sort(key=lambda x: x["first_seen"] or "", reverse=True)

    root = member_dir / DIR_NAME
    current_rel: dict[str, str] = {}
    local: dict[str, tuple[Path, str]] = {}
    for kind in KINDS:
        url = current.get(kind)
        if not url:
            continue
        try:
            rel = relative_file(kind, url)
        except ValueError:  # urlparse rejects some malformed URLs
            continue
        if not rel:
            continue
        current_rel[kind] = rel
        if rel in files[kind]:
            tail = "/".join(quote(p, safe="") for p in rel.split("/"))
            local[kind] = (root / rel, tail)
    return _IndexView(entries, current, current_rel, local)


def _load_view(member_dir: Path) -> Optional[_IndexView]:
    """Parsed index, cached per stat key (failures included, logged once)."""
    path = member_dir / DIR_NAME / INDEX_NAME
    key = os.path.normcase(os.path.abspath(path))
    try:
        sk = stat_key(path)
    except OSError:
        with _VIEWS_LOCK:
            _VIEWS.pop(key, None)
        return None
    with _VIEWS_LOCK:
        hit = _VIEWS.get(key)
    if hit is not None and hit[0] == sk:
        return hit[1]
    view: Optional[_IndexView] = None
    try:
        with open(path, "r", encoding="utf-8") as f:
            view = _parse(member_dir, json.load(f))
        if view is None:
            logger.warning(
                "Profile image index has an unexpected shape", path=str(path)
            )
    except (OSError, ValueError, TypeError, AttributeError) as e:
        logger.warning(
            "Profile image index unreadable",
            path=str(path),
            error_type=type(e).__name__,
        )
    with _VIEWS_LOCK:
        _VIEWS[key] = (sk, view)
    return view


def history(member_dir: Path) -> list[dict[str, Optional[str]]]:
    """Archived images as ``{kind, file, first_seen}``, oldest first.

    ``first_seen`` is when pysaka first archived the file (UTC ISO), so the
    oldest entry of each kind marks when archiving began, not a change.
    Validated entries only; ``[]`` when there is no readable index.
    """
    view = _load_view(member_dir)
    if view is None:
        return []
    return [
        {"kind": e["kind"], "file": e["file"], "first_seen": e["first_seen"]}
        for e in reversed(view.entries)
    ]


def index_files(member_dir: Path) -> list[Path]:
    path = member_dir / DIR_NAME / INDEX_NAME
    return [path] if path.exists() else []


def local_urls(
    output_dir: Path, member_dir: Path, member_rel: Optional[str] = None
) -> dict[str, Optional[str]]:
    """``{kind}_local`` → media URL of the current archived image, or None.

    ``member_rel`` is the member directory relative to ``output_dir`` (callers
    usually have it already); when omitted it is derived. Never raises: any
    failure yields all None and one warning per exception type.
    """
    result: dict[str, Optional[str]] = {f"{k}_local": None for k in KINDS}
    try:
        view = _load_view(member_dir)
        if view is None or not view.local:
            return result
        if member_rel is None:
            member_rel = rel_path(output_dir, member_dir)
        prefix = _url_prefix(member_rel) if member_rel else None
        if prefix is None:
            return result
        for kind, (file_path, tail) in view.local.items():
            if file_path.is_file():
                result[f"{kind}_local"] = prefix + tail
    except Exception as e:
        name = type(e).__name__
        if name not in _GUARD_WARNED:
            _GUARD_WARNED.add(name)
            logger.warning("Profile image lookup failed", error_type=name)
        return {f"{k}_local": None for k in KINDS}
    return result


def _archived(
    view: _IndexView, root: Path, root_resolved: Path, prefix: str, kind: str
) -> list[dict[str, Any]]:
    """Archived entries of ``kind`` whose file exists, newest first."""
    out = []
    for e in view.entries:
        if e["kind"] != kind:
            continue
        file_path = root / e["file"]
        try:
            file_path.resolve().relative_to(root_resolved)
        except (ValueError, OSError):
            continue  # never serve outside profile_images/ (e.g. via a symlink)
        if not file_path.is_file():
            continue
        tail = "/".join(quote(p, safe="") for p in e["file"].split("/"))
        out.append(
            {"url": prefix + tail, "first_seen": e["first_seen"], "file": e["file"]}
        )
    return out


def list_images(
    output_dir: Path,
    member_dir: Path,
    member_block: Mapping[str, Any],
    member_rel: Optional[str] = None,
) -> dict[str, Any]:
    """Payload of ``GET /api/content/profile_images``."""
    view = _load_view(member_dir)
    if member_rel is None:
        member_rel = rel_path(output_dir, member_dir)
    prefix = _url_prefix(member_rel) if member_rel else None
    root = member_dir / DIR_NAME
    root_resolved = root.resolve()  # once, not per entry
    kinds: dict[str, list[dict[str, Any]]] = {}
    for kind in KINDS:
        if view is None:
            remote = member_block.get(kind)
            entries = (
                [{"url": remote, "first_seen": None, "current": True}] if remote else []
            )
        else:
            current_url = view.current.get(kind)
            current_rel = view.current_rel.get(kind)
            # Match by archived file (basename), never by full URL: CDN URLs may
            # carry query signatures that change between syncs for one image.
            entries = [
                {
                    "url": e["url"],
                    "first_seen": e["first_seen"],
                    "current": e["file"] == current_rel,
                }
                for e in (
                    _archived(view, root, root_resolved, prefix, kind)
                    if prefix is not None
                    else []
                )
            ]
            if current_url and not any(e["current"] for e in entries):
                entries.insert(
                    0, {"url": current_url, "first_seen": None, "current": True}
                )
        if entries:
            kinds[kind] = entries
    return {"kinds": kinds}
