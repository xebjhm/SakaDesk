"""那一天 day view (spec 7): every message of one JST date, merged.

:func:`day_view` returns ``{"date", "members", "messages", "other_services"}``:

- ``messages``: every fact of ``day`` of every person (or of ``member`` only)
  as shared message objects, sorted by ``(ts, id)`` (then service and room),
  promo included (it is the real chat). Each carries her avatar at its time;
  ``text`` / ``caption`` come from one ``load_texts`` per room (at most
  ``people.IO_CONCURRENCY`` rooms at once, as are the avatars), called per
  service with that service's own data dir (two services can share the
  same relative room path).
- ``members``: the people who posted that day, oshi first (stable: the
  active service first, then :func:`service_utils.get_all_services` order,
  each in :func:`index.list_members` order): ``member_path`` (chat path of
  her newest room), ``member_id`` (of that room), ``name``, ``avatar_url``
  (her avatar at her first message of the day), ``service``, ``oshi`` and
  ``person_key`` (:func:`day_person_key`).
- every message also carries its sender's ``person_key``, so the UI groups
  a person's rooms (chips, swimlanes) without matching names.
- ``include_other_services`` (ignored when ``member`` is set): every other
  service of :func:`service_utils.get_all_services` whose data dir exists
  (``<output dir>/<display name>``, the output dir being ``sdir.parent``,
  i.e. ``path_resolver.resolve_service_path``) adds its people the same
  way, tagged with its own ``service``; a missing data dir logs
  ``memories_skip`` (``view=day``, ``reason=service_dir_missing``,
  ``service``). ``other_services`` lists the ones
  that had messages that day. Any failure in another service is logged as
  ``memories_skip`` (``view=day``, ``reason=other_service_failed``,
  ``service``, ``error_type``) and never fails the request.

The film strip calls this with ``member`` and centres on its message id.

Logs (ids, codes and counts only): ``memories_day`` (``members``, ``count``,
``others`` = other services were read, ``services`` = services with
messages in the payload).

**Same day, every year** (歷年同一天) -- :func:`day_years` returns
``{"month_day", "members", "years": [{"year", "date", "messages"}]}``:

- the same calendar day ``month_day`` (``MM-DD``) in every year that has
  messages on it (oldest first), up to today (JST): one person (``member``)
  or everyone of the active service; never other services;
- ``messages`` per year are the day view's message objects (texts attached,
  ``person_key``, sorted by ``(ts, id, room)``), promo included (the real
  chat), each with ``kind`` for the UI's guide lines
  (:func:`facts.message_kind`, the rule 初見と今 shares: ``ohayo`` only
  04:00-11:59, Q&A posts never a greeting, ``photo`` / ``video`` apart);
- the subscription welcome (``Fact.is_welcome``) is left out: it is the
  room's automatic greeting, not her day;
- ``members`` are the people with a message on any of those days, oshi
  first, as in the day view (``avatar_url`` = her avatar at her first
  message on this month-day).

Not cached (the payload carries her words). Logs ``memories_day_years``
(``years``, ``members``, ``count``, ``welcome`` = welcome messages left
out).
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime
from pathlib import Path

import structlog

from backend.services import service_utils
from backend.services.memories import index as mi
from backend.services.memories import people
from backend.services.memories.facts import Fact, message_kind
from backend.services.memories.selection import JST

logger = structlog.get_logger(__name__)

VIEW = "day"

_Tagged = tuple[mi.MemberSummary, str, Fact]


def day_person_key(service: str, summary: mi.MemberSummary) -> str:
    """A person's key in the day payload: unique across services. Never logged."""
    return people.service_person_key(service, summary)


def _compose(
    service: str,
    sdir: Path,
    tagged: list[_Tagged],
    oshi: set[str],
    avatars: dict[str, people.AvatarTimeline],
) -> tuple[list[dict], list[dict]]:
    """``(members, message refs)`` of one service. Blocking (runs in a worker)."""
    refs: list[dict] = []
    first_ts: dict[str, datetime] = {}
    by_key: dict[str, mi.MemberSummary] = {}
    for s, room, fact in tagged:  # sorted by (ts, id, room)
        key = people.person_key(s)
        by_key.setdefault(key, s)
        first_ts.setdefault(key, fact.ts)
        ref = people.message_ref(service, sdir, room, fact, avatar=avatars[key])
        ref["person_key"] = day_person_key(service, s)
        refs.append(ref)
    members = []
    for s in people.sort_people(list(by_key.values()), oshi):
        key = people.person_key(s)
        members.append(
            {
                "member_path": people.chat_path(sdir, s.member_dirs[-1]),
                "member_id": s.member_ids[-1] if s.member_ids else None,
                "name": s.name,
                "avatar_url": avatars[key].at(first_ts[key]),
                "service": service,
                "oshi": s.name_norm in oshi,
                "person_key": day_person_key(service, s),
            }
        )
    return members, refs


