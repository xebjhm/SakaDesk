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
