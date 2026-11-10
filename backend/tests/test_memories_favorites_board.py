"""Favorites cork board (``backend/services/memories/favorites_board.py``)."""

from __future__ import annotations

import contextlib
import json
import sqlite3
from datetime import datetime, timezone

import pytest
import time_machine
from structlog.testing import capture_logs

from backend.services import app_state
from backend.services.memories import favorites_board as fb
from backend.services.memories import index as mi
from backend.services.memories import oshi as oshi_mod
from backend.services.memories.view_cache import contains_text
from backend.tests.memories_archive import msg, write_room

SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
KANE = "messages/34 金村 美玖/58 金村 美玖"
MATSU = "messages/40 松田 好花/64 松田 好花"
NOW = datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc)
PROMO = "%%%へお知らせ！写真集の予約が始まったよ https://example.jp " + "あ" * 80
WORDS = "いつもありがとう🌸 大好きだよ"
CAPTION = "見てね！今日の衣装"
ICONS = [
    {
        "kind": "thumbnail",
        "file": "thumbnail/a.jpg",
        "first_seen": "2023-01-01T00:00:00Z",
    }
]


@pytest.fixture
def svc(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    app_state.set_db_path(tmp_path / "app.db")
    app_state.init_db()
    sdir = tmp_path / "out" / SVC_NAME
    write_room(
        sdir,
        "34 金村 美玖",
        "58 金村 美玖",
        [
            msg(1, "2024-01-01T03:00:00Z", content=WORDS, fav=True),
            msg(
                2,
                "2024-02-01T03:00:00Z",
                "picture",
                content=CAPTION,
                fav=True,
                media_file=f"{KANE}/picture/2.jpg".replace("/", "\\"),
            ),
            msg(3, "2024-03-01T03:00:00Z", content=PROMO, fav=True),
            msg(
                4,
                "2024-04-01T03:00:00Z",
                "voice",
                fav=True,
                media_file=f"{KANE}/voice/4.m4a",
                media_duration=12.5,
            ),
            msg(5, "2024-05-01T03:00:00Z", content="ふつうの言葉"),
        ],
        avatars=ICONS,
    )
    write_room(
        sdir,
        "40 松田 好花",
        "64 松田 好花",
        [
            msg(11, "2025-01-01T03:00:00Z", content="松田の言葉", fav=True),
            msg(12, "2023-05-01T03:00:00Z", content="昔の言葉", fav=True),
        ],
    )
    write_room(
        sdir,
        "50 二部 ひな",
        "51 二部 ひな",
        [msg(21, "2024-06-01T03:00:00Z", content="おはよう")],
    )
    app_state.record_favorite(
        SERVICE, 1, True, at=datetime(2026, 10, 1, tzinfo=timezone.utc)
    )
    # starred in this app in 2024: older than 11, which has no log row
    # (starred on the phone), so 11 sorts by its own message time
    app_state.record_favorite(
        SERVICE, 12, True, at=datetime(2024, 6, 1, tzinfo=timezone.utc)
    )
    set_oshi(monkeypatch, set())
    return sdir


def set_oshi(monkeypatch, names):
    async def fake(service):
        return set(names)

    monkeypatch.setattr(oshi_mod, "oshi_names", fake)


async def board(sdir, member=None):
    with time_machine.travel(NOW, tick=False):
        return await fb.favorites_board(SERVICE, sdir, member=member)


async def person(sdir, room):
    return next(s for s in await mi.list_members(sdir) if room in s.member_dirs)


@pytest.mark.asyncio
async def test_one_order_by_star_time_else_message_time(svc):
    payload = await board(svc)
    assert [i["id"] for i in payload["items"]] == [1, 11, 12, 4, 3, 2]
    times = {i["id"]: i["favorited_at"] for i in payload["items"]}
    assert times[1] == "2026-10-01T00:00:00+00:00"
    assert times[12] == "2024-06-01T00:00:00+00:00"
    assert [times[i] for i in (11, 4, 3, 2)] == [None] * 4
    assert payload["total"] == 6


@pytest.mark.asyncio
async def test_unreadable_favourite_log_means_unknown_times(svc, monkeypatch):
    def broken(service, ids):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(app_state, "favorited_at", broken)
    with capture_logs() as logs:
        payload = await board(svc)
    assert [i["id"] for i in payload["items"]] == [11, 4, 3, 2, 1, 12]
    assert all(i["favorited_at"] is None for i in payload["items"])
    assert any(e.get("reason") == "favorite_log_unreadable" for e in logs)


@pytest.mark.asyncio
async def test_board_is_cached_text_free_and_follows_new_stars(svc):
    with capture_logs() as logs:
        first = await board(svc)
        second = await board(svc)
    outcomes = [
        e["outcome"]
        for e in logs
        if e["event"] == "memories_view_cache" and e["view"] == "favorites"
    ]
    assert outcomes == ["miss", "hit"] and first == second
    assert second["items"][0]["text"] == WORDS
    with contextlib.closing(mi._connect()) as c:
        (row,) = c.execute(
            "SELECT payload FROM memories_view_cache WHERE view='favorites'"
        ).fetchall()
    assert not contains_text(json.loads(row[0])) and WORDS not in row[0]
    write_room(
        svc,
        "50 二部 ひな",
        "51 二部 ひな",
        [msg(21, "2024-06-01T03:00:00Z", content="おはよう", fav=True)],
    )
    with capture_logs() as logs:
        third = await board(svc)
    assert [e["outcome"] for e in logs if e["event"] == "memories_view_cache"] == [
        "miss"
    ]
    assert third["total"] == 7 and 21 in [i["id"] for i in third["items"]]


@pytest.mark.asyncio
async def test_items_are_full_message_objects_with_texts(svc):
    items = {i["id"]: i for i in (await board(svc))["items"]}
    assert items[1]["text"] == WORDS and items[1]["member_path"] == f"{SVC_NAME}/{KANE}"
    assert items[1]["favorited"] is True and items[1]["service"] == SERVICE
    assert items[1]["avatar_url"].startswith("/api/content/media/")
    assert items[11]["avatar_url"] is None  # no archived icon
    assert items[2]["type"] == "picture" and items[2]["text"] == CAPTION
    assert items[2]["media_file"] == f"{KANE}/picture/2.jpg"
    assert items[3]["text"] == PROMO  # promo favourites are kept: it is her chat
    assert items[4]["type"] == "voice" and items[4]["duration_s"] == 12.5


@pytest.mark.asyncio
async def test_items_name_her_and_key_the_person(svc):
    items = {i["id"]: i for i in (await board(svc))["items"]}
    assert items[1]["name"] == "金村 美玖"
    assert items[1]["person_key"] == f"{SERVICE}|{KANE}"
    assert items[11]["name"] == "松田 好花"
    assert items[11]["person_key"] == f"{SERVICE}|{MATSU}"


@pytest.mark.asyncio
async def test_members_by_count_without_oshi_and_never_zero(svc):
    members = (await board(svc))["members"]
    assert [(m["member_path"], m["count"]) for m in members] == [
        (f"{SVC_NAME}/{KANE}", 4),
        (f"{SVC_NAME}/{MATSU}", 2),
    ]  # 二部 has no favourites: not listed, so no "0"
    assert members[0]["member_id"] == "58" and members[0]["name"] == "金村 美玖"
    assert members[0]["avatar_url"].startswith("/api/content/media/")
    assert members[1]["avatar_url"] is None


@pytest.mark.asyncio
async def test_oshi_is_listed_first(svc, monkeypatch):
    set_oshi(monkeypatch, {"松田好花"})
    members = (await board(svc))["members"]
    assert [m["count"] for m in members] == [2, 4]


@pytest.mark.asyncio
async def test_member_filter_limits_items_but_not_the_list(svc):
    matsu = await person(svc, MATSU)
    payload = await board(svc, member=matsu)
    assert [i["id"] for i in payload["items"]] == [11, 12]
    assert len(payload["members"]) == 2 and payload["total"] == 6


@pytest.mark.asyncio
async def test_member_without_favourites_is_empty(svc):
    nibu = await person(svc, "messages/50 二部 ひな/51 二部 ひな")
    payload = await board(svc, member=nibu)
    assert payload["items"] == [] and payload["total"] == 6


@pytest.mark.asyncio
async def test_breadcrumb_has_counts_only(svc):
    with capture_logs() as logs:
        await board(svc)
    (event,) = [e for e in logs if e["event"] == "memories_favorites"]
    assert event["count"] == 6 and event["members"] == 2 and event["with_time"] == 2
    flat = repr(logs)
    for secret in (WORDS, PROMO, "金村", str(svc)):
        assert secret not in flat


@pytest.mark.asyncio
async def test_empty_service(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    app_state.set_db_path(tmp_path / "app.db")
    app_state.init_db()
    set_oshi(monkeypatch, set())
    sdir = tmp_path / "out" / SVC_NAME
    sdir.mkdir(parents=True)
    payload = await board(sdir)
    assert payload == {"total": 0, "members": [], "items": []}
