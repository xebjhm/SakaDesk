"""同じ時刻, the same-time line on the hub (spec 14.3).

:func:`same_time` returns one of her messages sent at this JST time of day
(within :data:`WINDOW_MIN` minutes) on an earlier JST date::

    {"clock": "21:03", "year": 2024, "date": "2024-06-02",
     "member_path", "name", "message"}

or ``None`` when nothing matches (the frontend then hides the line).

- ``clock`` is now's JST ``HH:MM``; ``year`` / ``date`` are the message's real
  JST year and date, and ``message.ts`` its real time (UTC ISO), which the
  line shows as her JST ``HH:MM`` beside now's clock. The time is metadata:
  nothing says she chose it for the fan.
- Candidates (``facts.get_rooms_facts_at_clock`` over every room, midnight
  wraps): non-promo
  facts on a JST date before today that are words with an ``importance``, or a
  picture / video with a caption (``caption_id``).
- Band: earlier years first (any date before Jan 1 of this year); only when
  none exist, the earlier dates of this year.
- Within the band: the oshi's candidates only when she has any; then a seeded
  weighted choice (``gacha.weight`` of the score) among the top
  :data:`TOP_N` by score (``importance``, else ``photo_score``; ties: the
  earlier). The seed is :func:`seed_of` = ``sha256("<jst date>|<HH:MM>")``,
  so the line is stable within a minute and may change the next minute.

Never cached: the payload carries her words. The read uses the clock index
(``message_facts_by_clock``), so a +-2 min window reads only those rows, one
connection serves every room, and a room whose ``messages.json`` is
unchanged skips the index freshness check (the frontend asks every minute). Logs ``memories_same_time`` (``band=past_years|this_year|none``,
``count`` = the band's candidates, ``message_id``); ids and counts only.
"""

from __future__ import annotations

import asyncio
import hashlib
import random
from collections.abc import Sequence
from datetime import date, datetime
from pathlib import Path

import structlog

from backend.services.memories import index as mi
from backend.services.memories import people
from backend.services.memories.facts import (
    MINUTES_PER_DAY,
    Fact,
    get_rooms_facts_at_clock,
)
from backend.services.memories.gacha import weight
from backend.services.memories.selection import JST

logger = structlog.get_logger(__name__)

WINDOW_MIN = 2
TOP_N = 5
_EVENT = "memories_same_time"

_Tagged = tuple[mi.MemberSummary, str, Fact]


def seed_of(jst_date: date, clock: str) -> int:
    """The minute's seed: the first 8 bytes of ``sha256("<date>|<HH:MM>")``."""
    digest = hashlib.sha256(f"{jst_date.isoformat()}|{clock}".encode()).digest()
    return int.from_bytes(digest[:8], "big")


def _candidate(f: Fact) -> bool:
    if f.is_promo:
        return False
    if f.importance is not None:
        return True
    return f.type in people.MEDIA_TYPES and f.caption_id is not None


def _score(f: Fact) -> int:
    if f.importance is not None:
        return f.importance
    return f.photo_score or 0


def _choose(
    tagged: Sequence[_Tagged], oshi: set[str], today: date, seed: int
) -> tuple[str, int, _Tagged | None]:
    """``(band, band size, pick)``. Pure; runs in a worker."""
    pool = [t for t in tagged if t[2].jst_date < today and _candidate(t[2])]
    past = [t for t in pool if t[2].jst_date.year < today.year]
    band, chosen = ("past_years", past) if past else ("this_year", pool)
    if not chosen:
        return "none", 0, None
    mine = [t for t in chosen if t[0].name_norm in oshi]
    ranked = sorted(
        mine or chosen, key=lambda t: (-_score(t[2]), t[2].ts, t[2].id, t[1])
    )[:TOP_N]
    rng = random.Random(seed)
    pick = rng.choices(ranked, weights=[weight(_score(t[2])) for t in ranked])[0]
    return band, len(chosen), pick


def _window(minute: int) -> tuple[int, int]:
    return (
        (minute - WINDOW_MIN) % MINUTES_PER_DAY,
        (minute + WINDOW_MIN) % MINUTES_PER_DAY,
    )


async def same_time(service: str, sdir: Path, *, now: datetime) -> dict | None:
    """The same-time line for ``now`` (see the module docstring), or ``None``."""
    local = now.astimezone(JST)
    today = local.date()
    clock = local.strftime("%H:%M")
    start, end = _window(local.hour * 60 + local.minute)
    summaries = await mi.list_members(sdir)
    oshi = await people.oshi_rooms(service, summaries)
    rooms = [(s, room) for s in summaries for room in s.member_dirs]
    by_dir = await get_rooms_facts_at_clock(
        sdir, [sdir / room for _, room in rooms], start, end
    )
    tagged: list[_Tagged] = [
        (s, room, f) for s, room in rooms for f in by_dir.get(sdir / room, [])
    ]
    band, count, pick = await asyncio.to_thread(
        _choose, tagged, oshi, today, seed_of(today, clock)
    )
    logger.info(
        _EVENT,
        band=band,
        count=count,
        message_id=pick[2].id if pick is not None else None,
    )
    if pick is None:
        return None
    person, room, fact = pick
    avatar = await people.avatar_timelines(sdir, person)
    message = people.message_ref(service, sdir, room, fact, avatar=avatar)
    await people.attach_texts(sdir, [message])
    return {
        "clock": clock,
        "year": fact.jst_date.year,
        "date": fact.jst_date.isoformat(),
        "member_path": people.chat_path(sdir, room),
        "name": person.name,
        "message": message,
    }


__all__ = ["TOP_N", "WINDOW_MIN", "same_time", "seed_of"]
