"""Extended tests for diagnostics API endpoint (GET /api/diagnostics)."""

import json
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


class TestDiagnosticsEndpoint:
    """Tests for GET /api/diagnostics."""

    @patch("backend.api.diagnostics.get_logs_dir")
    @patch("backend.api.diagnostics.get_token_manager")
    @patch("backend.api.diagnostics.get_settings_path")
    def test_diagnostics_no_settings_file(self, mock_settings, mock_tm, mock_logs, tmp_path):
        """Returns defaults when settings file does not exist."""
        mock_settings.return_value = tmp_path / "nonexistent.json"
        mock_tm.return_value = MagicMock(load_session=MagicMock(return_value=None))
        mock_logs.return_value = tmp_path / "logs"
        response = client.get("/api/diagnostics")
        assert response.status_code == 200
        data = response.json()
        assert data["config_state"]["is_configured"] is False
        assert data["config_state"]["output_dir_configured"] is False

    @patch("backend.api.diagnostics.get_logs_dir")
    @patch("backend.api.diagnostics.get_token_manager")
    @patch("backend.api.diagnostics.get_settings_path")
    def test_diagnostics_with_settings(self, mock_settings, mock_tm, mock_logs, tmp_path):
        """Reads config state from settings file."""
        settings_path = tmp_path / "settings.json"
        settings_path.write_text(
            json.dumps({
                "is_configured": True,
                "output_dir": str(tmp_path / "data"),
                "auto_sync_enabled": False,
                "sync_interval_minutes": 5,
                "adaptive_sync_enabled": False,
                "notifications_enabled": False,
                "blogs_full_backup": True,
            }),
            encoding="utf-8",
        )
        mock_settings.return_value = settings_path
        mock_tm.return_value = MagicMock(load_session=MagicMock(return_value=None))
        mock_logs.return_value = tmp_path / "logs"
        response = client.get("/api/diagnostics")
        assert response.status_code == 200
        data = response.json()
        assert data["config_state"]["is_configured"] is True
        assert data["config_state"]["auto_sync"] is False
        assert data["config_state"]["sync_interval"] == 5
        assert data["config_state"]["blogs_full_backup"] is True

    @patch("backend.api.diagnostics.get_logs_dir")
    @patch("backend.api.diagnostics.get_token_manager")
    @patch("backend.api.diagnostics.get_settings_path")
    def test_diagnostics_system_info(self, mock_settings, mock_tm, mock_logs, tmp_path):
        """System info fields are populated."""
        mock_settings.return_value = tmp_path / "nonexistent.json"
        mock_tm.return_value = MagicMock(load_session=MagicMock(return_value=None))
        mock_logs.return_value = tmp_path / "logs"
        response = client.get("/api/diagnostics")
        data = response.json()
        sys_info = data["system"]
        assert sys_info["os"] in ("Linux", "Windows", "Darwin")
        assert isinstance(sys_info["python_version"], str)
        assert isinstance(sys_info["app_version"], str)

    @patch("backend.api.diagnostics.get_logs_dir")
    @patch("backend.api.diagnostics.get_token_manager")
    @patch("backend.api.diagnostics.get_settings_path")
    def test_diagnostics_with_auth_token(self, mock_settings, mock_tm, mock_logs, tmp_path):
        """Auth status shows token info when session exists."""
        mock_settings.return_value = tmp_path / "nonexistent.json"
        mock_tm_inst = MagicMock()
        mock_tm_inst.load_session.return_value = {"access_token": "fake_jwt"}
        mock_tm.return_value = mock_tm_inst
        mock_logs.return_value = tmp_path / "logs"
        with patch("backend.api.diagnostics.get_jwt_remaining_seconds", return_value=3600):
            response = client.get("/api/diagnostics")
        data = response.json()
        assert data["auth_status"]["has_token"] is True
        assert "1h" in data["auth_status"]["token_expires_in"]

    @patch("backend.api.diagnostics.get_logs_dir")
    @patch("backend.api.diagnostics.get_token_manager")
    @patch("backend.api.diagnostics.get_settings_path")
    def test_diagnostics_logs_from_debug(self, mock_settings, mock_tm, mock_logs, tmp_path):
        """Reads log lines from debug.log."""
        log_dir = tmp_path / "logs"
        log_dir.mkdir()
        debug_log = log_dir / "debug.log"
        lines = [f"[INFO] line {i}\n" for i in range(60)]
        lines.append("[ERROR] something failed\n")
        debug_log.write_text("".join(lines), encoding="utf-8")

        mock_settings.return_value = tmp_path / "nonexistent.json"
        mock_tm.return_value = MagicMock(load_session=MagicMock(return_value=None))
        mock_logs.return_value = log_dir

        response = client.get("/api/diagnostics")
        data = response.json()
        # recent should have last 50 lines
        assert len(data["logs"]["recent"]) <= 50
        # errors should be extracted
        assert any("failed" in e for e in data["logs"]["errors"])

    @patch("backend.api.diagnostics.get_logs_dir")
    @patch("backend.api.diagnostics.get_token_manager")
    @patch("backend.api.diagnostics.get_settings_path")
    def test_diagnostics_logs_from_error_log(self, mock_settings, mock_tm, mock_logs, tmp_path):
        """Prefers error.log for error/warning extraction."""
        log_dir = tmp_path / "logs"
        log_dir.mkdir()
        debug_log = log_dir / "debug.log"
        debug_log.write_text("[INFO] ok\n", encoding="utf-8")
        error_log = log_dir / "error.log"
        error_log.write_text("[ERROR] from error.log\n[WARNING] warn msg\n", encoding="utf-8")

        mock_settings.return_value = tmp_path / "nonexistent.json"
        mock_tm.return_value = MagicMock(load_session=MagicMock(return_value=None))
        mock_logs.return_value = log_dir

        response = client.get("/api/diagnostics")
        data = response.json()
        assert any("from error.log" in e for e in data["logs"]["errors"])
        assert any("warn msg" in w for w in data["logs"]["warnings"])

    @patch("backend.api.diagnostics.get_logs_dir")
    @patch("backend.api.diagnostics.get_token_manager")
    @patch("backend.api.diagnostics.get_settings_path")
    def test_diagnostics_sync_with_services(self, mock_settings, mock_tm, mock_logs, tmp_path):
        """Reads per-service sync metadata."""
        output_dir = tmp_path / "output"
        svc_dir = output_dir / "日向坂46"
        svc_dir.mkdir(parents=True)
        meta = svc_dir / "sync_metadata.json"
        meta.write_text(
            json.dumps({
                "last_sync": "2025-06-01T12:00:00Z",
                "last_error": None,
                "groups": {
                    "1": {"message_count": 100},
                    "2": {"message_count": 50},
                },
            }),
            encoding="utf-8",
        )
        settings_path = tmp_path / "settings.json"
        settings_path.write_text(
            json.dumps({"is_configured": True, "output_dir": str(output_dir)}),
            encoding="utf-8",
        )
        mock_settings.return_value = settings_path
        mock_tm.return_value = MagicMock(load_session=MagicMock(return_value=None))
        mock_logs.return_value = tmp_path / "logs"

        response = client.get("/api/diagnostics")
        data = response.json()
        services = data["sync_state"]["services"]
        assert len(services) == 1
        assert services[0]["display_name"] == "日向坂46"
        assert services[0]["service_id"] == "hinatazaka46"
        assert services[0]["member_count"] == 2
        assert services[0]["message_count"] == 150


