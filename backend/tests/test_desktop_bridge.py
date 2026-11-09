"""desktop_bridge: the hand-off from a toast click to the window."""

import asyncio
import threading

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
    desktop_bridge.set_open_login_handler(None)
    desktop_bridge.set_tray_alert_handler(None)
    yield
    desktop_bridge.set_open_chat_handler(None)
    desktop_bridge.set_open_login_handler(None)
    desktop_bridge.set_tray_alert_handler(None)


def test_open_chat_calls_the_handler() -> None:
    seen: list[tuple[ChatTarget, int | None]] = []
    desktop_bridge.set_open_chat_handler(lambda t, m: seen.append((t, m)))
    desktop_bridge.open_chat(TARGET)
    desktop_bridge.open_chat(TARGET, 4321)
    assert seen == [(TARGET, None), (TARGET, 4321)]


def test_open_chat_without_handler_logs_and_does_not_raise() -> None:
    with capture_logs() as logs:
        desktop_bridge.open_chat(TARGET)
    events = [e for e in logs if e["event"] == "notify_click_unhandled"]
    assert len(events) == 1
    assert events[0]["service"] == "hinatazaka46"
    assert "金村" not in repr(events[0])


def test_raising_handler_is_logged_with_its_type_only() -> None:
    def boom(_t: ChatTarget, _m: int | None) -> None:
        raise ValueError("secret 金村 detail")

    desktop_bridge.set_open_chat_handler(boom)
    with capture_logs() as logs:
        desktop_bridge.open_chat(TARGET)
    failed = [e for e in logs if e["event"] == "notify_open_chat_failed"]
    assert len(failed) == 1
    assert failed[0]["error_type"] == "ValueError"
    assert "secret" not in repr(failed[0]) and "金村" not in repr(failed[0])


def test_handler_can_be_cleared() -> None:
    desktop_bridge.set_open_chat_handler(lambda _t, _m: None)
    desktop_bridge.set_open_chat_handler(None)
    with capture_logs() as logs:
        desktop_bridge.open_chat(TARGET)
    assert any(e["event"] == "notify_click_unhandled" for e in logs)


# ------------------------------------------------------------ open_window


@pytest.fixture(autouse=True)
def _reset_window_handler():
    desktop_bridge.set_open_window_handler(None)
    yield
    desktop_bridge.set_open_window_handler(None)


def test_open_window_calls_the_handler() -> None:
    calls: list[int] = []
    desktop_bridge.set_open_window_handler(lambda: calls.append(1))
    desktop_bridge.open_window()
    assert calls == [1]


def test_open_window_without_handler_logs_and_does_not_raise() -> None:
    with capture_logs() as logs:
        desktop_bridge.open_window()
    events = [e for e in logs if e["event"] == "window_open_unhandled"]
    assert len(events) == 1
    assert events[0]["reason"] == "no_handler"


def test_open_window_raising_handler_is_logged_by_type_only() -> None:
    def boom() -> None:
        raise ValueError("secret 金村 detail")

    desktop_bridge.set_open_window_handler(boom)
    with capture_logs() as logs:
        desktop_bridge.open_window()
    (event,) = [e for e in logs if e["event"] == "window_open_failed"]
    assert event["error_type"] == "ValueError"
    assert "金村" not in repr(logs)


# ---------------------------------------------------------- tray tooltip


@pytest.fixture(autouse=True)
def _reset_tooltip_handler():
    desktop_bridge.set_tray_tooltip_handler(None)
    yield
    desktop_bridge.set_tray_tooltip_handler(None)


def test_set_tray_tooltip_calls_the_handler() -> None:
    seen: list[str] = []
    desktop_bridge.set_tray_tooltip_handler(seen.append)
    assert desktop_bridge.has_tray_tooltip_handler()
    desktop_bridge.set_tray_tooltip("SakaDesk — 3 unread")
    assert seen == ["SakaDesk — 3 unread"]


def test_set_tray_tooltip_without_handler_logs_once() -> None:
    assert not desktop_bridge.has_tray_tooltip_handler()
    with capture_logs() as logs:
        desktop_bridge.set_tray_tooltip("a")
        desktop_bridge.set_tray_tooltip("b")
    events = [e for e in logs if e["event"] == "tray_tooltip_unhandled"]
    assert len(events) == 1
    assert "a" not in events[0].values()


