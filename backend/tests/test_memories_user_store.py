# backend/tests/test_memories_user_store.py
"""Memories user state in ``app_state.db``: capsule notes, covers, gacha."""

from __future__ import annotations

import json
import re
import sqlite3
import threading
from contextlib import closing
from datetime import date, datetime, timedelta, timezone

import pytest
from structlog.testing import capture_logs

from backend.services import app_state
from backend.services.memories import user_store as us

SVC = "hinatazaka46"
OTHER = "sakurazaka46"
NOW = datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc)
BODIES = [
    "今日も可愛かった🌸",
    "ありがとう😊 — 「推し」",
    "乃木坂\n改行\tタブ",
    "plain",
]


@pytest.fixture(autouse=True)
def db(tmp_path):
    path = tmp_path / "s.db"
    app_state.set_db_path(path)
    app_state.init_db()
    return path


def _day(svc=SVC, d=date(2025, 11, 10), body="メモ", now=NOW):
    return us.add_note(svc, anchor_kind="day", anchor_date=d, body=body, now=now)


# --------------------------------------------------------------- notes


@pytest.mark.parametrize("body", BODIES)
def test_note_round_trip_byte_exact(body):
    n = _day(body=body)
    assert n.id > 0 and n.service == SVC and n.anchor_kind == "day"
    assert n.anchor_date == date(2025, 11, 10)
    assert n.member_path is None and n.card_key is None
    assert n.body == body
    assert n.created_at == n.updated_at == NOW
    assert n.created_at.tzinfo is not None
    [got] = us.notes_on_date(SVC, date(2025, 11, 10))
    assert got == n
    assert got.body.encode("utf-8") == body.encode("utf-8")


def test_note_times_are_stored_as_utc():
    jst_now = NOW.astimezone(timezone(timedelta(hours=9)))
    n = _day(now=jst_now)
    assert n.created_at.utcoffset() == timedelta(0)
    assert n.created_at == NOW


def test_naive_now_is_rejected():
    with pytest.raises(ValueError):
        _day(now=datetime(2026, 1, 1))


def test_update_note():
    n = _day(body="old")
    later = NOW + timedelta(hours=1)
    u = us.update_note(SVC, n.id, "新しい🌟", now=later)
    assert u is not None
    assert u.body == "新しい🌟" and u.updated_at == later and u.created_at == NOW
    assert us.notes_on_date(SVC, n.anchor_date) == [u]


def test_update_note_missing_or_other_service():
    n = _day()
    assert us.update_note(SVC, n.id + 99, "x", now=NOW) is None
    assert us.update_note(OTHER, n.id, "x", now=NOW) is None
    assert us.notes_on_date(SVC, n.anchor_date)[0].body == "メモ"


def test_delete_note():
    n = _day()
    assert us.delete_note(OTHER, n.id) is False
    assert us.delete_note(SVC, n.id) is True
    assert us.delete_note(SVC, n.id) is False
    assert us.notes_on_date(SVC, n.anchor_date) == []


def test_notes_on_date_scoped_and_oldest_first():
    d = date(2025, 11, 10)
    b = _day(body="b", now=NOW + timedelta(minutes=5))
    a = _day(body="a", now=NOW)
    _day(svc=OTHER, body="other")
    _day(d=date(2025, 11, 11), body="next day")
    assert [n.id for n in us.notes_on_date(SVC, d)] == [a.id, b.id]
    assert [n.body for n in us.notes_on_date(OTHER, d)] == ["other"]


def test_notes_for_card_matches_any_room():
    n = us.add_note(
        SVC,
        anchor_kind="card",
        anchor_date=date(2024, 5, 1),
        member_path="hinatazaka46/messages/12 Old Room",
        card_key="first_voice",
        body="カード",
        now=NOW,
    )
    us.add_note(
        SVC,
        anchor_kind="card",
        anchor_date=date(2024, 5, 1),
        member_path="hinatazaka46/messages/12 Old Room",
        card_key="other_card",
        body="x",
        now=NOW,
    )
    rooms = ["hinatazaka46/messages/40 New Room", "hinatazaka46/messages/12 Old Room"]
    assert us.notes_for_card(SVC, rooms, "first_voice") == [n]
    assert us.notes_for_card(SVC, rooms[:1], "first_voice") == []
    assert us.notes_for_card(OTHER, rooms, "first_voice") == []
    assert us.notes_for_card(SVC, [], "first_voice") == []


def _created(y, m, d, h=12, svc=SVC):
    # h is a JST hour; stored as UTC.
    jst = datetime(y, m, d, h, tzinfo=timezone(timedelta(hours=9)))
    return _day(svc=svc, body=f"{y}-{m}-{d}", now=jst)


