"""Memoir member list and header (``backend/services/memories/memoir.py``)."""

from __future__ import annotations

import asyncio
import threading
from datetime import datetime, timezone

import pytest
import time_machine
from structlog.testing import capture_logs

from backend.services.memories import binder, memoir
from backend.services.memories import cards as c
from backend.services.memories import index as mi
from backend.services.memories import oshi as oshi_mod
from backend.tests.memories_archive import msg, write_room, write_side_inputs

SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
KANE_ROOM = "messages/34 金村 美玖/58 金村 美玖"
OLD_ROOM = "messages/40 松田 好花/64 松田 好花"
NEW_ROOM = "messages/94 松田 好花/64 松田 好花"
NOW = datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc)
NAMES = ("金村", "美玖", "松田", "好花")

ICONS = [
    {
        "kind": "thumbnail",
        "file": "thumbnail/a.jpg",
        "first_seen": "2025-01-01T00:00:00Z",
    },
    {
        "kind": "thumbnail",
        "file": "thumbnail/b.jpg",
        "first_seen": "2025-12-01T00:00:00Z",
    },
]


@pytest.fixture
def oshi(monkeypatch):
    """The fan's oshi names (``name_norm``); tests add to it."""
    names: set[str] = set()

    async def fake_oshi(service):
        return set(names)

    monkeypatch.setattr(oshi_mod, "oshi_names", fake_oshi)
    return names


@pytest.fixture
def svc(tmp_path, oshi):
    mi.set_db_path(tmp_path / "idx.db")
    sdir = tmp_path / "out" / SVC_NAME
    write_room(
        sdir,
        "34 金村 美玖",
        "58 金村 美玖",
        [
            msg(1, "2026-11-02T03:00:00Z", content="%%%ちゃん、おはよう☀️"),
            msg(2, "2026-11-03T03:00:00Z", content="今日も%%%に会えて嬉しい"),
            msg(
                3,
                "2026-11-04T03:00:00Z",
                "voice",
                media_duration=12.5,
                media_file="messages/34 金村 美玖/58 金村 美玖/voice/3.m4a",
            ),
            msg(
                4,
                "2026-11-05T03:00:00Z",
                "voice",
                media_duration=30.25,
                media_file="messages/34 金村 美玖/58 金村 美玖/voice/4.m4a",
            ),
        ],
    )
    write_room(
        sdir,
        "40 松田 好花",
        "64 松田 好花",
        [msg(1, "2024-07-24T03:00:00Z", content="はじめまして！")],
    )
    write_room(
        sdir,
        "94 松田 好花",
        "64 松田 好花",
        [msg(1, "2025-12-02T03:00:00Z", content="新しいお部屋だよ")],
        avatars=ICONS,
    )
    write_side_inputs(sdir, sub_starts={"34": "2026-11-01"})
    return sdir


async def person(sdir, name_norm):
    return next(s for s in await mi.list_members(sdir) if s.name_norm == name_norm)


# --- member list ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_members_default_order_and_fields(svc):
    payload = await memoir.list_memoir_members(SERVICE, svc, now=NOW)
    rows = payload["members"]
    assert [r["name"] for r in rows] == ["金村 美玖", "松田 好花"]
    matsuda = rows[1]
    assert matsuda["member_path"] == f"{SVC_NAME}/{NEW_ROOM}"  # newest room
    assert matsuda["member_id"] == "64"
    assert matsuda["avatar_url"].endswith("/profile_images/thumbnail/b.jpg")
    assert matsuda["oshi"] is False and matsuda["graduated"] is False
    assert rows[0]["avatar_url"] is None  # no archived icon


@pytest.mark.asyncio
async def test_members_put_oshi_first(svc, oshi):
    oshi.add("松田好花")
    rows = (await memoir.list_memoir_members(SERVICE, svc, now=NOW))["members"]
    assert [r["name"] for r in rows] == ["松田 好花", "金村 美玖"]
    assert [r["oshi"] for r in rows] == [True, False]


@pytest.mark.asyncio
async def test_members_progress_matches_the_binder(svc):
    rows = (await memoir.list_memoir_members(SERVICE, svc, now=NOW))["members"]
    for row, name_norm in zip(rows, ("金村美玖", "松田好花")):
        s = await person(svc, name_norm)
        earned, total = c.progress_summary(
            await binder.evaluate_person(SERVICE, svc, s, now=NOW)
        )
        assert row["progress"] == {"earned": earned, "total": total}
        assert earned >= 1  # first message at least


@pytest.mark.asyncio
async def test_members_are_cached_until_oshi_or_day_changes(svc, oshi):
    def outcomes(logs):
        return [
            e["outcome"]
            for e in logs
            if e["event"] == "memories_view_cache" and e["view"] == "memoir_members"
        ]

    with capture_logs() as logs:
        first = await memoir.list_memoir_members(SERVICE, svc, now=NOW)
        again = await memoir.list_memoir_members(SERVICE, svc, now=NOW)
        oshi.add("松田好花")
        await memoir.list_memoir_members(SERVICE, svc, now=NOW)
        await memoir.list_memoir_members(
            SERVICE, svc, now=datetime(2026, 11, 11, 3, tzinfo=timezone.utc)
        )
    assert first == again
    assert outcomes(logs) == ["miss", "hit", "miss", "miss"]
    listed = next(e for e in logs if e["event"] == "memories_memoir_members")
    assert listed["count"] == 2 and listed["oshi"] == 0
    for e in logs:
        assert not any(n in str(v) for v in e.values() for n in NAMES), e


