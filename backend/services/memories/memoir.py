"""The member memoir's list and header (spec 5, 5.1).

- :func:`list_memoir_members` -- the left list: every person of the service,
  oshi first (``people.sort_people``), each with her current avatar and her
  binder progress (``cards.progress_summary`` over ``binder.evaluate_person``).
  ``member_path`` is the chat path of her newest room. The whole list is one
  text-free ``view_cache`` row (view ``memoir_members``, key ``all``) whose
  hash covers every person's ``binder.binder_hash`` (room hashes, the JST
  date, letters / icon stats, ...) and the oshi set.
- :func:`memoir_header` -- the header: name, current avatar, graduation and
  three chips. A chip is ``None`` when its value would be 0 or is unknown, so
  the UI hides it (spec 1.1: never show "0"):

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

from datetime import datetime
from pathlib import Path

import structlog

from backend.services.memories import binder
from backend.services.memories import cards as cards_mod
from backend.services.memories import index as mi
from backend.services.memories import people
from backend.services.memories.facts import aggregate, get_person_facts
from backend.services.memories.selection import JST
from backend.services.memories.view_cache import cached_view, view_hash

logger = structlog.get_logger(__name__)

VIEW_MEMBERS = "memoir_members"


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
    data_hash = view_hash(hashes, sorted(oshi))

    async def build() -> dict:
        rows = []
        for s in ordered:
            cards = await binder.evaluate_person(service, sdir, s, now=now)
            earned, total = cards_mod.progress_summary(cards)
            timeline = await people.avatar_timelines(sdir, s)
            rows.append(
                {
                    "member_path": people.chat_path(sdir, _newest_room(s)),
                    "member_id": s.member_ids[-1] if s.member_ids else None,
                    "name": s.name,
                    "avatar_url": timeline.current,
                    "oshi": s.name_norm in oshi,
                    "graduated": s.graduated,
                    "progress": {"earned": earned, "total": total},
                }
            )
        logger.info("memories_memoir_members", count=len(rows), oshi=len(oshi))
        return {"members": rows}

    return await cached_view(sdir, VIEW_MEMBERS, "all", data_hash, build)


def _subscription_days(summary: mi.MemberSummary, now: datetime) -> int | None:
    start = binder.subscription_start(summary)
    if start is None:
        return None
    days = (now.astimezone(JST).date() - start).days + 1
    return days if days > 0 else None


async def memoir_header(
    service: str, sdir: Path, summary: mi.MemberSummary, *, now: datetime
) -> dict:
    """The memoir header of one person (see the module docstring)."""
    tagged = await get_person_facts(sdir, summary)
    agg = aggregate(f for _, f in tagged)
    timeline = await people.avatar_timelines(sdir, summary)
    chips = {
        "subscription_days": _subscription_days(summary, now),
        "nickname_count": agg.nickname_count or None,
        "voice_seconds": agg.voice_seconds or None,
    }
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
