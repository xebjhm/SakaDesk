import json
from datetime import date, datetime, timezone

import pytest

from backend.services.memories import facts as mf
from backend.services.memories import index as mi
from backend.tests.memories_archive import msg as m
from backend.tests.memories_archive import write_room


def _member(root, msgs, *, avatars=None):
    d = write_room(root, "34 金村 美玖", "58 金村 美玖", msgs)
    if avatars is not None:
        (d / "profile_images").mkdir()
        (d / "profile_images" / "index.json").write_text(
            json.dumps(avatars), encoding="utf-8"
        )
    return d


ROWS = [
    # 2025-12-31 23:30 JST
    m(1, "2025-12-31T14:30:00Z", content="今年もありがとう"),
    # 2026-01-01 00:05 JST: nickname + two greetings
    m(2, "2026-01-01T15:05:00Z", content="%%%、おやすみ大好き"),
    m(
        3,
        "2026-01-02T12:00:00Z",
        "picture",
        content="今日のお昼ごはん",
        fav=True,
        media_file="messages\\34 金村 美玖\\58 金村 美玖\\picture\\3.jpg",
    ),
    m(4, "2026-01-02T12:01:00Z", "picture"),
    m(5, "2026-01-02T12:02:00Z", "picture"),
    m(
        6,
        "2026-01-03T12:00:00Z",
        "voice",
        media_duration=12.5,
        media_file="messages\\34 金村 美玖\\58 金村 美玖\\voice\\6.m4a",
    ),
    m(7, "2026-01-04T12:00:00Z", "voice", media_duration=2.0),
    m(8, "2026-01-05T12:00:00Z", content="詳細はコチラ https://x.jp"),
]


