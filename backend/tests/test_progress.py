"""Tests for the SyncProgress tracker.

Focus: SD-CONTRACT-07 — sync errors expose a structured ``error_code`` instead of
smuggling machine codes through the human-readable ``detail`` field.
"""

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
