"""あの日と今日, then and now (spec 14.2).

Shared with the recap's S08 slide (one copy of each rule):

- :func:`keywords_in` -- the ``lexicon.ECHO_KEYWORDS`` in a text (NFKC);
- :func:`first_week_window` -- the first week from a start date;
- :func:`latest_week_window` -- the 7 JST days ending on a date.

**Day mode** -- :func:`then_now_day` returns::

    {"mode": "day",
     "then": {"year", "date", "member_path", "name", "avatar_url", "items"},
     "now":  {...same keys...},
     "shared_keyword": "誕生日" | None}

or ``None`` (the toggle is hidden).

- ``then`` is the asked JST ``day``; ``None`` when nobody has an eligible
  message that day.
- ``now`` and the person: ``member`` when given (one person). Otherwise the
  most recent later year (not after today) whose same month-day has messages
  from someone who also posted on ``day``; among those people, oshi first,
  then the higher importance sum over both dates, then the
  ``index.list_members`` order. Only when no such year exists, ``now`` is the
  latest later year with messages and each side gets its own best person
  (oshi first, then that date's importance sum), so each side carries its own
  ``name`` and ``member_path`` and every label is literally true. ``None``
  without a later year. ``now_rule`` is ``this_year`` when ``now`` is this
  JST year's month-day, else ``latest_year``.
- Items per side (at most 3, the person's eligible messages that date): the
  best photo / video (``photo_score``), the best words (``importance``), then
  her first voice. A message is never repeated: the photo's caption is not
  picked again as the words.
- ``avatar_url`` is her icon at the side's earliest item; ``member_path`` the
  room of the side's first item.
- ``shared_keyword`` is the first ``ECHO_KEYWORDS`` entry in both sides' item
  texts and captions (checked after ``attach_texts``).

**初見 vs 今** -- :func:`then_now_first_week` returns::

    {"mode": "first_week", "then_range": ["2025-03-01", "2025-03-07"],
     "now_range": [...], "rows": [{"kind": "photo" | "ohayo" | "voice",
     "then": message, "now": message}], "avatar_then", "avatar_now"}

or ``None``.

- The first week starts at the subscription start
  (``binder.subscription_start``), else her first message's JST date (the
  recap rule). The latest week is the 7 JST days ending today; when it
  overlaps the first week the result is ``None``.
- Rows: ``photo`` = the best ``photo_score`` in each week; ``ohayo`` = the
  first おはよう of the first week and the latest of the latest week;
  ``voice`` = the first voice and the latest voice. A row is kept only when
  both sides exist; no rows is ``None``.
- ``avatar_then`` / ``avatar_now`` are her icon at the earliest first-week
  item and at the latest latest-week item.

Eligible messages are non-promo words (an ``importance``), photos / videos
and voices: promo is never shown as her words (spec 3.3). Never cached: the
payloads carry her words. Logs ``memories_then_now`` (ids, codes and counts
only): ``mode=day`` with ``now_rule=this_year|latest_year|none``,
``person=same|split`` (``None`` when there is no pair) and ``reason``
(``no_then|no_later_year`` or ``None``); ``mode=first_week`` with ``rows`` and
``reason`` (``no_start|overlap|no_rows`` or ``None``).
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

import structlog

from backend.services.memories import binder, people
from backend.services.memories import index as mi
from backend.services.memories.facts import Fact, get_person_facts
from backend.services.memories.lexicon import ECHO_KEYWORDS
from backend.services.memories.selection import JST, normalize

logger = structlog.get_logger(__name__)

WEEK_DAYS = 7
MAX_ITEMS = 3
_EVENT = "memories_then_now"

_Tagged = tuple[mi.MemberSummary, str, Fact]  # (person, room, fact)
_Room = tuple[str, Fact]  # (room, fact)


def keywords_in(text: str) -> list[str]:
    """The :data:`~lexicon.ECHO_KEYWORDS` contained in the NFKC ``text``, in list order."""
    norm = normalize(text)
    return [k for k in ECHO_KEYWORDS if k in norm]


def first_week_window(begin: date) -> tuple[date, date]:
    """``(begin, begin + 6 days)``: the first week, both ends inclusive."""
    return begin, begin + timedelta(days=WEEK_DAYS - 1)


def latest_week_window(today: date) -> tuple[date, date]:
    """``(today - 6 days, today)``: the latest week, both ends inclusive."""
    return today - timedelta(days=WEEK_DAYS - 1), today


def _eligible(f: Fact) -> bool:
    return not f.is_promo and (
        f.importance is not None or f.type in people.MEDIA_TYPES or f.type == "voice"
    )


def _best_photo(facts: Iterable[_Room]) -> _Room | None:
    photos = [t for t in facts if t[1].type in people.MEDIA_TYPES]
    return min(
        photos, key=lambda t: (-(t[1].photo_score or 0), t[1].ts, t[1].id), default=None
    )


# --- day mode ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _Side:
    person: mi.MemberSummary
    day: date
    items: list[_Room]


def _items(facts: Sequence[_Room]) -> list[_Room]:
    """Best photo, best words, first voice; no message twice."""
    out: list[_Room] = []
    taken: set[int] = set()
    photo = _best_photo(facts)
    if photo is not None:
        out.append(photo)
        taken |= {photo[1].id, photo[1].caption_id or photo[1].id}
    words = min(
        (t for t in facts if t[1].importance is not None and t[1].id not in taken),
        key=lambda t: (-(t[1].importance or 0), t[1].ts, t[1].id),
        default=None,
    )
    if words is not None:
        out.append(words)
        taken.add(words[1].id)
    voice = next(
        (t for t in facts if t[1].type == "voice" and t[1].id not in taken), None
    )
    if voice is not None:
        out.append(voice)
    return out[:MAX_ITEMS]


def _importance(facts: Iterable[_Room]) -> int:
    return sum(f.importance or 0 for _, f in facts)


def _this_year(day: date, today: date) -> date | None:
    try:
        return day.replace(year=today.year)
    except ValueError:  # Feb 29 in a non-leap year
        return None


def _plan_day(
    tagged: Sequence[_Tagged],
    day: date,
    today: date,
    oshi: set[str],
    order: Sequence[mi.MemberSummary],
) -> tuple[str, str | None, str | None, tuple[_Side, _Side] | None]:
    """``(now_rule, person mode, reason, sides)``. Pure; runs in a worker."""
    rank = {people.person_key(s): i for i, s in enumerate(order)}
    persons = {people.person_key(s): s for s in order}
    by_date: dict[date, dict[str, list[_Room]]] = {}
    for person, room, f in tagged:
        if _eligible(f) and f.jst_date <= today:
            by_person = by_date.setdefault(f.jst_date, {})
            by_person.setdefault(people.person_key(person), []).append((room, f))
    if day not in by_date:
        return "none", None, "no_then", None
    later = sorted((d for d in by_date if d > day), reverse=True)
    if not later:
        return "none", None, "no_later_year", None
    then_p = by_date[day]

    def best(keys: Iterable[str], weight_of) -> str:
        return min(
            keys,
            key=lambda k: (persons[k].name_norm not in oshi, -weight_of(k), rank[k]),
        )

    # The most recent later date (all are <= today) on which someone from
    # ``day`` posted again: the same person on both sides.
    shared = next(
        (
            (d, [k for k in then_p if k in by_date[d]])
            for d in later
            if any(k in by_date[d] for k in then_p)
        ),
        None,
    )
    if shared is not None:
        now_day, common = shared
        now_p = by_date[now_day]
        key = best(common, lambda k: _importance(then_p[k]) + _importance(now_p[k]))
        then_key = now_key = key
        mode = "same"
    else:
        now_day = later[0]
        now_p = by_date[now_day]
        then_key = best(then_p, lambda k: _importance(then_p[k]))
        now_key = best(now_p, lambda k: _importance(now_p[k]))
        mode = "split"
    now_rule = "this_year" if now_day == _this_year(day, today) else "latest_year"
    sides = (
        _Side(persons[then_key], day, _items(then_p[then_key])),
        _Side(persons[now_key], now_day, _items(now_p[now_key])),
    )
    return now_rule, mode, None, sides


async def _side_payload(
    service: str,
    sdir: Path,
    side: _Side,
    avatars: dict[str, people.AvatarTimeline],
) -> dict:
    key = people.person_key(side.person)
    if key not in avatars:
        avatars[key] = await people.avatar_timelines(sdir, side.person)
    avatar = avatars[key]
    earliest = min(f.ts for _, f in side.items)
    return {
        "year": side.day.year,
        "date": side.day.isoformat(),
        "member_path": people.chat_path(sdir, side.items[0][0]),
        "name": side.person.name,
        "avatar_url": avatar.at(earliest),
        "items": [
            people.message_ref(service, sdir, room, f, avatar=avatar)
            for room, f in side.items
        ],
    }


def _side_keywords(side: dict) -> list[str]:
    parts = [m.get(k) or "" for m in side["items"] for k in ("text", "caption")]
    return keywords_in("\n".join(parts))


async def then_now_day(
    service: str,
    sdir: Path,
    day: date,
    *,
    member: mi.MemberSummary | None,
    now: datetime,
) -> dict | None:
    """The あの日と今日 pair for ``day`` (see the module docstring), or ``None``."""
    today = now.astimezone(JST).date()
    summaries = [member] if member is not None else await mi.list_members(sdir)
    tagged = await people.service_facts_on(
        sdir, summaries, month_day=day.strftime("%m-%d")
    )
    oshi = await people.oshi_rooms(service, summaries)
    now_rule, mode, reason, sides = await asyncio.to_thread(
        _plan_day, tagged, day, today, oshi, summaries
    )
    logger.info(_EVENT, mode="day", now_rule=now_rule, person=mode, reason=reason)
    if sides is None:
        return None
    avatars: dict[str, people.AvatarTimeline] = {}
    then = await _side_payload(service, sdir, sides[0], avatars)
    now_side = await _side_payload(service, sdir, sides[1], avatars)
    await people.attach_texts(sdir, [*then["items"], *now_side["items"]])
    now_kws = set(_side_keywords(now_side))
    shared = next((k for k in _side_keywords(then) if k in now_kws), None)
    return {"mode": "day", "then": then, "now": now_side, "shared_keyword": shared}


# --- first-week mode ------------------------------------------------------------------


def _week_rows(
    tagged: Sequence[_Room],
    then_range: tuple[date, date],
    now_range: tuple[date, date],
) -> list[tuple[str, _Room, _Room]]:
    """``(kind, then, now)`` rows with both sides. Pure; runs in a worker."""
    pool = [t for t in tagged if _eligible(t[1])]
    first = [t for t in pool if then_range[0] <= t[1].jst_date <= then_range[1]]
    latest = [t for t in pool if now_range[0] <= t[1].jst_date <= now_range[1]]

    def ohayo(ts: list[_Room]) -> list[_Room]:
        return [t for t in ts if t[1].has_greeting("ohayo")]

    def voices(ts: list[_Room]) -> list[_Room]:
        return [t for t in ts if t[1].type == "voice"]

    pairs = (
        ("photo", _best_photo(first), _best_photo(latest)),
        ("ohayo", next(iter(ohayo(first)), None), next(reversed(ohayo(latest)), None)),
        (
            "voice",
            next(iter(voices(first)), None),
            next(reversed(voices(latest)), None),
        ),
    )
    return [(k, a, b) for k, a, b in pairs if a is not None and b is not None]


async def then_now_first_week(
    service: str, sdir: Path, summary: mi.MemberSummary, *, now: datetime
) -> dict | None:
    """初見 vs 今 for one person (see the module docstring), or ``None``."""
    today = now.astimezone(JST).date()
    tagged = await get_person_facts(sdir, summary)
    begin = binder.subscription_start(summary) or (
        tagged[0][1].jst_date if tagged else None
    )
    if begin is None:
        logger.info(_EVENT, mode="first_week", rows=0, reason="no_start")
        return None
    then_range = first_week_window(begin)
    now_range = latest_week_window(today)
    if now_range[0] <= then_range[1]:
        logger.info(_EVENT, mode="first_week", rows=0, reason="overlap")
        return None
    rows = await asyncio.to_thread(_week_rows, tagged, then_range, now_range)
    logger.info(
        _EVENT, mode="first_week", rows=len(rows), reason=None if rows else "no_rows"
    )
    if not rows:
        return None
    avatar = await people.avatar_timelines(sdir, summary)
    out_rows: list[dict] = []
    refs: list[dict] = []
    for kind, a, b in rows:
        then = people.message_ref(service, sdir, a[0], a[1], avatar=avatar)
        latest = people.message_ref(service, sdir, b[0], b[1], avatar=avatar)
        out_rows.append({"kind": kind, "then": then, "now": latest})
        refs += [then, latest]
    await people.attach_texts(sdir, refs)
    return {
        "mode": "first_week",
        "then_range": [d.isoformat() for d in then_range],
        "now_range": [d.isoformat() for d in now_range],
        "rows": out_rows,
        "avatar_then": avatar.at(min(a[1].ts for _, a, _ in rows)),
        "avatar_now": avatar.at(max(b[1].ts for _, _, b in rows)),
    }


__all__ = [
    "MAX_ITEMS",
    "first_week_window",
    "keywords_in",
    "latest_week_window",
    "then_now_day",
    "then_now_first_week",
]
