"""desktop_bridge: the hand-off from a toast click to the window."""

import pytest
from structlog.testing import capture_logs

from backend.services import desktop_bridge
from backend.services.notification_planner import ChatTarget

TARGET = ChatTarget(
    "hinatazaka46", "日向坂46/messages/34 金村 美玖/58 金村 美玖", "金村 美玖", False
)


@pytest.fixture(autouse=True)
def _reset():
    desktop_bridge.set_open_chat_handler(None)
    yield
    desktop_bridge.set_open_chat_handler(None)


def test_open_chat_calls_the_handler() -> None:
    seen: list[ChatTarget] = []
    desktop_bridge.set_open_chat_handler(seen.append)
    desktop_bridge.open_chat(TARGET)
    assert seen == [TARGET]


def test_open_chat_without_handler_logs_and_does_not_raise() -> None:
    with capture_logs() as logs:
        desktop_bridge.open_chat(TARGET)
    events = [e for e in logs if e["event"] == "notify_click_unhandled"]
    assert len(events) == 1
    assert events[0]["service"] == "hinatazaka46"
    assert "金村" not in repr(events[0])


def test_raising_handler_is_logged_with_its_type_only() -> None:
    def boom(_t: ChatTarget) -> None:
        raise ValueError("secret 金村 detail")

    desktop_bridge.set_open_chat_handler(boom)
    with capture_logs() as logs:
        desktop_bridge.open_chat(TARGET)
    failed = [e for e in logs if e["event"] == "notify_open_chat_failed"]
    assert len(failed) == 1
    assert failed[0]["error_type"] == "ValueError"
    assert "secret" not in repr(failed[0]) and "金村" not in repr(failed[0])


def test_handler_can_be_cleared() -> None:
    desktop_bridge.set_open_chat_handler(lambda _t: None)
    desktop_bridge.set_open_chat_handler(None)
    with capture_logs() as logs:
        desktop_bridge.open_chat(TARGET)
    assert any(e["event"] == "notify_click_unhandled" for e in logs)
