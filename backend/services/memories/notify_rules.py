"""Pure JST schedule rules of the Memories notifications (spec 15, 9.3).

Decides which occasions are due on a JST day and when each one's window
opens. Every date and time-of-day here is Asia/Tokyo (``selection.JST``),
whatever the machine's zone; JST has no DST, so a JST slot is a fixed UTC
instant. The module is pure: no I/O, no logging and no clock. Every function
takes ``now`` (aware) or ``today`` (a JST date).

Windows (half-open, aware UTC):

- a date-bound occasion runs from its fire time to the next JST midnight, so a
  missed notification catches up later the same JST day and never on a later
  day ("today" copy is only true that day);
- the birthday day-of fires at 00:00; every other date kind (On This Day, the
  7-day and 1-day reminders, anniversaries and milestones, recap open on Dec 1
  and the Christmas stub on Dec 25) at the configurable daily slot;
- the exception is the recap ``ready`` notice: Jan 1 00:00 to Feb 1 00:00 JST,
  so the first launch after Jan 1 sends it.

Date maths is reused, never re-implemented: birthdays go through
``cards.parse_birthday`` and ``cards.on_year`` (Feb 29 becomes Feb 28 in a
non-leap year, the same rule as the hub countdown); the recap days are
``selection.RECAP_OPEN_MD`` / ``RECAP_CHRISTMAS_MD``; anniversaries and day
milestones use ``cards.anniversary_date`` / ``cards.subscription_day_date``,
so they match the binder and the hub countdown. Card unlocks diff
``cards.earned_keys`` keys (``key@year`` per stacked year), never dates.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from backend.services.memories.cards import (
    Card,
    anniversary_date,
    on_year,
    parse_birthday,
    subscription_day_date,
)
from backend.services.memories.selection import (
    JST,
    RECAP_CHRISTMAS_MD,
    RECAP_OPEN_MD,
    jst,
)

KINDS = ("on_this_day", "birthday", "birthday_soon", "anniversary", "recap", "card")
SETTING_FOR_KIND: Mapping[str, str] = {
    "on_this_day": "memories_notify_on_this_day",
    "birthday": "memories_notify_birthday",
    "birthday_soon": "memories_notify_birthday",
    "anniversary": "memories_notify_anniversary",
    "recap": "memories_notify_recap",
    "card": "memories_notify_cards",
}
DEFAULT_SLOT = time(12, 0)
REMINDER_DAYS = (7, 1)
DAY_MILESTONES = (100, 500, 1000)
RECAP_READY_LAST = (
    1,
    31,
)  # Jan 31 is the last day of the "first launch after 1/1" window
FOIL_NOTIFY_EXCLUDED = frozenset({"grad.last"})

_MIDNIGHT = time(0, 0)
_SLOT_RE = re.compile(r"([01][0-9]|2[0-3]):([0-5][0-9])", re.ASCII)


@dataclass(frozen=True)
class Window:
    start: datetime  # aware UTC
    end: datetime  # aware UTC, exclusive


@dataclass(frozen=True)
class Occasion:
    kind: str
    service: str  # "*" for on_this_day
    subject: str
    occasion: str
    window: Window
    day: date  # the JST date the copy is about (birthday date, anniversary date, ...)
    number: (
        int | None
    )  # the one number (days left, N, recap year); None when content fills it


# --- JST basics -----------------------------------------------------------------


def parse_slot(raw: object) -> time:
    """``"HH:MM"`` (00:00-23:59) to a time; anything else is :data:`DEFAULT_SLOT`."""
    if not isinstance(raw, str):
        return DEFAULT_SLOT
    m = _SLOT_RE.fullmatch(raw)
    if m is None:
        return DEFAULT_SLOT
    return time(int(m.group(1)), int(m.group(2)))


def jst_today(now: datetime) -> date:
    """The JST date of the aware instant ``now``; naive input raises ``ValueError``."""
    return jst(now).date()


def at_jst(day: date, t: time) -> datetime:
    """The aware UTC instant of ``day`` at wall-clock ``t`` in JST."""
    return datetime.combine(day, t, tzinfo=JST).astimezone(timezone.utc)


def day_window(day: date, t: time) -> Window:
    """``[day t JST, next JST midnight)``."""
    return Window(at_jst(day, t), at_jst(day + timedelta(days=1), _MIDNIGHT))


def is_open(w: Window, now: datetime) -> bool:
    """``start <= now < end``."""
    return w.start <= now < w.end


def next_wake(now: datetime, slot: time, max_sleep_s: float) -> float:
    """Seconds until the earliest of today's slot (if still ahead), the next JST
    midnight and ``now + max_sleep_s``; never below 1."""
    today = jst_today(now)
    targets = [at_jst(today + timedelta(days=1), _MIDNIGHT)]
    slot_at = at_jst(today, slot)
    if slot_at > now:
        targets.append(slot_at)
    seconds = min((t - now).total_seconds() for t in targets)
    return max(1.0, min(seconds, max_sleep_s))


# --- birthdays ------------------------------------------------------------------


def birthday_date(raw: str | None, year: int) -> date | None:
    """Her birthday in ``year`` (``MM-DD`` / ``YYYY-MM-DD``); Feb 29 is Feb 28
    in a non-leap year. ``None`` when ``raw`` is not a valid birthday."""
    md = parse_birthday(raw)
    return on_year(md, year) if md is not None else None


def birthday_occasions(
    service: str, member_id: str, raw: str | None, today: date, slot: time
) -> list[Occasion]:
    """``birthday`` when ``today`` is her birthday (00:00 window); ``birthday_soon``
    when it is 7 or 1 days away (slot window, also across New Year). ``number``
    is the days left for ``birthday_soon`` and ``None`` for the day-of."""
    out: list[Occasion] = []
    if birthday_date(raw, today.year) == today:
        out.append(
            Occasion(
                "birthday",
                service,
                member_id,
                today.isoformat(),
                day_window(today, _MIDNIGHT),
                today,
                None,
            )
        )
    for days in REMINDER_DAYS:
        target = today + timedelta(days=days)
        if birthday_date(raw, target.year) == target:
            out.append(
                Occasion(
                    "birthday_soon",
                    service,
                    member_id,
                    f"{target.isoformat()}:{days}",
                    day_window(today, slot),
                    target,
                    days,
                )
            )
    return out


# --- subscription anniversaries -----------------------------------------------------


def anniversary_occasions(
    service: str, member_id: str, start: date | None, today: date, slot: time
) -> list[Occasion]:
    """``y<N>`` when ``today`` is the N-th anniversary (N >= 1) of ``start``;
    ``d<N>`` when it is subscription day N for N in :data:`DAY_MILESTONES`
    (day 1 is ``start``). ``number`` is N."""
    if start is None:
        return []
    found: list[tuple[str, int]] = []
    years = today.year - start.year
    if years >= 1 and anniversary_date(start, years) == today:
        found.append(("y", years))
    found.extend(
        ("d", n) for n in DAY_MILESTONES if subscription_day_date(start, n) == today
    )
    window = day_window(today, slot)
    return [
        Occasion(
            "anniversary",
            service,
            member_id,
            f"{prefix}{n}@{today.isoformat()}",
            window,
            today,
            n,
        )
        for prefix, n in found
    ]


# --- recap ------------------------------------------------------------------------


def recap_occasions(service: str, today: date, slot: time) -> list[Occasion]:
    """Dec 1: ``open`` (this year); Dec 25: ``christmas`` (this year); Jan 1-31:
    ``ready`` (last year, window Jan 1 00:00 to Feb 1 00:00 JST)."""
    md = (today.month, today.day)
    if md in (RECAP_OPEN_MD, RECAP_CHRISTMAS_MD):
        subject = "open" if md == RECAP_OPEN_MD else "christmas"
        return [
            Occasion(
                "recap",
                service,
                subject,
                str(today.year),
                day_window(today, slot),
                today,
                today.year,
            )
        ]
    if today.month == RECAP_READY_LAST[0] and today.day <= RECAP_READY_LAST[1]:
        first = date(today.year, 1, 1)
        last = date(today.year, *RECAP_READY_LAST)
        window = Window(at_jst(first, _MIDNIGHT), day_window(last, _MIDNIGHT).end)
        year = today.year - 1
        return [Occasion("recap", service, "ready", str(year), window, first, year)]
    return []


# --- on this day --------------------------------------------------------------------


def on_this_day_occasion(today: date, slot: time) -> Occasion:
    """The one daily On This Day occasion across all services."""
    return Occasion(
        "on_this_day", "*", "", today.isoformat(), day_window(today, slot), today, None
    )


# --- cards ------------------------------------------------------------------------


def base_key(key: str) -> str:
    """``"special.birthday@2026"`` -> ``"special.birthday"``."""
    return key.split("@", 1)[0]


def log_card_code(key: str) -> str:
    """A log-safe card code: ``"special.birthday@2026"`` -> ``"special_birthday_2026"``."""
    return key.replace(".", "_").replace("@", "_")


def notifiable_foil(cards: Iterable[Card]) -> frozenset[str]:
    """Base keys of the foil cards, minus :data:`FOIL_NOTIFY_EXCLUDED`."""
    return frozenset(c.key for c in cards if c.foil) - FOIL_NOTIFY_EXCLUDED


def new_foil_keys(
    previous: frozenset[str], current: frozenset[str], foil: frozenset[str]
) -> dict[str, str]:
    """``{base key: occasion key}`` of the newly earned notifiable foil cards.

    The occasion key is the newest ``@year`` key when one is new, else the base
    key. Keys are diffed, never dates; :data:`FOIL_NOTIFY_EXCLUDED` never
    notifies, even when ``foil`` contains it.
    """
    allowed = foil - FOIL_NOTIFY_EXCLUDED
    out: dict[str, str] = {}
    for key in sorted(current - previous, key=_year_order):
        base = base_key(key)
        if base not in allowed:
            continue
        if "@" in key or base not in out:
            out[base] = key  # sorted: a later (newer) year key wins
    return out


def _year_order(key: str) -> tuple[str, int]:
    base, _, year = key.partition("@")
    return base, int(year) if year.isdigit() else -1


__all__ = [
    "DAY_MILESTONES",
    "DEFAULT_SLOT",
    "FOIL_NOTIFY_EXCLUDED",
    "KINDS",
    "RECAP_READY_LAST",
    "REMINDER_DAYS",
    "SETTING_FOR_KIND",
    "Occasion",
    "Window",
    "anniversary_occasions",
    "at_jst",
    "base_key",
    "birthday_date",
    "birthday_occasions",
    "day_window",
    "is_open",
    "jst_today",
    "log_card_code",
    "new_foil_keys",
    "next_wake",
    "notifiable_foil",
    "on_this_day_occasion",
    "parse_slot",
    "recap_occasions",
]
