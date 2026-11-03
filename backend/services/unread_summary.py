"""The unread total shown in the tray tooltip.

The count reuses the content API's per-conversation computation
(``_compute_unread_counts``: hidden/withdrawn messages are never counted) over
the read states the frontend pushes to ``/api/read-states``. Only conversations
that have a stored read state are counted: the backend cannot tell a
never-opened chat's old history from new messages.
"""

from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any

import structlog

from backend.services.path_resolver import get_output_dir
from backend.services.search_service import get_search_service
from backend.services.service_utils import get_service_display_name

logger = structlog.get_logger(__name__)

_FOLDER_ID = re.compile(r"^(\d+)\s")


def tooltip_text(n: int, strings: dict[str, str]) -> str:
    """``tooltip_unread`` (with ``{n}``) when ``n > 0``, else ``tooltip_idle``."""
    if n > 0:
        return strings["tooltip_unread"].format(n=n)
    return strings["tooltip_idle"]


def _child_dirs_by_id(base: Path) -> dict[int, str]:
    """``{id: folder name}`` of the ``"<id> <name>"`` subfolders of ``base``."""
    found: dict[int, str] = {}
    try:
        entries = list(base.iterdir())
    except OSError:
        return found
    for entry in entries:
        match = _FOLDER_ID.match(entry.name)
        if match and entry.is_dir():
            found.setdefault(int(match.group(1)), entry.name)
    return found


def _conversation_paths(
    output_dir: Path, stored: dict[str, Any]
) -> dict[str, dict[str, Any]]:
    """Map stored read states onto ``_compute_unread_counts`` input.

    Returns ``{path relative to output_dir: {"lastReadId", "revealedIds"}}``.
    A ``member_id`` of 0 is a group chat (the talk-room folder); anything else
    is a member folder inside the talk room. Entries whose service is unknown
    or whose folder is missing are skipped.
    """
    rooms_cache: dict[str, dict[int, str]] = {}
    members_cache: dict[str, dict[int, str]] = {}
    paths: dict[str, dict[str, Any]] = {}
    for entry in stored.values():
        try:
            display = get_service_display_name(entry["service"])
            group_id = int(entry["group_id"])
            member_id = int(entry["member_id"])
        except (KeyError, TypeError, ValueError):
            continue
        messages_rel = f"{display}/messages"
        if messages_rel not in rooms_cache:
            rooms_cache[messages_rel] = _child_dirs_by_id(output_dir / messages_rel)
        room = rooms_cache[messages_rel].get(group_id)
        if room is None:
            continue
        rel = f"{messages_rel}/{room}"
        if member_id != 0:
            if rel not in members_cache:
                members_cache[rel] = _child_dirs_by_id(output_dir / rel)
            member = members_cache[rel].get(member_id)
            if member is None:
                continue
            rel = f"{rel}/{member}"
        paths[rel] = {
            "lastReadId": entry.get("last_read_id") or 0,
            "revealedIds": entry.get("revealed_ids") or [],
        }
    return paths


def _total(output_dir: Path, stored: dict[str, Any]) -> int:
    """Blocking: the summed unread count of every stored conversation."""
    # Imported lazily: backend.api.content pulls in the whole API layer.
    from backend.api.content import _compute_unread_counts

    if not output_dir.exists():
        return 0
    paths = _conversation_paths(output_dir, stored)
    return sum(_compute_unread_counts(output_dir, paths).values())


async def unread_total() -> int:
    """Total unread messages across all stored conversations. Never raises.

    Returns 0 and logs ``tray_tooltip_failed`` (error type only) on failure.
    """
    try:
        stored = await get_search_service().get_all_read_states()
        return await asyncio.to_thread(_total, get_output_dir(), stored)
    except Exception as e:
        logger.warning("tray_tooltip_failed", error_type=type(e).__name__)
        return 0
