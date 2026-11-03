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


@pytest.fixture
def app_state_db(tmp_path):
    from backend.services import app_state

    app_state.set_db_path(tmp_path / "app_state.db")
    app_state.init_db()
    return app_state


@patch("backend.api.app_state.schedule_refresh_debounced")
def test_read_state_conversation_write_schedules_a_debounced_refresh(
    mock_schedule, app_state_db
):
    client = TestClient(app)
    r = client.patch(
        "/api/app-state/conversation",
        params={"path": "read_state_日向坂46/messages/34 金村 美玖/58 金村 美玖"},
        json={"value": '{"lastReadId": 3, "readCount": 0, "revealedIds": []}'},
    )
    assert r.status_code == 200
    mock_schedule.assert_called_once_with()


@patch("backend.api.app_state.schedule_refresh_debounced")
def test_other_conversation_writes_do_not_schedule(mock_schedule, app_state_db):
    client = TestClient(app)
    for key in ("sakadesk_scroll_58", "bg_settings_日向坂46/messages/x"):
        r = client.patch(
            "/api/app-state/conversation", params={"path": key}, json={"value": "1"}
        )
        assert r.status_code == 200
    mock_schedule.assert_not_called()


@patch("backend.api.app_state.schedule_refresh_debounced")
def test_a_failed_conversation_write_does_not_schedule(mock_schedule, app_state_db):
    client = TestClient(app, raise_server_exceptions=False)
    with patch(
        "backend.api.app_state.app_state.aset_conversation",
        side_effect=OSError("disk"),
    ):
        r = client.patch(
            "/api/app-state/conversation",
            params={"path": "read_state_x"},
            json={"value": "{}"},
        )
    assert r.status_code == 500
    mock_schedule.assert_not_called()


@patch("backend.api.read_states.get_search_service")
def test_search_read_state_upserts_no_longer_drive_the_tooltip(mock_get_svc):
    """The search DB copy is not the tooltip's source, so it must not trigger it."""
    from unittest.mock import AsyncMock

    svc = MagicMock()
    svc.upsert_read_state = AsyncMock()
    svc.batch_upsert_read_states = AsyncMock(return_value=1)
    mock_get_svc.return_value = svc
    with patch("backend.services.tray_tooltip.schedule_refresh_debounced") as sched:
        client = TestClient(app)
        entry = {"service": "hinatazaka46", "group_id": 1, "member_id": 2}
        assert client.put("/api/read-states", json=entry).status_code == 200
        assert client.post("/api/read-states/batch", json=[entry]).status_code == 200
    sched.assert_not_called()


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
