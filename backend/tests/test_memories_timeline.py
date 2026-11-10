"""時光軸 timeline (``backend/services/memories/timeline.py``)."""

from __future__ import annotations

import dataclasses
import threading
from datetime import datetime, timezone

import pytest
from structlog.testing import capture_logs

from backend.services.memories import binder
from backend.services.memories import index as mi
from backend.services.memories import timeline as tl
from backend.services.memories import view_cache as vc
from backend.tests.memories_archive import msg, write_room
from backend.tests.test_memories_cards import fact

SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
ROOM = "messages/34 金村 美玖/58 金村 美玖"
NOW = datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc)
LONG = "本当にありがとう、大好きだよ。夢に向かって一緒に頑張ろうね、感謝しかない"
NAMES = ("金村", "美玖", "%%%")

ICONS = [
    {
        "kind": "thumbnail",
        "file": "thumbnail/a.jpg",
        "first_seen": "2025-01-01T00:00:00Z",
    },
    {
        "kind": "thumbnail",
        "file": "thumbnail/b.jpg",
        "first_seen": "2025-03-12T00:00:00Z",
    },
]


def pic(i, day, fav=False):
    return msg(
        i,
        f"2025-03-{day:02d}T03:00:00Z",
        "picture",
        fav=fav,
        media_file=f"messages/34 金村 美玖/58 金村 美玖/picture/{i}.jpg",
    )


