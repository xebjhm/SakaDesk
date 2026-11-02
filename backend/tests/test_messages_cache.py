import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest

from backend.api.content import _collect_groups, _compute_unread_counts
from backend.services import messages_cache as mc


def _write(p: Path, messages, member=None):
    with open(p, "w", encoding="utf-8") as f:
        json.dump(
            {"member": member or {"name": "テスト"}, "messages": messages},
            f,
            ensure_ascii=False,
        )


@pytest.fixture(autouse=True)
def fresh_cache(monkeypatch):
    monkeypatch.setattr(mc, "_MESSAGES_CACHE", mc.StatCache())


def test_summary_fields(tmp_path):
    p = tmp_path / "messages.json"
    _write(
        p, [{"id": 5}, {"id": 3}, {"id": 9}], member={"name": "金村", "thumbnail": "t"}
    )
    s = mc.get_messages_summary(p)
    assert s.member == {"name": "金村", "thumbnail": "t"}
    assert s.last_raw_id == 9 and s.total_messages == 3
    assert s.sorted_ids == (3, 5, 9) and s.id_set == frozenset({3, 5, 9})


def test_summary_empty_and_explicit_total(tmp_path):
    p = tmp_path / "messages.json"
    with open(p, "w", encoding="utf-8") as f:
        json.dump({"messages": [], "total_messages": 7}, f)
    s = mc.get_messages_summary(p)
    assert s.last_raw_id is mc.NO_MESSAGES and s.total_messages == 7 and s.member == {}


@pytest.mark.parametrize(
    "ids,last,revealed,expected",
    [
        ([1, 2, 3, 4], 2, set(), 2),
        ([1, 2, 3, 4], 2, {4}, 1),
        ([1, 2, 3, 4], 2, {1, "x"}, 2),
        ([1, 3, 3, 4], 2, {3}, 1),  # duplicates counted like the original loop
        ([], 0, set(), 0),
        ([1, 2], 0, {True}, 1),  # set() collapses True/1 like hash/eq membership
        ([1, 3], 0, {3.0}, 1),  # 3.0 == 3
        ([], "5", {1}, 0),  # nothing to compare: must not raise
        (["a", "c"], "b", {"c"}, 0),  # string ids
        ([1, 2, 2, 3], 1, {2, 99}, 1),
    ],
)
def test_unread_count_matches_original_loop(tmp_path, ids, last, revealed, expected):
    p = tmp_path / "messages.json"
    _write(p, [{"id": i} for i in ids])
    original = sum(1 for i in ids if i > last and i not in revealed)
    assert (
        mc.get_messages_summary(p).unread_count(last, revealed) == original == expected
    )


def test_cache_hit_does_not_reparse(tmp_path):
    p = tmp_path / "messages.json"
    _write(p, [{"id": 1}])
    first = mc.get_messages_summary(p)
    with patch(
        "backend.services.messages_cache.json.load",
        side_effect=AssertionError("reparsed"),
    ):
        assert mc.get_messages_summary(p) is first


def test_invalidation_same_size_rewrite_via_replace(tmp_path):
    p = tmp_path / "messages.json"
    _write(p, [{"id": 1}])
    assert mc.get_messages_summary(p).sorted_ids == (1,)
    tmp = tmp_path / "x.tmp"
    _write(tmp, [{"id": 2}])  # same byte size
    os.replace(tmp, p)
    assert mc.get_messages_summary(p).sorted_ids == (2,)


def test_invalidation_in_place_append_and_delete(tmp_path):
    p = tmp_path / "messages.json"
    _write(p, [{"id": 1}])
    mc.get_messages_summary(p)
    _write(p, [{"id": 1}, {"id": 2}])
    assert mc.get_messages_summary(p).sorted_ids == (1, 2)
    p.unlink()
    with pytest.raises(FileNotFoundError):
        mc.get_messages_summary(p)


def test_corrupt_file_raises_and_is_not_cached(tmp_path):
    p = tmp_path / "messages.json"
    p.write_text("{bad", encoding="utf-8")
    with pytest.raises(ValueError):
        mc.get_messages_summary(p)
    _write(p, [{"id": 4}])
    assert mc.get_messages_summary(p).sorted_ids == (4,)


def test_member_mapping_is_read_only(tmp_path):
    p = tmp_path / "messages.json"
    _write(p, [], member={"name": "a"})
    with pytest.raises(TypeError):
        mc.get_messages_summary(p).member["name"] = "mutated"  # type: ignore[index]


def test_cache_key_is_normalised_resolved_path(tmp_path):
    p = tmp_path / "messages.json"
    _write(p, [{"id": 1}])
    alias = tmp_path / "." / "messages.json"
    assert mc.get_messages_summary(p) is mc.get_messages_summary(alias)


