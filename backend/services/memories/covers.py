"""Album cover overrides: the right-click 「この月の表紙にする」 (spec 8).

The fan's chosen covers live in ``app_state.db`` (``user_store``), keyed by
the service folder name, the album scope and the JST month.

Contract of :func:`load_cover_overrides` (consumed by :mod:`album`):

- ``scope`` is ``people.person_key(summary)`` for one person, or ``"all"``
  for the 全員 album.
- The result maps a JST month (``YYYY-MM``) to ``(room, message_id)``, where
  ``room`` is the relative POSIX ``member_dir``.
- An override wins only while that message is still a picture / video of
  that month in the album's current filter; otherwise the normal cover rules
  decide (``album.choose_cover``). A stale override is never an error.
- An override keyed by ``person_key`` stops applying when that person gains
  a room (her key changes): that is a stale override too, never an error,
  and the fan can set it again.
- A ``sqlite3.Error`` while reading gives ``{}`` and one ``memories_skip``
  (``view=album_cover``, ``reason=override_read_failed``): the album still
  renders with its automatic covers.

The overrides are part of the album's cache hash, so a change re-picks covers.

:func:`set_cover_override` accepts only a picture / video fact of that JST
month within the scope (``people.scope_facts`` + ``album.keep(f, "all")``);
anything else is ``ValueError("not_in_month")``. :func:`clear_cover_override`
removes the month's override and says whether one existed. Both log
``memories_cover`` (``op``, ids and flags only; never the scope or room).
"""

from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import Sequence
from datetime import datetime
from pathlib import Path

import structlog

from backend.services.memories import album, people, user_store
from backend.services.memories.facts import Fact
from backend.services.memories.index import MemberSummary, list_members
from backend.services.memories.timeline import MONTH_RE, month_of

logger = structlog.get_logger(__name__)

_EVENT = "memories_cover"


def _scope_of(member: MemberSummary | None) -> str:
    return people.person_key(member) if member is not None else "all"


def _check_month(month: str) -> None:
    if not MONTH_RE.match(month):
        raise ValueError("month must be YYYY-MM")


async def load_cover_overrides(sdir: Path, scope: str) -> dict[str, tuple[str, int]]:
    """``month -> (room, message_id)`` chosen by the fan for ``scope``."""
    try:
        return await user_store.acover_overrides(sdir.name, scope)
    except sqlite3.Error as e:
        logger.warning(
            "memories_skip",
            view=album.VIEW_COVER,
            reason="override_read_failed",
            error_type=type(e).__name__,
        )
        return {}


def _in_month(
    tagged: Sequence[tuple[str, Fact]], room: str, message_id: int, month: str
) -> bool:
    """Whether ``(room, message_id)`` is a picture / video fact of JST ``month``."""
    return any(
        r == room
        and f.id == message_id
        and album.keep(f, "all")
        and month_of(f.jst_date) == month
        for r, f in tagged
    )


async def set_cover_override(
    service: str,
    sdir: Path,
    *,
    member: MemberSummary | None,
    month: str,
    room: str,
    message_id: int,
    now: datetime,
) -> None:
    """Make ``(room, message_id)`` the cover of ``month`` in the scope's album.

    ``ValueError("not_in_month")`` unless it is a picture / video fact of that
    JST month within the scope; ``ValueError`` for a malformed ``month``.
    ``service`` is the active service (the scope is resolved from ``sdir``).
    """
    del service  # the store is keyed by the service folder (``sdir.name``)
    _check_month(month)
    persons = [member] if member is not None else await list_members(sdir)
    tagged = await people.scope_facts(sdir, persons)
    # Up to ~50k facts for 全員: scan in a worker, off the event loop.
    found = await asyncio.to_thread(_in_month, tagged, room, message_id, month)
    scoped = member is not None
    if not found:
        logger.info(
            _EVENT,
            op="set",
            outcome="not_in_month",
            message_id=message_id,
            scoped=scoped,
        )
        raise ValueError("not_in_month")
    await user_store.aset_cover_override(
        sdir.name, _scope_of(member), month, room, message_id, now=now
    )
    logger.info(_EVENT, op="set", outcome="set", message_id=message_id, scoped=scoped)


async def clear_cover_override(
    service: str, sdir: Path, *, member: MemberSummary | None, month: str
) -> bool:
    """Remove the scope's override of ``month``; whether one existed.

    ``ValueError`` for a malformed ``month``.
    """
    del service  # the store is keyed by the service folder (``sdir.name``)
    _check_month(month)
    found = await user_store.aclear_cover_override(sdir.name, _scope_of(member), month)
    logger.info(_EVENT, op="clear", found=found, scoped=member is not None)
    return found


__all__ = ["clear_cover_override", "load_cover_overrides", "set_cover_override"]
