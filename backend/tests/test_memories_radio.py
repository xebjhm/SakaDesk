"""Voice radio (``backend/services/memories/radio.py``)."""

from __future__ import annotations

import contextlib
import json
from datetime import datetime, timezone

import pytest
import time_machine
from structlog.testing import capture_logs

from backend.services.memories import album_colors
from backend.services.memories import index as mi
from backend.services.memories import oshi as oshi_mod
from backend.services.memories import people, radio
from backend.services.memories import transcripts as tr
from backend.services.memories.view_cache import contains_text
from backend.tests.memories_archive import msg, write_room
from backend.tests.test_memories_cards import fact
from backend.services.transcription_service import TranscriptionStorage
from backend.tests.test_memories_transcripts import entry, seg, write_transcripts

SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
ROOM_A = "messages/34 金村 美玖/58 金村 美玖"
ROOM_B = "messages/35 小坂 菜緒/60 小坂 菜緒"
NOW = datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc)  # JST 2026-11-10 12:00
GOODNIGHT = "おやすみ🌙"


def voice(i, ts, dur=None, *, fav=False, room=ROOM_A, type_="voice", content=""):
    extra = {"media_file": f"{room}/{type_}/{i}.m4a".replace("/", "\\")}
    if dur is not None:
        extra["media_duration"] = dur
    return msg(i, ts, type_, content=content, fav=fav, **extra)


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
            msg(1, "2023-05-01T12:00:00Z", content="今日もありがとう"),
            voice(101, "2023-05-01T13:00:00Z", 30.0),  # JST 22:00 night
            voice(102, "2023-05-31T22:00:00Z", 10.0, fav=True),  # JST 06-01 07:00
            voice(106, "2023-07-07T12:30:00Z", 9.0, type_="video"),  # not radio
            voice(103, "2024-01-10T03:00:00Z"),  # JST 12:00, unknown length
            voice(104, "2024-03-02T16:30:00Z", 20.0),  # JST 03-03 01:30 night
            voice(105, "2024-04-04T14:00:00Z", 5.0, content=GOODNIGHT),  # JST 23:00
        ],
    )
    write_room(
        sdir,
        "35 小坂 菜緒",
        "60 小坂 菜緒",
        [
            voice(201, "2025-02-02T13:15:00Z", 100.0, room=ROOM_B),  # JST 22:15
            voice(202, "2025-02-02T21:00:00Z", 50.0, room=ROOM_B),  # JST 02-03 06:00
        ],
    )
    write_room(
        sdir, "36 文字", "61 文字", [msg(1, "2024-09-01T03:00:00Z", content="文字")]
    )
    return sdir


def add_transcripts(sdir):
    write_transcripts(
        sdir,
        ROOM_A,
        [
            entry(101, [seg(0.2, 2.0, "今日もありがとう"), seg(2.0, 4.0, GOODNIGHT)]),
            entry(102, [seg(0.0, 3.0, "おはよう")]),
            entry(104, [seg(0.0, 1.0, "おやすみ")], no_speech=True),
            entry(106, [seg(0.0, 1.0, "おやすみ")], media_type="video"),
        ],
    )


async def person(sdir, room):
    return next(s for s in await mi.list_members(sdir) if room in s.member_dirs)


async def program(sdir, name, *, member=None, year=None, now=NOW):
    return await radio.radio_program(
        SERVICE, sdir, program=name, member=member, year=year, now=now
    )


def ids(body):
    return [t["message"]["id"] for t in body["tracks"]]


# --- pure -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("when", "expected"),
    [
        ("2024-01-01 04:59", "oyasumi"),
        ("2024-01-01 05:00", "ohayo"),
        ("2024-01-01 09:59", "ohayo"),
        ("2024-01-01 10:00", "otsukare"),
        ("2024-01-01 20:59", "otsukare"),
        ("2024-01-01 21:00", "oyasumi"),
        ("2024-01-01 00:00", "oyasumi"),
    ],
)
def test_program_of_boundaries(when, expected):
    assert radio.program_of(fact(1, when, "voice")) == expected


