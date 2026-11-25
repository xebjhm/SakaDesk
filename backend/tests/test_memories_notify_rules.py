"""Pure JST schedule rules of the Memories notifications (M4 Task 2)."""

from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
import time_machine

from backend.services.memories import notify_rules as nr
from backend.services.memories.cards import Card
from backend.services.memories.selection import JST

UTC = timezone.utc
NY = ZoneInfo("America/New_York")
LONDON = ZoneInfo("Europe/London")
SLOT = nr.DEFAULT_SLOT


def _now() -> datetime:
    return datetime.now(UTC)


def _kinds(occs: list[nr.Occasion]) -> list[tuple[str, str, str]]:
    return [(o.kind, o.subject, o.occasion) for o in occs]


# --- constants -------------------------------------------------------------------


def test_constants_match_the_contract() -> None:
    assert nr.KINDS == (
        "on_this_day",
        "birthday",
        "birthday_soon",
        "anniversary",
        "recap",
        "card",
    )
    assert set(nr.SETTING_FOR_KIND) == set(nr.KINDS)
    assert nr.SETTING_FOR_KIND["birthday_soon"] == "memories_notify_birthday"
    assert nr.SETTING_FOR_KIND["card"] == "memories_notify_cards"
    assert nr.DEFAULT_SLOT == time(12, 0)
    assert nr.REMINDER_DAYS == (7, 1)
    assert nr.DAY_MILESTONES == (100, 500, 1000)
    assert nr.RECAP_READY_LAST == (1, 31)
    assert nr.FOIL_NOTIFY_EXCLUDED == frozenset({"grad.last"})


# --- slot parsing ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("07:30", time(7, 30)),
        ("00:00", time(0, 0)),
        ("23:59", time(23, 59)),
        ("25:00", SLOT),
        (None, SLOT),
        (730, SLOT),
        ("12:00:00", SLOT),
        ("7:30", SLOT),
        ("", SLOT),
        ("１２:００", SLOT),  # full-width digits are not a valid setting
    ],
)
def test_parse_slot(raw: object, expected: time) -> None:
    assert nr.parse_slot(raw) == expected


# --- JST basics -----------------------------------------------------------------


def test_jst_today_flips_at_jst_midnight() -> None:
    with time_machine.travel(datetime(2026, 3, 15, 15, 0, tzinfo=UTC), tick=False):
        assert nr.jst_today(_now()) == date(2026, 3, 16)
    with time_machine.travel(datetime(2026, 3, 15, 14, 59, 59, tzinfo=UTC), tick=False):
        assert nr.jst_today(_now()) == date(2026, 3, 15)


def test_jst_today_rejects_naive() -> None:
    with pytest.raises(ValueError):
        nr.jst_today(datetime(2026, 3, 15, 12, 0))


def test_at_jst_is_aware_utc() -> None:
    got = nr.at_jst(date(2026, 3, 15), time(12, 0))
    assert got == datetime(2026, 3, 15, 3, 0, tzinfo=UTC)
    assert got.utcoffset() == timedelta(0)


def test_day_window_ends_at_next_jst_midnight() -> None:
    w = nr.day_window(date(2026, 12, 31), SLOT)
    assert w.start == datetime(2026, 12, 31, 3, 0, tzinfo=UTC)
    assert w.end == datetime(2026, 12, 31, 15, 0, tzinfo=UTC)  # 2027-01-01 00:00 JST


def test_midnight_jst_closes_the_day_and_opens_the_birthday() -> None:
    day_15 = nr.day_window(date(2026, 3, 15), SLOT)
    with time_machine.travel(datetime(2026, 3, 15, 23, 59, 59, tzinfo=JST), tick=False):
        now = _now()
        assert nr.is_open(day_15, now)
        # The eve still only has the 1-day reminder, not the day-of.
        assert _kinds(
            nr.birthday_occasions("hinatazaka46", "7", "03-16", nr.jst_today(now), SLOT)
        ) == [("birthday_soon", "7", "2026-03-16:1")]
    with time_machine.travel(datetime(2026, 3, 16, 0, 0, 0, tzinfo=JST), tick=False):
        now = _now()
        assert not nr.is_open(day_15, now)
        occs = nr.birthday_occasions(
            "hinatazaka46", "7", "03-16", nr.jst_today(now), SLOT
        )
        assert _kinds(occs) == [("birthday", "7", "2026-03-16")]
        assert nr.is_open(occs[0].window, now)
        assert occs[0].window.start == nr.at_jst(date(2026, 3, 16), time(0))


