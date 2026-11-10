"""Memories notification content (``backend/services/memories/notify_content.py``)."""

from __future__ import annotations

import dataclasses
import json
import re
from datetime import date, datetime, time, timezone
from pathlib import Path

import pytest
import pytest_asyncio
import time_machine
from structlog.testing import capture_logs

from backend.services import app_state
from backend.services.i18n import SUPPORTED, get_strings
from backend.services.memories import binder, hub, people, recap
from backend.services.memories import index as mi
from backend.services.memories import notify_content as nc
from backend.services.memories import notify_rules as nr
from backend.services.memories import oshi as oshi_mod
from backend.tests.memories_archive import msg, write_room, write_side_inputs

HINATA = "hinatazaka46"
SAKURA = "sakurazaka46"
NOGI = "nogizaka46"
HINATA_NAME = "日向坂46"
SAKURA_NAME = "櫻坂46"
KANE = "messages/34 金村 美玖/58 金村 美玖"
MATSU = "messages/40 松田 好花/64 松田 好花"
SASAKI = "messages/41 佐々木 久美/65 佐々木 久美"
FUJI = "messages/43 藤吉 夏鈴/67 藤吉 夏鈴"
NAMES = ("金村", "松田", "佐々木", "藤吉")
SLOT = time(12, 0)
NOW = datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc)  # 12:00 JST
TODAY = date(2026, 11, 10)
KANE_WORDS = "ありがとう、またね"
MATSU_WORDS = (
    "今日は本当に楽しかった、みんなに会えて嬉しい、ずっと応援してくれてありがとう！"
)
NICKNAME = "みく推し"
I18N_DIR = Path(__file__).resolve().parent.parent / "i18n"
PLACEHOLDER_RE = re.compile(r"\{(\w+)\}")
AVATAR = [
    {
        "kind": "thumbnail",
        "file": "thumbnail/a.jpg",
        "first_seen": "2024-01-01T00:00:00+00:00",
    }
]


# --- fixtures and helpers -------------------------------------------------------------


@pytest.fixture(autouse=True)
def no_text_in_logs():
    """Across every test: no event carries a name, a nickname, a quote or a path."""
    with capture_logs() as logs:
        yield logs
    for event in logs:
        for value in event.values():
            text = str(value)
            for bad in ("/", "\\", "%", "「", "『", NICKNAME, *NAMES):
                assert bad not in text, (event["event"], bad)


def set_oshi(monkeypatch, by_service):
    async def fake(service):
        return set(by_service.get(service, ()))

    monkeypatch.setattr(oshi_mod, "oshi_names", fake)


@pytest.fixture
def out(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    app_state.set_db_path(tmp_path / "app.db")
    app_state.init_db()
    root = tmp_path / "out"
    monkeypatch.setattr(people, "output_dir", lambda: root)
    set_oshi(monkeypatch, {HINATA: {"金村美玖"}})
    return root


@pytest.fixture
def svc(out):
    return out / HINATA_NAME


def room(sdir, path, msgs, **kw):
    _, gid_group, mid_name = path.split("/")
    return write_room(sdir, gid_group, mid_name, msgs, **kw)


def pic(path, i, ts, fav=False):
    return msg(
        i,
        ts,
        "picture",
        fav=fav,
        media_file=f"{path}/picture/{i}.jpg".replace("/", "\\"),
    )


def ctx(lang="ja", *, hide=False, nickname=None, now=NOW):
    settings = {"user_nicknames": {HINATA: nickname}} if nickname else {}
    return nc.Context(
        settings=settings,
        strings=get_strings("memories_notify", lang),
        now=now,
        hide_content=hide,
    )


def jpeg(path: Path, size=(64, 48)) -> Path:
    """A real JPEG at ``path`` (the hero is decoded and downscaled)."""
    from PIL import Image

    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, (200, 120, 90)).save(path, format="JPEG")
    return path


def is_toast_copy(hero: Path, original: Path) -> bool:
    """The hero is a cached JPEG copy within the toast bounds, never the original."""
    from PIL import Image

    from backend.services import photo_thumb

    with Image.open(hero) as img:
        fits = max(img.size) <= photo_thumb.TOAST_WIDTH and img.format == "JPEG"
    return (
        hero.is_absolute()
        and hero.resolve() != original.resolve()
        and hero.parent == photo_thumb.cache_dir()
        and hero.stat().st_size <= photo_thumb.TOAST_MAX_BYTES
        and fits
    )


def otd(day=TODAY):
    return nr.on_this_day_occasion(day, SLOT)


def one_number(plan):
    """Spec 1: at most one number in title + body (fixtures are digit-free)."""
    assert len(re.findall(r"\d+", plan.title + plan.body)) <= 1, plan
    return plan


async def summaries_of(sdir):
    return await mi.list_members(sdir)


def by_name(summaries, part):
    return next(s for s in summaries if part in s.name)


# --- context / helpers ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_load_context_uses_the_ui_language_and_hide_setting(out):
    app_state.set_prefs({"language": "zh-TW"})
    c = await nc.load_context({"notifications_hide_content": True}, NOW)
    assert c.strings["birthday_title"] == "今天是{name}的生日"
    assert c.hide_content is True and c.now == NOW
    app_state.set_prefs({"language": ""})
    c = await nc.load_context({}, NOW)
    assert c.strings["otd_title_one"] == "{n} year ago today"
    assert c.hide_content is False


def test_quote_masks_or_fills_the_nickname_and_clips():
    assert nc.quote(ctx(), "%%%、ありがとう", HINATA) == "『＊＊＊』、ありがとう"
    assert nc.quote(ctx(nickname=NICKNAME), "％％％、ありがとう", HINATA) == (
        f"{NICKNAME}、ありがとう"
    )
    assert nc.quote(ctx(), "あ" * 200, HINATA) == "あ" * nc.QUOTE_MAX_CHARS + "…"
    assert nc.quote(ctx(), None, HINATA) is None
    assert nc.quote(ctx(), "  \n ", HINATA) is None


