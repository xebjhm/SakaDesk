"""彼女の24時間 (``backend/services/memories/day24.py``)."""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
import time_machine
from structlog.testing import capture_logs

from backend.services.memories import day24
from backend.services.memories import index as mi
from backend.services.memories.selection import JST
from backend.tests.memories_archive import msg, write_room

SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
ROOM = "messages/34 金村 美玖/58 金村 美玖"
NOW = datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc)  # 12:00 JST
PROMO = "%%%へお知らせ！写真集の予約が始まったよ https://example.jp " + "あ" * 80


def at(y: int, mo: int, d: int, h: int, mi_: int = 0) -> str:
    """The archive UTC timestamp of a JST wall-clock time."""
    local = datetime(y, mo, d, h, mi_, tzinfo=JST)
    return local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def pic(i: int, ts: str, **extra) -> dict:
    return msg(
        i,
        ts,
        "picture",
        media_file=f"{ROOM}/picture/{i}.jpg".replace("/", "\\"),
        **extra,
    )


@pytest.fixture
def svc(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    return tmp_path / "out" / SVC_NAME


def kane(sdir, msgs):
    write_room(sdir, "34 金村 美玖", "58 金村 美玖", msgs)


async def person(sdir):
    (summary,) = await mi.list_members(sdir)
    return summary


async def build(sdir, seed=None, now=NOW):
    summary = await person(sdir)
    with time_machine.travel(now, tick=False):
        return await day24.build_day24(
            SERVICE, sdir, summary, seed=seed, now=datetime.now(timezone.utc)
        )


def hours_of(payload) -> list[int]:
    out = []
    for s in payload["slots"]:
        ts = datetime.fromisoformat(s["message"]["ts"].replace("Z", "+00:00"))
        out.append(ts.astimezone(JST).hour)
    return out


# --- pure rules ---------------------------------------------------------------------------


def test_greeting_slots_then_spaced_busiest_hours():
    hist = [0] * 24
    hist[2] = 1
    hist[7], hist[8] = 2, 3  # ohayo band: the peak hour is 8
    hist[10] = 2
    hist[12] = 1  # ohiru
    hist[15], hist[16] = 4, 3  # 16 is 1 h from 15: skipped
    hist[18] = 1  # otsukare
    hist[22] = 1  # oyasumi
    assert day24.choose_slots(hist) == [
        ("hour", 2),
        ("ohayo", 8),
        ("hour", 10),
        ("ohiru", 12),
        ("hour", 15),
        ("otsukare", 18),
        ("oyasumi", 22),
    ]


def test_extras_stop_at_seven_slots():
    hist = [1] * 24
    slots = day24.choose_slots(hist)
    assert len(slots) == day24.MAX_SLOTS
    hours = [h for _, h in slots]
    for a in hours:
        for b in hours:
            if a != b:
                assert day24.hour_distance(a, b) >= day24.MIN_GAP_H


def test_hours_under_one_percent_are_not_added():
    hist = [0] * 24
    hist[7] = hist[12] = hist[18] = hist[22] = 100
    hist[15] = 3  # 3 / 403 < 1 %
    hist[2] = 5  # 5 / 405 >= 1 %
    slots = day24.choose_slots(hist)
    assert [h for _, h in slots] == [2, 7, 12, 18, 22]
    hist[2] = 3
    assert day24.choose_slots(hist) == []  # 4 slots: too thin


def test_empty_histogram_has_no_slots():
    assert day24.choose_slots([0] * 24) == []


def test_window_is_thirty_minutes_across_midnight():
    slot_23 = 23 * 60 + 30
    slot_0 = 30
    assert day24.in_window(23 * 60 + 50, slot_23)
    assert day24.in_window(0, slot_23)  # 00:00 is +30 min from 23:30
    assert not day24.in_window(10, slot_23)  # 00:10 is +40 min
    assert day24.in_window(10, slot_0)
    assert not day24.in_window(23 * 60 + 50, slot_0)  # 23:50 is -40 min
    assert day24.hour_distance(23, 0) == 1


# --- build_day24 -------------------------------------------------------------------------


def full_day(start_id: int = 1, years=(2023, 2024, 2025)) -> list[dict]:
    """Five slots (8, 12, 15, 18, 22 h) with one message per year in each."""
    out = []
    i = start_id
    for y in years:
        out += [
            msg(i, at(y, 3, 1, 8, 10), content="おはよう☀️"),
            pic(i + 1, at(y, 3, 2, 12, 20)),
            msg(i + 2, at(y, 3, 3, 15, 40), content="レッスン終わった"),
            msg(i + 3, at(y, 3, 4, 18, 5), content="お疲れさま"),
            msg(i + 4, at(y, 3, 5, 22, 45), content="おやすみ🌙"),
        ]
        i += 5
    return out


@pytest.mark.asyncio
async def test_build_fills_slots_in_time_order(svc):
    kane(svc, full_day())
    with capture_logs() as logs:
        got = await build(svc)
    assert [s["code"] for s in got["slots"]] == [
        "ohayo",
        "ohiru",
        "hour",
        "otsukare",
        "oyasumi",
    ]
    assert hours_of(got) == [8, 12, 15, 18, 22]
    first = got["slots"][0]["message"]
    assert first["text"] == "おはよう☀️" and first["member_path"].endswith(ROOM)
    assert got["seed"] == date(2026, 11, 10).toordinal()
    years = {s["message"]["ts"][:4] for s in got["slots"]}
    assert got["years"] == len(years)
    (ev,) = [e for e in logs if e["event"] == "memories_day24"]
    assert ev["slots"] == 5 and ev["years"] == got["years"]
    assert ev["rerolled"] is False
    picks = [e for e in logs if e["event"] == "memories_select"]
    assert [e["rule"] for e in picks] == [s["code"] for s in got["slots"]]
    assert all(e["view"] == "day24" for e in picks)
    assert [e["message_id"] for e in picks] == [
        s["message"]["id"] for s in got["slots"]
    ]
    assert all(isinstance(e["score"], int) for e in picks)


@pytest.mark.asyncio
async def test_same_seed_same_day_other_seed_other_day(svc):
    kane(svc, full_day())
    a = await build(svc, seed=7)
    b = await build(svc, seed=7)
    ids = lambda p: [s["message"]["id"] for s in p["slots"]]  # noqa: E731
    assert ids(a) == ids(b) and a["seed"] == 7
    others = {tuple(ids(await build(svc, seed=s))) for s in range(8, 14)}
    assert others - {tuple(ids(a))}
    with capture_logs() as logs:
        await build(svc, seed=7)
    (ev,) = [e for e in logs if e["event"] == "memories_day24"]
    assert ev["rerolled"] is True


@pytest.mark.asyncio
async def test_same_jst_date_same_day(svc):
    kane(svc, full_day())
    morning = datetime(2026, 11, 9, 15, 30, tzinfo=timezone.utc)  # 11-10 00:30 JST
    night = datetime(2026, 11, 10, 14, 30, tzinfo=timezone.utc)  # 11-10 23:30 JST
    a = await build(svc, now=morning)
    b = await build(svc, now=night)
    assert a == b


@pytest.mark.asyncio
async def test_years_vary_when_possible(svc):
    # 8 h: only 2024. 12 h: five nickname words of 2024 and one plain 2023 word.
    # Without the year penalty the 2023 word ranks 6th and is never drawn.
    msgs = [msg(1, at(2024, 1, 1, 8, 10), content="おはよう")]
    msgs += [
        msg(10 + k, at(2024, 2, 1 + k, 12, 15), content=f"%%%ちゃん{k}")
        for k in range(5)
    ]
    msgs.append(msg(20, at(2023, 2, 1, 12, 15), content="こんにちは"))
    msgs += [
        msg(30, at(2025, 1, 1, 15, 0), content="a"),
        msg(31, at(2025, 1, 1, 18, 0), content="b"),
        msg(32, at(2025, 1, 1, 22, 0), content="c"),
    ]
    kane(svc, msgs)
    drawn = set()
    for seed in range(20):
        got = await build(svc, seed=seed)
        drawn.add(got["slots"][1]["message"]["id"])
    assert 20 in drawn


def test_rank_weights_keep_order_after_the_penalty():
    # Higher score, more weight; equal scores, equal weight; a penalised
    # (negative) score still weighs less than a fresh one.
    assert day24.rank_weights([0, -150, -150]) == [2, 1, 1]
    assert day24.rank_weights([300, 200, 200, -70, -150]) == [4, 3, 3, 2, 1]
    assert day24.rank_weights([5, 5]) == [1, 1]


@pytest.mark.asyncio
async def test_years_vary_through_the_weights(svc):
    # 8 h: only 2024. 12 h: a 2024 picture (100 - 150 = -50) and a plain 2023
    # word (0). Both are in the top 5; the fresh year must be drawn more often.
    msgs = [msg(1, at(2024, 1, 1, 8, 10), content="おはよう")]
    msgs += [
        pic(10, at(2024, 2, 1, 12, 15)),
        msg(20, at(2023, 2, 1, 12, 15), content="こんにちは"),
        msg(30, at(2025, 1, 1, 15, 0), content="a"),
        msg(31, at(2025, 1, 1, 18, 0), content="b"),
        msg(32, at(2025, 1, 1, 22, 0), content="c"),
    ]
    kane(svc, msgs)
    summary = await person(svc)
    tagged = await day24.get_person_facts(svc, summary)
    runs = 300
    fresh = sum(day24._pick(tagged, seed)[1][2][1].id == 20 for seed in range(runs))
    assert fresh > 0.6 * runs


def test_score_rules():
    from backend.services.memories.facts import Fact

    def fact(**kw) -> Fact:
        base = dict(
            id=1,
            ts=datetime(2024, 1, 1, tzinfo=timezone.utc),
            jst_date=date(2024, 1, 1),
            hour=9,
            minute=0,
            type="text",
            is_promo=False,
            has_nickname=False,
            greeting_mask=0,
            chars=5,
            importance=5,
            photo_score=None,
            burst_id=None,
            caption_id=None,
            favorited=False,
            media_file=None,
            duration_s=None,
        )
        base.update(kw)
        return Fact(**base)

    from backend.services.memories.lexicon import GREETING_BITS

    ohayo = GREETING_BITS["ohayo"]
    assert day24.score(fact(), "hour", set()) == 0
    assert day24.score(fact(greeting_mask=ohayo), "ohayo", set()) == 200
    assert day24.score(fact(greeting_mask=ohayo), "hour", set()) == 0
    assert day24.score(fact(type="picture", photo_score=255), "hour", set()) == 125
    assert day24.score(fact(type="video", photo_score=None), "hour", set()) == 100
    assert day24.score(fact(has_nickname=True), "hour", set()) == 80
    assert day24.score(fact(favorited=True), "hour", set()) == 300
    assert day24.score(fact(), "hour", {2024}) == -150


@pytest.mark.asyncio
async def test_promo_is_never_picked(svc):
    msgs = full_day(years=(2025,))
    # A favourited promo at 8 h would outscore everything if it were a candidate.
    msgs.append(msg(90, at(2024, 5, 1, 8, 20), content=PROMO, fav=True))
    # A promo-only hour never becomes a slot.
    msgs += [msg(91 + k, at(2024, 5, 2 + k, 3, 0), content=PROMO) for k in range(3)]
    kane(svc, msgs)
    for seed in range(10):
        got = await build(svc, seed=seed)
        assert 90 not in [s["message"]["id"] for s in got["slots"]]
        assert 3 not in hours_of(got)


@pytest.mark.asyncio
async def test_one_year_counts_one(svc):
    kane(svc, full_day(years=(2025,)))
    got = await build(svc)
    assert got["years"] == 1 and len(got["slots"]) == 5


@pytest.mark.asyncio
async def test_thin_day_is_empty(svc):
    kane(
        svc,
        [
            msg(1, at(2025, 1, 1, 8), content="おはよう"),
            msg(2, at(2025, 1, 1, 12), content="お昼"),
            msg(3, at(2025, 1, 1, 18), content="お疲れ"),
            msg(4, at(2025, 1, 1, 22), content="おやすみ"),
        ],
    )
    with capture_logs() as logs:
        got = await build(svc)
    assert got == {"slots": []}
    (ev,) = [e for e in logs if e["event"] == "memories_day24"]
    assert ev["slots"] == 0 and ev["years"] == 0


@pytest.mark.asyncio
async def test_a_person_with_no_messages_is_empty(svc):
    kane(svc, [])
    assert await build(svc) == {"slots": []}


@pytest.mark.asyncio
async def test_late_slot_window_crosses_midnight_end_to_end(svc):
    # oyasumi slot at 23:30: 23:50 and 00:00 are candidates, a favourited
    # 00:10 (40 min later) never is. Hour 0 is 1 h from 23, so no slot of its own.
    msgs = [
        msg(1, at(2025, 1, 1, 8), content="おはよう"),
        msg(2, at(2025, 1, 1, 12), content="お昼"),
        msg(3, at(2025, 1, 1, 15), content="レッスン"),
        msg(4, at(2025, 1, 1, 18), content="お疲れ"),
        msg(5, at(2024, 1, 1, 23, 50), content="まだ起きてる"),
        msg(6, at(2023, 1, 2, 0, 0), content="日付変わった"),
        msg(7, at(2022, 1, 2, 0, 10), content="寝るね", fav=True),
    ]
    kane(svc, msgs)
    late = set()
    for seed in range(30):
        got = await build(svc, seed=seed)
        assert [s["code"] for s in got["slots"]][-1] == "oyasumi"
        assert 0 not in hours_of(got)[:-1]
        late.add(got["slots"][-1]["message"]["id"])
    assert late == {5, 6}
