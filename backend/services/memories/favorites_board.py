"""The favorites cork board (spec 10): every ★ message of the service.

:func:`favorites_board` returns ``{"total", "members", "items"}``:

- ``items`` -- every favourited fact (promo included: it is her real chat)
  of ``member`` or, with ``member=None``, of everyone, as shared message
  objects (``people.message_ref`` with her avatar at that time, ``text`` /
  ``caption`` from one ``load_texts`` per room) plus ``favorited_at``: the
  UTC ISO time the fan starred it in this app (``app_state.favorited_at``,
  read in a worker; message ids are per service so the lookup is valid), or
  ``None`` when unknown. A star set in the official phone app (or before the
  favourite log existed) has no log row, so its time is unknown; it is never
  assumed to be old. Order: newest first by ``favorited_at`` when known, else
  by the message ``ts`` (a lower bound of the star time, as
  ``app_state.record_favorite`` documents); ties: the higher id first.
- ``members`` -- the left list, always over everyone whatever ``member``
  is: ``{"member_path", "member_id", "name", "avatar_url", "count"}`` per
  person with at least one ★ (a person without any is left out, so a "0" is
  never shown), oshi first, then by count descending (ties: the
  ``index.list_members`` order). ``avatar_url`` is her current icon.
- ``total`` -- the ★ count over everyone.

The text-free part (``total``, ``members`` and every starred message object
of everyone, without ``favorited_at``) is cached (view ``favorites``, key
``all``, hash over :data:`VERSION`, every person's room hashes, which cover
``is_favorite``, and the oshi set). After the cache read the member filter,
``favorited_at``, the order and the texts are applied. A failed favourite-log
read is logged (``memories_skip``, ``reason=favorite_log_unreadable``) and
every time is treated as unknown.

Logs (ids, codes and counts only): ``memories_favorites`` with ``count``
(items returned), ``members`` and ``with_time`` (items with a known
``favorited_at``).
"""

from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import Sequence
from datetime import datetime, timezone
from pathlib import Path

import structlog

from backend.services import app_state
from backend.services.archive_urls import parse_iso
from backend.services.memories import index as mi
from backend.services.memories import people
from backend.services.memories.facts import Fact
from backend.services.memories.view_cache import cached_view, view_hash

logger = structlog.get_logger(__name__)

VIEW = "favorites"
# Bump on any rule or payload change of the cached part (the hash has it).
VERSION = 1
_NO_TIME = datetime.min.replace(tzinfo=timezone.utc)

_Starred = tuple[mi.MemberSummary, str, Fact]


def _starred(
    persons: Sequence[mi.MemberSummary],
    tagged: Sequence[Sequence[tuple[str, Fact]]],
) -> list[_Starred]:
    """``(person, room, fact)`` of every favourited fact. Pure; runs in a worker."""
    return [
        (s, room, f)
        for s, facts in zip(persons, tagged)
        for room, f in facts
        if f.favorited
    ]


def _member_rows(
    starred: Sequence[_Starred],
    persons: Sequence[mi.MemberSummary],
    oshi: set[str],
) -> list[tuple[mi.MemberSummary, int]]:
    """``(person, ★ count)`` with a count, oshi first, then by count. Pure."""
    counts: dict[str, int] = {}
    for s, _, _ in starred:
        key = people.person_key(s)
        counts[key] = counts.get(key, 0) + 1
    rows = [
        (s, counts[people.person_key(s)])
        for s in persons
        if people.person_key(s) in counts
    ]
    rows.sort(key=lambda r: (r[0].name_norm not in oshi, -r[1]))
    return rows


def _sort_key(item: dict) -> tuple[datetime, int]:
    when = parse_iso(item["favorited_at"]) or parse_iso(item["ts"]) or _NO_TIME
    return when, item["id"]


def _ordered(items: list[dict]) -> list[dict]:
    """Newest first by ``favorited_at``, else by the message ``ts``. Pure."""
    return sorted(items, key=_sort_key, reverse=True)


def _fav_times(service: str, ids: list[int]) -> dict[int, str]:
    """``app_state.favorited_at``; ``{}`` (logged) when the log is unreadable."""
    try:
        return app_state.favorited_at(service, ids)
    except sqlite3.Error as e:
        logger.warning(
            "memories_skip",
            view=VIEW,
            reason="favorite_log_unreadable",
            error_type=type(e).__name__,
        )
        return {}


async def _board(service: str, sdir: Path) -> dict:
    """The text-free board of everyone (cached); items in archive order."""
    persons, _, hashes = await people.album_scope(sdir, None)
    oshi = await people.oshi_rooms(service, persons)
    data_hash = view_hash(VERSION, hashes, sorted(oshi))

    async def build() -> dict:
        tagged = [await people.scope_facts(sdir, [s]) for s in persons]
        starred = await asyncio.to_thread(_starred, persons, tagged)
        rows = await asyncio.to_thread(_member_rows, starred, persons, oshi)
        avatars = await people.avatar_timelines_for(
            sdir, {people.person_key(s): s for s, _ in rows}
        )
        items = [
            people.message_ref(
                service, sdir, room, f, avatar=avatars[people.person_key(s)]
            )
            for s, room, f in starred
        ]
        members = [
            {
                "member_path": people.chat_path(sdir, s.member_dirs[-1]),
                "member_id": s.member_ids[-1] if s.member_ids else None,
                "name": s.name,
                "avatar_url": avatars[people.person_key(s)].current,
                "count": n,
            }
            for s, n in rows
        ]
        return {"total": len(starred), "members": members, "items": items}

    return await cached_view(sdir, VIEW, "all", data_hash, build)


async def favorites_board(
    service: str, sdir: Path, *, member: mi.MemberSummary | None
) -> dict:
    """The cork board of ``member`` (or everyone); see the module docstring."""
    board = await _board(service, sdir)
    rooms = set(member.member_dirs) if member is not None else None
    items = [i for i in board["items"] if rooms is None or i["room"] in rooms]
    times = await asyncio.to_thread(
        _fav_times, service, sorted({i["id"] for i in items})
    )
    for item in items:
        item["favorited_at"] = times.get(item["id"])
    items = await asyncio.to_thread(_ordered, items)
    await people.attach_texts(sdir, items)
    logger.info(
        "memories_favorites",
        count=len(items),
        members=len(board["members"]),
        with_time=sum(1 for i in items if i["favorited_at"] is not None),
    )
    return {"total": board["total"], "members": board["members"], "items": items}


__all__ = ["VERSION", "favorites_board"]
