"""回憶扭蛋 gacha (``backend/services/memories/gacha.py``)."""

from __future__ import annotations

import asyncio
import contextlib
import json
import random
import threading
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

import pytest
from structlog.testing import capture_logs

from backend.services import app_state
from backend.services.memories import gacha, people
from backend.services.memories import index as mi
from backend.services.memories import oshi as oshi_mod
from backend.services.memories import user_store as us
from backend.services.memories.cards import MessageKey
from backend.services.memories.view_cache import contains_text
from backend.tests.memories_archive import msg, write_room, write_side_inputs
from backend.tests.test_memories_cards import fact

SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
ROOM_A = "messages/34 金村 美玖/58 金村 美玖"
ROOM_B = "messages/35 小坂 菜緒/60 小坂 菜緒"
R = "room"
NOW = datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc)  # JST 2026-11-10 12:00
TODAY = date(2026, 11, 10)
PROMO = "詳細はコチラ https://example.jp/live"
SECRET_TEXT = "ないしょの言葉🌙"
SALT = "00c0ffee12345678"


def media(i, ts, type_="picture", *, room=ROOM_A, **extra):
    ext = {"picture": "jpg", "video": "mp4", "voice": "m4a"}[type_]
    path = f"{room}/{type_}/{i}.{ext}".replace("/", "\\")
    return msg(i, ts, type_, media_file=path, **extra)


@pytest.fixture(autouse=True)
def no_oshi(monkeypatch):
    async def fake(service):
        return set()

    monkeypatch.setattr(oshi_mod, "oshi_names", fake)


