"""Tests for the frozen-Windows GUI hardening in backend.services.desktop_runtime.

These cover the two papercuts that only exist in the packaged, windowed
(console=False) build:

1. Child processes must not flash a console window — every subprocess defaults to
   CREATE_NO_WINDOW unless the caller already chose a console disposition.
2. The silent token refresh must reuse the user's installed browser instead of
   downloading Chromium at runtime (which spawned the console window in #1).
"""

from __future__ import annotations

import subprocess

from backend.services import desktop_runtime as dr

# Windows process-creation flags (winbase.h).
CREATE_NO_WINDOW = 0x08000000
DETACHED_PROCESS = 0x00000008
CREATE_NEW_CONSOLE = 0x00000010


class TestNoWindowCreationflags:
    def test_adds_no_window_by_default(self):
        """A child with no console preference gets CREATE_NO_WINDOW so it stays hidden."""
        assert dr.no_window_creationflags(0) == CREATE_NO_WINDOW

    def test_preserves_detached_process(self):
        """The upgrade helper spawns its updater DETACHED_PROCESS; we must not
        combine that with CREATE_NO_WINDOW (contradictory flags fail CreateProcess)."""
        assert dr.no_window_creationflags(DETACHED_PROCESS) == DETACHED_PROCESS

    def test_preserves_new_console(self):
        assert dr.no_window_creationflags(CREATE_NEW_CONSOLE) == CREATE_NEW_CONSOLE

    def test_idempotent_when_already_no_window(self):
        assert dr.no_window_creationflags(CREATE_NO_WINDOW) == CREATE_NO_WINDOW

    def test_keeps_unrelated_flags_and_adds_no_window(self):
        CREATE_NEW_PROCESS_GROUP = 0x00000200
        assert dr.no_window_creationflags(CREATE_NEW_PROCESS_GROUP) == (
            CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW
        )


class TestPinRefreshBrowserChannel:
    def test_sets_chrome_channel(self, monkeypatch):
        monkeypatch.delenv("PYSAKA_BROWSER_CHANNEL", raising=False)
        dr.pin_refresh_browser_channel()
        assert dr.os.environ["PYSAKA_BROWSER_CHANNEL"] == "chrome"

    def test_respects_existing_override(self, monkeypatch):
        monkeypatch.setenv("PYSAKA_BROWSER_CHANNEL", "msedge")
        dr.pin_refresh_browser_channel()
        assert dr.os.environ["PYSAKA_BROWSER_CHANNEL"] == "msedge"


class TestHardenGating:
    def test_noop_when_not_frozen(self, monkeypatch):
        """Dev and test runs are not frozen, so hardening must do nothing —
        no env pinned, subprocess untouched."""
        monkeypatch.delenv("PYSAKA_BROWSER_CHANNEL", raising=False)
        monkeypatch.setattr(dr, "is_frozen_windows", lambda: False)
        original_init = subprocess.Popen.__init__

        dr.harden_frozen_windows()

        assert "PYSAKA_BROWSER_CHANNEL" not in dr.os.environ
        assert subprocess.Popen.__init__ is original_init

    def test_applies_when_frozen(self, monkeypatch):
        """When frozen, hardening pins the channel and patches subprocess.Popen."""
        monkeypatch.delenv("PYSAKA_BROWSER_CHANNEL", raising=False)
        monkeypatch.setattr(dr, "is_frozen_windows", lambda: True)
        original_init = subprocess.Popen.__init__
        try:
            dr.harden_frozen_windows()
            assert dr.os.environ["PYSAKA_BROWSER_CHANNEL"] == "chrome"
            assert getattr(subprocess.Popen.__init__, "_saka_no_window", False) is True
        finally:
            subprocess.Popen.__init__ = original_init  # type: ignore[method-assign]

    def test_suppress_is_idempotent(self, monkeypatch):
        """Calling suppress twice must not double-wrap Popen.__init__."""
        original_init = subprocess.Popen.__init__
        try:
            dr.suppress_child_console_windows()
            once = subprocess.Popen.__init__
            dr.suppress_child_console_windows()
            assert subprocess.Popen.__init__ is once
        finally:
            subprocess.Popen.__init__ = original_init  # type: ignore[method-assign]
