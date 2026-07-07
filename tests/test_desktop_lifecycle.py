"""Tests for desktop.py lifecycle logic (single-instance guard + atomic settings).

Covers the pure/injectable pieces of the SD-AUX-01/03 fixes without booting the
GUI: the ``webview`` module is already mocked in conftest, so ``import desktop``
is safe here.

- SD-AUX-01: ``_acquire_instance_mutex`` must return False when the named mutex
  already exists (ERROR_ALREADY_EXISTS) so a second launch bails out cleanly,
  and True for the first instance / on failure (fail-open).
- SD-AUX-03: ``_save_window_data_to_settings`` must write settings.json
  atomically and never lose unrelated keys already present in the file.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import desktop


class _FakeKernel32:
    """Minimal stand-in for ctypes.windll.kernel32 used by the mutex guard."""

    def __init__(self, handle: int, last_error: int) -> None:
        self._handle = handle
        self._last_error = last_error

    def CreateMutexW(self, _sec, _initial, _name):  # noqa: N802 (Win32 name)
        return self._handle

    def GetLastError(self):  # noqa: N802 (Win32 name)
        return self._last_error


def _patch_windows(monkeypatch, kernel32) -> None:
    monkeypatch.setattr(desktop.platform, "system", lambda: "Windows")
    monkeypatch.setattr(
        desktop.ctypes, "windll", SimpleNamespace(kernel32=kernel32), raising=False
    )
    # Reset the module global so one test's handle can't leak into another.
    monkeypatch.setattr(desktop, "_instance_mutex_handle", None, raising=False)


class TestSingleInstanceGuard:
    def test_first_instance_returns_true(self, monkeypatch):
        # New mutex created, no prior owner -> we are the first instance.
        _patch_windows(monkeypatch, _FakeKernel32(handle=0x1234, last_error=0))
        assert desktop._acquire_instance_mutex() is True

    def test_second_instance_returns_false(self, monkeypatch):
        # CreateMutexW still returns a handle but flags ERROR_ALREADY_EXISTS.
        _patch_windows(
            monkeypatch,
            _FakeKernel32(handle=0x1234, last_error=desktop._ERROR_ALREADY_EXISTS),
        )
        assert desktop._acquire_instance_mutex() is False

    def test_null_handle_fails_open(self, monkeypatch):
        # CreateMutexW failure returns NULL (0) without raising -> fail open so
        # the app still starts (mutex protection merely absent).
        _patch_windows(monkeypatch, _FakeKernel32(handle=0, last_error=0))
        assert desktop._acquire_instance_mutex() is True

    def test_non_windows_fails_open(self, monkeypatch):
        monkeypatch.setattr(desktop.platform, "system", lambda: "Linux")
        assert desktop._acquire_instance_mutex() is True


class TestAtomicSettingsWrite:
    def test_preserves_existing_keys(self, tmp_path):
        settings_path = tmp_path / "settings.json"
        settings_path.write_text(
            json.dumps({"language": "ja", "translation_provider": "gemini"}),
            encoding="utf-8",
        )

        desktop._save_window_data_to_settings(
            {"width": 1000, "height": 700, "x": 10, "y": 20}, settings_path
        )

        loaded = json.loads(settings_path.read_text(encoding="utf-8"))
        assert loaded["language"] == "ja"
        assert loaded["translation_provider"] == "gemini"
        assert loaded["window"] == {"width": 1000, "height": 700, "x": 10, "y": 20}

    def test_creates_file_when_missing(self, tmp_path):
        settings_path = tmp_path / "sub" / "settings.json"  # parent doesn't exist
        desktop._save_window_data_to_settings(
            {"width": 800, "height": 600}, settings_path
        )
        loaded = json.loads(settings_path.read_text(encoding="utf-8"))
        assert loaded["window"] == {"width": 800, "height": 600}

    def test_no_leftover_tmp_files(self, tmp_path):
        settings_path = tmp_path / "settings.json"
        desktop._save_window_data_to_settings(
            {"width": 800, "height": 600}, settings_path
        )
        # atomic_write_json must clean up its mkstemp temp file.
        assert [p.name for p in tmp_path.iterdir()] == ["settings.json"]
