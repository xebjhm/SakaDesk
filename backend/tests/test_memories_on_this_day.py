"""On This Day (``backend/services/memories/on_this_day.py``)."""

from __future__ import annotations

import contextlib
import json
from datetime import datetime, timezone

import pytest
from structlog.testing import capture_logs

from backend.services.memories import index as mi
from backend.services.memories import on_this_day as otd
from backend.services.memories import oshi as oshi_mod
from backend.services.memories import people
from backend.tests.memories_archive import msg, write_room

SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
KANE = "messages/34 金村 美玖/58 金村 美玖"
NOW = datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc)  # 12:00 JST
PROMO = "%%%へお知らせ！写真集の予約が始まったよ https://example.jp " + "あ" * 80
KANE_2023 = "去年の今日もありがとう"
KANE_2025 = "ひなたの日だね"
MATSU_2025 = "今日は本当に楽しかった、ありがとう！みんなに会えて嬉しい"
KOSAKA_2025 = "撮影がんばったよ、見てくれてありがとう、ずっと応援してくれて本当に嬉しいです、大好きです"
NIBU_2025 = "おはよう"
LEAP = "うるう日の言葉"
ICONS = [
    {
        "kind": "thumbnail",
        "file": "thumbnail/a.jpg",
        "first_seen": "2023-01-01T00:00:00Z",
    },
    {
        "kind": "thumbnail",
        "file": "thumbnail/b.jpg",
        "first_seen": "2025-06-01T00:00:00Z",
    },
]


def pic(i, ts, fav=False):
    return msg(
        i,
        ts,
        "picture",
        fav=fav,
        media_file=f"{KANE}/picture/{i}.jpg".replace("/", "\\"),
    )


