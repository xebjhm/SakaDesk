"""The unread total shown in the tray tooltip.

It is the sum of the sidebar's unread badges: the content API's per-conversation
computation (``_compute_unread_counts``: hidden/withdrawn messages are never
counted) over every conversation ``/api/content/groups`` lists, each capped by
the server's unread snapshot when known.

The read states come from the sidebar's own store, the ``app_state``
conversation rows ``read_state_<folder path>`` (``persisted.getConv``), so the
tooltip and the badges can never disagree. The search database's ``read_states``
table is only a fire-and-forget copy for the search filter and is not used here.
A conversation with no stored read state counts as nothing read.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Optional

import structlog

from backend.services import app_state
from backend.services.path_resolver import get_output_dir

logger = structlog.get_logger(__name__)


def tooltip_text(n: int, strings: dict[str, str]) -> str:
    """``tooltip_unread`` (with ``{n}``) when ``n > 0``, else ``tooltip_idle``."""
    if n > 0:
        return strings["tooltip_unread"].format(n=n)
    return strings["tooltip_idle"]


READ_STATE_KEY_PREFIX = "read_state_"


def _stored_state(stored: Mapping[str, Any], rel: str) -> Optional[dict[str, Any]]:
    """The ``{lastReadId, revealedIds}`` the sidebar uses for the conversation at ``rel``.

    Mirrors ``MemberList.checkUnread``: the row ``read_state_<rel>`` holds
    ``{"value": "<JSON>"}`` where the JSON is the frontend's ``ReadState``
    (``lastReadId``, ``readCount``, ``revealedIds``). A conversation with no row,
    or a row without a value, counts from ``lastReadId`` 0 with nothing revealed.
    Returns ``None`` for a value the sidebar skips: text that is not valid JSON,
    or JSON ``null`` (``null.lastReadId`` throws there). Any other JSON that is
    not an object (a number, string, boolean or array, e.g. a migrated legacy
    ``"12345"``) has no ``lastReadId``/``revealedIds`` property in JavaScript, so
    it counts from ``lastReadId`` 0 with nothing revealed, like a missing row.
    """
    row = stored.get(f"{READ_STATE_KEY_PREFIX}{rel}")
    raw = row.get("value") if isinstance(row, dict) else None
    if not raw:
        return {"lastReadId": 0, "revealedIds": []}
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if parsed is None:
        return None
    if not isinstance(parsed, dict):
        return {"lastReadId": 0, "revealedIds": []}
    return {
        "lastReadId": parsed.get("lastReadId") or 0,
        "revealedIds": parsed.get("revealedIds") or [],
    }


def _total(output_dir: Path, stored: Mapping[str, Any]) -> int:
    """Blocking: the unread total the sidebar badges add up to.

    Same rule as the sidebar (``MemberList.tsx``): every conversation listed by
    ``/api/content/groups`` counts, a group chat by its room folder and any
    other by its first member folder; the count is the stored read state's
    (or a fresh ``lastReadId`` 0) ``_compute_unread_counts``, capped by the
    group's ``server_unread_count`` when the server's snapshot is known.
    Graduated group chats are skipped because the sidebar does not show them.
    ``stored`` is :func:`backend.services.app_state.get_all_conversations`, i.e.
    the rows the sidebar itself reads (key ``read_state_<folder path>``).
    """
    # Imported lazily: backend.api.content pulls in the whole API layer.
    from backend.api.content import (
        _compute_unread_counts,
        _list_group_refs,
        load_sync_metadata,
    )

    if not output_dir.exists():
        return 0
    _, server_groups, _ = load_sync_metadata(output_dir)
    refs, _ = _list_group_refs(output_dir, server_groups)
    states: dict[str, dict[str, Any]] = {}
    unparsable = 0
    caps: dict[str, int | None] = {}
    for ref in refs:
        if ref.is_group_chat and ref.is_graduated:
            continue  # the sidebar does not show graduated group chats
        folder = ref.group_dir if ref.is_group_chat else ref.member_dirs[0]
        rel = str(folder.relative_to(output_dir)).replace("\\", "/")
        state = _stored_state(stored, rel)
        if state is None:
            unparsable += 1
            continue
        states[rel] = state
        caps[rel] = ref.server_unread_count
    if unparsable:
        logger.info("tray_tooltip_state_skipped", reason="unparsable", count=unparsable)

    counts = _compute_unread_counts(output_dir, states)
    total = 0
    for rel, cap in caps.items():
        unread = counts.get(rel) or 0
        total += unread if cap is None else min(unread, cap)
    return total


def _compute_total() -> int:
    # Everything blocking runs here, on a worker thread: settings.json (output
    # dir), the app_state SQLite read and the folder scan.
    return _total(get_output_dir(), app_state.get_all_conversations())


async def unread_total() -> int:
    """Total unread messages across all stored conversations. Never raises.

    Returns 0 and logs ``tray_tooltip_failed`` (error type only) on failure.
    """
    try:
        return await asyncio.to_thread(_compute_total)
    except Exception as e:
        logger.warning("tray_tooltip_failed", error_type=type(e).__name__)
        return 0