def test_program_constants():
    assert radio.PROGRAMS == (
        "oyasumi",
        "ohayo",
        "otsukare",
        "chrono",
        "favorites",
        "oyasumi_clips",
    )
    assert radio.NIGHT_HOURS == {21, 22, 23, 0, 1, 2, 3, 4}
    assert list(radio.MORNING_HOURS) == [5, 6, 7, 8, 9]


def test_daily_order_formula():
    import hashlib
    import random

    items = list(range(20))
    seed = int(hashlib.sha256(b"2026-11-10|oyasumi|all").hexdigest()[:16], 16)
    expected = list(items)
    random.Random(seed).shuffle(expected)
    got = radio.daily_order(items, day="2026-11-10", program="oyasumi", scope="all")
    assert got == expected and items == list(range(20))  # input untouched


# --- programs -------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_band_programs_and_list(svc):
    body = await program(svc, "oyasumi")
    assert body["program"] == "oyasumi"
    assert sorted(ids(body)) == [101, 104, 105, 201]
    # no transcripts: the clip program is absent; empty bands never listed
    assert body["programs"] == ["oyasumi", "ohayo", "otsukare", "chrono", "favorites"]
    assert body["years"] == [2023, 2024, 2025]
    # every listed program's track count (chrono: the default year), in every payload
    counts = {p: len((await program(svc, p))["tracks"]) for p in body["programs"]}
    assert body["counts"] == counts
    assert (await program(svc, "ohayo"))["counts"] == counts
    assert list(body["counts"]) == body["programs"] and all(counts.values())
    assert sorted(ids(await program(svc, "ohayo"))) == [102, 202]
    assert ids(await program(svc, "otsukare")) == [103]
    t = (await program(svc, "otsukare"))["tracks"][0]
    assert t["start"] == 0 and t["end"] is None and t["segments"] is None
    assert t["has_transcript"] is False
    assert t["message"]["type"] == "voice" and t["message"]["media_url"]
    assert "avatar_url" in t["message"]


@pytest.mark.asyncio
async def test_scoped_programs_omit_empty_ones(svc):
    b = await person(svc, ROOM_B)
    body = await program(svc, "oyasumi", member=b)
    assert ids(body) == [201]
    assert body["programs"] == ["oyasumi", "ohayo", "chrono"]  # no otsukare, no ★
    assert body["years"] == [2025]
    assert body["counts"] == {"oyasumi": 1, "ohayo": 1, "chrono": 2}


@pytest.mark.asyncio
async def test_daily_shuffle_stable_through_the_night(svc):
    async def order_at(when):
        with time_machine.travel(when, tick=False):
            return ids(await program(svc, "oyasumi", now=datetime.now(timezone.utc)))

    # broadcast day 2026-11-10 runs JST 11-10 05:00 .. 11-11 04:59
    base = await order_at(datetime(2026, 11, 9, 20, 0, tzinfo=timezone.utc))
    for when in (
        datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc),  # JST 21:00
        datetime(2026, 11, 10, 14, 30, tzinfo=timezone.utc),  # JST 23:30
        datetime(2026, 11, 10, 15, 30, tzinfo=timezone.utc),  # JST 00:30
        datetime(2026, 11, 10, 19, 59, tzinfo=timezone.utc),  # JST 04:59
    ):
        assert await order_at(when) == base  # tonight's order holds past midnight
    days = {
        tuple(await order_at(datetime(2026, 11, d, 3, 0, tzinfo=timezone.utc)))
        for d in range(12, 20)
    }
    assert len(days | {tuple(base)}) > 1  # another day, another order
    for order in days:
        assert sorted(order) == [101, 104, 105, 201]


@pytest.mark.parametrize(
    ("utc", "day"),
    [
        (datetime(2026, 11, 10, 19, 59, tzinfo=timezone.utc), "2026-11-10"),  # 04:59
        (datetime(2026, 11, 10, 20, 0, tzinfo=timezone.utc), "2026-11-11"),  # 05:00
        (datetime(2026, 11, 10, 15, 0, tzinfo=timezone.utc), "2026-11-10"),  # 00:00
    ],
)
def test_broadcast_day_rolls_over_at_five_jst(utc, day):
    with time_machine.travel(utc, tick=False):
        assert radio.broadcast_day(datetime.now(timezone.utc)) == day


