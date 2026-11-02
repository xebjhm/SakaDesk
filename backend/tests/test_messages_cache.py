import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest

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
    assert s.last_raw_id is None and s.total_messages == 7 and s.member == {}


@pytest.mark.parametrize(
    "ids,last,revealed,expected",
    [
        ([1, 2, 3, 4], 2, set(), 2),
        ([1, 2, 3, 4], 2, {4}, 1),
        ([1, 2, 3, 4], 2, {1, "x"}, 2),
        ([1, 3, 3, 4], 2, {3}, 1),  # duplicates counted like the original loop
        ([], 0, set(), 0),
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