def test_plural_picks_the_english_form():
    assert nc.plural(ctx("en"), "otd_title", 1) == "1 year ago today"
    assert nc.plural(ctx("en"), "otd_title", 3) == "3 years ago today"
    assert nc.plural(ctx("en"), "birthday_soon_title", 7, name="Miku") == (
        "7 days until Miku's birthday"
    )


# --- on this day -------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_otd_oshi_wins_over_higher_importance(svc):
    room(
        svc, KANE, [msg(1, "2023-11-10T03:00:00Z", content=KANE_WORDS)], avatars=AVATAR
    )
    room(svc, MATSU, [msg(1, "2024-11-10T03:00:00Z", content=MATSU_WORDS)])
    with time_machine.travel(NOW, tick=False):
        plan = one_number(await nc.on_this_day_plan(ctx(), [HINATA], otd()))
    assert plan.title == "3年前の今日"
    assert plan.body == f"金村 美玖「{KANE_WORDS}」"
    assert plan.kind == "on_this_day" and plan.service == HINATA
    assert plan.subject == "" and plan.occasion == "2026-11-10"
    assert plan.route == {"page": "onThisDay", "monthDay": "11-10", "year": 2023}
    assert plan.member_id == "58" and plan.hero is None
    assert plan.avatar == svc / KANE / "profile_images" / "thumbnail" / "a.jpg"


@pytest.mark.asyncio
async def test_otd_without_oshi_takes_the_higher_score(svc, monkeypatch):
    set_oshi(monkeypatch, {})
    room(svc, KANE, [msg(1, "2023-11-10T03:00:00Z", content=KANE_WORDS)])
    room(svc, MATSU, [msg(1, "2024-11-10T03:00:00Z", content=MATSU_WORDS)])
    plan = one_number(await nc.on_this_day_plan(ctx("en"), [HINATA], otd()))
    assert plan.title == "2 years ago today" and plan.member_id == "64"
    assert plan.body.startswith('松田 好花: "') and plan.avatar is None


@pytest.mark.asyncio
async def test_otd_oshi_in_another_service_wins(out, monkeypatch):
    set_oshi(monkeypatch, {SAKURA: {"藤吉夏鈴"}})
    room(
        out / HINATA_NAME,
        MATSU,
        [msg(1, "2024-11-10T03:00:00Z", content=MATSU_WORDS)],
    )
    room(out / SAKURA_NAME, FUJI, [msg(1, "2025-11-10T03:00:00Z", content=KANE_WORDS)])
    services = ["bogus", NOGI, HINATA, SAKURA]
    plan = one_number(await nc.on_this_day_plan(ctx("en"), services, otd()))
    assert plan.service == SAKURA and plan.title == "1 year ago today"
    assert plan.route["year"] == 2025


@pytest.mark.asyncio
async def test_otd_ties_go_to_the_earlier_service(out, monkeypatch):
    set_oshi(monkeypatch, {})
    room(out / HINATA_NAME, MATSU, [msg(1, "2024-11-10T03:00:00Z", content=KANE_WORDS)])
    room(out / SAKURA_NAME, FUJI, [msg(1, "2024-11-10T03:00:00Z", content=KANE_WORDS)])
    plan = await nc.on_this_day_plan(ctx(), [SAKURA, HINATA], otd())
    assert plan.service == SAKURA


@pytest.mark.asyncio
async def test_otd_near_dates_only_is_none(svc):
    room(
        svc,
        KANE,
        [
            msg(1, "2024-11-08T03:00:00Z", content=KANE_WORDS),
            msg(2, "2025-11-12T03:00:00Z", content=MATSU_WORDS),
        ],
    )
    assert await nc.on_this_day_plan(ctx(), [HINATA], otd()) is None


@pytest.mark.asyncio
async def test_otd_photo_only_day_has_the_photo_body_and_hero(svc):
    room(svc, KANE, [pic(KANE, 1, "2024-11-10T12:00:00Z")])
    photo = jpeg(svc / KANE / "picture" / "1.jpg")
    plan = one_number(await nc.on_this_day_plan(ctx(), [HINATA], otd()))
    assert plan.body == "金村 美玖の写真が届いた日"
    assert is_toast_copy(plan.hero, photo)
    photo.unlink()  # a missing file never becomes the hero
    plan = await nc.on_this_day_plan(ctx(), [HINATA], otd())
    assert plan.hero is None and plan.body == "金村 美玖の写真が届いた日"


@pytest.mark.asyncio
async def test_otd_words_with_her_photo_of_the_day_as_hero(svc):
    room(
        svc,
        KANE,
        [
            msg(1, "2024-11-10T03:00:00Z", content=KANE_WORDS),
            pic(KANE, 2, "2024-11-10T12:00:00Z", fav=True),
        ],
    )
    photo = jpeg(svc / KANE / "picture" / "2.jpg")
    plan = await nc.on_this_day_plan(ctx(), [HINATA], otd())
    assert plan.body == f"金村 美玖「{KANE_WORDS}」"
    assert is_toast_copy(plan.hero, photo)
    hidden = one_number(await nc.on_this_day_plan(ctx(hide=True), [HINATA], otd()))
    assert hidden.body == "金村 美玖のメッセージを振り返る"
    assert hidden.hero is None and hidden.title == "2年前の今日"


