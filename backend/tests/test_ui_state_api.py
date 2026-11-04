"""Tests for POST /api/ui-state and the in-memory UI state store."""

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.main import app
from backend.services.notification_planner import UiState
from backend.services.ui_state import get_ui_state, set_ui_state

client = TestClient(app)


@pytest.fixture(autouse=True)
def _reset_state():
    set_ui_state(UiState(None, None, None, False))
    yield
    set_ui_state(UiState(None, None, None, False))


def test_default_state_is_unfocused_and_empty():
    assert get_ui_state() == UiState(None, None, None, False)


def test_set_then_get_round_trips():
    state = UiState("hinatazaka46", "43", "58", True)
    set_ui_state(state)
    assert get_ui_state() == state


def test_post_stores_state_and_returns_204():
    res = client.post(
        "/api/ui-state",
        json={
            "service": "hinatazaka46",
            "group_id": "43",
            "member_id": "58",
            "focused": True,
        },
    )
    assert res.status_code == 204
    assert res.content == b""
    assert get_ui_state() == UiState("hinatazaka46", "43", "58", True)


def test_post_room_uses_member_zero():
    res = client.post(
        "/api/ui-state",
        json={
            "service": "sakurazaka46",
            "group_id": "7",
            "member_id": "0",
            "focused": True,
        },
    )
    assert res.status_code == 204
    assert get_ui_state().member_id == "0"


def test_post_accepts_nulls():
    set_ui_state(UiState("hinatazaka46", "43", "58", True))
    res = client.post(
        "/api/ui-state",
        json={"service": None, "group_id": None, "member_id": None, "focused": False},
    )
    assert res.status_code == 204
    assert get_ui_state() == UiState(None, None, None, False)


def test_post_logs_ui_state_at_debug_with_ids_only():
    with capture_logs() as logs:
        client.post(
            "/api/ui-state",
            json={
                "service": "hinatazaka46",
                "group_id": "43",
                "member_id": "58",
                "focused": True,
            },
        )
    events = [e for e in logs if e["event"] == "ui_state"]
    assert len(events) == 1
    assert events[0]["log_level"] == "debug"
    assert events[0]["service"] == "hinatazaka46"
    assert events[0]["group_id"] == "43"
    assert events[0]["member_id"] == "58"
    assert events[0]["focused"] is True


@pytest.mark.parametrize(
    "body",
    [
        {
            "service": "hinatazaka46",
            "group_id": "4x",
            "member_id": "58",
            "focused": True,
        },
        {
            "service": "hinatazaka46",
            "group_id": "43",
            "member_id": "-1",
            "focused": True,
        },
        {
            "service": "hinatazaka46",
            "group_id": "1234567890123",
            "member_id": "58",
            "focused": True,
        },
        {"service": "hinatazaka46", "group_id": "", "member_id": "58", "focused": True},
        {
            "service": "Hinata/../46",
            "group_id": "43",
            "member_id": "58",
            "focused": True,
        },
        {"service": "x" * 41, "group_id": "43", "member_id": "58", "focused": True},
        {
            "service": "hinatazaka46",
            "group_id": "43",
            "member_id": "58",
            "focused": "yes",
        },
        {"service": "hinatazaka46", "group_id": "43", "member_id": "58", "focused": 1},
        {"service": "hinatazaka46", "group_id": 43, "member_id": "58", "focused": True},
        {"service": "hinatazaka46", "group_id": "43", "member_id": "58"},
    ],
)
def test_invalid_body_is_rejected_and_state_unchanged(body):
    res = client.post("/api/ui-state", json=body)
    assert res.status_code == 422
    assert get_ui_state() == UiState(None, None, None, False)
