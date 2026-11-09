"""Per-message facts for Memories: query and aggregate helpers (spec 3.2).

The memory index (:mod:`backend.services.memories.index`) writes one row per
message to the ``message_facts`` table. Year-scoped features (the recap's
``W(Y)``, On This Day, calendar cells) read those rows instead of re-reading
``messages.json`` for every slide. The intended pattern is one query, then
pure helpers on the returned list::

    facts = await get_facts(service_data_dir, member_dir, start, end, until=now)
    agg = aggregate(facts)                       # counts, hour histogram, streak
    first, last = first_last(facts, types={"text"})
    nick = select(facts, nickname=True)          # %%% messages
    voices = voice_durations(facts, min_seconds=4)
    texts = load_texts(service_data_dir, member_dir, [f.id for f in picks])

Table ``message_facts`` (key ``(service_dir, member_dir, id)``, no secondary
indexes: every query is scoped by the key prefix):

==============  =========  ====================================================
column          type       meaning
==============  =========  ====================================================
id              INTEGER    message id
ts_utc          TEXT       ``YYYY-MM-DDTHH:MM:SSZ``
jst_date        TEXT       ``YYYY-MM-DD`` in JST
hour, minute    INTEGER    JST clock time
type            TEXT       ``text`` / ``picture`` / ``video`` / ``voice`` / …
is_promo        INTEGER    0/1. Words: own text is promo. Media without text:
                           the nearest text within +-3 min is promo.
has_nickname    INTEGER    0/1, own text contains ``%%%`` (promo included)
greeting_mask   INTEGER    ``lexicon.GREETING_BITS`` of own text (promo included)
chars           INTEGER    length of own text (0 for media without a caption)
importance      INTEGER    non-promo messages with own text only, else NULL
photo_score     INTEGER    non-promo picture/video only, else NULL
burst_id        INTEGER    id of the burst's first item, else NULL
caption_id      INTEGER    picture/video: own id when it has its own caption,
                           else the paired text's id, else NULL
favorited       INTEGER    0/1, ``is_favorite`` from ``messages.json``
media_file      TEXT       as written by pysaka (relative, may use ``\\``)
duration_s      REAL       ``media_duration`` (voice / video), else NULL
==============  =========  ====================================================

API (dates are JST calendar dates, inclusive; results sorted by ``(ts, id)``):

- ``async get_facts(service_data_dir, member_dir, start=None, end=None, *,
  types=None, include_promo=True, until=None) -> list[Fact]`` -- makes sure the
  index is fresh (``get_member_index``), then queries. ``[]`` if the index
  could not be built.
- ``facts_in_range(...)`` -- same query without the freshness check (blocking;
  call via ``asyncio.to_thread``). ``facts_for_date(sdir, mdir, day)``.
- Pure helpers on a fact list: ``select`` (types / promo / nickname / greeting
  / favourited / hours / date range filters), ``on_date``, ``first_last``,
  ``by_year``, ``aggregate`` -> :class:`Aggregate`, ``year_aggregates``,
  ``bursts``, ``voice_durations``.
- ``get_person_facts(sdir, summary) -> [(member_dir, Fact)]`` -- the facts of
  all of a person's 1:1 rooms (``MemberSummary.member_dirs``) merged and
  sorted by ``(ts, id)``; each fact is tagged with its room's ``member_dir``
  (relative POSIX string) so ``load_texts`` can be called per room.
- ``load_texts(sdir, mdir, ids=None) -> {id: text}`` -- one read of
  ``messages.json`` for the message text, which the table does not store.

Text is deliberately not stored: the cache stays small and the archive stays
the only copy of her words. A feature that needs text (fragments, keyword
matching) calls ``load_texts`` once.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import structlog

from backend.services.memories import index as mi
from backend.services.memories.lexicon import GREETING_BITS
from backend.services.memories.selection import JST, classes_from_mask

logger = structlog.get_logger(__name__)


@dataclass(frozen=True)
class Fact:
    """One ``message_facts`` row."""

    id: int
    ts: datetime  # aware UTC
    jst_date: date
    hour: int
    minute: int
    type: str
    is_promo: bool
    has_nickname: bool
    greeting_mask: int
    chars: int
    importance: int | None
    photo_score: int | None
    burst_id: int | None
    caption_id: int | None
    favorited: bool
    media_file: str | None
    duration_s: float | None

    @property
    def jst(self) -> datetime:
        return self.ts.astimezone(JST)

    @property
    def greetings(self) -> frozenset[str]:
        return classes_from_mask(self.greeting_mask)

    def has_greeting(self, name: str) -> bool:
        return bool(self.greeting_mask & GREETING_BITS[name])


def _row_to_fact(row: tuple) -> Fact:
    (
        mid,
        ts,
        jst_date,
        hour,
        minute,
        type_,
        promo,
        nick,
        mask,
        chars,
        imp,
        photo,
        burst,
        caption,
        fav,
        media,
        duration,
    ) = row
    return Fact(
        id=mid,
        ts=datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc),
        jst_date=date.fromisoformat(jst_date),
        hour=hour,
        minute=minute,
        type=type_,
        is_promo=bool(promo),
        has_nickname=bool(nick),
        greeting_mask=mask,
        chars=chars,
        importance=imp,
        photo_score=photo,
        burst_id=burst,
        caption_id=caption,
        favorited=bool(fav),
        media_file=media,
        duration_s=duration,
    )


_SELECT = f"SELECT {', '.join(mi.FACT_COLUMNS)} FROM message_facts"


def facts_in_range(
    service_data_dir: Path,
    member_dir: Path,
    start: date | None = None,
    end: date | None = None,
    *,
    types: Iterable[str] | None = None,
    include_promo: bool = True,
    until: datetime | None = None,
) -> list[Fact]:
    """Facts with ``start <= jst_date <= end`` (and ``ts <= until``). Blocking.

    Reads the cache as is; use :func:`get_facts` to rebuild a stale index first.
    """
    where = ["service_dir=?", "member_dir=?"]
    args: list[object] = [str(service_data_dir), mi._rel(service_data_dir, member_dir)]
    if start is not None:
        where.append("jst_date>=?")
        args.append(start.isoformat())
    if end is not None:
        where.append("jst_date<=?")
        args.append(end.isoformat())
    if types is not None:
        type_list = sorted(set(types))
        where.append(f"type IN ({','.join('?' * len(type_list))})")
        args.extend(type_list)
    if not include_promo:
        where.append("is_promo=0")
    if until is not None:
        where.append("ts_utc<=?")
        args.append(mi._utc_iso(until))
    sql = f"{_SELECT} WHERE {' AND '.join(where)} ORDER BY ts_utc, id"
    with contextlib.closing(mi._connect()) as c:
        rows = c.execute(sql, args).fetchall()
    return [_row_to_fact(r) for r in rows]


def facts_for_date(service_data_dir: Path, member_dir: Path, day: date) -> list[Fact]:
    """All facts on one JST date. Blocking."""
    return facts_in_range(service_data_dir, member_dir, day, day)


async def get_facts(
    service_data_dir: Path,
    member_dir: Path,
    start: date | None = None,
    end: date | None = None,
    *,
    types: Iterable[str] | None = None,
    include_promo: bool = True,
    until: datetime | None = None,
) -> list[Fact]:
    """Fresh facts for one room: rebuilds the index when stale, then queries."""
    idx = await mi.get_member_index(service_data_dir, member_dir)
    if not idx.data_hash:  # the index could not be built (already logged)
        logger.info("memory_facts_unavailable", member_id=idx.member_id)
        return []
    if idx.cache_stale:
        logger.warning("memory_facts_stale", member_id=idx.member_id)
    type_list = list(types) if types is not None else None
    try:
        facts = await asyncio.to_thread(
            facts_in_range,
            service_data_dir,
            member_dir,
            start,
            end,
            types=type_list,
            include_promo=include_promo,
            until=until,
        )
    except Exception as e:  # noqa: BLE001 - a cache read must never raise
        logger.warning(
            "memory_facts_read_failed",
            member_id=idx.member_id,
            error_type=type(e).__name__,
        )
        return []
    logger.debug("memory_facts_read", member_id=idx.member_id, count=len(facts))
    return facts


async def get_person_facts(
    service_data_dir: Path, summary: mi.MemberSummary
) -> list[tuple[str, Fact]]:
    """Facts of every 1:1 room of one person, ``(member_dir, fact)``, by ``(ts, id)``.

    ``member_dir`` is the relative POSIX string from ``summary.member_dirs``;
    resolve it with ``service_data_dir / member_dir`` for :func:`load_texts`.
    Message ids are per room, so the key of a fact is ``(member_dir, id)``.
    """
    tagged: list[tuple[str, Fact]] = []
    for rel in summary.member_dirs:
        facts = await get_facts(service_data_dir, service_data_dir / rel)
        tagged.extend((rel, f) for f in facts)
    tagged.sort(key=lambda t: (t[1].ts, t[1].id, t[0]))
    return tagged


# --- pure helpers -----------------------------------------------------------


def select(
    facts: Iterable[Fact],
    *,
    types: Iterable[str] | None = None,
    include_promo: bool = False,
    nickname: bool | None = None,
    greeting: str | None = None,
    favorited: bool | None = None,
    hours: Iterable[int] | None = None,
    start: date | None = None,
    end: date | None = None,
) -> list[Fact]:
    """Filter a fact list. Promo is EXCLUDED unless ``include_promo``."""
    type_set = set(types) if types is not None else None
    hour_set = set(hours) if hours is not None else None
    bit = GREETING_BITS[greeting] if greeting is not None else 0
    out = []
    for f in facts:
        if f.is_promo and not include_promo:
            continue
        if type_set is not None and f.type not in type_set:
            continue
        if nickname is not None and f.has_nickname != nickname:
            continue
        if bit and not f.greeting_mask & bit:
            continue
        if favorited is not None and f.favorited != favorited:
            continue
        if hour_set is not None and f.hour not in hour_set:
            continue
        if start is not None and f.jst_date < start:
            continue
        if end is not None and f.jst_date > end:
            continue
        out.append(f)
    return out


def on_date(facts: Iterable[Fact], day: date) -> list[Fact]:
    """Facts on one JST date (promo included)."""
    return [f for f in facts if f.jst_date == day]


def first_last(
    facts: Iterable[Fact],
    *,
    types: Iterable[str] | None = None,
    include_promo: bool = False,
) -> tuple[Fact | None, Fact | None]:
    """First and last fact after :func:`select` filtering (input must be sorted)."""
    picked = select(facts, types=types, include_promo=include_promo)
    return (picked[0], picked[-1]) if picked else (None, None)


def by_year(facts: Iterable[Fact]) -> dict[int, list[Fact]]:
    """Facts grouped by JST year, order kept."""
    out: dict[int, list[Fact]] = {}
    for f in facts:
        out.setdefault(f.jst_date.year, []).append(f)
    return out


def bursts(facts: Iterable[Fact]) -> dict[int, list[Fact]]:
    """``burst_id -> items`` (promo included; filter with ``is_promo``)."""
    out: dict[int, list[Fact]] = {}
    for f in facts:
        if f.burst_id is not None:
            out.setdefault(f.burst_id, []).append(f)
    return out


def voice_durations(
    facts: Iterable[Fact], *, min_seconds: float = 0.0
) -> list[tuple[Fact, float]]:
    """``(voice fact, seconds)`` for voices with a known duration >= ``min_seconds``."""
    return [
        (f, f.duration_s)
        for f in facts
        if f.type == "voice"
        and f.duration_s is not None
        and f.duration_s >= min_seconds
    ]


def longest_streak(days: Iterable[date]) -> int:
    """Longest run of consecutive dates."""
    best = run = 0
    prev: date | None = None
    for d in sorted(set(days)):
        run = run + 1 if prev is not None and d - prev == timedelta(days=1) else 1
        best = max(best, run)
        prev = d
    return best


@dataclass(frozen=True)
class Aggregate:
    """Counts over a fact list. ``nonpromo_*`` / ``hour_hist`` / greetings exclude promo."""

    total: int = 0
    counts: dict[str, int] = field(default_factory=dict)  # type -> all
    nonpromo_counts: dict[str, int] = field(default_factory=dict)
    hour_hist: list[int] = field(default_factory=lambda: [0] * 24)
    nickname_count: int = 0  # promo included, like MemberIndex.nickname_count
    greeting_counts: dict[str, int] = field(default_factory=dict)  # multi-label
    favorites: int = 0
    voice_count: int = 0
    voice_seconds: float = 0.0
    media_in_bursts: int = 0  # non-promo picture/video inside a burst
    active_days: int = 0
    longest_streak_days: int = 0
    first: Fact | None = None  # first non-promo
    last: Fact | None = None  # last non-promo

    @property
    def nonpromo_total(self) -> int:
        return sum(self.nonpromo_counts.values())


def aggregate(facts: Iterable[Fact]) -> Aggregate:
    """One pass over ``facts`` (sorted) -> :class:`Aggregate`."""
    counts: Counter[str] = Counter()
    nonpromo: Counter[str] = Counter()
    greetings: Counter[str] = Counter()
    hist = [0] * 24
    days: set[date] = set()
    total = nick = favs = voices = in_bursts = 0
    seconds = 0.0
    first: Fact | None = None
    last: Fact | None = None
    for f in facts:
        total += 1
        counts[f.type] += 1
        days.add(f.jst_date)
        nick += f.has_nickname
        favs += f.favorited
        if f.type == "voice":
            voices += 1
            seconds += f.duration_s or 0.0
        if f.is_promo:
            continue
        nonpromo[f.type] += 1
        hist[f.hour] += 1
        greetings.update(classes_from_mask(f.greeting_mask))
        if f.burst_id is not None and f.type in ("picture", "video"):
            in_bursts += 1
        if first is None:
            first = f
        last = f
    return Aggregate(
        total=total,
        counts=dict(counts),
        nonpromo_counts=dict(nonpromo),
        hour_hist=hist,
        nickname_count=nick,
        greeting_counts=dict(greetings),
        favorites=favs,
        voice_count=voices,
        voice_seconds=round(seconds, 3),
        media_in_bursts=in_bursts,
        active_days=len(days),
        longest_streak_days=longest_streak(days),
        first=first,
        last=last,
    )


def year_aggregates(facts: Iterable[Fact]) -> dict[int, Aggregate]:
    """:func:`aggregate` per JST year."""
    return {y: aggregate(fs) for y, fs in by_year(facts).items()}


def load_texts(
    service_data_dir: Path, member_dir: Path, ids: Iterable[int] | None = None
) -> dict[int, str]:
    """``{id: content}`` from one read of ``messages.json``. Blocking.

    ``ids`` limits the result; ``None`` returns every message's text. A
    missing or unreadable file yields ``{}`` (logged).
    """
    wanted = set(ids) if ids is not None else None
    path = member_dir / "messages.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        out: dict[int, str] = {}
        for m in data["messages"]:
            try:
                mid = int(m["id"])
            except (KeyError, TypeError, ValueError):
                continue
            if wanted is None or mid in wanted:
                out[mid] = str(m.get("content") or "")
    except (OSError, ValueError, KeyError, TypeError) as e:
        logger.warning("memory_texts_unreadable", error_type=type(e).__name__)
        return {}
    return out
