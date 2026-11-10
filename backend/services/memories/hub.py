"""The Memories hub board (spec 4): one moment, a few numbers, the next date.

:func:`build_hub` returns::

    {"on_this_day": {...} | None,
     "counts": {"album", "members", "favorites", "voices", "days"},
     "countdown": {...} | None,
     "same_time": {...} | None, "capsule": {...} | None,
     "gacha_left": int | None}

``on_this_day`` -- one moment of hers, chosen by the first rule that finds
one. ``rule`` tells the frontend which copy is true, so a ``week`` or
``first`` moment is never labelled "today":

- ``today``: the same JST month-day in past years (this year never counts).
  Pool = every fact on that month-day before this year; the pick is
  ``on_this_day.pick_year`` over the pool: oshi first, then the highest
  importance (ties: the earlier); a day with only photos shows its best
  photo as the message (the oshi's photos first).
- ``week``: when today has nothing, the facts within
  :data:`WEEK_DAYS` days of this month-day in a past year (Feb 29 is
  Feb 28 in a non-leap year), same pick. A date within the window of this
  year's month-day never counts, so the last days of December are not
  "near this date" on January 1.
- ``first``: when the week has nothing either, the first non-promo message
  of the first person in ``people.sort_people`` who has one. Because promo is
  skipped it may not be her very first message, so the UI labels it "from the
  early days" (「はじめのころの一通」), never "the first message".

The object is ``{"rule", "year", "years_ago", "date", "member_path",
"name", "message", "photo"}``: ``year`` is the past year whose month-day the
moment belongs to (for ``first``, the message's JST year), ``years_ago`` =
this year minus ``year`` (can be 0 only for ``first``), ``date`` the
message's real JST date (``YYYY-MM-DD``; for ``week`` it differs from
today's month-day, and around New Year its year can differ from ``year``),
``message`` the shared message object with her words and her avatar at
that time, ``photo`` her highest ``photo_score`` non-promo picture (a video
only without one) of the same person and JST date other than ``message``,
or ``None``. ``None`` only when the service has no non-promo message.

``counts`` -- ``album`` = pictures + videos (promo included, like the
album), ``members`` = people with at least one fact, ``favorites`` = ★
count, ``voices`` = voice messages (promo included, like the album count),
``days`` = JST dates with at least one message of anyone (``facts.aggregate``
per person, merged in a worker). The frontend shows only the numbers it
needs.

``countdown`` -- the soonest upcoming date (today counts, ``days_left: 0``;
the frontend shows "today" copy, never "0") among non-graduated people's
birthdays (``kind=birthday``, ``years=None``) and the fan's next
subscription anniversary with her (``kind=anniversary``, ``years`` = k >= 1,
``cards.anniversary_date``), left out when her subscription has ended
(``sync_metadata.json`` ``server_groups`` reports ``is_active: false`` for
all her open groups; see ``_lapsed_groups``). The anniversary is the fan's own date: the
payload says nothing about her knowing it. Ties go to the oshi, then the
birthday, then the ``sort_people`` order. ``None`` when no listed person
has a birthday or a start date. ``{"kind", "member_path", "name", "date",
"days_left", "years"}``.

The numeric part (``counts``, ``countdown``) is cached text-free (view
``hub``, key ``all``, hash over :data:`VERSION`, every person's room
hashes, today's JST date, the oshi set and the lapsed groups; birthdays, start dates and
graduation are in the room hashes). ``on_this_day`` is chosen and its text
attached after the cache read (the On This Day facts it reads are cached
by the memory index).

``same_time`` -- 同じ時刻 (spec 14.3), ``same_time.same_time`` for now:
her message at this JST time of day on an earlier date, or ``None``.

``capsule`` -- 時光膠囊 (spec 14.4): the first of
``capsule.resurfacing(month_day=today)`` (``capsule.HUB_LIMIT`` = 1), the
fan's own note with her message of the anchor day, or ``None``.

``gacha_left`` -- ``gacha.MAX_PULLS`` minus today's recorded pulls (JST day),
never below 0. It may be 0: the frontend shows 「また明日」, never the number.

``same_time``, ``capsule`` and ``gacha_left`` are read after the cache read
and never cached (the note and the line carry text; the pulls change during
the day). A ``sqlite3.Error`` from the fan's store makes ``capsule`` /
``gacha_left`` ``None`` (``memories_skip``, ``view=hub``,
``reason=store_unavailable``) instead of failing the board.

Logs (ids, codes, counts and scores only): ``memories_select``
(``view=hub_otd``, ``rule=today|week|first|photo``, ``score``,
``fallback`` = ``None`` / ``week`` / ``first``, ``message_id``),
``memories_skip`` (``view=hub_otd``, ``reason=no_today|no_week|no_first|
no_photo``), ``memories_select`` (``view=hub_countdown``, ``rule`` = the
kind, ``score`` = days left, ``person``) or ``memories_skip``
(``view=hub_countdown``, ``reason=no_dates``; ``reason=bad_birthday`` per
unparsable birthday; ``reason=subscription_ended`` per dropped anniversary;
``reason=sync_metadata_unreadable``) when the numbers are built, and ``memories_hub``
(``rule``, ``album``, ``members``, ``favorites``, ``voices``, ``days``,
``countdown``, ``same_time`` / ``capsule`` (bools), ``gacha_left``) per call.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
from collections.abc import Sequence
from datetime import date, datetime, timedelta
from pathlib import Path

import structlog

from backend.services.memories import binder, capsule, people, same_time, user_store
from backend.services.memories import index as mi
from backend.services.memories.cards import anniversary_date, parse_birthday
from backend.services.memories.gacha import MAX_PULLS
from backend.services.memories.facts import (
    Fact,
    aggregate,
    get_facts_on,
    get_person_facts,
)
from backend.services.memories.on_this_day import pick_year
from backend.services.memories.selection import JST
from backend.services.memories.view_cache import cached_view, view_hash

logger = structlog.get_logger(__name__)

VIEW = "hub"
VIEW_OTD = "hub_otd"
VIEW_COUNTDOWN = "hub_countdown"
# Bump on any rule or payload change of the cached part (the hash has it).
VERSION = 3
SYNC_METADATA = "sync_metadata.json"
WEEK_DAYS = 3
# A leap and a non-leap reference year: the week's month-days of both.
_REF_YEARS = (2023, 2024)

_Tagged = tuple[mi.MemberSummary, str, Fact]
# (person, room, fact, the past year whose month-day it belongs to)
_Pick = tuple[mi.MemberSummary, str, Fact, int]


def _on_year(year: int, month: int, day: int) -> date:
    """``month``-``day`` in ``year``; Feb 29 is Feb 28 in a non-leap year."""
    return anniversary_date(date(2000, month, day), year - 2000)


# --- numbers -------------------------------------------------------------------------


def _counts(tagged: Sequence[Sequence[tuple[str, Fact]]]) -> dict:
    """``{"album", "members", "favorites", "voices", "days"}``. Pure; in a worker."""
    album = members = favorites = voices = 0
    days: set[date] = set()
    for person_facts in tagged:
        agg = aggregate(f for _, f in person_facts)
        album += agg.counts.get("picture", 0) + agg.counts.get("video", 0)
        members += agg.total > 0
        favorites += agg.favorites
        voices += agg.voice_count
        days.update(f.jst_date for _, f in person_facts)
    return {
        "album": album,
        "members": members,
        "favorites": favorites,
        "voices": voices,
        "days": len(days),
    }


def _next_birthday(raw: str | None, today: date) -> date | None:
    md = parse_birthday(raw)
    if md is None:
        return None
    day = _on_year(today.year, *md)
    return day if day >= today else _on_year(today.year + 1, *md)


def _next_anniversary(start: date | None, today: date) -> tuple[date, int] | None:
    if start is None:
        return None
    k = max(1, today.year - start.year)
    while anniversary_date(start, k) < today:
        k += 1
    return anniversary_date(start, k), k


def _lapsed_groups(sdir: Path) -> frozenset[str]:
    """Open groups whose subscription the server reports as no longer active. Blocking.

    ``sync_metadata.json`` ``server_groups[gid].is_active`` is written by every
    sync from the group's subscription state (``active`` / ``cancelled`` =
    still readable); the chat uses the same flag to mark rooms the fan can no
    longer read. A group without an entry counts as active, like the chat. A
    missing file gives nothing; an unreadable one is logged and gives nothing.
    """
    try:
        meta = json.loads((sdir / SYNC_METADATA).read_text(encoding="utf-8"))
        groups = meta.get("server_groups") or {}
        return frozenset(
            str(gid)
            for gid, entry in groups.items()
            if isinstance(entry, dict)
            and entry.get("state") != "closed"
            and entry.get("is_active") is False
        )
    except FileNotFoundError:
        return frozenset()
    except (OSError, ValueError, AttributeError, TypeError) as e:
        logger.warning(
            "memories_skip",
            view=VIEW_COUNTDOWN,
            reason="sync_metadata_unreadable",
            error_type=type(e).__name__,
        )
        return frozenset()


def _subscribed(summary: mi.MemberSummary, lapsed: frozenset[str]) -> bool:
    """False when every one of her rooms' groups has a lapsed subscription."""
    return not summary.group_ids or any(g not in lapsed for g in summary.group_ids)


