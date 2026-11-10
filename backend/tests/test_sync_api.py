"""Tests for sync API endpoints (backend/api/sync.py)."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.api.progress import ProgressManager
from backend.api.sync import get_sync_service, _sync_services
from backend.main import app
from backend.services.sync_coordinator import EnqueueResult, SyncCoordinator

client = TestClient(app)


@pytest.fixture
def fake_coordinator():
    """A mocked coordinator behind the API and the launcher."""
    fake = MagicMock()
    with (
        patch("backend.api.sync.get_coordinator", return_value=fake),
        patch("backend.services.sync_launcher.get_coordinator", return_value=fake),
    ):
        yield fake


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

    @pytest.mark.parametrize(
        "result,position",
        [("started", None), ("queued", 2), ("already_queued", 1)],
    )
    def test_start_sync_enqueues(self, fake_coordinator, result, position):
        """A started or queued sync answers 200 with its status and position."""
        fake_coordinator.enqueue.return_value = EnqueueResult(result, position)
        response = client.post("/api/sync/start?service=hinatazaka46")

        assert response.status_code == 200
        assert response.json() == {
            "status": result,
            "service": "hinatazaka46",
            "position": position,
        }

    def test_start_sync_already_running_returns_400(self, fake_coordinator):
        """A running sync answers 400 "already running" (the frontend attaches)."""
        fake_coordinator.enqueue.return_value = EnqueueResult("already_running")
        response = client.post("/api/sync/start?service=hinatazaka46")

        assert response.status_code == 400
        assert "already running" in response.json()["detail"]

    def test_start_sync_rejects_during_shutdown(self):
        """C1c: refuse to spawn a new sync writer once shutdown has begun --
        otherwise it would still be running (and writing) after
        data_lock.release(). The real coordinator refuses."""
        from backend.services import shutdown_state

        shutdown_state.begin_shutdown()
        try:
            with patch("backend.api.sync.run_sync_task") as mock_run:
                response = client.post("/api/sync/start?service=hinatazaka46")
            assert response.status_code == 503
            mock_run.assert_not_called()
        finally:
            shutdown_state.reset_for_tests()

    def test_start_sync_passes_flags(self, fake_coordinator):
        fake_coordinator.enqueue.return_value = EnqueueResult("started")
        client.post(
            "/api/sync/start?service=hinatazaka46&force_resync=true&include_inactive=false"
        )

        fake_coordinator.enqueue.assert_called_once_with(
            "hinatazaka46", include_inactive=False, force_resync=True, origin="api"
        )

    def test_start_sync_includes_inactive_by_default(self, fake_coordinator):
        """The frontend never sends include_inactive, so the endpoint default must
        fetch lapsed subscriptions too. With a False default, a member whose
        subscription expired was dropped from the groups response, her server_groups
        entry was never refreshed, and she stayed "online" forever (0.3.2 regression).
        """
        fake_coordinator.enqueue.return_value = EnqueueResult("started")
        client.post("/api/sync/start?service=hinatazaka46")

        assert fake_coordinator.enqueue.call_args.kwargs["include_inactive"] is True


# ---------------------------------------------------------------------------
# POST /api/sync/start-all, GET /api/sync/queue
# ---------------------------------------------------------------------------


class TestStartAllAndQueue:
    def test_start_all_starts_a_sequence(self, fake_coordinator):
        fake_coordinator.start_sequence.return_value = {
            "sequence_id": "abc",
            "results": {"yodel": "started"},
        }
        response = client.post(
            "/api/sync/start-all", json={"services": ["yodel"], "blocking": True}
        )

        assert response.status_code == 200
        assert response.json()["sequence_id"] == "abc"
        fake_coordinator.start_sequence.assert_called_once_with(
            ["yodel"], blocking=True, origin="api"
        )

    def test_start_all_rejects_bad_input(self, fake_coordinator):
        assert (
            client.post("/api/sync/start-all", json={"services": []}).status_code == 400
        )
        bad = client.post("/api/sync/start-all", json={"services": ["yodel", "nope"]})
        assert bad.status_code == 400 and "Invalid service" in bad.json()["detail"]
        fake_coordinator.start_sequence.assert_not_called()

    def test_start_all_rejects_during_shutdown(self, fake_coordinator):
        from backend.services import shutdown_state

        shutdown_state.begin_shutdown()
        try:
            response = client.post("/api/sync/start-all", json={"services": ["yodel"]})
            assert response.status_code == 503
        finally:
            shutdown_state.reset_for_tests()

    def test_start_all_runs_in_fixed_order(self):
        """Through the real coordinator: 乃木坂46, 日向坂46, Yodel whatever the
        request order (user decision, 2026-11-10)."""
        coordinator = SyncCoordinator(
            run_job=AsyncMock(),
            register_task=lambda job, task: None,
            progress=ProgressManager(),
            on_sequence_end=lambda seq: None,
        )
        with patch("backend.api.sync.get_coordinator", return_value=coordinator):
            response = client.post(
                "/api/sync/start-all",
                json={
                    "services": ["yodel", "hinatazaka46", "nogizaka46"],
                    "blocking": True,
                },
            )
            queue = client.get("/api/sync/queue").json()

        assert list(response.json()["results"]) == [
            "nogizaka46",
            "hinatazaka46",
            "yodel",
        ]
        assert queue["sequence"]["services"] == ["nogizaka46", "hinatazaka46", "yodel"]

    def test_queue_returns_snapshot(self, fake_coordinator):
        fake_coordinator.snapshot.return_value = {
            "running": None,
            "queued": [],
            "sequence": None,
        }
        assert client.get("/api/sync/queue").json() == {
            "running": None,
            "queued": [],
            "sequence": None,
        }


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

    def test_progress_result_roundtrip(self):
        """Result field should be None initially, settable, and clearable."""
        from backend.api.progress import SyncProgress

        p = SyncProgress()
        assert p.get_status()["result"] is None
        p.set_result({"missing": 5, "repaired": 4})
        assert p.get_status()["result"] == {"missing": 5, "repaired": 4}
        p.reset()
        assert p.get_status()["result"] is None


# ---------------------------------------------------------------------------
# POST /api/sync/cancel
# ---------------------------------------------------------------------------


class TestCancelSync:
    def test_missing_target_returns_422(self):
        response = client.post("/api/sync/cancel")
        assert response.status_code == 422

    def test_invalid_service_returns_400(self):
        response = client.post("/api/sync/cancel?service=fake")
        assert response.status_code == 400

    def test_cancel_not_running_returns_not_running(self, fake_coordinator):
        fake_coordinator.cancel_service = AsyncMock(return_value="not_running")
        response = client.post("/api/sync/cancel?service=hinatazaka46")

        assert response.status_code == 200
        assert response.json()["status"] == "not_running"

    def test_cancel_running_sync(self, fake_coordinator):
        """The coordinator cancels the job (real task.cancel() + awaited unwind,
        SVC-C1) and the endpoint resets the service's progress."""
        from backend.api.progress import progress_manager

        fake_coordinator.cancel_service = AsyncMock(return_value="cancelled")
        progress_manager.get("hinatazaka46").start_phase(
            "syncing", "x", 2, 5, "members"
        )
        response = client.post("/api/sync/cancel?service=hinatazaka46")

        assert response.json() == {"status": "cancelled", "service": "hinatazaka46"}
        fake_coordinator.cancel_service.assert_awaited_once_with("hinatazaka46")
        assert progress_manager.get("hinatazaka46").get_status()["state"] == "idle"

    def test_cancel_sequence(self, fake_coordinator):
        fake_coordinator.cancel_sequence = AsyncMock(return_value="cancelled")
        response = client.post("/api/sync/cancel?sequence=abc")

        assert response.json() == {"status": "cancelled", "sequence": "abc"}
        fake_coordinator.cancel_sequence.assert_awaited_once_with("abc")


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


