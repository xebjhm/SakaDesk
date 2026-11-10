"""The 時光軸 timeline of one person (spec 5.4).

- :func:`timeline_months` -- the rail: one ``{"month", "count"}`` per JST month,
  continuous from her first month to her last. Months without messages are
  included with ``count: 0``; the rail draws them as empty bars and never
  shows the number. The month counting runs in a worker. Cached text-free
  (view ``timeline_months``, key ``person_key``, hash over
  :data:`TIMELINE_MONTHS_VERSION` and ``people.room_hashes``).
- :func:`timeline_month` -- the selected month:

  - ``count``: the month's facts (promo included), the month's one number;
  - ``avatar_url``: her avatar at the middle of the month, clamped to ``now``;
  - ``photos``: up to :data:`PHOTO_CAP` non-promo pictures / videos with the
    highest ``photo_score`` (ties: the earlier), shown in time order;
  - ``messages``: three words slots (*words* = non-promo with an importance;
    photos already shown, and their paired caption messages, are left out),
    filled in the order top -> nickname
    -> late so a message appears in at most one slot:

    - ``top``: the highest importance;
    - ``nickname``: the highest-importance ``has_nickname`` words;
    - ``late``: the latest time of day from 22:00 to 04:59, where 0-4 h
      counts as 24-28 h (:func:`late_key`);

    ties go to the earlier message; an empty slot is ``None``;
  - ``milestones``: earned cards whose unlock ``date`` (or, for a yearly
    stack, a year's ``date``) falls in the month (:func:`milestones`), read
    from the cached binder payload (``binder.binder_payload`` with the same
    ``binder_hash``), so a month miss evaluates no cards once the binder is
    cached (the memoir list warms it).

  The text-free payload is cached (view ``timeline_month``, key
  ``person_key|month``, hash over :data:`TIMELINE_VERSION`,
  ``binder.binder_hash`` and the month); her words are attached after the
  cache read. A month outside her first..last month raises
  :class:`MonthOutOfRange` (the API answers 404); a malformed month raises
  ``ValueError``.

Logs (ids, codes, counts and scores only; ``person`` = first member id):
``memories_select`` (``view=timeline``, ``rule`` = slot, ``score`` =
importance, ``fallback=None``, ``message_id``, ``month``) per filled slot and
``memories_skip`` (``view=timeline``, ``reason=no_<slot>``, ``month``) per
empty slot, written when the month is built (a cache hit logs only
``memories_view_cache``).
"""

from __future__ import annotations

import asyncio
import re
from collections import Counter
from collections.abc import Callable, Iterable, Sequence
from datetime import date, datetime
from pathlib import Path

import structlog

from backend.services.memories import binder
from backend.services.memories import index as mi
from backend.services.memories import people
from backend.services.memories.facts import Fact, get_person_facts
from backend.services.memories.selection import JST
from backend.services.memories.view_cache import cached_view, view_hash

logger = structlog.get_logger(__name__)

VIEW = "timeline"
VIEW_MONTHS = "timeline_months"
VIEW_MONTH = "timeline_month"
# Bump on any rule or payload change of the month view (its cache hash has it).
TIMELINE_VERSION = 3
# Bump on any rule or payload change of the rail (its cache hash has it).
TIMELINE_MONTHS_VERSION = 1
PHOTO_CAP = 12
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
SLOTS = ("top", "nickname", "late")  # fill order

_Tagged = tuple[str, Fact]


class MonthOutOfRange(LookupError):
    """The month lies outside the person's first..last month."""


def _member_id(summary: mi.MemberSummary) -> str | None:
    return summary.member_ids[0] if summary.member_ids else None


def month_of(day: date) -> str:
    """``YYYY-MM`` of a date."""
    return f"{day.year:04d}-{day.month:02d}"


def _month_start(month: str) -> datetime:
    year, mon = int(month[:4]), int(month[5:])
    return datetime(year, mon, 1, tzinfo=JST)


def _next_month(month: str) -> str:
    year, mon = int(month[:4]), int(month[5:])
    return f"{year + mon // 12:04d}-{mon % 12 + 1:02d}"


