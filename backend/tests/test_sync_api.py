"""Tests for sync API endpoints (backend/api/sync.py)."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.api.sync import get_sync_service, _sync_services
from backend.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_sync_services():
    """Reset the module-level _sync_services cache between tests."""
    _sync_services.clear()
    yield
    _sync_services.clear()


# ---------------------------------------------------------------------------
# POST /api/sync/start
# ---------------------------------------------------------------------------


class TestStartSync:
    def test_missing_service_returns_422(self):
        """Service query param is required."""
        response = client.post("/api/sync/start")
        assert response.status_code == 422

    def test_invalid_service_returns_400(self):
        response = client.post("/api/sync/start?service=invalid_service")
        assert response.status_code == 400
        assert "Invalid service" in response.json()["detail"]

    def test_start_sync_success(self):
        """Starting sync for a valid, non-running service should return 200."""
        with patch("backend.api.sync.get_sync_service") as mock_get:
            mock_svc = MagicMock()
            mock_svc.running = False
            mock_get.return_value = mock_svc

            with patch("backend.api.sync.asyncio.create_task"):
                response = client.post("/api/sync/start?service=hinatazaka46")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "started"
        assert data["service"] == "hinatazaka46"

    def test_start_sync_already_running_returns_400(self):
        """Starting sync when already running should 400."""
        with patch("backend.api.sync.get_sync_service") as mock_get:
            mock_svc = MagicMock()
            mock_svc.running = True
            mock_get.return_value = mock_svc

            response = client.post("/api/sync/start?service=hinatazaka46")

        assert response.status_code == 400
        assert "already running" in response.json()["detail"]

    def test_start_sync_with_include_inactive(self):
        """include_inactive flag should be accepted."""
        with patch("backend.api.sync.get_sync_service") as mock_get:
            mock_svc = MagicMock()
            mock_svc.running = False
            mock_get.return_value = mock_svc

            with patch("backend.api.sync.asyncio.create_task"):
                response = client.post(
                    "/api/sync/start?service=hinatazaka46&include_inactive=true"
                )

        assert response.status_code == 200

    def test_start_sync_with_force_resync(self):
        """force_resync flag should be accepted."""
        with patch("backend.api.sync.get_sync_service") as mock_get:
            mock_svc = MagicMock()
            mock_svc.running = False
            mock_get.return_value = mock_svc

            with patch("backend.api.sync.asyncio.create_task"):
                response = client.post(
                    "/api/sync/start?service=hinatazaka46&force_resync=true"
                )

        assert response.status_code == 200


# ---------------------------------------------------------------------------
# GET /api/sync/progress
# ---------------------------------------------------------------------------


class TestGetProgress:
    def test_progress_no_service_returns_all(self):
        """Without service param, returns all services' progress."""
        response = client.get("/api/sync/progress")
        assert response.status_code == 200
        data = response.json()
        assert "services" in data

    def test_progress_specific_service(self):
        """With valid service, returns that service's progress."""
        from backend.api.progress import progress_manager

        # Ensure clean state for this service
        progress_manager.get("hinatazaka46").reset()

        response = client.get("/api/sync/progress?service=hinatazaka46")
        assert response.status_code == 200
        data = response.json()
        # Default idle state
        assert data["state"] == "idle"

    def test_progress_invalid_service_returns_400(self):
        response = client.get("/api/sync/progress?service=bad_service")
        assert response.status_code == 400

    def test_progress_shows_running_state(self):
        """After starting sync, progress should reflect running state."""
        from backend.api.progress import progress_manager

        progress = progress_manager.get("hinatazaka46")
        progress.start_phase("syncing", "Syncing", 2, 100, "members")
        progress.update(50, detail="50 of 100")

        response = client.get("/api/sync/progress?service=hinatazaka46")
        data = response.json()
        assert data["state"] == "running"
        assert data["phase"] == "syncing"
        assert data["completed"] == 50
        assert data["total"] == 100

        # Cleanup
        progress.reset()


# ---------------------------------------------------------------------------
# POST /api/sync/cancel
# ---------------------------------------------------------------------------