@pytest.mark.asyncio
async def test_program_cache_row_is_replaced_not_added(svc):
    for d in (10, 11, 12):
        await program(svc, "oyasumi", now=datetime(2026, 11, d, 3, tzinfo=timezone.utc))
    # year is ignored outside chrono: no extra rows, and the log says None
    with capture_logs() as logs:
        await program(svc, "oyasumi", year=2024)
    assert next(e for e in logs if e["event"] == "memories_radio")["year"] is None
    assert len(cached_payloads("radio_program")) == 1
    await program(svc, "chrono", year=2024)
    await program(
        svc, "chrono", year=2024, now=datetime(2026, 11, 12, 3, tzinfo=timezone.utc)
    )
    assert len(cached_payloads("radio_program")) == 2


@pytest.mark.asyncio
async def test_chrono_filters_year_oldest_first(svc):
    body = await program(svc, "chrono")  # default: the first year
    assert ids(body) == [101, 102]
    assert ids(await program(svc, "chrono", year=2024)) == [103, 104, 105]
    a = await person(svc, ROOM_A)
    assert ids(await program(svc, "chrono", member=a, year=2024)) == [103, 104, 105]
    b = await person(svc, ROOM_B)
    assert ids(await program(svc, "chrono", member=b)) == [201, 202]


@pytest.mark.asyncio
async def test_favorites_only_starred(svc):
    body = await program(svc, "favorites")
    assert ids(body) == [102]
    assert body["tracks"][0]["message"]["favorited"] is True


@pytest.mark.asyncio
async def test_empty_requested_program_is_logged(svc):
    with capture_logs() as logs:
        body = await program(svc, "chrono", year=2030)
    assert body["tracks"] == []
    skip = next(e for e in logs if e["event"] == "memories_skip")
    assert skip["view"] == "radio" and skip["reason"] == "empty_program"


@pytest.mark.asyncio
async def test_unknown_program_is_value_error(svc):
    with pytest.raises(ValueError):
        await program(svc, "nope")


@pytest.mark.asyncio
async def test_texts_attached_after_cache(svc):
    for _ in range(2):  # miss, then hit
        body = await program(svc, "oyasumi")
        by_id = {t["message"]["id"]: t["message"] for t in body["tracks"]}
        assert by_id[105]["text"] == GOODNIGHT


def cached_payloads(view):
    with contextlib.closing(mi._connect()) as c:
        rows = c.execute(
            "SELECT payload FROM memories_view_cache WHERE view=?", (view,)
        ).fetchall()
    return [json.loads(r[0]) for r in rows]


@pytest.mark.asyncio
async def test_clip_program_with_transcripts(svc):
    add_transcripts(svc)
    body = await program(svc, "oyasumi")
    assert body["programs"][-1] == "oyasumi_clips"
    assert body["counts"]["oyasumi_clips"] == 1
    tracks = {t["message"]["id"]: t for t in body["tracks"]}
    assert tracks[101]["has_transcript"] is True
    assert tracks[104]["has_transcript"] is False  # no_speech
    assert tracks[105]["has_transcript"] is False

    for _ in range(2):  # miss, then hit: segments attached after the cache
        clips = await program(svc, "oyasumi_clips")
        assert len(clips["tracks"]) == 1
        t = clips["tracks"][0]
        assert t["message"]["id"] == 101  # the video's おやすみ is not radio
        assert t["start"] == pytest.approx(1.7) and t["end"] == pytest.approx(4.3)
        assert t["has_transcript"] is True
        assert t["segments"] == [{"start": 2.0, "end": 4.0, "text": GOODNIGHT}]
    stored = cached_payloads("radio_program")
    assert stored and not any(contains_text(p) for p in stored)
    assert all(t["segments"] is None for p in stored for t in p["tracks"])
    assert GOODNIGHT not in json.dumps(stored, ensure_ascii=False)


