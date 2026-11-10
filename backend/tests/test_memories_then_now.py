"""あの日と今日 (``backend/services/memories/then_now.py``)."""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
import time_machine
from structlog.testing import capture_logs

from backend.services.memories import index as mi
from backend.services.memories import oshi as oshi_mod
from backend.services.memories import then_now
from backend.services.memories.lexicon import ECHO_KEYWORDS
from backend.services.memories.selection import JST
from backend.tests.memories_archive import msg, write_room, write_side_inputs


# --- shared helpers (also used by the recap's S08) ---------------------------------


def test_keywords_in_finds_cjk_keywords_in_list_order():
    assert then_now.keywords_in("🎂誕生日🎉 と 桜🌸") == ["桜", "誕生日"]
    assert then_now.keywords_in("なにもない🙂") == []


def test_keywords_in_reads_nfkc_text():
    # Half-width katakana normalises to the lexicon's full-width form.
    assert then_now.keywords_in("ﾗｲﾌﾞ最高") == ["ライブ"]


def test_keywords_come_from_the_lexicon():
    assert all(then_now.keywords_in(k) for k in ECHO_KEYWORDS)


def test_first_week_window_is_seven_days_inclusive():
    assert then_now.first_week_window(date(2025, 2, 25)) == (
        date(2025, 2, 25),
        date(2025, 3, 3),
    )


def test_latest_week_window_ends_today():
    assert then_now.latest_week_window(date(2026, 3, 2)) == (
        date(2026, 2, 24),
        date(2026, 3, 2),
    )


# --- fixtures ------------------------------------------------------------------------------

SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
KANE = "messages/34 金村 美玖/58 金村 美玖"
MATSU = "messages/40 松田 好花/64 松田 好花"
NOW = datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc)  # 12:00 JST
PROMO = "%%%へお知らせ！写真集の予約が始まったよ https://example.jp " + "あ" * 80
LONG = "今日は本当に楽しかった、みんなに会えて嬉しい、ずっと応援してくれてありがとう！"
KANE_AVATARS = [
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


def at(y: int, mo: int, d: int, h: int = 12, mi_: int = 0) -> str:
    """The archive UTC timestamp of a JST wall-clock time."""
    local = datetime(y, mo, d, h, mi_, tzinfo=JST)
    return local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def media(room: str, kind: str, i: int, ts: str, **extra) -> dict:
    ext = {"picture": "jpg", "voice": "m4a", "video": "mp4"}[kind]
    return msg(
        i, ts, kind, media_file=f"{room}/{kind}/{i}.{ext}".replace("/", "\\"), **extra
    )


def set_oshi(monkeypatch, names):
    async def fake(service):
        return set(names)

    monkeypatch.setattr(oshi_mod, "oshi_names", fake)


@pytest.fixture
def svc(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    set_oshi(monkeypatch, set())
    return tmp_path / "out" / SVC_NAME


def kane(sdir, msgs, avatars=None):
    write_room(sdir, "34 金村 美玖", "58 金村 美玖", msgs, avatars=avatars)


def matsu(sdir, msgs):
    write_room(sdir, "40 松田 好花", "64 松田 好花", msgs)


async def person_of(sdir, room):
    return next(s for s in await mi.list_members(sdir) if room in s.member_dirs)


async def day_pair(sdir, day, member=None, now=NOW):
    with time_machine.travel(now, tick=False):
        return await then_now.then_now_day(
            SERVICE, sdir, day, member=member, now=datetime.now(timezone.utc)
        )


async def first_week(sdir, room=KANE, now=NOW):
    summary = await person_of(sdir, room)
    with time_machine.travel(now, tick=False):
        return await then_now.then_now_first_week(
            SERVICE, sdir, summary, now=datetime.now(timezone.utc)
        )


def ids(side) -> list[int]:
    return [m["id"] for m in side["items"]]


def event(logs):
    (ev,) = [e for e in logs if e["event"] == "memories_then_now"]
    return ev


# --- then_now_day ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_day_uses_this_year_when_available(svc):
    kane(
        svc,
        [
            msg(1, at(2023, 11, 10), content="三年前"),
            msg(2, at(2025, 11, 10), content="去年"),
            msg(3, at(2026, 11, 10, 9), content="今朝"),
        ],
    )
    with capture_logs() as logs:
        got = await day_pair(svc, date(2023, 11, 10))
    assert got["mode"] == "day"
    assert got["then"]["year"] == 2023 and got["then"]["date"] == "2023-11-10"
    assert got["now"]["year"] == 2026 and got["now"]["date"] == "2026-11-10"
    assert ids(got["then"]) == [1] and ids(got["now"]) == [3]
    assert got["then"]["items"][0]["text"] == "三年前"
    assert got["then"]["name"] == got["now"]["name"] == "金村 美玖"
    assert got["then"]["member_path"] == f"{SVC_NAME}/{KANE}"
    assert got["shared_keyword"] is None
    ev = event(logs)
    assert ev["mode"] == "day" and ev["now_rule"] == "this_year"
    assert ev["person"] == "same"


@pytest.mark.asyncio
async def test_day_falls_back_to_the_latest_year_when_this_year_is_ahead(svc):
    kane(
        svc,
        [
            msg(1, at(2023, 12, 24), content="2023"),
            msg(2, at(2024, 12, 24), content="2024"),
            msg(3, at(2025, 12, 24), content="2025"),
        ],
    )
    with capture_logs() as logs:
        got = await day_pair(svc, date(2024, 12, 24))
    assert got["now"]["date"] == "2025-12-24" and ids(got["now"]) == [3]
    assert event(logs)["now_rule"] == "latest_year"


@pytest.mark.asyncio
async def test_day_falls_back_when_this_year_has_no_messages(svc):
    kane(
        svc,
        [
            msg(1, at(2023, 3, 1), content="2023"),
            msg(2, at(2024, 3, 1), content="2024"),
            msg(3, at(2026, 3, 2), content="翌日"),
        ],
    )
    got = await day_pair(svc, date(2023, 3, 1))
    assert got["now"]["date"] == "2024-03-01"


@pytest.mark.asyncio
async def test_day_feb_29_pairs_with_the_latest_leap_year(svc):
    kane(
        svc,
        [
            msg(1, at(2024, 2, 29), content="閏日"),
            msg(2, at(2028, 2, 29), content="次"),
        ],
    )
    with capture_logs() as logs:
        got = await day_pair(
            svc, date(2024, 2, 29), now=datetime(2029, 3, 1, 3, tzinfo=timezone.utc)
        )
    assert got["now"]["date"] == "2028-02-29"
    assert event(logs)["now_rule"] == "latest_year"


@pytest.mark.asyncio
async def test_day_is_none_without_a_later_year(svc):
    kane(
        svc,
        [msg(1, at(2025, 12, 24), content="x"), msg(2, at(2024, 12, 23), content="y")],
    )
    with capture_logs() as logs:
        assert await day_pair(svc, date(2025, 12, 24)) is None
    ev = event(logs)
    assert ev["now_rule"] == "none" and ev["person"] is None


@pytest.mark.asyncio
async def test_day_is_none_when_that_day_is_empty_or_promo(svc):
    kane(
        svc,
        [msg(1, at(2023, 5, 5), content=PROMO), msg(2, at(2025, 5, 5), content="今")],
    )
    with capture_logs() as logs:
        assert await day_pair(svc, date(2023, 5, 5)) is None
        assert await day_pair(svc, date(2022, 5, 5)) is None
    assert {e["reason"] for e in logs if e["event"] == "memories_then_now"} == {
        "no_then"
    }


@pytest.mark.asyncio
async def test_day_prefers_the_person_on_both_dates(svc):
    kane(svc, [msg(1, at(2024, 6, 1), content=LONG)])  # then only, higher importance
    matsu(
        svc,
        [
            msg(2, at(2024, 6, 1), content="短い"),
            msg(3, at(2025, 6, 1), content="今年"),
        ],
    )
    got = await day_pair(svc, date(2024, 6, 1))
    assert got["then"]["name"] == got["now"]["name"] == "松田 好花"
    assert ids(got["then"]) == [2] and ids(got["now"]) == [3]


@pytest.mark.asyncio
async def test_day_common_person_oshi_first_then_importance(svc, monkeypatch):
    kane(
        svc,
        [msg(1, at(2024, 6, 1), content="短い"), msg(2, at(2025, 6, 1), content="今")],
    )
    matsu(
        svc,
        [msg(3, at(2024, 6, 1), content=LONG), msg(4, at(2025, 6, 1), content=LONG)],
    )
    got = await day_pair(svc, date(2024, 6, 1))
    assert got["then"]["name"] == "松田 好花"  # higher importance sum
    set_oshi(monkeypatch, {"金村美玖"})
    got = await day_pair(svc, date(2024, 6, 1))
    assert got["then"]["name"] == got["now"]["name"] == "金村 美玖"


@pytest.mark.asyncio
async def test_day_split_people_each_carry_their_own_name(svc):
    kane(svc, [msg(1, at(2024, 6, 1), content="あの日")])
    matsu(svc, [msg(2, at(2025, 6, 1), content="今日")])
    with capture_logs() as logs:
        got = await day_pair(svc, date(2024, 6, 1))
    assert got["then"]["name"] == "金村 美玖"
    assert got["then"]["member_path"] == f"{SVC_NAME}/{KANE}"
    assert got["now"]["name"] == "松田 好花"
    assert got["now"]["member_path"] == f"{SVC_NAME}/{MATSU}"
    assert event(logs)["person"] == "split"


@pytest.mark.asyncio
async def test_day_member_limits_to_one_person(svc):
    kane(svc, [msg(1, at(2024, 6, 1), content="あの日")])
    matsu(
        svc,
        [msg(2, at(2024, 6, 1), content=LONG), msg(3, at(2025, 6, 1), content="今")],
    )
    summary = await person_of(svc, KANE)
    assert await day_pair(svc, date(2024, 6, 1), member=summary) is None
    summary = await person_of(svc, MATSU)
    got = await day_pair(svc, date(2024, 6, 1), member=summary)
    assert ids(got["then"]) == [2]


@pytest.mark.asyncio
async def test_day_items_photo_words_voice_without_repeats(svc):
    kane(
        svc,
        [
            media(KANE, "picture", 1, at(2024, 6, 1, 10, 0)),  # captioned by 2
            msg(2, at(2024, 6, 1, 10, 1), content=LONG),  # best words, but a caption
            msg(3, at(2024, 6, 1, 20), content="今日もありがとう"),
            media(KANE, "picture", 4, at(2024, 6, 1, 21)),
            media(KANE, "voice", 5, at(2024, 6, 1, 22)),
            media(KANE, "voice", 6, at(2024, 6, 1, 23)),
            msg(7, at(2025, 6, 1), content="今"),
        ],
    )
    got = await day_pair(svc, date(2024, 6, 1))
    then = got["then"]["items"]
    assert len(then) == 3
    assert [m["type"] for m in then] == ["picture", "text", "voice"]
    assert then[0]["id"] == 1 and then[0]["caption"] == LONG  # the best photo
    assert then[1]["id"] == 3  # 2 is already shown as the photo's caption
    assert then[2]["id"] == 5
    assert ids(got["now"]) == [7]


@pytest.mark.asyncio
async def test_day_shared_keyword_after_texts(svc):
    kane(
        svc,
        [
            msg(1, at(2024, 3, 20), content="🎂誕生日🎉 に 桜🌸"),
            msg(2, at(2025, 3, 20), content="今年も誕生日！🎂と桜"),
            msg(3, at(2023, 7, 7), content="七夕🎋誕生日"),
            msg(4, at(2025, 7, 7), content="ふつうの日"),
        ],
    )
    got = await day_pair(svc, date(2024, 3, 20))
    assert got["shared_keyword"] == "桜"  # the first lexicon entry in both
    got = await day_pair(svc, date(2023, 7, 7))
    assert got["shared_keyword"] is None


@pytest.mark.asyncio
async def test_day_avatar_at_each_date(svc):
    kane(
        svc,
        [
            msg(1, at(2024, 6, 1), content="あの日"),
            msg(2, at(2026, 6, 1), content="今"),
        ],
        avatars=KANE_AVATARS,
    )
    got = await day_pair(svc, date(2024, 6, 1))
    assert got["then"]["avatar_url"].endswith("a.jpg")
    assert got["now"]["avatar_url"].endswith("b.jpg")
    assert got["then"]["items"][0]["avatar_url"].endswith("a.jpg")


# --- then_now_first_week ------------------------------------------------------------------


def week_msgs(room, start_id, days, voice=True):
    """A picture, two おはよう and (optionally) a voice on ``days`` (y, m, d)."""
    (y, m, d1), (_, _, d2) = days
    out = [
        media(room, "picture", start_id, at(y, m, d1, 20), content="写真だよ"),
        msg(start_id + 1, at(y, m, d1, 7), content="おはよう☀️"),
        msg(start_id + 2, at(y, m, d2, 7), content="おはようございます"),
    ]
    if voice:
        out += [
            media(room, "voice", start_id + 3, at(y, m, d1, 22)),
            media(room, "voice", start_id + 4, at(y, m, d2, 22)),
        ]
    return out


@pytest.mark.asyncio
async def test_first_week_from_the_subscription_start(svc):
    write_side_inputs(svc, sub_starts={"34": "2025-03-01"})
    kane(
        svc,
        [msg(1, at(2025, 2, 20), content="購読前")]
        + week_msgs(KANE, 10, ((2025, 3, 2), (2025, 3, 6)))
        + week_msgs(KANE, 20, ((2026, 11, 5), (2026, 11, 9))),
        avatars=KANE_AVATARS,
    )
    with capture_logs() as logs:
        got = await first_week(svc)
    assert got["mode"] == "first_week"
    assert got["then_range"] == ["2025-03-01", "2025-03-07"]
    assert got["now_range"] == ["2026-11-04", "2026-11-10"]
    rows = {r["kind"]: (r["then"]["id"], r["now"]["id"]) for r in got["rows"]}
    assert [r["kind"] for r in got["rows"]] == ["photo", "ohayo", "voice"]
    assert rows == {"photo": (10, 20), "ohayo": (11, 22), "voice": (13, 24)}
    assert got["rows"][1]["then"]["text"] == "おはよう☀️"
    assert got["avatar_then"].endswith("a.jpg") and got["avatar_now"].endswith("b.jpg")
    ev = event(logs)
    assert ev["mode"] == "first_week" and ev["rows"] == 3


@pytest.mark.asyncio
async def test_first_week_falls_back_to_her_first_message(svc):
    kane(
        svc,
        week_msgs(KANE, 10, ((2025, 3, 2), (2025, 3, 6)))
        + week_msgs(KANE, 20, ((2026, 11, 5), (2026, 11, 9))),
    )
    got = await first_week(svc)
    # Her first message is the 2025-03-02 07:00 おはよう.
    assert got["then_range"] == ["2025-03-02", "2025-03-08"]


@pytest.mark.asyncio
async def test_first_week_overlapping_the_latest_week_is_none(svc):
    kane(svc, week_msgs(KANE, 10, ((2026, 11, 1), (2026, 11, 9))))
    with capture_logs() as logs:
        assert await first_week(svc) is None
    assert event(logs)["reason"] == "overlap"


@pytest.mark.asyncio
async def test_first_week_drops_a_row_with_a_missing_side(svc):
    kane(
        svc,
        week_msgs(KANE, 10, ((2025, 3, 2), (2025, 3, 6)))
        + week_msgs(KANE, 20, ((2026, 11, 5), (2026, 11, 9)), voice=False)
        + [msg(30, at(2026, 11, 8), content=PROMO)],
    )
    got = await first_week(svc)
    assert [r["kind"] for r in got["rows"]] == ["photo", "ohayo"]


@pytest.mark.asyncio
async def test_first_week_without_rows_is_none(svc):
    kane(
        svc,
        [
            msg(1, at(2025, 3, 2), content="はじめまして"),
            msg(2, at(2026, 11, 9), content="今"),
        ],
    )
    with capture_logs() as logs:
        assert await first_week(svc) is None
    ev = event(logs)
    assert ev["rows"] == 0 and ev["reason"] == "no_rows"


@pytest.mark.asyncio
async def test_first_week_without_messages_is_none(svc):
    kane(svc, [])
    with capture_logs() as logs:
        assert await first_week(svc) is None
    assert event(logs)["reason"] == "no_start"