def _countdown(
    sdir: Path,
    ordered: Sequence[mi.MemberSummary],
    oshi: set[str],
    today: date,
    lapsed: frozenset[str],
) -> dict | None:
    """The soonest birthday / anniversary of a non-graduated person, or ``None``.

    The anniversary is left out for a person whose subscription has ended
    (``lapsed`` covers all her groups); her birthday stays.
    """
    events: list[tuple[tuple[int, bool, int, int], dict, mi.MemberSummary]] = []
    for rank, s in enumerate(ordered):
        if s.graduated:
            continue
        found: list[tuple[int, str, date, int | None]] = []
        birthday = _next_birthday(s.birthday, today)
        if birthday is not None:
            found.append((0, "birthday", birthday, None))
        elif s.birthday:
            logger.info(
                "memories_skip",
                view=VIEW_COUNTDOWN,
                reason="bad_birthday",
                person=people.member_id(s),
            )
        anniversary = _next_anniversary(binder.subscription_start(s), today)
        if anniversary is not None and not _subscribed(s, lapsed):
            logger.info(
                "memories_skip",
                view=VIEW_COUNTDOWN,
                reason="subscription_ended",
                person=people.member_id(s),
            )
        elif anniversary is not None:
            found.append((1, "anniversary", *anniversary))
        for kind_rank, kind, day, years in found:
            left = (day - today).days
            key = (left, s.name_norm not in oshi, kind_rank, rank)
            row = {
                "kind": kind,
                "member_path": people.chat_path(sdir, s.member_dirs[-1]),
                "name": s.name,
                "date": day.isoformat(),
                "days_left": left,
                "years": years,
            }
            events.append((key, row, s))
    if not events:
        logger.info("memories_skip", view=VIEW_COUNTDOWN, reason="no_dates")
        return None
    _, row, s = min(events, key=lambda e: e[0])
    logger.info(
        "memories_select",
        view=VIEW_COUNTDOWN,
        rule=row["kind"],
        score=row["days_left"],
        fallback=None,
        message_id=None,
        person=people.member_id(s),
    )
    return row


