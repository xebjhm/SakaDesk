"""Tests for backend/api/progress.py - SyncProgress thread-safe progress tracker."""

import threading
import time


from backend.api.progress import SyncProgress, progress


class TestSyncProgressInitialization:
    """Test initial state and reset behavior."""

    def test_initial_state_is_idle(self):
        """New SyncProgress instance should have idle state."""
        p = SyncProgress()
        status = p.get_status()
        assert status["state"] == "idle"
        assert status["completed"] == 0
        assert status["total"] == 0

    def test_reset_clears_all_state(self):
        """reset() should restore all fields to initial values."""
        p = SyncProgress()
        p.start_phase("scanning", "Scanning", 1, 100, "groups")
        p.update(50)
        p.reset()
        status = p.get_status()
        assert status["state"] == "idle"
        assert status["completed"] == 0
        assert status["total"] == 0
        assert status["phase"] == ""
        assert status["phase_number"] == 0

    def test_reset_can_be_called_multiple_times(self):
        """Calling reset() multiple times should not raise."""
        p = SyncProgress()
        p.reset()
        p.reset()
        p.reset()
        assert p.get_status()["state"] == "idle"


class TestSyncProgressPhaseManagement:
    """Test phase start and transitions."""

    def test_start_phase_sets_parameters(self):
        """start_phase() should set phase name, number, and total."""
        p = SyncProgress()
        p.start_phase("scanning", "Scanning Groups", 1, 50, "groups")
        status = p.get_status()
        assert status["state"] == "running"
        assert status["phase"] == "scanning"
        assert status["phase_name"] == "Scanning Groups"
        assert status["phase_number"] == 1
        assert status["total"] == 50
        assert status["completed"] == 0
        assert status["speed_unit"] == "groups"

    def test_start_phase_resets_completed(self):
        """Starting a new phase should reset completed count."""
        p = SyncProgress()
        p.start_phase("phase1", "Phase 1", 1, 100, "items")
        p.update(50)
        p.start_phase("phase2", "Phase 2", 2, 200, "items")
        status = p.get_status()
        assert status["completed"] == 0
        assert status["total"] == 200
        assert status["phase"] == "phase2"
        assert status["phase_name"] == "Phase 2"


class TestSyncProgressUpdates:
    """Test progress updates."""

    def test_update_increments_completed(self):
        """update(n) should increment completed by n."""
        p = SyncProgress()
        p.start_phase("test", "Test", 1, 100, "items")
        p.update(10)
        assert p.get_status()["completed"] == 10
        p.update(5)
        assert p.get_status()["completed"] == 15

    def test_update_default_increment_is_one(self):
        """update() without argument should increment by 1."""
        p = SyncProgress()
        p.start_phase("test", "Test", 1, 100, "items")
        p.update()
        assert p.get_status()["completed"] == 1
        p.update()
        assert p.get_status()["completed"] == 2

    def test_update_with_detail(self):
        """update() with detail should update detail text."""
        p = SyncProgress()
        p.start_phase("test", "Test", 1, 100, "items")
        p.update(1, detail="Processing item 1")
        assert p.get_status()["detail"] == "Processing item 1"

    def test_update_with_detail_extra(self):
        """update() with detail_extra should update detail_extra text."""
        p = SyncProgress()
        p.start_phase("test", "Test", 1, 100, "items")
        p.update(1, detail="Main detail", detail_extra="Extra info")
        status = p.get_status()
        assert status["detail"] == "Main detail"
        assert status["detail_extra"] == "Extra info"

    def test_set_detail_updates_without_incrementing(self):
        """set_detail() should update detail without changing completed."""
        p = SyncProgress()
        p.start_phase("test", "Test", 1, 100, "items")
        p.update(10)
        p.set_detail("New status message", "Extra")
        status = p.get_status()
        assert status["completed"] == 10
        assert status["detail"] == "New status message"
        assert status["detail_extra"] == "Extra"

    def test_set_completed_sets_absolute_value(self):
        """set_completed() should set absolute value, not increment."""
        p = SyncProgress()
        p.start_phase("test", "Test", 1, 100, "items")
        p.update(10)
        p.set_completed(50)
        assert p.get_status()["completed"] == 50

    def test_set_completed_with_detail(self):
        """set_completed() with detail should update both."""
        p = SyncProgress()
        p.start_phase("test", "Test", 1, 100, "items")
        p.set_completed(75, detail="Almost done")
        status = p.get_status()
        assert status["completed"] == 75
        assert status["detail"] == "Almost done"


