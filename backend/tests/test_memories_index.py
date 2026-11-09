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
    assert idx.captions[3] == 2 and 6 in idx.promo_ids
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
    assert idx.importance[1] == 4 - 300  # repeated 3x in the same year
    assert idx.importance[10] == 8 + 100 + 150  # emotion word + 12/31 special
    assert idx.captions[12] == 11 and idx.photo_scores[12] >= 150
    assert idx.counts_by_year[2026]["text"] == 5
    assert idx.first_ts["picture"] == "2026-06-01T10:01:00Z"


@pytest.mark.asyncio
async def test_favorited_read_from_messages(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    fav = msg(1, "2026-09-14T03:00:00Z", content="a")
    fav["is_favorite"] = True
    d = write_member(tmp_path, [fav, msg(2, "2026-09-14T03:01:00Z", content="a")])
    idx = await mi.get_member_index(tmp_path, d)
    assert idx.importance[1] == idx.importance[2] + 300


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
    assert idx.captions[2] == 2 and idx.captions[4] == 5
    assert 3 in idx.promo_ids and 3 not in idx.photo_scores and 3 not in idx.captions
    # Captions are her words: importance, nickname and greetings count them.
    caption = "%%%ちゃんおやすみ🌙"
    assert idx.importance[2] == len(caption) + 80
    assert idx.nickname_count == 1 and idx.first_nickname_id == 2
    assert idx.greeting_counts == {"oyasumi": 1}
    assert idx.photo_scores[2] == 150 + 80  # caption + caption bonus word
    assert 3 not in idx.importance


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
    idx = await mi.get_member_index(tmp_path, d)
    # Every message differs, but its sentences repeat >= 3 times in 2026.
    assert idx.importance[1] == len("今日もお疲れさま！おやすみ") - 300
    assert idx.importance[5] == len("今日もお疲れさま") - 300
    assert idx.importance[6] == len("今日もお疲れさま")


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
