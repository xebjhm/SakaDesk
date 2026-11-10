"""On This Day (spec 6): one calendar date across every year of the service.

:func:`on_this_day` returns ``{"month_day", "years": [...]}``:

- ``years`` runs oldest first from the first JST year whose ``month_day``
  is on or after the service's first message date (the earliest
  ``first_ts`` of every room's member index, as a JST date), so no empty year
  appears before the archive starts, to the latest year in which
  ``month_day`` is on or before today (JST). This year's date is listed only
  when it has messages. ``02-29`` is compared as ``(2, 29)``, and non-leap
  years are left out entirely: that date did not exist in them, so listing
  them as "no messages" would be false (one ``memories_skip``,
  ``reason=not_leap_year``, ``count`` = the years left out). Without any message, or when
  the range is empty, ``years`` is ``[]`` (``memories_skip``,
  ``reason=no_messages|before_first_year``) and nothing is cached.
- A year without messages on that date is ``{"year", "has_messages": False}``
  and nothing else: the UI dims it and never shows "0" (spec 1.1).
- A year with messages has:

  - ``message_count``: every fact of that date-year (promo included), the
    moment's one number; ``member_count``: the people who posted;
  - ``preview``: up to :data:`PREVIEW_CAP` message objects, one per person:
    her highest-importance non-promo words (ties: the earlier); the people
    are ordered oshi first, then by that importance (ties: the earlier
    message). Each carries her avatar at its time and ``name``, her display
    name (``MemberSummary.name``, the folder name of her newest room);
  - ``more`` = ``message_count - len(preview)``, or ``None`` when that is 0
    (the payload never carries a renderable zero);
  - ``thumb``: the highest ``photo_score`` picture of that date-year (ties:
    the earlier); a video only when the date-year has no scored picture;
    text-free, or ``None``.

The text-free part is cached (view ``on_this_day``, key ``month_day`` so a
new day replaces the row instead of adding one; hash over :data:`VERSION`,
the last year, whether it is this year, the oshi set and every room's
member-index ``data_hash``, so it also hits across days). Preview texts
are attached after the cache read with one ``load_texts`` per room for the
preview ids only.

Logs (ids, codes, counts and scores only): ``memories_select``
(``view=on_this_day``, ``rule=preview|thumb``, ``score``, ``fallback=None``,
``message_id``, ``year``) and ``memories_skip`` (``reason=no_preview|no_thumb``,
``year``; ``reason=not_leap_year``, ``count``) when the payload is built, the
early-return skip above, and
``memories_on_this_day`` (``years``, ``with_messages``, ``count``) on every
call.
"""

from __future__ import annotations

import asyncio
import calendar
import re
from collections.abc import Sequence
from datetime import date, datetime
from pathlib import Path

import structlog

from backend.services.archive_urls import parse_iso
from backend.services.memories import index as mi
from backend.services.memories import people
from backend.services.memories.facts import Fact
from backend.services.memories.selection import JST
from backend.services.memories.view_cache import cached_view, view_hash

logger = structlog.get_logger(__name__)

VIEW = "on_this_day"
# Bump on any rule or payload change (the cache hash has it).
VERSION = 4
PREVIEW_CAP = 3
MONTH_DAY_RE = re.compile(r"^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$")

_Tagged = tuple[mi.MemberSummary, str, Fact]


def parse_month_day(month_day: str) -> tuple[int, int]:
    """``(month, day)`` of an ``MM-DD`` string; ``ValueError`` when invalid.

    ``02-29`` is valid (checked against a leap year); ``02-30`` is not.
    """
    if not MONTH_DAY_RE.match(month_day):
        raise ValueError("month_day must be MM-DD")
    month, day = int(month_day[:2]), int(month_day[3:])
    date(2000, month, day)  # raises ValueError for 02-30, 04-31, ...
    return month, day


def month_day_of(now: datetime) -> str:
    """Today's ``MM-DD`` in JST."""
    return now.astimezone(JST).strftime("%m-%d")


def _first_date(indexes: Sequence[mi.MemberIndex]) -> date | None:
    """JST date of the service's earliest message, or ``None`` without messages."""
    stamps = [
        ts
        for idx in indexes
        for raw in idx.first_ts.values()
        if (ts := parse_iso(raw)) is not None
    ]
    return min(stamps).astimezone(JST).date() if stamps else None


def _words_key(t: _Tagged) -> tuple[int, datetime, int]:
    f = t[2]
    return (-(f.importance or 0), f.ts, f.id)


def pick_year(
    facts: Sequence[_Tagged], oshi: set[str]
) -> tuple[list[_Tagged], _Tagged | None]:
    """``(preview picks in display order, thumb)`` of one date-year. Pure.

    Preview: one pick per person, her highest-importance non-promo words
    (ties: the earlier), people ordered oshi first, then by that importance;
    at most :data:`PREVIEW_CAP`. Thumb: the highest ``photo_score`` non-promo
    picture (a video only without one; ties: the earlier), or ``None``. The
    hub reuses it over any fact pool.
    """
    best: dict[str, _Tagged] = {}
    for t in sorted(
        (t for t in facts if not t[2].is_promo and t[2].importance is not None),
        key=_words_key,
    ):
        best.setdefault(people.person_key(t[0]), t)
    ranked = sorted(
        best.values(), key=lambda t: (t[0].name_norm not in oshi, *_words_key(t))
    )
    photos = [
        t
        for t in facts
        if t[2].type in people.MEDIA_TYPES
        and not t[2].is_promo
        and t[2].photo_score is not None
    ]
    thumb = min(
        photos,
        key=lambda t: (
            t[2].type != "picture",  # a video only without a picture
            -(t[2].photo_score or 0),
            t[2].ts,
            t[2].id,
        ),
        default=None,
    )
    return ranked[:PREVIEW_CAP], thumb