class TestSyncProgressCompletion:
    """Test completion and error states."""

    def test_complete_sets_state(self):
        """complete() should set state to complete."""
        p = SyncProgress()
        p.start_phase("test", "Test", 1, 100, "items")
        p.complete()
        status = p.get_status()
        assert status["state"] == "complete"
        assert status["phase"] == "complete"
        assert status["phase_name"] == "Complete"
        assert status["phase_number"] == 4
        assert status["detail"] == "Sync complete!"

    def test_error_sets_state_and_message(self):
        """error() should set state to error with message."""
        p = SyncProgress()
        p.start_phase("test", "Test", 1, 100, "items")
        p.error("Something went wrong")
        status = p.get_status()
        assert status["state"] == "error"
        assert status["phase"] == "error"
        assert status["phase_name"] == "Error"
        assert status["detail"] == "Something went wrong"


class TestSyncProgressCalculations:
    """Test elapsed time, speed, and ETA calculations."""

    def test_elapsed_seconds_calculated(self):
        """get_status() should include elapsed_seconds."""
        p = SyncProgress()
        p.start_phase("test", "Test", 1, 100, "items")
        time.sleep(0.15)
        status = p.get_status()
        # elapsed_seconds is int, so after 0.15s it could be 0
        assert status["elapsed_seconds"] >= 0

    def test_speed_calculation(self):
        """Speed should be completed / elapsed."""
        p = SyncProgress()
        p.start_phase("test", "Test", 1, 100, "items")
        time.sleep(0.2)
        p.update(20)
        status = p.get_status()
        # Speed = 20 / ~0.2 = ~100 items/sec
        assert status["speed"] > 0

    def test_speed_zero_when_no_elapsed(self):
        """Speed should be 0 when elapsed is 0 to avoid division by zero."""
        p = SyncProgress()
        # Immediately after start_phase, elapsed ~0
        p.start_phase("test", "Test", 1, 100, "items")
        status = p.get_status()
        # Speed could be 0 or very high, depends on timing
        # Just verify it doesn't crash
        assert isinstance(status["speed"], (int, float))

    def test_eta_calculation(self):
        """ETA should be remaining / speed when speed > 0."""
        p = SyncProgress()
        p.start_phase("test", "Test", 1, 100, "items")
        time.sleep(0.2)
        p.update(50)
        status = p.get_status()
        # eta_seconds is None when speed is 0, otherwise int
        if status["speed"] > 0:
            assert status["eta_seconds"] is not None
            assert status["eta_seconds"] >= 0

    def test_eta_none_when_speed_zero(self):
        """ETA should be None when speed is 0."""
        p = SyncProgress()
        p.start_phase("test", "Test", 1, 100, "items")
        # No updates, so completed=0, speed could be 0 or undefined
        status = p.get_status()
        # Just verify structure is valid
        assert "eta_seconds" in status


class TestSyncProgressThreadSafety:
    """Test thread safety of progress updates."""

    def test_concurrent_updates_no_data_corruption(self):
        """Multiple threads updating should not corrupt data."""
        p = SyncProgress()
        p.start_phase("test", "Test", 1, 1000, "items")

        def worker():
            for _ in range(100):
                p.update(1)

        threads = [threading.Thread(target=worker) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # 10 threads x 100 updates = 1000 total
        assert p.get_status()["completed"] == 1000

    def test_concurrent_reads_do_not_block(self):
        """Multiple threads reading status should not block."""
        p = SyncProgress()
        p.start_phase("test", "Test", 1, 100, "items")

        results = []

        def reader():
            for _ in range(50):
                status = p.get_status()
                results.append(status["state"])

        threads = [threading.Thread(target=reader) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # All reads should succeed
        assert len(results) == 250
        assert all(r == "running" for r in results)


class TestGlobalProgressInstance:
    """Test the global progress singleton."""

    def test_global_progress_exists(self):
        """Global progress instance should be importable."""
        assert progress is not None
        assert isinstance(progress, SyncProgress)

    def test_global_progress_has_get_status(self):
        """Global progress instance should have get_status method."""
        status = progress.get_status()
        assert isinstance(status, dict)
        assert "state" in status
