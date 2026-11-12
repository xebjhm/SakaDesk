"""初見と今, then and now (spec 14.2).

Shared with the recap's S08 slide (one copy of each rule):

- :func:`keywords_in` -- the ``lexicon.ECHO_KEYWORDS`` in a text (NFKC);
- :func:`first_week_window` -- the first week from a start date;
- :func:`latest_week_window` -- the 7 JST days ending on a date.

**初見と今, same-kind rows** -- :func:`then_now_first_meet` returns::

    {"mode": "first_meet",
     "rows": [{"kind": "ohayo" | "photo" | "voice" | "oyasumi",
               "then": message, "now": message,
               "elapsed": {"years": 1, "days": 8}}],
     "avatar_then", "avatar_now"}

or ``None`` (no row has both sides), for one person:

- the pool is her own words and media: never the subscription welcome
  (``Fact.is_welcome``), never promo; the greeting rows also skip Q&A posts
  (``Fact.is_qa``);
- kinds, in row order: ``ohayo`` (a text with おはよう sent 04:00-11:59
  JST), ``photo`` (a picture), ``voice``, ``oyasumi`` (a text with
  おやすみ);
- ``then`` is her first of the kind; ``now`` is the best of the kind in
  the :data:`RECENT_DAYS` JST days ending on her newest one (words: the
  highest ``importance``; photos: the highest ``photo_score``; voices: the
  newest; ties: the later). A row is kept only when ``now`` is on a later
  JST day than ``then``;
- ``elapsed`` is the calendar time between the two JST dates: whole years
  (anniversaries, Feb 29 as Feb 28), then the remaining days; never both 0;
- ``avatar_then`` / ``avatar_now`` are her icon at the earliest ``then``
  and at the latest ``now``.

Logs ``memories_then_now`` ``mode=first_meet`` with ``rows``, ``skipped``
(the kinds without a pair, codes) and ``reason`` (``no_rows`` or ``None``).

Never cached: the payload carries her words. Logs carry ids, codes and
counts only.
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from datetime import date, timedelta
from pathlib import Path

import structlog

from backend.services.memories import people
from backend.services.memories import cards as cards_mod
from backend.services.memories import index as mi
from backend.services.memories.facts import Fact, get_person_facts
from backend.services.memories.lexicon import ECHO_KEYWORDS
from backend.services.memories.selection import normalize

logger = structlog.get_logger(__name__)

WEEK_DAYS = 7
RECENT_DAYS = 30
FIRST_MEET_KINDS = ("ohayo", "photo", "voice", "oyasumi")
_EVENT = "memories_then_now"

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


# --- first-meet rows (初見と今) -----------------------------------------------------------


def _meet_kind(f: Fact, kind: str) -> bool:
    """Whether ``f`` is a first-meet candidate of ``kind`` (welcome / promo already out)."""
    if kind == "photo":
        return f.type == "picture"
    if kind == "voice":
        return f.type == "voice"
    if f.type != "text" or f.is_qa:
        return False
    if kind == "ohayo":
        return f.has_greeting("ohayo") and 4 <= f.hour < 12
    return f.has_greeting("oyasumi")


def _recent_score(f: Fact, kind: str) -> tuple:
    """Higher is better; the trailing ``ts`` makes ties go to the later message."""
    if kind == "photo":
        return (f.photo_score or 0, f.ts)
    if kind == "voice":
        return (f.ts,)
    return (f.importance or 0, f.ts)


def elapsed(first: date, last: date) -> dict[str, int]:
    """``{"years", "days"}`` from ``first`` to ``last``: whole years, then days."""
    years = last.year - first.year
    if years and cards_mod.anniversary_date(first, years) > last:
        years -= 1
    years = max(years, 0)
    since = cards_mod.anniversary_date(first, years) if years else first
    return {"years": years, "days": (last - since).days}


def _meet_rows(
    tagged: Sequence[_Room],
) -> tuple[list[tuple[str, _Room, _Room]], list[str]]:
    """``(rows, skipped kinds)``. Pure; runs in a worker."""
    pool = [t for t in tagged if not t[1].is_welcome and not t[1].is_promo]
    rows: list[tuple[str, _Room, _Room]] = []
    skipped: list[str] = []
    for kind in FIRST_MEET_KINDS:
        items = [t for t in pool if _meet_kind(t[1], kind)]
        if not items:
            skipped.append(kind)
            continue
        first = items[0]
        newest = items[-1][1].jst_date
        since = newest - timedelta(days=RECENT_DAYS - 1)
        recent = [t for t in items if t[1].jst_date >= since]
        best = max(recent, key=lambda t: _recent_score(t[1], kind))
        if best[1].jst_date <= first[1].jst_date:
            skipped.append(kind)
            continue
        rows.append((kind, first, best))
    return rows, skipped


async def then_now_first_meet(
    service: str, sdir: Path, summary: mi.MemberSummary
) -> dict | None:
    """初見と今 as same-kind rows (see the module docstring), or ``None``."""
    tagged = await get_person_facts(sdir, summary)
    rows, skipped = await asyncio.to_thread(_meet_rows, tagged)
    logger.info(
        _EVENT,
        mode="first_meet",
        rows=len(rows),
        skipped=skipped,
        reason=None if rows else "no_rows",
    )
    if not rows:
        return None
    avatar = await people.avatar_timelines(sdir, summary)
    out_rows: list[dict] = []
    refs: list[dict] = []
    for kind, a, b in rows:
        then = people.message_ref(service, sdir, a[0], a[1], avatar=avatar)
        latest = people.message_ref(service, sdir, b[0], b[1], avatar=avatar)
        out_rows.append(
            {
                "kind": kind,
                "then": then,
                "now": latest,
                "elapsed": elapsed(a[1].jst_date, b[1].jst_date),
            }
        )
        refs += [then, latest]
    await people.attach_texts(sdir, refs)
    return {
        "mode": "first_meet",
        "rows": out_rows,
        "avatar_then": avatar.at(min(a[1].ts for _, a, _ in rows)),
        "avatar_now": avatar.at(max(b[1].ts for _, _, b in rows)),
    }


__all__ = [
    "FIRST_MEET_KINDS",
    "RECENT_DAYS",
    "elapsed",
    "first_week_window",
    "keywords_in",
    "latest_week_window",
    "then_now_first_meet",
]
