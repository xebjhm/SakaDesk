"""彼女の24時間, her day stitched from different years (spec 14.1, slots 3.3).

:func:`build_day24` returns::

    {"seed": 123, "years": 3,
     "slots": [{"code": "ohayo" | "ohiru" | "otsukare" | "oyasumi" | "hour",
                "message": message}]}

or ``{"slots": []}`` when her day is too thin (fewer than :data:`MIN_SLOTS`
slots); the frontend then shows the gentle thin-data card, never a sparse day.

- **Pool:** her non-promo words (facts with an ``importance``) and pictures /
  videos. Promo and the subscription welcome are excluded, never down-ranked:
  spec 3.3 never picks them as her words.
- **Slots** (:func:`choose_slots`, from the pool's JST hour histogram):
  each greeting band in :data:`GREETING_BANDS` with any message gets a slot at
  its peak hour; then the busiest remaining hours at least :data:`MIN_GAP_H`
  hours (circular) from every chosen slot, each holding at least
  :data:`MIN_SHARE` of her messages, until :data:`MAX_SLOTS`. Ties go to the
  earlier hour. The slot time is the hour's ``:30``.
- **Candidates:** pool facts within :data:`WINDOW_MIN` minutes (circular, so
  23:30 reaches 00:00) of the slot time of day, in any year.
- **Score** (:func:`score`): greeting match +200 (``has_greeting(code)``),
  picture / video +100 (+ ``photo_score // 10``), nickname +80, favourited
  +300, text quality ``clamp(importance, 0, 400) // 4`` (length, emotion
  words, ★ and nickname, so plain texts no longer tie), -150 when the
  fact's year is already used by an earlier slot, and -400 when its id is in
  ``recent`` (the ids the client showed in its last re-rolls, at most
  :data:`RECENT_MAX`): a recent message sinks below every fresh one but can
  still fill a slot that has nothing else.
- **Choice:** in time-of-day order, the slot's candidates are shuffled with
  one ``random.Random(seed)`` and stably sorted by score (so ties fall in a
  seeded order, not always the oldest), the top :data:`POOL_N` are kept
  (fewer when the data has fewer), and one is drawn weighted by
  :func:`position_weights` (linear by rank: the best weighs ``n``, the last
  1). ``seed`` is the request's seed (🎲), else the JST date ordinal, so
  reopening on the same day shows the same day; the same seed and ``recent``
  always give the same day.

``years`` is the number of distinct JST years used; the UI has its own copy
for one year. Each ``message`` is the shared message object (with her words
and the avatar at its time); its ``ts`` is metadata, never presented as
chosen for the fan. Not cached: the facts are index-cached and at most
:data:`MAX_SLOTS` texts are read.

Logs (ids, codes, counts and scores only): ``memories_day24`` (``slots``,
``years``, ``rerolled``, ``recent`` = how many recent ids were sent) and ``memories_select`` per slot (``view=day24``,
``rule=<code>``, ``score``, ``message_id``).
"""

from __future__ import annotations

import asyncio
import random
from collections.abc import Sequence
from datetime import datetime
from pathlib import Path

import structlog

from backend.services.memories import index as mi
from backend.services.memories import people
from backend.services.memories.facts import (
    MINUTES_PER_DAY,
    Fact,
    aggregate,
    get_person_facts,
)
from backend.services.memories.selection import JST

logger = structlog.get_logger(__name__)

VIEW = "day24"
_EVENT = "memories_day24"

# (greeting code, first hour, last hour), JST, both inclusive.
GREETING_BANDS: tuple[tuple[str, int, int], ...] = (
    ("ohayo", 5, 9),
    ("ohiru", 11, 13),
    ("otsukare", 17, 19),
    ("oyasumi", 21, 23),
)
HOUR_CODE = "hour"
MIN_SLOTS = 5
MAX_SLOTS = 7
MIN_GAP_H = 2
MIN_SHARE = 0.01
WINDOW_MIN = 30
SLOT_MINUTE = 30
POOL_N = 30
RECENT_MAX = 64

GREETING_BONUS = 200
MEDIA_BONUS = 100
PHOTO_SCORE_DIV = 10
NICKNAME_BONUS = 80
FAVORITE_BONUS = 300
SAME_YEAR_PENALTY = 150
QUALITY_CAP = 400
QUALITY_DIV = 4
RECENT_PENALTY = 400

_Tagged = tuple[str, Fact]  # (room, fact)


def hour_distance(a: int, b: int) -> int:
    """Hours between two hours of the day, around the clock (23 -> 0 is 1)."""
    d = abs(a - b) % 24
    return min(d, 24 - d)


def in_window(minute: int, slot_minute: int) -> bool:
    """Whether a minute of the day is within :data:`WINDOW_MIN` of the slot's."""
    d = abs(minute - slot_minute) % MINUTES_PER_DAY
    return min(d, MINUTES_PER_DAY - d) <= WINDOW_MIN