def _month_seq(first: str, last: str) -> list[str]:
    out = [first]
    while out[-1] < last:
        out.append(_next_month(out[-1]))
    return out


def _month_counts(tagged: Sequence[_Tagged]) -> list[dict]:
    """``[{"month", "count"}, ...]``, continuous first..last. Pure."""
    counts = Counter(month_of(f.jst_date) for _, f in tagged)
    if not counts:
        return []
    seq = _month_seq(min(counts), max(counts))
    return [{"month": m, "count": counts.get(m, 0)} for m in seq]


async def timeline_months(service: str, sdir: Path, summary: mi.MemberSummary) -> dict:
    """The rail: ``{"months": [{"month", "count"}, ...]}``, oldest first, cached."""
    data_hash = view_hash(
        TIMELINE_MONTHS_VERSION, await people.room_hashes(sdir, summary)
    )

    async def build() -> dict:
        tagged = await get_person_facts(sdir, summary)
        return {"months": await asyncio.to_thread(_month_counts, tagged)}

    return await cached_view(
        sdir, VIEW_MONTHS, people.person_key(summary), data_hash, build
    )


# --- one month ----------------------------------------------------------------------


def is_late(hour: int) -> bool:
    """22:00-04:59 JST."""
    return hour >= 22 or hour < 5


def late_key(hour: int, minute: int, second: int) -> tuple[int, int, int]:
    """Lateness of a clock time: 0-4 h count as 24-28 h."""
    return (hour + 24 if hour < 5 else hour, minute, second)


def binder_cards(payload: dict) -> list[dict]:
    """Every card of a ``binder.binder_payload``, shelf by shelf."""
    return [card for shelf in payload["shelves"] for card in shelf["cards"]]


def milestones(cards: Iterable[dict], month: str) -> list[dict]:
    """Earned binder-payload cards unlocked in ``month``, by date then key.

    A yearly stack (non-empty ``years``) contributes each of its years whose
    ``date`` is in the month (key = the card's key); other cards their own
    unlock ``date``. Dates are ISO ``YYYY-MM-DD`` strings (or ``None``).
    """
    out: set[tuple[str, str, bool]] = set()
    for card in cards:
        if not card["earned"]:
            continue
        years = card["years"]
        dates = [y["date"] for y in years] if years else [card["date"]]
        for d in dates:
            if d is not None and d[:7] == month:
                out.add((d, card["key"], card["foil"]))
    return [{"key": key, "date": d, "foil": foil} for d, key, foil in sorted(out)]


def _order(t: _Tagged) -> tuple[datetime, int, str]:
    return t[1].ts, t[1].id, t[0]


_Score = Callable[[Fact], tuple[int, ...]]


def _best(items: Sequence[_Tagged], score: _Score) -> _Tagged | None:
    """The item with the highest ``score`` (ties: the earlier)."""
    best: _Tagged | None = None
    for t in items:  # items are in time order: keep the first of equals
        if best is None or score(t[1]) > score(best[1]):
            best = t
    return best


def _importance(f: Fact) -> tuple[int, ...]:
    return (f.importance or 0,)


def _late(f: Fact) -> tuple[int, ...]:
    return late_key(f.hour, f.minute, f.jst.second)


def _pick(
    month_facts: Sequence[_Tagged],
) -> tuple[list[_Tagged], dict[str, _Tagged | None]]:
    """``(photos in time order, {slot: words or None})``. Pure."""
    media = [
        t
        for t in month_facts
        if t[1].type in people.MEDIA_TYPES
        and not t[1].is_promo
        and t[1].photo_score is not None
    ]
    ranked = sorted(media, key=lambda t: (-(t[1].photo_score or 0), *_order(t)))
    photos = sorted(ranked[:PHOTO_CAP], key=_order)
    # a photo's words (own or a paired caption message) never show twice
    used = {(r, f.id) for r, f in photos}
    used |= {(r, f.caption_id) for r, f in photos if f.caption_id is not None}
    words = [
        t for t in month_facts if not t[1].is_promo and t[1].importance is not None
    ]
    slots: dict[str, _Tagged | None] = {}
    rules: dict[str, tuple[Callable[[Fact], bool], _Score]] = {
        "top": (lambda f: True, _importance),
        "nickname": (lambda f: f.has_nickname, _importance),
        "late": (lambda f: is_late(f.hour), _late),
    }
    for slot in SLOTS:
        keep, score = rules[slot]
        pool = [t for t in words if (t[0], t[1].id) not in used and keep(t[1])]
        best = _best(pool, score)
        slots[slot] = best
        if best is not None:
            used.add((best[0], best[1].id))
    return photos, slots


