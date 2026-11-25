"""同じ時刻, the same-time line (``backend/services/memories/same_time.py``)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
import time_machine
from structlog.testing import capture_logs

from backend.services.memories import index as mi
from backend.services.memories import oshi as oshi_mod
from backend.services.memories import same_time
from backend.tests.memories_archive import msg, write_room

SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
KANE = "messages/34 金村 美玖/58 金村 美玖"
MATSU = "messages/40 松田 好花/64 松田 好花"
# 2026-11-10 21:03 JST
NOW = datetime(2026, 11, 10, 12, 3, tzinfo=timezone.utc)
PROMO = "%%%へお知らせ！写真集の予約が始まったよ https://example.jp " + "あ" * 80
LONG = "今日は本当に楽しかった、みんなに会えて嬉しい、ずっと応援してくれてありがとう！"


def set_oshi(monkeypatch, names):
    async def fake(service):
        return set(names)

    monkeypatch.setattr(oshi_mod, "oshi_names", fake)


@pytest.fixture
def svc(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    set_oshi(monkeypatch, set())
    return tmp_path / "out" / SVC_NAME


def kane(sdir, msgs):
    write_room(sdir, "34 金村 美玖", "58 金村 美玖", msgs)


def matsu(sdir, msgs):
    write_room(sdir, "40 松田 好花", "64 松田 好花", msgs)


async def line(sdir, now=NOW):
    with time_machine.travel(now, tick=False):
        return await same_time.same_time(SERVICE, sdir, now=datetime.now(timezone.utc))


@pytest.mark.asyncio
async def test_window_match_within_two_minutes(svc):
    kane(
        svc,
        [
            msg(1, "2024-06-02T12:05:00Z", content="21:05の言葉"),  # +2 min: in
            msg(2, "2024-06-02T12:06:00Z", content="21:06の言葉"),  # +3 min: out
            msg(3, "2024-06-02T11:59:00Z", content="20:59の言葉"),  # -4 min: out
        ],
    )
    got = await line(svc)
    assert got is not None
    assert got["clock"] == "21:03"
    assert got["year"] == 2024 and got["date"] == "2024-06-02"
    assert got["member_path"] == f"{SVC_NAME}/{KANE}" and got["name"] == "金村 美玖"
    assert got["message"]["id"] == 1 and got["message"]["text"] == "21:05の言葉"
    assert got["message"]["ts"] == "2024-06-02T12:05:00Z"


@pytest.mark.asyncio
async def test_earlier_years_beat_this_year(svc):
    kane(
        svc,
        [
            msg(1, "2026-03-01T12:03:00Z", content=LONG),  # this year, high score
            msg(2, "2023-01-05T12:02:00Z", content="短い"),  # past year
        ],
    )
    with capture_logs() as logs:
        got = await line(svc)
    assert got["message"]["id"] == 2 and got["year"] == 2023
    (ev,) = [e for e in logs if e["event"] == "memories_same_time"]
    assert ev["band"] == "past_years" and ev["count"] == 1 and ev["message_id"] == 2


@pytest.mark.asyncio
async def test_this_year_only_when_no_earlier_year(svc):
    kane(
        svc,
        [
            msg(1, "2026-03-01T12:03:00Z", content="今年の言葉"),
            msg(2, "2026-11-10T12:02:00Z", content="今日の言葉"),  # today: never
        ],
    )
    with capture_logs() as logs:
        got = await line(svc)
    assert got["message"]["id"] == 1 and got["year"] == 2026
    (ev,) = [e for e in logs if e["event"] == "memories_same_time"]
    assert ev["band"] == "this_year"


@pytest.mark.asyncio
async def test_oshi_first(svc, monkeypatch):
    kane(svc, [msg(1, "2024-06-02T12:03:00Z", content="短い")])
    matsu(svc, [msg(1, "2024-06-03T12:03:00Z", content=LONG)])
    set_oshi(monkeypatch, {"金村美玖"})
    got = await line(svc)
    assert got["member_path"] == f"{SVC_NAME}/{KANE}"
    set_oshi(monkeypatch, {"松田好花"})
    got = await line(svc)
    assert got["member_path"] == f"{SVC_NAME}/{MATSU}"


@pytest.mark.asyncio
async def test_stable_within_a_minute_and_seeded_by_the_minute(svc):
    rows = []
    for i in range(1, 6):
        # five past-year words at every minute of 20:58..21:08 JST
        for minute in range(58, 69):
            hh, mm = (11, minute) if minute < 60 else (12, minute - 60)
            rows.append(
                msg(
                    i * 100 + minute,
                    f"20{19 + i}-06-02T{hh:02d}:{mm:02d}:00Z",
                    content=f"言葉{i}{minute}",
                )
            )
    kane(svc, rows)
    first = await line(svc)
    again = await line(svc, NOW + timedelta(seconds=40))
    assert first == again
    years = set()
    for k in range(6):
        got = await line(svc, NOW + timedelta(minutes=k))
        years.add(got["year"])
    assert len(years) > 1  # the choice moves with the minute


@pytest.mark.asyncio
async def test_seed_is_the_jst_date_and_clock(svc):
    assert same_time.seed_of(datetime(2026, 11, 10).date(), "21:03") == int.from_bytes(
        __import__("hashlib").sha256(b"2026-11-10|21:03").digest()[:8], "big"
    )


@pytest.mark.asyncio
async def test_promo_is_excluded(svc):
    kane(
        svc,
        [
            msg(1, "2024-06-02T12:03:00Z", content=PROMO),
            msg(2, "2024-06-02T12:03:30Z", "picture", media_file="x\\2.jpg"),
        ],
    )
    with capture_logs() as logs:
        assert await line(svc) is None
    (ev,) = [e for e in logs if e["event"] == "memories_same_time"]
    assert ev["band"] == "none" and ev["count"] == 0 and ev["message_id"] is None


@pytest.mark.asyncio
async def test_picture_with_caption_counts(svc):
    kane(
        svc,
        [
            msg(
                1,
                "2024-06-02T12:03:00Z",
                "picture",
                content="夜ごはん",
                media_file=f"{KANE}/picture/1.jpg".replace("/", "\\"),
            ),
            # a captionless picture is not words
            msg(2, "2024-06-01T12:03:00Z", "picture", media_file="x\\2.jpg"),
        ],
    )
    got = await line(svc)
    assert got["message"]["id"] == 1 and got["message"]["type"] == "picture"


@pytest.mark.asyncio
async def test_none_without_candidates(svc):
    assert await line(svc) is None  # no rooms at all
    kane(svc, [msg(1, "2024-06-02T03:00:00Z", content="お昼")])
    assert await line(svc) is None


@pytest.mark.asyncio
async def test_midnight_wrap(svc):
    kane(
        svc,
        [
            msg(1, "2024-06-02T14:58:00Z", content="23:58の言葉"),  # 23:58 JST
            msg(2, "2024-06-02T15:03:00Z", content="00:03の言葉"),  # out
        ],
    )
    # 2026-11-11 00:00 JST: window 23:58 .. 00:02
    got = await line(svc, datetime(2026, 11, 10, 15, 0, tzinfo=timezone.utc))
    assert got["clock"] == "00:00" and got["message"]["id"] == 1


@pytest.mark.asyncio
async def test_payload_carries_her_own_jst_time_not_nows_clock(svc):
    """The line shows her message's real JST time: ``message.ts`` carries it."""
    kane(
        svc, [msg(1, "2024-06-02T15:01:00Z", content="00:01の言葉")]
    )  # 00:01 JST Jun 3
    # 2026-11-11 00:02 JST: the clock is now's, the time is hers.
    got = await line(svc, datetime(2026, 11, 10, 15, 2, tzinfo=timezone.utc))
    assert got["clock"] == "00:02" and got["date"] == "2024-06-03"
    ts = datetime.fromisoformat(got["message"]["ts"].replace("Z", "+00:00"))
    jst = ts.astimezone(timezone(timedelta(hours=9)))
    assert (jst.date().isoformat(), jst.strftime("%H:%M")) == ("2024-06-03", "00:01")


