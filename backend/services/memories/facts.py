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

Table ``message_facts`` (key ``(service_dir, member_dir, id)``; every query is
scoped by the key prefix; one secondary index, ``message_facts_by_clock`` on
``(service_dir, member_dir, hour, minute)``, serves :func:`facts_at_clock`):

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
importance      INTEGER    non-promo, non-welcome messages with own text only,
                           else NULL
photo_score     INTEGER    non-promo picture/video only, else NULL
burst_id        INTEGER    id of the burst's first item, else NULL
caption_id      INTEGER    picture/video: own id when it has its own caption,
                           else the paired text's id, else NULL
favorited       INTEGER    0/1, ``is_favorite`` from ``messages.json``
media_file      TEXT       as written by pysaka (relative, may use ``\\``)
duration_s      REAL       ``media_duration`` (voice / video), else NULL
is_welcome      INTEGER    0/1, the automatic welcome a room sends when the fan
                           subscribes (``selection.welcome_ids``). Never her
                           words: ``select`` and ``aggregate.first``/``last``
                           skip it unless asked; counts keep it.
==============  =========  ====================================================

API (dates are JST calendar dates, inclusive; results sorted by ``(ts, id)``).
Every bulk row read holds ``index.row_reads()`` (one at a time, process-wide;
see ``index._ROW_READS``):

- ``async get_facts(service_data_dir, member_dir, start=None, end=None, *,
  types=None, include_promo=True, until=None) -> list[Fact]`` -- makes sure the
  index is fresh (``get_member_index``), then queries. ``[]`` if the index
  could not be built.
- ``facts_in_range(...)`` -- same query without the freshness check (blocking;
  call via ``asyncio.to_thread``). ``facts_for_date(sdir, mdir, day)``.
- ``async get_facts_on(service_data_dir, member_dir, *, day=None,
  month_day=None) -> list[Fact]`` -- exactly one of ``day`` (one JST date) or
  ``month_day`` (``MM-DD`` in every year, for On This Day) must be given, else
  ``ValueError``. Same freshness check as ``get_facts``; ``[]`` when the index
  is unavailable or the read fails (``memory_facts_read_failed``).
- ``facts_on_month_day(sdir, mdir, month_day)`` -- the ``MM-DD`` query without
  the freshness check (blocking).
- ``facts_at_clock(sdir, mdir, start_minute, end_minute) -> list[Fact]`` --
  facts whose JST time of day ``hour*60+minute`` lies in
  ``[start_minute, end_minute]`` (minutes of the day, 0..1439) on any date,
  by ``(ts, id)``. ``start_minute > end_minute`` wraps midnight (split into
  ``[start, 1439]`` and ``[0, end]``). Blocking, no freshness check; uses the
  clock index, so a +-2 min window reads only those rows. ``ValueError`` for
  a minute outside 0..1439.
- ``async get_facts_at_clock(sdir, mdir, start_minute, end_minute)`` -- the
  same after the freshness check; ``[]`` when the index is unavailable or the
  read fails (同じ時刻, spec 14.3).
- ``facts_at_clock_rooms(sdir, mdirs, start_minute, end_minute)`` -- the
  clock query for several rooms over one connection (blocking), ``{mdir:
  [Fact]}``.
- ``async get_rooms_facts_at_clock(sdir, mdirs, start_minute, end_minute)``
  -- the per-minute 同じ時刻 read: skips the freshness check of a room whose
  ``messages.json`` size + mtime are unchanged since its last check (within
  :data:`CLOCK_FRESH_TTL_S`), then reads every room over one connection.
- Pure helpers on a fact list: ``select`` (types / promo / welcome / nickname
  / greeting / favourited / hours / date range filters), ``on_date``,
  ``first_last``, ``by_year``, ``aggregate`` -> :class:`Aggregate`,
  ``year_aggregates``, ``bursts``, ``voice_durations``,
  ``is_new_year_midnight``.