@pytest.mark.asyncio
async def test_otd_hide_content_keeps_the_name_and_avatar(svc):
    room(
        svc, KANE, [msg(1, "2024-11-10T03:00:00Z", content=KANE_WORDS)], avatars=AVATAR
    )
    plan = one_number(await nc.on_this_day_plan(ctx("en", hide=True), [HINATA], otd()))
    assert plan.body == "Look back at 金村 美玖's messages"
    assert plan.hero is None and plan.avatar is not None
    assert KANE_WORDS not in plan.title + plan.body


@pytest.mark.asyncio
async def test_otd_nickname_is_filled_or_masked(svc):
    room(svc, KANE, [msg(1, "2024-11-10T03:00:00Z", content="%%%、今日もありがとう！")])
    plan = await nc.on_this_day_plan(ctx(nickname=NICKNAME), [HINATA], otd())
    assert plan.body == f"金村 美玖「{NICKNAME}、今日もありがとう！」"
    plan = await nc.on_this_day_plan(ctx(), [HINATA], otd())
    assert plan.body == "金村 美玖「『＊＊＊』、今日もありがとう！」"


@pytest.mark.asyncio
async def test_otd_long_quote_is_clipped_and_emoji_cjk_survive(svc):
    long = "🌸今日は楽しかった😊" * 20  # 200 characters
    room(svc, KANE, [msg(1, "2024-11-10T03:00:00Z", content=long)])
    plan = one_number(await nc.on_this_day_plan(ctx(), [HINATA], otd()))
    quoted = plan.body.removeprefix("金村 美玖「").removesuffix("」")
    assert quoted == long[: nc.QUOTE_MAX_CHARS] + "…"
    assert "🌸" in quoted and "😊" in quoted


@pytest.mark.asyncio
async def test_otd_feb_29_uses_leap_years_only(svc):
    room(
        svc,
        KANE,
        [
            msg(1, "2024-02-29T03:00:00Z", content=KANE_WORDS),
            msg(2, "2027-02-28T03:00:00Z", content=MATSU_WORDS),
        ],
    )
    leap = date(2028, 2, 29)
    plan = one_number(await nc.on_this_day_plan(ctx(), [HINATA], otd(leap)))
    assert plan.title == "4年前の今日" and plan.route["monthDay"] == "02-29"
    assert plan.route["year"] == 2024 and KANE_WORDS in plan.body


@pytest.mark.asyncio
async def test_otd_voice_moment_never_claims_a_photo(svc, monkeypatch):
    room(svc, KANE, [msg(1, "2024-11-10T03:00:00Z", content=KANE_WORDS)])
    real = hub.today_moment

    async def voice(*args):
        moment = await real(*args)
        moment["message"] = {**moment["message"], "type": "voice", "text": None}
        return moment

    monkeypatch.setattr(hub, "today_moment", voice)
    plan = await nc.on_this_day_plan(ctx(), [HINATA], otd())
    assert plan.body == "金村 美玖のメッセージを振り返る" and plan.hero is None


# --- fix wave 1: on this day -----------------------------------------------------------


@pytest.mark.asyncio
async def test_otd_video_only_day_makes_no_photo_claim(svc):
    room(
        svc,
        KANE,
        [
            msg(
                1,
                "2024-11-10T12:00:00Z",
                "video",
                media_file=f"{KANE}/video/1.mp4".replace("/", "\\"),
            )
        ],
    )
    plan = await nc.on_this_day_plan(ctx(), [HINATA], otd())
    assert plan.body == "金村 美玖のメッセージを振り返る"
    assert plan.hero is None


@pytest.mark.asyncio
async def test_otd_words_beat_a_higher_scored_photo_in_another_service(
    out, monkeypatch
):
    set_oshi(monkeypatch, {})
    room(out / HINATA_NAME, MATSU, [msg(1, "2024-11-10T03:00:00Z", content="またね")])
    room(
        out / SAKURA_NAME,
        FUJI,
        [pic(FUJI, 1, "2024-11-10T12:00:00Z", fav=True)],
    )
    sakura = await nc.on_this_day_plan(ctx(), [SAKURA], otd())
    assert sakura.service == SAKURA  # the photo alone is a moment
    plan = await nc.on_this_day_plan(ctx(), [SAKURA, HINATA], otd())
    assert plan.service == HINATA and plan.body == "松田 好花「またね」"


def test_rank_orders_oshi_words_score_then_service():
    def m(oshi=False, words=True, score=None):
        return {"oshi": oshi, "has_words": words, "score": score}

    ranked = sorted(
        [
            (nc._rank(m(words=False, score=800), 0), "photo"),
            (nc._rank(m(score=None), 1), "words_none"),
            (nc._rank(m(score=-200), 2), "greeting"),
            (nc._rank(m(score=50), 3), "words_50"),
            (nc._rank(m(oshi=True, words=False, score=1), 4), "oshi_photo"),
            (nc._rank(m(score=50), 5), "words_50_later"),
        ]
    )
    assert [r[1] for r in ranked] == [
        "oshi_photo",
        "words_50",
        "words_50_later",
        "greeting",
        "words_none",
        "photo",
    ]


@pytest.mark.asyncio
async def test_otd_hero_is_absolute_with_a_relative_output_dir(
    svc, tmp_path, monkeypatch
):
    room(svc, KANE, [pic(KANE, 1, "2024-11-10T12:00:00Z")], avatars=AVATAR)
    photo = jpeg(svc / KANE / "picture" / "1.jpg")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(people, "output_dir", lambda: Path("out"))
    plan = await nc.on_this_day_plan(ctx(), [HINATA], otd())
    assert is_toast_copy(plan.hero, photo)
    assert plan.avatar.is_absolute()