@pytest.mark.asyncio
async def test_clip_order_oldest_first_across_rooms(svc):
    add_transcripts(svc)
    write_transcripts(
        svc,
        ROOM_B,
        [entry(201, [seg(0.0, 1.0, "おやすみ"), seg(5.0, 6.0, "おやすみなさい")])],
    )
    body = await program(svc, "oyasumi_clips")
    assert [(t["message"]["id"], t["start"]) for t in body["tracks"]] == [
        (101, pytest.approx(1.7)),
        (201, 0),
        (201, pytest.approx(4.7)),
    ]


@pytest.mark.asyncio
async def test_clip_whose_segment_vanished_is_dropped(svc, monkeypatch):
    add_transcripts(svc)
    await program(svc, "oyasumi_clips")  # cache the windows
    monkeypatch.setattr(tr, "segments_for", lambda sdir, room, ids: {})
    with capture_logs() as logs:
        body = await program(svc, "oyasumi_clips")
    assert body["tracks"] == []
    skip = next(e for e in logs if e["event"] == "memories_skip")
    assert skip["reason"] == "clip_missing" and skip["count"] == 1


@pytest.mark.asyncio
async def test_transcript_change_invalidates_the_cache(svc):
    assert "oyasumi_clips" not in (await program(svc, "oyasumi"))["programs"]
    add_transcripts(svc)
    assert "oyasumi_clips" in (await program(svc, "oyasumi"))["programs"]


@pytest.mark.asyncio
async def test_program_logs_carry_no_text_or_names(svc):
    add_transcripts(svc)
    a = await person(svc, ROOM_A)
    with capture_logs() as logs:
        await program(svc, "oyasumi_clips", member=a)
        await program(svc, "chrono")
    events = [e for e in logs if e["event"] == "memories_radio"]
    assert events[0] == {
        "event": "memories_radio",
        "log_level": "info",
        "view": "program",
        "program": "oyasumi_clips",
        "count": 1,
        "with_transcript": 1,
        "year": None,
        "scoped": True,
    }
    assert events[1]["year"] == 2023 and events[1]["scoped"] is False
    blob = repr(logs)
    for bad in ("金村", "おやすみ", "ありがとう", str(svc), "58 "):
        assert bad not in blob


# --- members ----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_members_order_and_seconds(svc, oshi_names):
    body = await radio.radio_members(SERVICE, svc)
    rows = body["members"]
    assert [(r["member_path"], r["voices"], r["seconds"]) for r in rows] == [
        (f"{SVC_NAME}/{ROOM_B}", 2, 150.0),
        (f"{SVC_NAME}/{ROOM_A}", 5, 65.0),
    ]  # the text-only member is omitted; the video is not a voice
    assert body["total_seconds"] == 215.0
    assert rows[0]["member_id"] == "60" and rows[0]["name"]
    assert "avatar_url" in rows[0] and rows[0]["oshi"] is False
    oshi_names.add((await person(svc, ROOM_A)).name_norm)
    rows = (await radio.radio_members(SERVICE, svc))["members"]
    assert rows[0]["member_path"] == f"{SVC_NAME}/{ROOM_A}" and rows[0]["oshi"]