# ---------------------------------------------------------------------------
# POST /api/sync/verify
# ---------------------------------------------------------------------------


class TestVerifyMedia:
    def test_verify_endpoint_enqueues_a_verify_job(self, fake_coordinator):
        fake_coordinator.enqueue.return_value = EnqueueResult("queued", 1)
        response = client.post("/api/sync/verify?service=hinatazaka46")

        assert response.status_code == 200
        assert response.json() == {
            "status": "queued",
            "service": "hinatazaka46",
            "position": 1,
        }
        fake_coordinator.enqueue.assert_called_once_with(
            "hinatazaka46", kind="verify", origin="api"
        )

    def test_verify_already_running_returns_400(self, fake_coordinator):
        fake_coordinator.enqueue.return_value = EnqueueResult("already_running")
        response = client.post("/api/sync/verify?service=hinatazaka46")
        assert response.status_code == 400
        assert "already running" in response.json()["detail"]

    def test_verify_endpoint_rejects_bad_service(self):
        """Verify endpoint should reject invalid services."""
        response = client.post("/api/sync/verify?service=not_a_service")
        assert response.status_code == 400

    def test_verify_endpoint_rejects_during_shutdown(self):
        """C1c: refuse to spawn a new verify writer once shutdown has begun --
        otherwise it would still be running (and writing media) after
        data_lock.release()."""
        from backend.services import shutdown_state

        shutdown_state.begin_shutdown()
        try:
            with patch("backend.api.sync.run_verify_task") as mock_run:
                response = client.post("/api/sync/verify?service=hinatazaka46")
            assert response.status_code == 503
            mock_run.assert_not_called()
        finally:
            shutdown_state.reset_for_tests()

    @pytest.mark.asyncio
    async def test_verify_task_is_registered_and_drained(self):
        """C1b / SD-BE-SVC-02 end-to-end: the verify job runs as a tracked task
        registered on the SyncService (so /cancel reaches it), and
        drain_background_tasks() -- the barrier's C1a hook -- stops it. Drives
        the real endpoint handler, a real coordinator and the real drain."""
        import asyncio

        from backend.services import background_tasks as bt
        from backend.api.sync import verify_media

        started = asyncio.Event()
        cancelled = False

        async def fake_verify_and_fix_media():
            nonlocal cancelled
            started.set()
            try:
                await asyncio.Event().wait()  # never completes on its own
            except asyncio.CancelledError:
                cancelled = True
                raise

        coordinator = SyncCoordinator(
            progress=ProgressManager(), on_sequence_end=lambda seq: None
        )
        mock_svc = MagicMock()
        mock_svc.running = False
        mock_svc.verify_and_fix_media = fake_verify_and_fix_media
        with (
            patch("backend.api.sync.get_sync_service", return_value=mock_svc),
            patch("backend.api.sync.get_coordinator", return_value=coordinator),
            patch("backend.api.sync.progress_manager") as mock_pm,
        ):
            mock_pm.get.return_value = MagicMock()
            await verify_media(service="hinatazaka46")
            await started.wait()
            assert len(bt._background_tasks) == 1
            assert mock_svc._task in bt._background_tasks

            await bt.drain_background_tasks()
            await coordinator.wait_idle()

        assert cancelled is True
        assert bt._background_tasks == set()
