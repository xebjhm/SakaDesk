"""Album cover overrides (``backend/services/memories/covers.py``)."""

from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timezone

import pytest
from structlog.testing import capture_logs

from backend.services import app_state
from backend.services.memories import album, covers, people, user_store
from backend.services.memories import index as mi
from backend.services.memories import oshi as oshi_mod
from backend.tests.memories_archive import msg, write_room

SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
ROOM_A = "messages/34 金村 美玖/58 金村 美玖"
ROOM_B = "messages/35 小坂 菜緒/60 小坂 菜緒"
NOW = datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc)


def pic(i, ts, *, fav=False, type_="picture", room=ROOM_A, content=""):
    return msg(
        i,
        ts,
        type_,
        content=content,
        fav=fav,
        media_file=f"{room}/{type_}/{i}.jpg".replace("/", "\\"),
    )


ROOM_A_MSGS = [
    pic(2, "2024-09-01T03:01:00Z", fav=True),
    pic(10, "2024-09-14T03:00:00Z"),
    pic(13, "2024-09-20T03:00:00Z", type_="video"),
    msg(14, "2024-09-21T03:00:00Z", content="文字だけ"),
    pic(20, "2024-10-05T03:00:00Z"),
]


@pytest.fixture
def svc(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    monkeypatch.setattr(app_state, "_db_path", tmp_path / "app.db")
    app_state.init_db()

    async def no_oshi(service):
        return set()

    monkeypatch.setattr(oshi_mod, "oshi_names", no_oshi)
    out = tmp_path / "out"
    sdir = out / SVC_NAME
    monkeypatch.setattr(people, "output_dir", lambda: out)
    write_room(sdir, "34 金村 美玖", "58 金村 美玖", ROOM_A_MSGS)
    write_room(
        sdir,
        "35 小坂 菜緒",
        "60 小坂 菜緒",
        [pic(40, "2024-09-03T03:00:00Z", room=ROOM_B)],
    )
    return sdir


async def person(sdir, room):
    return next(s for s in await mi.list_members(sdir) if room in s.member_dirs)


async def sep_cover(sdir, member=None):
    months = (await album.album_months(SERVICE, sdir, member=member, kind="all"))[
        "months"
    ]
    sep = next(m for m in months if m["month"] == "2024-09")
    return sep["cover"]["room"], sep["cover"]["id"], sep["cover_rule"]


@pytest.mark.asyncio
async def test_set_override_is_loaded_and_wins(svc):
    a = await person(svc, ROOM_A)
    assert await sep_cover(svc, a) == (ROOM_A, 2, "favorite")
    with capture_logs() as logs:
        await covers.set_cover_override(
            SERVICE, svc, member=a, month="2024-09", room=ROOM_A, message_id=13, now=NOW
        )
    (ev,) = [e for e in logs if e["event"] == "memories_cover"]
    assert (ev["op"], ev["message_id"], ev["scoped"]) == ("set", 13, True)
    assert ROOM_A not in str(logs) and people.person_key(a) not in str(logs)
    scope = people.person_key(a)
    assert await covers.load_cover_overrides(svc, scope) == {"2024-09": (ROOM_A, 13)}
    assert await covers.load_cover_overrides(svc, "all") == {}
    # the album cache rebuilds: the override is part of its hash
    with capture_logs() as logs:
        assert await sep_cover(svc, a) == (ROOM_A, 13, "override")
    assert [e["outcome"] for e in logs if e["event"] == "memories_view_cache"] == [
        "miss"
    ]
    # the 全員 album has its own scope: unchanged
    assert await sep_cover(svc) == (ROOM_A, 2, "favorite")


@pytest.mark.asyncio
async def test_set_override_for_everyone(svc):
    with capture_logs() as logs:
        await covers.set_cover_override(
            SERVICE,
            svc,
            member=None,
            month="2024-09",
            room=ROOM_B,
            message_id=40,
            now=NOW,
        )
    (ev,) = [e for e in logs if e["event"] == "memories_cover"]
    assert ev["scoped"] is False
    assert await sep_cover(svc) == (ROOM_B, 40, "override")


@pytest.mark.asyncio
async def test_set_override_scans_the_scope_off_the_event_loop(svc, monkeypatch):
    loop_thread = threading.get_ident()
    scan_threads: set[int] = set()
    real_keep = album.keep

    def spy(fact, kind):
        scan_threads.add(threading.get_ident())
        return real_keep(fact, kind)

    monkeypatch.setattr(album, "keep", spy)
    await covers.set_cover_override(
        SERVICE, svc, member=None, month="2024-09", room=ROOM_B, message_id=40, now=NOW
    )
    assert scan_threads and loop_thread not in scan_threads


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("room", "message_id", "month"),
    [
        (ROOM_A, 14, "2024-09"),  # a text message
        (ROOM_A, 20, "2024-09"),  # a picture of another month
        (ROOM_A, 999, "2024-09"),  # no such message
        (ROOM_B, 40, "2024-09"),  # another person's room (scope = her)
        ("../../etc", 2, "2024-09"),  # not a room of the scope
    ],
)
async def test_set_override_validates(svc, room, message_id, month):
    a = await person(svc, ROOM_A)
    with capture_logs() as logs, pytest.raises(ValueError, match="not_in_month"):
        await covers.set_cover_override(
            SERVICE,
            svc,
            member=a,
            month=month,
            room=room,
            message_id=message_id,
            now=NOW,
        )
    (ev,) = [e for e in logs if e["event"] == "memories_cover"]
    assert (ev["op"], ev["outcome"]) == ("set", "not_in_month")
    assert await covers.load_cover_overrides(svc, people.person_key(a)) == {}