@pytest.mark.asyncio
async def test_members_unknown_lengths_are_null(tmp_path, oshi_names, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    out = tmp_path / "out"
    sdir = out / SVC_NAME
    monkeypatch.setattr(people, "output_dir", lambda: out)
    write_room(sdir, "34 金村 美玖", "58 金村 美玖", [voice(1, "2024-01-01T03:00:00Z")])
    body = await radio.radio_members(SERVICE, sdir)
    assert body["total_seconds"] is None
    assert body["members"][0]["seconds"] is None
    assert body["members"][0]["voices"] == 1
    cassettes = await radio.radio_cassettes(SERVICE, sdir, member=None)
    assert cassettes["cassettes"][0]["seconds"] is None


# --- cassettes --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cassettes_colours_from_month_colours(svc, monkeypatch):
    seen = []

    async def fake(service, sdir, member):
        seen.append(member)
        return {
            "colors": {
                "2023-05": "#ff0000",
                "2023-06": "#ff1010",
                "2023-07": None,
                "2024-01": None,
            }
        }, False

    monkeypatch.setattr(album_colors, "month_colors_status", fake)
    body = await radio.radio_cassettes(SERVICE, svc, member=None)
    assert body["cassettes"] == [
        {
            "year": 2023,
            "voices": 2,
            "seconds": 40.0,
            "color": album_colors.month_color([(255, 0, 0), (255, 16, 16)]),
        },
        {"year": 2024, "voices": 3, "seconds": 25.0, "color": None},
        {"year": 2025, "voices": 2, "seconds": 150.0, "color": None},
    ]
    assert body["cassettes"][0]["color"] == "#ff0000"
    a = await person(svc, ROOM_A)
    scoped = await radio.radio_cassettes(SERVICE, svc, member=a)
    assert [c["year"] for c in scoped["cassettes"]] == [2023, 2024]
    assert seen == [None, a]


@pytest.mark.asyncio
async def test_cassettes_without_voices_skip_colours(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    sdir = tmp_path / "out" / SVC_NAME
    write_room(sdir, "36 文字", "61 文字", [msg(1, "2024-09-01T03:00:00Z")])

    async def boom(*a):
        raise AssertionError("not needed without voices")

    monkeypatch.setattr(album_colors, "month_colors_status", boom)
    with capture_logs() as logs:
        assert await radio.radio_cassettes(SERVICE, sdir, member=None) == {
            "cassettes": []
        }
    ev = next(e for e in logs if e["event"] == "memories_radio")
    assert ev["view"] == "cassettes" and ev["count"] == 0


@pytest.mark.asyncio
async def test_cassette_colour_fills_in_when_pictures_arrive(svc, monkeypatch):
    colors: dict[str, str | None] = {"2023-05": None}

    async def fake(service, sdir, member):
        return {"colors": dict(colors)}, False

    monkeypatch.setattr(album_colors, "month_colors_status", fake)
    first = await radio.radio_cassettes(SERVICE, svc, member=None)
    assert first["cassettes"][0]["color"] is None
    colors["2023-05"] = "#336699"
    (svc / ROOM_A / "picture").mkdir()  # media repair adds the pictures
    again = await radio.radio_cassettes(SERVICE, svc, member=None)
    assert again["cassettes"][0]["color"] == "#336699"


@pytest.mark.asyncio
async def test_cassettes_from_transient_colours_are_not_cached(svc, monkeypatch):
    """A ribbon degraded by unreadable probes must not freeze the tape colours."""
    state = {"transient": True}

    async def fake(service, sdir, member):
        if state["transient"]:
            return {"colors": {"2023-05": None}}, True
        return {"colors": {"2023-05": "#336699"}}, False

    monkeypatch.setattr(album_colors, "month_colors_status", fake)
    with capture_logs() as logs:
        first = await radio.radio_cassettes(SERVICE, svc, member=None)
    assert first["cassettes"][0]["color"] is None
    assert "transient" in [
        e["outcome"] for e in logs if e["event"] == "memories_view_cache"
    ]
    state["transient"] = False
    again = await radio.radio_cassettes(SERVICE, svc, member=None)
    assert again["cassettes"][0]["color"] == "#336699"


# --- clip windows -------------------------------------------------------------------------


def clip_room(sdir, segments, dur=30.0):
    write_room(
        sdir,
        "34 金村 美玖",
        "58 金村 美玖",
        [voice(101, "2023-05-01T13:00:00Z", dur)],
    )
    write_transcripts(sdir, ROOM_A, [entry(101, segments)])


@pytest.fixture
def bare(tmp_path, oshi_names, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    out = tmp_path / "out"
    monkeypatch.setattr(people, "output_dir", lambda: out)
    return out / SVC_NAME


def windows(body):
    return [
        (t["start"], t["end"], [s["text"] for s in t["segments"]])
        for t in body["tracks"]
    ]


@pytest.mark.asyncio
async def test_clip_end_is_clamped_to_the_voice_length(bare):
    clip_room(bare, [seg(29.0, 29.9, "おやすみ"), seg(31.0, 32.0, "おやすみ")])
    body = await program(bare, "oyasumi_clips")
    # the second segment lies past the 30 s voice: its window is empty, dropped
    assert windows(body) == [(pytest.approx(28.7), 30.0, ["おやすみ"])]


@pytest.mark.asyncio
async def test_clip_end_unclamped_without_a_length(bare):
    clip_room(bare, [seg(29.0, 29.9, "おやすみ")], dur=None)
    body = await program(bare, "oyasumi_clips")
    assert windows(body) == [(pytest.approx(28.7), pytest.approx(30.2), ["おやすみ"])]


@pytest.mark.asyncio
async def test_overlapping_and_touching_clips_merge(bare):
    clip_room(
        bare,
        [
            seg(0.0, 1.0, "おやすみ"),
            seg(1.2, 2.0, "おやすみなさい"),  # overlaps the first window
            seg(2.6, 3.0, "おやすみ〜"),  # touches: 2.0 + 0.3 == 2.6 - 0.3
            seg(5.0, 6.0, "ふふ"),
            seg(9.0, 10.0, "おやすみ🌙"),  # separate
        ],
    )
    for _ in range(2):  # miss, then hit (re-found by index)
        body = await program(bare, "oyasumi_clips")
        assert windows(body) == [
            (0, pytest.approx(3.3), ["おやすみ", "おやすみなさい", "おやすみ〜"]),
            (pytest.approx(8.7), pytest.approx(10.3), ["おやすみ🌙"]),
        ]
        assert all("segment_indexes" not in t for t in body["tracks"])
    stored = cached_payloads("radio_program")[0]
    assert [t["segment_indexes"] for t in stored["tracks"]] == [[0, 1, 2], [4]]


@pytest.mark.asyncio
async def test_clips_are_refound_by_index_not_by_window(bare, monkeypatch):
    clip_room(bare, [seg(0.0, 1.0, "ねえ"), seg(2.0, 3.0, "おやすみ")])
    await program(bare, "oyasumi_clips")  # cache index 1
    real = tr.segments_for

    def shifted(sdir, room, ids):  # same segments, times nudged
        return {
            mid: [{**s, "start": s["start"] + 0.01} for s in segs]
            for mid, segs in real(sdir, room, ids).items()
        }

    monkeypatch.setattr(tr, "segments_for", shifted)
    body = await program(bare, "oyasumi_clips")
    assert body["tracks"][0]["segments"][0]["text"] == "おやすみ"

    def reworded(sdir, room, ids):  # index 1 no longer matches
        return {mid: [seg(0, 1, "ねえ"), seg(2, 3, "またね")] for mid in ids}

    monkeypatch.setattr(tr, "segments_for", reworded)
    with capture_logs() as logs:
        assert (await program(bare, "oyasumi_clips"))["tracks"] == []
    assert any(e.get("reason") == "clip_missing" for e in logs)


@pytest.mark.asyncio
async def test_each_sidecar_is_read_once_per_miss(svc, monkeypatch):
    add_transcripts(svc)
    write_transcripts(svc, ROOM_B, [entry(201, [seg(0.0, 1.0, "おやすみ")])])
    calls: list[str] = []
    real = TranscriptionStorage.load_all

    def counting(self, member_dir):
        calls.append(member_dir.name)
        return real(self, member_dir)

    monkeypatch.setattr(TranscriptionStorage, "load_all", counting)
    await program(svc, "oyasumi_clips")  # miss
    assert sorted(calls) == ["58 金村 美玖", "60 小坂 菜緒"]
    calls.clear()
    await program(svc, "oyasumi_clips")  # hit: only the attach reads
    assert sorted(calls) == ["58 金村 美玖", "60 小坂 菜緒"]
    calls.clear()
    await program(svc, "oyasumi")  # a miss on another program: once per room
    assert sorted(calls) == ["58 金村 美玖", "60 小坂 菜緒"]