@pytest.mark.asyncio
async def test_otd_hero_falls_back_to_the_message_picture(svc):
    room(
        svc,
        KANE,
        [
            pic(KANE, 1, "2024-11-10T03:00:00Z"),
            pic(KANE, 2, "2024-11-10T12:00:00Z", fav=True),
        ],
    )
    from PIL import Image

    folder = svc / KANE / "picture"
    sizes = {1: (40, 30), 2: (80, 60)}
    for i, size in sizes.items():
        jpeg(folder / f"{i}.jpg", size)
    first = (await nc.on_this_day_plan(ctx(), [HINATA], otd())).hero
    with Image.open(first) as img:
        source = next(i for i, size in sizes.items() if img.size == size)
    (folder / f"{source}.jpg").unlink()  # her photo of the day is gone
    second = (await nc.on_this_day_plan(ctx(), [HINATA], otd())).hero
    assert second is not None and second != first and second.is_file()
    with Image.open(second) as img:
        assert img.size == sizes[3 - source]  # the message's own picture


@pytest.mark.asyncio
async def test_otd_hero_is_downscaled_within_the_toast_limits(svc):
    from PIL import Image

    from backend.services import photo_thumb

    room(svc, KANE, [pic(KANE, 1, "2024-11-10T12:00:00Z")])
    photo = jpeg(svc / KANE / "picture" / "1.jpg", (3000, 2000))
    plan = await nc.on_this_day_plan(ctx(), [HINATA], otd())
    assert is_toast_copy(plan.hero, photo)
    with Image.open(plan.hero) as img:
        assert img.size == (photo_thumb.TOAST_WIDTH, 683)


@pytest.mark.asyncio
async def test_otd_undecodable_photo_gives_no_hero_never_the_original(svc):
    room(svc, KANE, [pic(KANE, 1, "2024-11-10T12:00:00Z")])
    photo = svc / KANE / "picture" / "1.jpg"
    photo.parent.mkdir(parents=True)
    photo.write_bytes(b"\xff\xd8\xff")  # not a decodable JPEG
    plan = await nc.on_this_day_plan(ctx(), [HINATA], otd())
    assert plan.hero is None and plan.body == "金村 美玖の写真が届いた日"


@pytest.mark.asyncio
async def test_otd_hero_failure_is_isolated(svc, monkeypatch, no_text_in_logs):
    from backend.services import photo_thumb

    room(svc, KANE, [pic(KANE, 1, "2024-11-10T12:00:00Z")])
    jpeg(svc / KANE / "picture" / "1.jpg")

    async def boom(source, *a, **kw):
        raise OSError("disk")

    monkeypatch.setattr(photo_thumb, "toast_image", boom)
    plan = await nc.on_this_day_plan(ctx(), [HINATA], otd())
    assert plan.hero is None
    (skip,) = [e for e in no_text_in_logs if e.get("reason") == "hero_unavailable"]
    assert skip["error_type"] == "OSError"


@pytest.mark.asyncio
async def test_otd_reuses_the_listing_it_is_given(svc, monkeypatch):
    room(svc, KANE, [msg(1, "2024-11-10T03:00:00Z", content=KANE_WORDS)])
    summaries = await mi.list_members(svc)

    async def no_listing(sdir):
        raise AssertionError("listed again")

    monkeypatch.setattr(mi, "list_members", no_listing)
    plan = await nc.on_this_day_plan(
        ctx(), [HINATA], otd(), listed={HINATA: (svc, summaries)}
    )
    assert plan is not None and plan.service == HINATA


def test_quote_of_only_placeholders_is_not_her_words():
    assert nc.quote(ctx(), " %%% ％％％\n", HINATA) is None
    assert nc.quote(ctx(nickname=NICKNAME), "%%%", HINATA) is None


# --- birthdays -------------------------------------------------------------------------


@pytest_asyncio.fixture
async def birthday_svc(svc):
    room(
        svc, KANE, [msg(1, "2024-11-10T03:00:00Z", content=KANE_WORDS)], avatars=AVATAR
    )
    room(svc, MATSU, [msg(1, "2024-11-10T03:00:00Z", content=MATSU_WORDS)])
    write_side_inputs(
        svc,
        birthdays={"金村美玖": "2002-09-10", "松田好花": "1999-04-27"},
        closed_groups=["40"],
    )
    return svc, await summaries_of(svc)


def birthday_occasions(member_id, raw, today):
    return nr.birthday_occasions(HINATA, member_id, raw, today, SLOT)


@pytest.mark.asyncio
async def test_birthday_day_of_and_reminders(birthday_svc):
    svc, summaries = birthday_svc
    occs = [
        *birthday_occasions("58", "2002-09-10", date(2026, 9, 10)),
        *birthday_occasions("58", "2002-09-10", date(2026, 9, 3)),
        *birthday_occasions("58", "2002-09-10", date(2026, 9, 9)),
    ]
    plans, skipped = await nc.birthday_plans(ctx("en"), HINATA, svc, summaries, occs)
    assert skipped == []
    assert [one_number(p).title for p in plans] == [
        "Today is 金村 美玖's birthday",
        "7 days until 金村 美玖's birthday",
        "1 day until 金村 美玖's birthday",
    ]
    assert [p.kind for p in plans] == ["birthday", "birthday_soon", "birthday_soon"]
    assert [p.occasion for p in plans] == [
        "2026-09-10",
        "2026-09-10:7",
        "2026-09-10:1",
    ]
    assert plans[0].body == "Look back on 金村 美玖 in Memories"
    assert plans[0].route == {
        "page": "memoir",
        "memberPath": f"{HINATA_NAME}/{KANE}",
        "tab": "binder",
    }
    assert plans[0].avatar is not None and plans[0].hero is None
    assert plans[0].member_id == "58" and plans[0].subject == "58"
    ja, _ = await nc.birthday_plans(ctx(), HINATA, svc, summaries, occs[1:2])
    assert ja[0].title == "金村 美玖の誕生日まで、あと7日"


