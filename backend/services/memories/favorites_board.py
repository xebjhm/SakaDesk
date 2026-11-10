"""The favorites cork board (spec 10): every ★ message of the service.

:func:`favorites_board` returns ``{"total", "members", "items"}``:

- ``items`` -- every favourited fact (promo included: it is her real chat)
  of ``member`` or, with ``member=None``, of everyone, as shared message
  objects (``people.message_ref`` with her avatar at that time, ``text`` /
  ``caption`` from one ``load_texts`` per room) plus ``favorited_at``: the
  UTC ISO time the fan starred it (``app_state.favorited_at``, read in a
  worker; message ids are per service so the lookup is valid), or ``None``
  when the star predates the favourite log. Order: the known
  ``favorited_at`` newest first, then the unknown ones by message ``ts``
  newest first (a star without a logged time is older than the log).
- ``members`` -- the left list, always over everyone whatever ``member``
  is: ``{"member_path", "member_id", "name", "avatar_url", "count"}`` per
  person with at least one ★ (a person without any is left out, so a "0" is
  never shown), oshi first, then by count descending (ties: the
  ``index.list_members`` order). ``avatar_url`` is her current icon.
- ``total`` -- the ★ count over everyone.

Not cached: ``favorited_at`` changes without touching the archive. Every
person's facts are read once; filtering and ordering run in a worker.

Logs (ids, codes and counts only): ``memories_favorites`` with ``count``
(items returned), ``members`` and ``with_time`` (items with a known
``favorited_at``).
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from pathlib import Path

import structlog

from backend.services import app_state
from backend.services.archive_urls import parse_iso
from backend.services.memories import index as mi
from backend.services.memories import people
from backend.services.memories.facts import Fact

logger = structlog.get_logger(__name__)

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


def _ordered(items: list[dict]) -> list[dict]:
    """Known ``favorited_at`` newest first, then message ``ts`` newest first. Pure."""
    known = [i for i in items if parse_iso(i["favorited_at"]) is not None]
    unknown = [i for i in items if parse_iso(i["favorited_at"]) is None]
    known.sort(key=lambda i: (parse_iso(i["favorited_at"]), i["ts"]), reverse=True)
    unknown.sort(key=lambda i: (i["ts"], i["id"]), reverse=True)
    return known + unknown


async def favorites_board(
    service: str, sdir: Path, *, member: mi.MemberSummary | None
) -> dict:
    """The cork board of ``member`` (or everyone); see the module docstring."""
    persons = await mi.list_members(sdir)
    oshi = await people.oshi_rooms(service, persons)
    tagged = [await people.scope_facts(sdir, [s]) for s in persons]
    starred = await asyncio.to_thread(_starred, persons, tagged)
    rows = await asyncio.to_thread(_member_rows, starred, persons, oshi)
    scope = people.person_key(member) if member is not None else None
    shown = [t for t in starred if scope is None or people.person_key(t[0]) == scope]
    avatars = await people.avatar_timelines_for(
        sdir, {people.person_key(s): s for s, _ in rows}
    )
    items = [
        people.message_ref(
            service, sdir, room, f, avatar=avatars.get(people.person_key(s))
        )
        for s, room, f in shown
    ]
    times = await asyncio.to_thread(
        app_state.favorited_at, service, sorted({i["id"] for i in items})
    )
    for item in items:
        item["favorited_at"] = times.get(item["id"])
    items = await asyncio.to_thread(_ordered, items)
    await people.attach_texts(sdir, items)
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
    logger.info(
        "memories_favorites",
        count=len(items),
        members=len(members),
        with_time=sum(1 for i in items if i["favorited_at"] is not None),
    )
    return {"total": len(starred), "members": members, "items": items}


__all__ = ["favorites_board"]
