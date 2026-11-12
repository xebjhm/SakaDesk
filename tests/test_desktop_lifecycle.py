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


class TestLegacyWindowMigration:
    def test_keeps_legacy_file_when_settings_unreadable(self, tmp_path, monkeypatch):
        """An unreadable settings.json is not overwritten, so the legacy
        window.json must survive for a later migration attempt."""
        monkeypatch.setattr(desktop, "get_app_data_dir", lambda: tmp_path)
        (tmp_path / "settings.json").write_text("{broken", encoding="utf-8")
        legacy = tmp_path / "window.json"
        legacy.write_text(json.dumps({"width": 900, "height": 700}), encoding="utf-8")

        desktop._load_window_geometry()

        assert legacy.exists()
        assert (tmp_path / "settings.json").read_text(encoding="utf-8") == "{broken"


class TestMainWindowKwargs:
    def test_sets_a_minimum_size(self, monkeypatch):
        """D4b: pywebview's default minimum (200 x 100) let the album collapse."""
        monkeypatch.setattr(
            desktop.window_geometry, "min_window_size", lambda: (960, 640)
        )
        kwargs = desktop._main_window_kwargs(
            {"width": 2100, "height": 1400, "x": 10, "y": 20}, 8000, False
        )
        assert kwargs["min_size"] == (960, 640)
        assert kwargs["width"] == 2100 and kwargs["x"] == 10
        assert kwargs["resizable"] is True and kwargs["hidden"] is False
        assert (
            kwargs["url"] == f"http://127.0.0.1:8000/#t={desktop.api_auth.LAUNCH_TOKEN}"
        )