def test_notes_created_on_month_day_jst_and_before_year():
    a = _created(2024, 11, 10)
    early = _created(2023, 11, 10, h=1)  # UTC is still Nov 9
    _created(2024, 11, 9, h=23)
    _created(2026, 11, 10)  # this year: excluded
    _created(2024, 11, 10, svc=OTHER)
    got = us.notes_created_on_month_day(SVC, "11-10", before_year=2026)
    assert [n.id for n in got] == [early.id, a.id]


def test_notes_created_on_feb29_resurface_on_feb28_in_non_leap_year():
    leap = _created(2024, 2, 29)
    feb28 = _created(2025, 2, 28)
    assert [
        n.id for n in us.notes_created_on_month_day(SVC, "02-28", before_year=2027)
    ] == [
        leap.id,
        feb28.id,
    ]
    # 2028 is a leap year: Feb 29 notes wait for Feb 29.
    assert [
        n.id for n in us.notes_created_on_month_day(SVC, "02-28", before_year=2028)
    ] == [feb28.id]
    assert [
        n.id for n in us.notes_created_on_month_day(SVC, "02-29", before_year=2028)
    ] == [leap.id]


@pytest.mark.parametrize("bad", ["2-28", "13-01", "02-30x", "", "11/10"])
def test_notes_created_on_month_day_rejects_bad_input(bad):
    with pytest.raises(ValueError):
        us.notes_created_on_month_day(SVC, bad, before_year=2026)


# --------------------------------------------------------------- covers


def test_cover_set_overwrite_clear_scoped():
    assert us.cover_overrides(SVC, "all") == {}
    us.set_cover_override(SVC, "all", "2025-03", "room/a", 1, now=NOW)
    us.set_cover_override(SVC, "all", "2025-04", "room/a", 2, now=NOW)
    us.set_cover_override(SVC, "all", "2025-03", "room/b", 3, now=NOW)  # overwrite
    us.set_cover_override(SVC, "person-1", "2025-03", "room/c", 4, now=NOW)
    us.set_cover_override(OTHER, "all", "2025-03", "room/d", 5, now=NOW)
    assert us.cover_overrides(SVC, "all") == {
        "2025-03": ("room/b", 3),
        "2025-04": ("room/a", 2),
    }
    assert us.cover_overrides(SVC, "person-1") == {"2025-03": ("room/c", 4)}
    assert us.cover_overrides(OTHER, "all") == {"2025-03": ("room/d", 5)}
    assert us.clear_cover_override(SVC, "all", "2025-03") is True
    assert us.clear_cover_override(SVC, "all", "2025-03") is False
    assert us.cover_overrides(SVC, "all") == {"2025-04": ("room/a", 2)}
    assert us.cover_overrides(SVC, "person-1") == {"2025-03": ("room/c", 4)}


# --------------------------------------------------------------- gacha


def test_gacha_salt_stable_hex():
    s = us.gacha_salt()
    assert re.fullmatch(r"[0-9a-f]{16}", s)
    assert us.gacha_salt() == s


def test_gacha_salt_repairs_a_corrupt_pref(db):
    app_state.set_prefs({us.SALT_PREF: "not-hex"})
    with capture_logs() as logs:
        s = us.gacha_salt()
    assert re.fullmatch(r"[0-9a-f]{16}", s)
    assert us.gacha_salt() == s
    assert any(e.get("op") == "salt_reset" for e in logs)
    # A non-JSON raw value is repaired too.
    with closing(sqlite3.connect(db)) as c, c:
        c.execute("UPDATE prefs SET value='{' WHERE key=?", (us.SALT_PREF,))
    assert re.fullmatch(r"[0-9a-f]{16}", us.gacha_salt())


def _pull(i, svc=SVC, d=date(2026, 11, 10), max_pulls=3, rarity="n"):
    return us.record_gacha_pull(
        svc,
        d,
        room=f"room/{i}",
        message_id=100 + i,
        rarity=rarity,
        reason="random",
        now=NOW + timedelta(seconds=i),
        max_pulls=max_pulls,
    )


def test_record_gacha_pull_refuses_fourth():
    pulls = [_pull(i) for i in range(3)]
    assert [p.pull_index for p in pulls if p] == [0, 1, 2]
    with capture_logs() as logs:
        assert _pull(3) is None
    assert any(e.get("outcome") == "no_pulls_left" for e in logs)
    got = us.gacha_pulls_on(SVC, date(2026, 11, 10))
    assert [p.pull_index for p in got] == [0, 1, 2]
    assert got[0] == us.GachaPull(
        service=SVC,
        jst_date=date(2026, 11, 10),
        pull_index=0,
        room="room/0",
        message_id=100,
        rarity="n",
        reason="random",
        pulled_at=NOW,
    )
    # Other days and services have their own budget.
    assert _pull(0, d=date(2026, 11, 11)).pull_index == 0
    assert _pull(0, svc=OTHER).pull_index == 0


