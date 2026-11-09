import json
from datetime import date, datetime, timezone

import pytest

from backend.services.memories import facts as mf
from backend.services.memories import index as mi


def _member(root, msgs, *, avatars=None):
    d = root / "messages" / "34 金村 美玖" / "58 金村 美玖"
    d.mkdir(parents=True)
    (d / "messages.json").write_text(
        json.dumps({"member": {}, "messages": msgs}, ensure_ascii=False),
        encoding="utf-8",
    )
    if avatars is not None:
        (d / "profile_images").mkdir()
        (d / "profile_images" / "index.json").write_text(
            json.dumps(avatars), encoding="utf-8"
        )
    return d


def m(i, ts, type_="text", content="", fav=False, **extra):
    return {
        "id": i,
        "timestamp": ts,
        "type": type_,
        "content": content,
        "is_favorite": fav,
        **extra,
    }


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
