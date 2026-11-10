"""Hub board (``backend/services/memories/hub.py``)."""

from __future__ import annotations

import contextlib
import json
from datetime import datetime, timezone

import pytest
import time_machine
from structlog.testing import capture_logs

from backend.services import app_state
from backend.services.memories import hub, user_store
from backend.services.memories import index as mi
from backend.services.memories import oshi as oshi_mod
from backend.services.memories.view_cache import contains_text
from backend.tests.memories_archive import msg, write_room, write_side_inputs

SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
KANE = "messages/34 金村 美玖/58 金村 美玖"
MATSU = "messages/40 松田 好花/64 松田 好花"
NOW = datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc)  # 12:00 JST
PROMO = "%%%へお知らせ！写真集の予約が始まったよ https://example.jp " + "あ" * 80
KANE_OTD = "二年前の今日、ありがとう"
MATSU_OTD = (
    "今日は本当に楽しかった、みんなに会えて嬉しい、ずっと応援してくれてありがとう！"
)
KANE_FIRST = "はじめまして、よろしくね"
NOTE = "あの日のわたしのメモ"


def pic(room, i, ts, fav=False):
    return msg(
        i,
        ts,
        "picture",
        fav=fav,
        media_file=f"{room}/picture/{i}.jpg".replace("/", "\\"),
    )


def set_oshi(monkeypatch, names):
    async def fake(service):
        return set(names)

    monkeypatch.setattr(oshi_mod, "oshi_names", fake)