# --- on this day -----------------------------------------------------------------------


def _best(pool: Sequence[_Tagged], oshi: set[str]) -> _Tagged | None:
    """Her best words of the pool (oshi first), else its best photo (oshi first). Pure."""
    preview, thumb = pick_year(pool, oshi)
    if preview:
        return preview[0]
    _, oshi_thumb = pick_year([t for t in pool if t[0].name_norm in oshi], oshi)
    return oshi_thumb or thumb


def _score(fact: Fact) -> int | None:
    return fact.importance if fact.importance is not None else fact.photo_score


def _pick_today(tagged: Sequence[_Tagged], oshi: set[str], today: date) -> _Pick | None:
    """Rule ``today``: the month-day's facts of past years. Pure; in a worker."""
    pick = _best([t for t in tagged if t[2].jst_date.year < today.year], oshi)
    return (*pick, pick[2].jst_date.year) if pick is not None else None


def _week_month_days(today: date) -> list[str]:
    """``MM-DD`` within :data:`WEEK_DAYS` of today's month-day, today's excluded."""
    own = today.strftime("%m-%d")
    out: set[str] = set()
    for ref in _REF_YEARS:
        centre = _on_year(ref, today.month, today.day)
        for k in range(-WEEK_DAYS, WEEK_DAYS + 1):
            out.add((centre + timedelta(days=k)).strftime("%m-%d"))
    out.discard(own)
    return sorted(out)