@pytest.fixture
def svc(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    sdir = tmp_path / "out" / SVC_NAME
    write_room(
        sdir,
        "34 金村 美玖",
        "58 金村 美玖",
        [
            msg(1, "2022-03-01T03:00:00Z", content="はじめまして"),  # first year 2022
            msg(2, "2023-11-10T03:00:00Z", content=KANE_2023),
            msg(3, "2024-02-29T03:00:00Z", content=LEAP),
            msg(4, "2025-11-09T15:30:00Z", content=KANE_2025),  # 11-10 00:30 JST
            msg(5, "2025-11-10T05:00:00Z", content=PROMO),  # promo: counted, not shown
            pic(6, "2025-11-10T06:00:00Z", fav=True),  # the thumb
            pic(7, "2025-11-10T08:00:00Z"),
            msg(8, "2025-12-24T03:00:00Z", content="メリークリスマス"),
        ],
        avatars=ICONS,
    )
    write_room(
        sdir,
        "40 松田 好花",
        "64 松田 好花",
        [msg(1, "2025-11-10T04:00:00Z", content=MATSU_2025)],
    )
    write_room(
        sdir,
        "23 小坂 菜緒",
        "24 小坂 菜緒",
        [
            msg(1, "2025-11-10T05:00:00Z", content=KOSAKA_2025),
            msg(2, "2025-11-10T05:10:00Z", content="もう一つ"),  # one per person
        ],
    )
    write_room(
        sdir,
        "50 二部 ひな",
        "51 二部 ひな",
        [msg(1, "2025-11-10T07:00:00Z", content=NIBU_2025)],
    )

    async def fake_oshi(service):
        return {"金村美玖"}

    monkeypatch.setattr(oshi_mod, "oshi_names", fake_oshi)
    return sdir


def by_year(payload):
    return {y["year"]: y for y in payload["years"]}


@pytest.mark.asyncio
async def test_years_run_from_first_year_to_this_year_with_empty_years(svc):
    payload = await otd.on_this_day(SERVICE, svc, "11-10", now=NOW)
    assert payload["month_day"] == "11-10"
    # 2026-11-10 is today but has no messages: not listed (no structural gap)
    assert [y["year"] for y in payload["years"]] == [2022, 2023, 2024, 2025]
    years = by_year(payload)
    for empty in (2022, 2024):
        assert years[empty] == {"year": empty, "has_messages": False}
    y23 = years[2023]
    assert y23["has_messages"] is True
    assert y23["message_count"] == 1 and y23["member_count"] == 1
    assert [p["text"] for p in y23["preview"]] == [KANE_2023]
    assert y23["more"] is None and y23["thumb"] is None  # never a renderable 0


@pytest.mark.asyncio
async def test_this_years_date_is_listed_once_it_has_messages(svc):
    write_room(
        svc,
        "40 松田 好花",
        "64 松田 好花",
        [
            msg(1, "2025-11-10T04:00:00Z", content=MATSU_2025),
            msg(2, "2026-11-10T01:00:00Z", content="今日の言葉"),
        ],
    )
    years = by_year(await otd.on_this_day(SERVICE, svc, "11-10", now=NOW))
    assert list(years) == [2022, 2023, 2024, 2025, 2026]
    assert years[2026]["message_count"] == 1


@pytest.mark.asyncio
async def test_first_year_starts_on_or_after_the_first_message_date(svc):
    # the archive starts 2022-03-01: 01-02 and 02-28 start in 2023, 03-01 in 2022
    for month_day, first in (("01-02", 2023), ("02-28", 2023), ("03-01", 2022)):
        payload = await otd.on_this_day(SERVICE, svc, month_day, now=NOW)
        assert payload["years"][0]["year"] == first, month_day


@pytest.mark.asyncio
async def test_preview_oshi_first_one_per_person_promo_excluded(svc):
    y25 = by_year(await otd.on_this_day(SERVICE, svc, "11-10", now=NOW))[2025]
    # 金村 4 (incl. the JST-midnight one and the promo) + 松田 1 + 小坂 2 + 二部 1
    assert y25["message_count"] == 8
    assert y25["member_count"] == 4
    preview = y25["preview"]
    assert len(preview) == 3
    # oshi first, then by importance: 小坂's long words over 松田's, 二部 left out
    assert [p["text"] for p in preview] == [KANE_2025, KOSAKA_2025, MATSU_2025]
    assert len({p["room"] for p in preview}) == 3
    assert all(p["id"] != 5 or p["room"] != KANE for p in preview)  # no promo
    assert y25["more"] == 8 - 3
    assert preview[0]["member_path"] == f"{SVC_NAME}/{KANE}"
    assert preview[0]["avatar_url"].endswith("thumbnail/b.jpg")  # icon at its time
    assert preview[1]["avatar_url"] is None  # no archived icon
    thumb = y25["thumb"]
    assert thumb["id"] == 6 and thumb["type"] == "picture"
    assert thumb["media_file"] == f"{KANE}/picture/6.jpg"
    assert thumb["text"] is None and thumb["caption"] is None


@pytest.mark.asyncio
async def test_future_date_this_year_is_excluded(svc):
    payload = await otd.on_this_day(SERVICE, svc, "12-24", now=NOW)
    years = by_year(payload)
    assert list(years) == [2022, 2023, 2024, 2025]
    assert years[2025]["message_count"] == 1


@pytest.mark.asyncio
async def test_leap_day_lists_every_year(svc):
    payload = await otd.on_this_day(SERVICE, svc, "02-29", now=NOW)
    years = by_year(payload)
    # non-leap years stay listed (empty); 2022 is before the archive's 03-01
    # start and 2026 is this year without messages
    assert list(years) == [2023, 2024, 2025]
    assert [y for y, v in years.items() if v["has_messages"]] == [2024]
    assert years[2024]["preview"][0]["text"] == LEAP


@pytest.mark.asyncio
async def test_without_messages_years_are_empty(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    sdir = tmp_path / "out" / SVC_NAME
    sdir.mkdir(parents=True)
    with capture_logs() as logs:
        payload = await otd.on_this_day(SERVICE, sdir, "11-10", now=NOW)
    assert payload == {"month_day": "11-10", "years": []}
    (skip,) = [e for e in logs if e["event"] == "memories_skip"]
    assert skip["view"] == "on_this_day" and skip["reason"] == "no_messages"
    assert not [e for e in logs if e["event"] == "memories_view_cache"]


@pytest.mark.asyncio
async def test_first_message_after_this_years_date_gives_no_years(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    sdir = tmp_path / "out" / SVC_NAME
    write_room(sdir, "34 金村 美玖", "58 金村 美玖", [msg(1, "2026-11-05T03:00:00Z")])
    with capture_logs() as logs:
        payload = await otd.on_this_day(SERVICE, sdir, "12-24", now=NOW)  # last 2025
    assert payload["years"] == []
    (skip,) = [e for e in logs if e["event"] == "memories_skip"]
    assert skip["view"] == "on_this_day" and skip["reason"] == "before_first_year"


@pytest.mark.parametrize("bad", ["2-29", "13-01", "00-10", "02-30", "11/10", "x", ""])
@pytest.mark.asyncio
async def test_bad_month_day_raises(svc, bad):
    with pytest.raises(ValueError):
        await otd.on_this_day(SERVICE, svc, bad, now=NOW)


def test_parse_month_day():
    assert otd.parse_month_day("02-29") == (2, 29)
    assert otd.parse_month_day("12-31") == (12, 31)
    assert (
        otd.month_day_of(datetime(2026, 11, 9, 16, 0, tzinfo=timezone.utc)) == "11-10"
    )


@pytest.mark.asyncio
async def test_text_free_part_is_cached_and_texts_attached_after(svc, monkeypatch):
    with capture_logs() as logs:
        first = await otd.on_this_day(SERVICE, svc, "11-10", now=NOW)
    assert [e["outcome"] for e in logs if e["event"] == "memories_view_cache"] == [
        "miss"
    ]

    async def boom(*a, **k):
        raise AssertionError("facts read on a cache hit")

    monkeypatch.setattr(people, "service_facts_on", boom)
    with capture_logs() as logs:
        again = await otd.on_this_day(SERVICE, svc, "11-10", now=NOW)
    assert [e["outcome"] for e in logs if e["event"] == "memories_view_cache"] == [
        "hit"
    ]
    assert again == first  # texts re-attached after the cache read


@pytest.mark.asyncio
async def test_cache_row_is_per_month_day_and_follows_the_data(svc):
    await otd.on_this_day(SERVICE, svc, "11-10", now=NOW)
    tomorrow = datetime(2026, 11, 10, 16, 0, tzinfo=timezone.utc)  # 11-11 JST
    with capture_logs() as logs:
        await otd.on_this_day(SERVICE, svc, "11-10", now=tomorrow)
    # same last year, same data: the row from yesterday still answers
    assert [e["outcome"] for e in logs if e["event"] == "memories_view_cache"] == [
        "hit"
    ]
    next_year = datetime(2027, 11, 10, 3, 0, tzinfo=timezone.utc)
    with capture_logs() as logs:
        await otd.on_this_day(SERVICE, svc, "11-10", now=next_year)
    assert [e["outcome"] for e in logs if e["event"] == "memories_view_cache"] == [
        "miss"
    ]
    with contextlib.closing(mi._connect()) as c:
        rows = c.execute(
            "SELECT key FROM memories_view_cache WHERE view='on_this_day'"
        ).fetchall()
    assert rows == [("11-10",)]  # two different days, one row (replaced)
    write_room(
        svc,
        "40 松田 好花",
        "64 松田 好花",
        [
            msg(1, "2025-11-10T04:00:00Z", content=MATSU_2025),
            msg(2, "2024-11-10T04:00:00Z", content="新しく同期した"),
        ],
    )
    with capture_logs() as logs:
        payload = await otd.on_this_day(SERVICE, svc, "11-10", now=tomorrow)
    assert [e["outcome"] for e in logs if e["event"] == "memories_view_cache"] == [
        "miss"
    ]
    assert by_year(payload)[2024]["has_messages"] is True


@pytest.mark.asyncio
async def test_preview_texts_load_once_per_room_for_preview_ids(svc, monkeypatch):
    calls = []
    real = people.load_texts

    def counting(sdir, mdir, ids=None):
        calls.append((mdir.relative_to(sdir).as_posix(), set(ids)))
        return real(sdir, mdir, ids)

    monkeypatch.setattr(people, "load_texts", counting)
    await otd.on_this_day(SERVICE, svc, "11-10", now=NOW)
    rooms = [c[0] for c in calls]
    assert len(rooms) == len(set(rooms))  # one read per room
    assert dict(calls)[KANE] == {2, 4}  # preview ids only (2023 + 2025)


@pytest.mark.asyncio
async def test_logs_breadcrumbs_without_text_or_names(svc):
    with capture_logs() as logs:
        await otd.on_this_day(SERVICE, svc, "11-10", now=NOW)
    (summary,) = [e for e in logs if e["event"] == "memories_on_this_day"]
    assert summary["years"] == 4 and summary["with_messages"] == 2
    assert summary["count"] == 9
    selects = [e for e in logs if e["event"] == "memories_select"]
    assert {e["rule"] for e in selects} == {"preview", "thumb"}
    assert all(e["view"] == "on_this_day" for e in selects)
    skips = [e for e in logs if e["event"] == "memories_skip"]
    assert {(e["reason"], e["year"]) for e in skips} == {
        ("no_thumb", 2023),
        ("current_year_empty", 2026),
    }
    blob = json.dumps([dict(e) for e in logs], ensure_ascii=False, default=str)
    for needle in (
        KANE_2023,
        KANE_2025,
        MATSU_2025,
        "金村",
        "松田",
        "小坂",
        "messages/",
        str(svc),
    ):
        assert needle not in blob


@pytest.mark.asyncio
async def test_year_with_only_promo_and_media_has_no_preview(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    sdir = tmp_path / "out" / SVC_NAME
    write_room(
        sdir,
        "34 金村 美玖",
        "58 金村 美玖",
        [msg(1, "2025-11-10T03:00:00Z", content=PROMO)],
    )

    async def none(service):
        return set()

    monkeypatch.setattr(oshi_mod, "oshi_names", none)
    with capture_logs() as logs:
        payload = await otd.on_this_day(SERVICE, sdir, "11-10", now=NOW)
    (y25,) = [y for y in payload["years"] if y["has_messages"]]
    assert y25["preview"] == [] and y25["more"] == 1 and y25["thumb"] is None
    reasons = {e["reason"] for e in logs if e["event"] == "memories_skip"}
    assert {"no_preview", "no_thumb"} <= reasons


@pytest.mark.asyncio
async def test_thumb_prefers_a_picture_over_a_better_video(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    sdir = tmp_path / "out" / SVC_NAME
    media = f"{KANE}/video/1.mp4".replace("/", "\\")
    write_room(
        sdir,
        "34 金村 美玖",
        "58 金村 美玖",
        [
            msg(1, "2024-11-10T03:00:00Z", "video", fav=True, media_file=media),
            pic(2, "2024-11-10T05:00:00Z"),  # lower photo_score, still the thumb
            msg(3, "2025-11-10T03:00:00Z", "video", media_file=media),
        ],
    )

    async def none(service):
        return set()

    monkeypatch.setattr(oshi_mod, "oshi_names", none)
    years = by_year(await otd.on_this_day(SERVICE, sdir, "11-10", now=NOW))
    assert years[2024]["thumb"]["id"] == 2
    assert years[2024]["thumb"]["type"] == "picture"
    assert years[2025]["thumb"]["type"] == "video"  # no picture: a video