@pytest.fixture
def svc(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    app_state.set_db_path(tmp_path / "app.db")
    app_state.init_db()
    sdir = tmp_path / "out" / SVC_NAME
    set_oshi(monkeypatch, {"金村美玖"})
    return sdir


def kane(sdir, msgs):
    write_room(sdir, "34 金村 美玖", "58 金村 美玖", msgs)


def matsu(sdir, msgs):
    write_room(sdir, "40 松田 好花", "64 松田 好花", msgs)


async def build(sdir, now=NOW):
    with time_machine.travel(now, tick=False):
        return await hub.build_hub(SERVICE, sdir, now=datetime.now(timezone.utc))


@pytest.fixture
def today_svc(svc):
    kane(
        svc,
        [
            msg(1, "2022-03-01T03:00:00Z", content=PROMO),
            msg(2, "2022-03-01T04:00:00Z", content=KANE_FIRST),
            msg(3, "2024-11-10T03:00:00Z", content=KANE_OTD),
            pic(KANE, 4, "2024-11-10T03:05:00Z"),  # lower score
            pic(KANE, 5, "2024-11-10T12:00:00Z", fav=True),  # 21:00 JST, ★: the photo
            pic(KANE, 6, "2024-11-11T12:00:00Z", fav=True),  # another day
            msg(7, "2026-11-10T01:00:00Z", content="今年の今日"),  # this year: ignored
        ],
    )
    matsu(
        svc,
        [
            msg(1, "2025-11-10T04:00:00Z", content=MATSU_OTD),
            pic(MATSU, 2, "2025-11-10T12:30:00Z", fav=True),
        ],
    )
    return svc


@pytest.mark.asyncio
async def test_today_prefers_the_oshi_and_her_best_photo_of_that_day(today_svc):
    otd = (await build(today_svc))["on_this_day"]
    assert otd["rule"] == "today"
    assert otd["year"] == 2024 and otd["years_ago"] == 2 and otd["date"] == "2024-11-10"
    assert otd["member_path"] == f"{SVC_NAME}/{KANE}" and otd["name"] == "金村 美玖"
    assert otd["message"]["id"] == 3 and otd["message"]["text"] == KANE_OTD
    assert otd["photo"]["id"] == 5 and otd["photo"]["room"] == KANE


@pytest.mark.asyncio
async def test_today_without_oshi_takes_the_highest_importance(today_svc, monkeypatch):
    set_oshi(monkeypatch, set())
    otd = (await build(today_svc))["on_this_day"]
    assert otd["rule"] == "today" and otd["years_ago"] == 1
    assert otd["message"]["text"] == MATSU_OTD and otd["photo"]["id"] == 2


@pytest.mark.asyncio
async def test_today_with_only_a_photo_shows_the_photo(svc):
    kane(svc, [pic(KANE, 1, "2024-11-10T12:00:00Z")])
    otd = (await build(svc))["on_this_day"]
    assert otd["rule"] == "today" and otd["message"]["id"] == 1
    assert otd["photo"] is None


@pytest.mark.asyncio
async def test_week_fallback_carries_the_real_date(svc):
    kane(
        svc,
        [
            msg(1, "2022-03-01T04:00:00Z", content=KANE_FIRST),
            msg(2, "2025-11-12T03:00:00Z", content="二日後の言葉"),
            msg(3, "2026-11-08T03:00:00Z", content="今年の二日前"),  # this year
            msg(4, "2024-11-10T03:00:00Z", content=PROMO),  # promo only on the day
        ],
    )
    with capture_logs() as logs:
        otd = (await build(svc))["on_this_day"]
    assert otd["rule"] == "week" and otd["message"]["id"] == 2
    assert otd["year"] == 2025 and otd["years_ago"] == 1 and otd["date"] == "2025-11-12"
    assert otd["photo"] is None
    picks = [
        e for e in logs if e["event"] == "memories_select" and e["view"] == "hub_otd"
    ]
    assert [(e["rule"], e["fallback"]) for e in picks] == [("week", "week")]
    skips = [
        e for e in logs if e["event"] == "memories_skip" and e["view"] == "hub_otd"
    ]
    assert [e["reason"] for e in skips] == ["no_today", "no_photo"]


@pytest.mark.asyncio
async def test_week_across_new_year_uses_past_years_only(svc):
    kane(
        svc,
        [
            msg(1, "2022-03-01T04:00:00Z", content=KANE_FIRST),
            msg(2, "2025-12-29T03:00:00Z", content="三日前、今年の週"),  # this week
            msg(3, "2024-12-30T03:00:00Z", content="一年前の年末"),
        ],
    )
    now = datetime(2026, 1, 1, 3, 0, tzinfo=timezone.utc)
    otd = (await build(svc, now))["on_this_day"]
    assert otd["rule"] == "week" and otd["message"]["id"] == 3
    assert otd["year"] == 2025 and otd["years_ago"] == 1 and otd["date"] == "2024-12-30"


@pytest.mark.asyncio
async def test_week_on_leap_day_reaches_feb_28(svc):
    kane(
        svc,
        [
            msg(1, "2022-06-01T04:00:00Z", content=KANE_FIRST),
            msg(2, "2025-02-25T03:00:00Z", content="うるう週の言葉"),
        ],
    )
    now = datetime(2028, 2, 29, 3, 0, tzinfo=timezone.utc)
    otd = (await build(svc, now))["on_this_day"]
    # 2025 has no 02-29: its centre is 02-28, three days after 02-25
    assert otd["rule"] == "week" and otd["message"]["id"] == 2
    assert otd["year"] == 2025 and otd["years_ago"] == 3


@pytest.mark.asyncio
async def test_first_fallback_is_the_first_persons_first_words(svc):
    kane(
        svc,
        [
            msg(1, "2022-03-01T03:00:00Z", content=PROMO),
            msg(2, "2022-03-01T04:00:00Z", content=KANE_FIRST),
            pic(KANE, 3, "2022-03-01T12:00:00Z"),
        ],
    )
    matsu(svc, [msg(1, "2021-01-01T04:00:00Z", content="松田の最初")])
    with capture_logs() as logs:
        otd = (await build(svc))["on_this_day"]
    assert otd["rule"] == "first" and otd["message"]["id"] == 2
    assert otd["message"]["text"] == KANE_FIRST
    assert otd["year"] == 2022 and otd["years_ago"] == 4 and otd["date"] == "2022-03-01"
    assert otd["photo"]["id"] == 3
    picks = [
        e for e in logs if e["event"] == "memories_select" and e["view"] == "hub_otd"
    ]
    assert [(e["rule"], e["fallback"]) for e in picks] == [
        ("first", "first"),
        ("photo", None),
    ]


@pytest.mark.asyncio
async def test_first_skips_a_person_without_words(svc, monkeypatch):
    kane(svc, [msg(1, "2022-03-01T03:00:00Z", content=PROMO)])
    matsu(svc, [msg(1, "2021-01-01T04:00:00Z", content="松田の最初")])
    otd = (await build(svc))["on_this_day"]
    assert otd["rule"] == "first" and otd["member_path"] == f"{SVC_NAME}/{MATSU}"


@pytest.mark.asyncio
async def test_no_messages_gives_no_on_this_day(svc):
    kane(svc, [msg(1, "2022-03-01T03:00:00Z", content=PROMO)])
    with capture_logs() as logs:
        payload = await build(svc)
    assert payload["on_this_day"] is None
    reasons = [e["reason"] for e in logs if e["event"] == "memories_skip"]
    assert "no_first" in reasons


@pytest.mark.asyncio
async def test_counts(today_svc):
    counts = (await build(today_svc))["counts"]
    # pictures + videos (promo included); people with any fact; ★
    # voices (promo included); JST dates with any message, across people
    assert counts == {
        "album": 4,
        "members": 2,
        "favorites": 3,
        "voices": 0,
        "days": 5,
    }


@pytest.mark.asyncio
async def test_counts_voices_and_days(svc):
    kane(
        svc,
        [
            msg(1, "2024-01-01T03:00:00Z", "voice", media_duration=3.0),
            msg(2, "2024-01-01T04:00:00Z", "voice", content=PROMO),
            msg(3, "2024-01-01T15:30:00Z", content="00:30 JST, 01-02"),
        ],
    )
    matsu(svc, [msg(1, "2024-01-01T05:00:00Z", "voice")])  # same JST date
    counts = (await build(svc))["counts"]
    assert counts["voices"] == 3 and counts["days"] == 2


@pytest.mark.asyncio
async def test_version_is_3():
    assert hub.VERSION == 3


@pytest.mark.asyncio
async def test_same_time_and_capsule_are_null_when_absent(svc):
    kane(svc, [msg(1, "2022-03-01T04:00:00Z", content=KANE_FIRST)])  # 13:00 JST
    payload = await build(svc)
    assert payload["same_time"] is None and payload["capsule"] is None
    assert payload["gacha_left"] == 3


@pytest.mark.asyncio
async def test_same_time_is_filled(today_svc):
    line = (await build(today_svc))["same_time"]
    # 2024-11-10 12:00 JST, the same clock as now (promo at 12:00 is skipped)
    assert line["clock"] == "12:00" and line["date"] == "2024-11-10"
    assert line["message"]["id"] == 3 and line["message"]["text"] == KANE_OTD


@pytest.mark.asyncio
async def test_capsule_is_the_first_resurfacing_note(today_svc):
    written = datetime(2025, 11, 10, 3, 0, tzinfo=timezone.utc)
    for body in (NOTE, "二つ目"):
        user_store.add_note(
            SERVICE,
            anchor_kind="day",
            anchor_date=datetime(2024, 11, 10).date(),
            body=body,
            now=written,
        )
    cap = (await build(today_svc))["capsule"]
    assert cap["note"]["body"] == NOTE and cap["years_ago"] == 1
    assert cap["message"]["text"] == KANE_OTD  # oshi first on that day


@pytest.mark.asyncio
async def test_gacha_left_after_a_recorded_pull(today_svc):
    user_store.record_gacha_pull(
        SERVICE,
        datetime(2026, 11, 10).date(),
        room=KANE,
        message_id=3,
        rarity="n",
        reason="message",
        now=NOW,
        max_pulls=3,
    )
    assert (await build(today_svc))["gacha_left"] == 2
    # another JST day starts full again
    later = datetime(2026, 11, 10, 15, 0, tzinfo=timezone.utc)  # 11-11 00:00 JST
    assert (await build(today_svc, later))["gacha_left"] == 3


@pytest.mark.asyncio
async def test_store_failure_hides_capsule_and_gacha_left(today_svc, monkeypatch):
    import sqlite3

    def broken(*a, **k):
        raise sqlite3.OperationalError("locked")

    monkeypatch.setattr(user_store, "notes_created_on_month_day", broken)
    monkeypatch.setattr(user_store, "gacha_pulls_on", broken)
    with capture_logs() as logs:
        payload = await build(today_svc)
    assert payload["capsule"] is None and payload["gacha_left"] is None
    assert payload["same_time"] is not None
    reasons = [
        e["reason"]
        for e in logs
        if e["event"] == "memories_skip" and e.get("view") == "hub"
    ]
    assert reasons == ["store_unavailable", "store_unavailable"]


# --- countdown ------------------------------------------------------------------------


def people_with(svc, **side):
    kane(svc, [msg(1, "2024-11-10T03:00:00Z", content=KANE_OTD)])
    matsu(svc, [msg(1, "2024-11-10T04:00:00Z", content=MATSU_OTD)])
    write_side_inputs(svc, **side)


@pytest.mark.asyncio
async def test_countdown_picks_the_soonest_anniversary(svc):
    people_with(
        svc, birthdays={"金村美玖": "2001-11-15"}, sub_starts={"40": "2023-11-12"}
    )
    countdown = (await build(svc))["countdown"]
    assert countdown == {
        "kind": "anniversary",
        "member_path": f"{SVC_NAME}/{MATSU}",
        "name": "松田 好花",
        "date": "2026-11-12",
        "days_left": 2,
        "years": 3,
    }


@pytest.mark.asyncio
async def test_countdown_picks_the_soonest_birthday(svc):
    people_with(
        svc, birthdays={"金村美玖": "2001-11-11"}, sub_starts={"40": "2023-11-12"}
    )
    countdown = (await build(svc))["countdown"]
    assert countdown["kind"] == "birthday" and countdown["years"] is None
    assert countdown["date"] == "2026-11-11" and countdown["days_left"] == 1


@pytest.mark.asyncio
async def test_countdown_on_the_day_is_zero_days_left(svc):
    people_with(svc, birthdays={"金村美玖": "2001-11-10"})
    countdown = (await build(svc))["countdown"]
    assert countdown["kind"] == "birthday" and countdown["days_left"] == 0
    assert countdown["date"] == "2026-11-10"


@pytest.mark.asyncio
async def test_countdown_passed_dates_roll_to_next_year(svc):
    people_with(
        svc, birthdays={"金村美玖": "2001-03-01"}, sub_starts={"40": "2026-02-01"}
    )
    countdown = (await build(svc))["countdown"]
    # the 1st anniversary (2027-02-01) beats the birthday (2027-03-01)
    assert countdown["kind"] == "anniversary" and countdown["years"] == 1
    assert countdown["date"] == "2027-02-01" and countdown["days_left"] == 83


@pytest.mark.asyncio
async def test_countdown_anniversary_today_and_never_year_zero(svc):
    people_with(svc, sub_starts={"40": "2026-11-10"})  # she started today
    assert (await build(svc))["countdown"]["date"] == "2027-11-10"
    people_with(svc, sub_starts={"40": "2024-11-10"})
    countdown = (await build(svc))["countdown"]
    assert countdown["days_left"] == 0 and countdown["years"] == 2


@pytest.mark.asyncio
async def test_countdown_excludes_graduated_people(svc):
    people_with(
        svc,
        birthdays={"金村美玖": "2001-11-15", "松田好花": "1999-11-11"},
        closed_groups=["40"],
    )
    countdown = (await build(svc))["countdown"]
    assert countdown["name"] == "金村 美玖" and countdown["days_left"] == 5


@pytest.mark.asyncio
async def test_countdown_tie_goes_to_the_oshi(svc, monkeypatch):
    people_with(
        svc, birthdays={"金村美玖": "2001-11-12"}, sub_starts={"40": "2023-11-12"}
    )
    assert (await build(svc))["countdown"]["kind"] == "birthday"
    set_oshi(monkeypatch, {"松田好花"})
    assert (await build(svc))["countdown"]["kind"] == "anniversary"


@pytest.mark.asyncio
async def test_countdown_is_null_without_dates(svc):
    people_with(svc, birthdays={"金村美玖": "garbage"})
    assert (await build(svc))["countdown"] is None


# --- cache ----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cache_holds_numbers_only_and_texts_come_back(today_svc):
    user_store.add_note(
        SERVICE,
        anchor_kind="day",
        anchor_date=datetime(2024, 11, 10).date(),
        body=NOTE,
        now=datetime(2025, 11, 10, 3, 0, tzinfo=timezone.utc),
    )
    with capture_logs() as logs:
        first = await build(today_svc)
        second = await build(today_svc)
    outcomes = [
        e["outcome"]
        for e in logs
        if e["event"] == "memories_view_cache" and e["view"] == "hub"
    ]
    assert outcomes == ["miss", "hit"]
    assert first == second
    assert second["on_this_day"]["message"]["text"] == KANE_OTD
    assert second["capsule"]["note"]["body"] == NOTE
    assert second["same_time"]["message"]["text"] == KANE_OTD
    with contextlib.closing(mi._connect()) as c:
        (row,) = c.execute(
            "SELECT payload FROM memories_view_cache WHERE view='hub'"
        ).fetchall()
    stored = json.loads(row[0])
    assert set(stored) == {"counts", "countdown"} and not contains_text(stored)
    assert KANE_OTD not in row[0] and NOTE not in row[0]


@pytest.mark.asyncio
async def test_cache_misses_on_a_new_day(today_svc):
    await build(today_svc)
    with capture_logs() as logs:
        await build(today_svc, datetime(2026, 11, 11, 3, 0, tzinfo=timezone.utc))
    outcomes = [e["outcome"] for e in logs if e["event"] == "memories_view_cache"]
    assert "miss" in outcomes


@pytest.mark.asyncio
async def test_logs_carry_no_text_or_names(today_svc):
    with capture_logs() as logs:
        await build(today_svc)
    flat = repr(logs)
    for secret in (KANE_OTD, MATSU_OTD, "金村", "松田", str(today_svc)):
        assert secret not in flat
    (event,) = [e for e in logs if e["event"] == "memories_hub"]
    assert event["rule"] == "today" and event["album"] == 4
    assert event["same_time"] is True and event["capsule"] is False
    assert event["gacha_left"] == 3 and event["voices"] == 0 and event["days"] == 5


# --- fix wave 1 -----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_photo_only_day_prefers_the_oshis_photo(svc):
    kane(svc, [pic(KANE, 1, "2024-11-10T03:00:00Z")])  # low score
    matsu(svc, [pic(MATSU, 1, "2025-11-10T12:00:00Z", fav=True)])  # ★ + evening
    otd = (await build(svc))["on_this_day"]
    assert otd["rule"] == "today" and otd["member_path"] == f"{SVC_NAME}/{KANE}"


@pytest.mark.asyncio
async def test_week_prefers_the_oshi(svc):
    kane(
        svc,
        [
            msg(1, "2022-06-01T04:00:00Z", content=KANE_FIRST),
            msg(2, "2025-11-12T03:00:00Z", content="短い"),
        ],
    )
    matsu(svc, [msg(1, "2025-11-11T03:00:00Z", content=MATSU_OTD)])
    otd = (await build(svc))["on_this_day"]
    assert otd["rule"] == "week" and otd["member_path"] == f"{SVC_NAME}/{KANE}"
    assert otd["date"] == "2025-11-12"


@pytest.mark.asyncio
async def test_week_on_dec_31_reaches_into_january(svc):
    kane(
        svc,
        [
            msg(1, "2022-06-01T04:00:00Z", content=KANE_FIRST),
            msg(2, "2025-01-02T03:00:00Z", content="新年の言葉"),
            msg(3, "2025-12-29T03:00:00Z", content=MATSU_OTD),  # this week: never
        ],
    )
    now = datetime(2025, 12, 31, 3, 0, tzinfo=timezone.utc)
    otd = (await build(svc, now))["on_this_day"]
    # 2025-01-02 is two days after 2024-12-31: last year's window
    assert otd["rule"] == "week" and otd["message"]["id"] == 2
    assert otd["year"] == 2024 and otd["years_ago"] == 1 and otd["date"] == "2025-01-02"


@pytest.mark.asyncio
async def test_countdown_month_day_only_birthday(svc):
    people_with(svc, birthdays={"金村美玖": "11-15"})
    countdown = (await build(svc))["countdown"]
    assert countdown["kind"] == "birthday" and countdown["date"] == "2026-11-15"


@pytest.mark.asyncio
async def test_countdown_feb_29_birthday_in_a_non_leap_year(svc):
    people_with(svc, birthdays={"金村美玖": "2004-02-29"})
    now = datetime(2027, 2, 20, 3, 0, tzinfo=timezone.utc)
    countdown = (await build(svc, now))["countdown"]
    assert countdown["date"] == "2027-02-28" and countdown["days_left"] == 8


@pytest.mark.asyncio
async def test_countdown_tie_without_oshi_prefers_the_birthday(svc, monkeypatch):
    set_oshi(monkeypatch, set())
    # 金村 sorts first, but the birthday wins the same-day tie
    people_with(
        svc, birthdays={"松田好花": "1999-11-12"}, sub_starts={"34": "2023-11-12"}
    )
    countdown = (await build(svc))["countdown"]
    assert countdown["kind"] == "birthday" and countdown["name"] == "松田 好花"


def write_server_groups(svc, groups):
    (svc / "sync_metadata.json").write_text(
        json.dumps({"server_groups": groups}), encoding="utf-8"
    )


@pytest.mark.asyncio
async def test_countdown_drops_the_anniversary_of_an_ended_subscription(svc):
    people_with(
        svc, birthdays={"松田好花": "1999-11-20"}, sub_starts={"40": "2023-11-12"}
    )
    write_server_groups(
        svc,
        {
            "34": {"state": "open", "is_active": True},
            "40": {"state": "open", "is_active": False},
        },
    )
    with capture_logs() as logs:
        countdown = (await build(svc))["countdown"]
    # the 11-12 anniversary is gone; her birthday stays
    assert countdown["kind"] == "birthday" and countdown["date"] == "2026-11-20"
    assert any(e.get("reason") == "subscription_ended" for e in logs)
    write_server_groups(svc, {"40": {"state": "open", "is_active": True}})
    countdown = (await build(svc))["countdown"]  # resubscribed: a cache miss
    assert countdown["kind"] == "anniversary" and countdown["date"] == "2026-11-12"


@pytest.mark.asyncio
async def test_countdown_unreadable_sync_metadata_drops_nothing(svc):
    people_with(svc, sub_starts={"40": "2023-11-12"})
    (svc / "sync_metadata.json").write_text("{not json", encoding="utf-8")
    with capture_logs() as logs:
        countdown = (await build(svc))["countdown"]
    assert countdown["kind"] == "anniversary"
    assert any(e.get("reason") == "sync_metadata_unreadable" for e in logs)


@pytest.mark.asyncio
async def test_countdown_anniversary_already_passed_this_year(svc):
    people_with(svc, sub_starts={"40": "2024-03-01"})
    countdown = (await build(svc))["countdown"]
    assert countdown["kind"] == "anniversary"
    assert countdown["date"] == "2027-03-01" and countdown["years"] == 3