def test_racing_third_pull_produces_one_row():
    _pull(0)
    _pull(1)
    barrier = threading.Barrier(2)
    results: list[object] = []

    def worker(i):
        barrier.wait()
        results.append(_pull(i))

    threads = [threading.Thread(target=worker, args=(i,)) for i in (10, 11)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(r is None for r in results) == [False, True]
    assert [p.pull_index for p in us.gacha_pulls_on(SVC, date(2026, 11, 10))] == [
        0,
        1,
        2,
    ]


def test_gacha_history_newest_first_with_limit():
    _pull(0, d=date(2026, 11, 8))
    _pull(1, d=date(2026, 11, 9))
    _pull(2, d=date(2026, 11, 9))
    _pull(0, svc=OTHER)
    hist = us.gacha_history(SVC, limit=2)
    assert [(p.jst_date.day, p.pull_index) for p in hist] == [(9, 1), (9, 0)]
    assert len(us.gacha_history(SVC, limit=10)) == 3


def test_gacha_recent_keys():
    _pull(0, d=date(2026, 11, 1))
    _pull(1, d=date(2026, 11, 5))
    _pull(2, d=date(2026, 11, 9))
    _pull(3, svc=OTHER, d=date(2026, 11, 9))
    assert us.gacha_recent_keys(SVC, since=date(2026, 11, 5)) == {
        ("room/1", 101),
        ("room/2", 102),
    }


# --------------------------------------------------------------- errors / logs


def test_sqlite_error_is_logged_and_reraised():
    with capture_logs() as logs, pytest.raises(sqlite3.IntegrityError):
        us.add_note(
            SVC, anchor_kind="bogus", anchor_date=date(2025, 1, 1), body="秘密", now=NOW
        )
    [e] = [e for e in logs if e.get("outcome") == "error"]
    assert e["event"] == "memories_user_store"
    assert e["op"] == "note_add" and e["error_type"] == "IntegrityError"
    assert "秘密" not in json.dumps(e, ensure_ascii=False, default=str)


def test_bad_rarity_is_an_error():
    with pytest.raises(sqlite3.IntegrityError):
        _pull(0, rarity="ssr")


def test_logs_never_carry_bodies_salt_paths_or_scopes():
    body = "ないしょの気持ち💌"
    path = "hinatazaka46/messages/12 Secret Room"
    with capture_logs() as logs:
        n = us.add_note(
            SVC,
            anchor_kind="card",
            anchor_date=date(2025, 1, 1),
            member_path=path,
            card_key="k",
            body=body,
            now=NOW,
        )
        us.update_note(SVC, n.id, body + "!", now=NOW)
        us.delete_note(SVC, n.id)
        us.set_cover_override(SVC, "person-secret", "2025-03", path, 1, now=NOW)
        us.clear_cover_override(SVC, "person-secret", "2025-03")
        salt = us.gacha_salt()
        _pull(0)
    blob = json.dumps(logs, ensure_ascii=False, default=str)
    for secret in (body, path, "Secret Room", "person-secret", salt, "room/0"):
        assert secret not in blob
    ops = [e["op"] for e in logs if e["event"] == "memories_user_store"]
    assert ops == [
        "note_add",
        "note_update",
        "note_delete",
        "cover_set",
        "cover_clear",
        "salt_create",
        "gacha_pull",
    ]
    add = next(e for e in logs if e.get("op") == "note_add")
    assert add["note_id"] == n.id and add["chars"] == len(body)


# --------------------------------------------------------------- async


@pytest.mark.asyncio
async def test_async_wrappers():
    d = date(2025, 11, 10)
    n = await us.aadd_note(
        SVC, anchor_kind="day", anchor_date=d, body="非同期", now=NOW
    )
    assert (await us.anotes_on_date(SVC, d)) == [n]
    u = await us.aupdate_note(SVC, n.id, "更新", now=NOW)
    assert u is not None and u.body == "更新"
    assert await us.anotes_for_card(SVC, ["r"], "k") == []
    assert await us.anotes_created_on_month_day(SVC, "11-10", before_year=2027) == [u]
    assert await us.adelete_note(SVC, n.id) is True

    await us.aset_cover_override(SVC, "all", "2025-03", "r", 1, now=NOW)
    assert await us.acover_overrides(SVC, "all") == {"2025-03": ("r", 1)}
    assert await us.aclear_cover_override(SVC, "all", "2025-03") is True

    salt = await us.agacha_salt()
    assert salt == us.gacha_salt()
    p = await us.arecord_gacha_pull(
        SVC, d, room="r", message_id=1, rarity="sr", reason="oshi", now=NOW, max_pulls=3
    )
    assert p is not None
    assert await us.agacha_pulls_on(SVC, d) == [p]
    assert await us.agacha_history(SVC, limit=5) == [p]
    assert await us.agacha_recent_keys(SVC, since=d) == {("r", 1)}
