"""Album (``backend/services/memories/album.py`` and ``covers.py``)."""

from __future__ import annotations

import contextlib
import dataclasses
import json

import pytest
from structlog.testing import capture_logs

from backend.services.memories import album
from backend.services.memories import covers
from backend.services.memories import index as mi
from backend.services.memories import oshi as oshi_mod
from backend.services.memories import people
from backend.services.memories.view_cache import contains_text
from backend.tests.memories_archive import msg, write_room
from backend.tests.test_memories_cards import fact

SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
ROOM_A = "messages/34 金村 美玖/58 金村 美玖"
ROOM_B = "messages/35 小坂 菜緒/60 小坂 菜緒"
CAPTION = "見てね🌻 今日の空"


# --- choose_cover (pure) ----------------------------------------------------------------


def media(i, when, *, score=None, fav=False, promo=False, burst=None, type_="picture"):
    return dataclasses.replace(
        fact(i, when, type_, promo=promo),
        photo_score=score,
        favorited=fav,
        burst_id=burst,
    )


def never(room, f):
    return False


def choose(cands, *, override=None, oshi=frozenset(), shot=never):
    return album.choose_cover(
        cands, override=override, oshi_rooms=set(oshi), screenshot_like=shot
    )


def picked(result):
    (room, f), rule = result
    return room, f.id, rule


def test_choose_cover_empty_is_none():
    assert choose([]) is None


def test_choose_cover_override_wins():
    cands = [
        ("a", media(1, "2024-09-01 12:00", score=900, fav=True)),
        ("a", media(2, "2024-09-02 12:00", score=10)),
    ]
    assert picked(choose(cands, override=("a", 2))) == ("a", 2, "override")


def test_choose_cover_stale_override_is_ignored():
    cands = [("a", media(1, "2024-09-01 12:00", score=10))]
    # gone from the month (or another room's id): the normal rules decide
    assert picked(choose(cands, override=("a", 99))) == ("a", 1, "score")
    assert picked(choose(cands, override=("b", 1))) == ("a", 1, "score")


def test_choose_cover_favorite_oshi_first():
    cands = [
        ("other", media(1, "2024-09-01 12:00", score=900, fav=True)),
        ("oshi", media(2, "2024-09-02 12:00", score=500, fav=True)),
        ("other", media(3, "2024-09-03 12:00", score=999)),
    ]
    assert picked(choose(cands, oshi={"oshi"})) == ("oshi", 2, "favorite")
    assert picked(choose(cands)) == ("other", 1, "favorite")


def test_choose_cover_score_then_earlier():
    cands = [
        ("a", media(1, "2024-09-01 12:00", score=100)),
        ("a", media(2, "2024-09-02 12:00", score=300)),
        ("a", media(3, "2024-09-03 12:00", score=300)),
    ]
    assert picked(choose(cands)) == ("a", 2, "score")


def test_choose_cover_burst_fallback():
    # promo items have no photo_score: only bursts and time order are left
    cands = [
        ("a", media(1, "2024-09-01 12:00", promo=True)),
        ("a", media(5, "2024-09-05 12:00", promo=True, burst=5)),
        ("a", media(6, "2024-09-05 12:01", promo=True, burst=5)),
        ("b", media(5, "2024-09-06 12:00", promo=True, burst=5)),
        ("a", media(7, "2024-09-05 12:02", promo=True, burst=5)),
    ]
    # (a, 5) has three items, (b, 5) one: burst ids are per room
    assert picked(choose(cands)) == ("a", 5, "burst")


def test_choose_cover_first_in_time_order():
    cands = [
        ("a", media(2, "2024-09-02 12:00", promo=True)),
        ("a", media(1, "2024-09-01 12:00", promo=True)),
    ]
    assert picked(choose(cands)) == ("a", 1, "first")