@pytest.mark.asyncio
async def test_birthday_route_is_her_newest_room(svc):
    room(svc, KANE, [msg(1, "2023-11-10T03:00:00Z", content=KANE_WORDS)])
    newer = "messages/50 金村 美玖/90 金村 美玖"
    room(svc, newer, [msg(1, "2025-11-10T03:00:00Z", content=MATSU_WORDS)])
    summaries = await summaries_of(svc)
    kane = by_name(summaries, "金村")
    occs = birthday_occasions(kane.member_ids[0], "09-10", date(2026, 9, 10))
    (plan,), _ = await nc.birthday_plans(ctx(), HINATA, svc, summaries, occs)
    assert plan.route["memberPath"] == f"{HINATA_NAME}/{newer}"


@pytest.mark.asyncio
async def test_birthday_skips_graduated_and_unknown(birthday_svc, no_text_in_logs):
    svc, summaries = birthday_svc
    nameless = dataclasses.replace(by_name(summaries, "金村"), member_ids=())
    occs = [
        *birthday_occasions("64", "1999-04-27", date(2026, 4, 27)),
        *birthday_occasions("999", "1999-04-27", date(2026, 4, 27)),
    ]
    plans, skipped = await nc.birthday_plans(
        ctx(), HINATA, svc, [*summaries, nameless], occs
    )
    assert plans == []
    assert [(k.occasion, k.reason) for k in skipped] == [
        (occs[0], "graduated"),
        (occs[1], "unavailable"),
    ]
    skips = [e for e in no_text_in_logs if e["event"] == "memories_notify_skip"]
    assert {(e["reason"], e["member_id"]) for e in skips} == {
        ("graduated", "64"),
        ("unavailable", "999"),
    }
    assert all(e["kind"] == "birthday" and e["service"] == HINATA for e in skips)


# --- anniversaries ---------------------------------------------------------------------


@pytest_asyncio.fixture
async def anniv_svc(svc, monkeypatch):
    set_oshi(monkeypatch, {HINATA: {"松田好花"}})
    room(svc, KANE, [msg(1, "2024-11-10T03:00:00Z", content=KANE_WORDS)])
    room(svc, MATSU, [msg(1, "2024-11-10T03:00:00Z", content=MATSU_WORDS)])
    room(svc, SASAKI, [msg(1, "2024-11-10T03:00:00Z", content=KANE_WORDS)])
    write_side_inputs(
        svc, sub_starts={"34": "2025-11-10", "40": "2025-11-10", "41": "2025-11-10"}
    )
    summaries = await summaries_of(svc)
    oshi = await people.oshi_rooms(HINATA, summaries)
    return svc, people.sort_people(summaries, oshi)


def anniv_occasions(ordered, today=TODAY):
    out = []
    for s in ordered:
        out += nr.anniversary_occasions(
            HINATA, s.member_ids[0], binder.subscription_start(s), today, SLOT
        )
    return out


@pytest.mark.asyncio
async def test_anniversary_same_start_coalesces_oshi_first(anniv_svc):
    svc, ordered = anniv_svc
    occs = anniv_occasions(ordered)
    ((plan, covered),), skipped = await nc.anniversary_plans(
        ctx(), HINATA, svc, ordered, occs
    )
    assert skipped == []
    one_number(plan)
    assert plan.title == "今日はメンバーシップ1年目の記念日"
    assert plan.body.startswith("松田 好花・") and plan.body.endswith(
        "とのメンバーシップ"
    )
    assert plan.subject == "64" and plan.occasion == "y1@2026-11-10"
    assert sorted(o.subject for o in covered) == ["58", "64", "65"]
    assert covered[0].subject == "64"
    assert plan.route == {
        "page": "memoir",
        "memberPath": f"{HINATA_NAME}/{MATSU}",
        "tab": "binder",
        "cardKey": "anniv.y1",
    }
    en = (await nc.anniversary_plans(ctx("en"), HINATA, svc, ordered, occs))[0][0][0]
    assert en.title == "Today is your 1-year membership anniversary"
    assert en.body.startswith("Your membership with 松田 好花, ")


@pytest.mark.asyncio
async def test_anniversary_names_are_clipped(anniv_svc):
    svc, ordered = anniv_svc
    long = [dataclasses.replace(s, name=s.name * 6) for s in ordered]
    occs = anniv_occasions(ordered)
    ((plan, _),), _ = await nc.anniversary_plans(ctx(), HINATA, svc, long, occs)
    names = plan.body.removesuffix("とのメンバーシップ")
    assert len(names) == nc.NAMES_MAX_CHARS + 1 and names.endswith("…")


@pytest.mark.asyncio
async def test_anniversary_skips_lapsed_graduated_and_unknown(
    anniv_svc, no_text_in_logs
):
    svc, ordered = anniv_svc
    (svc / "sync_metadata.json").write_text(
        json.dumps(
            {
                "server_groups": {
                    "34": {"state": "open", "is_active": False},
                    "40": {"state": "open", "is_active": True},
                    "41": {"state": "closed"},
                }
            }
        ),
        encoding="utf-8",
    )
    mi.set_db_path(svc.parent.parent / "idx2.db")  # re-read graduation
    summaries = await summaries_of(svc)
    oshi = await people.oshi_rooms(HINATA, summaries)
    ordered = people.sort_people(summaries, oshi)
    assert by_name(ordered, "佐々木").graduated
    occs = anniv_occasions(ordered)
    unknown = dataclasses.replace(occs[0], subject="999")
    result, skipped = await nc.anniversary_plans(
        ctx(), HINATA, svc, ordered, [*occs, unknown]
    )
    ((plan, covered),) = result
    assert {(k.occasion.subject, k.reason) for k in skipped} == {
        ("58", "subscription_ended"),
        ("65", "graduated"),
        ("999", "unavailable"),
    }
    assert [o.subject for o in covered] == ["64"]
    assert plan.body == "松田 好花とのメンバーシップ"
    skips = {
        (e["reason"], e["member_id"])
        for e in no_text_in_logs
        if e["event"] == "memories_notify_skip"
    }
    assert skips == {
        ("subscription_ended", "58"),
        ("graduated", "65"),
        ("unavailable", "999"),
    }