def _compose(
    service: str,
    sdir: Path,
    summary: mi.MemberSummary,
    month: str,
    month_facts: list[_Tagged],
    cards: list[dict],
    timeline: people.AvatarTimeline,
    now: datetime,
) -> dict:
    """The text-free month payload. Blocking (runs in a worker)."""
    person = _member_id(summary)
    photos, slots = _pick(month_facts)

    def ref(t: _Tagged) -> dict:
        return people.message_ref(service, sdir, t[0], t[1], avatar=timeline)

    for slot in SLOTS:
        t = slots[slot]
        if t is None:
            logger.info(
                "memories_skip",
                view=VIEW,
                person=person,
                reason=f"no_{slot}",
                month=month,
            )
        else:
            logger.info(
                "memories_select",
                view=VIEW,
                person=person,
                rule=slot,
                score=t[1].importance,
                fallback=None,
                message_id=t[1].id,
                month=month,
            )
    start = _month_start(month)
    mid = start + (_month_start(_next_month(month)) - start) / 2
    return {
        "month": month,
        "count": len(month_facts),
        "avatar_url": timeline.at(min(mid, now)),
        "photos": [ref(t) for t in photos],
        "messages": {
            slot: (ref(t) if (t := slots[slot]) is not None else None)
            for slot in ("top", "late", "nickname")
        },
        "milestones": milestones(cards, month),
    }


def _month_facts(tagged: list[_Tagged], month: str) -> list[_Tagged] | None:
    """The month's facts, or ``None`` when it is outside first..last. Blocking."""
    if not tagged:
        return None
    first, last = month_of(tagged[0][1].jst_date), month_of(tagged[-1][1].jst_date)
    if not first <= month <= last:
        return None
    return [t for t in tagged if month_of(t[1].jst_date) == month]


def _message_refs(payload: dict) -> list[dict]:
    slots = [r for r in payload["messages"].values() if r is not None]
    return [*payload["photos"], *slots]


async def timeline_month(
    service: str,
    sdir: Path,
    summary: mi.MemberSummary,
    month: str,
    *,
    now: datetime,
) -> dict:
    """The selected month (see the module docstring); her words attached."""
    if not MONTH_RE.match(month):
        raise ValueError("month must be YYYY-MM")
    b_hash = await binder.binder_hash(sdir, summary, now=now)
    data_hash = view_hash(TIMELINE_VERSION, b_hash, month)

    async def build() -> dict:
        tagged = await get_person_facts(sdir, summary)
        month_facts = await asyncio.to_thread(_month_facts, tagged, month)
        if month_facts is None:
            logger.info(
                "memories_skip",
                view=VIEW,
                person=_member_id(summary),
                reason="month_out_of_range",
                month=month,
            )
            raise MonthOutOfRange(month)
        # the cached binder (a hit once warmed): no card evaluation per month
        cards = binder_cards(
            await binder.binder_payload(
                service, sdir, summary, now=now, data_hash=b_hash
            )
        )
        timeline = await people.avatar_timelines(sdir, summary)
        return await asyncio.to_thread(
            _compose, service, sdir, summary, month, month_facts, cards, timeline, now
        )

    key = f"{people.person_key(summary)}|{month}"
    payload = await cached_view(sdir, VIEW_MONTH, key, data_hash, build)
    await people.attach_texts(sdir, _message_refs(payload))
    return payload


__all__ = [
    "MONTH_RE",
    "MonthOutOfRange",
    "PHOTO_CAP",
    "is_late",
    "late_key",
    "binder_cards",
    "milestones",
    "month_of",
    "timeline_month",
    "timeline_months",
]