def choose_slots(hist: Sequence[int]) -> list[tuple[str, int]]:
    """``(code, hour)`` slots in time-of-day order from a 24-hour histogram.

    ``[]`` when fewer than :data:`MIN_SLOTS` qualify (module docstring).
    """
    total = sum(hist)
    chosen: list[tuple[str, int]] = []
    for code, first, last in GREETING_BANDS:
        band = range(first, last + 1)
        peak = max(band, key=lambda h: (hist[h], -h))
        if hist[peak] > 0:
            chosen.append((code, peak))
    for h in sorted(range(24), key=lambda h: (-hist[h], h)):
        if len(chosen) >= MAX_SLOTS or hist[h] < MIN_SHARE * total or not hist[h]:
            break
        if all(hour_distance(h, c) >= MIN_GAP_H for _, c in chosen):
            chosen.append((HOUR_CODE, h))
    if len(chosen) < MIN_SLOTS:
        return []
    return sorted(chosen, key=lambda s: s[1])


def score(
    f: Fact, code: str, used_years: set[int], recent: frozenset[int] = frozenset()
) -> int:
    """A candidate's score for a slot (module docstring)."""
    s = 0
    if f.importance is not None:
        s += max(0, min(f.importance, QUALITY_CAP)) // QUALITY_DIV
    if code != HOUR_CODE and f.has_greeting(code):
        s += GREETING_BONUS
    if f.type in people.MEDIA_TYPES:
        s += MEDIA_BONUS + (f.photo_score or 0) // PHOTO_SCORE_DIV
    if f.has_nickname:
        s += NICKNAME_BONUS
    if f.favorited:
        s += FAVORITE_BONUS
    if f.jst_date.year in used_years:
        s -= SAME_YEAR_PENALTY
    if f.id in recent:
        s -= RECENT_PENALTY
    return s


def position_weights(n: int) -> list[int]:
    """Linear weights by rank for ``n`` sorted candidates: ``n, n-1, ..., 1``."""
    return list(range(n, 0, -1))


def _in_pool(f: Fact) -> bool:
    if f.is_promo or f.is_welcome:
        return False
    return f.importance is not None or f.type in people.MEDIA_TYPES


def _pick(
    tagged: Sequence[_Tagged], seed: int, recent: frozenset[int] = frozenset()
) -> list[tuple[str, int, _Tagged]]:
    """``(code, score, (room, fact))`` per slot. Pure; runs in a worker."""
    pool = [t for t in tagged if _in_pool(t[1])]
    slots = choose_slots(aggregate(f for _, f in pool).hour_hist)
    rng = random.Random(seed)
    used: set[int] = set()
    out: list[tuple[str, int, _Tagged]] = []
    for code, hour in slots:
        slot_minute = hour * 60 + SLOT_MINUTE
        cands = [
            (score(f, code, used, recent), (room, f))
            for room, f in pool
            if in_window(f.hour * 60 + f.minute, slot_minute)
        ]
        rng.shuffle(cands)  # ties fall in a seeded order, not always the oldest
        cands.sort(key=lambda c: -c[0])  # stable
        ranked = cands[:POOL_N]
        # Every slot hour holds pool facts (it comes from their histogram) and
        # a slot's window contains its whole hour, so ``ranked`` is non-empty.
        s, pick = rng.choices(ranked, weights=position_weights(len(ranked)))[0]
        used.add(pick[1].jst_date.year)
        out.append((code, s, pick))
    return out


async def build_day24(
    service: str,
    sdir: Path,
    summary: mi.MemberSummary,
    *,
    seed: int | None,
    now: datetime,
    recent: frozenset[int] = frozenset(),
) -> dict:
    """Her 24 hours (see the module docstring).

    ``recent``: message ids the client showed in its last re-rolls (avoided).
    """
    used_seed = seed if seed is not None else now.astimezone(JST).date().toordinal()
    tagged = await get_person_facts(sdir, summary)
    picks = await asyncio.to_thread(_pick, tagged, used_seed, recent)
    years = len({p[2][1].jst_date.year for p in picks})
    logger.info(
        _EVENT,
        slots=len(picks),
        years=years,
        rerolled=seed is not None,
        recent=len(recent),
    )
    if not picks:
        return {"slots": []}
    avatar = await people.avatar_timelines(sdir, summary)
    slots: list[dict] = []
    for code, s, (room, fact) in picks:
        logger.info(
            "memories_select", view=VIEW, rule=code, score=s, message_id=fact.id
        )
        slots.append(
            {
                "code": code,
                "message": people.message_ref(service, sdir, room, fact, avatar=avatar),
            }
        )
    await people.attach_texts(sdir, [s["message"] for s in slots])
    return {"seed": used_seed, "years": years, "slots": slots}


__all__ = [
    "GREETING_BANDS",
    "MAX_SLOTS",
    "MIN_GAP_H",
    "MIN_SLOTS",
    "build_day24",
    "choose_slots",
    "hour_distance",
    "in_window",
    "position_weights",
    "score",
]