@pytest.mark.asyncio
async def test_anniversary_day_milestone_and_separate_milestones(anniv_svc):
    svc, ordered = anniv_svc
    write_side_inputs(
        svc, sub_starts={"34": "2026-08-03", "40": "2025-11-10", "41": "2026-08-03"}
    )
    mi.set_db_path(svc.parent.parent / "idx3.db")
    summaries = await summaries_of(svc)
    ordered = people.sort_people(summaries, await people.oshi_rooms(HINATA, summaries))
    occs = anniv_occasions(ordered)
    plans, _ = await nc.anniversary_plans(ctx("en"), HINATA, svc, ordered, occs)
    titles = {one_number(p).title: (p, c) for p, c in plans}
    d100, covered = titles["Today is day 100 of your membership"]
    assert d100.route["cardKey"] == "anniv.d100"
    assert d100.occasion == "d100@2026-11-10"
    assert sorted(o.subject for o in covered) == ["58", "65"]
    y1, covered = titles["Today is your 1-year membership anniversary"]
    assert [o.subject for o in covered] == ["64"]


# --- recap -------------------------------------------------------------------------------


def stub_recap_years(monkeypatch, years):
    async def fake(sdir, *, now):
        return list(years)

    monkeypatch.setattr(recap, "recap_years", fake)


@pytest.mark.asyncio
async def test_recap_open_only_when_the_year_has_a_recap(svc, monkeypatch):
    (occ,) = nr.recap_occasions(HINATA, date(2026, 12, 1), SLOT)
    stub_recap_years(monkeypatch, [2025])
    assert await nc.recap_plan(ctx(), HINATA, svc, occ) == nc.Skipped(occ, "no_recap")
    stub_recap_years(monkeypatch, [2025, 2026])
    plan = one_number(await nc.recap_plan(ctx(), HINATA, svc, occ))
    assert plan.title == "2026年の、ここまで"
    assert plan.body == "思い出で、今年をふりかえる"
    assert plan.route == {"page": "recap", "year": 2026}
    assert plan.subject == "open" and plan.occasion == "2026"
    assert plan.avatar is None and plan.hero is None and plan.member_id is None


@pytest.mark.asyncio
async def test_recap_christmas_and_ready(svc, monkeypatch):
    stub_recap_years(monkeypatch, [2026])

    async def ready_stub(service, sdir, *, now):
        return True

    monkeypatch.setattr(nc, "christmas_ready", ready_stub)
    (xmas,) = nr.recap_occasions(HINATA, date(2026, 12, 25), SLOT)
    plan = one_number(await nc.recap_plan(ctx("en"), HINATA, svc, xmas))
    assert plan.title == "The Christmas page is open" and plan.subject == "christmas"
    (ready,) = nr.recap_occasions(HINATA, date(2027, 1, 5), SLOT)
    plan = one_number(
        await nc.recap_plan(
            ctx("en", now=datetime(2027, 1, 5, tzinfo=timezone.utc)), HINATA, svc, ready
        )
    )
    assert plan.title == "Your 2026 in Memories is complete"
    assert plan.body == "Every page is open now, to the last one"
    assert plan.occasion == "2026" and plan.route["year"] == 2026


# --- fix wave 1: recap gates on real archives -------------------------------------------


def year_of_messages(year, count=12):
    return [
        msg(
            k,
            f"{year}-{1 + k % 11:02d}-{1 + k:02d}T11:00:00Z",
            content="今日もありがとう",
        )
        for k in range(1, count + 1)
    ]


@pytest.mark.asyncio
async def test_recap_open_gate_reads_the_real_recap_years(svc):
    room(svc, KANE, year_of_messages(2026))
    (occ,) = nr.recap_occasions(HINATA, date(2026, 12, 1), SLOT)
    dec1 = datetime(2026, 12, 1, 3, 0, tzinfo=timezone.utc)
    with time_machine.travel(dec1, tick=False):
        plan = await nc.recap_plan(ctx(now=dec1), HINATA, svc, occ)
    assert plan.title == "2026年の、ここまで"


@pytest.mark.asyncio
async def test_recap_open_gate_skips_a_thin_year(svc, no_text_in_logs):
    room(svc, KANE, year_of_messages(2026, count=9))  # below the short tier
    (occ,) = nr.recap_occasions(HINATA, date(2026, 12, 1), SLOT)
    dec1 = datetime(2026, 12, 1, 3, 0, tzinfo=timezone.utc)
    with time_machine.travel(dec1, tick=False):
        result = await nc.recap_plan(ctx(now=dec1), HINATA, svc, occ)
    assert result == nc.Skipped(occ, "no_recap")
    (event,) = [e for e in no_text_in_logs if e.get("reason") == "no_recap"]
    assert event["kind"] == "recap" and event["member_id"] is None