async def _service_day(
    service: str, sdir: Path, day: date, summaries: list[mi.MemberSummary] | None
) -> tuple[list[dict], list[dict]]:
    """``(members, messages with texts)`` of one service on ``day``."""
    if summaries is None:
        summaries = await mi.list_members(sdir)
    tagged = await people.service_facts_on(sdir, summaries, day=day)
    posted = {people.person_key(t[0]): t[0] for t in tagged}
    oshi = await people.oshi_rooms(service, posted.values())
    avatars = await people.avatar_timelines_for(sdir, posted)
    members, refs = await asyncio.to_thread(
        _compose, service, sdir, tagged, oshi, avatars
    )
    await people.attach_texts(sdir, refs)
    return members, refs


def _merge(
    parts: list[tuple[list[dict], list[dict]]],
) -> tuple[list[dict], list[dict]]:
    """Members oshi first (stable) and messages by ``(ts, id, service, room)``. Pure."""
    members = [m for ms, _ in parts for m in ms]
    members.sort(key=lambda m: not m["oshi"])
    messages = [r for _, rs in parts for r in rs]
    messages.sort(key=lambda r: (r["ts"], r["id"], r["service"], r["room"]))
    return members, messages


async def day_view(
    service: str,
    sdir: Path,
    day: date,
    *,
    member: mi.MemberSummary | None,
    include_other_services: bool,
    now: datetime,
) -> dict:
    """The day view of ``day`` (see the module docstring)."""
    del now  # the date is explicit; kept for a uniform service signature
    parts = [
        await _service_day(service, sdir, day, [member] if member is not None else None)
    ]
    others = include_other_services and member is None
    other_services: list[str] = []
    if others:
        for other in service_utils.get_all_services():
            if other == service:
                continue
            try:
                other_dir = people.service_data_dir(other, sdir.parent)
                if not await asyncio.to_thread(other_dir.is_dir):
                    logger.info(
                        "memories_skip",
                        view=VIEW,
                        reason="service_dir_missing",
                        service=other,
                    )
                    continue
                part = await _service_day(other, other_dir, day, None)
            except Exception as e:  # another service never fails the request
                logger.warning(
                    "memories_skip",
                    view=VIEW,
                    reason="other_service_failed",
                    service=other,
                    error_type=type(e).__name__,
                )
                continue
            if part[1]:
                parts.append(part)
                other_services.append(other)
    members, messages = await asyncio.to_thread(_merge, parts)
    logger.info(
        "memories_day",
        members=len(members),
        count=len(messages),
        others=others,
        services=sum(1 for _, rs in parts if rs),
    )
    return {
        "date": day.isoformat(),
        "members": members,
        "messages": messages,
        "other_services": other_services,
    }


def _group_years(kept: list[_Tagged], refs: list[dict]) -> list[dict]:
    """One entry per year with messages, oldest first. Pure."""
    years: dict[int, dict] = {}
    for (_, _, fact), ref in zip(kept, refs, strict=True):
        ref["kind"] = message_kind(fact)
        entry = years.setdefault(
            fact.jst_date.year,
            {
                "year": fact.jst_date.year,
                "date": fact.jst_date.isoformat(),
                "messages": [],
            },
        )
        entry["messages"].append(ref)
    return [years[y] for y in sorted(years)]


async def day_years(
    service: str,
    sdir: Path,
    month_day: str,
    *,
    member: mi.MemberSummary | None,
    now: datetime,
) -> dict:
    """The same calendar day across every year (see the module docstring)."""
    today = now.astimezone(JST).date()
    summaries = [member] if member is not None else await mi.list_members(sdir)
    tagged = await people.service_facts_on(sdir, summaries, month_day=month_day)
    kept = [t for t in tagged if not t[2].is_welcome and t[2].jst_date <= today]
    welcome = sum(1 for t in tagged if t[2].is_welcome)
    posted = {people.person_key(t[0]): t[0] for t in kept}
    oshi = await people.oshi_rooms(service, posted.values())
    avatars = await people.avatar_timelines_for(sdir, posted)
    members, refs = await asyncio.to_thread(
        _compose, service, sdir, kept, oshi, avatars
    )
    await people.attach_texts(sdir, refs)
    years = await asyncio.to_thread(_group_years, kept, refs)
    logger.info(
        "memories_day_years",
        years=len(years),
        members=len(members),
        count=len(refs),
        welcome=welcome,
    )
    return {"month_day": month_day, "members": members, "years": years}


__all__ = ["day_person_key", "day_view", "day_years"]