@pytest.fixture
def svc(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    sdir = tmp_path / "out" / SVC_NAME
    pictures = [pic(20 + k, 10 + k, fav=k in (5, 10)) for k in range(14)]
    write_room(
        sdir,
        "34 金村 美玖",
        "58 金村 美玖",
        [
            # January: one message that is words, a nickname and late
            msg(1, "2025-01-10T14:30:00Z", content="%%%おやすみ〜まだ起きてるよ"),
            # (no February)
            msg(10, "2025-03-05T03:00:00Z", content=LONG, fav=True),
            msg(11, "2025-03-06T06:00:00Z", content="%%%またね"),
            msg(12, "2025-03-07T14:00:00Z", content="まだ起きてる？"),  # 23:00 JST
            msg(13, "2025-03-07T16:30:00Z", content="眠れないなあ"),  # 01:30 JST
            msg(14, "2025-03-08T03:00:00Z", content="お昼だよ"),  # 12:00, not late
            *pictures,
            msg(40, "2025-04-01T03:00:00Z", content="四月だね"),
        ],
        avatars=ICONS,
    )
    return sdir


async def kanemura(sdir):
    return (await mi.list_members(sdir))[0]


# --- months -------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_months_run_continuously_with_zero_gaps(svc):
    s = await kanemura(svc)
    payload = await tl.timeline_months(SERVICE, svc, s)
    assert payload == {
        "months": [
            {"month": "2025-01", "count": 1},
            {"month": "2025-02", "count": 0},  # the rail draws it empty
            {"month": "2025-03", "count": 19},
            {"month": "2025-04", "count": 1},
        ]
    }


@pytest.mark.asyncio
async def test_months_cross_a_year_end(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    sdir = tmp_path / "out" / SVC_NAME
    write_room(
        sdir,
        "34 金村 美玖",
        "58 金村 美玖",
        [
            msg(1, "2024-11-30T14:59:00Z", content="a"),  # 23:59 JST 11-30
            msg(2, "2024-11-30T15:00:00Z", content="b"),  # 00:00 JST 12-01
            msg(3, "2025-02-01T03:00:00Z", content="c"),
        ],
    )
    s = await kanemura(sdir)
    months = (await tl.timeline_months(SERVICE, sdir, s))["months"]
    assert [(m["month"], m["count"]) for m in months] == [
        ("2024-11", 1),
        ("2024-12", 1),
        ("2025-01", 0),
        ("2025-02", 1),
    ]


@pytest.mark.asyncio
async def test_months_of_a_person_without_facts(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    sdir = tmp_path / "out" / SVC_NAME
    write_room(sdir, "34 金村 美玖", "58 金村 美玖", [])
    s = await kanemura(sdir)
    assert await tl.timeline_months(SERVICE, sdir, s) == {"months": []}


@pytest.mark.asyncio
async def test_any_month_of_a_person_without_facts_is_out_of_range(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    sdir = tmp_path / "out" / SVC_NAME
    write_room(sdir, "34 金村 美玖", "58 金村 美玖", [])
    s = await kanemura(sdir)
    with pytest.raises(tl.MonthOutOfRange):
        await tl.timeline_month(SERVICE, sdir, s, "2025-01", now=NOW)


@pytest.mark.asyncio
async def test_a_malformed_month_raises_value_error(svc):
    s = await kanemura(svc)
    for month in ("2025-13", "2025-1", "x"):
        with pytest.raises(ValueError):
            await tl.timeline_month(SERVICE, svc, s, month, now=NOW)


@pytest.mark.asyncio
async def test_months_are_cached_by_room_hashes(svc):
    s = await kanemura(svc)
    with capture_logs() as logs:
        first = await tl.timeline_months(SERVICE, svc, s)
        again = await tl.timeline_months(SERVICE, svc, s)
    assert first == again
    outcomes = [
        e["outcome"]
        for e in logs
        if e["event"] == "memories_view_cache" and e["view"] == "timeline_months"
    ]
    assert outcomes == ["miss", "hit"]


# --- one month ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_month_slots_photos_and_avatar(svc):
    s = await kanemura(svc)
    m = await tl.timeline_month(SERVICE, svc, s, "2025-03", now=NOW)
    assert m["month"] == "2025-03" and m["count"] == 19
    slots = m["messages"]
    assert slots["top"]["id"] == 10 and slots["top"]["text"] == LONG
    assert slots["nickname"]["id"] == 11 and slots["nickname"]["text"] == "%%%またね"
    assert slots["late"]["id"] == 13  # 01:30 counts as 25:30, later than 23:00
    assert slots["late"]["text"] == "眠れないなあ"
    # photo cap: the two favourites plus the ten earliest, in time order
    ids = [p["id"] for p in m["photos"]]
    assert len(ids) == 12
    assert ids == [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]
    assert {25, 30} <= set(ids) and ids == sorted(ids)
    assert m["photos"][0]["media_file"] == f"{ROOM}/picture/20.jpg"
    assert m["photos"][0]["avatar_url"].endswith("/a.jpg")  # 03-10 < 03-12
    assert m["avatar_url"].endswith("/b.jpg")  # mid-month (03-16) avatar


@pytest.mark.asyncio
async def test_month_avatar_is_clamped_to_now(svc):
    s = await kanemura(svc)
    early = datetime(2025, 3, 11, 0, 0, tzinfo=timezone.utc)
    m = await tl.timeline_month(SERVICE, svc, s, "2025-03", now=early)
    assert m["avatar_url"].endswith("/a.jpg")


@pytest.mark.asyncio
async def test_month_slot_uniqueness_and_skips(svc):
    s = await kanemura(svc)
    with capture_logs() as logs:
        m = await tl.timeline_month(SERVICE, svc, s, "2025-01", now=NOW)
    assert m["count"] == 1
    assert m["messages"]["top"]["id"] == 1  # also a nickname and late: one slot
    assert m["messages"]["nickname"] is None and m["messages"]["late"] is None
    assert m["photos"] == []
    skips = sorted(
        e["reason"]
        for e in logs
        if e["event"] == "memories_skip" and e.get("view") == "timeline"
    )
    assert skips == ["no_late", "no_nickname"]
    sel = next(
        e for e in logs if e["event"] == "memories_select" and e["view"] == "timeline"
    )
    assert sel["view"] == "timeline" and sel["rule"] == "top"
    assert sel["message_id"] == 1 and sel["fallback"] is None
    for e in logs:
        assert not any(n in str(v) for v in e.values() for n in NAMES), e


@pytest.mark.asyncio
async def test_month_inside_the_range_without_messages(svc):
    s = await kanemura(svc)
    with capture_logs() as logs:
        m = await tl.timeline_month(SERVICE, svc, s, "2025-02", now=NOW)
    assert m["count"] == 0 and m["photos"] == [] and m["milestones"] == []
    assert m["messages"] == {"top": None, "late": None, "nickname": None}
    skips = {e["reason"] for e in logs if e["event"] == "memories_skip"}
    assert {"no_top", "no_late", "no_nickname"} <= skips


@pytest.mark.asyncio
async def test_month_milestones(svc):
    s = await kanemura(svc)
    jan = await tl.timeline_month(SERVICE, svc, s, "2025-01", now=NOW)
    keys = {m["key"]: m for m in jan["milestones"]}
    assert keys["first.message"] == {
        "key": "first.message",
        "date": "2025-01-10",
        "foil": False,
    }
    assert keys["first.nickname"]["foil"] is True
    assert keys["special.newyear"]["date"] == "2025-01-10"  # a stacked year
    march = await tl.timeline_month(SERVICE, svc, s, "2025-03", now=NOW)
    march_keys = [m["key"] for m in march["milestones"]]
    assert "first.picture" in march_keys and "first.message" not in march_keys


@pytest.mark.asyncio
async def test_month_outside_the_range_raises(svc):
    s = await kanemura(svc)
    for month in ("2024-12", "2025-05"):
        with pytest.raises(tl.MonthOutOfRange):
            await tl.timeline_month(SERVICE, svc, s, month, now=NOW)


@pytest.mark.asyncio
async def test_month_is_cached_text_free(svc, monkeypatch):
    s = await kanemura(svc)
    stored = []
    real = vc._write

    def spy(service_dir, view, key, data_hash, blob):
        stored.append((view, blob))
        real(service_dir, view, key, data_hash, blob)

    monkeypatch.setattr(vc, "_write", spy)
    with capture_logs() as logs:
        first = await tl.timeline_month(SERVICE, svc, s, "2025-03", now=NOW)
        again = await tl.timeline_month(SERVICE, svc, s, "2025-03", now=NOW)
    assert first == again and again["messages"]["top"]["text"] == LONG
    views = [v for v, _ in stored]
    assert views.count("timeline_month") == 1
    blob = next(b for v, b in stored if v == "timeline_month")
    assert LONG not in blob and "またね" not in blob
    outcomes = [
        e["outcome"]
        for e in logs
        if e["event"] == "memories_view_cache" and e["view"] == "timeline_month"
    ]
    assert outcomes == ["miss", "hit"]


def _card(key, earned, date=None, foil=False, years=()):
    """One card of a binder payload (only the fields milestones reads)."""
    return {
        "key": key,
        "earned": earned,
        "foil": foil,
        "date": date,
        "years": [{"year": int(y[:4]), "date": y, "face": None} for y in years],
    }


def test_milestones_from_card_dates_and_stacked_years():
    cards = [
        _card("first.message", True, "2025-03-02"),
        _card("numbers.messages.100", True, "2025-03-30", foil=True),
        _card("first.video", False, "2025-03-03"),  # unearned
        _card("first.voice", True, None),
        _card("first.picture", True, "2025-04-01"),
        _card(
            "special.birthday",
            True,
            "2026-03-09",
            foil=True,
            years=("2025-03-09", "2026-03-09"),
        ),
    ]
    assert tl.milestones(cards, "2025-03") == [
        {"key": "first.message", "date": "2025-03-02", "foil": False},
        {"key": "special.birthday", "date": "2025-03-09", "foil": True},
        {"key": "numbers.messages.100", "date": "2025-03-30", "foil": True},
    ]
    assert tl.milestones(cards, "2026-03") == [
        {"key": "special.birthday", "date": "2026-03-09", "foil": True}
    ]


def test_late_key_counts_small_hours_after_midnight():
    assert tl.late_key(1, 30, 0) > tl.late_key(23, 0, 0)
    assert tl.late_key(4, 59, 59) > tl.late_key(0, 0, 0) > tl.late_key(22, 0, 0)
    assert not tl.is_late(5) and not tl.is_late(21)
    assert tl.is_late(22) and tl.is_late(0) and tl.is_late(4)


@pytest.mark.asyncio
async def test_months_hash_carries_a_version(svc, monkeypatch):
    s = await kanemura(svc)
    with capture_logs() as logs:
        await tl.timeline_months(SERVICE, svc, s)
        monkeypatch.setattr(
            tl, "TIMELINE_MONTHS_VERSION", tl.TIMELINE_MONTHS_VERSION + 1
        )
        await tl.timeline_months(SERVICE, svc, s)
    outcomes = [
        e["outcome"]
        for e in logs
        if e["event"] == "memories_view_cache" and e["view"] == "timeline_months"
    ]
    assert outcomes == ["miss", "miss"]  # a rule change is never served stale


@pytest.mark.asyncio
async def test_month_counting_runs_off_the_event_loop(svc, monkeypatch):
    s = await kanemura(svc)
    loop_thread = threading.get_ident()
    threads: set[int] = set()
    real = tl.month_of

    def spy(day):
        threads.add(threading.get_ident())
        return real(day)

    monkeypatch.setattr(tl, "month_of", spy)
    months = (await tl.timeline_months(SERVICE, svc, s))["months"]
    assert months[0] == {"month": "2025-01", "count": 1}
    assert threads and loop_thread not in threads


def _pic(i, when, score, caption=None, promo=False):
    return dataclasses.replace(
        fact(i, when, "picture", promo=promo, importance=None),
        photo_score=score,
        caption_id=caption,
    )


def test_a_photo_caption_message_never_fills_a_slot():
    words = fact(1, "2025-03-01 12:00", importance=90)  # the photo's caption
    pic = _pic(2, "2025-03-01 12:01", 100, caption=1)
    other = fact(3, "2025-03-02 12:00", importance=10)
    photos, slots = tl._pick([("r", words), ("r", pic), ("r", other)])
    assert [f.id for _, f in photos] == [2]
    top = slots["top"]
    assert top is not None and top[1].id == 3  # not 1, shown under the photo


def test_promo_media_and_words_are_left_out_of_photos_and_slots():
    promo_pic = _pic(1, "2025-03-01 12:00", 500, promo=True)
    promo_words = fact(2, "2025-03-01 13:00", promo=True, importance=99)
    pic = _pic(3, "2025-03-02 12:00", 10)
    words = fact(4, "2025-03-02 13:00", importance=5)
    month = [("r", f) for f in (promo_pic, promo_words, pic, words)]
    photos, slots = tl._pick(month)
    assert [f.id for _, f in photos] == [3]
    top = slots["top"]
    assert top is not None and top[1].id == 4


@pytest.mark.asyncio
async def test_month_miss_reads_the_warmed_binder_and_evaluates_nothing(
    svc, monkeypatch
):
    s = await kanemura(svc)
    await binder.binder_payload(SERVICE, svc, s, now=NOW)  # e.g. the memoir list
    calls = []
    real = binder._evaluate

    async def counting(*a, **kw):
        calls.append(1)
        return await real(*a, **kw)

    monkeypatch.setattr(binder, "_evaluate", counting)
    with capture_logs() as logs:
        m = await tl.timeline_month(SERVICE, svc, s, "2025-01", now=NOW)
    assert calls == []
    assert not [e for e in logs if e["event"] == "memories_cards"]
    outcomes = [
        (e["view"], e["outcome"]) for e in logs if e["event"] == "memories_view_cache"
    ]
    assert outcomes == [("binder", "hit"), ("timeline_month", "miss")]
    assert "first.message" in {x["key"] for x in m["milestones"]}


def test_binder_cards_flattens_every_shelf():
    payload = {
        "shelves": [
            {"key": "first", "cards": [_card("a", True)]},
            {"key": "special", "cards": [_card("b", False), _card("c", True)]},
        ]
    }
    assert [x["key"] for x in tl.binder_cards(payload)] == ["a", "b", "c"]
