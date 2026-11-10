"""The member memoir's list and header (spec 5, 5.1).

- :func:`list_memoir_members` -- the left list: every person of the service,
  oshi first (``people.sort_people``), each with her current avatar and her
  binder progress (the ``progress`` of ``binder.binder_payload``).
  ``member_path`` is the chat path of her newest room. Progress is cached per
  person by the binder view itself (key ``person_key``, hash
  ``binder.binder_hash``), so after a sync only the people whose hash changed
  are evaluated, at most :data:`EVAL_CONCURRENCY` at a time. The assembled
  list is one more text-free ``view_cache`` row (view ``memoir_members``, key
  ``all``) whose hash covers :data:`MEMBERS_VERSION`, every person's
  ``binder_hash`` (room hashes, the JST date, letters / icon stats, ...) and
  the oshi set.
- :func:`memoir_header` -- the header: name, current avatar, graduation and
  three chips. A chip is ``None`` when its value would be 0 or is unknown, so
  the UI hides it (spec 1.1: never show "0"). The chips are cached (view
  ``memoir_header``, key ``person_key``, hash over :data:`HEADER_VERSION`,
  ``people.room_hashes``, the JST date and the start date); the fact
  aggregation runs in a worker:

  - ``subscription_days`` = ``(today_jst - start).days + 1`` from the archived
    earliest subscription start; ``None`` without a (parsable) start or when
    the start is after today;
  - ``nickname_count`` = ``aggregate(facts).nickname_count`` (promo included);
    ``None`` at 0, which also hides the 被叫名字 entry;
  - ``voice_seconds`` = ``aggregate(facts).voice_seconds``; ``None`` at 0.

Logs (ids, codes and counts only; ``person`` = first member id):
``memories_memoir_members`` (``count``, ``oshi``) when the list is built and
``memories_memoir_header`` (``person``, ``hidden`` = chips hidden).
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from datetime import date, datetime
from pathlib import Path

import structlog

from backend.services.memories import binder
from backend.services.memories import index as mi
from backend.services.memories import people
from backend.services.memories.facts import Fact, aggregate, get_person_facts
from backend.services.memories.selection import JST
from backend.services.memories.view_cache import cached_view, view_hash

logger = structlog.get_logger(__name__)

VIEW_MEMBERS = "memoir_members"
VIEW_HEADER = "memoir_header"
# Bump on any rule or payload change of the list / the header chips.
MEMBERS_VERSION = 1
HEADER_VERSION = 1
# Binder evaluations run at once on a members-list miss.
EVAL_CONCURRENCY = 4


def _member_id(summary: mi.MemberSummary) -> str | None:
    return summary.member_ids[0] if summary.member_ids else None


def _newest_room(summary: mi.MemberSummary) -> str:
    """Her newest room (``member_dirs`` is oldest first)."""
    return summary.member_dirs[-1]


async def list_memoir_members(service: str, sdir: Path, *, now: datetime) -> dict:
    """The memoir's member list: ``{"members": [...]}``, oshi first, cached."""
    summaries = await mi.list_members(sdir)
    oshi = await people.oshi_rooms(service, summaries)
    ordered = people.sort_people(summaries, oshi)
    hashes = [await binder.binder_hash(sdir, s, now=now) for s in ordered]
    data_hash = view_hash(MEMBERS_VERSION, hashes, sorted(oshi))
    gate = asyncio.Semaphore(EVAL_CONCURRENCY)

    async def row(s: mi.MemberSummary, binder_hash: str) -> dict:
        async with gate:
            # a per-person binder cache hit evaluates nothing
            payload = await binder.binder_payload(
                service, sdir, s, now=now, data_hash=binder_hash
            )
            timeline = await people.avatar_timelines(sdir, s)
        return {
            "member_path": people.chat_path(sdir, _newest_room(s)),
            "member_id": s.member_ids[-1] if s.member_ids else None,
            "name": s.name,
            "avatar_url": timeline.current,
            "oshi": s.name_norm in oshi,
            "graduated": s.graduated,
            "progress": payload["progress"],  # {"earned", "total"}
        }

    async def build() -> dict:
        rows = list(await asyncio.gather(*map(row, ordered, hashes)))
        logger.info("memories_memoir_members", count=len(rows), oshi=len(oshi))
        return {"members": rows}

    return await cached_view(sdir, VIEW_MEMBERS, "all", data_hash, build)


def _chips(tagged: Sequence[tuple[str, Fact]], start: date | None, today: date) -> dict:
    """The header chips (see the module docstring). Pure; runs in a worker."""
    agg = aggregate(f for _, f in tagged)
    days = (today - start).days + 1 if start is not None else 0
    return {
        "subscription_days": days if days > 0 else None,
        "nickname_count": agg.nickname_count or None,
        "voice_seconds": agg.voice_seconds or None,
    }


async def memoir_header(
    service: str, sdir: Path, summary: mi.MemberSummary, *, now: datetime
) -> dict:
    """The memoir header of one person (see the module docstring)."""
    today = now.astimezone(JST).date()
    data_hash = view_hash(
        HEADER_VERSION,
        await people.room_hashes(sdir, summary),
        today.isoformat(),
        summary.subscription_start,
    )

    async def build() -> dict:
        tagged = await get_person_facts(sdir, summary)
        start = binder.subscription_start(summary)
        return await asyncio.to_thread(_chips, tagged, start, today)

    chips = await cached_view(
        sdir, VIEW_HEADER, people.person_key(summary), data_hash, build
    )
    timeline = await people.avatar_timelines(sdir, summary)
    logger.info(
        "memories_memoir_header",
        person=_member_id(summary),
        hidden=sum(v is None for v in chips.values()),
    )
    return {
        "member_path": people.chat_path(sdir, _newest_room(summary)),
        "name": summary.name,
        "avatar_url": timeline.current,
        "graduated": summary.graduated,
        "chips": chips,
    }


__all__ = ["list_memoir_members", "memoir_header"]