def test_choose_cover_promo_is_a_last_resort_across_rules():
    cands = [
        ("a", media(1, "2024-09-01 12:00", fav=True, promo=True)),
        ("a", media(2, "2024-09-02 12:00", score=10)),
        ("a", media(3, "2024-09-03 12:00", score=40)),
    ]
    # the promo-only star loses to the clean scored photos
    assert picked(choose(cands)) == ("a", 3, "score")
    clean_star = [*cands, ("a", media(4, "2024-09-04 12:00", score=5, fav=True))]
    assert picked(choose(clean_star)) == ("a", 4, "favorite")
    # nothing clean: the same chain runs over the demoted items
    assert picked(choose(cands[:1])) == ("a", 1, "favorite")
    # a deliberate override still wins, promo or not
    assert picked(choose(cands, override=("a", 1))) == ("a", 1, "override")


def test_choose_cover_screenshot_is_a_last_resort_across_rules():
    cands = [
        ("a", media(1, "2024-09-01 12:00", score=900, fav=True)),
        ("a", media(2, "2024-09-02 12:00", score=10)),
    ]

    def shot(room, f):
        return f.id == 1

    assert picked(choose(cands, shot=shot)) == ("a", 2, "score")


def test_choose_cover_asks_the_top_three_of_every_rule_once():
    # favorite top 3: 7, 8, 9; score top 3: 1, 2, 3; first top 3: 1, 2, 3
    cands = [("a", media(i, f"2024-09-0{i} 12:00", score=100 - i)) for i in range(1, 7)]
    cands += [
        ("a", media(i, f"2024-09-{i + 10} 12:00", score=1, fav=True))
        for i in range(7, 11)
    ]
    asked: list[int] = []

    def shot(room, f):
        asked.append(f.id)
        return False

    assert picked(choose(cands, shot=shot)) == ("a", 7, "favorite")
    assert sorted(asked) == [1, 2, 3, 7, 8, 9]


def test_choose_cover_demotes_screenshots_in_the_top_three():
    cands = [("a", media(i, f"2024-09-0{i} 12:00", score=100 - i)) for i in range(1, 6)]
    asked: list[int] = []

    def shot(room, f):
        asked.append(f.id)
        return f.id in (1, 2)

    assert picked(choose(cands, shot=shot)) == ("a", 3, "score")
    assert sorted(asked) == [1, 2, 3]  # only the top three are probed

    def all_shots(room, f):
        return True

    # every probed one is a screenshot: the fourth comes first
    assert picked(choose(cands, shot=all_shots)) == ("a", 4, "score")
    assert picked(choose(cands[:2], shot=all_shots)) == ("a", 1, "score")


# --- covers hook -----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cover_overrides_are_empty_this_wave(tmp_path):
    assert await covers.load_cover_overrides(tmp_path, "all") == {}


# --- album services on an archive ----------------------------------------------------


def pic(i, ts, *, fav=False, content="", type_="picture", room=ROOM_A):
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
    out = tmp_path / "out"
    sdir = out / SVC_NAME
    monkeypatch.setattr(people, "output_dir", lambda: out)
    write_room(
        sdir,
        "34 金村 美玖",
        "58 金村 美玖",
        [
            msg(1, "2024-09-01T03:00:00Z", content=CAPTION),
            pic(2, "2024-09-01T03:01:00Z", fav=True),  # caption = message 1
            pic(10, "2024-09-14T03:00:00Z"),
            pic(11, "2024-09-14T03:05:00Z"),
            pic(12, "2024-09-14T03:09:00Z"),
            pic(13, "2024-09-20T03:00:00Z", type_="video"),
            pic(20, "2024-10-05T03:00:00Z", content="https://example.jp/shop"),
            msg(30, "2024-11-01T03:00:00Z", content="文字だけ"),
        ],
    )
    write_room(
        sdir,
        "35 小坂 菜緒",
        "60 小坂 菜緒",
        [  # the same ids as room A's burst: burst ids are per room
            pic(10, "2024-09-14T05:00:00Z", room=ROOM_B),
            pic(11, "2024-09-14T05:02:00Z", room=ROOM_B),
            pic(12, "2024-09-14T05:04:00Z", room=ROOM_B),
            pic(40, "2024-12-01T03:00:00Z", room=ROOM_B),
        ],
    )
    write_room(
        sdir, "36 文字", "61 文字", [msg(1, "2024-09-01T03:00:00Z", content="文字")]
    )
    return sdir