def test_is_open_is_half_open() -> None:
    w = nr.day_window(date(2026, 3, 15), SLOT)
    assert nr.is_open(w, w.start)
    assert not nr.is_open(w, w.start - timedelta(microseconds=1))
    assert not nr.is_open(w, w.end)


# --- local zones and DST ----------------------------------------------------------


@pytest.mark.parametrize(
    "local",
    [
        datetime(2026, 11, 1, 0, 30, tzinfo=NY),
        datetime(2026, 11, 1, 1, 30, tzinfo=NY),
        datetime(2026, 11, 1, 1, 30, fold=1, tzinfo=NY),
        datetime(2026, 11, 1, 3, 0, tzinfo=NY),
        datetime(2026, 11, 2, 9, 0, tzinfo=NY),
    ],
)
def test_jst_slot_is_fixed_utc_across_us_dst_end(local: datetime) -> None:
    with time_machine.travel(local, tick=False):
        now = _now()
        assert nr.at_jst(date(2026, 11, 1), SLOT) == datetime(
            2026, 11, 1, 3, 0, tzinfo=UTC
        )
        assert nr.at_jst(date(2026, 11, 2), SLOT) == datetime(
            2026, 11, 2, 3, 0, tzinfo=UTC
        )
        assert nr.jst_today(now) == local.astimezone(JST).date()


def test_next_wake_repeated_new_york_hour_targets_one_instant() -> None:
    first = datetime(2026, 11, 1, 1, 30, fold=0, tzinfo=NY)  # 05:30 UTC (EDT)
    second = datetime(2026, 11, 1, 1, 30, fold=1, tzinfo=NY)  # 06:30 UTC (EST)
    wakes = []
    for local in (first, second):
        with time_machine.travel(local, tick=False):
            now = _now()
            secs = nr.next_wake(now, SLOT, 86400)
            wakes.append(now + timedelta(seconds=secs))
    # Both wake at the next JST midnight (2026-11-02 00:00 JST = 11-01 15:00 UTC).
    target = datetime(2026, 11, 1, 15, 0, tzinfo=UTC)
    assert wakes == [target, target]
    with time_machine.travel(first, tick=False):
        assert nr.next_wake(_now(), SLOT, 86400) == 9.5 * 3600
    with time_machine.travel(second, tick=False):
        assert nr.next_wake(_now(), SLOT, 86400) == 8.5 * 3600


def test_next_wake_london_dst_start_targets_the_jst_slot() -> None:
    before = datetime(2026, 3, 29, 0, 30, tzinfo=LONDON)  # GMT: 00:30 UTC
    after = datetime(2026, 3, 29, 2, 30, tzinfo=LONDON)  # BST: 01:30 UTC
    slot_utc = datetime(2026, 3, 29, 3, 0, tzinfo=UTC)
    for local, expected in ((before, 2.5 * 3600), (after, 1.5 * 3600)):
        with time_machine.travel(local, tick=False):
            now = _now()
            secs = nr.next_wake(now, SLOT, 86400)
            assert secs == expected
            assert now + timedelta(seconds=secs) == slot_utc
            assert nr.at_jst(date(2026, 3, 29), SLOT) == slot_utc


# --- next_wake --------------------------------------------------------------------


def test_next_wake_before_slot() -> None:
    with time_machine.travel(datetime(2026, 5, 5, 11, 59, 0, tzinfo=JST), tick=False):
        assert nr.next_wake(_now(), SLOT, 3600) == 60


def test_next_wake_after_slot_waits_for_midnight_or_cap() -> None:
    with time_machine.travel(datetime(2026, 5, 5, 12, 0, 30, tzinfo=JST), tick=False):
        to_midnight = 12 * 3600 - 30
        assert nr.next_wake(_now(), SLOT, 86400) == to_midnight
        assert nr.next_wake(_now(), SLOT, 600) == 600


def test_next_wake_exactly_at_slot_is_not_ahead() -> None:
    with time_machine.travel(datetime(2026, 5, 5, 12, 0, 0, tzinfo=JST), tick=False):
        assert nr.next_wake(_now(), SLOT, 86400) == 12 * 3600


