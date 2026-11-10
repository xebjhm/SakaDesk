"""Memoir member list and header (``backend/services/memories/memoir.py``)."""

from __future__ import annotations

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