async def person(sdir, room):
    return next(s for s in await mi.list_members(sdir) if room in s.member_dirs)


@pytest.mark.asyncio
async def test_album_members_counts_and_order(svc, oshi_names):
    body = await album.album_members(SERVICE, svc)
    assert body["total"] == 10
    rows = body["members"]
    assert [(r["member_path"], r["count"]) for r in rows] == [
        (f"{SVC_NAME}/{ROOM_A}", 6),
        (f"{SVC_NAME}/{ROOM_B}", 4),
    ]  # the text-only member is omitted (never a 0)
    assert rows[0]["member_id"] == "58" and rows[0]["name"]
    assert "avatar_url" in rows[0]
    assert [r["oshi"] for r in rows] == [False, False]
    oshi_names.add((await person(svc, ROOM_B)).name_norm)
    rows = (await album.album_members(SERVICE, svc))["members"]
    assert rows[0]["member_path"] == f"{SVC_NAME}/{ROOM_B}"  # oshi first
    assert [r["oshi"] for r in rows] == [True, False]  # the list shows her heart


@pytest.mark.asyncio
async def test_album_months_kinds(svc):
    a = await person(svc, ROOM_A)
    body = await album.album_months(SERVICE, svc, member=a, kind="all")
    months = body["months"]
    assert [m["month"] for m in months] == ["2024-10", "2024-09"]  # newest first
    oct_, sep = months
    assert (sep["count"], sep["has_favorites"]) == (5, True)
    assert (oct_["count"], oct_["has_favorites"]) == (1, False)
    assert sep["cover"]["id"] == 2 and sep["cover_rule"] == "favorite"
    assert sep["cover"]["caption"] == CAPTION  # attached after the cache read
    assert oct_["cover_rule"] == "first"  # the promo picture is all there is

    pics = (await album.album_months(SERVICE, svc, member=a, kind="picture"))["months"]
    assert [(m["month"], m["count"]) for m in pics] == [("2024-10", 1), ("2024-09", 4)]
    vids = (await album.album_months(SERVICE, svc, member=a, kind="video"))["months"]
    assert [(m["month"], m["count"]) for m in vids] == [("2024-09", 1)]
    assert vids[0]["cover"]["id"] == 13 and vids[0]["cover_rule"] == "score"
    assert vids[0]["has_favorites"] is False
    favs = (await album.album_months(SERVICE, svc, member=a, kind="favorite"))["months"]
    assert [(m["month"], m["count"], m["has_favorites"]) for m in favs] == [
        ("2024-09", 1, True)
    ]


@pytest.mark.asyncio
async def test_album_months_all_members(svc):
    with capture_logs() as logs:
        body = await album.album_months(SERVICE, svc, member=None, kind="all")
    assert [(m["month"], m["count"]) for m in body["months"]] == [
        ("2024-12", 1),
        ("2024-10", 1),
        ("2024-09", 8),
    ]
    assert body["months"][0]["cover"]["member_path"] == f"{SVC_NAME}/{ROOM_B}"
    selects = [e for e in logs if e["event"] == "memories_select"]
    assert {e["view"] for e in selects} == {"album_cover"}
    assert {e["month"] for e in selects} == {"2024-12", "2024-10", "2024-09"}
    assert all("rule" in e and "score" in e and "message_id" in e for e in selects)
    (summary,) = [e for e in logs if e["event"] == "memories_album"]
    assert (summary["months"], summary["count"], summary["kind"]) == (3, 10, "all")


@pytest.mark.asyncio
async def test_album_months_cache_holds_no_text(svc):
    a = await person(svc, ROOM_A)
    await album.album_months(SERVICE, svc, member=a, kind="all")
    with contextlib.closing(mi._connect()) as c:
        rows = c.execute(
            "SELECT payload FROM memories_view_cache WHERE view='album_months'"
        ).fetchall()
    assert rows
    for (blob,) in rows:
        assert not contains_text(json.loads(blob))
        assert CAPTION not in blob
    with capture_logs() as logs:
        again = await album.album_months(SERVICE, svc, member=a, kind="all")
    assert [e["outcome"] for e in logs if e["event"] == "memories_view_cache"] == [
        "hit"
    ]
    assert again["months"][1]["cover"]["caption"] == CAPTION


