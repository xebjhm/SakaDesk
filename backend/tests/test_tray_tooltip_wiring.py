"""The tray tooltip refresh is wired to syncs, read-state writes and the lifespan."""

from unittest.mock import AsyncMock, MagicMock, patch

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


def test_lifespan_registers_the_server_loop_and_clears_it_on_shutdown():
    with TestClient(app):
        loop = desktop_bridge._server_loop
        assert loop is not None and loop.is_running()

        async def work() -> int:
            return 7

        future = desktop_bridge.run_on_server_loop(work())
        assert future is not None
        assert future.result(timeout=5) == 7
    assert desktop_bridge._server_loop is None


# ------------------------------------------------------------- read states


def _svc():
    svc = MagicMock()
    svc.upsert_read_state = AsyncMock()
    svc.batch_upsert_read_states = AsyncMock(return_value=1)
    return svc


@patch("backend.api.read_states.schedule_refresh_debounced")
@patch("backend.api.read_states.get_search_service")
def test_put_read_state_schedules_a_debounced_refresh(mock_get_svc, mock_schedule):
    mock_get_svc.return_value = _svc()
    client = TestClient(app)
    r = client.put(
        "/api/read-states",
        json={"service": "hinatazaka46", "group_id": 1, "member_id": 2},
    )
    assert r.status_code == 200
    mock_schedule.assert_called_once_with()


@patch("backend.api.read_states.schedule_refresh_debounced")
@patch("backend.api.read_states.get_search_service")
def test_batch_read_states_schedules_one_debounced_refresh(mock_get_svc, mock_schedule):
    mock_get_svc.return_value = _svc()
    client = TestClient(app)
    r = client.post(
        "/api/read-states/batch",
        json=[{"service": "hinatazaka46", "group_id": 1, "member_id": 2}],
    )
    assert r.status_code == 200
    mock_schedule.assert_called_once_with()


@patch("backend.api.read_states.schedule_refresh_debounced")
def test_invalid_read_state_does_not_schedule(mock_schedule):
    client = TestClient(app)
    assert client.put("/api/read-states", json={}).status_code == 422
    mock_schedule.assert_not_called()


# -------------------------------------------------------------------- sync


async def _run(service_exc):
    from backend.api.sync import run_sync_task

    with (
        patch("backend.api.sync.get_sync_service") as mock_get,
        patch("backend.api.sync.progress_manager"),
    ):
        svc = MagicMock()
        svc.start_sync = AsyncMock(side_effect=service_exc)
        mock_get.return_value = svc
        await run_sync_task("hinatazaka46", False, False)


@pytest.mark.asyncio
@pytest.mark.parametrize("exc", [None, RuntimeError("boom")])
async def test_run_sync_task_schedules_a_refresh_after_completion(exc):
    with patch("backend.api.sync.schedule_refresh") as mock_schedule:
        await _run(exc)
    mock_schedule.assert_called_once_with()


@pytest.mark.asyncio
async def test_run_sync_task_does_not_schedule_while_shutting_down():
    with (
        patch("backend.api.sync.schedule_refresh") as mock_schedule,
        patch("backend.api.sync.is_shutting_down", return_value=True),
    ):
        await _run(None)
    mock_schedule.assert_not_called()
