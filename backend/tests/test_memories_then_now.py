"""初見と今 and the helpers it shares with the recap (``memories/then_now.py``)."""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
from structlog.testing import capture_logs

from backend.services.memories import index as mi
from backend.services.memories import oshi as oshi_mod
from backend.services.memories import then_now
from backend.services.memories.lexicon import ECHO_KEYWORDS
from backend.services.memories.selection import JST
from backend.tests.memories_archive import msg, write_room


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
PROMO = "%%%へお知らせ！写真集の予約が始まったよ https://example.jp " + "あ" * 80
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


async def person_of(sdir, room):
    return next(s for s in await mi.list_members(sdir) if room in s.member_dirs)


def event(logs):
    (ev,) = [e for e in logs if e["event"] == "memories_then_now"]
    return ev


# --- then_now_first_meet (初見と今, same-kind rows) ---------------------------------------


async def first_meet(sdir, room=KANE):
    summary = await person_of(sdir, room)
    return await then_now.then_now_first_meet(SERVICE, sdir, summary)


WELCOME = "%%%さん、ご登録ありがとうございます！これからよろしくね"
QA = "Q.好きな食べ物は？\nA.いちご\nQ.趣味は？\nA.散歩\nQ.朝は何時に起きる？おはようの時間\nA.7時"


@pytest.mark.asyncio
async def test_first_meet_pairs_her_first_with_a_recent_one_per_kind(svc):
    kane(
        svc,
        [
            msg(
                1, at(2025, 11, 1, 0, 4), content=WELCOME
            ),  # the welcome opens the room
            msg(2, at(2025, 11, 2, 7, 40), content="はじめてのおはよう、緊張する…！"),
            media(KANE, "picture", 3, at(2025, 11, 3, 18, 22)),
            media(KANE, "voice", 4, at(2025, 11, 5, 22, 1)),
            msg(5, at(2025, 11, 2, 23, 55), content="おやすみなさい。また明日"),
            # recent: within the 30 days ending on the newest of each kind
            msg(10, at(2026, 10, 1, 7, 0), content="おはよう" + "あ" * 200),  # too old
            msg(11, at(2026, 11, 8, 7, 5), content="おはよ〜 今日も一日がんばろうね☀️"),
            msg(12, at(2026, 11, 10, 7, 5), content="おはよう"),
            media(KANE, "picture", 13, at(2026, 11, 8, 15, 10)),
            media(KANE, "voice", 14, at(2026, 11, 7, 21, 0)),
            media(KANE, "voice", 15, at(2026, 11, 9, 21, 40)),
            msg(16, at(2026, 11, 10, 23, 30), content="今日もありがとう、おやすみ〜🌙"),
        ],
        avatars=KANE_AVATARS,
    )
    with capture_logs() as logs:
        got = await first_meet(svc)
    assert got["mode"] == "first_meet"
    assert [r["kind"] for r in got["rows"]] == ["ohayo", "photo", "voice", "oyasumi"]
    pairs = {r["kind"]: (r["then"]["id"], r["now"]["id"]) for r in got["rows"]}
    # the welcome never stands as her first; the newest voice wins; words by importance
    assert pairs["ohayo"] == (2, 11)  # 10 is outside the window, 12 a bare greeting
    assert pairs["photo"] == (3, 13)
    assert pairs["voice"] == (4, 15)
    assert pairs["oyasumi"] == (5, 16)
    ohayo = got["rows"][0]
    assert ohayo["then"]["text"] == "はじめてのおはよう、緊張する…！"
    assert got["rows"][1]["elapsed"] == {"years": 1, "days": 5}
    assert got["rows"][3]["elapsed"] == {"years": 1, "days": 8}
    assert got["avatar_then"].endswith("b.jpg")
    ev = event(logs)
    assert ev["mode"] == "first_meet" and ev["rows"] == 4 and ev["skipped"] == []


@pytest.mark.asyncio
async def test_first_meet_skips_promo_qa_and_one_sided_kinds(svc):
    kane(
        svc,
        [
            msg(1, at(2025, 3, 1, 8), content=PROMO + "おはよう"),
            msg(2, at(2025, 3, 2, 8), content=QA),
            msg(3, at(2025, 3, 3, 8), content="おはよう🌸"),
            msg(4, at(2026, 3, 3, 8), content="おはようございます"),
            media(KANE, "voice", 5, at(2025, 3, 3, 22)),  # one voice only
            msg(6, at(2025, 3, 3, 23), content="おやすみ"),  # same day only: no row
        ],
    )
    with capture_logs() as logs:
        got = await first_meet(svc)
    assert [(r["kind"], r["then"]["id"], r["now"]["id"]) for r in got["rows"]] == [
        ("ohayo", 3, 4)
    ]
    assert got["rows"][0]["elapsed"] == {"years": 1, "days": 0}
    assert event(logs)["skipped"] == ["photo", "voice", "oyasumi"]


@pytest.mark.asyncio
async def test_first_meet_without_rows_is_none(svc):
    kane(svc, [msg(1, at(2025, 3, 2), content="はじめまして")])
    with capture_logs() as logs:
        assert await first_meet(svc) is None
    assert event(logs)["reason"] == "no_rows"


def test_elapsed_counts_whole_years_then_days():
    assert then_now.elapsed(date(2025, 11, 2), date(2026, 11, 10)) == {
        "years": 1,
        "days": 8,
    }
    assert then_now.elapsed(date(2025, 11, 2), date(2026, 11, 1)) == {
        "years": 0,
        "days": 364,
    }
    assert then_now.elapsed(date(2024, 2, 29), date(2025, 2, 28)) == {
        "years": 1,
        "days": 0,
    }
    assert then_now.elapsed(date(2025, 3, 1), date(2025, 3, 4)) == {
        "years": 0,
        "days": 3,
    }