@pytest.mark.asyncio
async def test_album_months_override(svc, monkeypatch):
    seen: list[str] = []

    async def fake(sdir, scope):
        seen.append(scope)
        return {"2024-09": (ROOM_B, 11), "2024-10": (ROOM_A, 999)}

    monkeypatch.setattr(covers, "load_cover_overrides", fake)
    months = (await album.album_months(SERVICE, svc, member=None, kind="all"))["months"]
    by = {m["month"]: m for m in months}
    assert by["2024-09"]["cover_rule"] == "override"
    assert by["2024-09"]["cover"]["id"] == 11
    assert by["2024-09"]["cover"]["room"] == ROOM_B
    assert by["2024-10"]["cover_rule"] == "first"  # a stale override is ignored
    assert seen == ["all"]
    a = await person(svc, ROOM_A)
    await album.album_months(SERVICE, svc, member=a, kind="all")
    assert seen[-1] == people.person_key(a)


@pytest.mark.asyncio
async def test_album_months_screenshot_demoted(svc, monkeypatch):
    from backend.services.memories import album_colors as ac

    async def fake_probes(sdir, files):
        # message 2 (the favourite) is a tall PNG screenshot
        out = {}
        for f in files:
            tall = f in (f"{ROOM_A}/picture/2.jpg", f"{ROOM_B}/picture/12.jpg")
            out[f] = ac.ImageProbe(
                width=100, height=300 if tall else 100, fmt="PNG", rgb=None
            )
        return out

    monkeypatch.setattr(ac, "probes", fake_probes)
    a = await person(svc, ROOM_A)
    sep = (await album.album_months(SERVICE, svc, member=a, kind="picture"))["months"][
        1
    ]
    # the only favourite is a screenshot: a clean scored photo wins instead
    assert sep["cover"]["id"] == 12 and sep["cover_rule"] == "score"
    assert sep["cover_color"] is None  # the fake probes carry no colour
    b = await person(svc, ROOM_B)
    sep_b = (await album.album_months(SERVICE, svc, member=b, kind="all"))["months"][1]
    # 12 (last of the burst) has the top score but is a screenshot: 10 wins
    assert sep_b["cover"]["id"] == 10 and sep_b["cover_rule"] == "score"


@pytest.mark.asyncio
async def test_album_months_empty(svc):
    c = await person(svc, "messages/36 文字/61 文字")
    assert await album.album_months(SERVICE, svc, member=c, kind="all") == {
        "months": []
    }


@pytest.mark.asyncio
async def test_album_months_bad_kind(svc):
    with pytest.raises(ValueError):
        await album.album_months(SERVICE, svc, member=None, kind="voice")


@pytest.mark.asyncio
async def test_album_month_items_and_bursts(svc):
    body = await album.album_month(SERVICE, svc, "2024-09", member=None, kind="all")
    assert body["month"] == "2024-09"
    items = body["items"]
    assert [(i["room"], i["id"]) for i in items] == [
        (ROOM_A, 2),
        (ROOM_A, 10),
        (ROOM_A, 11),
        (ROOM_A, 12),
        (ROOM_B, 10),
        (ROOM_B, 11),
        (ROOM_B, 12),
        (ROOM_A, 13),
    ]
    assert items[0]["caption"] == CAPTION
    assert body["bursts"] == [
        {"burst_id": 10, "room": ROOM_A, "ids": [10, 11, 12]},
        {"burst_id": 10, "room": ROOM_B, "ids": [10, 11, 12]},
    ]
    vids = await album.album_month(SERVICE, svc, "2024-09", member=None, kind="video")
    assert [i["id"] for i in vids["items"]] == [13] and vids["bursts"] == []