@pytest.mark.asyncio
async def test_yesterday_at_23_59_is_an_earlier_date(svc):
    # 2026-11-10 23:59 JST, then 2026-11-11 00:00 JST
    kane(svc, [msg(1, "2026-11-10T14:59:00Z", content="昨日の夜")])
    got = await line(svc, datetime(2026, 11, 10, 15, 0, tzinfo=timezone.utc))
    assert got["message"]["id"] == 1 and got["date"] == "2026-11-10"


@pytest.mark.asyncio
async def test_feb_29_is_an_ordinary_date(svc):
    kane(svc, [msg(1, "2024-02-29T12:03:00Z", content="うるう日")])
    got = await line(svc, datetime(2025, 3, 1, 12, 3, tzinfo=timezone.utc))
    assert got["date"] == "2024-02-29" and got["year"] == 2024


@pytest.mark.asyncio
async def test_logs_carry_no_text_or_names(svc):
    kane(svc, [msg(1, "2024-06-02T12:03:00Z", content="ひみつの言葉")])
    with capture_logs() as logs:
        await line(svc)
    flat = repr(logs)
    for secret in ("ひみつの言葉", "金村", str(svc)):
        assert secret not in flat


@pytest.mark.asyncio
async def test_picture_with_a_paired_caption_counts_by_its_photo_score(svc):
    kane(
        svc,
        [
            msg(1, "2024-06-02T12:00:00Z", content="夜ごはんの写真"),  # 21:00: out
            msg(
                2,
                "2024-06-02T12:03:00Z",  # 21:03, paired with id 1 (+-3 min)
                "picture",
                media_file=f"{KANE}/picture/2.jpg".replace("/", "\\"),
            ),
        ],
    )
    got = await line(svc)
    assert got["message"]["id"] == 2
    assert got["message"]["caption_id"] == 1 and got["message"]["caption"]