class TestFormatDuration:
    """Tests for the _format_duration helper."""

    def test_expired(self):
        from backend.api.diagnostics import _format_duration
        assert _format_duration(-1) == "expired"

    def test_seconds(self):
        from backend.api.diagnostics import _format_duration
        assert _format_duration(45) == "45s"

    def test_minutes(self):
        from backend.api.diagnostics import _format_duration
        assert _format_duration(125) == "2m 5s"

    def test_hours(self):
        from backend.api.diagnostics import _format_duration
        assert _format_duration(7320) == "2h 2m"


class TestDiskUsage:
    """Tests for _get_disk_usage helper."""

    def test_nonexistent_dir(self, tmp_path):
        from backend.api.diagnostics import _get_disk_usage
        size_mb, count = _get_disk_usage(str(tmp_path / "missing"))
        assert size_mb == 0.0
        assert count == 0

    def test_empty_dir(self, tmp_path):
        from backend.api.diagnostics import _get_disk_usage
        size_mb, count = _get_disk_usage(str(tmp_path))
        assert size_mb == 0.0
        assert count == 0

    def test_dir_with_files(self, tmp_path):
        from backend.api.diagnostics import _get_disk_usage
        f1 = tmp_path / "a.bin"
        # Write >10 KB so rounding to 2 decimals still > 0.00
        f1.write_bytes(b"x" * 10240)
        f2 = tmp_path / "sub" / "b.bin"
        f2.parent.mkdir()
        f2.write_bytes(b"y" * 10240)
        size_mb, count = _get_disk_usage(str(tmp_path))
        assert count == 2
        assert size_mb > 0


class TestDetailedDiskUsage:
    """Tests for _get_detailed_disk_usage helper."""

    def test_nonexistent_dir(self, tmp_path):
        from backend.api.diagnostics import _get_detailed_disk_usage, _disk_cache
        # Clear cache
        _disk_cache["data"] = None
        _disk_cache["expires"] = 0
        result = _get_detailed_disk_usage(str(tmp_path / "missing"))
        assert result["total_bytes"] == 0
        assert result["services"] == []

    def test_with_services(self, tmp_path):
        from backend.api.diagnostics import _get_detailed_disk_usage, _disk_cache
        # Clear cache
        _disk_cache["data"] = None
        _disk_cache["expires"] = 0
        svc = tmp_path / "hinatazaka46" / "messages"
        svc.mkdir(parents=True)
        (svc / "data.json").write_text("content", encoding="utf-8")
        result = _get_detailed_disk_usage(str(tmp_path))
        assert len(result["services"]) == 1
        assert result["services"][0]["name"] == "hinatazaka46"
        assert result["total_bytes"] > 0

    def test_cache_is_used(self, tmp_path):
        from backend.api.diagnostics import _get_detailed_disk_usage, _disk_cache
        _disk_cache["data"] = {"total_bytes": 999, "services": []}
        _disk_cache["expires"] = time.time() + 3600
        result = _get_detailed_disk_usage(str(tmp_path))
        assert result["total_bytes"] == 999
        # Clean up
        _disk_cache["data"] = None
        _disk_cache["expires"] = 0