def _group_years(
    tagged: Sequence[_Tagged], first: int, last: int
) -> dict[int, list[_Tagged]]:
    out: dict[int, list[_Tagged]] = {}
    for t in tagged:
        year = t[2].jst_date.year
        if first <= year <= last:
            out.setdefault(year, []).append(t)
    return out


def _compose(
    service: str,
    sdir: Path,
    tagged: Sequence[_Tagged],
    oshi: set[str],
    avatars: dict[str, people.AvatarTimeline],
    first: int,
    last: int,
    last_is_current: bool,
    leap_day: bool = False,
) -> list[dict]:
    """The text-free ``years`` list. Blocking (runs in a worker).

    ``leap_day``: the date is ``02-29``, so non-leap years are left out.
    """
    by_year = _group_years(tagged, first, last)

    def ref(t: _Tagged) -> dict:
        avatar = avatars.get(people.person_key(t[0]))
        return people.message_ref(service, sdir, t[1], t[2], avatar=avatar)

    years: list[dict] = []
    span = list(range(first, last + 1))
    if leap_day:
        missing = [y for y in span if not calendar.isleap(y)]
        if missing:
            logger.info(
                "memories_skip", view=VIEW, reason="not_leap_year", count=len(missing)
            )
        span = [y for y in span if calendar.isleap(y)]
    for year in span:
        facts = by_year.get(year)
        if not facts:
            if year == last and last_is_current:
                logger.info(
                    "memories_skip", view=VIEW, reason="current_year_empty", year=year
                )
            else:
                years.append({"year": year, "has_messages": False})
            continue
        preview, thumb = pick_year(facts, oshi)
        for t in preview:
            logger.info(
                "memories_select",
                view=VIEW,
                rule="preview",
                score=t[2].importance,
                fallback=None,
                message_id=t[2].id,
                year=year,
            )
        if not preview:
            logger.info("memories_skip", view=VIEW, reason="no_preview", year=year)
        if thumb is None:
            logger.info("memories_skip", view=VIEW, reason="no_thumb", year=year)
        else:
            logger.info(
                "memories_select",
                view=VIEW,
                rule="thumb",
                score=thumb[2].photo_score,
                fallback=None,
                message_id=thumb[2].id,
                year=year,
            )
        years.append(
            {
                "year": year,
                "has_messages": True,
                "message_count": len(facts),
                "member_count": len({people.person_key(t[0]) for t in facts}),
                "preview": [{**ref(t), "name": t[0].name} for t in preview],
                "more": (len(facts) - len(preview)) or None,
                "thumb": ref(thumb) if thumb is not None else None,
            }
        )
    return years


def _empty(month_day: str, reason: str) -> dict:
    """The empty payload of an early return, with its breadcrumb."""
    logger.info("memories_skip", view=VIEW, reason=reason)
    logger.info("memories_on_this_day", years=0, with_messages=0, count=0)
    return {"month_day": month_day, "years": []}


async def on_this_day(
    service: str, sdir: Path, month_day: str, *, now: datetime
) -> dict:
    """On This Day for ``month_day`` (``MM-DD``); see the module docstring.

    ``ValueError`` for a malformed or impossible ``month_day``.
    """
    month, day = parse_month_day(month_day)
    today = now.astimezone(JST).date()
    last = today.year if (month, day) <= (today.month, today.day) else today.year - 1
    summaries = await mi.list_members(sdir)
    oshi = await people.oshi_rooms(service, summaries)
    indexes = [
        await mi.get_member_index(sdir, sdir / room)
        for s in summaries
        for room in s.member_dirs
    ]
    first_date = _first_date(indexes)
    if first_date is None:
        return _empty(month_day, "no_messages")
    first = first_date.year + ((month, day) < (first_date.month, first_date.day))
    if first > last:
        return _empty(month_day, "before_first_year")
    last_is_current = last == today.year
    data_hash = view_hash(
        VERSION,
        last,
        last_is_current,
        sorted(oshi),
        [(idx.member_dir, idx.data_hash) for idx in indexes],
    )

    async def build() -> dict:
        tagged = await people.service_facts_on(sdir, summaries, month_day=month_day)
        posted = {people.person_key(t[0]): t[0] for t in tagged}
        avatars = await people.avatar_timelines_for(sdir, posted)
        years = await asyncio.to_thread(
            _compose,
            service,
            sdir,
            tagged,
            oshi,
            avatars,
            first,
            last,
            last_is_current,
            (month, day) == (2, 29),
        )
        return {"month_day": month_day, "years": years}

    payload = await cached_view(sdir, VIEW, month_day, data_hash, build)
    previews = [r for y in payload["years"] for r in y.get("preview", [])]
    await people.attach_texts(sdir, previews)
    with_messages = [y for y in payload["years"] if y["has_messages"]]
    logger.info(
        "memories_on_this_day",
        years=len(payload["years"]),
        with_messages=len(with_messages),
        count=sum(y["message_count"] for y in with_messages),
    )
    return payload


__all__ = [
    "MONTH_DAY_RE",
    "PREVIEW_CAP",
    "month_day_of",
    "on_this_day",
    "parse_month_day",
    "pick_year",
]
