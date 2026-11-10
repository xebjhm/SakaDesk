"""Tests for the SyncProgress tracker.

Focus: SD-CONTRACT-07 — sync errors expose a structured ``error_code`` instead of
smuggling machine codes through the human-readable ``detail`` field.
"""

import pytest

from backend.api.progress import SyncProgress


class TestErrorCode:
    def test_known_sentinel_message_maps_to_error_code(self):
        """A caller passing the legacy sentinel as the message still yields a
        stable machine ``error_code`` in the status payload."""
        p = SyncProgress()
        p.error("SESSION_EXPIRED")
        status = p.get_status()
        assert status["state"] == "error"
        # detail stays the human-readable string (backward compatible) ...
        assert status["detail"] == "SESSION_EXPIRED"
        # ... but the structured code is now available separately.
        assert status["error_code"] == "session_expired"

    def test_refresh_failed_sentinel(self):
        p = SyncProgress()
        p.error("REFRESH_FAILED")
        assert p.get_status()["error_code"] == "refresh_failed"

    def test_explicit_code_overrides_message_mapping(self):
        p = SyncProgress()
        p.error("Some human message", code="custom_code")
        status = p.get_status()
        assert status["detail"] == "Some human message"
        assert status["error_code"] == "custom_code"

    def test_unknown_message_has_no_error_code(self):
        """A free-form error message (e.g. an exception string) has no code —
        error_code is None rather than leaking the text as a pseudo-code."""
        p = SyncProgress()
        p.error("something unexpected broke")
        status = p.get_status()
        assert status["detail"] == "something unexpected broke"
        assert status["error_code"] is None

    def test_reset_clears_error_code(self):
        p = SyncProgress()
        p.error("SESSION_EXPIRED")
        p.reset()
        status = p.get_status()
        assert status["error_code"] is None
        assert status["state"] == "idle"

    def test_status_always_includes_error_code_key(self):
        """The field is always present (None when no error) so the frontend can
        rely on it existing."""
        p = SyncProgress()
        assert "error_code" in p.get_status()
        assert p.get_status()["error_code"] is None


def test_extend_total_grows_current_phase():
    p = SyncProgress()
    p.start_phase("syncing", "Collecting Metadata", 2, 3, "members")
    p.update(3)
    p.extend_total(2)
    status = p.get_status()
    assert status["total"] == 5 and status["completed"] == 3


def test_detail_code_set_and_cleared():
    p = SyncProgress()
    assert p.get_status()["detail_code"] is None
    p.set_detail_code("scanning_history")
    assert p.get_status()["detail_code"] == "scanning_history"
    p.start_phase("downloading", "Downloading Media", 3, 1, "files")
    assert p.get_status()["detail_code"] is None


def test_complete_clears_detail_code():
    p = SyncProgress()
    p.start_phase("syncing", "Collecting Metadata", 2, 1, "members")
    p.set_detail_code("scanning_history")
    p.complete()
    assert p.get_status()["detail_code"] is None


def test_error_clears_detail_code():
    p = SyncProgress()
    p.start_phase("syncing", "Collecting Metadata", 2, 1, "members")
    p.set_detail_code("scanning_history")
    p.error("boom")
    assert p.get_status()["detail_code"] is None


# --- S2 (spec 2026-11-10): honest progress -----------------------------------


class TestHonestProgress:
    def test_run_elapsed_survives_phase_changes(self, time_machine):
        time_machine.move_to("2026-11-10T00:00:00Z", tick=False)
        p = SyncProgress()
        p.start_phase("scanning", "Scanning", 1, 0, "group")
        time_machine.shift(90)
        p.start_phase("syncing", "Collecting Metadata", 2, 50, "members")
        time_machine.shift(30)
        status = p.get_status()
        assert status["elapsed_seconds"] == 30
        assert status["run_elapsed_seconds"] == 120

    def test_queued_time_is_not_elapsed(self, time_machine):
        time_machine.move_to("2026-11-10T00:00:00Z", tick=False)
        p = SyncProgress()
        p.set_queued(2)
        status = p.get_status()
        assert status["state"] == "queued" and status["queue_position"] == 2
        assert status["eta_seconds"] is None and status["eta_reason"] is None
        time_machine.shift(600)
        p.start_phase("starting", "Starting", 0, 0, "")
        time_machine.shift(5)
        status = p.get_status()
        assert status["run_elapsed_seconds"] == 5
        assert status["queue_position"] is None

    def test_metadata_phase_has_no_eta(self, time_machine):
        time_machine.move_to("2026-11-10T00:00:00Z", tick=False)
        p = SyncProgress()
        p.start_phase("syncing", "Collecting Metadata", 2, 50, "members")
        for _ in range(30):
            time_machine.shift(2)
            p.update(1)
        status = p.get_status()
        assert status["eta_seconds"] is None
        assert status["eta_reason"] == "not_estimable"

    def test_download_eta_warms_up_then_appears(self, time_machine):
        time_machine.move_to("2026-11-10T00:00:00Z", tick=False)
        p = SyncProgress()
        p.start_phase("downloading", "Downloading Media", 3, 1000, "files")
        for i in range(1, 11):
            time_machine.shift(1)
            p.set_completed(i)
        assert p.get_status()["eta_reason"] == "warming_up"  # 10 items, 10 s
        for i in range(11, 101):
            time_machine.shift(0.5)
            p.set_completed(i)
        status = p.get_status()
        assert status["eta_reason"] is None
        # Recent speed is 2 files/s (0.5 s per file over the 30 s window).
        assert 1.9 < status["speed"] < 2.1
        assert 430 <= status["eta_seconds"] <= 470  # 900 left / 2 per s

    def test_speed_reflects_only_the_recent_window(self, time_machine):
        time_machine.move_to("2026-11-10T00:00:00Z", tick=False)
        p = SyncProgress()
        p.start_phase("downloading", "Downloading Media", 3, 10000, "files")
        # A fast burst early on ...
        p.set_completed(5000)
        # ... then a stall of 60 s with slow progress.
        for i in range(1, 61):
            time_machine.shift(1)
            p.set_completed(5000 + i)
        status = p.get_status()
        assert status["speed"] < 1.5  # the cumulative average would be ~84/s

    def test_failed_count_is_reported_and_reset_per_phase(self):
        p = SyncProgress()
        p.start_phase("downloading", "Downloading Media", 3, 3, "files")
        p.add_failed()
        assert p.get_status()["failed"] == 1
        p.start_phase("complete", "Complete", 3, 0, "")
        assert p.get_status()["failed"] == 0

    def test_eta_reason_absent_when_not_running(self):
        p = SyncProgress()
        p.start_phase("downloading", "Downloading Media", 3, 3, "files")
        p.complete()
        status = p.get_status()
        assert status["eta_seconds"] is None and status["eta_reason"] is None

    def test_window_forgets_old_samples_at_read_time(self, time_machine):
        """Without new updates, samples age out when the status is read: a stall
        shows as the phase average, not as the last burst's speed."""
        time_machine.move_to("2026-11-10T00:00:00Z", tick=False)
        p = SyncProgress()
        p.start_phase("downloading", "Downloading Media", 3, 1000, "files")
        for i in range(1, 41):
            time_machine.shift(0.5)
            p.set_completed(i * 5)  # 10 files/s
        time_machine.shift(120)  # stalled
        status = p.get_status()
        assert status["speed"] == pytest.approx(200 / 140, rel=0.01)