def test_next_wake_never_below_one_second() -> None:
    with time_machine.travel(
        datetime(2026, 5, 5, 23, 59, 59, 500000, tzinfo=JST), tick=False
    ):
        assert nr.next_wake(_now(), SLOT, 86400) == 1
        assert nr.next_wake(_now(), SLOT, 0) == 1
        assert nr.next_wake(_now(), SLOT, -5) == 1


def test_next_wake_slot_at_midnight() -> None:
    with time_machine.travel(datetime(2026, 5, 5, 23, 0, 0, tzinfo=JST), tick=False):
        assert nr.next_wake(_now(), time(0, 0), 86400) == 3600


def test_next_wake_rejects_naive() -> None:
    with pytest.raises(ValueError):
        nr.next_wake(datetime(2026, 5, 5, 12, 0), SLOT, 60)


# --- birthdays --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "year", "expected"),
    [
        ("03-16", 2026, date(2026, 3, 16)),
        ("2003-03-16", 2026, date(2026, 3, 16)),
        ("02-29", 2027, date(2027, 2, 28)),
        ("02-29", 2028, date(2028, 2, 29)),
        ("2004-02-29", 2027, date(2027, 2, 28)),
        (None, 2026, None),
        ("", 2026, None),
        ("13-01", 2026, None),
        ("02-30", 2026, None),
        ("March 16", 2026, None),
    ],
)
def test_birthday_date(raw: str | None, year: int, expected: date | None) -> None:
    assert nr.birthday_date(raw, year) == expected


def _bday_on(raw: str, day: date) -> list[tuple[str, str, str]]:
    return _kinds(nr.birthday_occasions("sakurazaka46", "42", raw, day, SLOT))


def test_birthday_day_of_and_reminders() -> None:
    assert _bday_on("05-10", date(2026, 5, 10)) == [("birthday", "42", "2026-05-10")]
    assert _bday_on("05-10", date(2026, 5, 3)) == [
        ("birthday_soon", "42", "2026-05-10:7")
    ]
    assert _bday_on("05-10", date(2026, 5, 9)) == [
        ("birthday_soon", "42", "2026-05-10:1")
    ]
    for d in (date(2026, 5, 2), date(2026, 5, 4), date(2026, 5, 8), date(2026, 5, 11)):
        assert _bday_on("05-10", d) == []


def test_birthday_occasion_fields() -> None:
    day_of = nr.birthday_occasions(
        "sakurazaka46", "42", "05-10", date(2026, 5, 10), SLOT
    )[0]
    assert day_of.service == "sakurazaka46"
    assert day_of.day == date(2026, 5, 10)
    assert day_of.number is None
    assert day_of.window == nr.day_window(date(2026, 5, 10), time(0))
    soon = nr.birthday_occasions(
        "sakurazaka46", "42", "05-10", date(2026, 5, 3), time(7, 30)
    )[0]
    assert soon.day == date(2026, 5, 10)
    assert soon.number == 7
    assert soon.window == nr.day_window(date(2026, 5, 3), time(7, 30))


def test_birthday_bad_raw_gives_nothing() -> None:
    assert nr.birthday_occasions("s", "1", None, date(2026, 5, 10), SLOT) == []
    assert nr.birthday_occasions("s", "1", "99-99", date(2026, 5, 10), SLOT) == []


def test_leap_day_birthday() -> None:
    assert _bday_on("02-29", date(2027, 2, 28)) == [("birthday", "42", "2027-02-28")]
    assert _bday_on("02-29", date(2028, 2, 29)) == [("birthday", "42", "2028-02-29")]
    assert _bday_on("02-29", date(2027, 2, 21)) == [
        ("birthday_soon", "42", "2027-02-28:7")
    ]
    assert _bday_on("02-29", date(2027, 2, 27)) == [
        ("birthday_soon", "42", "2027-02-28:1")
    ]
    assert _bday_on("02-29", date(2028, 2, 22)) == [
        ("birthday_soon", "42", "2028-02-29:7")
    ]
    assert _bday_on("02-29", date(2028, 2, 28)) == [
        ("birthday_soon", "42", "2028-02-29:1")
    ]
    assert _bday_on("02-29", date(2027, 3, 1)) == []
    assert _bday_on("02-29", date(2028, 3, 1)) == []


