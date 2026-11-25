"""The "in Memories" UI-state flag and its endpoint (M4 delivery)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.main import app
from backend.services.notification_planner import UiState
from backend.services.ui_state import (
    MemoriesView,
    get_memories_view,
    get_ui_state,
    memories_in_view,
    set_memories_view,
    set_ui_state,
)

client = TestClient(app)
_CHAT = UiState(None, None, None, False)


@pytest.fixture(autouse=True)
def _reset_state():
    set_ui_state(_CHAT)
    set_memories_view(MemoriesView(open=False, focused=False))
    yield
    set_ui_state(_CHAT)
    set_memories_view(MemoriesView(open=False, focused=False))


def test_default_view_is_closed_and_not_in_view():
    assert get_memories_view() == MemoriesView(open=False, focused=False)
    assert memories_in_view() is False


@pytest.mark.parametrize(
    ("open_", "focused", "expected"),
    [(True, True, True), (True, False, False), (False, True, False)],
)
def test_in_view_needs_open_and_focused(open_, focused, expected):
    set_memories_view(MemoriesView(open=open_, focused=focused))
    assert memories_in_view() is expected


def test_post_memories_stores_the_view_and_returns_204():
    with capture_logs() as logs:
        res = client.post(
            "/api/ui-state/memories", json={"open": True, "focused": True}
        )
    assert res.status_code == 204
    assert res.content == b""
    assert get_memories_view() == MemoriesView(open=True, focused=True)
    assert memories_in_view() is True
    assert {
        "event": "ui_state_memories",
        "open": True,
        "focused": True,
        "log_level": "debug",
    } in logs


def test_chat_report_leaves_the_memories_flag_untouched():
    client.post("/api/ui-state/memories", json={"open": True, "focused": True})
    res = client.post(
        "/api/ui-state",
        json={"service": None, "group_id": None, "member_id": None, "focused": False},
    )
    assert res.status_code == 204
    assert memories_in_view() is True


def test_memories_report_leaves_the_chat_state_untouched():
    chat = UiState("hinatazaka46", "43", "58", True)
    set_ui_state(chat)
    res = client.post("/api/ui-state/memories", json={"open": False, "focused": False})
    assert res.status_code == 204
    assert get_ui_state() == chat


@pytest.mark.parametrize(
    "body",
    [{"open": "yes", "focused": True}, {"open": True}, {"open": 1, "focused": True}],
)
def test_bad_memories_report_is_422(body):
    res = client.post("/api/ui-state/memories", json=body)
    assert res.status_code == 422
    assert get_memories_view() == MemoriesView(open=False, focused=False)
