"""The unread total shown in the tray tooltip.

It is the sum of the sidebar's unread badges: the content API's per-conversation
computation (``_compute_unread_counts``: hidden/withdrawn messages are never
counted) over every conversation ``/api/content/groups`` lists, using the read
states the frontend pushes to ``/api/read-states`` (none stored = nothing read),
each capped by the server's unread snapshot when known.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import structlog

from backend.services.path_resolver import get_output_dir
from backend.services.search_service import get_search_service

logger = structlog.get_logger(__name__)


def tooltip_text(n: int, strings: dict[str, str]) -> str:
    """``tooltip_unread`` (with ``{n}``) when ``n > 0``, else ``tooltip_idle``."""
    if n > 0:
        return strings["tooltip_unread"].format(n=n)
    return strings["tooltip_idle"]


def _stored_state(
    indexed: dict[tuple[str, str, int], Any],
    service_id: str,
    group_id: str,
    member_id: int,
) -> dict[str, Any]:
    """The ``{lastReadId, revealedIds}`` for one conversation.

    Mirrors the sidebar: a conversation with no stored read state counts from
    ``lastReadId`` 0 with nothing revealed.
    """
    entry = indexed.get((service_id, group_id, member_id))
    if entry is None:
        return {"lastReadId": 0, "revealedIds": []}
    return {
        "lastReadId": entry.get("last_read_id") or 0,
        "revealedIds": entry.get("revealed_ids") or [],
    }


def _index_stored(stored: dict[str, Any]) -> dict[tuple[str, str, int], Any]:
    """Re-key the stored read states by ``(service id, group id, member id)``."""
    indexed: dict[tuple[str, str, int], Any] = {}
    for entry in stored.values():
        try:
            indexed[
                (
                    str(entry["service"]),
                    str(int(entry["group_id"])),
                    int(entry["member_id"]),
                )
            ] = entry
        except (KeyError, TypeError, ValueError):
            continue
    return indexed


def _total(output_dir: Path, stored: dict[str, Any]) -> int:
    """Blocking: the unread total the sidebar badges add up to.

    Same rule as the sidebar (``MemberList.tsx``): every conversation listed by
    ``/api/content/groups`` counts, a group chat by its room folder and any
    other by its first member folder; the count is the stored read state's
    (or a fresh ``lastReadId`` 0) ``_compute_unread_counts``, capped by the
    group's ``server_unread_count`` when the server's snapshot is known.
    """
    # Imported lazily: backend.api.content pulls in the whole API layer.
    from backend.api.content import (
        _compute_unread_counts,
        _list_group_refs,
        load_sync_metadata,
        parse_id_name,
    )

    if not output_dir.exists():
        return 0
    _, server_groups, _ = load_sync_metadata(output_dir)
    refs, _ = _list_group_refs(output_dir, server_groups)
    indexed = _index_stored(stored)

    states: dict[str, dict[str, Any]] = {}
    caps: dict[str, int | None] = {}
    for ref in refs:
        if ref.is_group_chat:
            folder, member_id = ref.group_dir, 0
        else:
            folder = ref.member_dirs[0]
            raw_id, _name = parse_id_name(folder.name)
            member_id = int(raw_id) if raw_id and raw_id.isdigit() else -1
        rel = str(folder.relative_to(output_dir)).replace("\\", "/")
        states[rel] = _stored_state(indexed, ref.service_id, ref.group_id, member_id)
        caps[rel] = ref.server_unread_count

    counts = _compute_unread_counts(output_dir, states)
    total = 0
    for rel, cap in caps.items():
        unread = counts.get(rel) or 0
        total += unread if cap is None else min(unread, cap)
    return total


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