@pytest.mark.asyncio
async def test_bad_month_is_value_error(svc):
    with pytest.raises(ValueError, match="month"):
        await covers.set_cover_override(
            SERVICE,
            svc,
            member=None,
            month="2024-9",
            room=ROOM_A,
            message_id=2,
            now=NOW,
        )
    with pytest.raises(ValueError, match="month"):
        await covers.clear_cover_override(SERVICE, svc, member=None, month="24-09")


@pytest.mark.asyncio
async def test_clear_restores_the_automatic_cover(svc):
    a = await person(svc, ROOM_A)
    await covers.set_cover_override(
        SERVICE, svc, member=a, month="2024-09", room=ROOM_A, message_id=10, now=NOW
    )
    assert await sep_cover(svc, a) == (ROOM_A, 10, "override")
    with capture_logs() as logs:
        assert await covers.clear_cover_override(
            SERVICE, svc, member=a, month="2024-09"
        )
    (ev,) = [e for e in logs if e["event"] == "memories_cover"]
    assert (ev["op"], ev["found"]) == ("clear", True)
    assert await sep_cover(svc, a) == (ROOM_A, 2, "favorite")
    with capture_logs() as logs:
        assert not await covers.clear_cover_override(
            SERVICE, svc, member=a, month="2024-09"
        )
    (ev,) = [e for e in logs if e["event"] == "memories_cover"]
    assert ev["found"] is False


@pytest.mark.asyncio
async def test_stale_override_falls_back_silently(svc):
    a = await person(svc, ROOM_A)
    await covers.set_cover_override(
        SERVICE, svc, member=a, month="2024-09", room=ROOM_A, message_id=10, now=NOW
    )
    assert await sep_cover(svc, a) == (ROOM_A, 10, "override")
    # message 10 becomes a text (the archive was rewritten): the override is stale
    msgs = [m if m["id"] != 10 else msg(10, m["timestamp"]) for m in ROOM_A_MSGS]
    write_room(svc, "34 金村 美玖", "58 金村 美玖", msgs)
    assert await sep_cover(svc, a) == (ROOM_A, 2, "favorite")
    # still stored (never an error); the fan can set it again
    scope = people.person_key(a)
    assert await covers.load_cover_overrides(svc, scope) == {"2024-09": (ROOM_A, 10)}
    # gone entirely
    write_room(svc, "34 金村 美玖", "58 金村 美玖", ROOM_A_MSGS[:1])
    assert await sep_cover(svc, a) == (ROOM_A, 2, "favorite")


@pytest.mark.asyncio
async def test_store_read_failure_yields_empty(svc, monkeypatch):
    def boom(service_dir, scope):
        raise sqlite3.OperationalError("locked")

    monkeypatch.setattr(user_store, "cover_overrides", boom)
    with capture_logs() as logs:
        assert await covers.load_cover_overrides(svc, "all") == {}
    (ev,) = [e for e in logs if e["event"] == "memories_skip"]
    assert (ev["view"], ev["reason"]) == ("album_cover", "override_read_failed")
    assert ev["error_type"] == "OperationalError"
    # the album still renders
    assert await sep_cover(svc) == (ROOM_A, 2, "favorite")
