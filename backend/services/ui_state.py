"""In-memory record of what the user is looking at.

The frontend reports the open chat and whether the window is focused
(``POST /api/ui-state``). The notification planner reads it to skip the toast
for a chat the user is already viewing. Nothing is persisted; until the
frontend reports, the state is "not focused" so toasts are sent.
"""

from __future__ import annotations

import threading

from backend.services.notification_planner import UiState

_DEFAULT = UiState(service=None, group_id=None, member_id=None, focused=False)
_lock = threading.Lock()
_state: UiState = _DEFAULT


def get_ui_state() -> UiState:
    """Return the last reported UI state (unfocused and empty by default)."""
    with _lock:
        return _state


def set_ui_state(state: UiState) -> None:
    """Replace the stored UI state."""
    global _state
    with _lock:
        _state = state
