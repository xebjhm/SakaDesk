"""Tests for backend/services/sync_launcher.py and the endpoints built on it."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from structlog.testing import capture_logs

from backend.api.progress import progress_manager
from backend.services import shutdown_state
from backend.services.sync_launcher import launch_sync


@pytest.fixture
def mock_sync_service():
    svc = MagicMock()
    svc.running = False
    svc.start_sync = AsyncMock()
    with patch("backend.api.sync.get_sync_service", return_value=svc):
        yield svc


def _launch_logs(logs):
    return [e for e in logs if e["event"] == "sync_launch"]


@pytest.fixture(autouse=True)
def _restore_shutdown_flag():
    yield
    shutdown_state.reset_for_tests()


@pytest.mark.asyncio
async def test_launch_started(mock_sync_service):
    with (
        patch("asyncio.create_task") as create_task,
        patch("backend.api.sync.run_sync_task", new=MagicMock()) as run_task,
        capture_logs() as logs,
    ):
        result = await launch_sync("hinatazaka46", origin="scheduler")

    assert result == "started"
    run_task.assert_called_once_with("hinatazaka46", True, False)
    create_task.assert_called_once()
    assert mock_sync_service._task is create_task.return_value
    assert progress_manager.get("hinatazaka46").get_status()["state"] == "running"
    assert _launch_logs(logs) == [
        {
            "event": "sync_launch",
            "log_level": "info",
            "service": "hinatazaka46",
            "origin": "scheduler",
            "result": "started",
        }
    ]


@pytest.mark.asyncio
async def test_launch_force_resync_sets_detail(mock_sync_service):
    with (
        patch("asyncio.create_task"),
        patch("backend.api.sync.run_sync_task", new=MagicMock()) as run_task,
    ):
        await launch_sync(
            "hinatazaka46", include_inactive=False, force_resync=True, origin="api"
        )
    run_task.assert_called_once_with("hinatazaka46", False, True)
    detail = progress_manager.get("hinatazaka46").get_status()["detail"]
    assert detail == "Initializing... (Resyncing)"


@pytest.mark.asyncio
async def test_launch_already_running(mock_sync_service):
    mock_sync_service.running = True
    with patch("asyncio.create_task") as create_task, capture_logs() as logs:
        result = await launch_sync("hinatazaka46", origin="tray")
    assert result == "already_running"
    create_task.assert_not_called()
    assert _launch_logs(logs)[0]["result"] == "already_running"
    assert _launch_logs(logs)[0]["origin"] == "tray"


@pytest.mark.asyncio
async def test_launch_live_registered_task_counts_as_running(mock_sync_service):
    """A task registered by a previous launch that has not started yet (so
    ``running`` is still False) must block a second launch."""
    mock_sync_service._task = MagicMock()
    mock_sync_service._task.done.return_value = False
    with patch("asyncio.create_task") as create_task:
        result = await launch_sync("hinatazaka46", origin="scheduler")
    assert result == "already_running"
    create_task.assert_not_called()


@pytest.mark.asyncio
async def test_launch_finished_registered_task_does_not_block(mock_sync_service):
    mock_sync_service._task = MagicMock()
    mock_sync_service._task.done.return_value = True
    with (
        patch("asyncio.create_task"),
        patch("backend.api.sync.run_sync_task", new=MagicMock()),
    ):
        result = await launch_sync("hinatazaka46", origin="scheduler")
    assert result == "started"


@pytest.mark.asyncio
async def test_launch_shutting_down(mock_sync_service):
    shutdown_state.begin_shutdown()
    with patch("asyncio.create_task") as create_task, capture_logs() as logs:
        result = await launch_sync("hinatazaka46", origin="scheduler")
    assert result == "shutting_down"
    create_task.assert_not_called()
    assert _launch_logs(logs)[0]["result"] == "shutting_down"


def test_start_endpoint_logs_api_origin(client, mock_sync_service):
    with (
        patch("asyncio.create_task"),
        patch("backend.api.sync.run_sync_task", new=MagicMock()),
        capture_logs() as logs,
    ):
        response = client.post("/api/sync/start?service=hinatazaka46")
    assert response.status_code == 200
    assert response.json() == {"status": "started", "service": "hinatazaka46"}
    entry = _launch_logs(logs)[0]
    assert entry["origin"] == "api"
    assert entry["result"] == "started"


def test_start_endpoint_shutting_down_503(client, mock_sync_service):
    shutdown_state.begin_shutdown()
    response = client.post("/api/sync/start?service=hinatazaka46")
    assert response.status_code == 503
    assert response.json() == {"detail": "Application is shutting down"}


def test_start_endpoint_invalid_service(client):
    response = client.post("/api/sync/start?service=nope")
    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid service: nope"}


# --- next_interval ---


def test_next_interval_minutes_fixed():
    from backend.services.adaptive_sync import next_interval_minutes

    assert (
        next_interval_minutes(
            {"adaptive_sync_enabled": False, "sync_interval_minutes": 20}
        )
        == 20.0
    )


def test_next_interval_minutes_adaptive():
    from backend.services.adaptive_sync import next_interval_minutes

    with patch(
        "backend.services.adaptive_sync.calculate_next_sync_interval",
        return_value=7.25,
    ):
        assert (
            next_interval_minutes(
                {"adaptive_sync_enabled": True, "sync_interval_minutes": 20}
            )
            == 7.25
        )


def test_next_interval_endpoint_unchanged(client):
    settings = {"adaptive_sync_enabled": False, "sync_interval_minutes": 20}
    with patch(
        "backend.services.settings_store.load_config", AsyncMock(return_value=settings)
    ):
        response = client.get("/api/sync/next_interval?service=hinatazaka46")
    assert response.status_code == 200
    assert response.json() == {"interval_minutes": 20.0}


# --- progress run_id ---


def test_run_id_increments_and_is_reported():
    from backend.api.progress import SyncProgress

    p = SyncProgress()
    first = p.get_status()["run_id"]
    p.reset()
    assert p.get_status()["run_id"] == first + 1
    p.reset()
    assert p.get_status()["run_id"] == first + 2