def test_birthday_reminders_cross_month_and_year() -> None:
    assert _bday_on("01-03", date(2026, 12, 27)) == [
        ("birthday_soon", "42", "2027-01-03:7")
    ]
    assert _bday_on("01-03", date(2027, 1, 2)) == [
        ("birthday_soon", "42", "2027-01-03:1")
    ]
    assert _bday_on("01-01", date(2026, 12, 25)) == [
        ("birthday_soon", "42", "2027-01-01:7")
    ]
    assert _bday_on("01-01", date(2026, 12, 31)) == [
        ("birthday_soon", "42", "2027-01-01:1")
    ]
    assert _bday_on("03-02", date(2026, 2, 23)) == [
        ("birthday_soon", "42", "2026-03-02:7")
    ]
    assert _bday_on("03-01", date(2028, 2, 29)) == [
        ("birthday_soon", "42", "2028-03-01:1")
    ]


def test_birthday_window_opens_at_midnight_with_japanese_service_text() -> None:
    occ = nr.birthday_occasions(
        "日向坂46", "メンバー🎂", "2003-11-10", date(2026, 11, 10), SLOT
    )[0]
    assert (occ.service, occ.subject) == ("日向坂46", "メンバー🎂")
    with time_machine.travel(datetime(2026, 11, 10, 0, 0, tzinfo=JST), tick=False):
        assert nr.is_open(occ.window, _now())
    with time_machine.travel(datetime(2026, 11, 11, 0, 0, tzinfo=JST), tick=False):
        assert not nr.is_open(occ.window, _now())


# --- anniversaries ----------------------------------------------------------------


def _anniv_on(start: date | None, day: date) -> list[tuple[str, int | None]]:
    return [
        (o.occasion, o.number)
        for o in nr.anniversary_occasions("nogizaka46", "9", start, day, SLOT)
    ]


def test_anniversary_years() -> None:
    start = date(2023, 6, 15)
    assert _anniv_on(start, date(2024, 6, 15)) == [("y1@2024-06-15", 1)]
    assert _anniv_on(start, date(2026, 6, 15)) == [("y3@2026-06-15", 3)]
    assert _anniv_on(start, date(2026, 6, 14)) == []
    assert _anniv_on(start, date(2023, 6, 15)) == []  # day 1 is not an anniversary


def test_anniversary_day_milestones() -> None:
    start = date(2024, 1, 1)
    assert _anniv_on(start, date(2024, 4, 9)) == [("d100@2024-04-09", 100)]
    assert _anniv_on(start, start + timedelta(days=499)) == [("d500@2025-05-14", 500)]
    assert _anniv_on(start, start + timedelta(days=999)) == [("d1000@2026-09-26", 1000)]
    assert _anniv_on(start, date(2024, 4, 10)) == []


def test_anniversary_occasion_fields() -> None:
    occ = nr.anniversary_occasions(
        "nogizaka46", "9", date(2023, 6, 15), date(2024, 6, 15), SLOT
    )[0]
    assert occ.kind == "anniversary"
    assert occ.service == "nogizaka46"
    assert occ.subject == "9"
    assert occ.day == date(2024, 6, 15)
    assert occ.window == nr.day_window(date(2024, 6, 15), SLOT)


def test_leap_day_subscription_start() -> None:
    start = date(2024, 2, 29)
    assert _anniv_on(start, date(2024, 6, 7)) == [("d100@2024-06-07", 100)]
    assert _anniv_on(start, date(2025, 2, 28)) == [("y1@2025-02-28", 1)]
    assert _anniv_on(start, date(2025, 3, 1)) == []
    assert _anniv_on(start, date(2028, 2, 29)) == [("y4@2028-02-29", 4)]
    assert _anniv_on(start, date(2028, 2, 28)) == []


def test_anniversary_without_start() -> None:
    assert _anniv_on(None, date(2026, 6, 15)) == []


def test_anniversary_before_start() -> None:
    assert _anniv_on(date(2026, 6, 15), date(2025, 6, 15)) == []


def test_anniversary_dates_match_cards() -> None:
    from backend.services.memories import cards

    start = date(2022, 2, 28)
    for n in (1, 2, 3, 10):
        day = cards.anniversary_date(start, n)
        assert _anniv_on(start, day) == [(f"y{n}@{day.isoformat()}", n)]
    for n in nr.DAY_MILESTONES:
        day = cards.subscription_day_date(start, n)
        assert _anniv_on(start, day) == [(f"d{n}@{day.isoformat()}", n)]


# --- recap ------------------------------------------------------------------------


def _recap_on(day: date) -> list[tuple[str, str, int | None]]:
    return [
        (o.subject, o.occasion, o.number) for o in nr.recap_occasions("s", day, SLOT)
    ]