@pytest.fixture
def member(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    return tmp_path, _member(tmp_path, ROWS)


@pytest.mark.asyncio
async def test_fact_rows_schema(member):
    svc, d = member
    facts = await mf.get_facts(svc, d)
    by_id = {f.id: f for f in facts}
    assert [f.id for f in facts] == [1, 2, 3, 4, 5, 6, 7, 8]
    f2 = by_id[2]
    assert f2.jst_date == date(2026, 1, 2) and (f2.hour, f2.minute) == (0, 5)
    assert f2.has_nickname and f2.greetings == {"oyasumi", "daisuki"}
    assert f2.has_greeting("daisuki") and not f2.has_greeting("ohayo")
    assert f2.chars == len("%%%、おやすみ大好き") and f2.importance is not None
    assert f2.ts == datetime(2026, 1, 1, 15, 5, tzinfo=timezone.utc)
    f3 = by_id[3]
    assert f3.caption_id == 3 and f3.burst_id == 3 and f3.favorited
    assert f3.photo_score is not None and f3.importance is not None
    assert f3.media_file.endswith("3.jpg")
    assert by_id[4].burst_id == 3 and by_id[4].caption_id is None
    assert by_id[6].duration_s == 12.5 and by_id[6].importance is None
    assert by_id[8].is_promo and by_id[8].importance is None


@pytest.mark.asyncio
async def test_range_date_type_and_until(member):
    svc, d = member
    y2026 = await mf.get_facts(svc, d, date(2026, 1, 1), date(2026, 12, 31))
    assert [f.id for f in y2026] == [2, 3, 4, 5, 6, 7, 8]  # JST year
    pics = await mf.get_facts(svc, d, types={"picture"}, include_promo=False)
    assert [f.id for f in pics] == [3, 4, 5]
    cut = await mf.get_facts(
        svc, d, until=datetime(2026, 1, 2, 12, 1, tzinfo=timezone.utc)
    )
    assert [f.id for f in cut][-1] == 4
    assert [f.id for f in mf.facts_for_date(svc, d, date(2026, 1, 2))] == [
        2,
        3,
        4,
        5,
    ]


@pytest.mark.asyncio
async def test_pure_helpers(member):
    svc, d = member
    facts = await mf.get_facts(svc, d)
    assert [f.id for f in mf.select(facts, nickname=True)] == [2]
    assert [f.id for f in mf.select(facts, greeting="oyasumi")] == [2]
    assert [f.id for f in mf.select(facts, favorited=True)] == [3]
    assert [f.id for f in mf.select(facts, hours=[0])] == [2]
    assert 8 not in [f.id for f in mf.select(facts)]  # promo excluded by default
    assert [f.id for f in mf.on_date(facts, date(2026, 1, 3))] == [6]
    first, last = mf.first_last(facts, types={"text"})
    assert (first.id, last.id) == (1, 2)
    assert mf.first_last([], types={"text"}) == (None, None)
    assert [(f.id, s) for f, s in mf.voice_durations(facts, min_seconds=4)] == [
        (6, 12.5)
    ]
    assert {k: [f.id for f in v] for k, v in mf.bursts(facts).items()} == {3: [3, 4, 5]}
    years = mf.year_aggregates(facts)
    assert set(years) == {2025, 2026}
    agg = years[2026]
    assert agg.total == 7 and agg.counts == {"text": 2, "picture": 3, "voice": 2}
    assert agg.nonpromo_total == 6 and agg.nonpromo_counts["text"] == 1
    assert agg.hour_hist[0] == 1 and agg.hour_hist[21] == 5
    assert agg.nickname_count == 1 and agg.favorites == 1
    assert agg.greeting_counts == {"oyasumi": 1, "daisuki": 1, "ohiru": 1}
    assert agg.voice_count == 2 and agg.voice_seconds == 14.5
    assert agg.media_in_bursts == 3
    assert agg.active_days == 4 and agg.longest_streak_days == 4  # JST 1/2..1/5
    assert agg.first.id == 2 and agg.last.id == 7
    assert mf.aggregate([]) == mf.Aggregate()


@pytest.mark.asyncio
async def test_load_texts_one_read(member):
    svc, d = member
    assert mf.load_texts(svc, d, [2, 8]) == {
        2: "%%%、おやすみ大好き",
        8: "詳細はコチラ https://x.jp",
    }
    assert len(mf.load_texts(svc, d)) == 8
    assert mf.load_texts(svc, svc / "nope") == {}


@pytest.mark.asyncio
async def test_rebuild_replaces_fact_rows(member):
    svc, d = member
    await mf.get_facts(svc, d)
    (d / "messages.json").write_text(
        json.dumps({"messages": [m(1, "2026-03-01T03:00:00Z", content="a")]}),
        encoding="utf-8",
    )
    assert [f.id for f in await mf.get_facts(svc, d)] == [1]


@pytest.mark.asyncio
async def test_unbuildable_index_returns_no_facts(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    d = tmp_path / "messages" / "1 x" / "2 x"
    d.mkdir(parents=True)
    (d / "messages.json").write_text("{bad", encoding="utf-8")
    assert await mf.get_facts(tmp_path, d) == []


@pytest.mark.asyncio
async def test_last_message_and_avatar_changes(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    avatars = {
        "version": 1,
        "current": {},
        "images": [
            {
                "kind": "thumbnail",
                "file": "thumbnail/b.jpg",
                "first_seen": "2026-05-01T00:00:00Z",
            },
            {
                "kind": "thumbnail",
                "file": "thumbnail/a.jpg",
                "first_seen": "2025-01-01T00:00:00Z",
            },
            {"kind": "thumbnail", "file": "../evil.jpg", "first_seen": "x"},
        ],
    }
    d = _member(tmp_path, ROWS, avatars=avatars)
    idx = await mi.get_member_index(tmp_path, d)
    assert idx.last_message == {"id": 8, "ts": "2026-01-05T12:00:00Z", "type": "text"}
    assert idx.last_ts["voice"] == "2026-01-04T12:00:00Z"
    assert [a["file"] for a in idx.avatar_changes] == [
        "thumbnail/a.jpg",
        "thumbnail/b.jpg",
    ]
    # A new avatar (index.json change) rebuilds the entry.
    avatars["images"].append(
        {
            "kind": "thumbnail",
            "file": "thumbnail/c.jpg",
            "first_seen": "2026-09-01T00:00:00Z",
        }
    )
    (d / "profile_images" / "index.json").write_text(
        json.dumps(avatars), encoding="utf-8"
    )
    again = await mi.get_member_index(tmp_path, d)
    assert again.data_hash != idx.data_hash and len(again.avatar_changes) == 3


@pytest.mark.asyncio
async def test_get_facts_logs_stale_when_cache_write_failed(member, monkeypatch):
    from structlog.testing import capture_logs

    svc, d = member
    monkeypatch.setattr(mi, "_cache_put", lambda *a, **k: False)
    with capture_logs() as logs:
        await mf.get_facts(svc, d)
    (ev,) = [e for e in logs if e["event"] == "memory_facts_stale"]
    assert ev["member_id"] == "58" and set(ev) == {"event", "log_level", "member_id"}


@pytest.mark.asyncio
async def test_get_person_facts_merges_rooms_sorted(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    svc = tmp_path / "日向坂46"
    for room, msgs in (
        ("40 松田 好花", [m(1, "2026-01-01T03:00:00Z"), m(2, "2026-03-01T03:00:00Z")]),
        ("94 松田 好花", [m(1, "2026-02-01T03:00:00Z"), m(2, "2026-03-01T03:00:00Z")]),
    ):
        d = svc / "messages" / room / "64 松田 好花"
        d.mkdir(parents=True)
        (d / "messages.json").write_text(
            json.dumps({"member": {}, "messages": msgs}), encoding="utf-8"
        )
    (summary,) = await mi.list_members(svc)
    assert len(summary.member_dirs) == 2
    got = await mf.get_person_facts(svc, summary)
    old, new = summary.member_dirs
    assert [(r, f.id) for r, f in got] == [(old, 1), (new, 1), (old, 2), (new, 2)]
    assert [f.ts.month for _, f in got] == [1, 2, 3, 3]


# --- date-scoped queries (get_facts_on / facts_on_month_day) -----------------

ON_THIS_DAY_ROWS = [
    m(1, "2024-11-10T03:00:00Z", content="2024年の今日"),  # 11-10 JST
    m(2, "2024-11-11T03:00:00Z", content="翌日"),
    m(3, "2025-11-09T16:30:00Z", content="JSTでは11-10"),  # 11-10 01:30 JST
    m(4, "2025-11-10T15:30:00Z", content="JSTでは11-11"),  # 11-11 00:30 JST
    m(5, "2026-11-10T12:00:00Z", "picture"),
    m(6, "2026-11-10T01:00:00Z", content="同じ日の朝"),
]


@pytest.fixture
def on_this_day(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    d = write_room(tmp_path, "34 金村 美玖", "58 金村 美玖", ON_THIS_DAY_ROWS)
    return tmp_path, d


@pytest.mark.asyncio
async def test_get_facts_on_month_day_spans_years(on_this_day):
    svc, d = on_this_day
    got = await mf.get_facts_on(svc, d, month_day="11-10")
    assert [f.id for f in got] == [1, 3, 6, 5]  # by (ts, id), JST dates
    assert {f.jst_date.year for f in got} == {2024, 2025, 2026}
    assert [f.id for f in mf.facts_on_month_day(svc, d, "11-11")] == [2, 4]


@pytest.mark.asyncio
async def test_get_facts_on_day_returns_one_date(on_this_day):
    svc, d = on_this_day
    got = await mf.get_facts_on(svc, d, day=date(2026, 11, 10))
    assert [f.id for f in got] == [6, 5]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kwargs", [{}, {"day": date(2026, 11, 10), "month_day": "11-10"}]
)
async def test_get_facts_on_needs_exactly_one_argument(on_this_day, kwargs):
    svc, d = on_this_day
    with pytest.raises(ValueError):
        await mf.get_facts_on(svc, d, **kwargs)


@pytest.mark.asyncio
async def test_get_facts_on_unavailable_index_is_empty(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    d = tmp_path / "messages" / "1 x" / "2 x"
    d.mkdir(parents=True)
    (d / "messages.json").write_text("{bad", encoding="utf-8")
    assert await mf.get_facts_on(tmp_path, d, month_day="11-10") == []


@pytest.mark.asyncio
async def test_get_facts_on_read_error_is_empty_and_logged(on_this_day, monkeypatch):
    import sqlite3

    from structlog.testing import capture_logs

    svc, d = on_this_day

    def broken(*a, **k):
        raise sqlite3.OperationalError("locked")

    monkeypatch.setattr(mf, "facts_on_month_day", broken)
    with capture_logs() as logs:
        assert await mf.get_facts_on(svc, d, month_day="11-10") == []
    (ev,) = [e for e in logs if e["event"] == "memory_facts_read_failed"]
    assert ev["error_type"] == "OperationalError" and ev["member_id"] == "58"


# --- facts at a clock time (Task F5) ---------------------------------------------------

CLOCK_ROWS = [
    m(1, "2024-06-02T14:59:00Z", content="23:59 JST"),
    m(2, "2024-06-02T15:00:00Z", content="00:00 JST"),
    m(3, "2024-06-02T15:01:00Z", content="00:01 JST"),
    m(4, "2024-06-02T15:02:00Z", content="00:02 JST"),
    m(5, "2024-06-02T14:56:00Z", content="23:56 JST"),
    m(6, "2024-06-02T12:03:00Z", content="21:03 JST"),
    m(7, "2024-06-02T12:05:00Z", content="21:05 JST"),
    m(8, "2024-06-02T12:06:00Z", content="21:06 JST"),
    m(9, "2024-06-02T11:59:00Z", content="20:59 JST"),
]


@pytest.fixture
def clock_member(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    return tmp_path, _member(tmp_path, CLOCK_ROWS)


@pytest.mark.asyncio
async def test_facts_at_clock_plain_range(clock_member):
    svc, d = clock_member
    await mf.get_facts(svc, d)  # build the index
    got = mf.facts_at_clock(svc, d, 21 * 60 + 1, 21 * 60 + 5)
    assert [f.id for f in got] == [6, 7]
    # a range across the hour boundary
    got = mf.facts_at_clock(svc, d, 20 * 60 + 58, 21 * 60 + 3)
    assert [f.id for f in got] == [9, 6]


@pytest.mark.asyncio
async def test_facts_at_clock_wraps_midnight(clock_member):
    svc, d = clock_member
    # 23:59 +-2 min = 23:57 .. 00:01, passed as start > end
    got = await mf.get_facts_at_clock(svc, d, 23 * 60 + 57, 1)
    assert sorted(f.id for f in got) == [1, 2, 3]
    assert [f.id for f in got] == [1, 2, 3]  # by (ts, id)


@pytest.mark.asyncio
async def test_facts_at_clock_rejects_bad_minutes(clock_member):
    svc, d = clock_member
    for start, end in ((-1, 5), (0, 1440), (1440, 3)):
        with pytest.raises(ValueError):
            mf.facts_at_clock(svc, d, start, end)


@pytest.mark.asyncio
async def test_facts_at_clock_uses_the_clock_index(clock_member):
    import contextlib

    svc, d = clock_member
    await mf.get_facts(svc, d)
    sql, args = mf._clock_query(svc, d, 21 * 60 + 1, 21 * 60 + 5)
    with contextlib.closing(mi._connect()) as c:
        plan = " ".join(str(r) for r in c.execute(f"EXPLAIN QUERY PLAN {sql}", args))
    assert "message_facts_by_clock" in plan


@pytest.mark.asyncio
async def test_get_facts_at_clock_unavailable_index_is_empty(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    d = tmp_path / "messages" / "1 x" / "2 x"
    d.mkdir(parents=True)
    (d / "messages.json").write_text("{bad", encoding="utf-8")
    assert await mf.get_facts_at_clock(tmp_path, d, 0, 4) == []