class TestCancelSync:
    def test_missing_service_returns_422(self):
        response = client.post("/api/sync/cancel")
        assert response.status_code == 422

    def test_invalid_service_returns_400(self):
        response = client.post("/api/sync/cancel?service=fake")
        assert response.status_code == 400

    def test_cancel_not_running_returns_not_running(self):
        """Cancelling when nothing is running should return not_running."""
        with patch("backend.api.sync.get_sync_service") as mock_get:
            mock_svc = MagicMock()
            mock_svc.running = False
            mock_get.return_value = mock_svc

            response = client.post("/api/sync/cancel?service=hinatazaka46")

        assert response.status_code == 200
        assert response.json()["status"] == "not_running"

    def test_cancel_running_sync(self):
        """Cancelling a running sync should reset the running flag and return cancelled."""
        with patch("backend.api.sync.get_sync_service") as mock_get:
            mock_svc = MagicMock()
            mock_svc.running = True
            mock_get.return_value = mock_svc

            response = client.post("/api/sync/cancel?service=hinatazaka46")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "cancelled"
        assert data["service"] == "hinatazaka46"
        # Verify the running flag was reset
        assert mock_svc.running is False


# ---------------------------------------------------------------------------
# GET /api/sync/next_interval
# ---------------------------------------------------------------------------


class TestNextInterval:
    def test_missing_service_returns_422(self):
        response = client.get("/api/sync/next_interval")
        assert response.status_code == 422

    def test_invalid_service_returns_400(self):
        response = client.get("/api/sync/next_interval?service=bad")
        assert response.status_code == 400

    def test_returns_interval(self):
        """Should return a numeric interval."""
        with patch(
            "backend.services.settings_store.load_config", new_callable=AsyncMock
        ) as mock_load:
            mock_load.return_value = {
                "sync_interval_minutes": 15,
                "adaptive_sync_enabled": False,
            }
            response = client.get("/api/sync/next_interval?service=hinatazaka46")

        assert response.status_code == 200
        data = response.json()
        assert "interval_minutes" in data
        assert isinstance(data["interval_minutes"], (int, float))

    def test_returns_adaptive_interval(self):
        """With adaptive sync enabled, interval should still be a number."""
        with patch(
            "backend.services.settings_store.load_config", new_callable=AsyncMock
        ) as mock_load:
            mock_load.return_value = {
                "sync_interval_minutes": 15,
                "adaptive_sync_enabled": True,
            }
            response = client.get("/api/sync/next_interval?service=hinatazaka46")

        assert response.status_code == 200
        data = response.json()
        assert data["interval_minutes"] > 0


# ---------------------------------------------------------------------------
# GET /api/sync/check
# ---------------------------------------------------------------------------


class TestCheckNew:
    def test_missing_service_returns_422(self):
        response = client.get("/api/sync/check")
        assert response.status_code == 422

    def test_invalid_service_returns_400(self):
        response = client.get("/api/sync/check?service=bad")
        assert response.status_code == 400

    def test_check_new_returns_list(self):
        """Successful check should return a list of new messages info."""
        with patch("backend.api.sync.get_sync_service") as mock_get:
            mock_svc = MagicMock()
            mock_svc.check_new_messages = AsyncMock(
                return_value=[{"member_name": "Test", "count": 5, "thumbnail": None}]
            )
            mock_get.return_value = mock_svc

            response = client.get("/api/sync/check?service=hinatazaka46")

        assert response.status_code == 200
        data = response.json()
        assert data["new_messages"][0]["count"] == 5

    def test_check_new_empty(self):
        """No new messages returns empty list."""
        with patch("backend.api.sync.get_sync_service") as mock_get:
            mock_svc = MagicMock()
            mock_svc.check_new_messages = AsyncMock(return_value=[])
            mock_get.return_value = mock_svc

            response = client.get("/api/sync/check?service=hinatazaka46")

        assert response.status_code == 200
        assert response.json()["new_messages"] == []

    def test_check_new_error_returns_500(self):
        """Service error during check should return 500."""
        with patch("backend.api.sync.get_sync_service") as mock_get:
            mock_svc = MagicMock()
            mock_svc.check_new_messages = AsyncMock(side_effect=RuntimeError("boom"))
            mock_get.return_value = mock_svc

            response = client.get("/api/sync/check?service=hinatazaka46")

        assert response.status_code == 500