@pytest.mark.asyncio
async def test_members_of_an_empty_service(tmp_path, oshi):
    mi.set_db_path(tmp_path / "idx.db")
    sdir = tmp_path / "out" / SVC_NAME
    sdir.mkdir(parents=True)
    assert await memoir.list_memoir_members(SERVICE, sdir, now=NOW) == {"members": []}


def _view_outcomes(logs, view):
    return [
        e["outcome"]
        for e in logs
        if e["event"] == "memories_view_cache" and e["view"] == view
    ]


@pytest.mark.asyncio
async def test_a_change_in_one_room_reevaluates_only_that_person(svc, monkeypatch):
    evaluated: list[str] = []
    real = binder._evaluate

    async def counting(service, sdir, summary, now):
        evaluated.append(summary.name_norm)
        return await real(service, sdir, summary, now)

    monkeypatch.setattr(binder, "_evaluate", counting)
    await memoir.list_memoir_members(SERVICE, svc, now=NOW)
    assert sorted(evaluated) == ["松田好花", "金村美玖"]
    evaluated.clear()
    write_room(  # a sync adds one message to her newest room
        svc,
        "94 松田 好花",
        "64 松田 好花",
        [
            msg(1, "2025-12-02T03:00:00Z", content="新しいお部屋だよ"),
            msg(2, "2026-11-09T03:00:00Z", content="また明日"),
        ],
    )
    with capture_logs() as logs:
        rows = (await memoir.list_memoir_members(SERVICE, svc, now=NOW))["members"]
    assert evaluated == ["松田好花"]
    assert _view_outcomes(logs, "memoir_members") == ["miss"]
    assert sorted(_view_outcomes(logs, "binder")) == ["hit", "miss"]
    assert [r["name"] for r in rows] == ["金村 美玖", "松田 好花"]


@pytest.mark.asyncio
async def test_member_evaluations_run_with_bounded_concurrency(
    tmp_path, oshi, monkeypatch
):
    mi.set_db_path(tmp_path / "idx.db")
    sdir = tmp_path / "out" / SVC_NAME
    for k in range(6):
        write_room(
            sdir,
            f"{10 + k} メンバー{k}",
            f"{60 + k} メンバー{k}",
            [msg(1, "2025-01-01T03:00:00Z", content="こんにちは")],
        )
    active = peak = 0

    async def slow(service, sdir, summary, *, now, data_hash=None):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.01)
        active -= 1
        return {"progress": {"earned": 1, "total": 2}, "shelves": []}

    monkeypatch.setattr(binder, "binder_payload", slow)
    rows = (await memoir.list_memoir_members(SERVICE, sdir, now=NOW))["members"]
    assert len(rows) == 6
    assert all(r["progress"] == {"earned": 1, "total": 2} for r in rows)
    assert peak == memoir.EVAL_CONCURRENCY == 4


# --- header -----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_header_chips(svc):
    s = await person(svc, "金村美玖")
    with time_machine.travel(NOW, tick=False):
        now = datetime.now(timezone.utc)
        header = await memoir.memoir_header(SERVICE, svc, s, now=now)
    assert header["member_path"] == f"{SVC_NAME}/{KANE_ROOM}"
    assert header["name"] == "金村 美玖" and header["graduated"] is False
    assert header["avatar_url"] is None
    assert header["chips"] == {
        "subscription_days": 10,  # 2026-11-01 .. 2026-11-10 inclusive
        "nickname_count": 2,
        "voice_seconds": 42.75,
    }


@pytest.mark.asyncio
async def test_header_chips_are_null_without_data(svc):
    s = await person(svc, "松田好花")
    with capture_logs() as logs:
        header = await memoir.memoir_header(SERVICE, svc, s, now=NOW)
    assert header["chips"] == {
        "subscription_days": None,
        "nickname_count": None,
        "voice_seconds": None,
    }
    assert header["member_path"] == f"{SVC_NAME}/{NEW_ROOM}"
    assert header["avatar_url"].endswith("/thumbnail/b.jpg")
    hidden = next(e for e in logs if e["event"] == "memories_memoir_header")
    assert hidden["hidden"] == 3 and hidden["person"] == "64"


@pytest.mark.asyncio
async def test_header_hides_a_start_after_today(svc):
    s = await person(svc, "金村美玖")
    before = datetime(2026, 10, 30, 3, tzinfo=timezone.utc)
    header = await memoir.memoir_header(SERVICE, svc, s, now=before)
    assert header["chips"]["subscription_days"] is None  # never 0 or negative
    first_day = datetime(2026, 10, 31, 15, 30, tzinfo=timezone.utc)  # 11-01 JST
    header = await memoir.memoir_header(SERVICE, svc, s, now=first_day)
    assert header["chips"]["subscription_days"] == 1


@pytest.mark.asyncio
async def test_header_chips_are_cached_and_aggregated_off_the_loop(svc, monkeypatch):
    s = await person(svc, "金村美玖")
    loop_thread = threading.get_ident()
    threads: list[int] = []
    real = memoir.aggregate

    def spy(facts):
        threads.append(threading.get_ident())
        return real(facts)

    monkeypatch.setattr(memoir, "aggregate", spy)
    tomorrow = datetime(2026, 11, 11, 3, tzinfo=timezone.utc)
    with capture_logs() as logs:
        first = await memoir.memoir_header(SERVICE, svc, s, now=NOW)
        again = await memoir.memoir_header(SERVICE, svc, s, now=NOW)
        later = await memoir.memoir_header(SERVICE, svc, s, now=tomorrow)
    assert first == again
    assert later["chips"]["subscription_days"] == 11
    assert _view_outcomes(logs, "memoir_header") == ["miss", "hit", "miss"]
    assert len(threads) == 2 and loop_thread not in threads
