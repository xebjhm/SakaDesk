"""Tests for the shared chat-kind rule."""

import pytest

from backend.services.chat_kind import GROUP_CHAT_IDS, is_group_chat


def test_multiple_members_is_group_chat():
    assert is_group_chat("hinatazaka46", "9001", 2) is True


def test_single_member_in_group_chat_ids_room_is_group_chat():
    assert "43" in GROUP_CHAT_IDS["hinatazaka46"]
    assert is_group_chat("hinatazaka46", "43", 1) is True


def test_one_to_one_chat_is_not_group_chat():
    assert is_group_chat("hinatazaka46", "34", 1) is False


def test_int_group_id_is_normalised():
    assert is_group_chat("sakurazaka46", 33, 1) is True


def test_group_ids_are_scoped_per_service():
    # "45" is a room only for nogizaka46.
    assert is_group_chat("nogizaka46", "45", 1) is True
    assert is_group_chat("hinatazaka46", "45", 1) is False


def test_unknown_service_falls_back_to_member_count():
    assert is_group_chat("unknown", "43", 1) is False
    assert is_group_chat("unknown", "43", 3) is True


def test_content_api_reuses_shared_constant():
    from backend.api import content

    assert content.GROUP_CHAT_IDS is GROUP_CHAT_IDS


@pytest.mark.parametrize("service", ["hinatazaka46", "sakurazaka46", "nogizaka46"])
def test_every_listed_room_is_group_chat(service):
    for gid in GROUP_CHAT_IDS[service]:
        assert is_group_chat(service, gid, 1) is True


# ------------------------------------------------------------ member folders


def _dir(root, name, messages=True):
    d = root / name
    d.mkdir()
    if messages:
        (d / "messages.json").write_text("{}", encoding="utf-8")
    return d


def test_is_member_dir_needs_id_prefix_and_messages(tmp_path):
    from backend.services.chat_kind import is_member_dir

    assert is_member_dir(_dir(tmp_path, "58 金村 美玖")) is True
    assert is_member_dir(_dir(tmp_path, "金村 美玖")) is False  # no id prefix
    assert is_member_dir(_dir(tmp_path, "59")) is False  # id without a name
    assert is_member_dir(_dir(tmp_path, "60 加藤", messages=False)) is False
    f = tmp_path / "61 file"
    f.write_text("x", encoding="utf-8")
    assert is_member_dir(f) is False


def test_sync_and_content_count_member_dirs_the_same_way(tmp_path):
    """The planner's member count and the content API can never disagree."""
    from backend.api.content import get_member_dirs
    from backend.services.sync_service import _count_member_dirs

    _dir(tmp_path, "58 金村 美玖")
    _dir(tmp_path, "59 小坂 菜緒")
    _dir(tmp_path, "profile_images")  # has messages.json but no id prefix
    _dir(tmp_path, "60 加藤", messages=False)
    assert _count_member_dirs(tmp_path) == len(get_member_dirs(tmp_path)) == 2


def test_count_member_dirs_missing_group_is_zero(tmp_path):
    from backend.services.sync_service import _count_member_dirs

    assert _count_member_dirs(tmp_path / "gone") == 0
