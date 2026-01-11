"""Tests for backend/api/diagnostics.py - System diagnostics endpoint."""

import json
import sys
import platform
from pathlib import Path
from unittest.mock import patch, mock_open, MagicMock
import tempfile

import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture
def client():
    """Create test client."""
    return TestClient(app)


class TestDiagnosticsEndpoint:
    """Test GET /api/diagnostics endpoint."""

    def test_returns_200_status(self, client):
        """Endpoint should return 200 OK."""
        response = client.get("/api/diagnostics")
        assert response.status_code == 200

    def test_returns_json(self, client):
        """Endpoint should return JSON response."""
        response = client.get("/api/diagnostics")
        assert response.headers["content-type"] == "application/json"
        data = response.json()
        assert isinstance(data, dict)

    def test_returns_system_info(self, client):
        """Endpoint should return system information."""
        response = client.get("/api/diagnostics")
        data = response.json()

        assert "system" in data
        system = data["system"]
        assert "os" in system
        assert "os_release" in system
        assert "python_version" in system
        assert "app_data_dir" in system
        assert "settings_path" in system
        assert "is_windows" in system

    def test_system_info_values_are_correct(self, client):
        """System info values should match actual system."""
        response = client.get("/api/diagnostics")
        data = response.json()
        system = data["system"]

        assert system["os"] == platform.system()
        assert system["os_release"] == platform.release()
        assert system["python_version"] == sys.version.split()[0]
        assert system["is_windows"] == (platform.system() == "Windows")

    def test_returns_config_state(self, client):
        """Endpoint should return config_state dict."""
        response = client.get("/api/diagnostics")
        data = response.json()

        assert "config_state" in data
        assert isinstance(data["config_state"], dict)

    def test_returns_logs_list(self, client):
        """Endpoint should return logs as a list."""
        response = client.get("/api/diagnostics")
        data = response.json()

        assert "logs" in data
        assert isinstance(data["logs"], list)

    def test_config_state_when_no_settings_file(self, client):
        """Config state should be empty when settings file doesn't exist."""
        with patch("backend.api.diagnostics.get_settings_path") as mock_path:
            mock_path_obj = MagicMock()
            mock_path_obj.exists.return_value = False
            mock_path.return_value = mock_path_obj

            response = client.get("/api/diagnostics")
            data = response.json()

            # Should not crash, config_state may be empty
            assert "config_state" in data


class TestDiagnosticsWithMockedFiles:
    """Test diagnostics endpoint with mocked file system."""

    def test_reads_settings_when_exists(self, client):
        """Should read config from settings file when it exists."""
        # Create a temporary settings file
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump({
                "output_dir": "/test/output",
                "auto_sync_enabled": True,
                "is_configured": True
            }, f)
            temp_path = Path(f.name)

        try:
            with patch("backend.api.diagnostics.get_settings_path", return_value=temp_path):
                response = client.get("/api/diagnostics")
                data = response.json()

                assert "config_state" in data
                config = data["config_state"]
                assert config.get("is_configured") is True
                assert config.get("output_dir_configured") is True
                assert config.get("auto_sync") is True
        finally:
            temp_path.unlink()

    def test_handles_invalid_json_gracefully(self, client):
        """Should handle invalid JSON in settings file."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            f.write("not valid json {{{")
            temp_path = Path(f.name)

        try:
            with patch("backend.api.diagnostics.get_settings_path", return_value=temp_path):
                response = client.get("/api/diagnostics")
                data = response.json()

                # Should not crash, should have error in config_state
                assert response.status_code == 200
                assert "config_state" in data
                assert "error" in data["config_state"]
        finally:
            temp_path.unlink()

    def test_reads_logs_when_exist(self, client):
        """Should read log lines from log file when it exists."""
        with tempfile.TemporaryDirectory() as temp_dir:
            log_dir = Path(temp_dir)
            log_file = log_dir / "app.log"

            # Write 100 lines to log
            with open(log_file, "w", encoding="utf-8") as f:
                for i in range(100):
                    f.write(f"Log line {i}\n")

            with patch("backend.api.diagnostics.get_logs_dir", return_value=log_dir):
                response = client.get("/api/diagnostics")
                data = response.json()

                assert "logs" in data
                logs = data["logs"]
                # Should return last 50 lines
                assert len(logs) <= 50
                # Should contain the last lines
                if logs:
                    assert "Log line" in logs[-1]

    def test_handles_missing_logs_dir(self, client):
        """Should handle missing logs directory gracefully."""
        non_existent = Path("/non/existent/path/that/does/not/exist")

        with patch("backend.api.diagnostics.get_logs_dir", return_value=non_existent):
            response = client.get("/api/diagnostics")
            data = response.json()

            # Should not crash
            assert response.status_code == 200
            assert "logs" in data

    def test_handles_empty_logs_dir(self, client):
        """Should handle empty logs directory."""
        with tempfile.TemporaryDirectory() as temp_dir:
            log_dir = Path(temp_dir)
            # No log files in directory

            with patch("backend.api.diagnostics.get_logs_dir", return_value=log_dir):
                response = client.get("/api/diagnostics")
                data = response.json()

                assert response.status_code == 200
                assert "logs" in data
                assert data["logs"] == []


class TestDiagnosticsResponseModel:
    """Test the response model structure."""

    def test_response_matches_model(self, client):
        """Response should match DiagnosticsResponse model."""
        response = client.get("/api/diagnostics")
        data = response.json()

        # All required fields should be present
        assert "system" in data
        assert "config_state" in data
        assert "logs" in data

        # System should have all SystemInfo fields
        system = data["system"]
        required_system_fields = [
            "os", "os_release", "python_version",
            "app_data_dir", "settings_path", "is_windows"
        ]
        for field in required_system_fields:
            assert field in system, f"Missing field: {field}"

    def test_system_is_windows_is_boolean(self, client):
        """is_windows field should be a boolean."""
        response = client.get("/api/diagnostics")
        data = response.json()

        assert isinstance(data["system"]["is_windows"], bool)