# --- old-vs-new parity on malformed files -----------------------------------

SERVICE_MEMBER = "日向坂46/messages/34 金村 美玖/58 金村 美玖"
SERVICE_GROUP_PATH = "日向坂46/messages/34 金村 美玖"

RAW_FILES = {
    "ok": '{"member": {"name": "a", "thumbnail": "t", "group_thumbnail": "g"},'
    ' "messages": [{"id": 1}, {"id": 2}, {"id": 3}]}',
    "non_dict_middle": '{"member": {"thumbnail": "t", "group_thumbnail": "g"},'
    ' "messages": [{"id": 1}, 5, {"id": 3}]}',
    "null_id_among_ints": '{"member": {"thumbnail": "t", "group_thumbnail": "g"},'
    ' "messages": [{"id": 1}, {"id": null}, {"id": 3}]}',
    "null_id_last": '{"member": {"thumbnail": "t", "group_thumbnail": "g"},'
    ' "messages": [{"id": 1}, {"id": 2}, {"id": null}]}',
    "single_null_id": '{"member": {"thumbnail": "t", "group_thumbnail": "g"},'
    ' "messages": [{"id": null}]}',
    "non_dict_last": '{"member": {"thumbnail": "t", "group_thumbnail": "g"},'
    ' "messages": [{"id": 1}, 7]}',
    "str_last_id": '{"member": {"thumbnail": "t"},'
    ' "messages": [{"id": 1}, {"id": "9"}]}',
    "mixed_str_int": '{"member": {"thumbnail": "t"},'
    ' "messages": [{"id": "a"}, {"id": 2}, {"id": 3}]}',
    "all_str_ids": '{"member": {"thumbnail": "t"},'
    ' "messages": [{"id": "1"}, {"id": "2"}, {"id": "3"}]}',
    "nan_ids": '{"member": {"thumbnail": "t"},'
    ' "messages": [{"id": 3}, {"id": NaN}, {"id": 1}, {"id": 2}]}',
    "unhashable_ids": '{"member": {"thumbnail": "t"},'
    ' "messages": [{"id": [1]}, {"id": [2]}]}',
    "missing_ids": '{"member": {"thumbnail": "t"}, "messages": [{}, {"id": 2}]}',
    "member_not_dict": '{"member": 5, "messages": [{"id": 1}, {"id": 2}]}',
    "member_null": '{"member": null, "messages": [{"id": 1}]}',
    "messages_null": '{"member": {"thumbnail": "t"}, "messages": null}',
    "messages_int": '{"member": {"thumbnail": "t"}, "messages": 5}',
    "messages_zero": '{"member": {"thumbnail": "t"}, "messages": 0}',
    "messages_dict": '{"member": {"thumbnail": "t"}, "messages": {"a": 1}}',
    "messages_empty_dict": '{"member": {"thumbnail": "t"}, "messages": {}}',
    "messages_str": '{"member": {"thumbnail": "t"}, "messages": "abc"}',
    "total_str": '{"member": {"thumbnail": "t"}, "total_messages": "9",'
    ' "messages": [{"id": 4}]}',
    "total_null": '{"member": {"thumbnail": "t"}, "total_messages": null,'
    ' "messages": [{"id": 4}]}',
    "total_float": '{"member": {"thumbnail": "t"}, "total_messages": 2.5,'
    ' "messages": [{"id": 4}]}',
    "no_messages_key": '{"member": {"thumbnail": "t"}}',
    "top_level_list": "[1, 2]",
    "corrupt": "{bad",
}

READ_STATES = [
    0,
    2,
    "2",
    {"lastReadId": 1},
    {"lastReadId": 1, "revealedIds": [2, 3]},
    {"lastReadId": 0, "revealedIds": [True, 3.0]},
    {"lastReadId": "1", "revealedIds": ["2", 9]},
    {"lastReadId": None},
    {"lastReadId": 0, "revealedIds": [[1]]},
]


