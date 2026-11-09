"""The lifespan shutdown drops any popup call before syncs and writers stop."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.services import desktop_bridge, shutdown_state


@pytest.fixture(autouse=True)
def _reset_bridge():
    desktop_bridge.set_server_loop(None)
    yield
    desktop_bridge.set_server_loop(None)
    # The lifespan test runs a real shutdown, which latches this process-wide.
    shutdown_state.reset_for_tests()


def test_lifespan_shutdown_awaits_the_call_popup_controller(monkeypatch):
    fake = MagicMock()
    fake.shutdown = AsyncMock()
    monkeypatch.setattr(
        "backend.services.call_popup.get_call_popup_controller", lambda: fake
    )
    with TestClient(app):
        fake.shutdown.assert_not_awaited()
    fake.shutdown.assert_awaited_once_with()


def test_controller_shuts_down_before_the_scheduler_stops(monkeypatch):
    order: list[str] = []
    fake = MagicMock()
    fake.shutdown = AsyncMock(side_effect=lambda: order.append("call_popup"))

    class StubScheduler:
        def __init__(self, *_a, **_k) -> None:
            pass

        def start(self) -> None:
            order.append("scheduler_start")

        async def stop(self) -> None:
            order.append("scheduler_stop")

    monkeypatch.setattr(
        "backend.services.auto_sync_scheduler.scheduler_allowed_in_env", lambda: True
    )
    monkeypatch.setattr(
        "backend.services.auto_sync_scheduler.AutoSyncScheduler", StubScheduler
    )
    monkeypatch.setattr(
        "backend.services.call_popup.get_call_popup_controller", lambda: fake
    )
    with TestClient(app):
        pass
    assert order == ["scheduler_start", "call_popup", "scheduler_stop"]
