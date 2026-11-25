"""In-memory record of what the user is looking at.

The frontend reports the open chat and whether the window is focused
(``POST /api/ui-state``). The notification planner reads it to skip the toast
for a chat the user is already viewing. Nothing is persisted; until the
frontend reports, the state is "not focused" so toasts are sent.

Separately, the frontend reports whether the Memories feature is open and the
window focused (``POST /api/ui-state/memories``); the Memories notification
scheduler reads :func:`memories_in_view` to hold its toasts while the fan is
already looking at Memories. The flag is kept apart from the chat
:class:`UiState`, so neither report overwrites the other. Nothing is
persisted; until the frontend reports, Memories counts as not in view.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass

from backend.services.notification_planner import UiState


@dataclass(frozen=True)
class MemoriesView:
    """Whether the Memories feature is mounted (``open``) and the window focused."""

    open: bool
    focused: bool


_DEFAULT = UiState(service=None, group_id=None, member_id=None, focused=False)
_lock = threading.Lock()
_state: UiState = _DEFAULT
_memories_view = MemoriesView(open=False, focused=False)


def get_ui_state() -> UiState:
    """Return the last reported UI state (unfocused and empty by default)."""
    with _lock:
        return _state


def set_ui_state(state: UiState) -> None:
    """Replace the stored UI state."""
    global _state
    with _lock:
        _state = state


def get_memories_view() -> MemoriesView:
    """Return the last reported Memories view (closed and unfocused by default)."""
    with _lock:
        return _memories_view


def set_memories_view(view: MemoriesView) -> None:
    """Replace the stored Memories view; the chat state is left untouched."""
    global _memories_view
    with _lock:
        _memories_view = view


def memories_in_view() -> bool:
    """True when Memories is open and the window is focused (and visible)."""
    view = get_memories_view()
    return view.open and view.focused
