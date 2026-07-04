"""Canceled/withdrawn messages are hidden from the served message list, even
though their state stays recorded in messages.json on disk."""

from backend.api.content import _visible_messages


def test_visible_messages_hides_non_published():
    msgs = [
        {"id": 1, "type": "text"},  # no state -> published -> visible
        {"id": 2, "type": "video", "state": "published"},  # visible
        {"id": 3, "type": "video", "state": "canceled"},  # withdrawn -> hidden
        {"id": 4, "type": "picture", "state": "canceled"},  # withdrawn -> hidden
    ]
    assert [m["id"] for m in _visible_messages(msgs)] == [1, 2]


def test_visible_messages_empty():
    assert _visible_messages([]) == []