@pytest.mark.asyncio
async def test_album_month_one_member_and_empty(svc):
    b = await person(svc, ROOM_B)
    body = await album.album_month(SERVICE, svc, "2024-09", member=b, kind="picture")
    assert {i["room"] for i in body["items"]} == {ROOM_B}
    assert len(body["bursts"]) == 1
    empty = await album.album_month(SERVICE, svc, "2023-01", member=b, kind="all")
    assert empty == {"month": "2023-01", "items": [], "bursts": []}


@pytest.mark.asyncio
async def test_album_month_validates(svc):
    with pytest.raises(ValueError):
        await album.album_month(SERVICE, svc, "2024-13", member=None, kind="all")
    with pytest.raises(ValueError):
        await album.album_month(SERVICE, svc, "2024-09", member=None, kind="x")


@pytest.mark.asyncio
async def test_album_months_promo_only_star_gets_a_clean_cover(tmp_path, oshi_names):
    mi.set_db_path(tmp_path / "idx.db")
    sdir = tmp_path / "out" / SVC_NAME
    write_room(
        sdir,
        "34 金村 美玖",
        "58 金村 美玖",
        [
            pic(1, "2024-09-01T03:00:00Z", fav=True, content="https://example.jp/shop"),
            pic(2, "2024-09-05T12:00:00Z"),  # 21:00 JST: +80
            pic(3, "2024-09-09T03:00:00Z"),
        ],
    )
    a = await person(sdir, ROOM_A)
    (sep,) = (await album.album_months(SERVICE, sdir, member=a, kind="all"))["months"]
    assert sep["cover"]["id"] == 2 and sep["cover_rule"] == "score"
    assert sep["has_favorites"] is True


def _jpeg(path, color):
    from PIL import Image

    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (60, 40), color).save(path, "JPEG", quality=95)


@pytest.mark.asyncio
async def test_album_months_cover_color(svc):
    a = await person(svc, ROOM_A)
    _jpeg(svc / ROOM_A / "picture" / "2.jpg", (220, 30, 30))
    months = (await album.album_months(SERVICE, svc, member=a, kind="all"))["months"]
    hex_ = months[1]["cover_color"]  # 2024-09: cover is picture 2
    r, g, b = (int(hex_[i : i + 2], 16) for i in (1, 3, 5))
    assert r > 150 and g < 90 and b < 90
    assert months[0]["cover_color"] is None  # 2024-10: the file is missing
    vids = (await album.album_months(SERVICE, svc, member=a, kind="video"))["months"]
    assert vids[0]["cover"]["type"] == "video" and vids[0]["cover_color"] is None


@pytest.mark.asyncio
async def test_album_months_cover_color_for_an_unasked_cover(
    tmp_path, oshi_names, monkeypatch
):
    # an all-promo month: the cover comes from the demoted chain, which the
    # screenshot check never asks about; it is probed for its tint afterwards
    mi.set_db_path(tmp_path / "idx.db")
    out = tmp_path / "out"
    sdir = out / SVC_NAME
    write_room(
        sdir,
        "34 金村 美玖",
        "58 金村 美玖",
        [pic(1, "2024-09-01T03:00:00Z", content="https://example.jp/shop")],
    )
    _jpeg(sdir / ROOM_A / "picture" / "1.jpg", (30, 60, 200))
    monkeypatch.setattr(people, "output_dir", lambda: out)
    a = await person(sdir, ROOM_A)
    (sep,) = (await album.album_months(SERVICE, sdir, member=a, kind="all"))["months"]
    assert sep["cover_rule"] == "first" and sep["cover_color"] is not None


@pytest.mark.asyncio
async def test_album_months_rebuilds_after_media_repair(svc):
    import os

    a = await person(svc, ROOM_A)
    pics = svc / ROOM_A / "picture"
    pics.mkdir(parents=True, exist_ok=True)
    first = (await album.album_months(SERVICE, svc, member=a, kind="all"))["months"]
    assert first[1]["cover_color"] is None  # no file yet
    _jpeg(pics / "2.jpg", (220, 30, 30))  # messages.json is not rewritten
    st = pics.stat()
    os.utime(pics, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    again = (await album.album_months(SERVICE, svc, member=a, kind="all"))["months"]
    assert again[1]["cover_color"] is not None
