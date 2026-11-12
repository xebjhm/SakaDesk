"""The calendar album (``backend/services/memories/calendar_album.py``)."""

from __future__ import annotations

import contextlib
import json
import os
from datetime import datetime, timezone

import pytest
from structlog.testing import capture_logs

from backend.services import app_state
from backend.services.memories import album_colors, calendar_album, people
from backend.services.memories import index as mi
from backend.services.memories import oshi as oshi_mod
from backend.services.memories.view_cache import contains_text
from backend.tests.memories_archive import msg, write_room

SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
ROOM_A = "messages/34 金村 美玖/58 金村 美玖"
ROOM_B = "messages/35 小坂 菜緒/60 小坂 菜緒"
ROOM_C = "messages/36 文字/61 文字"
CAPTION = "見てね🌻 今日の空"
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


@pytest.fixture
def oshi_names(monkeypatch):
    names: set[str] = set()

    async def fake(service):
        return set(names)

    monkeypatch.setattr(oshi_mod, "oshi_names", fake)
    return names


@pytest.fixture
def svc(tmp_path, oshi_names, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    monkeypatch.setattr(app_state, "_db_path", tmp_path / "app.db")
    out = tmp_path / "out"
    sdir = out / SVC_NAME
    monkeypatch.setattr(people, "output_dir", lambda: out)
    write_room(
        sdir,
        "34 金村 美玖",
        "58 金村 美玖",
        [
            msg(1, "2024-09-14T03:00:00Z", content=CAPTION),
            pic(2, "2024-09-14T03:01:00Z", fav=True),  # ★, no score
            pic(3, "2024-09-14T04:00:00Z"),
            pic(4, "2024-09-15T03:00:00Z", content="https://example.jp/shop"),  # promo
            pic(5, "2024-09-16T03:00:00Z", type_="video"),  # video only
            pic(6, "2024-09-17T03:00:00Z", type_="video"),
            pic(7, "2024-09-17T04:00:00Z"),  # a picture beats the video
            msg(8, "2024-09-18T03:00:00Z", content="文字だけ"),
            # 23:30 UTC on the 29th = 08:30 JST on the 30th
            msg(9, "2024-09-29T23:30:00Z", content="おはよう"),
            pic(10, "2024-11-02T03:00:00Z"),
        ],
    )
    write_room(
        sdir,
        "35 小坂 菜緒",
        "60 小坂 菜緒",
        [
            pic(20, "2024-09-14T05:00:00Z", fav=True, room=ROOM_B),
            msg(21, "2024-09-18T05:00:00Z", content="こんにちは"),
            msg(22, "2023-07-01T05:00:00Z", content="はじめまして"),
        ],
    )
    write_room(
        sdir, "36 文字", "61 文字", [msg(1, "2024-09-14T07:00:00Z", content="x")]
    )
    return sdir


async def person(sdir, room):
    return next(s for s in await mi.list_members(sdir) if room in s.member_dirs)


async def month(sdir, m="2024-09", member=None):
    return await calendar_album.calendar_month(SERVICE, sdir, m, member=member, now=NOW)


def by_date(body):
    return {d["date"]: d for d in body["days"]}


@pytest.mark.asyncio
async def test_calendar_months(svc):
    with capture_logs() as logs:
        body = await calendar_album.calendar_months(SERVICE, svc, member=None)
    assert body == {"months": ["2023-07", "2024-09", "2024-11"]}
    (ev,) = [e for e in logs if e["event"] == "memories_calendar"]
    assert (ev["view"], ev["months"]) == ("months", 3)
    a = await person(svc, ROOM_A)
    body = await calendar_album.calendar_months(SERVICE, svc, member=a)
    assert body == {"months": ["2024-09", "2024-11"]}
    with capture_logs() as logs:
        await calendar_album.calendar_months(SERVICE, svc, member=a)
    assert [e["outcome"] for e in logs if e["event"] == "memories_view_cache"] == [
        "hit"
    ]


@pytest.mark.asyncio
async def test_calendar_month_days_and_members(svc):
    with capture_logs() as logs:
        body = await month(svc)
    assert body["month"] == "2024-09"
    days = by_date(body)
    # only days with facts, in date order
    assert list(days) == [
        "2024-09-14",
        "2024-09-15",
        "2024-09-16",
        "2024-09-17",
        "2024-09-18",
        "2024-09-30",
    ]
    assert days["2024-09-14"]["members"] == 3  # A, B and the text-only person
    assert days["2024-09-18"]["members"] == 2
    assert days["2024-09-15"]["members"] == 1
    (ev,) = [e for e in logs if e["event"] == "memories_calendar"]
    assert (ev["view"], ev["month"], ev["month_days"], ev["with_photo"]) == (
        "month",
        "2024-09",
        6,
        3,
    )
    cells = [e for e in logs if e["event"] == "memories_select"]
    assert {e["view"] for e in cells} == {"calendar_cell"}
    assert all(e["log_level"] == "debug" for e in cells)
    assert {e["message_id"] for e in cells} == {2, 5, 7}


@pytest.mark.asyncio
async def test_calendar_photo_rules(svc, oshi_names):
    days = by_date(await month(svc))
    d14 = days["2024-09-14"]
    # two ★ (A's 2, B's 20): no oshi, so the higher score (A's is captioned) wins
    assert (d14["photo"]["id"], d14["photo_rule"]) == (2, "favorite")
    assert d14["photo"]["avatar_url"] is None
    assert d14["photo"]["text"] is None and d14["photo"]["caption"] is None
    # promo is never the cell photo
    assert days["2024-09-15"]["photo"] is None
    assert days["2024-09-15"]["photo_rule"] is None
    # a video stands in only without a picture
    assert days["2024-09-16"]["photo"]["id"] == 5
    assert days["2024-09-16"]["photo"]["type"] == "video"
    assert days["2024-09-17"]["photo"]["id"] == 7
    assert days["2024-09-18"]["photo"] is None
    # an oshi ★ beats a higher-scored non-oshi ★
    oshi_names.add((await person(svc, ROOM_B)).name_norm)
    d14 = by_date(await month(svc))["2024-09-14"]
    assert (d14["photo"]["room"], d14["photo"]["id"]) == (ROOM_B, 20)
    assert d14["photo_rule"] == "favorite"


@pytest.mark.asyncio
async def test_calendar_oshi_star_beats_a_higher_score(svc, oshi_names, monkeypatch):
    from backend.services.memories import facts as facts_mod

    real = facts_mod.get_person_facts

    async def scored(sdir, summary, *args, **kwargs):
        import dataclasses

        out = []
        for room, f in await real(sdir, summary, *args, **kwargs):
            if f.id == 3:
                f = dataclasses.replace(f, photo_score=999, favorited=False)
            if f.id == 20:
                f = dataclasses.replace(f, photo_score=1)
            if f.id == 2:
                f = dataclasses.replace(f, favorited=False)
            out.append((room, f))
        return out

    monkeypatch.setattr(people, "get_person_facts", scored)
    oshi_names.add((await person(svc, ROOM_B)).name_norm)
    d14 = by_date(await month(svc))["2024-09-14"]
    assert (d14["photo"]["id"], d14["photo_rule"]) == (20, "favorite")


@pytest.mark.asyncio
async def test_calendar_screenshot_demoted(svc, monkeypatch):
    asked: list[list[str]] = []

    async def fake_probes(sdir, files):
        asked.append(sorted(files))
        return album_colors.Probes(
            {
                f: album_colors.ImageProbe(
                    width=100,
                    height=300 if f == f"{ROOM_A}/picture/2.jpg" else 100,
                    fmt="PNG",
                    rgb=None,
                )
                for f in files
            }
        )

    monkeypatch.setattr(album_colors, "probes", fake_probes)
    d14 = by_date(await month(svc))["2024-09-14"]
    # A's ★ is a screenshot: B's clean ★ wins
    assert (d14["photo"]["id"], d14["photo_rule"]) == (20, "favorite")
    assert f"{ROOM_A}/picture/2.jpg" in asked[0]
    assert f"{ROOM_A}/picture/4.jpg" not in asked[0]  # promo is never asked


@pytest.mark.asyncio
async def test_calendar_member_scope(svc):
    a = await person(svc, ROOM_A)
    days = by_date(await month(svc, member=a))
    assert days["2024-09-14"]["members"] == 1
    assert days["2024-09-14"]["photo"]["id"] == 2
    assert "2024-09-18" in days and days["2024-09-18"]["members"] == 1
    b = await person(svc, ROOM_B)
    days = by_date(await month(svc, member=b))
    assert list(days) == ["2024-09-14", "2024-09-18"]
    assert days["2024-09-14"]["photo"]["room"] == ROOM_B


@pytest.mark.asyncio
async def test_calendar_month_without_data(svc):
    assert await month(svc, "2019-01") == {"month": "2019-01", "days": []}
    c = await person(svc, ROOM_C)
    assert await month(svc, "2024-11", member=c) == {"month": "2024-11", "days": []}


@pytest.mark.asyncio
async def test_calendar_month_validates(svc):
    with pytest.raises(ValueError):
        await month(svc, "2024-13")


@pytest.mark.asyncio
async def test_calendar_jst_bucketing(svc):
    days = by_date(await month(svc))
    assert "2024-09-29" not in days
    assert days["2024-09-30"]["members"] == 1


@pytest.mark.asyncio
async def test_calendar_cache_holds_no_text(svc):
    await month(svc)
    await calendar_album.calendar_months(SERVICE, svc, member=None)
    with contextlib.closing(mi._connect()) as c:
        rows = c.execute(
            "SELECT view, key, payload FROM memories_view_cache "
            "WHERE view IN ('calendar_month', 'calendar_months')"
        ).fetchall()
    assert {r[0] for r in rows} == {"calendar_month", "calendar_months"}
    for _, key, blob in rows:
        assert not contains_text(json.loads(blob))
        assert CAPTION not in blob and "おはよう" not in blob
        assert key in {"all", "all:2024-09"}
    with capture_logs() as logs:
        again = await month(svc)
    assert [e["outcome"] for e in logs if e["event"] == "memories_view_cache"] == [
        "hit"
    ]
    assert not [e for e in logs if e["event"] == "memories_select"]
    (ev,) = [e for e in logs if e["event"] == "memories_calendar"]
    assert ev["with_photo"] == 3
    assert again == await month(svc)


@pytest.mark.asyncio
async def test_calendar_rebuilds_when_media_arrive(svc):
    a = await person(svc, ROOM_A)
    pics = svc / ROOM_A / "picture"
    pics.mkdir(parents=True, exist_ok=True)
    await month(svc, member=a)
    st = pics.stat()
    os.utime(pics, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    with capture_logs() as logs:
        await month(svc, member=a)
    assert [e["outcome"] for e in logs if e["event"] == "memories_view_cache"] == [
        "miss"
    ]


@pytest.mark.asyncio
async def test_calendar_month_with_transient_probes_is_not_cached(svc, monkeypatch):
    real = album_colors.probes

    async def unavailable(sdir, files):
        return album_colors.Probes({f: None for f in files}, transient=len(files))

    monkeypatch.setattr(album_colors, "probes", unavailable)
    with capture_logs() as logs:
        await month(svc)
    outs = [e["outcome"] for e in logs if e["event"] == "memories_view_cache"]
    assert "transient" in outs
    monkeypatch.setattr(album_colors, "probes", real)
    with capture_logs() as logs:
        await month(svc)
        await month(svc)
    outs = [
        e["outcome"]
        for e in logs
        if e["event"] == "memories_view_cache"
        and e["view"] == calendar_album.VIEW_MONTH
    ]
    assert outs == ["miss", "hit"]