- ``get_person_facts(sdir, summary, start=None, end=None, *, types=None) ->
  [(member_dir, Fact)]`` -- the facts of all of a person's 1:1 rooms (``MemberSummary.member_dirs``) merged and
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
import time
from collections import Counter
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

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
    is_welcome: bool = False

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
        welcome,
    ) = row
    return Fact(
        id=mid,
        # ``ts_utc`` is always ``YYYY-MM-DDTHH:MM:SSZ`` (``index._utc_iso``);
        # fromisoformat reads it as aware UTC, ~50x faster than strptime.
        ts=datetime.fromisoformat(ts),
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
        is_welcome=bool(welcome),
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
    with mi.row_reads(), contextlib.closing(mi._connect()) as c:
        rows = c.execute(sql, args).fetchall()
    return [_row_to_fact(r) for r in rows]


def facts_for_date(service_data_dir: Path, member_dir: Path, day: date) -> list[Fact]:
    """All facts on one JST date. Blocking."""
    return facts_in_range(service_data_dir, member_dir, day, day)


def facts_on_month_day(
    service_data_dir: Path, member_dir: Path, month_day: str
) -> list[Fact]:
    """Facts whose JST date is ``MM-DD`` in any year, by ``(ts, id)``. Blocking."""
    sql = (
        f"{_SELECT} WHERE service_dir=? AND member_dir=? AND substr(jst_date, 6)=? "
        "ORDER BY ts_utc, id"
    )
    args = (str(service_data_dir), mi._rel(service_data_dir, member_dir), month_day)
    with mi.row_reads(), contextlib.closing(mi._connect()) as c:
        rows = c.execute(sql, args).fetchall()
    return [_row_to_fact(r) for r in rows]


MINUTES_PER_DAY = 24 * 60


def _clock_query(
    service_data_dir: Path, member_dir: Path, start: int, end: int
) -> tuple[str, list[object]]:
    """SQL + args for one non-wrapping clock range ``start <= end``.

    The ``hour BETWEEN`` bound lets SQLite seek the clock index; the exact
    minute filter runs on the few rows of those hours.
    """
    sql = (
        f"{_SELECT} WHERE service_dir=? AND member_dir=? AND hour BETWEEN ? AND ? "
        "AND (hour*60+minute) BETWEEN ? AND ? ORDER BY ts_utc, id"
    )
    args: list[object] = [
        str(service_data_dir),
        mi._rel(service_data_dir, member_dir),
        start // 60,
        end // 60,
        start,
        end,
    ]
    return sql, args


def _clock_ranges(start_minute: int, end_minute: int) -> list[tuple[int, int]]:
    """One or (across midnight) two non-wrapping ranges; ``ValueError`` if invalid."""
    for minute in (start_minute, end_minute):
        if not 0 <= minute < MINUTES_PER_DAY:
            raise ValueError("minute must be 0..1439")
    if start_minute <= end_minute:
        return [(start_minute, end_minute)]
    return [(start_minute, MINUTES_PER_DAY - 1), (0, end_minute)]


def _clock_facts(
    c: Any,
    service_data_dir: Path,
    member_dir: Path,
    ranges: list[tuple[int, int]],
) -> list[Fact]:
    rows: list[tuple] = []
    for start, end in ranges:
        sql, args = _clock_query(service_data_dir, member_dir, start, end)
        rows.extend(c.execute(sql, args).fetchall())
    facts = [_row_to_fact(r) for r in rows]
    if len(ranges) > 1:
        facts.sort(key=lambda f: (f.ts, f.id))
    return facts


def facts_at_clock(
    service_data_dir: Path, member_dir: Path, start_minute: int, end_minute: int
) -> list[Fact]:
    """Facts at a JST time of day in ``[start_minute, end_minute]``. Blocking.

    Minutes of the day (0..1439); ``start_minute > end_minute`` wraps
    midnight. Sorted by ``(ts, id)``. ``ValueError`` for an out-of-range minute.
    """
    ranges = _clock_ranges(start_minute, end_minute)
    with mi.row_reads(), contextlib.closing(mi._connect()) as c:
        return _clock_facts(c, service_data_dir, member_dir, ranges)


def facts_at_clock_rooms(
    service_data_dir: Path,
    member_dirs: Sequence[Path],
    start_minute: int,
    end_minute: int,
) -> dict[Path, list[Fact]]:
    """:func:`facts_at_clock` for several rooms over one connection. Blocking."""
    ranges = _clock_ranges(start_minute, end_minute)
    with mi.row_reads(), contextlib.closing(mi._connect()) as c:
        return {d: _clock_facts(c, service_data_dir, d, ranges) for d in member_dirs}


async def _fresh_index(
    service_data_dir: Path, member_dir: Path
) -> mi.MemberIndex | None:
    """The room's index after the freshness check, or ``None`` when unavailable."""
    idx = await mi.get_member_index(service_data_dir, member_dir)
    if not idx.data_hash:  # the index could not be built (already logged)
        logger.info("memory_facts_unavailable", member_id=idx.member_id)
        return None
    if idx.cache_stale:
        logger.warning("memory_facts_stale", member_id=idx.member_id)
    return idx


async def _read(
    idx: mi.MemberIndex, fn: Callable[..., list[Fact]], *args: Any, **kwargs: Any
) -> list[Fact]:
    """Run a blocking fact query in a worker; ``[]`` (logged) when it fails."""
    try:
        facts = await asyncio.to_thread(fn, *args, **kwargs)
    except Exception as e:  # noqa: BLE001 - a cache read must never raise
        logger.warning(
            "memory_facts_read_failed",
            member_id=idx.member_id,
            error_type=type(e).__name__,
        )
        return []
    logger.debug("memory_facts_read", member_id=idx.member_id, count=len(facts))
    return facts


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
    idx = await _fresh_index(service_data_dir, member_dir)
    if idx is None:
        return []
    type_list = list(types) if types is not None else None
    return await _read(
        idx,
        facts_in_range,
        service_data_dir,
        member_dir,
        start,
        end,
        types=type_list,
        include_promo=include_promo,
        until=until,
    )


async def get_facts_on(
    service_data_dir: Path,
    member_dir: Path,
    *,
    day: date | None = None,
    month_day: str | None = None,
) -> list[Fact]:
    """Fresh facts of one room on one JST ``day`` or on ``month_day`` in every year.

    Exactly one of ``day`` / ``month_day`` (``MM-DD``) must be given, else
    ``ValueError``. ``[]`` when the index is unavailable or the read fails.
    """
    if (day is None) == (month_day is None):
        raise ValueError("pass exactly one of day or month_day")
    idx = await _fresh_index(service_data_dir, member_dir)
    if idx is None:
        return []
    if day is not None:
        return await _read(idx, facts_for_date, service_data_dir, member_dir, day)
    return await _read(idx, facts_on_month_day, service_data_dir, member_dir, month_day)


async def get_facts_at_clock(
    service_data_dir: Path, member_dir: Path, start_minute: int, end_minute: int
) -> list[Fact]:
    """Fresh facts of one room at a JST time of day (see :func:`facts_at_clock`).

    ``[]`` when the index is unavailable or the read fails.
    """
    idx = await _fresh_index(service_data_dir, member_dir)
    if idx is None:
        return []
    return await _read(
        idx, facts_at_clock, service_data_dir, member_dir, start_minute, end_minute
    )


# (index db, service dir, room) -> (messages.json (mtime_ns, size), checked at)
_clock_fresh: dict[tuple[str, str, str], tuple[tuple[int, int], float]] = {}
CLOCK_FRESH_TTL_S = 600.0
_CLOCK_FRESH_MAX = 4096


def _messages_sigs(member_dirs: Sequence[Path]) -> list[tuple[int, int] | None]:
    """``(mtime_ns, size)`` of each room's ``messages.json``; ``None`` if unreadable."""
    out: list[tuple[int, int] | None] = []
    for d in member_dirs:
        try:
            st = (d / "messages.json").stat()
        except OSError:
            out.append(None)
        else:
            out.append((st.st_mtime_ns, st.st_size))
    return out


async def get_rooms_facts_at_clock(
    service_data_dir: Path,
    member_dirs: Sequence[Path],
    start_minute: int,
    end_minute: int,
) -> dict[Path, list[Fact]]:
    """Fresh clock facts of several rooms (同じ時刻's per-minute read).

    Like :func:`get_facts_at_clock` per room, but cheap enough to run every
    minute: a room whose ``messages.json`` size + mtime are unchanged since
    its last successful freshness check (within :data:`CLOCK_FRESH_TTL_S`)
    skips the check, and every room is then read over one connection. The
    rows of a clock query depend only on ``messages.json`` and the derivation
    rules (fixed per process), so an unchanged file means unchanged rows.
    Rooms whose index is unavailable are left out. ``{}`` (logged) when the
    read fails. ``ValueError`` for an out-of-range minute.
    """
    _clock_ranges(start_minute, end_minute)  # validate before any I/O
    sigs = await asyncio.to_thread(_messages_sigs, member_dirs)
    db = str(mi._path())
    now = time.monotonic()
    ready: list[Path] = []
    checked = 0
    for d, sig in zip(member_dirs, sigs):
        key = (db, str(service_data_dir), str(d))
        seen = _clock_fresh.get(key)
        if sig is not None and seen is not None and seen[0] == sig:
            if now - seen[1] < CLOCK_FRESH_TTL_S:
                ready.append(d)
                continue
        checked += 1
        idx = await _fresh_index(service_data_dir, d)
        if idx is None:
            _clock_fresh.pop(key, None)
            continue
        if sig is not None and not idx.cache_stale:
            if len(_clock_fresh) >= _CLOCK_FRESH_MAX:
                _clock_fresh.clear()
            _clock_fresh[key] = (sig, now)
        ready.append(d)
    try:
        out = await asyncio.to_thread(
            facts_at_clock_rooms, service_data_dir, ready, start_minute, end_minute
        )
    except Exception as e:  # noqa: BLE001 - a cache read must never raise
        logger.warning(
            "memory_facts_read_failed", rooms=len(ready), error_type=type(e).__name__
        )
        return {}
    logger.debug(
        "memory_facts_read",
        rooms=len(ready),
        checked=checked,
        count=sum(len(v) for v in out.values()),
    )
    return out


async def get_person_facts(
    service_data_dir: Path,
    summary: mi.MemberSummary,
    start: date | None = None,
    end: date | None = None,
    *,
    types: Iterable[str] | None = None,
) -> list[tuple[str, Fact]]:
    """Facts of every 1:1 room of one person, ``(member_dir, fact)``, by ``(ts, id)``.

    ``member_dir`` is the relative POSIX string from ``summary.member_dirs``;
    resolve it with ``service_data_dir / member_dir`` for :func:`load_texts`.
    The memory index is per room, so the key of a fact is ``(member_dir, id)``.
    The ids themselves are unique per service: the official API addresses a
    message by id alone (pysaka ``/messages/{id}/favorite``) and the chat's
    favourite toggle sends only ``(service, id)``, so a per-service lookup
    by id (e.g. ``app_state.favorited_at``) is valid.
    The rows are read and sorted off the event loop. ``start`` / ``end`` /
    ``types`` narrow the query as in :func:`get_facts` (a view that needs one
    month or only media reads only those rows).
    """
    tagged: list[tuple[str, Fact]] = []
    for rel in summary.member_dirs:
        facts = await get_facts(
            service_data_dir, service_data_dir / rel, start, end, types=types
        )
        tagged.extend((rel, f) for f in facts)
    return await asyncio.to_thread(_sorted_tagged, tagged)


def _sorted_tagged(tagged: list[tuple[str, Fact]]) -> list[tuple[str, Fact]]:
    """Sort by ``(ts, id, member_dir)``. Blocking; run in a worker thread."""
    tagged.sort(key=lambda t: (t[1].ts, t[1].id, t[0]))
    return tagged


# --- pure helpers -----------------------------------------------------------


def select(
    facts: Iterable[Fact],
    *,
    types: Iterable[str] | None = None,
    include_promo: bool = False,
    include_welcome: bool = False,
    nickname: bool | None = None,
    greeting: str | None = None,
    favorited: bool | None = None,
    hours: Iterable[int] | None = None,
    start: date | None = None,
    end: date | None = None,
) -> list[Fact]:
    """Filter a fact list.

    Promo is EXCLUDED unless ``include_promo``; the subscription welcome is
    EXCLUDED unless ``include_welcome`` (it is never her words).
    """
    type_set = set(types) if types is not None else None
    hour_set = set(hours) if hours is not None else None
    bit = GREETING_BITS[greeting] if greeting is not None else 0
    out = []
    for f in facts:
        if f.is_promo and not include_promo:
            continue
        if f.is_welcome and not include_welcome:
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
    """First and last fact after :func:`select` filtering (input must be sorted).

    The subscription welcome is never first or last.
    """
    picked = select(facts, types=types, include_promo=include_promo)
    return (picked[0], picked[-1]) if picked else (None, None)


# 元旦 midnight: 1/1 JST, 00:00 up to (not including) this minute.
NEW_YEAR_MIDNIGHT_MINUTES = 30


def is_new_year_midnight(f: Fact) -> bool:
    """Sent on January 1 (JST) before 00:30: the 元旦 message of the recap's
    S01 and the binder's ``special.newyear``."""
    return (
        (f.jst_date.month, f.jst_date.day) == (1, 1)
        and f.hour == 0
        and f.minute < NEW_YEAR_MIDNIGHT_MINUTES
    )


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
    """Counts over a fact list. ``nonpromo_*`` / ``hour_hist`` / greetings exclude promo.

    The subscription welcome counts as a message (``total``, ``counts``,
    ``nonpromo_counts``, ``hour_hist``) but never as her words: it is left out
    of ``nickname_count``, ``greeting_counts``, ``first`` and ``last``.
    """

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
    first: Fact | None = None  # first non-promo, non-welcome
    last: Fact | None = None  # last non-promo, non-welcome

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
        nick += f.has_nickname and not f.is_welcome
        favs += f.favorited
        if f.type == "voice":
            voices += 1
            seconds += f.duration_s or 0.0
        if f.is_promo:
            continue
        nonpromo[f.type] += 1
        hist[f.hour] += 1
        if f.burst_id is not None and f.type in ("picture", "video"):
            in_bursts += 1
        if f.is_welcome:
            continue
        greetings.update(classes_from_mask(f.greeting_mask))
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
