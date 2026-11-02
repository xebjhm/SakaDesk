"""Read pysaka's ``profile_images/index.json`` for the UI.

pysaka (>= 0.4.5) archives each member's list icon (``group_thumbnail``), chat
icon (``thumbnail``) and call-screen image (``phone_image``) under
``<member_dir>/profile_images/<kind>/<basename>`` and keeps an index whose
``current`` map holds each kind's latest API URL. This module turns that into
media URLs served by ``/api/content/media``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping, Optional
from urllib.parse import quote

from pysaka.profile_images import relative_file

from backend.services.messages_cache import StatCache
from backend.services.service_utils import get_service_identifier

KINDS = ("group_thumbnail", "thumbnail", "phone_image")
DIR_NAME = "profile_images"
INDEX_NAME = "index.json"
_INDEX_CACHE = StatCache()


def _media_url(output_dir: Path, file_path: Path) -> Optional[str]:
    rel = file_path.relative_to(output_dir).parts
    service_id = get_service_identifier(rel[0]) if rel else None
    if not service_id:
        return None
    return "/api/content/media/" + "/".join(
        [quote(service_id, safe="")] + [quote(p, safe="") for p in rel[1:]]
    )


def _load_index(member_dir: Path) -> Optional[dict[str, Any]]:
    path = member_dir / DIR_NAME / INDEX_NAME
    try:
        index = _INDEX_CACHE.get(path, lambda data: data)
    except (OSError, ValueError):
        return None
    if not isinstance(index, dict) or not isinstance(index.get("images"), list):
        return None
    return index


def index_files(member_dir: Path) -> list[Path]:
    path = member_dir / DIR_NAME / INDEX_NAME
    return [path] if path.exists() else []


def _archived(
    output_dir: Path, member_dir: Path, index: dict[str, Any], kind: str
) -> list[dict[str, Any]]:
    """Archived entries of ``kind`` whose file exists, newest first."""
    out = []
    for e in index["images"]:
        if not isinstance(e, dict) or e.get("kind") != kind or not e.get("file"):
            continue
        file_path = member_dir / DIR_NAME / str(e["file"])
        try:
            file_path.resolve().relative_to((member_dir / DIR_NAME).resolve())
        except ValueError:
            continue  # never serve outside profile_images/
        if not file_path.is_file():
            continue
        url = _media_url(output_dir, file_path)
        if url:
            out.append(
                {"url": url, "first_seen": e.get("first_seen"), "file": str(e["file"])}
            )
    out.sort(key=lambda x: x["first_seen"] or "", reverse=True)
    return out


def _is_current(kind: str, entry_file: str, current_url: Optional[str]) -> bool:
    """Match by archived file (basename), never by full URL: CDN URLs may carry
    query signatures that change between syncs for the same image."""
    return bool(current_url) and relative_file(kind, str(current_url)) == entry_file


def local_urls(output_dir: Path, member_dir: Path) -> dict[str, Optional[str]]:
    """``{kind}_local`` → media URL of the current archived image, or None."""
    result: dict[str, Optional[str]] = {f"{k}_local": None for k in KINDS}
    index = _load_index(member_dir)
    if index is None:
        return result
    current = index.get("current") or {}
    for kind in KINDS:
        for e in _archived(output_dir, member_dir, index, kind):
            if _is_current(kind, e["file"], current.get(kind)):
                result[f"{kind}_local"] = e["url"]
                break
    return result


def list_images(
    output_dir: Path, member_dir: Path, member_block: Mapping[str, Any]
) -> dict[str, Any]:
    """Payload of ``GET /api/content/profile_images``."""
    index = _load_index(member_dir)
    kinds: dict[str, list[dict[str, Any]]] = {}
    for kind in KINDS:
        if index is None:
            remote = member_block.get(kind)
            entries = (
                [{"url": remote, "first_seen": None, "current": True}] if remote else []
            )
        else:
            current_url = (index.get("current") or {}).get(kind)
            archived = _archived(output_dir, member_dir, index, kind)
            entries = [
                {
                    "url": e["url"],
                    "first_seen": e["first_seen"],
                    "current": _is_current(kind, e["file"], current_url),
                }
                for e in archived
            ]
            if current_url and not any(e["current"] for e in entries):
                entries.insert(
                    0, {"url": current_url, "first_seen": None, "current": True}
                )
        if entries:
            kinds[kind] = entries
    return {"kinds": kinds}
