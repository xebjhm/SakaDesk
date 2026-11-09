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
