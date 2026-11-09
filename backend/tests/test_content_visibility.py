"""Canceled/withdrawn messages are hidden from the served message list, even
though their state stays recorded in messages.json on disk."""

import pytest

from backend.services.message_visibility import is_hidden_message, visible_messages


def test_visible_messages_hides_non_published():
    msgs = [
        {"id": 1, "type": "text"},  # no state -> published -> visible
        {"id": 2, "type": "video", "state": "published"},  # visible
        {"id": 3, "type": "video", "state": "canceled"},  # withdrawn -> hidden
        {"id": 4, "type": "picture", "state": "canceled"},  # withdrawn -> hidden
    ]
    assert [m["id"] for m in visible_messages(msgs)] == [1, 2]


def test_visible_messages_empty():
    assert visible_messages([]) == []


@pytest.mark.parametrize(
    ("message", "hidden"),
    [
        ({"id": 1}, False),
        ({"id": 1, "state": None}, False),
        ({"id": 1, "state": ""}, False),
        ({"id": 1, "state": "published"}, False),
        ({"id": 1, "state": "canceled"}, True),
        ({"id": 1, "state": "deleted"}, True),
    ],
)
def test_is_hidden_message(message, hidden):
    assert is_hidden_message(message) is hidden


def test_visible_messages_rejects_non_dict_rows():
    """Unchanged from the old content.py helper: a malformed row raises, so
    the endpoint's per-file error handling skips the file as before."""
    with pytest.raises(AttributeError):
        visible_messages([{"id": 1}, 5])