def test_unhandled_log_rearms_when_the_handler_is_cleared() -> None:
    desktop_bridge.set_tray_tooltip("a")
    desktop_bridge.set_tray_tooltip_handler(None)
    with capture_logs() as logs:
        desktop_bridge.set_tray_tooltip("b")
    assert [e["event"] for e in logs] == ["tray_tooltip_unhandled"]


def test_raising_tooltip_handler_is_logged_by_type_only() -> None:
    def boom(_t: str) -> None:
        raise ValueError("secret 金村 detail")

    desktop_bridge.set_tray_tooltip_handler(boom)
    with capture_logs() as logs:
        desktop_bridge.set_tray_tooltip("x")
    (event,) = [e for e in logs if e["event"] == "tray_tooltip_failed"]
    assert event["error_type"] == "ValueError"
    assert "金村" not in repr(logs)


# ------------------------------------------------------- run_on_server_loop


@pytest.fixture(autouse=True)
def _reset_server_loop():
    desktop_bridge.set_server_loop(None)
    yield
    desktop_bridge.set_server_loop(None)


def test_run_on_server_loop_without_loop_logs_and_closes_the_coroutine(
    recwarn,
) -> None:
    async def work() -> int:
        return 1

    coro = work()
    with capture_logs() as logs:
        assert desktop_bridge.run_on_server_loop(coro) is None
    (event,) = [e for e in logs if e["event"] == "server_loop_unavailable"]
    assert event["reason"] == "no_loop"
    assert coro.cr_frame is None  # closed
    import gc

    gc.collect()
    # Only this test's coroutine: gc.collect() also reaps unrelated leaks from
    # other tests' mocks, whose timing depends on test order.
    assert not [
        w for w in recwarn if "<locals>.work' was never awaited" in str(w.message)
    ]


def test_run_on_server_loop_with_closed_loop_returns_none() -> None:
    loop = asyncio.new_event_loop()
    loop.close()
    desktop_bridge.set_server_loop(loop)

    async def work() -> int:
        return 1

    coro = work()
    with capture_logs() as logs:
        assert desktop_bridge.run_on_server_loop(coro) is None
    (event,) = [e for e in logs if e["event"] == "server_loop_unavailable"]
    assert event["reason"] == "closed"
    assert coro.cr_frame is None


def test_run_on_server_loop_runs_on_the_loop_thread() -> None:
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    try:
        desktop_bridge.set_server_loop(loop)

        async def work() -> int:
            return threading.get_ident()

        future = desktop_bridge.run_on_server_loop(work())
        assert future is not None
        assert future.result(timeout=5) == thread.ident
    finally:
        loop.call_soon_threadsafe(loop.stop)
        thread.join(timeout=5)
        loop.close()


def test_open_login_calls_the_handler() -> None:
    seen: list[str] = []
    desktop_bridge.set_open_login_handler(seen.append)
    desktop_bridge.open_login("yodel")
    assert seen == ["yodel"]


def test_open_login_without_handler_logs_once() -> None:
    with capture_logs() as logs:
        desktop_bridge.open_login("yodel")
        desktop_bridge.open_login("yodel")
    assert [e["event"] for e in logs] == ["login_open_unhandled"]


def test_open_login_handler_error_is_caught() -> None:
    def boom(_service: str) -> None:
        raise RuntimeError("secret")

    desktop_bridge.set_open_login_handler(boom)
    with capture_logs() as logs:
        desktop_bridge.open_login("yodel")
    (event,) = [e for e in logs if e["event"] == "login_open_failed"]
    assert event["error_type"] == "RuntimeError"
    assert "secret" not in repr(logs)


def test_set_tray_alert_passes_the_flag() -> None:
    seen: list[bool] = []
    desktop_bridge.set_tray_alert_handler(seen.append)
    desktop_bridge.set_tray_alert(True)
    desktop_bridge.set_tray_alert(False)
    assert seen == [True, False]


def test_set_tray_alert_without_handler_logs_once_and_failure_is_caught() -> None:
    with capture_logs() as logs:
        desktop_bridge.set_tray_alert(True)
        desktop_bridge.set_tray_alert(True)
    assert [e["event"] for e in logs] == ["tray_alert_unhandled"]

    def boom(_on: bool) -> None:
        raise RuntimeError("x")

    desktop_bridge.set_tray_alert_handler(boom)
    with capture_logs() as logs:
        desktop_bridge.set_tray_alert(True)
    assert [e["event"] for e in logs] == ["tray_alert_failed"]