@pytest.mark.asyncio
async def test_christmas_waits_for_her_stub_within_the_day(svc):
    # Noon: her Christmas message has not been synced yet.
    room(svc, KANE, year_of_messages(2026))
    (occ,) = nr.recap_occasions(HINATA, date(2026, 12, 25), SLOT)
    noon = datetime(2026, 12, 25, 3, 0, tzinfo=timezone.utc)
    with time_machine.travel(noon, tick=False):
        assert await nc.christmas_ready(HINATA, svc, now=noon) is False
        assert await nc.recap_plan(ctx(now=noon), HINATA, svc, occ) is None
    # Evening: the sync brings her messages of the afternoon and night.
    room(
        svc,
        KANE,
        [
            *year_of_messages(2026),
            # two Christmas messages: the recap's one sentence (s12) may take one
            msg(50, "2026-12-25T05:00:00Z", content="メリークリスマス！"),
            msg(52, "2026-12-25T06:00:00Z", content="クリスマスケーキ食べたよ"),
            msg(51, "2026-12-25T11:00:00Z", content="おやすみなさい"),
        ],
    )
    night = datetime(2026, 12, 25, 12, 0, tzinfo=timezone.utc)  # 21:00 JST
    with time_machine.travel(night, tick=False):
        assert await nc.christmas_ready(HINATA, svc, now=night) is True
        plan = one_number(await nc.recap_plan(ctx(now=night), HINATA, svc, occ))
    assert plan.title == "クリスマスのページが開きました"


@pytest.mark.asyncio
async def test_christmas_ready_is_false_before_christmas(svc):
    room(
        svc,
        KANE,
        [*year_of_messages(2026), msg(50, "2026-12-24T10:00:00Z", content="メリクリ")],
    )
    eve = datetime(2026, 12, 24, 14, 0, tzinfo=timezone.utc)  # 23:00 JST, sealed
    with time_machine.travel(eve, tick=False):
        assert await nc.christmas_ready(HINATA, svc, now=eve) is False


# --- cards -------------------------------------------------------------------------------


async def check_cards(svc, now=NOW, summaries=None):
    """``card_plans`` plus applying every advance (as a claimed delivery would)."""
    summaries = summaries if summaries is not None else await summaries_of(svc)
    oshi = await people.oshi_rooms(HINATA, summaries)
    with time_machine.travel(now, tick=False):
        check = await nc.card_plans(ctx(now=now), HINATA, svc, summaries, oshi)
    for advance in check.advances():
        await advance.apply()
    return [(t.plan, t.keys) for t in check.toasts], check.counts


@pytest.mark.asyncio
async def test_card_plans_never_write_a_baseline(svc):
    room(svc, KANE, KANE_DAYS)
    summaries = await summaries_of(svc)
    check = await nc.card_plans(ctx(), HINATA, svc, summaries, set())
    assert app_state.get_card_baseline(HINATA, "58") is None
    (seed,) = check.silent
    assert check.toasts == [] and seed.member_id == "58"
    room(svc, KANE, [*KANE_DAYS, msg(3, "2026-11-09T15:03:00Z", content=KANE_WORDS)])
    await seed.apply()
    check = await nc.card_plans(ctx(), HINATA, svc, summaries, set())
    (toast,) = check.toasts
    assert app_state.get_card_baseline(HINATA, "58")[0] == seed.keys
    assert "moment.midnight" in toast.advance.keys and seed.keys <= toast.advance.keys


KANE_DAYS = [
    msg(1, "2024-11-10T03:00:00Z", content=KANE_WORDS),
    msg(2, "2025-06-01T03:00:00Z", content=MATSU_WORDS),
]


@pytest.mark.asyncio
async def test_cards_seed_then_notify_a_new_midnight_card(svc, no_text_in_logs):
    room(svc, KANE, KANE_DAYS, avatars=AVATAR)
    plans, counts = await check_cards(svc)
    assert plans == []
    assert counts == {"persons": 1, "evaluated": 1, "seeded": 1, "new_foil": 0}
    assert ("seeded", "58") in {
        (e.get("reason"), e.get("member_id")) for e in no_text_in_logs
    }
    # 00:03 JST on 2026-11-10 (15:03 UTC the day before)
    room(
        svc,
        KANE,
        [*KANE_DAYS, msg(3, "2026-11-09T15:03:00Z", content=KANE_WORDS)],
        avatars=AVATAR,
    )
    plans, counts = await check_cards(svc)
    ((plan, keys),) = plans
    assert counts == {"persons": 1, "evaluated": 1, "seeded": 0, "new_foil": 1}
    assert keys == ["moment.midnight"] and plan.occasion == "moment.midnight"
    assert plan.route == {
        "page": "memoir",
        "memberPath": f"{HINATA_NAME}/{KANE}",
        "tab": "binder",
        "cardKey": "moment.midnight",
    }
    assert one_number(plan).title == "生写真帳に、きらめくカード"
    assert plan.body == "金村 美玖の生写真帳" and plan.subject == "58"
    assert plan.kind == "card" and plan.avatar is not None
    # unchanged data: not evaluated again
    plans, counts = await check_cards(svc)
    assert plans == [] and counts["evaluated"] == 0 and counts["persons"] == 1


@pytest.mark.asyncio
async def test_cards_no_facts_leaves_the_baseline(svc, monkeypatch, no_text_in_logs):
    room(svc, KANE, KANE_DAYS)
    await check_cards(svc)
    before = app_state.get_card_baseline(HINATA, "58")

    async def empty(*args, **kwargs):
        return []

    monkeypatch.setattr(binder, "evaluate_person", empty)
    room(svc, KANE, [*KANE_DAYS, msg(3, "2026-11-09T15:03:00Z", content=KANE_WORDS)])
    plans, counts = await check_cards(svc)
    assert plans == [] and counts["evaluated"] == 1 and counts["seeded"] == 0
    assert app_state.get_card_baseline(HINATA, "58") == before
    assert any(e.get("reason") == "no_facts" for e in no_text_in_logs)