def _week_year(fact: Fact, today: date) -> int | None:
    """The past year whose month-day window holds ``fact``, or ``None``."""
    for year in (fact.jst_date.year - 1, fact.jst_date.year, fact.jst_date.year + 1):
        centre = _on_year(year, today.month, today.day)
        if year < today.year and abs((fact.jst_date - centre).days) <= WEEK_DAYS:
            return year
    return None


def _pick_week(tagged: Sequence[_Tagged], oshi: set[str], today: date) -> _Pick | None:
    """Rule ``week``: facts near this month-day in past years. Pure; in a worker."""
    years: dict[tuple[str, str, int], int] = {}
    pool: list[_Tagged] = []
    for t in tagged:
        year = _week_year(t[2], today)
        if year is not None:
            years[(people.person_key(t[0]), t[1], t[2].id)] = year
            pool.append(t)
    pick = _best(pool, oshi)
    if pick is None:
        return None
    return (*pick, years[(people.person_key(pick[0]), pick[1], pick[2].id)])


def _first_words(tagged: Sequence[tuple[str, Fact]]) -> tuple[str, Fact] | None:
    return next(((room, f) for room, f in tagged if not f.is_promo), None)


async def _pick_first(sdir: Path, ordered: Sequence[mi.MemberSummary]) -> _Pick | None:
    """Rule ``first``: the first non-promo message of the first person with one."""
    for s in ordered:
        tagged = await get_person_facts(sdir, s)
        first = await asyncio.to_thread(_first_words, tagged)
        if first is not None:
            room, fact = first
            return s, room, fact, fact.jst_date.year
    return None


async def _photo_of_day(
    sdir: Path, person: mi.MemberSummary, fact: Fact, oshi: set[str]
) -> _Tagged | None:
    """Her best photo on the fact's JST date, other than the fact itself."""
    pool: list[_Tagged] = []
    for room in person.member_dirs:
        day = await get_facts_on(sdir, sdir / room, day=fact.jst_date)
        pool.extend((person, room, f) for f in day if f.id != fact.id)
    _, thumb = await asyncio.to_thread(pick_year, pool, oshi)
    return thumb


async def _choose(
    sdir: Path,
    summaries: Sequence[mi.MemberSummary],
    ordered: Sequence[mi.MemberSummary],
    oshi: set[str],
    today: date,
) -> tuple[str, _Pick] | None:
    """``(rule, pick)`` of the first rule that finds a moment, or ``None``."""
    month_day = today.strftime("%m-%d")
    tagged = await people.service_facts_on(sdir, summaries, month_day=month_day)
    pick = await asyncio.to_thread(_pick_today, tagged, oshi, today)
    if pick is not None:
        return "today", pick
    logger.info("memories_skip", view=VIEW_OTD, reason="no_today")
    near: list[_Tagged] = []
    for md in _week_month_days(today):
        near.extend(await people.service_facts_on(sdir, summaries, month_day=md))
    pick = await asyncio.to_thread(_pick_week, near, oshi, today)
    if pick is not None:
        return "week", pick
    logger.info("memories_skip", view=VIEW_OTD, reason="no_week")
    pick = await _pick_first(sdir, ordered)
    if pick is not None:
        return "first", pick
    logger.info("memories_skip", view=VIEW_OTD, reason="no_first")
    return None


