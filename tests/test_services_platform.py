"""Tests for backend/services/platform.py - Cross-platform abstractions."""

import os
import platform
from pathlib import Path
from unittest.mock import patch


from backend.services.platform import (
    get_system,
    is_windows,
    is_dev_mode,
    get_app_data_dir,
    get_settings_path,
    get_credentials_dir,
    get_session_dir,
    get_logs_dir,
    log_platform_info,
)


class TestOSDetection:
    """Test OS detection functions."""

    def test_get_system_returns_platform_system(self):
        """get_system() should return platform.system() result."""
        assert get_system() == platform.system()

    def test_get_system_returns_string(self):
        """get_system() should return a string."""
        result = get_system()
        assert isinstance(result, str)
        assert result in ("Windows", "Linux", "Darwin")

    @patch("backend.services.platform.platform.system", return_value="Windows")
    def test_is_windows_true_on_windows(self, mock_system):
        """is_windows() should return True on Windows."""
        assert is_windows() is True

    @patch("backend.services.platform.platform.system", return_value="Linux")
    def test_is_windows_false_on_linux(self, mock_system):
        """is_windows() should return False on Linux."""
        assert is_windows() is False

    @patch("backend.services.platform.platform.system", return_value="Darwin")
    def test_is_windows_false_on_macos(self, mock_system):
        """is_windows() should return False on macOS."""
        assert is_windows() is False


class TestTestModeDetection:
    """Test test mode detection."""

    def test_is_test_mode_returns_bool(self):
        """is_test_mode() should return a boolean."""
        from backend.services.platform import is_test_mode

        result = is_test_mode()
        assert isinstance(result, bool)


class TestDevModeDetection:
    """Test development mode detection."""

    def test_dev_mode_respects_module_constant(self):
        """is_dev_mode() should use DEV_MODE constant or is_windows check."""
        # This tests the current behavior - on Linux, always dev mode
        result = is_dev_mode()
        assert isinstance(result, bool)

    @patch("backend.services.platform.DEV_MODE", True)
    def test_dev_mode_true_when_constant_true(self):
        """is_dev_mode() should return True when DEV_MODE=True."""
        # Need to reimport to pick up the patched constant
        assert is_dev_mode() is True

    @patch("backend.services.platform.is_windows", return_value=False)
    def test_dev_mode_true_on_non_windows(self, mock_is_windows):
        """is_dev_mode() should return True on non-Windows systems."""
        assert is_dev_mode() is True


class TestAppDataDirectory:
    """Test app data directory resolution."""

    def test_app_data_dir_returns_path(self):
        """get_app_data_dir() should return a Path object."""
        result = get_app_data_dir()
        assert isinstance(result, Path)

    def test_app_data_dir_contains_sakadesk(self):
        """get_app_data_dir() should return a path containing 'SakaDesk'."""
        result = get_app_data_dir()
        assert "SakaDesk" in str(result)

    def test_app_data_dir_exists(self):
        """get_app_data_dir() should create the directory if it doesn't exist."""
        result = get_app_data_dir()
        assert result.exists()
        assert result.is_dir()

    @patch("backend.services.platform.is_windows", return_value=False)
    def test_linux_uses_home_sakadesk(self, mock_is_windows):
        """Linux should use ~/.SakaDesk directory."""
        result = get_app_data_dir()
        assert ".SakaDesk" in str(result)

    @patch("backend.services.platform.is_windows", return_value=True)
    @patch.dict(os.environ, {"LOCALAPPDATA": "/tmp/test_localappdata"})
    def test_windows_uses_localappdata(self, mock_is_windows):
        """Windows should use LOCALAPPDATA\\SakaDesk."""
        result = get_app_data_dir()
        assert "SakaDesk" in str(result)


class TestSettingsPath:
    """Test settings path resolution."""

    def test_settings_path_returns_path(self):
        """get_settings_path() should return a Path object."""
        result = get_settings_path()
        assert isinstance(result, Path)

    def test_settings_path_is_json_file(self):
        """get_settings_path() should return path to settings.json."""
        result = get_settings_path()
        assert result.name == "settings.json"

    def test_settings_path_in_app_data(self):
        """get_settings_path() should be inside app data dir."""
        settings = get_settings_path()
        app_data = get_app_data_dir()
        assert settings.parent == app_data


class TestCredentialsDir:
    """Test credentials directory resolution."""

    def test_credentials_dir_returns_path(self):
        """get_credentials_dir() should return a Path object."""
        result = get_credentials_dir()
        assert isinstance(result, Path)

    def test_credentials_dir_exists(self):
        """get_credentials_dir() should create the directory."""
        result = get_credentials_dir()
        assert result.exists()
        assert result.is_dir()

    def test_credentials_dir_in_app_data(self):
        """get_credentials_dir() should be inside app data dir."""
        creds = get_credentials_dir()
        app_data = get_app_data_dir()
        assert creds.parent == app_data
        assert creds.name == "credentials"


class TestSessionDir:
    """Test session directory resolution."""

    def test_session_dir_returns_path(self):
        """get_session_dir() should return a Path object."""
        result = get_session_dir()
        assert isinstance(result, Path)

    def test_session_dir_exists(self):
        """get_session_dir() should create the directory."""
        result = get_session_dir()
        assert result.exists()
        assert result.is_dir()

    def test_session_dir_uses_pysaka_auth_dir(self):
        """get_session_dir() should use pysaka.get_auth_dir() for shared browser session."""
        from pysaka import get_auth_dir

        session = get_session_dir()
        pysaka_auth = get_auth_dir()
        assert session == pysaka_auth
        assert "pysaka" in str(session)
        assert "auth_data" in str(session)


class TestLogsDir:
    """Test logs directory resolution."""

    def test_logs_dir_returns_path(self):
        """get_logs_dir() should return a Path object."""
        result = get_logs_dir()
        assert isinstance(result, Path)

    def test_logs_dir_exists(self):
        """get_logs_dir() should create the directory."""
        result = get_logs_dir()
        assert result.exists()
        assert result.is_dir()

    def test_logs_dir_in_app_data(self):
        """get_logs_dir() should be inside app data dir."""
        logs = get_logs_dir()
        app_data = get_app_data_dir()
        assert logs.parent == app_data
        assert logs.name == "logs"


class TestLogging:
    """Test platform info logging."""

    @patch("backend.services.platform.logger")
    def test_log_platform_info_does_not_raise(self, mock_logger):
        """log_platform_info() should not raise exceptions."""
        log_platform_info()  # Should complete without error

    @patch("backend.services.platform.logger")
    def test_log_platform_info_logs_platform(self, mock_logger):
        """log_platform_info() should log platform information."""
        log_platform_info()
        # Should have called logger.info at least twice
        assert mock_logger.info.call_count >= 2

    @patch("backend.services.platform.logger")
    @patch("backend.services.platform.is_dev_mode", return_value=True)
    @patch("backend.services.platform.is_windows", return_value=False)
    def test_log_platform_info_warns_on_dev_mode(
        self, mock_is_windows, mock_is_dev, mock_logger
    ):
        """log_platform_info() should warn when in dev mode on non-Windows."""
        log_platform_info()
        # Should have called logger.warning for dev mode
        mock_logger.warning.assert_called_once()