@pytest.fixture
def svc(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    app_state.set_db_path(tmp_path / "app.db")
    app_state.init_db()
    app_state.set_prefs({us.SALT_PREF: SALT})  # deterministic draws
    out = tmp_path / "out"
    sdir = out / SVC_NAME
    monkeypatch.setattr(people, "output_dir", lambda: out)
    write_room(
        sdir,
        "34 金村 美玖",
        "58 金村 美玖",
        [
            msg(1, "2024-05-01T03:00:00Z", content=SECRET_TEXT),
            msg(2, "2024-05-02T03:00:00Z", content=PROMO),
            media(3, "2024-05-03T03:00:00Z", "voice", media_duration=12.0),
            media(4, "2024-05-04T03:00:00Z", "picture"),
            msg(5, "2024-05-04T15:02:00Z", content="日付が変わったね"),  # 00:02 JST
        ],
    )
    write_room(
        sdir,
        "35 小坂 菜緒",
        "60 小坂 菜緒",
        [msg(10, "2025-01-01T03:00:00Z", content="あけおめ", fav=True)],
    )
    return sdir


def keys(pool):
    return {(c.room, c.fact.id): (c.rarity, c.reason) for c in pool}


# --- classify ---------------------------------------------------------------------------


def classify(f, *, bday=None, anniv=frozenset(), last=None, room=R):
    return gacha.classify(
        f, birthday_md=bday, anniversaries=anniv, last_key=last, room=room
    )


def test_classify_every_reason():
    assert classify(fact(1, "2024-01-01 00:00")) == ("sr", "midnight")
    assert classify(fact(1, "2024-01-01 00:05:59")) == ("sr", "midnight")
    assert classify(fact(1, "2024-01-01 00:06")) == ("n", "message")
    assert classify(fact(1, "2024-05-01 12:00"), bday=(5, 1)) == ("sr", "birthday")
    anniv = frozenset({date(2025, 7, 24), date(2026, 7, 24)})
    assert classify(fact(1, "2025-07-24 12:00"), anniv=anniv) == (
        "sr",
        "sub_anniversary",
    )
    assert classify(fact(1, "2026-07-24 12:00"), anniv=anniv) == (
        "sr",
        "sub_anniversary",
    )
    last = MessageKey(R, 7)
    assert classify(fact(7, "2024-01-01 12:00"), last=last) == ("sr", "last_message")
    assert classify(fact(7, "2024-01-01 12:00"), last=last, room="other") == (
        "n",
        "message",
    )
    assert classify(fact(1, "2024-01-01 12:00", nick=True)) == ("r", "nickname")
    fav = replace(fact(1, "2024-01-01 12:00"), favorited=True)
    assert classify(fav) == ("r", "favorite")
    assert classify(fact(1, "2024-01-01 12:00", "voice")) == ("r", "voice")
    assert classify(fact(1, "2024-01-01 12:00", "picture")) == ("n", "photo")
    assert classify(fact(1, "2024-01-01 12:00", "video")) == ("n", "photo")
    assert classify(fact(1, "2024-01-01 12:00")) == ("n", "message")


def test_classify_first_match_order():
    # A midnight voice is SR/midnight, not R/voice.
    assert classify(fact(1, "2024-01-01 00:01", "voice")) == ("sr", "midnight")
    # Midnight beats birthday; birthday beats a nickname.
    assert classify(fact(1, "2024-05-01 00:01"), bday=(5, 1)) == ("sr", "midnight")
    assert classify(fact(1, "2024-05-01 12:00", nick=True), bday=(5, 1)) == (
        "sr",
        "birthday",
    )
    # Nickname beats favourite beats voice.
    f = replace(fact(1, "2024-01-01 12:00", "voice", nick=True), favorited=True)
    assert classify(f) == ("r", "nickname")
    assert classify(replace(f, has_nickname=False)) == ("r", "favorite")


def test_classify_feb29_birthday():
    assert classify(fact(1, "2024-02-29 12:00"), bday=(2, 29)) == ("sr", "birthday")
    assert classify(fact(1, "2025-02-28 12:00"), bday=(2, 29)) == ("sr", "birthday")
    assert classify(fact(1, "2024-02-28 12:00"), bday=(2, 29)) == ("n", "message")


def test_classify_promo_is_never_sr():
    last = MessageKey(R, 7)
    promo = fact(7, "2024-01-01 00:01", promo=True)
    assert classify(promo, last=last, bday=(1, 1))[0] != "sr"


# --- draw -------------------------------------------------------------------------------


def cand(i, rarity="n", score=0, room=R):
    return gacha.Candidate(room, fact(i, "2024-01-01 12:00"), rarity, "message", score)


def test_draw_is_deterministic_and_order_free():
    pool = [cand(i, ("sr", "r", "n")[i % 3]) for i in range(50)]
    assert gacha.draw(pool, 12345) == gacha.draw(pool, 12345)
    assert gacha.draw(list(reversed(pool)), 12345) == gacha.draw(pool, 12345)
    assert len({gacha.draw(pool, s) for s in range(20)}) > 1


def test_draw_empty_pool():
    assert gacha.draw([], 1) is None


def _seed_rolling(predicate):
    return next(s for s in range(10_000) if predicate(random.Random(s).random()))


def test_draw_tier_falls_down_when_empty():
    seed = _seed_rolling(lambda x: x < 0.03)  # rolls SR
    pool = [cand(1, "r"), cand(2, "n")]
    with capture_logs() as logs:
        got = gacha.draw(pool, seed)
    assert got is not None and got.rarity == "r"
    assert any(
        e.get("event") == "memories_select"
        and e.get("view") == "gacha"
        and e.get("fallback") == "tier_empty"
        for e in logs
    )
    # SR and R empty: falls to N.
    assert gacha.draw([cand(2, "n")], seed).rarity == "n"


def test_draw_tier_falls_up_when_lower_tiers_empty():
    seed = _seed_rolling(lambda x: x >= 0.2)  # rolls N
    assert gacha.draw([cand(1, "sr")], seed).rarity == "sr"
    assert gacha.draw([cand(1, "sr"), cand(2, "r")], seed).rarity == "r"


def test_draw_weighting_prefers_high_scores():
    pool = [cand(1, "n", score=2000), cand(2, "n", score=0)]
    wins = {1: 0, 2: 0}
    for s in range(2000):
        wins[gacha.draw(pool, s).fact.id] += 1
    assert wins[1] > wins[2] * 3
    # A negative or missing score still has weight 1.
    assert gacha.weight(-50) == 1 and gacha.weight(None) == 1
    assert gacha.weight(10_000) == 10


def test_tier_odds_constants():
    assert gacha.TIER_ODDS == (("sr", 0.03), ("r", 0.17), ("n", 0.80))
    assert (gacha.MAX_PULLS, gacha.HISTORY_LIMIT, gacha.RECENT_DAYS) == (3, 60, 30)
    assert gacha.MIN_POOL_AFTER_RECENT == 10


def test_seed_for_is_stable_and_salted():
    a = gacha.seed_for("0123456789abcdef", SERVICE, TODAY, 0)
    assert a == gacha.seed_for("0123456789abcdef", SERVICE, TODAY, 0)
    assert a != gacha.seed_for("0123456789abcdef", SERVICE, TODAY, 1)
    assert a != gacha.seed_for("fedcba9876543210", SERVICE, TODAY, 0)
    assert a != gacha.seed_for("0123456789abcdef", SERVICE, TODAY + timedelta(1), 0)


def test_score_of():
    assert gacha.score_of(fact(1, "2024-01-01 12:00", importance=300)) == 300
    assert gacha.score_of(fact(1, "2024-01-01 12:00", importance=None)) == 0
    assert (
        gacha.score_of(replace(fact(1, "2024-01-01 12:00", "picture"), photo_score=55))
        == 55
    )
    assert gacha.score_of(fact(1, "2024-01-01 12:00", "picture")) == 0
    assert gacha.score_of(fact(1, "2024-01-01 12:00", "voice", duration=20.5)) == 120.5
    assert gacha.score_of(fact(1, "2024-01-01 12:00", "voice")) == 100


def test_exclude_recent_keeps_a_min_pool():
    pool = [cand(i) for i in range(12)]
    kept, excluded = gacha.exclude_recent(pool, {(R, 0), (R, 1)})
    assert excluded and len(kept) == 10
    kept, excluded = gacha.exclude_recent(pool, {(R, 0), (R, 1), (R, 2)})
    assert not excluded and kept == pool
    kept, excluded = gacha.exclude_recent(pool, set())
    assert not excluded and kept == pool


# --- pool -------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_pool_classifies_and_excludes_promo(svc):
    with capture_logs() as logs:
        pool = await gacha.build_pool(SERVICE, svc, today=TODAY)
    got = keys(pool)
    assert (ROOM_A, 2) not in got  # promo is never drawn
    assert got == {
        (ROOM_A, 1): ("n", "message"),
        (ROOM_A, 3): ("r", "voice"),
        (ROOM_A, 4): ("n", "photo"),
        (ROOM_A, 5): ("sr", "midnight"),
        (ROOM_B, 10): ("r", "favorite"),
    }
    summary = [e for e in logs if e.get("event") == "memories_gacha"]
    assert summary[-1] == {
        "event": "memories_gacha",
        "log_level": "info",
        "op": "pool",
        "count": 5,
        "sr": 1,
        "r": 2,
        "n": 2,
    }


@pytest.mark.asyncio
async def test_build_pool_is_cached_without_text(svc):
    await gacha.build_pool(SERVICE, svc, today=TODAY)
    with capture_logs() as logs:
        again = await gacha.build_pool(SERVICE, svc, today=TODAY)
    assert any(
        e.get("event") == "memories_view_cache" and e.get("outcome") == "hit"
        for e in logs
    )
    assert len(again) == 5 and all(c.fact is not None for c in again)
    with contextlib.closing(mi._connect()) as c:
        (blob,) = c.execute(
            "SELECT payload FROM memories_view_cache WHERE view='gacha_pool'"
        ).fetchone()
    assert not contains_text(json.loads(blob))
    assert SECRET_TEXT not in blob and "あけおめ" not in blob


@pytest.mark.asyncio
async def test_build_pool_sr_signals(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    out = tmp_path / "out"
    sdir = out / SVC_NAME
    monkeypatch.setattr(people, "output_dir", lambda: out)
    write_room(
        sdir,
        "34 金村 美玖",
        "58 金村 美玖",
        [
            msg(1, "2025-05-01T03:00:00Z", content="誕生日ありがとう"),  # birthday
            msg(2, "2025-07-24T03:00:00Z", content="一周年"),  # anniversary k=1
            msg(3, "2026-07-24T03:00:00Z", content="二周年"),  # anniversary k=2
            msg(4, "2026-08-01T03:00:00Z", content="最後です"),  # graduated: last
        ],
    )
    write_side_inputs(
        sdir,
        birthdays={"金村美玖": "2002-05-01"},
        sub_starts={"34": "2024-07-24"},
        closed_groups=["34"],
    )
    got = keys(await gacha.build_pool(SERVICE, sdir, today=TODAY))
    assert got == {
        (ROOM_A, 1): ("sr", "birthday"),
        (ROOM_A, 2): ("sr", "sub_anniversary"),
        (ROOM_A, 3): ("sr", "sub_anniversary"),
        (ROOM_A, 4): ("sr", "last_message"),
    }


@pytest.mark.asyncio
async def test_graduated_promo_last_fact_is_not_sr(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    out = tmp_path / "out"
    sdir = out / SVC_NAME
    monkeypatch.setattr(people, "output_dir", lambda: out)
    write_room(
        sdir,
        "34 金村 美玖",
        "58 金村 美玖",
        [
            msg(1, "2026-07-31T03:00:00Z", content="ありがとう"),
            msg(2, "2026-08-01T03:00:00Z", content=PROMO),  # her real last: promo
        ],
    )
    write_side_inputs(sdir, closed_groups=["34"])
    got = keys(await gacha.build_pool(SERVICE, sdir, today=TODAY))
    # 1 is not her last message, so it must not be labelled so.
    assert got == {(ROOM_A, 1): ("n", "message")}


# --- pull / state -----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_three_pulls_then_none(svc):
    results = [
        await gacha.pull(SERVICE, svc, now=NOW + timedelta(minutes=i)) for i in range(3)
    ]
    assert [r["pulls_left"] for r in results] == [2, 1, 0]
    assert [r["pull"]["pull_index"] for r in results] == [0, 1, 2]
    with capture_logs() as logs:
        assert await gacha.pull(SERVICE, svc, now=NOW) is None
    assert any(
        e.get("outcome") == "no_pulls_left" and e.get("event") == "memories_gacha"
        for e in logs
    )


@pytest.mark.asyncio
async def test_pull_payload_and_logs(svc):
    with capture_logs() as logs:
        body = await gacha.pull(SERVICE, svc, now=NOW)
    p = body["pull"]
    assert set(p) == {
        "jst_date",
        "pull_index",
        "rarity",
        "reason",
        "pulled_at",
        "message",
    }
    assert p["jst_date"] == "2026-11-10"
    assert p["pulled_at"] == "2026-11-10T03:00:00Z"
    m = p["message"]
    assert m["member_path"].startswith(SVC_NAME + "/")
    if m["type"] == "text":
        assert m["text"]
    salt = us.gacha_salt()
    seed = gacha.seed_for(salt, SERVICE, TODAY, 0)
    blob = json.dumps(logs, ensure_ascii=False, default=str)
    assert salt not in blob and str(seed) not in blob
    for word in (SECRET_TEXT, "あけおめ", "日付が変わったね", "金村", "小坂", str(svc)):
        assert word not in blob
    summary = [
        e for e in logs if e.get("event") == "memories_gacha" and e.get("op") == "pull"
    ]
    assert summary[-1]["pull_index"] == 0
    assert summary[-1]["message_id"] == m["id"]
    assert {"rarity", "reason", "score"} <= set(summary[-1])
    assert salt not in json.dumps(body, ensure_ascii=False)


@pytest.mark.asyncio
async def test_same_draw_after_restart(svc, tmp_path):
    first = await gacha.pull(SERVICE, svc, now=NOW)
    salt = us.gacha_salt()
    # "Restart": a fresh app-state DB with the same persisted salt, a cold view cache.
    app_state.set_db_path(tmp_path / "app2.db")
    app_state.init_db()
    app_state.set_prefs({us.SALT_PREF: salt})
    mi.set_db_path(tmp_path / "idx2.db")
    second = await gacha.pull(SERVICE, svc, now=NOW + timedelta(hours=5))
    for k in ("rarity", "reason", "jst_date", "pull_index"):
        assert first["pull"][k] == second["pull"][k]
    assert first["pull"]["message"]["id"] == second["pull"]["message"]["id"]
    assert first["pull"]["message"]["room"] == second["pull"]["message"]["room"]


@pytest.mark.asyncio
async def test_jst_day_boundary_resets_pulls(svc):
    late = datetime(2026, 11, 10, 14, 59, tzinfo=timezone.utc)  # JST 11-10 23:59
    for i in range(3):
        await gacha.pull(SERVICE, svc, now=late)
    assert (await gacha.gacha_state(SERVICE, svc, now=late))["pulls_left"] == 0
    assert await gacha.pull(SERVICE, svc, now=late) is None
    midnight = datetime(2026, 11, 10, 15, 0, tzinfo=timezone.utc)  # JST 11-11 00:00
    state = await gacha.gacha_state(SERVICE, svc, now=midnight)
    assert state["pulls_left"] == 3 and state["today"] == []
    assert len(state["history"]) == 3
    body = await gacha.pull(SERVICE, svc, now=midnight)
    assert body["pull"]["jst_date"] == "2026-11-11"


def test_racing_last_pull_records_one_row(svc, monkeypatch):
    for i in range(2):
        asyncio.run(gacha.pull(SERVICE, svc, now=NOW))
    real = us.record_gacha_pull
    barrier = threading.Barrier(2, timeout=10)

    def gated(*a, **kw):
        barrier.wait()  # both clicks have counted 2 pulls before either inserts
        return real(*a, **kw)

    monkeypatch.setattr(us, "record_gacha_pull", gated)
    results: list[object] = []

    def click():
        results.append(asyncio.run(gacha.pull(SERVICE, svc, now=NOW)))

    threads = [threading.Thread(target=click) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(r is None for r in results) == [False, True]
    assert len(us.gacha_pulls_on(SERVICE, TODAY)) == 3


@pytest.mark.asyncio
async def test_recent_pulls_are_not_redrawn(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    app_state.set_db_path(tmp_path / "app.db")
    app_state.init_db()
    app_state.set_prefs({us.SALT_PREF: SALT})  # deterministic draws
    out = tmp_path / "out"
    sdir = out / SVC_NAME
    monkeypatch.setattr(people, "output_dir", lambda: out)
    write_room(
        sdir,
        "34 金村 美玖",
        "58 金村 美玖",
        [msg(i, f"2024-05-{i:02d}T03:00:00Z", content=f"文{i}") for i in range(1, 15)],
    )
    # 2 drawn within the window (29 days ago), 1 just outside it (30 days ago).
    for d, mid in ((TODAY - timedelta(days=29), 1), (TODAY - timedelta(days=1), 2)):
        us.record_gacha_pull(
            SERVICE,
            d,
            room=ROOM_A,
            message_id=mid,
            rarity="n",
            reason="message",
            now=NOW,
            max_pulls=3,
        )
    us.record_gacha_pull(
        SERVICE,
        TODAY - timedelta(days=30),
        room=ROOM_A,
        message_id=3,
        rarity="n",
        reason="message",
        now=NOW,
        max_pulls=3,
    )
    pool = await gacha.build_pool(SERVICE, sdir, today=TODAY)
    assert len(pool) == 14
    recent = await gacha.recent_keys(SERVICE, today=TODAY)
    assert recent == {(ROOM_A, 1), (ROOM_A, 2)}
    drawn = []
    for i in range(3):
        drawn.append(
            (await gacha.pull(SERVICE, sdir, now=NOW))["pull"]["message"]["id"]
        )
    assert not {1, 2} & set(drawn)
    assert len(set(drawn)) == 3  # today's own pulls are recent too


@pytest.mark.asyncio
async def test_small_pool_allows_repeats(svc):
    # 5 items: excluding any recent one leaves < 10, so the whole pool is used.
    for d in range(1, 6):
        us.record_gacha_pull(
            SERVICE,
            TODAY - timedelta(days=d),
            room=ROOM_A,
            message_id=1,
            rarity="n",
            reason="message",
            now=NOW,
            max_pulls=3,
        )
    with capture_logs() as logs:
        body = await gacha.pull(SERVICE, svc, now=NOW)
    assert body["pull"] is not None
    assert any(
        e.get("event") == "memories_select" and e.get("fallback") == "repeat_allowed"
        for e in logs
    )


@pytest.mark.asyncio
async def test_state_history_texts_and_missing_pull(svc):
    us.record_gacha_pull(
        SERVICE,
        TODAY - timedelta(days=2),
        room=ROOM_A,
        message_id=999,
        rarity="r",
        reason="voice",
        now=NOW,
        max_pulls=3,
    )
    us.record_gacha_pull(
        SERVICE,
        TODAY - timedelta(days=1),
        room=ROOM_A,
        message_id=1,
        rarity="n",
        reason="message",
        now=NOW,
        max_pulls=3,
    )
    await gacha.pull(SERVICE, svc, now=NOW)
    with capture_logs() as logs:
        state = await gacha.gacha_state(SERVICE, svc, now=NOW)
    assert state["available"] is True
    assert state["max_pulls"] == 3 and state["pulls_left"] == 2
    assert [p["jst_date"] for p in state["history"]] == [
        "2026-11-10",
        "2026-11-09",
        "2026-11-08",
    ]
    assert [p["pull_index"] for p in state["today"]] == [0]
    assert state["today"][0] == state["history"][0]
    yesterday = state["history"][1]["message"]
    assert yesterday["text"] == SECRET_TEXT and yesterday["type"] == "text"
    gone = state["history"][2]
    assert gone["message"]["text"] is None and gone["message"]["type"] is None
    assert gone["message"]["id"] == 999 and gone["rarity"] == "r"
    assert any(
        e.get("event") == "memories_skip"
        and e.get("view") == "gacha"
        and e.get("reason") == "pull_missing"
        and e.get("count") == 1
        for e in logs
    )
    assert not any(e.get("reason") == "text_missing" for e in logs)
    salt = us.gacha_salt()
    assert salt not in json.dumps(state, ensure_ascii=False)
    assert "person_key" not in json.dumps(state) and str(svc) not in json.dumps(
        state, ensure_ascii=False
    )


@pytest.mark.asyncio
async def test_history_limit(svc, monkeypatch):
    monkeypatch.setattr(gacha, "HISTORY_LIMIT", 2)
    for d in range(1, 4):
        us.record_gacha_pull(
            SERVICE,
            TODAY - timedelta(days=d),
            room=ROOM_A,
            message_id=1,
            rarity="n",
            reason="message",
            now=NOW,
            max_pulls=3,
        )
    state = await gacha.gacha_state(SERVICE, svc, now=NOW)
    assert len(state["history"]) == 2


@pytest.mark.asyncio
async def test_empty_pool(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    app_state.set_db_path(tmp_path / "app.db")
    app_state.init_db()
    app_state.set_prefs({us.SALT_PREF: SALT})  # deterministic draws
    out = tmp_path / "out"
    sdir = out / SVC_NAME
    monkeypatch.setattr(people, "output_dir", lambda: out)
    write_room(
        sdir,
        "34 金村 美玖",
        "58 金村 美玖",
        [msg(1, "2024-05-01T03:00:00Z", content=PROMO)],
    )
    state = await gacha.gacha_state(SERVICE, sdir, now=NOW)
    assert state == {
        "available": False,
        "pulls_left": 3,
        "max_pulls": 3,
        "today": [],
        "history": [],
    }
    with capture_logs() as logs:
        body = await gacha.pull(SERVICE, sdir, now=NOW)
    assert body == {"pull": None, "pulls_left": 3}
    assert any(
        e.get("event") == "memories_gacha" and e.get("reason") == "empty_pool"
        for e in logs
    )
    assert us.gacha_pulls_on(SERVICE, TODAY) == []
