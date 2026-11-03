"""Which archived chat messages the app shows.

A message whose ``state`` is set to anything but ``"published"`` (e.g.
``"canceled"``: the member withdrew the post, which strips its media) stays in
``messages.json`` on disk but is hidden everywhere a user sees messages: the
message lists, unread counts, sidebar totals and search. Every such place uses
:func:`is_hidden_message` so they always agree.
"""

from __future__ import annotations

from typing import Any


def is_hidden_message(message: dict[str, Any]) -> bool:
    """True if ``message`` must not be shown (its ``state`` is set and is not
    ``"published"``). Raises ``AttributeError`` if ``message`` is not a dict."""
    state = message.get("state")
    return bool(state) and state != "published"


def visible_messages(messages: list[Any]) -> list[Any]:
    """The messages of ``messages`` that are shown, in their original order.

    Raises like :func:`is_hidden_message` on a row that is not a dict.
    """
    return [m for m in messages if not is_hidden_message(m)]
