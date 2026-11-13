"""Tests for report API endpoints (POST /api/report, GET /api/report/diagnostics)."""

import json
from unittest.mock import MagicMock, patch
import pytest

from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.main import app

client = TestClient(app)


class TestGenerateReport:
    """Tests for POST /api/report."""

    @patch(
        "backend.api.report._get_smart_logs",
        return_value={"errors": [], "recent": ["ok"]},
    )
    @patch(
        "backend.api.report._get_sync_state",
        return_value={"last_sync": None, "last_error": None},
    )
    @patch(
        "backend.api.report._get_token_expiry",
        return_value={
            "has_token": False,
            "token_expires_in": None,
            "groups_configured": [],
        },
    )
    @patch("backend.api.report._get_nicknames", return_value=[])
    @patch("backend.api.report._get_username", return_value="testuser")
    def test_generate_report_sync_data(
        self, mock_user, mock_nick, mock_token, mock_sync, mock_logs
    ):
        """Test report generation for sync_data category."""
        response = client.post(
            "/api/report?what_doing=syncing&what_wrong=data%20missing",
            json={"category": "sync_data", "member_path": "hinatazaka46/member1"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "diagnostics" in data
        assert "github_url" in data
        assert data["diagnostics"]["category"] == "sync_data"
        assert "context" in data["diagnostics"]
        # Theme J / SD-FE-GAP-A-01: member_path is reduced to its group segment;
        # the specific member must never reach the public issue URL / clipboard.
        assert (
            data["diagnostics"]["context"]["member_path"] == "hinatazaka46/[REDACTED]"
        )
        assert "member1" not in data["github_url"]
        assert "member1" not in json.dumps(data["diagnostics"])

    @patch(
        "backend.api.report._get_smart_logs", return_value={"errors": [], "recent": []}
    )
    @patch(
        "backend.api.report._get_sync_state",
        return_value={"last_sync": None, "last_error": None},
    )
    @patch(
        "backend.api.report._get_token_expiry",
        return_value={
            "has_token": False,
            "token_expires_in": None,
            "groups_configured": [],
        },
    )
    @patch("backend.api.report._get_nicknames", return_value=[])
    @patch("backend.api.report._get_username", return_value="testuser")
    def test_generate_report_playback(
        self, mock_user, mock_nick, mock_token, mock_sync, mock_logs
    ):
        """Test report generation for playback category."""
        response = client.post(
            "/api/report?what_doing=playing&what_wrong=no%20audio",
            json={
                "category": "playback",
                "member_path": "hinatazaka46/m1",
                "message_id": 123,
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["diagnostics"]["category"] == "playback"
        ctx = data["diagnostics"]["context"]
        assert ctx["message_id"] == 123

    @patch(
        "backend.api.report._get_smart_logs", return_value={"errors": [], "recent": []}
    )
    @patch(
        "backend.api.report._get_sync_state",
        return_value={"last_sync": None, "last_error": None},
    )
    @patch(
        "backend.api.report._get_token_expiry",
        return_value={
            "has_token": True,
            "token_expires_in": "2h 0m",
            "groups_configured": ["hinatazaka46"],
        },
    )
    @patch("backend.api.report._get_nicknames", return_value=[])
    @patch("backend.api.report._get_username", return_value="testuser")
    def test_generate_report_login(
        self, mock_user, mock_nick, mock_token, mock_sync, mock_logs
    ):
        """Test report generation for login category (no extra context)."""
        response = client.post(
            "/api/report?what_doing=logging%20in&what_wrong=token%20expired",
            json={"category": "login"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["diagnostics"]["category"] == "login"
        # login category should not have a "context" key
        assert "context" not in data["diagnostics"]
        assert data["diagnostics"]["auth"]["has_token"] is True

    @patch(
        "backend.api.report._get_smart_logs", return_value={"errors": [], "recent": []}
    )
    @patch(
        "backend.api.report._get_sync_state",
        return_value={"last_sync": None, "last_error": None},
    )
    @patch(
        "backend.api.report._get_token_expiry",
        return_value={
            "has_token": False,
            "token_expires_in": None,
            "groups_configured": [],
        },
    )
    @patch("backend.api.report._get_nicknames", return_value=[])
    @patch("backend.api.report._get_username", return_value="testuser")
    def test_generate_report_other(
        self, mock_user, mock_nick, mock_token, mock_sync, mock_logs
    ):
        """Test report generation for 'other' category."""
        response = client.post(
            "/api/report?what_doing=browsing&what_wrong=crash",
            json={
                "category": "other",
                "current_screen": "settings",
                "error_message": "boom",
            },
        )
        assert response.status_code == 200
        data = response.json()
        ctx = data["diagnostics"]["context"]
        assert ctx["current_screen"] == "settings"
        assert ctx["error_message"] == "boom"

    def test_generate_report_missing_category(self):
        """Test that missing category field returns 422."""
        response = client.post("/api/report", json={})
        assert response.status_code == 422

    @patch(
        "backend.api.report._get_smart_logs", return_value={"errors": [], "recent": []}
    )
    @patch(
        "backend.api.report._get_sync_state",
        return_value={"last_sync": None, "last_error": None},
    )
    @patch(
        "backend.api.report._get_token_expiry",
        return_value={
            "has_token": False,
            "token_expires_in": None,
            "groups_configured": [],
        },
    )
    @patch("backend.api.report._get_nicknames", return_value=[])
    @patch("backend.api.report._get_username", return_value="testuser")
    def test_generate_report_github_url_format(
        self, mock_user, mock_nick, mock_token, mock_sync, mock_logs
    ):
        """Test that the GitHub URL is properly formed."""
        response = client.post(
            "/api/report?what_doing=testing&what_wrong=error",
            json={"category": "sync_data"},
        )
        assert response.status_code == 200
        url = response.json()["github_url"]
        assert url.startswith("https://github.com/xebjhm/SakaDesk/issues/new?")
        assert "Bug" in url


class TestGetDiagnosticsOnly:
    """Tests for GET /api/report/diagnostics."""

    @patch(
        "backend.api.report._get_smart_logs",
        return_value={"errors": [], "recent": ["line1"]},
    )
    @patch(
        "backend.api.report._get_sync_state",
        return_value={"last_sync": "2025-01-01T00:00:00Z", "last_error": None},
    )
    @patch(
        "backend.api.report._get_token_expiry",
        return_value={
            "has_token": False,
            "token_expires_in": None,
            "groups_configured": [],
        },
    )
    @patch("backend.api.report._get_nicknames", return_value=[])
    @patch("backend.api.report._get_username", return_value="testuser")
    def test_get_diagnostics_only(
        self, mock_user, mock_nick, mock_token, mock_sync, mock_logs
    ):
        """Test GET diagnostics preview endpoint."""
        response = client.get("/api/report/diagnostics")
        assert response.status_code == 200
        data = response.json()
        assert "system" in data
        assert "auth" in data
        assert "sync_state" in data
        assert "logs" in data
        assert data["system"]["os"] in ("Linux", "Windows", "Darwin")

    @patch(
        "backend.api.report._get_smart_logs",
        return_value={"errors": ["[error] boom"], "recent": []},
    )
    @patch(
        "backend.api.report._get_sync_state",
        return_value={"last_sync": None, "last_error": "timeout"},
    )
    @patch(
        "backend.api.report._get_token_expiry",
        return_value={
            "has_token": True,
            "token_expires_in": "expired",
            "groups_configured": ["hinatazaka46"],
        },
    )
    @patch("backend.api.report._get_nicknames", return_value=["TestNick"])
    @patch("backend.api.report._get_username", return_value="testuser")
    def test_get_diagnostics_with_errors(
        self, mock_user, mock_nick, mock_token, mock_sync, mock_logs
    ):
        """Test diagnostics with error state."""
        response = client.get("/api/report/diagnostics")
        assert response.status_code == 200
        data = response.json()
        assert data["auth"]["has_token"] is True
        assert data["sync_state"]["last_error"] == "timeout"


class TestSmartLogs:
    """Tests for the _get_smart_logs helper function."""

    def test_smart_logs_no_log_file(self, tmp_path):
        """Returns empty when log file does not exist."""
        from backend.api.report import _get_smart_logs

        result = _get_smart_logs(tmp_path / "nonexistent.log", "user", None)
        assert result["errors"] == []
        assert result["recent"] == ["No log file found"]

    def test_smart_logs_reads_recent(self, tmp_path):
        """Reads last 30 lines as recent context."""
        from backend.api.report import _get_smart_logs

        log_file = tmp_path / "debug.log"
        lines = [f"line {i}\n" for i in range(50)]
        log_file.write_text("".join(lines), encoding="utf-8")
        result = _get_smart_logs(log_file, "user", None)
        assert len(result["recent"]) == 30
        assert result["recent"][0] == "line 20"

    def test_smart_logs_extracts_errors(self, tmp_path):
        """Extracts error/warning lines from a separate error.log."""
        from backend.api.report import _get_smart_logs

        log_file = tmp_path / "debug.log"
        # Write enough normal lines so error line is NOT in the last-30 recent set
        lines = [f"[INFO] line {i}\n" for i in range(40)]
        log_file.write_text("".join(lines), encoding="utf-8")
        error_log = tmp_path / "error.log"
        error_log.write_text("[ERROR] something broke\n", encoding="utf-8")
        result = _get_smart_logs(log_file, "user", None)
        assert any("[ERROR]" in e for e in result["errors"])

    def test_smart_logs_uses_error_log(self, tmp_path):
        """Prefers error.log for error extraction when available."""
        from backend.api.report import _get_smart_logs

        debug_log = tmp_path / "debug.log"
        error_log = tmp_path / "error.log"
        debug_log.write_text("[INFO] debug line\n", encoding="utf-8")
        error_log.write_text(
            "[ERROR] from error.log\n[WARNING] warn line\n", encoding="utf-8"
        )
        result = _get_smart_logs(debug_log, "user", None)
        assert any("from error.log" in e for e in result["errors"])

    def test_smart_logs_redacts_username(self, tmp_path):
        """Redacts username from log lines."""
        from backend.api.report import _get_smart_logs

        log_file = tmp_path / "debug.log"
        log_file.write_text("path /home/john/data\n", encoding="utf-8")
        result = _get_smart_logs(log_file, "john", None)
        assert "/home/john" not in result["recent"][0]
        assert "[REDACTED]" in result["recent"][0]

    def test_smart_logs_redacts_nickname(self, tmp_path):
        """Redacts nickname from log lines."""
        from backend.api.report import _get_smart_logs

        log_file = tmp_path / "debug.log"
        log_file.write_text("user said hello Alice\n", encoding="utf-8")
        result = _get_smart_logs(log_file, "", "Alice")
        assert "Alice" not in result["recent"][0]


class TestBuildGithubUrl:
    """Tests for the _build_github_url helper."""

    def test_url_excludes_logs(self):
        """Logs should be excluded from GitHub URL to stay under length limits."""
        from backend.api.report import _build_github_url

        diag = {"system": {"os": "Linux"}, "logs": {"errors": ["e1"], "recent": ["r1"]}}
        url = _build_github_url("sync_data", "doing", "wrong", diag)
        assert "https://github.com" in url
        # logs should not appear in URL
        assert "e1" not in url

    def test_url_has_title(self):
        """URL should contain a bug report title."""
        from backend.api.report import _build_github_url

        url = _build_github_url("playback", "playing", "no audio", {})
        assert "Playback" in url
        assert "no+audio" in url or "no%20audio" in url


class TestGithubUrlLimit:
    """The URL stays under the desktop shell's 8192-character limit."""

    def test_long_cjk_text_is_trimmed_to_a_valid_url(self):
        from urllib.parse import parse_qs, urlsplit

        from backend.api.report import MAX_GITHUB_URL_LENGTH, _build_github_url

        text = "日本語のバグ報告" * 200  # 1600 chars, ~14 KB once encoded
        diag = {"system": {"os": "Linux"}, "context": {"error_message": text}}
        with capture_logs() as logs:
            url = _build_github_url("other", text, text, diag)

        assert MAX_GITHUB_URL_LENGTH < 8192
        assert len(url) <= MAX_GITHUB_URL_LENGTH
        parts = urlsplit(url)
        assert (parts.scheme, parts.netloc, parts.path) == (
            "https",
            "github.com",
            "/xebjhm/SakaDesk/issues/new",
        )
        query = parse_qs(parts.query, strict_parsing=True)
        assert set(query) == {"title", "body"}
        assert query["title"][0].startswith("[Bug] Other: 日本語")
        body = query["body"][0]
        assert "\u2026" in body
        assert "PASTE_HERE" in body
        assert body.count("日本語のバグ報告") > 1  # still carries useful text
        events = [e for e in logs if e["event"] == "report_url_truncated"]
        assert len(events) == 1
        assert text not in str(events)
        assert events[0]["length_before"] > MAX_GITHUB_URL_LENGTH
        assert events[0]["length_after"] == len(url)

    def test_short_report_is_untouched_and_not_logged(self):
        from backend.api.report import _build_github_url

        with capture_logs() as logs:
            url = _build_github_url("other", "doing", "wrong", {})
        assert "\u2026" not in url and "%E2%80%A6" not in url
        assert not [e for e in logs if e["event"] == "report_url_truncated"]


class TestHelperFunctions:
    """Tests for standalone helper functions in report module."""

    def test_get_token_expiry_no_sessions(self):
        """Returns no-token when no sessions exist."""
        from backend.api.report import _get_token_expiry

        mock_tm = MagicMock()
        mock_tm.load_session.return_value = None
        with patch("backend.api.report.get_token_manager", return_value=mock_tm):
            result = _get_token_expiry()
        assert result["has_token"] is False

    def test_get_token_expiry_with_valid_token(self):
        """Returns token info when a valid session is found."""
        from backend.api.report import _get_token_expiry

        mock_tm = MagicMock()
        mock_tm.load_session.return_value = {"access_token": "fake_jwt"}
        with (
            patch("backend.api.report.get_token_manager", return_value=mock_tm),
            patch("backend.api.report.get_jwt_remaining_seconds", return_value=7200),
        ):
            result = _get_token_expiry()
        assert result["has_token"] is True
        assert "2h" in result["token_expires_in"]

    def test_get_token_expiry_expired(self):
        """Returns 'expired' for negative remaining seconds."""
        from backend.api.report import _get_token_expiry

        mock_tm = MagicMock()
        mock_tm.load_session.return_value = {"access_token": "expired_jwt"}
        with (
            patch("backend.api.report.get_token_manager", return_value=mock_tm),
            patch("backend.api.report.get_jwt_remaining_seconds", return_value=-100),
        ):
            result = _get_token_expiry()
        assert result["token_expires_in"] == "expired"

    def test_get_token_expiry_exception(self):
        """Gracefully handles exceptions."""
        from backend.api.report import _get_token_expiry

        with patch(
            "backend.api.report.get_token_manager", side_effect=Exception("fail")
        ):
            result = _get_token_expiry()
        assert result["has_token"] is False

    def test_get_sync_state_no_settings(self, tmp_path):
        """Returns empty state when settings file doesn't exist."""
        from backend.api.report import _get_sync_state

        with patch(
            "backend.api.report.get_settings_path",
            return_value=tmp_path / "missing.json",
        ):
            result = _get_sync_state()
        assert result["last_sync"] is None

    def test_get_sync_state_with_metadata(self, tmp_path):
        """Reads sync metadata from service directories."""
        from backend.api.report import _get_sync_state

        settings_path = tmp_path / "settings.json"
        output_dir = tmp_path / "output"
        service_dir = output_dir / "hinatazaka46"
        service_dir.mkdir(parents=True)
        meta_file = service_dir / "sync_metadata.json"
        meta_file.write_text(
            json.dumps({"last_sync": "2025-01-01T00:00:00Z", "last_error": None}),
            encoding="utf-8",
        )
        settings_path.write_text(
            json.dumps({"output_dir": str(output_dir)}),
            encoding="utf-8",
        )
        with patch("backend.api.report.get_settings_path", return_value=settings_path):
            result = _get_sync_state()
        assert result["last_sync"] == "2025-01-01T00:00:00Z"

    @pytest.mark.parametrize("saved", ["", "   ", 5])
    def test_get_sync_state_reads_the_default_folder_for_an_unusable_value(
        self, tmp_path, saved
    ):
        """Sync writes to the default folder for these values, so the report reads it."""
        from backend.api.report import _get_sync_state

        default = tmp_path / "default"
        (default / "hinatazaka46").mkdir(parents=True)
        (default / "hinatazaka46" / "sync_metadata.json").write_text(
            json.dumps({"last_sync": "2025-02-02T00:00:00Z", "last_error": "boom"}),
            encoding="utf-8",
        )
        settings_path = tmp_path / "settings.json"
        settings_path.write_text(json.dumps({"output_dir": saved}), encoding="utf-8")
        with (
            patch("backend.api.report.get_settings_path", return_value=settings_path),
            patch("backend.api.report.get_default_output_dir", return_value=default),
        ):
            result = _get_sync_state()
        assert result == {"last_sync": "2025-02-02T00:00:00Z", "last_error": "boom"}

    def test_get_nickname_from_settings(self, tmp_path):
        """Reads nickname from settings file."""
        from backend.api.report import _get_nicknames

        settings_path = tmp_path / "settings.json"
        settings_path.write_text(
            json.dumps({"user_nickname": "TestNick"}),
            encoding="utf-8",
        )
        with patch("backend.api.report.get_settings_path", return_value=settings_path):
            result = _get_nicknames()
        assert result == ["TestNick"]

    def test_get_nickname_missing_file(self, tmp_path):
        """Returns no nicknames when settings file does not exist."""
        from backend.api.report import _get_nicknames

        with patch(
            "backend.api.report.get_settings_path",
            return_value=tmp_path / "missing.json",
        ):
            result = _get_nicknames()
        assert result == []

    def test_get_username_fallback(self):
        """Falls back to env var when os.getlogin() fails."""
        from backend.api.report import _get_username

        with patch("os.getlogin", side_effect=OSError):
            with patch.dict("os.environ", {"USER": "envuser"}):
                result = _get_username()
        assert result == "envuser"


class TestReportTextAndContextRoom:
    def test_long_error_message_keeps_most_of_its_text(self):
        from backend.api.report import MAX_GITHUB_URL_LENGTH, _build_github_url

        message = "x" * 6000
        diag = {"system": {"os": "Linux"}, "context": {"error_message": message}}
        url = _build_github_url("other", "", "", diag)
        assert len(url) <= MAX_GITHUB_URL_LENGTH
        from urllib.parse import parse_qs, urlsplit

        body = parse_qs(urlsplit(url).query)["body"][0]
        assert body.count("x") > 4000

    def test_clipboard_diagnostics_carry_the_full_user_text(self):
        from unittest.mock import patch as _patch

        long_text = "word " * 3000
        with (
            _patch("backend.api.report._get_nicknames", return_value=[]),
            _patch("backend.api.report._get_username", return_value="testuser"),
            _patch("backend.api.report._get_smart_logs", return_value={}),
            _patch("backend.api.report._get_sync_state", return_value={}),
            _patch("backend.api.report._get_token_expiry", return_value={}),
        ):
            response = client.post(
                "/api/report",
                params={
                    "what_doing": long_text,
                    "what_wrong": "C:\\Users\\testuser\\x",
                },
                json={"category": "login"},
            )
        data = response.json()
        assert data["diagnostics"]["report_text"]["what_doing"] == long_text
        assert "testuser" not in data["diagnostics"]["report_text"]["what_wrong"]
        assert "report_text" not in data["github_url"]

    def test_text_is_withheld_when_nicknames_are_unreadable(self):
        from unittest.mock import patch as _patch

        with (
            _patch("backend.api.report._get_nicknames", return_value=None),
            _patch("backend.api.report._get_username", return_value="testuser"),
            _patch("backend.api.report._get_sync_state", return_value={}),
            _patch("backend.api.report._get_token_expiry", return_value={}),
        ):
            response = client.post(
                "/api/report",
                params={"what_doing": "a", "what_wrong": "b"},
                json={"category": "login"},
            )
        assert response.json()["diagnostics"]["report_text"] == {
            "what_doing": None,
            "what_wrong": None,
        }