def _old_member_block(msg_file: Path):
    """Verbatim pre-cache ``_collect_groups`` member logic (commit 5fd8a65)."""
    meta: dict = {}
    group_thumbnail = None
    last_message_id = 0
    total_messages = 0
    try:
        with open(msg_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            m_data = data.get("member", {})
            meta["thumbnail"] = m_data.get("thumbnail")
            meta["portrait"] = m_data.get("portrait")
            meta["phone_image"] = m_data.get("phone_image")
            meta["group_thumbnail"] = m_data.get("group_thumbnail")
            if m_data.get("group_thumbnail"):
                group_thumbnail = m_data.get("group_thumbnail")
            msgs = data.get("messages", [])
            if msgs:
                last_id = msgs[-1].get("id", 0)
                if last_id > last_message_id:
                    last_message_id = last_id
            m_total = data.get("total_messages", len(msgs))
            total_messages += m_total
    except Exception:
        pass
    return meta, group_thumbnail, last_message_id, total_messages


def _old_unread_one(msg_file: Path, last_read_id, revealed_ids):
    with open(msg_file, "r", encoding="utf-8") as f:
        data = json.load(f)
        messages = data.get("messages", [])
        return sum(
            1
            for m in messages
            if m.get("id", 0) > last_read_id and m.get("id", 0) not in revealed_ids
        )


def _old_unread(output_dir: Path, path: str, state) -> int:
    """Pre-cache ``_compute_unread_counts`` for one path (commit 5fd8a65).

    Equivalent to the pre-cache logic for in-tree paths.
    """
    try:
        if isinstance(state, dict):
            last_read_id = state.get("lastReadId", 0)
            revealed_ids = set(state.get("revealedIds", []))
        else:
            last_read_id = int(state) if state else 0
            revealed_ids = set()
        safe_path = output_dir / path
        msg_file = safe_path / "messages.json"
        if msg_file.exists():
            return _old_unread_one(msg_file, last_read_id, revealed_ids)
        total = 0
        for member_dir in safe_path.iterdir():
            f = member_dir / "messages.json"
            if member_dir.is_dir() and f.exists():
                try:
                    total += _old_unread_one(f, last_read_id, revealed_ids)
                except Exception:
                    pass
        return total
    except Exception:
        return 0


@pytest.mark.parametrize("name", sorted(RAW_FILES))
def test_groups_member_block_matches_old_code(tmp_path, name):
    member_dir = tmp_path / SERVICE_MEMBER
    member_dir.mkdir(parents=True)
    msg_file = member_dir / "messages.json"
    msg_file.write_text(RAW_FILES[name], encoding="utf-8")

    meta, thumb, last_id, total = _old_member_block(msg_file)
    group = _collect_groups(tmp_path)["groups"][0]
    member = group["members"][0]
    for key, value in meta.items():
        assert member[key] == value, key
    assert set(member) - {"id", "name", "dir_name", "path"} == set(meta)
    assert group["thumbnail"] == thumb
    assert group["last_message_id"] == last_id
    assert group["total_messages"] == total
    # second call is served from the cache and must not change anything
    assert _collect_groups(tmp_path)["groups"][0] == group


@pytest.mark.parametrize("state", READ_STATES, ids=repr)
@pytest.mark.parametrize("name", sorted(RAW_FILES))
def test_unread_counts_match_old_code(tmp_path, name, state):
    member_dir = tmp_path / SERVICE_MEMBER
    member_dir.mkdir(parents=True)
    (member_dir / "messages.json").write_text(RAW_FILES[name], encoding="utf-8")
    for path in (SERVICE_MEMBER, SERVICE_GROUP_PATH):
        expected = _old_unread(tmp_path, path, state)
        for _ in range(2):  # cold, then cached
            assert _compute_unread_counts(tmp_path, {path: state}) == {path: expected}


@pytest.mark.parametrize(
    "name", ["non_dict_middle", "null_id_among_ints", "single_null_id"]
)
def test_malformed_files_still_count_zero_for_unread(tmp_path, name):
    member_dir = tmp_path / SERVICE_MEMBER
    member_dir.mkdir(parents=True)
    (member_dir / "messages.json").write_text(RAW_FILES[name], encoding="utf-8")
    assert _compute_unread_counts(tmp_path, {SERVICE_MEMBER: 0}) == {SERVICE_MEMBER: 0}


def test_stored_errors_do_not_pin_parsed_data(tmp_path):
    p = tmp_path / "messages.json"
    p.write_text(RAW_FILES["non_dict_middle"], encoding="utf-8")
    s = mc.get_messages_summary(p)
    for _ in range(3):
        with pytest.raises(AttributeError):
            s.unread_count(0, set())
    assert (
        s.ids_error is not None and s.ids_error.__traceback__ is None
    )  # stored copy stays clean


# --- has_id (favorites lookup) -----------------------------------------------


def test_has_id_orderable_and_unorderable(tmp_path):
    p = tmp_path / "messages.json"
    _write(p, [{"id": 1}, {"id": 2}])
    s = mc.get_messages_summary(p)
    assert s.has_id(2) and not s.has_id(3)
    _write(p, [{"id": 1}, {"id": None}, {"id": "x"}])  # mixed types: fallback path
    s = mc.get_messages_summary(p)
    assert s.id_set is None
    assert s.has_id(1) and not s.has_id(7)


def test_has_id_raises_stored_ids_error(tmp_path):
    p = tmp_path / "messages.json"
    _write(p, [{"id": 1}, 5])  # non-dict message: ids could not be computed
    s = mc.get_messages_summary(p)
    assert s.ids_error is not None
    with pytest.raises(AttributeError):
        s.has_id(1)
