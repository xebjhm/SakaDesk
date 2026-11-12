"""Photocard binder rules (spec 5.3): pure, no I/O, no logging.

:func:`evaluate` turns one person's facts (``facts.get_person_facts``) and a
few side inputs into the binder's cards, in :data:`SHELVES` order and then
catalogue order. The binder service (``binder.py``) renders them; the M4
notifications wave diffs :func:`earned_keys` between two evaluations
(card keys plus ``<key>@<year>`` for every year of a yearly stack).

Vocabulary used by the rules:

- *words*: a non-promo fact with ``importance is not None``;
- *best of a day*: the highest-importance words that day (ties: the earlier),
  else the first non-promo fact that day, else the first fact that day;
- *nearest*: the non-promo fact closest in time to 12:00 JST of a date (ties:
  the earlier).

Promo: every 瞬間 (``moment.*``) card and the greeting pair exclude promo;
the count (数字) cards and the 初めて cards count every message. Every
tie-break goes to the earlier fact or day. Filters use ``facts.select``.

Welcome: the automatic greeting a room sends when the fan subscribes
(``Fact.is_welcome``) is never a card's face or ref, on any shelf. Counts
(messages, the busiest day's count, a change card's
``messages``) still include it; nickname counts do not (it is not her calling
the fan's name). ``first.message`` is therefore her first self-written
message.

元旦 (``special.newyear``): per year, her messages on January 1 JST; the
first one before 00:30 (``facts.is_new_year_midnight``, the recap S01 rule),
else the best of that day. A year with no 1/1 message has no entry.

加入紀念日 (``special.join_day``): the subscription start day. Its face is the
best of her own (non-welcome) messages that day, or none (the label alone).
Hidden without a known start; a silhouette while the start is in the future.

A card whose condition is not met is either returned with ``earned=False``
(a silhouette) or, for the cards the catalogue marks *hidden*, left out of the
result and of :func:`progress_summary`. An unearned card's ``progress`` is
``None`` instead of a current value of 0, so the UI shows only the condition
(spec 1.1: never render "0"). :func:`evaluate_counted` also returns
how many cards were hidden, for the binder's breadcrumb.

Cards carry message keys, dates and counts only, never text. The fan's
letters appear only on the あなた shelf (``letter``) and are never paired
with her messages; subscription dates are the fan's own dates.

``Card.fallback`` names the fallback used for the face (``nearest``,
``first_after`` or ``best_of_day``), or ``None`` when the preferred rule
found it; ``CardYear.fallback`` does the same for each year of a stack (the
card's own is the newest year's). The binder logs both.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Any

from backend.services.memories.facts import Fact, is_new_year_midnight, select
from backend.services.memories.selection import JST

SHELVES = (
    "first",
    "anniversary",
    "numbers",
    "special",
    "records",
    "moments",
    "you",
    "change",
    "graduation",
)

# Bump on any rule or payload change: the binder's cache hash includes it, so
# a shipped rule change never keeps serving binders built by the old rules.
CARDS_VERSION = 7

FALLBACK_NEAREST = "nearest"
FALLBACK_FIRST_AFTER = "first_after"
FALLBACK_BEST_OF_DAY = "best_of_day"

# Fixed anniversary slots in date order: (key, kind, n). ``d`` = subscription
# day n, ``y`` = n-th anniversary.
_ANNIV_FIXED = (
    ("anniv.d100", "d", 100),
    ("anniv.y1", "y", 1),
    ("anniv.d500", "d", 500),
    ("anniv.y2", "y", 2),
    ("anniv.d1000", "d", 1000),
    ("anniv.y3", "y", 3),
    ("anniv.y4", "y", 4),
    ("anniv.y5", "y", 5),
)
_MESSAGE_COUNTS = (100, 1000, 5000, 10000)
_PICTURE_COUNTS = (100, 1000)
_VOICE_HOUR_S = 3600
_NICKNAME_COUNT = 100
_LETTER_COUNTS = (1, 10, 50)
_HIDDEN_RECORDS = 5  # longest, busiest day, nickname day, longest voice, pair
_BIRTHDAY_RE = re.compile(r"^(?:\d{4}-)?(\d{2})-(\d{2})$")


@dataclass(frozen=True)
class MessageKey:
    """A message across rooms: ids are per room."""

    room: str
    id: int


@dataclass(frozen=True)
class AvatarChange:
    """A real change of her chat icon (not the first archived icon)."""

    changed_at: datetime  # aware UTC (first_seen of the new image)
    old_url: str | None
    new_url: str


@dataclass(frozen=True)
class CardInputs:
    facts: Sequence[tuple[str, Fact]]  # get_person_facts output, sorted
    today: date  # JST
    subscription_start: date | None
    birthday: str | None  # "MM-DD" or "YYYY-MM-DD"
    graduated: bool
    letters: Sequence[tuple[str, int, date]]  # people.letters_of
    avatar_changes: Sequence[AvatarChange]
    keyword_hits: Mapping[MessageKey, frozenset[str]] = field(default_factory=dict)


@dataclass(frozen=True)
class CardYear:
    year: int
    date: date
    message: MessageKey
    fallback: str | None = None  # this year's face fallback, like Card.fallback


@dataclass(frozen=True)
class Card:
    key: str
    shelf: str
    earned: bool
    foil: bool = False
    rare: bool = False
    date: date | None = None  # unlock date (JST)
    message: MessageKey | None = None  # face / detail anchor
    refs: Mapping[str, MessageKey] = field(default_factory=dict)
    progress: tuple[int, int] | None = None  # (current, target); None at 0
    years: tuple[CardYear, ...] = ()  # yearly stacks, oldest first
    detail: Mapping[str, int | str] = field(default_factory=dict)
    letter: tuple[str, int] | None = None  # (room, letter_id)
    fallback: str | None = None  # see the module docstring


# --- public helpers ----------------------------------------------------------------


def subscription_day_date(start: date, n: int) -> date:
    """Date of subscription day ``n``: day 1 is ``start``."""
    return start + timedelta(days=n - 1)


def anniversary_date(start: date, years: int) -> date:
    """``start`` plus ``years`` years, same month-day; Feb 29 becomes Feb 28."""
    return _safe_date(start.year + years, start.month, start.day)


def on_year(month_day: tuple[int, int] | date, year: int) -> date:
    """The ``(month, day)`` (or a date's month-day) in ``year``; Feb 29 is Feb 28
    in a non-leap year. The one rule for a birthday or a month-day in a year."""
    if isinstance(month_day, date):
        month_day = (month_day.month, month_day.day)
    return _safe_date(year, *month_day)


def earned_keys(cards: Iterable[Card]) -> frozenset[str]:
    """Keys of the earned cards plus one ``<key>@<year>`` per stacked year.

    M4: newly earned = now - previous. A yearly stack (``special.*``) is
    earned once, so its card key alone cannot show a newly gained year; the
    per-year keys can, e.g. ``special.birthday`` and ``special.birthday@2026``.
    """
    out: set[str] = set()
    for card in cards:
        if card.earned:
            out.add(card.key)
            out.update(f"{card.key}@{y.year}" for y in card.years)
    return frozenset(out)


def progress_summary(cards: Iterable[Card]) -> tuple[int, int]:
    """``(earned, total)`` over the returned (non-hidden) cards."""
    listed = list(cards)
    return sum(card.earned for card in listed), len(listed)


# --- shared rules -----------------------------------------------------------------------

_Tagged = tuple[str, Fact]
_YearPick = tuple[int, _Tagged, str | None]  # (year, face, fallback)


def _safe_date(year: int, month: int, day: int) -> date:
    try:
        return date(year, month, day)
    except ValueError:  # Feb 29 in a non-leap year
        return date(year, month, 28)


def _progress(current: int, target: int) -> tuple[int, int] | None:
    """``(current, target)``, or ``None`` at 0: the UI never shows "0" (spec 1.1)."""
    return (current, target) if current > 0 else None


def _mk(t: _Tagged) -> MessageKey:
    return MessageKey(t[0], t[1].id)


def _is_words(f: Fact) -> bool:
    return not f.is_promo and f.importance is not None


def _best(day_facts: Sequence[_Tagged]) -> _Tagged:
    """Best of a day (see the module docstring); ``day_facts`` must not be empty."""
    best: _Tagged | None = None
    best_imp = 0
    for t in day_facts:
        imp = t[1].importance
        if not t[1].is_promo and imp is not None and (best is None or imp > best_imp):
            best, best_imp = t, imp
    if best is not None:
        return best
    return next((t for t in day_facts if not t[1].is_promo), day_facts[0])


def _best_of(day_facts: Sequence[_Tagged]) -> _Tagged | None:
    """:func:`_best`, or ``None`` for no facts."""
    return _best(day_facts) if day_facts else None


def _nearest(tagged: Sequence[_Tagged], day: date) -> _Tagged | None:
    """The non-promo fact closest to 12:00 JST of ``day`` (ties: the earlier)."""
    noon = datetime.combine(day, time(12), tzinfo=JST)
    best: _Tagged | None = None
    best_gap: timedelta | None = None
    for t in tagged:
        if t[1].is_promo:
            continue
        gap = abs(t[1].ts - noon)
        if best_gap is None or gap < best_gap:
            best, best_gap = t, gap
    return best


def _select(tagged: Sequence[_Tagged], **filters: Any) -> list[_Tagged]:
    """:func:`facts.select` over tagged facts, keeping each fact's room.

    Same filters and the same defaults: promo is excluded unless
    ``include_promo=True``, the welcome unless ``include_welcome=True``.
    """
    keep = {id(f) for f in select((t[1] for t in tagged), **filters)}
    return [t for t in tagged if id(t[1]) in keep]


def _by_day(tagged: Sequence[_Tagged]) -> dict[date, list[_Tagged]]:
    out: dict[date, list[_Tagged]] = {}
    for t in tagged:
        out.setdefault(t[1].jst_date, []).append(t)
    return out


def _earned_at(
    key: str,
    shelf: str,
    t: _Tagged,
    *,
    foil: bool = False,
    rare: bool = False,
    refs: Mapping[str, MessageKey] | None = None,
    detail: Mapping[str, int | str] | None = None,
) -> Card:
    """An earned card whose face is ``t``, unlocked on its JST date."""
    return Card(
        key,
        shelf,
        True,
        foil=foil,
        rare=rare,
        date=t[1].jst_date,
        message=_mk(t),
        refs=refs or {},
        detail=detail or {},
    )


def _nth(
    key: str, shelf: str, items: Sequence[_Tagged], n: int, *, foil: bool = False
) -> Card:
    """Earned on the ``n``-th item, else a silhouette with ``(count, n)``."""
    if len(items) >= n:
        return _earned_at(key, shelf, items[n - 1], foil=foil)
    return Card(key, shelf, False, foil=foil, progress=_progress(len(items), n))


def _first(
    key: str, shelf: str, items: Sequence[_Tagged], *, foil: bool = False
) -> Card:
    """Earned on the first item, else a silhouette (no progress)."""
    if items:
        return _earned_at(key, shelf, items[0], foil=foil)
    return Card(key, shelf, False, foil=foil)


# --- shelves ------------------------------------------------------------------------------


def _first_cards(faces: Sequence[_Tagged]) -> list[Card]:
    """``faces`` = every fact but the welcome, so ``first.message`` is her
    first self-written message (promo included)."""
    out = [_first("first.message", "first", faces)]
    for kind in ("picture", "video", "voice"):
        items = _select(faces, types={kind}, include_promo=True)
        out.append(_first(f"first.{kind}", "first", items))
    nick = _select(faces, nickname=True, include_promo=True)
    out.append(_first("first.nickname", "first", nick, foil=True))
    return out


def _anniv_target(start: date, kind: str, n: int) -> date:
    return (
        subscription_day_date(start, n) if kind == "d" else anniversary_date(start, n)
    )


def _anniversary_cards(
    tagged: Sequence[_Tagged], days: Mapping[date, list[_Tagged]], inp: CardInputs
) -> tuple[list[Card], int]:
    start = inp.subscription_start
    if start is None:
        return [], len(_ANNIV_FIXED)
    slots = list(_ANNIV_FIXED)
    year = 6
    while True:
        slots.append((f"anniv.y{year}", "y", year))
        if anniversary_date(start, year) > inp.today:
            break  # the next unreached year is the last slot
        year += 1
    day_no = max((inp.today - start).days + 1, 0)
    out = []
    for key, kind, n in slots:
        when = _anniv_target(start, kind, n)
        if when > inp.today:
            target = (when - start).days + 1
            out.append(
                Card(
                    key,
                    "anniversary",
                    False,
                    progress=_progress(min(day_no, target), target),
                )
            )
            continue
        face = _best_of(days.get(when, []))
        fallback = None
        if face is None:
            face = _nearest(tagged, when)
            fallback = FALLBACK_NEAREST if face is not None else None
        out.append(
            Card(
                key,
                "anniversary",
                True,
                date=when,
                message=_mk(face) if face is not None else None,
                fallback=fallback,
            )
        )
    if anniversary_date(start, 5) > inp.today:
        out = out[: len(_ANNIV_FIXED)]  # y6 appears once y5 is reached
    return out, 0


def _voice_hour_card(tagged: Sequence[_Tagged]) -> tuple[list[Card], int]:
    voices = _select(tagged, types={"voice"}, include_promo=True)
    if not voices:
        return [], 1
    total = 0.0
    for t in voices:
        total += t[1].duration_s or 0.0
        if total >= _VOICE_HOUR_S:
            return [_earned_at("count.voice_hour", "numbers", t)], 0
    progress = _progress(int(total), _VOICE_HOUR_S)
    return [Card("count.voice_hour", "numbers", False, progress=progress)], 0


def _number_cards(tagged: Sequence[_Tagged]) -> tuple[list[Card], int]:
    out = [
        _nth(f"count.messages.{n}", "numbers", tagged, n, foil=n == 10000)
        for n in _MESSAGE_COUNTS
    ]
    pictures = _select(tagged, types={"picture"}, include_promo=True)
    out += [
        _nth(f"count.pictures.{n}", "numbers", pictures, n) for n in _PICTURE_COUNTS
    ]
    voice, hidden = _voice_hour_card(tagged)
    out += voice
    nick = _select(tagged, nickname=True, include_promo=True)
    if nick:
        out.append(_nth("count.nicknames.100", "numbers", nick, _NICKNAME_COUNT))
    else:
        hidden += 1
    return out, hidden


def _yearly(
    key: str,
    years: Sequence[tuple[int, _Tagged, str | None]],
    *,
    foil: bool = False,
) -> Card:
    """A yearly stack from ``(year, face, fallback)``, oldest first."""
    if not years:
        return Card(key, "special", False, foil=foil)
    stack = tuple(CardYear(y, t[1].jst_date, _mk(t), fb) for y, t, fb in years)
    _, newest, fallback = years[-1]
    return Card(
        key,
        "special",
        True,
        foil=foil,
        date=newest[1].jst_date,
        message=_mk(newest),
        years=stack,
        fallback=fallback,
    )


def _keyword_or_best(
    facts: Sequence[_Tagged], word: str, hits: Mapping[MessageKey, frozenset[str]]
) -> tuple[_Tagged, str | None] | None:
    matched = [t for t in facts if word in hits.get(_mk(t), frozenset())]
    if matched:
        return _best(matched), None
    best = _best_of(facts)
    return (best, FALLBACK_BEST_OF_DAY) if best is not None else None


def parse_birthday(raw: str | None) -> tuple[int, int] | None:
    """``(month, day)`` of an ``MM-DD`` / ``YYYY-MM-DD`` birthday, else ``None``."""
    m = _BIRTHDAY_RE.match(raw or "")
    if m is None:
        return None
    month, day = int(m.group(1)), int(m.group(2))
    try:
        date(2000, month, day)  # a leap year accepts 02-29
    except ValueError:
        return None
    return month, day


def _in_christmas(f: Fact) -> bool:
    md = (f.jst_date.month, f.jst_date.day)
    return md == (12, 25) or (md == (12, 24) and f.hour >= 18)


def _special_cards(
    tagged: Sequence[_Tagged], days: Mapping[date, list[_Tagged]], inp: CardInputs
) -> tuple[list[Card], int]:
    hits = inp.keyword_hits
    by_year: dict[int, list[_Tagged]] = {}
    for t in tagged:
        by_year.setdefault(t[1].jst_date.year, []).append(t)
    years = sorted(by_year)

    newyear: list[_YearPick] = []
    for y in years:
        day_facts = days.get(date(y, 1, 1), [])
        midnight = [
            t for t in day_facts if not t[1].is_promo and is_new_year_midnight(t[1])
        ]
        if midnight:
            newyear.append((y, midnight[0], None))
        elif day_facts:
            newyear.append((y, _best(day_facts), FALLBACK_BEST_OF_DAY))

    valentine: list[_YearPick] = []
    christmas: list[_YearPick] = []
    for y in years:
        pick = _keyword_or_best(days.get(date(y, 2, 14), []), "valentine", hits)
        if pick is not None:
            valentine.append((y, *pick))
        window = [t for t in by_year[y] if _in_christmas(t[1])]
        pick = _keyword_or_best(window, "christmas", hits)
        if pick is not None:
            christmas.append((y, *pick))

    out = [
        _yearly("special.newyear", newyear),
        _yearly("special.valentine", valentine),
        _yearly("special.christmas", christmas),
    ]
    hidden = 0

    bday = parse_birthday(inp.birthday)
    if bday is None:
        hidden += 1
    else:
        stack: list[_YearPick] = []
        for y in years:
            day_facts = days.get(_safe_date(y, *bday), [])
            early = [t for t in day_facts if t[1].hour == 0 and t[1].minute <= 10]
            if early:
                stack.append((y, early[0], None))
            elif day_facts:
                stack.append((y, _best(day_facts), FALLBACK_BEST_OF_DAY))
        out.append(_yearly("special.birthday", stack, foil=True))

    start = inp.subscription_start
    if start is None:
        hidden += 2  # join day + sub anniversary
    else:
        out.append(_join_day_card(start, days, inp.today))
        subs: list[_YearPick] = []
        for y in years:
            if y < start.year + 1:
                continue
            best = _best_of(days.get(anniversary_date(start, y - start.year), []))
            if best is not None:
                subs.append((y, best, None))
        out.append(_yearly("special.sub_anniversary", subs))
    return out, hidden


def _join_day_card(
    start: date, days: Mapping[date, list[_Tagged]], today: date
) -> Card:
    """加入紀念日: the subscription start day; face = the best of her own words
    that day (``days`` holds no welcome), else none (the label alone)."""
    if start > today:
        return Card("special.join_day", "special", False)
    face = _best_of(days.get(start, []))
    return Card(
        "special.join_day",
        "special",
        True,
        date=start,
        message=_mk(face) if face is not None else None,
    )


def _day_card(
    key: str, shelf: str, day: date, face: _Tagged | None, detail: Mapping[str, int]
) -> Card:
    """An earned card about ``day`` whose face may be missing (a day of
    welcome messages only)."""
    if face is not None:
        return _earned_at(key, shelf, face, detail=detail)
    return Card(key, shelf, True, date=day, detail=detail)


def _clock(f: Fact) -> tuple[int, int, int]:
    local = f.jst
    return local.hour, local.minute, local.second


def _late_clock(f: Fact) -> tuple[int, int, int]:
    """Time of day where 00:00-04:59 count as 24:00-28:59 (after midnight = later)."""
    h, m, s = _clock(f)
    return (h + 24 if h <= 4 else h), m, s


def _max_day(days: Mapping[date, list[_Tagged]]) -> tuple[date, list[_Tagged]] | None:
    """The day with the most facts (ties: the earlier day)."""
    best: tuple[date, list[_Tagged]] | None = None
    for day in sorted(days):
        if best is None or len(days[day]) > len(best[1]):
            best = (day, days[day])
    return best


def _record_cards(
    tagged: Sequence[_Tagged],
    faces: Sequence[_Tagged],
    days: Mapping[date, list[_Tagged]],
    face_days: Mapping[date, list[_Tagged]],
) -> tuple[list[Card], int]:
    """Counts read ``tagged`` / ``days``; faces read ``faces`` / ``face_days``."""
    out: list[Card] = []
    hidden = 0

    # a Q&A post is long but not her heartfelt words
    words = [t for t in faces if _is_words(t[1]) and not t[1].is_qa]
    if words:
        longest = max(words, key=lambda t: t[1].chars)  # max keeps the first
        out.append(
            _earned_at(
                "record.longest", "records", longest, detail={"chars": longest[1].chars}
            )
        )
    else:
        hidden += 1

    busiest = _max_day(days)
    if busiest is not None:
        day, day_facts = busiest
        face = _best_of(face_days.get(day, []))
        out.append(
            _day_card(
                "record.busiest_day", "records", day, face, {"count": len(day_facts)}
            )
        )
    else:
        hidden += 1

    # the day counts every nickname fact (promo included, the welcome not);
    # the face is the best of them, so non-promo words win over promo
    nick_day = _max_day(_by_day(_select(tagged, nickname=True, include_promo=True)))
    if nick_day is not None:
        face = _best(nick_day[1])
        out.append(
            _earned_at(
                "record.nickname_day",
                "records",
                face,
                detail={"count": len(nick_day[1])},
            )
        )
    else:
        hidden += 1

    voices = [
        t
        for t in _select(tagged, types={"voice"}, include_promo=True)
        if t[1].duration_s is not None
    ]
    if voices:
        face = max(voices, key=lambda t: t[1].duration_s or 0.0)
        seconds = round(face[1].duration_s or 0.0)
        out.append(
            _earned_at(
                "record.longest_voice", "records", face, detail={"seconds": seconds}
            )
        )
    else:
        hidden += 1

    ohayo = _select(faces, greeting="ohayo", hours=range(4, 12))
    oyasumi = _select(faces, greeting="oyasumi")
    if ohayo and oyasumi:
        # ties: the earlier fact (min / max keep the first of equal keys)
        early = min(ohayo, key=lambda t: _clock(t[1]))
        late = max(oyasumi, key=lambda t: _late_clock(t[1]))
        out.append(
            _earned_at(
                "record.greeting_pair", "records", early, refs={"pair": _mk(late)}
            )
        )
    else:
        hidden += 1

    return out, hidden


def _synchro(tagged: Sequence[_Tagged]) -> Card:
    """Earliest completed same-clock pair of non-promo facts on different dates."""
    seen: dict[tuple[int, int, int], _Tagged] = {}
    for t in _select(tagged):
        clock = _clock(t[1])
        earlier = seen.get(clock)
        if earlier is None:
            seen[clock] = t
        elif earlier[1].jst_date != t[1].jst_date:
            return _earned_at(
                "moment.synchro",
                "moments",
                t,
                rare=True,
                foil=True,
                refs={"pair": _mk(earlier)},
            )
    return Card("moment.synchro", "moments", False, rare=True, foil=True)


def _moment_cards(tagged: Sequence[_Tagged]) -> list[Card]:
    # every 瞬間 card excludes promo (facts.select's default)
    midnight = [t for t in _select(tagged, hours={0}) if t[1].minute <= 5]
    if midnight:
        out = [
            _earned_at(
                "moment.midnight",
                "moments",
                midnight[0],
                foil=True,
                detail={"count": len(midnight)},
            )
        ]
    else:
        out = [Card("moment.midnight", "moments", False, foil=True)]
    out.append(_synchro(tagged))
    # 第一次說最喜歡 is the first 大好き said to the fan (``daisuki_you``); the
    # 100th keeps counting every 大好き, so "100 times" stays literally true
    for greeting in ("oyasumi", "daisuki"):
        items = _select(tagged, greeting=greeting)
        first_class = "daisuki_you" if greeting == "daisuki" else greeting
        firsts = _select(tagged, greeting=first_class)
        out.append(_first(f"moment.{greeting}.1", "moments", firsts))
        out.append(_nth(f"moment.{greeting}.100", "moments", items, 100))
    return out


def _you_cards(letters: Sequence[tuple[str, int, date]]) -> tuple[list[Card], int]:
    if not letters:
        return [], len(_LETTER_COUNTS)
    out = []
    for n in _LETTER_COUNTS:
        key = f"you.letter.{n}"
        if len(letters) >= n:  # always true for n = 1: letters is non-empty
            room, lid, day = letters[n - 1]
            out.append(Card(key, "you", True, date=day, letter=(room, lid)))
        else:
            out.append(Card(key, "you", False, progress=_progress(len(letters), n)))
    return out, 0


def _change_face(
    after: Sequence[_Tagged], day: date
) -> tuple[_Tagged | None, str | None]:
    """Face of a change card (spec 5.3: the new avatar + her message that day).

    ``after`` = the facts at or after the change. The first non-promo fact on
    the change's JST day; else the first non-promo fact after it, else the
    first fact after it (``first_after``); else ``None``.
    """
    same_day = next(
        (t for t in after if t[1].jst_date == day and not t[1].is_promo), None
    )
    if same_day is not None:
        return same_day, None
    later = next((t for t in after if not t[1].is_promo), after[0] if after else None)
    return later, (FALLBACK_FIRST_AFTER if later is not None else None)


def _change_cards(
    tagged: Sequence[_Tagged], faces: Sequence[_Tagged], inp: CardInputs
) -> list[Card]:
    """``detail.messages`` counts ``tagged``; the face and refs read ``faces``."""
    changes = sorted(inp.avatar_changes, key=lambda ch: ch.changed_at)
    out = []
    used: Counter[str] = Counter()
    for i, ch in enumerate(changes):
        day = ch.changed_at.astimezone(JST).date()
        nxt = changes[i + 1] if i + 1 < len(changes) else None
        before = [t for t in faces if t[1].ts < ch.changed_at]
        after = [t for t in faces if t[1].ts >= ch.changed_at]
        run = [
            t
            for t in tagged
            if t[1].ts >= ch.changed_at and (nxt is None or t[1].ts < nxt.changed_at)
        ]
        face, fallback = _change_face(after, day)
        refs = {}
        if before:
            refs["old_last"] = _mk(before[-1])
        if after:
            refs["new_first"] = _mk(after[0])
        end = nxt.changed_at.astimezone(JST).date() if nxt is not None else None
        span = (end - day).days if end is not None else (inp.today - day).days + 1
        detail: dict[str, int | str] = {"days": max(span, 1), "messages": len(run)}
        if ch.old_url is not None:
            detail["old_url"] = ch.old_url
        detail["new_url"] = ch.new_url
        base = f"change.avatar.{day.isoformat()}"
        used[base] += 1
        key = base if used[base] == 1 else f"{base}.{used[base]}"
        out.append(
            Card(
                key,
                "change",
                True,
                date=day,
                message=_mk(face) if face is not None else None,
                refs=refs,
                detail=detail,
                fallback=fallback,
            )
        )
    return out


def _graduation_cards(
    tagged: Sequence[_Tagged], graduated: bool
) -> tuple[list[Card], int]:
    if graduated and tagged:
        return [_earned_at("grad.last", "graduation", tagged[-1], foil=True)], 0
    return [], 1


# --- evaluate ------------------------------------------------------------------------------


def evaluate_counted(inputs: CardInputs) -> tuple[list[Card], int]:
    """:func:`evaluate` plus the number of hidden cards (left out of the result)."""
    tagged = list(inputs.facts)  # every fact: counts
    faces = [t for t in tagged if not t[1].is_welcome]  # faces and refs
    days = _by_day(tagged)
    face_days = _by_day(faces)
    anniv, h_anniv = _anniversary_cards(faces, face_days, inputs)
    numbers, h_numbers = _number_cards(tagged)
    special, h_special = _special_cards(faces, face_days, inputs)
    records, h_records = _record_cards(tagged, faces, days, face_days)
    you, h_you = _you_cards(inputs.letters)
    grad, h_grad = _graduation_cards(faces, inputs.graduated)
    cards = [
        *_first_cards(faces),
        *anniv,
        *numbers,
        *special,
        *records,
        *_moment_cards(faces),
        *you,
        *_change_cards(tagged, faces, inputs),
        *grad,
    ]
    hidden = h_anniv + h_numbers + h_special + h_records + h_you + h_grad
    return cards, hidden


def evaluate(inputs: CardInputs) -> list[Card]:
    """Every non-hidden card: :data:`SHELVES` order, then catalogue order."""
    return evaluate_counted(inputs)[0]


__all__ = [
    "CARDS_VERSION",
    "SHELVES",
    "AvatarChange",
    "Card",
    "CardInputs",
    "CardYear",
    "MessageKey",
    "anniversary_date",
    "earned_keys",
    "evaluate",
    "evaluate_counted",
    "on_year",
    "parse_birthday",
    "progress_summary",
    "subscription_day_date",
]