@pytest.mark.asyncio
async def test_cards_new_birthday_year_and_union_baseline(svc):
    write_side_inputs(svc, birthdays={"金村美玖": "2002-11-10"})
    room(svc, KANE, KANE_DAYS)
    _, counts = await check_cards(svc)
    assert counts["seeded"] == 1
    later = datetime(2027, 11, 10, 6, 0, tzinfo=timezone.utc)
    room(svc, KANE, [*KANE_DAYS, msg(3, "2027-11-10T03:00:00Z", content=KANE_WORDS)])
    plans, counts = await check_cards(svc, later)
    ((plan, keys),) = plans
    assert keys == ["special.birthday@2027"]
    assert plan.occasion == "special.birthday@2027"
    assert plan.route["cardKey"] == "special.birthday"
    keys_now, _ = app_state.get_card_baseline(HINATA, "58")
    assert {"special.birthday@2024", "special.birthday@2027"} <= keys_now


@pytest.mark.asyncio
async def test_cards_new_data_without_new_foil_sends_nothing(svc):
    room(svc, KANE, KANE_DAYS)
    await check_cards(svc)
    room(svc, KANE, [*KANE_DAYS, msg(3, "2026-11-01T03:00:00Z", content=KANE_WORDS)])
    plans, counts = await check_cards(svc)
    assert plans == [] and counts["evaluated"] == 1 and counts["new_foil"] == 0
    keys, _ = app_state.get_card_baseline(HINATA, "58")
    assert "first.message" in keys


@pytest.mark.asyncio
async def test_cards_skip_a_person_without_member_id(svc):
    room(svc, KANE, KANE_DAYS)
    nameless = dataclasses.replace((await summaries_of(svc))[0], member_ids=())
    plans, counts = await check_cards(svc, summaries=[nameless])
    assert plans == [] and counts["persons"] == 0


@pytest.mark.asyncio
async def test_cards_several_new_foil_cards_share_one_toast(svc):
    write_side_inputs(svc, birthdays={"金村美玖": "2002-11-10"})
    room(svc, KANE, KANE_DAYS)
    await check_cards(svc)
    # 00:03 JST on her birthday: the midnight card and this year's birthday
    room(svc, KANE, [*KANE_DAYS, msg(3, "2026-11-09T15:03:00Z", content=KANE_WORDS)])
    ((plan, keys),), counts = await check_cards(svc)
    assert keys == ["special.birthday@2026", "moment.midnight"]
    assert counts["new_foil"] == 2
    assert plan.route["cardKey"] == "special.birthday"
    assert plan.occasion == "special.birthday@2026"


@pytest.mark.asyncio
async def test_cards_of_a_graduated_member_update_the_baseline_silently(
    svc, no_text_in_logs
):
    write_side_inputs(svc, closed_groups=["34"])
    room(svc, KANE, KANE_DAYS)
    await check_cards(svc)
    room(svc, KANE, [*KANE_DAYS, msg(3, "2026-11-09T15:03:00Z", content=KANE_WORDS)])
    plans, counts = await check_cards(svc)
    assert plans == [] and counts["new_foil"] == 0
    keys, _ = app_state.get_card_baseline(HINATA, "58")
    assert "moment.midnight" in keys
    assert ("graduated", "58") in {
        (e.get("reason"), e.get("member_id")) for e in no_text_in_logs
    }


# --- strings ---------------------------------------------------------------------------


def _catalog(lang):
    path = I18N_DIR / lang / "memories_notify.json"
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("lang", SUPPORTED)
def test_every_locale_has_the_en_keys_and_placeholders(lang):
    en, cat = _catalog("en"), _catalog(lang)
    assert set(cat) == set(en)
    for key, value in cat.items():
        assert isinstance(value, str) and value, key
        assert set(PLACEHOLDER_RE.findall(value)) == set(
            PLACEHOLDER_RE.findall(en[key])
        ), key
        assert set(PLACEHOLDER_RE.findall(value)) <= {
            "name",
            "names",
            "quote",
            "n",
            "year",
        }
    assert get_strings("memories_notify", lang) == cat


@pytest.mark.parametrize("lang", SUPPORTED)
def test_every_string_holds_at_most_one_number_placeholder(lang):
    for key, value in _catalog(lang).items():
        assert len(re.findall(r"\{(?:n|year)\}|\d", value)) <= 1, key


def test_japanese_reference_wording():
    ja = _catalog("ja")
    assert ja["anniv_years_title_one"] == "今日はメンバーシップ{n}年目の記念日"
    assert ja["nickname_masked"] == "『＊＊＊』"
    assert ja["name_join"] == "・"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("lang", "title"),
    [
        ("ja", "生写真帳に、きらめくカードが2枚"),
        ("en", "2 foil cards joined your binder"),
        ("zh-TW", "相冊裡多了2張閃亮的卡"),
        ("zh-CN", "相册里多了2张闪亮的卡"),
        ("yue", "相冊入面多咗2張閃卡"),
    ],
)
async def test_card_toast_covering_two_cards_has_a_plural_title(svc, lang, title):
    write_side_inputs(svc, birthdays={"金村美玖": "2002-11-10"})
    room(svc, KANE, KANE_DAYS)
    await check_cards(svc)
    later = datetime(2027, 11, 10, 6, 0, tzinfo=timezone.utc)
    # 00:03 JST on her birthday: the birthday card and the midnight card at once
    room(svc, KANE, [*KANE_DAYS, msg(3, "2027-11-09T15:03:00Z", content=KANE_WORDS)])
    summaries = await summaries_of(svc)
    with time_machine.travel(later, tick=False):
        check = await nc.card_plans(ctx(lang, now=later), HINATA, svc, summaries, set())
    (toast,) = check.toasts
    assert len(toast.keys) == 2, toast.keys
    assert one_number(toast.plan).title == title