async def _on_this_day(
    service: str,
    sdir: Path,
    summaries: Sequence[mi.MemberSummary],
    ordered: Sequence[mi.MemberSummary],
    oshi: set[str],
    today: date,
) -> dict | None:
    """The hub's moment with her words attached; see the module docstring."""
    chosen = await _choose(sdir, summaries, ordered, oshi, today)
    if chosen is None:
        return None
    rule, (person, room, fact, year) = chosen
    logger.info(
        "memories_select",
        view=VIEW_OTD,
        rule=rule,
        score=_score(fact),
        fallback=None if rule == "today" else rule,
        message_id=fact.id,
    )
    avatar = await people.avatar_timelines(sdir, person)
    message = people.message_ref(service, sdir, room, fact, avatar=avatar)
    refs = [message]
    photo_pick = await _photo_of_day(sdir, person, fact, oshi)
    photo: dict | None = None
    if photo_pick is None:
        logger.info("memories_skip", view=VIEW_OTD, reason="no_photo")
    else:
        logger.info(
            "memories_select",
            view=VIEW_OTD,
            rule="photo",
            score=photo_pick[2].photo_score,
            fallback=None,
            message_id=photo_pick[2].id,
        )
        photo = people.message_ref(
            service, sdir, photo_pick[1], photo_pick[2], avatar=avatar
        )
        refs.append(photo)
    await people.attach_texts(sdir, refs)
    return {
        "rule": rule,
        "year": year,
        "years_ago": today.year - year,
        "date": fact.jst_date.isoformat(),
        "member_path": people.chat_path(sdir, room),
        "name": person.name,
        "message": message,
        "photo": photo,
    }


# --- hub --------------------------------------------------------------------------------


async def _capsule_note(
    service: str, sdir: Path, today: date, now: datetime
) -> dict | None:
    """The hub's resurfacing note, or ``None`` (none due, or the store failed)."""
    try:
        due = await capsule.resurfacing(
            service, sdir, month_day=today.strftime("%m-%d"), now=now
        )
    except sqlite3.Error as e:
        logger.warning(
            "memories_skip",
            view=VIEW,
            reason="store_unavailable",
            part="capsule",
            error_type=type(e).__name__,
        )
        return None
    notes = due["notes"][: capsule.HUB_LIMIT]
    return notes[0] if notes else None


async def _gacha_left(service: str, today: date) -> int | None:
    """Pulls left today, or ``None`` when the store failed."""
    try:
        pulls = await user_store.agacha_pulls_on(service, today)
    except sqlite3.Error as e:
        logger.warning(
            "memories_skip",
            view=VIEW,
            reason="store_unavailable",
            part="gacha",
            error_type=type(e).__name__,
        )
        return None
    return max(0, MAX_PULLS - len(pulls))


async def build_hub(service: str, sdir: Path, *, now: datetime) -> dict:
    """The hub board for ``sdir``'s service; see the module docstring."""
    today = now.astimezone(JST).date()
    summaries = await mi.list_members(sdir)
    oshi = await people.oshi_rooms(service, summaries)
    ordered = people.sort_people(summaries, oshi)
    hashes = [await people.room_hashes(sdir, s) for s in summaries]
    lapsed = await asyncio.to_thread(_lapsed_groups, sdir)
    data_hash = view_hash(
        VERSION, hashes, today.isoformat(), sorted(oshi), sorted(lapsed)
    )

    async def build() -> dict:
        tagged = [await get_person_facts(sdir, s) for s in summaries]
        counts = await asyncio.to_thread(_counts, tagged)
        countdown = await asyncio.to_thread(
            _countdown, sdir, ordered, oshi, today, lapsed
        )
        return {"counts": counts, "countdown": countdown}

    numbers = await cached_view(sdir, VIEW, "all", data_hash, build)
    # Everything below is read after the cache and never cached.
    moment = await _on_this_day(service, sdir, summaries, ordered, oshi, today)
    line = await same_time.same_time(service, sdir, now=now)
    note = await _capsule_note(service, sdir, today, now)
    gacha_left = await _gacha_left(service, today)
    countdown = numbers["countdown"]
    counts = numbers["counts"]
    logger.info(
        "memories_hub",
        rule=moment["rule"] if moment is not None else None,
        album=counts["album"],
        members=counts["members"],
        favorites=counts["favorites"],
        voices=counts["voices"],
        days=counts["days"],
        countdown=countdown["kind"] if countdown is not None else None,
        same_time=line is not None,
        capsule=note is not None,
        gacha_left=gacha_left,
    )
    return {
        "on_this_day": moment,
        "counts": counts,
        "countdown": countdown,
        "same_time": line,
        "capsule": note,
        "gacha_left": gacha_left,
    }


__all__ = ["VERSION", "WEEK_DAYS", "build_hub"]
