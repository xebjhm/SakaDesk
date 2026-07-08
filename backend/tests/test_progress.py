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
