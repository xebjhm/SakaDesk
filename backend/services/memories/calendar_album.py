"""The calendar album: one cell per JST day, with the day's best photo (spec 13).

Every function answers for one person (``member``) or, with ``member=None``,
for every person of the service (全員). Days and months are JST
(``Fact.jst_date``).

- :func:`calendar_months` -- ``{"months": ["2023-07", ...]}``: the JST months
  with at least one fact (any message type), oldest first; the month picker
  dims the others. Cached text-free (view ``calendar_months``, key = scope,
  hash over the room hashes).
- :func:`calendar_month` -- ``{"month", "days": [{"date", "members",
  "photo", "photo_rule"}]}`` for days with at least one fact, in date order
  (the UI greys the rest). A month outside the scope's range gives
  ``days: []``; a malformed ``month`` is ``ValueError``.

  - ``members`` = how many people posted that day (the UI draws capped dots
    and never prints the number).
  - ``photo`` = ``album.choose_cover`` (no override) over the day's non-promo
    pictures; the day's non-promo videos stand in only when it has none
    (spec 3.3 best-photo rule, the same as the album). Promo is never the
    cell photo, so a day with only promo media (or none) has ``photo`` and
    ``photo_rule`` ``None``. ``photo_rule`` is ``favorite``, ``score``,
    ``burst`` or ``first``. Screenshot-likeness comes from
    ``album_colors.probes`` for the top 3 candidates of every rule list of
    each day (``album.consulted_probes``).
  - ``photo`` is the shared message object with ``avatar_url``, ``text`` and
    ``caption`` ``None`` (a cell needs none), so the whole month is cached
    (view ``calendar_month``, key ``<scope>:<month>``, hash over room
    hashes, ``people.media_dir_mtimes``, ``album_colors.COLORS_VERSION`` and
    the oshi rooms, so pictures that arrive late update the cells).

``scope`` is ``people.person_key`` or ``"all"``; it is never logged.

Logs (ids, codes, counts and scores only): ``memories_calendar`` per call
(``view=months`` with ``months``; ``view=month`` with ``month``,
``month_days`` and ``with_photo``); on a cache miss, ``memories_select``
(``view=calendar_cell``, ``rule``, ``score``, ``message_id``, ``fallback``)
per day with a photo and one ``memories_skip`` (``view=calendar_cell``,
``reason=no_photo``, ``count``) for the days without one, at debug level
(up to 31 per call).
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from datetime import datetime
from pathlib import Path

import structlog

from backend.services.memories import album, album_colors, people
from backend.services.memories import index as mi
from backend.services.memories.facts import Fact
from backend.services.memories.timeline import MONTH_RE, month_of
from backend.services.memories.view_cache import cached_view, view_hash

logger = structlog.get_logger(__name__)

VIEW_MONTHS = "calendar_months"
VIEW_MONTH = "calendar_month"
VIEW_CELL = "calendar_cell"
# Bump on any rule or payload change (the calendar cache hashes have it).
CALENDAR_VERSION = 1

_Tagged = tuple[str, Fact]
_Pick = tuple[_Tagged, str]


def _months_of(tagged: Sequence[_Tagged]) -> list[str]:
    """The sorted JST months of ``tagged``. Pure; runs in a worker."""
    return sorted({month_of(f.jst_date) for _, f in tagged})


async def calendar_months(
    service: str, sdir: Path, *, member: mi.MemberSummary | None
) -> dict:
    """The JST months with at least one fact, oldest first (see the module docstring)."""
    del service  # the months are the same in every service view of ``sdir``
    persons, scope, hashes = await people.album_scope(sdir, member)
    data_hash = view_hash(CALENDAR_VERSION, hashes)

    async def build() -> dict:
        tagged = await people.scope_facts(sdir, persons)
        return {"months": await asyncio.to_thread(_months_of, tagged)}

    payload = await cached_view(sdir, VIEW_MONTHS, scope, data_hash, build)
    logger.info("memories_calendar", view="months", months=len(payload["months"]))
    return payload


def _bucket(
    tagged: Sequence[_Tagged], month: str, owners: dict[str, str]
) -> tuple[dict[str, int], dict[str, list[_Tagged]]]:
    """``(date -> people who posted, date -> photo candidates)`` of ``month``.

    Candidates are the day's non-promo pictures, or its non-promo videos when
    it has no such picture. Pure; runs in a worker.
    """
    posters: dict[str, set[str]] = {}
    pictures: dict[str, list[_Tagged]] = {}
    videos: dict[str, list[_Tagged]] = {}
    for room, f in tagged:
        if month_of(f.jst_date) != month:
            continue
        day = f.jst_date.isoformat()
        posters.setdefault(day, set()).add(owners[room])
        if f.is_promo or not album.keep(f, "all"):
            continue
        target = pictures if f.type == "picture" else videos
        target.setdefault(day, []).append((room, f))
    cands = {day: pictures.get(day) or videos.get(day, []) for day in posters}
    return {d: len(p) for d, p in posters.items()}, cands


def _choose(
    cands: dict[str, list[_Tagged]],
    oshi_rooms: set[str],
    screenshot_like: album.ScreenshotLike,
) -> dict[str, _Pick]:
    """``date -> (photo, rule)`` for days with candidates. Pure."""
    out: dict[str, _Pick] = {}
    for day, items in cands.items():
        pick = album.choose_cover(
            items, override=None, oshi_rooms=oshi_rooms, screenshot_like=screenshot_like
        )
        if pick is not None:
            out[day] = pick
    return out


def _month_payload(
    service: str,
    sdir: Path,
    month: str,
    members: dict[str, int],
    chosen: dict[str, _Pick],
    screenshot_like: album.ScreenshotLike,
) -> dict:
    """The text-free month payload, in date order. Blocking (runs in a worker)."""
    days = []
    for day in sorted(members):
        pick = chosen.get(day)
        photo = None
        rule = None
        if pick is not None:
            (room, f), rule = pick
            photo = people.message_ref(service, sdir, room, f)
            logger.debug(
                "memories_select",
                view=VIEW_CELL,
                rule=rule,
                score=f.photo_score,
                fallback=rule in ("burst", "first")
                or f.type == "video"
                or screenshot_like(room, f),
                message_id=f.id,
            )
        days.append(
            {"date": day, "members": members[day], "photo": photo, "photo_rule": rule}
        )
    without = len(members) - len(chosen)
    if without:
        logger.debug("memories_skip", view=VIEW_CELL, reason="no_photo", count=without)
    return {"month": month, "days": days}


async def calendar_month(
    service: str,
    sdir: Path,
    month: str,
    *,
    member: mi.MemberSummary | None,
    now: datetime,
) -> dict:
    """One calendar month's day cells (see the module docstring).

    ``now`` is accepted like the other day-based views; the cells do not
    depend on it (a past or future month is browsable).
    """
    del now
    if not MONTH_RE.match(month):
        raise ValueError("month must be YYYY-MM")
    persons, scope, hashes = await people.album_scope(sdir, member)
    oshi_names = await people.oshi_rooms(service, persons)
    oshi_rooms = {
        r for s in persons if s.name_norm in oshi_names for r in s.member_dirs
    }
    data_hash = view_hash(
        CALENDAR_VERSION,
        hashes,
        await people.media_dir_mtimes(sdir, persons),
        album_colors.COLORS_VERSION,
        sorted(oshi_rooms),
    )

    async def build() -> dict:
        tagged = await people.scope_facts(sdir, persons)
        owners = {r: people.person_key(s) for s in persons for r in s.member_dirs}
        members, cands = await asyncio.to_thread(_bucket, tagged, month, owners)
        found = await album.consulted_probes(sdir, cands, {}, oshi_rooms)
        shot = album.screenshot_fn(found)
        chosen = await asyncio.to_thread(_choose, cands, oshi_rooms, shot)
        return await asyncio.to_thread(
            _month_payload, service, sdir, month, members, chosen, shot
        )

    payload = await cached_view(sdir, VIEW_MONTH, f"{scope}:{month}", data_hash, build)
    logger.info(
        "memories_calendar",
        view="month",
        month=month,
        month_days=len(payload["days"]),
        with_photo=sum(1 for d in payload["days"] if d["photo"] is not None),
    )
    return payload


__all__ = ["calendar_month", "calendar_months"]
