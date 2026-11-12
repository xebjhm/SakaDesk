"""Subscription welcome messages and the 元旦 rule (memories feedback r4 §1 + §6).

When a fan subscribes, a member's room sends an automatic greeting
(「%%%さん追加ありがとう御座います」). The index flags it (``is_welcome``) and
every selector that shows "her words" skips it; count cards still count it.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date, datetime, timezone

import pytest
import time_machine

from backend.services import app_state
from backend.services.memories import cards as c
from backend.services.memories import facts as mf
from backend.services.memories import hub
from backend.services.memories import index as mi
from backend.services.memories import nickname_moments as nm
from backend.services.memories import recap
from backend.services.memories import selection as sel
from backend.services.memories.facts import Fact
from backend.services.memories.selection import JST
from backend.tests import memories_archive as arch

SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
ROOM = ("90 高井 俐香", "142 高井 俐香")
ROOM_REL = f"messages/{ROOM[0]}/{ROOM[1]}"

WELCOME = (
    "%%%さん追加ありがとう御座います。\r\n高井俐香です🎠！\r\n\r\nこれからよろしくね♩"
)
SECOND = "きみとたくさん思い出作りたい\r\nよろしく( .ˬ. )"
REWARD = "わーいわーい♬\r\nもうすでに登録してくれた%%%にご褒美っ！"
LATER_THANKS = "推しメン登録してくれてありがとう！%%%、一年間ありがとう"


def utc(jst: str) -> str:
    """``YYYY-MM-DD HH:MM[:SS]`` in JST -> archive UTC timestamp."""
    fmt = "%Y-%m-%d %H:%M:%S" if jst.count(":") == 2 else "%Y-%m-%d %H:%M"
    local = datetime.strptime(jst, fmt).replace(tzinfo=JST)
    return local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def m(i: int, jst: str, content: str = "", type_: str = "text", **extra) -> dict:
    return arch.msg(i, utc(jst), type_, content, **extra)


@pytest.fixture
def svc(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    app_state.set_db_path(tmp_path / "app.db")
    app_state.init_db()
    s = tmp_path / SVC_NAME
    s.mkdir()
    return s


ROWS = [
    m(419388, "2025-11-01 00:04:32", WELCOME),
    m(419672, "2025-11-01 07:01", REWARD),
    m(419696, "2025-11-01 08:54", SECOND),
    m(430001, "2026-01-01 00:10", "あけましておめでとう🎍今年もよろしくね"),
    m(430002, "2026-01-01 12:00", "お正月はおもちを食べたよ、ありがとう大好き"),
    m(440001, "2026-02-01 00:02", "日付が変わったね、おやすみ"),
    m(453054, "2026-05-03 01:36", LATER_THANKS),
]


async def room_facts(svc, rows, sub_start="2025-11-01"):
    d = arch.write_room(svc, *ROOM, rows)
    arch.write_side_inputs(svc, sub_starts={"90": sub_start} if sub_start else {})
    idx = await mi.get_member_index(svc, d)
    return idx, {f.id: f for f in mf.facts_in_range(svc, d)}


# --- detection (index) -----------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        WELCOME,
        "ご登録ありがとうございます！\r\n\r\n大野愛実だよ🦀",
        'ご登録くださり\r\nありがとうございます( .ˬ.)"',
        "ご機嫌よう🍵\r\n追加して下さりありがとうございます！！",
        "松尾桜です🌸\r\n\r\nご登録して頂き本当に本当にありがとうございます！！",
        "私のメッセージを登録してくださりありがとございますっ♡",
        "ご登録本当にありがとうございます˘͈ᵕ˘͈",
    ],
)
def test_welcome_phrase_matches_the_real_greetings(text):
    assert sel.is_welcome_text(text)


@pytest.mark.parametrize(
    "text",
    [
        REWARD,  # 登録 without ありがとう
        "いつもありがとう！",  # ありがとう without 登録 / 追加
        "新曲が追加されたよ。聴いてね！ありがとう",  # a sentence ends in between
        "",
    ],
)
def test_welcome_phrase_rejects_other_thanks(text):
    assert not sel.is_welcome_text(text)


@pytest.mark.asyncio
async def test_index_flags_only_the_opening_welcome(svc):
    idx, facts = await room_facts(svc, ROWS)
    flagged = sorted(i for i, f in facts.items() if f.is_welcome)
    assert flagged == [419388]
    # the welcome is never "her words": no importance, no nickname count
    assert facts[419388].importance is None
    assert facts[419388].has_nickname  # the raw flag is kept
    assert facts[419696].importance is not None
    # a later 登録 + ありがとう is her own message: not flagged, still scored
    assert not facts[453054].is_welcome and facts[453054].importance is not None
    # 登録 at position 1 without ありがとう is not a welcome either
    assert not facts[419672].is_welcome
    assert idx.nickname_count == 2  # 419672 and 453054; not the welcome
    assert idx.first_nickname_id == 419672


@pytest.mark.asyncio
async def test_welcome_needs_the_room_opening_or_the_subscription_day(svc):
    rows = [
        m(1, "2024-05-01 12:00", "はじめまして！今日からよろしくね"),
        m(2, "2024-05-01 12:05", "写真もたくさん送るね"),
        m(3, "2024-05-01 12:10", "今日はレッスンでした"),
        m(4, "2024-05-02 09:00", "おはよう"),
        # the welcome on the subscription day, long after the room opened
        m(5, "2025-11-01 00:06", "ご登録ありがとうございます！これからよろしくね"),
        m(6, "2025-11-01 10:00", "今日もがんばるね"),
        m(7, "2025-12-01 10:00", "ご登録ありがとうございます！の気持ちを忘れずに"),
    ]
    _, facts = await room_facts(svc, rows)
    assert sorted(i for i, f in facts.items() if f.is_welcome) == [5]
    _, facts = await room_facts(svc, rows, sub_start=None)
    assert not any(f.is_welcome for f in facts.values())


@pytest.mark.asyncio
async def test_welcome_must_be_text(svc):
    rows = [
        m(1, "2025-11-01 00:04", "ご登録ありがとうございます！", "picture"),
        m(2, "2025-11-01 09:00", "おはよう"),
    ]
    _, facts = await room_facts(svc, rows)
    assert not facts[1].is_welcome


def test_older_db_gains_the_welcome_column(tmp_path):
    path = tmp_path / "old.db"
    with sqlite3.connect(path) as conn:
        conn.execute(
            "CREATE TABLE message_facts (service_dir TEXT NOT NULL, member_dir TEXT "
            "NOT NULL, id INTEGER NOT NULL, ts_utc TEXT NOT NULL, jst_date TEXT NOT "
            "NULL, hour INTEGER NOT NULL, minute INTEGER NOT NULL, type TEXT NOT NULL,"
            " is_promo INTEGER NOT NULL, has_nickname INTEGER NOT NULL, greeting_mask"
            " INTEGER NOT NULL, chars INTEGER NOT NULL, importance INTEGER, "
            "photo_score INTEGER, burst_id INTEGER, caption_id INTEGER, favorited "
            "INTEGER NOT NULL, media_file TEXT, duration_s REAL, PRIMARY KEY("
            "service_dir, member_dir, id)) WITHOUT ROWID"
        )
    mi.set_db_path(path)
    with mi._connect() as conn:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(message_facts)")]
    conn.close()
    assert "is_welcome" in cols
    mi._connect().close()  # a second open does not add it again


# --- facts helpers ---------------------------------------------------------------


def fact(i, when, *, welcome=False, nick=False, importance=10) -> Fact:
    local = datetime.strptime(when, "%Y-%m-%d %H:%M").replace(tzinfo=JST)
    return Fact(
        id=i,
        ts=local.astimezone(timezone.utc),
        jst_date=local.date(),
        hour=local.hour,
        minute=local.minute,
        type="text",
        is_promo=False,
        has_nickname=nick,
        greeting_mask=0,
        chars=10,
        importance=None if welcome else importance,
        photo_score=None,
        burst_id=None,
        caption_id=None,
        favorited=False,
        media_file=None,
        duration_s=None,
        is_welcome=welcome,
    )


def test_select_and_aggregate_skip_the_welcome():
    fs = [
        fact(1, "2025-11-01 00:04", welcome=True, nick=True),
        fact(2, "2025-11-01 08:54", nick=True),
    ]
    assert [f.id for f in mf.select(fs)] == [2]
    assert [f.id for f in mf.select(fs, include_welcome=True)] == [1, 2]
    agg = mf.aggregate(fs)
    assert agg.first.id == 2 and agg.total == 2 and agg.nickname_count == 1
    assert mf.first_last(fs) == (fs[1], fs[1])


def test_new_year_midnight_is_1_1_before_00_30_jst():
    assert mf.is_new_year_midnight(fact(1, "2026-01-01 00:29"))
    assert not mf.is_new_year_midnight(fact(2, "2026-01-01 00:30"))
    assert not mf.is_new_year_midnight(fact(3, "2025-11-01 00:04"))


# --- cards ------------------------------------------------------------------------


def tagged(fs):
    return [(ROOM_REL, f) for f in sorted(fs, key=lambda f: (f.ts, f.id))]


def evaluate(fs, start=date(2025, 11, 1)):
    inp = c.CardInputs(
        facts=tagged(fs),
        today=date(2026, 11, 12),
        subscription_start=start,
        birthday=None,
        graduated=False,
        letters=(),
        avatar_changes=(),
    )
    return {card.key: card for card in c.evaluate(inp)}


def mk(i):
    return c.MessageKey(ROOM_REL, i)


CARD_FACTS = [
    fact(1, "2025-11-01 00:04", welcome=True, nick=True),
    fact(2, "2025-11-01 08:54", importance=5),
    fact(3, "2025-11-02 09:00", nick=True),
    fact(4, "2026-01-01 00:10", importance=1),
    fact(5, "2026-01-01 12:00", importance=90),
    fact(6, "2026-02-01 00:02"),
]


def test_welcome_block_gets_no_newyear_and_no_first_message():
    k = evaluate(CARD_FACTS)
    ny = k["special.newyear"]
    # 2025 has no 1/1 message (the archive starts on 11/1): no entry
    assert [(y.year, y.date, y.message) for y in ny.years] == [
        (2026, date(2026, 1, 1), mk(4))  # 00:10 beats the higher-importance 12:00
    ]
    assert k["first.message"].message == mk(2)
    assert k["first.nickname"].message == mk(3)
    midnight = k["moment.midnight"]
    assert midnight.message == mk(6) and midnight.detail == {"count": 1}
    assert k["count.messages.100"].progress == (6, 100)  # counts keep it


def test_newyear_without_midnight_takes_the_best_of_1_1():
    fs = [
        fact(1, "2026-01-01 09:00", importance=3),
        fact(2, "2026-01-01 15:00", importance=30),
        fact(3, "2027-01-02 00:05"),  # not 1/1: no 2027 entry
    ]
    ny = evaluate(fs)["special.newyear"]
    assert [(y.year, y.message) for y in ny.years] == [(2026, mk(2))]


def test_newyear_never_shows_a_welcome_on_1_1():
    fs = [
        fact(1, "2026-01-01 00:01", welcome=True),
        fact(2, "2026-01-01 00:20"),
    ]
    assert evaluate(fs, start=date(2026, 1, 1))["special.newyear"].message == mk(2)
    alone = evaluate(fs[:1], start=date(2026, 1, 1))["special.newyear"]
    assert not alone.earned and alone.years == ()


def test_join_day_card_shows_her_own_words_of_that_day():
    card = evaluate(CARD_FACTS)["special.join_day"]
    assert card.earned and card.shelf == "special"
    assert card.date == date(2025, 11, 1)
    assert card.message == mk(2)


def test_join_day_with_only_the_welcome_is_the_label_alone():
    card = evaluate(CARD_FACTS[:1] + CARD_FACTS[2:])["special.join_day"]
    assert card.earned and card.date == date(2025, 11, 1)
    assert card.message is None


def test_join_day_is_hidden_without_a_subscription_start():
    assert "special.join_day" not in evaluate(CARD_FACTS, start=None)


def test_join_day_in_the_future_is_a_silhouette():
    card = evaluate(CARD_FACTS, start=date(2027, 1, 1))["special.join_day"]
    assert not card.earned and card.message is None


def test_other_faces_skip_the_welcome():
    fs = [
        fact(1, "2025-11-01 00:04", welcome=True, nick=True),
        fact(2, "2025-11-01 00:05", welcome=True, nick=True),
    ]
    k = evaluate(fs)
    assert not k["first.message"].earned
    assert not k["first.nickname"].earned
    assert not k["moment.midnight"].earned
    # the busiest / nickname day still count the day, with no welcome face
    assert k["record.busiest_day"].detail == {"count": 2}
    assert k["record.busiest_day"].message is None
    assert k["count.messages.100"].progress == (2, 100)


# --- recap ------------------------------------------------------------------------


async def recap_slides(svc, rows, year, when):
    arch.write_room(svc, *ROOM, rows)
    arch.write_side_inputs(svc, sub_starts={"90": "2025-11-01"})
    with time_machine.travel(when, tick=False):
        summary = (await mi.list_members(svc))[0]
        payload = await recap.build_member_recap(
            SERVICE, svc, summary, year, now=datetime.now(timezone.utc)
        )
    return payload


def _plain(start_id, n, month):
    return [
        m(start_id + k, f"2025-{month}-{1 + k:02d} 20:00", f"きょうの話{k}")
        for k in range(n)
    ]


@pytest.mark.asyncio
async def test_recap_join_year_opens_with_her_own_first_words(svc):
    rows = [
        ROWS[0],  # the welcome, 11/1 00:04 with %%%
        m(419696, "2025-11-01 08:54", SECOND),
        m(419800, "2025-11-02 07:01", REWARD),
        *_plain(500, 25, 12),
    ]
    payload = await recap_slides(
        svc, rows, 2025, datetime(2025, 12, 28, 12, 0, tzinfo=JST)
    )
    s = {slide["key"]: slide for slide in payload["slides"]}
    assert s["s01_first"]["data"]["message"]["id"] == 419696
    assert s["s02_name"]["data"]["count"] == 1  # the welcome's %%% is not counted
    assert "419388" not in json.dumps(payload)  # no slide shows the welcome


# --- hub and name moments ---------------------------------------------------------


def test_hub_first_words_skip_the_welcome():
    fs = tagged(CARD_FACTS)
    assert hub._first_words(fs) == (ROOM_REL, CARD_FACTS[1])


@pytest.mark.asyncio
async def test_name_moments_leave_out_the_welcome(svc):
    arch.write_room(svc, *ROOM, ROWS)
    arch.write_side_inputs(svc, sub_starts={"90": "2025-11-01"})
    summary = (await mi.list_members(svc))[0]
    payload = await nm.nickname_moments(SERVICE, svc, summary, year=None)
    ids = [i["message"]["id"] for i in payload["items"]]
    assert 419388 not in ids and ids == [453054, 419672]