def test_recap_open_only_on_dec_1() -> None:
    assert _recap_on(date(2026, 12, 1)) == [("open", "2026", 2026)]
    assert _recap_on(date(2026, 11, 30)) == []
    assert _recap_on(date(2026, 12, 2)) == []


def test_recap_christmas_only_on_dec_25() -> None:
    assert _recap_on(date(2026, 12, 25)) == [("christmas", "2026", 2026)]
    assert _recap_on(date(2026, 12, 24)) == []
    assert _recap_on(date(2026, 12, 26)) == []
    assert _recap_on(date(2026, 12, 31)) == []


def test_recap_ready_through_january() -> None:
    for d in (date(2027, 1, 1), date(2027, 1, 15), date(2027, 1, 31)):
        assert _recap_on(d) == [("ready", "2026", 2026)]
    assert _recap_on(date(2027, 2, 1)) == []


def test_recap_windows() -> None:
    open_ = nr.recap_occasions("s", date(2026, 12, 1), SLOT)[0]
    assert open_.window == nr.day_window(date(2026, 12, 1), SLOT)
    assert open_.day == date(2026, 12, 1)
    xmas = nr.recap_occasions("s", date(2026, 12, 25), SLOT)[0]
    assert xmas.window == nr.day_window(date(2026, 12, 25), SLOT)
    ready = nr.recap_occasions("s", date(2027, 1, 20), SLOT)[0]
    assert ready.kind == "recap"
    assert ready.day == date(2027, 1, 1)
    assert ready.window == nr.Window(
        nr.at_jst(date(2027, 1, 1), time(0)), nr.at_jst(date(2027, 2, 1), time(0))
    )


def test_recap_ready_first_launch_edges() -> None:
    with time_machine.travel(datetime(2027, 1, 1, 0, 0, tzinfo=JST), tick=False):
        now = _now()
        occ = nr.recap_occasions("s", nr.jst_today(now), SLOT)[0]
        assert nr.is_open(occ.window, now)
    with time_machine.travel(datetime(2027, 1, 31, 23, 59, 59, tzinfo=JST), tick=False):
        now = _now()
        occ = nr.recap_occasions("s", nr.jst_today(now), SLOT)[0]
        assert nr.is_open(occ.window, now)
    with time_machine.travel(datetime(2027, 2, 1, 0, 0, tzinfo=JST), tick=False):
        assert nr.recap_occasions("s", nr.jst_today(_now()), SLOT) == []
    # A New York user's Dec 31 evening is already Jan 1 in Tokyo.
    with time_machine.travel(datetime(2026, 12, 31, 10, 0, tzinfo=NY), tick=False):
        assert _recap_on(nr.jst_today(_now())) == [("ready", "2026", 2026)]


# --- on this day ------------------------------------------------------------------


def test_on_this_day_occasion() -> None:
    occ = nr.on_this_day_occasion(date(2026, 11, 10), time(7, 30))
    assert (occ.kind, occ.service, occ.subject, occ.occasion) == (
        "on_this_day",
        "*",
        "",
        "2026-11-10",
    )
    assert occ.day == date(2026, 11, 10)
    assert occ.number is None
    assert occ.window == nr.day_window(date(2026, 11, 10), time(7, 30))


def test_on_this_day_missed_slot_catches_up_only_that_day() -> None:
    with time_machine.travel(datetime(2026, 11, 10, 22, 0, tzinfo=JST), tick=False):
        now = _now()
        occ = nr.on_this_day_occasion(nr.jst_today(now), SLOT)
        assert nr.is_open(occ.window, now)
    with time_machine.travel(datetime(2026, 11, 11, 0, 0, 1, tzinfo=JST), tick=False):
        assert not nr.is_open(occ.window, _now())


def test_on_this_day_for_london_user_before_slot() -> None:
    # 2026-11-10 02:00 GMT = 11:00 JST: the window has not opened yet.
    with time_machine.travel(datetime(2026, 11, 10, 2, 0, tzinfo=LONDON), tick=False):
        now = _now()
        occ = nr.on_this_day_occasion(nr.jst_today(now), SLOT)
        assert not nr.is_open(occ.window, now)
        assert nr.next_wake(now, SLOT, 86400) == 3600


# --- cards ------------------------------------------------------------------------