# ---------------------------------------------------------------------------
# POST /api/sync/older
# ---------------------------------------------------------------------------


class TestSyncOlder:
    def test_missing_params_returns_422(self):
        response = client.post("/api/sync/older")
        assert response.status_code == 422

    def test_invalid_service_returns_400(self):
        response = client.post("/api/sync/older?service=bad&group_id=34&member_id=58")
        assert response.status_code == 400

    def test_sync_older_success(self):
        with patch("backend.api.sync.get_sync_service") as mock_get:
            mock_svc = MagicMock()
            mock_svc.sync_older_messages = AsyncMock(return_value=25)
            mock_get.return_value = mock_svc

            response = client.post(
                "/api/sync/older?service=hinatazaka46&group_id=34&member_id=58&limit=50"
            )

        assert response.status_code == 200
        assert response.json()["count"] == 25

    def test_sync_older_error_returns_500(self):
        with patch("backend.api.sync.get_sync_service") as mock_get:
            mock_svc = MagicMock()
            mock_svc.sync_older_messages = AsyncMock(side_effect=Exception("fail"))
            mock_get.return_value = mock_svc

            response = client.post(
                "/api/sync/older?service=hinatazaka46&group_id=34&member_id=58"
            )

        assert response.status_code == 500


# ---------------------------------------------------------------------------
# get_sync_service helper
# ---------------------------------------------------------------------------


class TestGetSyncServiceHelper:
    def test_creates_new_service(self):
        svc = get_sync_service("hinatazaka46")
        assert svc._service == "hinatazaka46"

    def test_caches_service(self):
        svc1 = get_sync_service("hinatazaka46")
        svc2 = get_sync_service("hinatazaka46")
        assert svc1 is svc2

    def test_different_services_are_separate(self):
        svc1 = get_sync_service("hinatazaka46")
        svc2 = get_sync_service("nogizaka46")
        assert svc1 is not svc2
        assert svc1._service != svc2._service


# ---------------------------------------------------------------------------
# run_sync_task error handling
# ---------------------------------------------------------------------------


class TestRunSyncTask:
    def test_session_expired_sets_error(self):
        """SessionExpiredError should be caught and reported to progress."""
        import asyncio
        from backend.api.sync import run_sync_task
        from pysaka import SessionExpiredError

        with patch("backend.api.sync.get_sync_service") as mock_get:
            mock_svc = MagicMock()
            mock_svc.start_sync = AsyncMock(side_effect=SessionExpiredError("expired"))
            mock_get.return_value = mock_svc

            with patch("backend.api.sync.progress_manager") as mock_pm:
                mock_progress = MagicMock()
                mock_pm.get.return_value = mock_progress

                asyncio.run(run_sync_task("hinatazaka46", False, False))

        mock_progress.error.assert_called_once_with("SESSION_EXPIRED")

    def test_refresh_failed_sets_error(self):
        """RefreshFailedError should be caught and reported."""
        import asyncio
        from backend.api.sync import run_sync_task
        from pysaka import RefreshFailedError

        with patch("backend.api.sync.get_sync_service") as mock_get:
            mock_svc = MagicMock()
            mock_svc.start_sync = AsyncMock(side_effect=RefreshFailedError("fail"))
            mock_get.return_value = mock_svc

            with patch("backend.api.sync.progress_manager") as mock_pm:
                mock_progress = MagicMock()
                mock_pm.get.return_value = mock_progress

                asyncio.run(run_sync_task("hinatazaka46", False, False))

        mock_progress.error.assert_called_once_with("REFRESH_FAILED")

    def test_generic_exception_sets_error(self):
        """Any other exception should be caught and message forwarded."""
        import asyncio
        from backend.api.sync import run_sync_task

        with patch("backend.api.sync.get_sync_service") as mock_get:
            mock_svc = MagicMock()
            mock_svc.start_sync = AsyncMock(side_effect=RuntimeError("something broke"))
            mock_get.return_value = mock_svc

            with patch("backend.api.sync.progress_manager") as mock_pm:
                mock_progress = MagicMock()
                mock_pm.get.return_value = mock_progress

                asyncio.run(run_sync_task("hinatazaka46", False, False))

        mock_progress.error.assert_called_once_with("something broke")
