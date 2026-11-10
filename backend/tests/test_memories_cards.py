"""Photocard binder rules (``backend/services/memories/cards.py``). Pure, synthetic facts."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from backend.services.memories import cards as c
from backend.services.memories.facts import Fact
from backend.services.memories.lexicon import GREETING_BITS
from backend.services.memories.selection import JST

R = "messages/34 金村 美玖/58 金村 美玖"
R2 = "messages/94 金村 美玖/58 金村 美玖"
TODAY = date(2026, 11, 10)


def fact(
    i: int,
    when: str,
    type_: str = "text",
    *,
    promo: bool = False,
    nick: bool = False,
    greet: tuple[str, ...] = (),
    chars: int = 10,
    importance: int | None = -1,
    duration: float | None = None,
) -> Fact:
    """A fact at JST ``when`` (``YYYY-MM-DD HH:MM[:SS]``).

    ``importance`` -1 means the default: 10 for non-promo text, else ``None``.
    """
    fmt = "%Y-%m-%d %H:%M:%S" if when.count(":") == 2 else "%Y-%m-%d %H:%M"
    local = datetime.strptime(when, fmt).replace(tzinfo=JST)
    if importance == -1:
        importance = 10 if type_ == "text" and not promo else None
    mask = 0
    for g in greet:
        mask |= GREETING_BITS[g]
    return Fact(
        id=i,
        ts=local.astimezone(timezone.utc),
        jst_date=local.date(),
        hour=local.hour,
        minute=local.minute,
        type=type_,
        is_promo=promo,
        has_nickname=nick,
        greeting_mask=mask,
        chars=chars,
        importance=importance,
        photo_score=None,
        burst_id=None,
        caption_id=None,
        favorited=False,
        media_file=None,
        duration_s=duration,
    )


def tag(facts, room=R):
    return [(room, f) for f in sorted(facts, key=lambda f: (f.ts, f.id))]


def inputs(facts=(), **kw):
    base = dict(
        facts=tag(facts),
        today=TODAY,
        subscription_start=None,
        birthday=None,
        graduated=False,
        letters=(),
        avatar_changes=(),
    )
    base.update(kw)
    return c.CardInputs(**base)


def by_key(cards):
    return {card.key: card for card in cards}


def key(i, room=R):
    return c.MessageKey(room, i)


def daily(start: date, n: int, first_id: int = 1, hour: int = 12):
    """One text a day for ``n`` days from ``start``."""
    return [
        fact(first_id + k, f"{start + timedelta(days=k)} {hour:02d}:00")
        for k in range(n)
    ]


# --- date arithmetic ------------------------------------------------------------------


def test_subscription_day_date_counts_the_start_as_day_one():
    start = date(2024, 7, 24)
    assert c.subscription_day_date(start, 1) == start
    assert c.subscription_day_date(start, 100) == start + timedelta(days=99)


def test_anniversary_date_and_feb_29():
    assert c.anniversary_date(date(2024, 7, 24), 2) == date(2026, 7, 24)
    assert c.anniversary_date(date(2024, 2, 29), 1) == date(2025, 2, 28)
    assert c.anniversary_date(date(2024, 2, 29), 4) == date(2028, 2, 29)


def test_on_year_takes_a_month_day_or_a_date_and_maps_feb_29():
    assert c.on_year((7, 24), 2026) == date(2026, 7, 24)
    assert c.on_year(date(2001, 11, 10), 2026) == date(2026, 11, 10)
    assert c.on_year((2, 29), 2027) == date(2027, 2, 28)
    assert c.on_year((2, 29), 2028) == date(2028, 2, 29)
    assert c.on_year(date(2024, 2, 29), 2026) == date(2026, 2, 28)


# --- shelf order / summary ----------------------------------------------------------------


def test_empty_person_has_silhouettes_only_and_shelf_order():
    cards = c.evaluate(inputs())
    assert all(not card.earned for card in cards)
    shelves = [card.shelf for card in cards]
    assert shelves == sorted(shelves, key=c.SHELVES.index)
    keys = [card.key for card in cards]
    assert keys[:5] == [
        "first.message",
        "first.picture",
        "first.video",
        "first.voice",
        "first.nickname",
    ]
    # hidden: anniversary (no start), records, voice hour, nicknames, birthday,
    # sub anniversary, letters, changes, graduation
    assert not any(
        k.startswith(("anniv.", "record.longest", "you.", "change.")) for k in keys
    )
    assert "count.voice_hour" not in keys and "count.nicknames.100" not in keys
    assert "special.birthday" not in keys and "grad.last" not in keys
    assert c.progress_summary(cards) == (0, len(cards))


def test_counted_reports_hidden_cards():
    cards, hidden = c.evaluate_counted(inputs())
    assert cards == c.evaluate(inputs())
    # 8 anniversary slots + birthday + sub_anniversary + 5 records + voice hour
    # + nicknames + 3 letters + graduation
    assert hidden == 8 + 2 + 5 + 2 + 3 + 1


def test_progress_summary_excludes_hidden_and_earned_keys_diff():
    before = daily(date(2024, 1, 1), 999)
    cards_before = c.evaluate(inputs(before))
    after = before + [fact(5000, "2026-11-01 12:00")]
    cards_after = c.evaluate(inputs(after))
    added = c.earned_keys(cards_after) - c.earned_keys(cards_before)
    assert added == {"count.messages.1000"}
    earned, total = c.progress_summary(cards_after)
    assert earned == len({k.split("@")[0] for k in c.earned_keys(cards_after)})
    assert total == len(cards_after)


def test_earned_keys_emit_one_key_per_stacked_year():
    before = [fact(1, "2025-05-01 10:00")]
    after = before + [fact(2, "2026-05-01 10:01")]
    k_before = c.earned_keys(c.evaluate(inputs(before, birthday="05-01")))
    k_after = c.earned_keys(c.evaluate(inputs(after, birthday="05-01")))
    assert {"special.birthday", "special.birthday@2025"} <= k_before
    assert k_after - k_before == {
        "special.birthday@2026",
        "special.newyear@2026",
    }


# --- first ----------------------------------------------------------------------------------


def test_first_cards():
    fs = [
        fact(1, "2024-07-24 20:00", promo=True, importance=None),
        fact(2, "2024-07-25 09:00", "picture"),
        fact(3, "2024-07-26 09:00", "voice", duration=5.0),
        fact(4, "2024-07-27 09:00", nick=True, promo=True, importance=None),
        fact(5, "2024-07-28 09:00", "picture"),
    ]
    k = by_key(c.evaluate(inputs(fs)))
    assert k["first.message"].earned and k["first.message"].message == key(1)
    assert k["first.message"].date == date(2024, 7, 24)
    assert k["first.picture"].message == key(2)
    assert k["first.voice"].message == key(3)
    assert not k["first.video"].earned and k["first.video"].message is None
    nick = k["first.nickname"]
    assert nick.earned and nick.foil and nick.message == key(4)


# --- anniversary ------------------------------------------------------------------------------


def test_anniversary_fixed_slots_progress_and_best_of_day():
    start = date(2025, 11, 1)  # day 375 on TODAY
    d100 = c.subscription_day_date(start, 100)
    fs = [
        fact(1, f"{d100} 09:00", importance=3),
        fact(2, f"{d100} 22:00", importance=8),
        fact(3, f"{d100} 23:00", promo=True, importance=None),
    ]
    cards = c.evaluate(inputs(fs, subscription_start=start))
    anniv = [card for card in cards if card.shelf == "anniversary"]
    assert [a.key for a in anniv] == [
        "anniv.d100",
        "anniv.y1",
        "anniv.d500",
        "anniv.y2",
        "anniv.d1000",
        "anniv.y3",
        "anniv.y4",
        "anniv.y5",
    ]
    k = by_key(anniv)
    assert k["anniv.d100"].earned and k["anniv.d100"].message == key(2)
    assert k["anniv.d100"].date == d100 and k["anniv.d100"].fallback is None
    assert k["anniv.y1"].earned and k["anniv.y1"].date == date(2026, 11, 1)
    day_no = (TODAY - start).days + 1
    assert k["anniv.d500"].progress == (day_no, 500)
    assert not k["anniv.d500"].earned and k["anniv.d500"].date is None
    y2_target = (date(2027, 11, 1) - start).days + 1
    assert k["anniv.y2"].progress == (day_no, y2_target)


def test_anniversary_nearest_fallback_ties_to_the_earlier():
    start = date(2025, 11, 1)
    fs = [
        fact(1, "2026-10-31 11:00"),  # 25h before noon of 11-01
        fact(2, "2026-11-02 13:00"),  # 25h after: tie -> earlier wins
        fact(
            3, "2026-11-01 12:00", promo=True, importance=None
        ),  # promo is not nearest
    ]
    # the promo fact is on the day: best of day picks it (first fact of the day)
    k = by_key(c.evaluate(inputs(fs, subscription_start=start)))
    assert k["anniv.y1"].message == key(3) and k["anniv.y1"].fallback is None
    k = by_key(c.evaluate(inputs(fs[:2], subscription_start=start)))
    assert k["anniv.y1"].message == key(1) and k["anniv.y1"].fallback == "nearest"
    # no non-promo fact at all: earned, but no face
    k = by_key(c.evaluate(inputs([], subscription_start=start)))
    assert k["anniv.y1"].earned and k["anniv.y1"].message is None


def test_anniversary_beyond_y5_shows_reached_years_plus_the_next():
    start = date(2019, 11, 1)  # y7 reached on 2026-11-01
    cards = c.evaluate(inputs([], subscription_start=start))
    keys = [card.key for card in cards if card.shelf == "anniversary"]
    assert keys[-3:] == ["anniv.y6", "anniv.y7", "anniv.y8"]
    k = by_key(cards)
    assert k["anniv.y7"].earned and not k["anniv.y8"].earned
    assert k["anniv.y8"].progress[1] == (date(2027, 11, 1) - start).days + 1


def test_anniversary_feb_29_start_and_before_start():
    k = by_key(c.evaluate(inputs([], subscription_start=date(2024, 2, 29))))
    assert k["anniv.y1"].date == date(2025, 2, 28)
    future = by_key(c.evaluate(inputs([], subscription_start=date(2027, 1, 1))))
    assert future["anniv.d100"].progress is None  # never "0 / 100"


def test_unearned_cards_never_carry_a_zero_progress():
    # a voice of unknown length, no pictures: every count is still at 0
    k = by_key(c.evaluate(inputs([fact(1, "2024-01-01 10:00", "voice")])))
    assert k["count.voice_hour"].progress is None
    assert k["count.pictures.100"].progress is None
    assert k["moment.daisuki.100"].progress is None
    assert k["count.messages.100"].progress == (1, 100)
    empty = c.evaluate(inputs())
    assert all(card.progress is None for card in empty)
    assert all(card.progress is None or card.progress[0] > 0 for card in k.values())


# --- numbers -----------------------------------------------------------------------------------


def test_message_and_picture_counts():
    fs = daily(date(2020, 1, 1), 120)
    fs += [
        fact(1000 + k, f"{date(2024, 1, 1) + timedelta(days=k)} 08:00", "picture")
        for k in range(100)
    ]
    k = by_key(c.evaluate(inputs(fs)))
    hundred = k["count.messages.100"]
    assert hundred.earned and hundred.message == key(100)
    assert hundred.date == date(2020, 1, 1) + timedelta(days=99)
    assert k["count.messages.1000"].progress == (220, 1000)
    assert k["count.messages.10000"].foil and not k["count.messages.10000"].earned
    assert k["count.pictures.100"].message == key(1099)
    assert k["count.pictures.1000"].progress == (100, 1000)


def test_voice_hour():
    fs = [
        fact(1, "2024-01-01 10:00", "voice", duration=1800.0),
        fact(2, "2024-01-02 10:00", "voice"),  # unknown duration counts 0
        fact(3, "2024-01-03 10:00", "voice", duration=1799.5),
    ]
    k = by_key(c.evaluate(inputs(fs)))
    assert k["count.voice_hour"].progress == (3599, 3600)
    fs.append(fact(4, "2024-01-04 10:00", "voice", duration=1.0))
    k = by_key(c.evaluate(inputs(fs)))
    assert k["count.voice_hour"].earned and k["count.voice_hour"].message == key(4)
    assert k["count.voice_hour"].date == date(2024, 1, 4)


def test_nickname_count():
    fs = [fact(1, "2024-01-01 10:00", nick=True)]
    k = by_key(c.evaluate(inputs(fs)))
    assert k["count.nicknames.100"].progress == (1, 100)
    fs = [
        fact(i, f"2024-01-01 10:{i // 60:02d}:{i % 60:02d}", nick=True)
        for i in range(100)
    ]
    k = by_key(c.evaluate(inputs(fs)))
    assert k["count.nicknames.100"].earned and k["count.nicknames.100"].message == key(
        99
    )


# --- special -------------------------------------------------------------------------------------


def test_newyear_yearly_stack():
    fs = [
        fact(1, "2024-01-01 00:03", promo=True, importance=None),
        fact(2, "2024-01-01 09:00"),
        fact(3, "2025-03-05 09:00", promo=True, importance=None),
    ]
    card = by_key(c.evaluate(inputs(fs)))["special.newyear"]
    assert card.earned
    assert card.years == (
        c.CardYear(2024, date(2024, 1, 1), key(2)),
        c.CardYear(2025, date(2025, 3, 5), key(3)),
    )
    assert card.message == key(3) and card.date == date(2025, 3, 5)


def test_valentine_keyword_hit_beats_importance():
    fs = [
        fact(1, "2024-02-14 10:00", importance=99),
        fact(2, "2024-02-14 20:00", importance=1),
        fact(3, "2025-02-14 10:00", importance=5),
        fact(4, "2025-02-14 11:00", importance=7),
    ]
    hits = {key(2): frozenset({"valentine"}), key(1): frozenset({"christmas"})}
    card = by_key(c.evaluate(inputs(fs, keyword_hits=hits)))["special.valentine"]
    assert [(y.year, y.message) for y in card.years] == [(2024, key(2)), (2025, key(4))]
    assert card.fallback == "best_of_day"  # face = 2025, no hit
    empty = by_key(c.evaluate(inputs([fact(9, "2024-02-15 10:00")])))
    assert not empty["special.valentine"].earned
    assert empty["special.valentine"].years == ()


def test_christmas_window_and_emoji_hits():
    fs = [
        fact(1, "2024-12-24 17:59", importance=50),  # before the window
        fact(2, "2024-12-24 18:00", importance=9),
        fact(3, "2024-12-25 23:59", importance=1),
        fact(4, "2024-12-26 00:00", importance=50),  # after
    ]
    card = by_key(c.evaluate(inputs(fs)))["special.christmas"]
    assert card.message == key(2) and card.fallback == "best_of_day"
    hits = {key(3): frozenset({"christmas", "🎄"})}
    card = by_key(c.evaluate(inputs(fs, keyword_hits=hits)))["special.christmas"]
    assert card.message == key(3) and card.fallback is None
    assert len(card.years) == 1


def test_birthday_prefers_midnight_and_feb_29():
    fs = [
        fact(1, "2025-02-28 00:09", importance=1),
        fact(2, "2025-02-28 12:00", importance=90),
        fact(3, "2024-02-29 12:00", importance=5),
        fact(4, "2024-02-28 12:00", importance=99),  # not her birthday in a leap year
    ]
    card = by_key(c.evaluate(inputs(fs, birthday="2003-02-29")))["special.birthday"]
    assert card.foil
    assert [(y.year, y.message) for y in card.years] == [(2024, key(3)), (2025, key(1))]
    assert card.fallback is None
    card = by_key(c.evaluate(inputs(fs[1:], birthday="02-29")))["special.birthday"]
    assert card.years[-1].message == key(2) and card.fallback == "best_of_day"
    assert "special.birthday" not in by_key(c.evaluate(inputs(fs, birthday="garbage")))


def test_birthday_without_facts_is_a_silhouette():
    card = by_key(c.evaluate(inputs([], birthday="10-01")))["special.birthday"]
    assert not card.earned and card.years == ()


def test_sub_anniversary_from_the_second_year():
    start = date(2024, 7, 24)
    fs = [
        fact(1, "2024-07-24 12:00"),
        fact(2, "2025-07-24 12:00"),
        fact(3, "2026-07-24 12:00"),
    ]
    card = by_key(c.evaluate(inputs(fs, subscription_start=start)))[
        "special.sub_anniversary"
    ]
    assert [y.year for y in card.years] == [2025, 2026]
    assert card.message == key(3)
    assert "special.sub_anniversary" not in by_key(c.evaluate(inputs(fs)))


# --- records ------------------------------------------------------------------------------------


def test_longest_and_busiest_and_nickname_day():
    fs = [
        fact(1, "2024-01-01 10:00", chars=50),
        fact(2, "2024-01-02 10:00", chars=50, importance=1),
        fact(3, "2024-01-02 11:00", chars=500, promo=True, importance=None),
        fact(4, "2024-01-02 12:00", nick=True, importance=2),
        fact(5, "2024-01-03 10:00", nick=True, importance=4),
        fact(6, "2024-01-03 11:00", nick=True, importance=9),
        fact(7, "2024-01-04 11:00", "picture", chars=900, importance=None),
    ]
    k = by_key(c.evaluate(inputs(fs)))
    assert k["record.longest"].message == key(1)  # tie -> earlier, promo/media skipped
    assert k["record.longest"].detail == {"chars": 50}
    busy = k["record.busiest_day"]
    assert busy.message == key(4) and busy.detail == {"count": 3}
    assert busy.date == date(2024, 1, 2)  # best of day: highest importance words
    nick = k["record.nickname_day"]
    assert nick.message == key(6) and nick.detail == {"count": 2}


def test_nickname_day_face_prefers_non_promo():
    fs = [
        fact(1, "2024-01-02 10:00", nick=True, promo=True, importance=None),
        fact(2, "2024-01-02 11:00", "picture", nick=True),  # no words, not promo
        fact(3, "2024-01-03 10:00", nick=True, promo=True, importance=None),
    ]
    nick = by_key(c.evaluate(inputs(fs)))["record.nickname_day"]
    assert nick.message == key(2) and nick.detail == {"count": 2}
    assert by_key(c.evaluate(inputs(fs[2:])))["record.nickname_day"].message == key(3)


def test_longest_voice():
    fs = [
        fact(1, "2024-01-01 10:00", "voice", duration=12.4),
        fact(2, "2024-01-02 10:00", "voice", duration=40.6),
        fact(3, "2024-01-03 10:00", "voice"),
    ]
    card = by_key(c.evaluate(inputs(fs)))["record.longest_voice"]
    assert card.message == key(2) and card.detail == {"seconds": 41}
    assert "record.longest_voice" not in by_key(c.evaluate(inputs(fs[2:])))


def test_greeting_pair_treats_one_am_as_later_than_eleven_pm():
    fs = [
        fact(1, "2024-01-01 03:30", greet=("ohayo",)),  # hour 3: not a morning ohayo
        fact(2, "2024-01-02 06:10", greet=("ohayo",)),
        fact(3, "2024-01-03 05:59", greet=("ohayo",)),
        fact(4, "2024-01-04 23:00", greet=("oyasumi",)),
        fact(5, "2024-01-05 01:00", greet=("oyasumi",)),
        fact(6, "2024-01-06 05:00", greet=("oyasumi",)),  # 05:00 is early, not late
        fact(7, "2024-01-07 02:00", greet=("oyasumi",), promo=True, importance=None),
    ]
    card = by_key(c.evaluate(inputs(fs)))["record.greeting_pair"]
    assert card.message == key(3) and card.refs == {"pair": key(5)}
    assert "record.greeting_pair" not in by_key(c.evaluate(inputs(fs[:3])))


def test_greeting_pair_ties_go_to_the_earlier():
    fs = [
        fact(1, "2024-01-01 07:00", greet=("ohayo",)),
        fact(2, "2024-01-02 07:00", greet=("ohayo",)),
        fact(3, "2024-01-03 01:00", greet=("oyasumi",)),
        fact(4, "2024-01-04 01:00", greet=("oyasumi",)),
    ]
    card = by_key(c.evaluate(inputs(fs)))["record.greeting_pair"]
    assert card.message == key(1) and card.refs == {"pair": key(3)}


def test_streak_threshold_date():
    start = date(2024, 3, 1)
    fs = daily(start, 3) + daily(start + timedelta(days=4), 8, first_id=100)
    k = by_key(c.evaluate(inputs(fs)))
    seven = k["record.streak.7"]
    assert seven.earned and seven.date == start + timedelta(days=10)
    assert seven.message == key(106)
    assert k["record.streak.30"].progress == (8, 30)
    assert k["record.streak.100"].progress == (8, 100)


# --- moments ------------------------------------------------------------------------------------


def test_midnight_moment():
    fs = [
        fact(1, "2024-01-01 00:00", promo=True, importance=None),
        fact(2, "2024-01-02 00:05:59"),
        fact(3, "2024-01-03 00:06"),
        fact(4, "2024-01-04 00:01", "picture"),
    ]
    card = by_key(c.evaluate(inputs(fs)))["moment.midnight"]
    assert card.earned and card.foil and card.message == key(2)
    assert card.detail == {"count": 2}
    assert not by_key(c.evaluate(inputs(fs[:1])))["moment.midnight"].earned


def test_synchro_picks_the_earliest_completed_pair():
    fs = [
        fact(1, "2024-01-01 12:34:56"),
        fact(2, "2024-01-01 12:34:56"),  # same date: not a pair
        fact(3, "2024-01-05 08:00:00"),
        fact(4, "2024-01-09 08:00:00"),  # completes first
        fact(5, "2024-01-10 12:34:56"),
    ]
    card = by_key(c.evaluate(inputs(fs)))["moment.synchro"]
    assert card.rare and card.foil
    assert card.message == key(4) and card.refs == {"pair": key(3)}
    assert card.date == date(2024, 1, 9)
    assert not by_key(c.evaluate(inputs(fs[:3])))["moment.synchro"].earned


def test_synchro_ignores_promo():
    fs = [
        fact(1, "2024-01-01 12:00:00", promo=True, importance=None),
        fact(2, "2024-01-02 12:00:00", promo=True, importance=None),
        fact(3, "2024-01-03 12:00:00"),
    ]
    card = by_key(c.evaluate(inputs(fs)))["moment.synchro"]
    assert not card.earned  # a scheduled promo at the same second is no moment
    fs.append(fact(4, "2024-01-04 12:00:00"))
    card = by_key(c.evaluate(inputs(fs)))["moment.synchro"]
    assert card.message == key(4) and card.refs == {"pair": key(3)}


def test_counts_include_promo():
    fs = [
        fact(i, f"2024-01-01 10:{i:02d}", promo=True, importance=None)
        for i in range(1, 3)
    ]
    k = by_key(c.evaluate(inputs(fs)))
    assert k["count.messages.100"].progress == (2, 100)
    assert k["first.message"].message == key(1)


def test_oyasumi_and_daisuki_moments():
    fs = [
        fact(
            1,
            "2024-01-01 23:00",
            greet=("oyasumi", "daisuki"),
            promo=True,
            importance=None,
        )
    ]
    fs += [
        fact(10 + i, f"2024-02-01 23:{i // 60:02d}:{i % 60:02d}", greet=("oyasumi",))
        for i in range(100)
    ]
    fs.append(fact(500, "2024-03-01 10:00", greet=("daisuki",)))
    k = by_key(c.evaluate(inputs(fs)))
    assert k["moment.oyasumi.1"].message == key(10)  # promo skipped
    assert k["moment.oyasumi.100"].message == key(109)
    assert k["moment.daisuki.1"].message == key(500)
    assert k["moment.daisuki.100"].progress == (1, 100)
    k = by_key(c.evaluate(inputs()))
    assert not k["moment.daisuki.1"].earned and k["moment.daisuki.1"].progress is None


# --- you ------------------------------------------------------------------------------------


def test_letter_cards_never_carry_a_message():
    letters = [
        (R if i % 2 else R2, i, date(2024, 1, 1) + timedelta(days=i)) for i in range(12)
    ]
    k = by_key(c.evaluate(inputs([fact(1, "2024-01-01 10:00")], letters=letters)))
    first = k["you.letter.1"]
    assert first.earned and first.letter == (R2, 0) and first.date == date(2024, 1, 1)
    assert k["you.letter.10"].letter == (R, 9)
    assert k["you.letter.50"].progress == (12, 50) and k["you.letter.50"].letter is None
    you = [card for card in k.values() if card.shelf == "you"]
    assert all(card.message is None and not card.refs for card in you)


# --- change -----------------------------------------------------------------------------------


def test_avatar_change_cards():
    first_change = datetime(2024, 5, 1, 3, 0, tzinfo=timezone.utc)  # 12:00 JST
    second_change = datetime(
        2024, 5, 10, 15, 30, tzinfo=timezone.utc
    )  # 05-11 00:30 JST
    changes = [
        c.AvatarChange(first_change, "/a/old.jpg", "/a/new.jpg"),
        c.AvatarChange(second_change, None, "/a/newer.jpg"),
    ]
    fs = [
        fact(1, "2024-04-30 20:00"),
        fact(2, "2024-05-01 11:00", importance=50),  # same day, before the change
        fact(5, "2024-05-01 13:00", promo=True, importance=None),  # promo: not a face
        fact(6, "2024-05-01 15:00", importance=1),  # first words after the change
        fact(3, "2024-05-03 10:00"),
        fact(4, "2024-05-12 10:00"),
    ]
    cards = [
        card
        for card in c.evaluate(inputs(fs, avatar_changes=changes))
        if card.shelf == "change"
    ]
    a, b = cards
    assert (
        a.key == "change.avatar.2024-05-01" and a.earned and a.date == date(2024, 5, 1)
    )
    # the face is her message after the change (new icon), never the old icon's
    assert a.message == key(6) and a.fallback is None
    assert a.refs == {"old_last": key(2), "new_first": key(5)}
    assert a.detail == {
        "days": 10,
        "messages": 3,
        "old_url": "/a/old.jpg",
        "new_url": "/a/new.jpg",
    }
    assert b.key == "change.avatar.2024-05-11"
    assert b.message == key(4) and b.fallback == "first_after"
    assert b.detail == {
        "days": (TODAY - date(2024, 5, 11)).days + 1,
        "messages": 1,
        "new_url": "/a/newer.jpg",
    }


def test_avatar_change_same_day_keys_stay_unique_and_no_facts():
    t = datetime(2024, 5, 1, 3, 0, tzinfo=timezone.utc)
    changes = [
        c.AvatarChange(t, "/x", "/y"),
        c.AvatarChange(t + timedelta(hours=1), "/y", "/z"),
    ]
    cards = [
        card
        for card in c.evaluate(inputs([], avatar_changes=changes))
        if card.shelf == "change"
    ]
    assert [card.key for card in cards] == [
        "change.avatar.2024-05-01",
        "change.avatar.2024-05-01.2",
    ]
    assert cards[0].message is None and cards[0].refs == {}
    assert cards[0].detail["days"] == 1
    promo_only = [fact(1, "2024-05-02 10:00", promo=True, importance=None)]
    cards = [
        card
        for card in c.evaluate(inputs(promo_only, avatar_changes=changes))
        if card.shelf == "change"
    ]
    assert cards[1].message == key(1) and cards[1].fallback == "first_after"


# --- graduation --------------------------------------------------------------------------------


def test_graduation_card_and_no_silhouettes():
    fs = [
        fact(1, "2024-01-01 10:00"),
        fact(2, "2025-01-01 10:00", promo=True, importance=None),
    ]
    k = by_key(c.evaluate(inputs(fs, graduated=True)))
    assert (
        k["grad.last"].earned
        and k["grad.last"].foil
        and k["grad.last"].message == key(2)
    )
    assert "grad.last" not in by_key(c.evaluate(inputs(fs)))
    assert "grad.last" not in by_key(c.evaluate(inputs([], graduated=True)))


def test_facts_from_two_rooms_keep_their_room():
    fs = [
        ("x", fact(1, "2024-01-01 10:00")),
        ("y", fact(1, "2024-01-02 10:00", "picture")),
    ]
    k = by_key(c.evaluate(c.CardInputs(fs, TODAY, None, None, False, (), ())))
    assert k["first.message"].message == c.MessageKey("x", 1)
    assert k["first.picture"].message == c.MessageKey("y", 1)


@pytest.mark.parametrize("raw", ["13-01", "02-30x", "", "2003-13-01"])
def test_bad_birthdays_hide_the_card(raw):
    assert "special.birthday" not in by_key(
        c.evaluate(inputs([fact(1, "2024-01-01 10:00")], birthday=raw))
    )
