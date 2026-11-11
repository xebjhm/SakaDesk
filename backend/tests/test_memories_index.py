import json

import pytest

from backend.services.memories import index as mi


def write_member(root, msgs):
    d = root / "messages" / "34 金村 美玖" / "58 金村 美玖"
    d.mkdir(parents=True)
    (d / "messages.json").write_text(
        json.dumps(
            {"member": {"id": "58", "name": "金村 美玖"}, "messages": msgs},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return d


def facts_of(root, d):
    """Fact rows of one room folder, by message id (reads the cache as is)."""
    from backend.services.memories import facts as mf

    return {f.id: f for f in mf.facts_in_range(root, d)}


def msg(i, ts, type_="text", content=""):
    return {
        "id": i,
        "timestamp": ts,
        "type": type_,
        "content": content,
        "is_favorite": False,
    }


@pytest.mark.asyncio
async def test_builds_and_caches(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    d = write_member(
        tmp_path,
        [
            msg(1, "2026-09-14T03:00:00Z", content="おはよう☀️"),  # JST 12:00
            msg(
                2, "2026-09-14T12:30:00Z", content="%%%ちゃん、おやすみ🌙"
            ),  # JST 21:30
            msg(3, "2026-09-14T12:31:00Z", "picture"),
            msg(4, "2026-09-14T12:33:00Z", "picture"),
            msg(5, "2026-09-14T12:36:00Z", "picture"),
            msg(6, "2026-09-15T12:00:00Z", content="詳細はコチラ https://x.jp"),
        ],
    )
    idx = await mi.get_member_index(tmp_path, d)
    assert idx.hour_hist[21] == 4 and idx.nickname_count == 1
    assert idx.first_nickname_id == 2 and idx.bursts == [[3, 4, 5]]
    assert facts_of(tmp_path, d)[3].caption_id == 2 and 6 in idx.promo_ids
    assert idx.greeting_counts["oyasumi"] == 1 and idx.longest_streak_days == 2
    again = await mi.get_member_index(tmp_path, d)  # cache hit
    assert again.data_hash == idx.data_hash
    assert again == idx


@pytest.mark.asyncio
async def test_rebuilds_when_messages_change(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    d = write_member(tmp_path, [msg(1, "2026-09-14T03:00:00Z", content="a")])
    first = await mi.get_member_index(tmp_path, d)
    (d / "messages.json").write_text(
        json.dumps(
            {
                "member": {"id": "58", "name": "金村 美玖"},
                "messages": [
                    msg(1, "2026-09-14T03:00:00Z", content="a"),
                    msg(2, "2026-09-15T03:00:00Z", content="b"),
                ],
            }
        ),
        encoding="utf-8",
    )
    second = await mi.get_member_index(tmp_path, d)
    assert second.data_hash != first.data_hash and sum(second.hour_hist) == 2


@pytest.mark.asyncio
async def test_corrupt_messages_returns_empty_index(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    d = tmp_path / "messages" / "1 x" / "2 x"
    d.mkdir(parents=True)
    (d / "messages.json").write_text("{bad", encoding="utf-8")
    idx = await mi.get_member_index(tmp_path, d)
    assert sum(idx.hour_hist) == 0


@pytest.mark.asyncio
async def test_missing_messages_returns_empty_index(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    d = tmp_path / "messages" / "1 x" / "2 x"
    d.mkdir(parents=True)
    idx = await mi.get_member_index(tmp_path, d)
    assert idx.member_id == "2" and sum(idx.hour_hist) == 0


@pytest.mark.asyncio
async def test_profile_inputs_birthday_subscription_graduated(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    d = write_member(tmp_path, [msg(1, "2026-09-14T03:00:00Z", content="a")])
    (tmp_path / "memories").mkdir()
    (tmp_path / "memories" / "member_profiles.json").write_text(
        json.dumps(
            {
                "updated_at": "2026-11-01T00:00:00+00:00",
                "birthdays": {"金村美玖": "2002-09-10"},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (tmp_path / "memories" / "subscriptions.json").write_text(
        json.dumps({"groups": {"34": {"earliest_start": "2020-03-01"}}}),
        encoding="utf-8",
    )
    (tmp_path / "sync_metadata.json").write_text(
        json.dumps({"server_groups": {"34": {"state": "closed"}}}), encoding="utf-8"
    )
    idx = await mi.get_member_index(tmp_path, d)
    assert idx.birthday == "2002-09-10"
    assert idx.subscription_start == "2020-03-01"
    assert idx.graduated is True
    assert idx.name_norm == "金村美玖" and idx.member_id == "58"
    assert idx.member_dir == "messages/34 金村 美玖/58 金村 美玖"


@pytest.mark.asyncio
async def test_profile_change_invalidates_cache(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    d = write_member(tmp_path, [msg(1, "2026-09-14T03:00:00Z", content="a")])
    first = await mi.get_member_index(tmp_path, d)
    assert first.graduated is False and first.birthday is None
    (tmp_path / "sync_metadata.json").write_text(
        json.dumps({"server_groups": {"34": {"state": "closed"}}}), encoding="utf-8"
    )
    second = await mi.get_member_index(tmp_path, d)
    assert second.graduated is True and second.data_hash != first.data_hash


@pytest.mark.asyncio
async def test_importance_special_repeated_and_scores(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    rows = [msg(i, f"2026-03-0{i}T03:00:00Z", content="了解です") for i in range(1, 4)]
    rows.append(msg(10, "2026-12-31T03:00:00Z", content="今年もありがとう"))
    rows.append(msg(11, "2026-06-01T10:00:00Z", content="ふつう"))
    rows.append(msg(12, "2026-06-01T10:01:00Z", "picture"))
    d = write_member(tmp_path, rows)
    idx = await mi.get_member_index(tmp_path, d)
    f = facts_of(tmp_path, d)
    assert f[1].importance == 4 - 300  # repeated 3x in the same year
    assert f[10].importance == 8 + 100 + 150  # emotion word + 12/31 special
    assert f[12].caption_id == 11 and f[12].photo_score >= 150
    assert idx.counts_by_year[2026]["text"] == 5
    assert idx.first_ts["picture"] == "2026-06-01T10:01:00Z"


@pytest.mark.asyncio
async def test_favorited_read_from_messages(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    fav = msg(1, "2026-09-14T03:00:00Z", content="a")
    fav["is_favorite"] = True
    d = write_member(tmp_path, [fav, msg(2, "2026-09-14T03:01:00Z", content="a")])
    await mi.get_member_index(tmp_path, d)
    f = facts_of(tmp_path, d)
    assert f[1].importance == f[2].importance + 300


@pytest.mark.asyncio
async def test_build_all_counts_only_stale(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    d = write_member(tmp_path, [msg(1, "2026-09-14T03:00:00Z", content="a")])
    assert await mi.build_all(tmp_path) == 1
    assert await mi.build_all(tmp_path) == 0
    (d / "messages.json").write_text(
        json.dumps({"messages": [msg(1, "2026-09-14T03:00:00Z", content="abc")]}),
        encoding="utf-8",
    )
    assert await mi.build_all(tmp_path) == 1


@pytest.mark.asyncio
async def test_connections_are_closed(tmp_path, monkeypatch):
    import sqlite3

    opened: list = []
    real_connect = sqlite3.connect

    class Tracked:
        def __init__(self, conn):
            self.conn = conn
            self.closed = False

        def close(self):
            self.closed = True
            self.conn.close()

        def __getattr__(self, name):
            return getattr(self.conn, name)

        def __enter__(self):
            return self.conn.__enter__()

        def __exit__(self, *a):
            return self.conn.__exit__(*a)

    def tracking(*a, **kw):
        t = Tracked(real_connect(*a, **kw))
        opened.append(t)
        return t

    monkeypatch.setattr(mi.sqlite3, "connect", tracking)
    mi.set_db_path(tmp_path / "idx.db")
    d = write_member(tmp_path, [msg(1, "2026-09-14T03:00:00Z", content="a")])
    await mi.get_member_index(tmp_path, d)  # miss: read + write
    await mi.get_member_index(tmp_path, d)  # hit: read
    assert len(opened) == 3 and all(t.closed for t in opened)


@pytest.mark.asyncio
async def test_media_own_text_is_its_caption(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    d = write_member(
        tmp_path,
        [
            msg(1, "2026-06-01T03:00:00Z", content="近くのテキスト"),
            # Own caption wins over the text 1 min away.
            msg(2, "2026-06-01T03:01:00Z", "picture", content="%%%ちゃんおやすみ🌙"),
            # Own promo caption -> promo photo, even with a normal text nearby.
            msg(
                3, "2026-06-01T03:02:00Z", "video", content="詳細はコチラ https://x.jp"
            ),
            # No own text -> paired with the nearest text.
            msg(4, "2026-07-01T03:00:00Z", "picture"),
            msg(5, "2026-07-01T03:01:00Z", content="ふつう"),
        ],
    )
    idx = await mi.get_member_index(tmp_path, d)
    f = facts_of(tmp_path, d)
    assert f[2].caption_id == 2 and f[4].caption_id == 5
    assert 3 in idx.promo_ids and f[3].photo_score is None and f[3].caption_id is None
    # Captions are her words: importance, nickname and greetings count them.
    caption = "%%%ちゃんおやすみ🌙"
    assert f[2].importance == len(caption) + 80
    assert idx.nickname_count == 1 and idx.first_nickname_id == 2
    assert idx.greeting_counts == {"oyasumi": 1}
    assert f[2].photo_score == 150 + 80  # caption + caption bonus word
    assert f[3].importance is None


@pytest.mark.asyncio
async def test_greeting_counts_are_multi_label(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    d = write_member(
        tmp_path,
        [
            msg(1, "2026-06-01T12:00:00Z", content="おやすみ、%%%大好きだよ"),
            msg(2, "2026-06-02T12:00:00Z", content="好きな食べ物はカレー"),
        ],
    )
    idx = await mi.get_member_index(tmp_path, d)
    assert idx.greeting_counts == {"oyasumi": 1, "daisuki": 1}


@pytest.mark.asyncio
async def test_repeat_penalty_counts_sentences(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    rows = [
        msg(1, "2026-03-01T12:00:00Z", content="今日もお疲れさま！おやすみ"),
        msg(2, "2026-03-02T12:00:00Z", content="雨だった。おやすみ"),
        msg(3, "2026-03-03T12:00:00Z", content="ライブ楽しかった！おやすみ"),
        msg(4, "2026-03-04T12:00:00Z", content="今日もお疲れさま！"),
        msg(5, "2026-03-05T12:00:00Z", content="今日もお疲れさま"),
        # Same sentence in another year does not count toward 2026.
        msg(6, "2027-03-05T12:00:00Z", content="今日もお疲れさま"),
    ]
    d = write_member(tmp_path, rows)
    await mi.get_member_index(tmp_path, d)
    # Every message differs, but its sentences repeat >= 3 times in 2026.
    f = facts_of(tmp_path, d)
    assert f[1].importance == len("今日もお疲れさま！おやすみ") - 300
    assert f[5].importance == len("今日もお疲れさま") - 300
    assert f[6].importance == len("今日もお疲れさま")


def test_index_version_tracks_lexicon(monkeypatch):
    before = mi._lexicon_fingerprint()
    assert mi.INDEX_VERSION.endswith(before)
    monkeypatch.setattr(mi.lexicon, "EMOTION_WORDS", ("ありがとう",))
    assert mi._lexicon_fingerprint() != before


def _room(service_dir, group, member, msgs=None):
    d = service_dir / "messages" / group / member
    d.mkdir(parents=True)
    (d / "messages.json").write_text(
        json.dumps({"member": {}, "messages": msgs or []}, ensure_ascii=False),
        encoding="utf-8",
    )
    return d


def _hinata(tmp_path):
    svc = tmp_path / "日向坂46"
    solo = _room(svc, "34 金村 美玖", "58 金村 美玖")
    old_room = _room(svc, "40 松田 好花", "64 松田 好花")
    new_room = _room(svc, "94 松田 好花", "64 松田 好花")
    grad = _room(svc, "20 潮 紗理菜", "22 潮 紗理菜")
    communal = _room(svc, "43 日向坂46", "0 日向坂46")
    in_communal = _room(svc, "43 日向坂46", "22 潮 紗理菜")
    event_a = _room(svc, "70 新参者 四期生", "120 石塚 瑶季")
    event_b = _room(svc, "70 新参者 四期生", "124 正源司 陽子")
    (svc / "sync_metadata.json").write_text(
        json.dumps(
            {
                "server_groups": {
                    g: {"state": "closed"} for g in ("40", "20", "43", "70")
                }
            }
        ),
        encoding="utf-8",
    )
    (svc / "memories").mkdir()
    (svc / "memories" / "subscriptions.json").write_text(
        json.dumps(
            {
                "groups": {
                    "40": {"earliest_start": "2021-05-01"},
                    "94": {"earliest_start": "2024-01-10"},
                }
            }
        ),
        encoding="utf-8",
    )
    return svc, dict(
        solo=solo,
        old_room=old_room,
        new_room=new_room,
        grad=grad,
        communal=communal,
        in_communal=in_communal,
        event_a=event_a,
        event_b=event_b,
    )


@pytest.mark.asyncio
async def test_graduated_only_for_closed_solo_rooms(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    svc, r = _hinata(tmp_path)
    got = {k: await mi.get_member_index(svc, d) for k, d in r.items()}
    assert got["grad"].graduated is True and got["grad"].is_group_chat is False
    # Closed old room, but an open 1:1 room holds the same name.
    assert got["old_room"].graduated is False
    assert got["new_room"].graduated is False
    assert got["solo"].graduated is False
    # Closed communal / event rooms never mark anyone graduated.
    for k in ("communal", "in_communal", "event_a", "event_b"):
        assert got[k].is_group_chat is True and got[k].graduated is False, k
    assert got["communal"].group_id == "43" and got["event_a"].group_id == "70"


@pytest.mark.asyncio
async def test_list_members_merges_rooms_and_skips_communal(tmp_path):
    svc, _ = _hinata(tmp_path)
    members = await mi.list_members(svc)
    by_name = {m.name_norm: m for m in members}
    assert set(by_name) == {"金村美玖", "松田好花", "潮紗理菜"}  # no 日向坂46 / 4期生
    matsuda = by_name["松田好花"]
    assert matsuda.member_dirs == (
        "messages/40 松田 好花/64 松田 好花",
        "messages/94 松田 好花/64 松田 好花",
    )
    assert matsuda.group_ids == ("40", "94") and matsuda.member_ids == ("64", "64")
    assert matsuda.subscription_start == "2021-05-01"  # earliest across rooms
    assert matsuda.graduated is False and matsuda.name == "松田 好花"
    sari = by_name["潮紗理菜"]
    assert sari.graduated is True
    assert sari.member_dirs == ("messages/20 潮 紗理菜/22 潮 紗理菜",)


@pytest.mark.asyncio
async def test_list_members_empty_service(tmp_path):
    assert await mi.list_members(tmp_path) == []


@pytest.mark.asyncio
async def test_build_all_prunes_removed_rooms(tmp_path):
    import shutil
    import sqlite3

    mi.set_db_path(tmp_path / "idx.db")
    svc, rooms = _hinata(tmp_path)
    for d in rooms.values():
        (d / "messages.json").write_text(
            json.dumps({"messages": [msg(1, "2026-09-14T03:00:00Z", content="a")]}),
            encoding="utf-8",
        )
    assert await mi.build_all(svc) == len(rooms)
    shutil.rmtree(rooms["grad"])

    def counts():
        with sqlite3.connect(tmp_path / "idx.db") as c:
            return (
                c.execute("SELECT COUNT(*) FROM member_index").fetchone()[0],
                c.execute("SELECT COUNT(*) FROM message_facts").fetchone()[0],
            )

    assert counts() == (len(rooms), len(rooms))
    await mi.build_all(svc)
    assert counts() == (len(rooms) - 1, len(rooms) - 1)


@pytest.mark.asyncio
async def test_build_all_does_not_prune_when_messages_dir_missing(tmp_path):
    import shutil

    mi.set_db_path(tmp_path / "idx.db")
    d = write_member(tmp_path, [msg(1, "2026-09-14T03:00:00Z", content="a")])
    await mi.build_all(tmp_path)
    moved = tmp_path / "moved"
    shutil.move(str(tmp_path / "messages"), moved)
    await mi.build_all(tmp_path)  # drive "unplugged"
    shutil.move(str(moved), tmp_path / "messages")
    assert await mi.build_all(tmp_path) == 0  # cache row survived
    assert d.exists()


@pytest.mark.asyncio
async def test_build_all_stops_on_shutdown(tmp_path):
    from structlog.testing import capture_logs

    from backend.services import shutdown_state

    mi.set_db_path(tmp_path / "idx.db")
    svc, _ = _hinata(tmp_path)
    shutdown_state.begin_shutdown()
    try:
        with capture_logs() as logs:
            assert await mi.build_all(svc) == 0
    finally:
        shutdown_state.reset_for_tests()
    (ev,) = [e for e in logs if e["event"] == "memory_index_build_all_stopped"]
    assert ev["reason"] == "shutdown" and ev["remaining"] == 8


@pytest.mark.asyncio
async def test_build_all_logs_birthday_match(tmp_path):
    from structlog.testing import capture_logs

    mi.set_db_path(tmp_path / "idx.db")
    svc, _ = _hinata(tmp_path)
    (svc / "memories" / "member_profiles.json").write_text(
        json.dumps({"birthdays": {"金村美玖": "2002-09-10"}}, ensure_ascii=False),
        encoding="utf-8",
    )
    with capture_logs() as logs:
        await mi.build_all(svc)
    (ev,) = [e for e in logs if e["event"] == "memory_index_birthdays"]
    assert ev["matched"] == 1 and ev["members"] == 3  # 1:1 people only
    assert "金村" not in str(logs)


@pytest.mark.asyncio
async def test_get_member_index_single_flight(tmp_path, monkeypatch):
    import asyncio

    mi.set_db_path(tmp_path / "idx.db")
    d = write_member(tmp_path, [msg(1, "2026-09-14T03:00:00Z", content="a")])
    builds = 0
    real = mi._build

    def counting(*a, **kw):
        nonlocal builds
        builds += 1
        return real(*a, **kw)

    monkeypatch.setattr(mi, "_build", counting)
    results = await asyncio.gather(
        *(mi.get_member_index(tmp_path, d) for _ in range(5))
    )
    assert builds == 1 and len({r.data_hash for r in results}) == 1


@pytest.mark.asyncio
async def test_single_member_reads_reuse_recent_room_scan(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    d = write_member(tmp_path, [msg(1, "2026-09-14T03:00:00Z", content="a")])
    scans = []
    real = mi._scan_rooms

    def counting(sdir, *, fresh=True):
        scans.append(fresh)
        return real(sdir, fresh=fresh)

    monkeypatch.setattr(mi, "_scan_rooms", counting)
    mi._rooms_cache.clear()
    await mi.get_member_index(tmp_path, d)
    await mi.get_member_index(tmp_path, d)
    assert scans == [False, False] and str(tmp_path) in mi._rooms_cache
    await mi.build_all(tmp_path)
    assert scans[-1] is True  # build_all never trusts the cached scan
    # Expired entries are rescanned.
    mi._rooms_cache[str(tmp_path)] = (0.0, ())
    idx = await mi.get_member_index(tmp_path, d)
    assert idx.member_id == "58"


@pytest.mark.asyncio
async def test_official_account_folder_does_not_make_room_a_group(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    svc = tmp_path / "櫻坂46"
    own = _room(svc, "79 中川 智尋", "134 中川 智尋")
    official = _room(svc, "79 中川 智尋", "33 櫻坂46")
    a = await mi.get_member_index(svc, own)
    b = await mi.get_member_index(svc, official)
    assert a.is_group_chat is False and a.member_id == "134"
    assert b.is_group_chat is True  # official account, never a member
    (m,) = await mi.list_members(svc)
    assert m.name_norm == "中川智尋"
    assert m.member_dirs == ("messages/79 中川 智尋/134 中川 智尋",)


def test_real_group_room_still_counts_members(tmp_path):
    svc = tmp_path / "日向坂46"
    _room(svc, "70 新参者 四期生", "120 石塚 瑶季")
    _room(svc, "70 新参者 四期生", "124 正源司 陽子")
    _room(svc, "70 新参者 四期生", "43 日向坂46")  # official: not counted
    inputs = mi._load_inputs(svc)
    assert inputs.room_sizes == {"70": 2}


@pytest.mark.asyncio
async def test_old_secondary_indexes_are_dropped(tmp_path):
    import sqlite3

    db = tmp_path / "idx.db"
    mi.set_db_path(db)
    with sqlite3.connect(db) as c:
        c.executescript(mi._SCHEMA)
        c.execute(
            "CREATE INDEX message_facts_by_date ON message_facts(service_dir, jst_date)"
        )
        c.execute(
            "CREATE INDEX message_facts_by_type ON message_facts(service_dir, type)"
        )
    mi._connect().close()
    with sqlite3.connect(db) as c:
        names = {r[0] for r in c.execute("SELECT name FROM sqlite_master")}
    assert not names & {"message_facts_by_date", "message_facts_by_type"}


@pytest.mark.asyncio
async def test_failed_cache_write_marks_index_stale(tmp_path, monkeypatch):
    mi.set_db_path(tmp_path / "idx.db")
    d = write_member(tmp_path, [msg(1, "2026-09-14T03:00:00Z", content="a")])
    monkeypatch.setattr(mi, "_cache_put", lambda *a, **k: False)
    idx = await mi.get_member_index(tmp_path, d)
    assert idx.cache_stale is True and idx.data_hash
    assert "cache_stale" not in idx.to_json()


def _rewrite(d, msgs):
    (d / "messages.json").write_text(
        json.dumps(
            {"member": {"id": "58", "name": "金村 美玖"}, "messages": msgs},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


@pytest.mark.asyncio
async def test_reads_serve_stored_row_while_sync_writes(tmp_path, monkeypatch):
    """D18: each sync write changes the hash; reads in that window must not
    rebuild the room every time. build_all after the sync rebuilds it once."""
    mi.set_db_path(tmp_path / "idx.db")
    d = write_member(tmp_path, [msg(1, "2026-09-14T03:00:00Z", content="a")])
    first = await mi.get_member_index(tmp_path, d)
    builds = 0
    real = mi._build

    def counting(*a, **kw):
        nonlocal builds
        builds += 1
        return real(*a, **kw)

    monkeypatch.setattr(mi, "_build", counting)
    from structlog.testing import capture_logs

    with mi.sync_writing(tmp_path), capture_logs() as logs:
        for n in range(2, 5):  # three sync writes, a read after each
            _rewrite(
                d,
                [msg(i, f"2026-09-{13 + i}T03:00:00Z", content="b") for i in range(n)],
            )
            served = await mi.get_member_index(tmp_path, d)
            assert served.data_hash == first.data_hash
        assert builds == 0
        assert [
            e["reason"] for e in logs if e["event"] == "memory_index_stale_served"
        ] == ["sync_writing"] * 3
        assert await mi.build_all(tmp_path) == 1  # build_all never serves stale
    assert builds == 1 and not mi.is_sync_writing(tmp_path)
    fresh = await mi.get_member_index(tmp_path, d)
    assert fresh.data_hash != first.data_hash and builds == 1


@pytest.mark.asyncio
async def test_room_without_row_is_built_even_while_sync_writes(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    d = write_member(tmp_path, [msg(1, "2026-09-14T03:00:00Z", content="a")])
    with mi.sync_writing(tmp_path):
        idx = await mi.get_member_index(tmp_path, d)
    assert sum(idx.hour_hist) == 1


@pytest.mark.asyncio
async def test_stale_rows_only_served_for_the_written_service(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    d = write_member(tmp_path, [msg(1, "2026-09-14T03:00:00Z", content="a")])
    first = await mi.get_member_index(tmp_path, d)
    _rewrite(d, [msg(1, "2026-09-14T03:00:00Z"), msg(2, "2026-09-15T03:00:00Z")])
    with mi.sync_writing(tmp_path / "other"):
        again = await mi.get_member_index(tmp_path, d)
    assert again.data_hash != first.data_hash


def test_sync_writing_nests():
    from pathlib import Path

    p = Path("svc")
    with mi.sync_writing(p):
        with mi.sync_writing(p):
            pass
        assert mi.is_sync_writing(p)
    assert not mi.is_sync_writing(p)


def test_fact_reads_take_the_process_wide_row_lock(tmp_path):
    """D4: concurrent row reads in worker threads hit CPython's GIL convoy
    (sqlite3 drops the GIL per row); they must run one at a time."""
    import asyncio
    import threading

    from backend.services.memories import facts as mf

    mi.set_db_path(tmp_path / "idx.db")
    d = write_member(tmp_path, [msg(1, "2026-09-14T03:00:00Z", content="a")])
    asyncio.run(mi.get_member_index(tmp_path, d))
    done = threading.Event()

    def read():
        mf.facts_in_range(tmp_path, d)
        done.set()

    with mi.row_reads():
        t = threading.Thread(target=read)
        t.start()
        assert not done.wait(0.2)  # blocked behind the held lock
    t.join(5)
    assert done.is_set()


# --- M4: media rows for the thumbnail pre-generation worker ------------------------------


def _media_msg(i, ts, type_, media_file, fav=False):
    m = msg(i, ts, type_)
    m["media_file"] = media_file
    m["is_favorite"] = fav
    return m


@pytest.mark.asyncio
async def test_media_rows_are_media_with_files_starred_then_newest(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    d = write_member(
        tmp_path,
        [
            _media_msg(1, "2026-09-14T03:00:00Z", "picture", "a\\picture\\1.jpg"),
            _media_msg(2, "2026-09-15T03:00:00Z", "video", "a/video/2.mp4"),
            _media_msg(3, "2026-09-13T03:00:00Z", "picture", "a/picture/3.jpg", True),
            msg(4, "2026-09-16T03:00:00Z", "picture"),  # no media file
            _media_msg(5, "2026-09-17T03:00:00Z", "voice", "a/voice/5.m4a"),
        ],
    )
    await mi.get_member_index(tmp_path, d)
    rows = mi.media_rows(tmp_path)
    assert [(r.media_file, r.type, r.favorited) for r in rows] == [
        ("a/picture/3.jpg", "picture", True),
        ("a/video/2.mp4", "video", False),
        ("a\\picture\\1.jpg", "picture", False),
    ]
    assert rows[0].member_dir == "messages/34 金村 美玖/58 金村 美玖"
    assert rows[1].ts_utc.startswith("2026-09-15")
    assert mi.media_rows(tmp_path / "other") == []


def test_media_rows_never_raise(tmp_path, monkeypatch):
    import sqlite3

    from structlog.testing import capture_logs

    def boom():
        raise sqlite3.OperationalError("locked")

    monkeypatch.setattr(mi, "_connect", boom)
    with capture_logs() as logs:
        assert mi.media_rows(tmp_path) == []
    assert logs[-1] == {
        "event": "memory_index_media_rows_failed",
        "error_type": "OperationalError",
        "log_level": "warning",
    }


def test_any_refresh_pending(tmp_path):
    assert mi.any_refresh_pending() is False
    with mi.sync_writing(tmp_path):
        assert mi.any_refresh_pending() is True
    mi.begin_refresh(tmp_path)
    assert mi.any_refresh_pending() is True
    mi.end_refresh(tmp_path)
    assert mi.any_refresh_pending() is False


# --- data_hashes: one cheap freshness check per request (D-M3) ------------------------


def _second_room(root, msgs):
    d = root / "messages" / "35 小坂 菜緒" / "60 小坂 菜緒"
    d.mkdir(parents=True)
    (d / "messages.json").write_text(
        json.dumps({"member": {}, "messages": msgs}, ensure_ascii=False),
        encoding="utf-8",
    )
    return d


@pytest.mark.asyncio
async def test_data_hashes_equal_the_member_index_hashes_with_one_check(
    tmp_path, monkeypatch
):
    from structlog.testing import capture_logs

    mi.set_db_path(tmp_path / "idx.db")
    a = write_member(tmp_path, [msg(1, "2026-09-14T03:00:00Z", "picture")])
    b = _second_room(tmp_path, [msg(2, "2026-09-15T03:00:00Z", "picture")])
    await mi.build_all(tmp_path)
    expected = [
        (await mi.get_member_index(tmp_path, a)).data_hash,
        (await mi.get_member_index(tmp_path, b)).data_hash,
    ]
    payload_reads: list[int] = []
    real = mi._cache_get

    def counting(*args, **kwargs):
        payload_reads.append(1)
        return real(*args, **kwargs)

    monkeypatch.setattr(mi, "_cache_get", counting)
    with capture_logs() as logs:
        got = await mi.data_hashes(tmp_path, [a, b])
    assert got == expected
    assert payload_reads == []  # a warm hit reads no index payload
    assert [e for e in logs if e["event"] == "memory_index_hit"] == []
    (summary,) = [e for e in logs if e["event"] == "memory_index_hashes"]
    assert (summary["rooms"], summary["fresh"], summary["fallback"]) == (2, 2, 0)


@pytest.mark.asyncio
async def test_data_hashes_see_new_data_and_build_unbuilt_rooms(tmp_path):
    from structlog.testing import capture_logs

    mi.set_db_path(tmp_path / "idx.db")
    a = write_member(tmp_path, [msg(1, "2026-09-14T03:00:00Z", "picture")])
    (first,) = await mi.data_hashes(tmp_path, [a])  # never built: built now
    assert first == (await mi.get_member_index(tmp_path, a)).data_hash
    path = a / "messages.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["messages"].append(msg(2, "2026-09-16T03:00:00Z", "picture"))
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    with capture_logs() as logs:
        (second,) = await mi.data_hashes(tmp_path, [a])  # a sync wrote it
    assert second != first
    assert second == (await mi.get_member_index(tmp_path, a)).data_hash
    assert 2 in facts_of(tmp_path, a)  # rebuilt: the new photo is indexed
    (summary,) = [e for e in logs if e["event"] == "memory_index_hashes"]
    assert (summary["fresh"], summary["fallback"]) == (0, 1)


@pytest.mark.asyncio
async def test_data_hashes_serve_the_stored_row_while_a_sync_writes(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    a = write_member(tmp_path, [msg(1, "2026-09-14T03:00:00Z", "picture")])
    (stored,) = await mi.data_hashes(tmp_path, [a])
    path = a / "messages.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["messages"].append(msg(2, "2026-09-16T03:00:00Z", "picture"))
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    with mi.sync_writing(tmp_path):
        assert await mi.data_hashes(tmp_path, [a]) == [stored]  # as get_member_index
    assert await mi.data_hashes(tmp_path, [a]) != [stored]


@pytest.mark.asyncio
async def test_data_hashes_fall_back_per_room_on_errors(tmp_path, monkeypatch):
    from structlog.testing import capture_logs

    mi.set_db_path(tmp_path / "idx.db")
    a = write_member(tmp_path, [msg(1, "2026-09-14T03:00:00Z", "picture")])
    gone = tmp_path / "messages" / "36 文字" / "61 文字"  # no messages.json
    await mi.build_all(tmp_path)
    expected = (await mi.get_member_index(tmp_path, a)).data_hash
    assert await mi.data_hashes(tmp_path, []) == []

    def broken():
        raise mi.sqlite3.OperationalError("locked")

    monkeypatch.setattr(mi, "_connect", broken)
    with capture_logs() as logs:
        fresh = mi._fresh_hashes_sync(tmp_path, [a, gone])
    assert fresh == [None, None]
    (failed,) = [e for e in logs if e["event"] == "memory_index_hashes_failed"]
    assert failed["error_type"] == "OperationalError"
    monkeypatch.undo()
    mi.set_db_path(tmp_path / "idx.db")
    assert mi._fresh_hashes_sync(tmp_path, [a, gone]) == [expected, None]