_CATALOGUE = [
    "first.message",
    "first.nickname",
    "first.picture",
    "first.voice",
    "first.video",
    "anniv.d100",
    "anniv.d500",
    "anniv.d1000",
    "anniv.y1",
    "anniv.y5",
    "anniv.y10",
    "count.messages.100",
    "count.messages.10000",
    "count.pictures.1000",
    "count.voice_hour",
    "count.nicknames.100",
    "special.birthday",
    "special.birthday@2026",
    "special.christmas@2025",
    "special.newyear@2027",
    "special.valentine@2026",
    "special.sub_anniversary@2026",
    "record.longest",
    "record.busiest_day",
    "record.nickname_day",
    "record.longest_voice",
    "record.greeting_pair",
    "record.streak.100",
    "moment.synchro",
    "moment.midnight",
    "moment.ohayo.1",
    "moment.oyasumi.100",
    "you.letter.50",
    "change.avatar",
    "grad.last",
]


@pytest.mark.parametrize("key", _CATALOGUE)
def test_log_card_code_is_a_safe_code(key: str) -> None:
    assert re.fullmatch(r"[a-z0-9_]{1,40}", nr.log_card_code(key))


def test_log_card_code_and_base_key() -> None:
    assert nr.log_card_code("special.birthday@2026") == "special_birthday_2026"
    assert nr.base_key("special.birthday@2026") == "special.birthday"
    assert nr.base_key("moment.midnight") == "moment.midnight"


def _card(key: str, *, foil: bool, earned: bool = True) -> Card:
    return Card(key, key.split(".")[0], earned, foil=foil)


def test_notifiable_foil() -> None:
    cards = [
        _card("first.message", foil=False),
        _card("first.nickname", foil=True),
        _card("count.messages.10000", foil=True, earned=False),
        _card("special.birthday", foil=True),
        _card("moment.synchro", foil=True),
        _card("moment.midnight", foil=True),
        _card("grad.last", foil=True),
    ]
    assert nr.notifiable_foil(cards) == frozenset(
        {
            "first.nickname",
            "count.messages.10000",
            "special.birthday",
            "moment.synchro",
            "moment.midnight",
        }
    )


FOIL = frozenset(
    {
        "first.nickname",
        "count.messages.10000",
        "special.birthday",
        "moment.synchro",
        "moment.midnight",
    }
)


def test_new_foil_keys_filters_non_foil() -> None:
    prev = frozenset({"first.message"})
    cur = prev | {"moment.midnight", "count.messages.100"}
    assert nr.new_foil_keys(prev, cur, FOIL) == {"moment.midnight": "moment.midnight"}


def test_new_foil_keys_base_and_year_new_together() -> None:
    prev = frozenset({"first.message"})
    cur = prev | {"special.birthday", "special.birthday@2026"}
    assert nr.new_foil_keys(prev, cur, FOIL) == {
        "special.birthday": "special.birthday@2026"
    }


def test_new_foil_keys_only_a_new_year() -> None:
    prev = frozenset({"special.birthday", "special.birthday@2026"})
    cur = prev | {"special.birthday@2027"}
    assert nr.new_foil_keys(prev, cur, FOIL) == {
        "special.birthday": "special.birthday@2027"
    }


def test_new_foil_keys_picks_newest_of_several_years() -> None:
    prev = frozenset()
    cur = frozenset(
        {"special.birthday", "special.birthday@2025", "special.birthday@2026"}
    )
    assert nr.new_foil_keys(prev, cur, FOIL) == {
        "special.birthday": "special.birthday@2026"
    }


def test_new_foil_keys_excludes_grad_last() -> None:
    prev = frozenset({"first.message"})
    cur = prev | {"grad.last"}
    assert nr.new_foil_keys(prev, cur, FOIL) == {}
    # Even when a caller passes it in the foil set, a goodbye never notifies.
    assert nr.new_foil_keys(prev, cur, FOIL | {"grad.last"}) == {}


def test_new_foil_keys_nothing_new_and_shrink() -> None:
    prev = frozenset({"moment.midnight", "special.birthday@2026"})
    assert nr.new_foil_keys(prev, prev, FOIL) == {}
    assert nr.new_foil_keys(prev, frozenset(), FOIL) == {}


def test_new_foil_keys_several_cards() -> None:
    prev = frozenset()
    cur = frozenset({"moment.synchro", "first.nickname", "first.message"})
    assert nr.new_foil_keys(prev, cur, FOIL) == {
        "moment.synchro": "moment.synchro",
        "first.nickname": "first.nickname",
    }
