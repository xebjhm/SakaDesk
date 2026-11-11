from backend.api.report import _redact_path, _redact_nickname


class TestRedactPath:
    """Tests for _redact_path PII redaction."""

    def test_redacts_linux_home_path(self):
        """Redacts Linux /home/username paths."""
        text = "Error in /home/john/documents/app.log"
        result = _redact_path(text, "john")
        assert result == "Error in /[REDACTED]/documents/app.log"

    def test_redacts_macos_users_path(self):
        """Redacts macOS /Users/username paths."""
        text = "File at /Users/john/Library/logs"
        result = _redact_path(text, "john")
        assert result == "File at /[REDACTED]/Library/logs"

    def test_redacts_windows_backslash_path(self):
        r"""Redacts Windows C:\Users\username paths."""
        text = r"File at C:\Users\john\AppData\Local"
        result = _redact_path(text, "john")
        assert result == "File at /[REDACTED]\\AppData\\Local"

    def test_redacts_windows_forward_slash_path(self):
        """Redacts Windows C:/Users/username paths."""
        text = "File at C:/Users/john/AppData/Local"
        result = _redact_path(text, "john")
        # The /Users/john pattern matches first, leaving C: prefix intact
        assert result == "File at C:/[REDACTED]/AppData/Local"

    def test_case_insensitive(self):
        """Matching is case-insensitive for the username."""
        text = "Path /home/John/file.txt and /HOME/JOHN/other.txt"
        result = _redact_path(text, "john")
        assert result == "Path /[REDACTED]/file.txt and /[REDACTED]/other.txt"

    def test_noop_when_username_empty(self):
        """Returns text unchanged when username is empty string."""
        text = "/home/john/documents/file.txt"
        result = _redact_path(text, "")
        assert result == text

    def test_preserves_text_without_paths(self):
        """Returns text unchanged when no matching paths exist."""
        text = "No paths here, just a normal log line."
        result = _redact_path(text, "john")
        assert result == text


class TestRedactNickname:
    """Tests for _redact_nickname PII redaction."""

    def test_redacts_japanese_nickname(self):
        """Redacts a Japanese nickname from text."""
        text = "Message from 松田好花 received"
        result = _redact_nickname(text, "松田好花")
        assert result == "Message from [REDACTED] received"

    def test_noop_when_nickname_is_none(self):
        """Returns text unchanged when nickname is None."""
        text = "Some log line with data"
        result = _redact_nickname(text, None)
        assert result == text

    def test_noop_when_nickname_is_empty(self):
        """Returns text unchanged when nickname is empty string."""
        text = "Some log line with data"
        result = _redact_nickname(text, "")
        assert result == text

    def test_redacts_multiple_occurrences(self):
        """Redacts all occurrences of the nickname."""
        text = "User alice said hello. Replying to alice now."
        result = _redact_nickname(text, "alice")
        assert result == "User [REDACTED] said hello. Replying to [REDACTED] now."


class TestScrubSecrets:
    """SEC-5 — token/JWT/bearer/long-secret scrubbing for emitted log lines."""

    def test_scrub_jwt(self):
        from backend.api.report import _scrub_secrets

        jwt = (
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0."
            "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
        )
        out = _scrub_secrets(f"auth token={jwt} ok")
        assert jwt not in out
        assert "[REDACTED_SECRET]" in out

    def test_scrub_bearer(self):
        from backend.api.report import _scrub_secrets

        out = _scrub_secrets("Authorization: Bearer abc123SECRETtokenvalue0000")
        assert "abc123SECRETtokenvalue0000" not in out
        assert "[REDACTED_SECRET]" in out

    def test_scrub_long_hex_secret(self):
        from backend.api.report import _scrub_secrets

        secret = "deadbeef" * 5  # 40 hex chars
        out = _scrub_secrets(f"api_key={secret}")
        assert secret not in out
        assert "[REDACTED_SECRET]" in out

    def test_scrub_leaves_ordinary_text(self):
        from backend.api.report import _scrub_secrets

        text = "Sync completed for group 46 in 3.2s"
        assert _scrub_secrets(text) == text

    def test_scrub_log_line_combines_path_nickname_secret(self):
        from backend.api.report import scrub_log_line

        jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.ZZZsignatureZZZ"
        line = f"C:\\Users\\alice\\app.log user=Bob token={jwt}"
        out = scrub_log_line(line, "alice", "Bob")
        assert "alice" not in out  # path redacted
        assert "Bob" not in out  # nickname redacted
        assert jwt not in out  # secret redacted


class TestRedactDiagnostics:
    """Theme J / SD-FE-GAP-A-01: the whole diagnostics payload (not just logs)
    must be scrubbed before it reaches the public GitHub-issue URL / clipboard."""

    def test_member_path_reduced_to_group_segment(self):
        """member_path keeps only the leading group/service; member/message id dropped."""
        from backend.api.report import _redact_diagnostics

        diag = {"context": {"member_path": "hinatazaka46/messages/34"}}
        out = _redact_diagnostics(diag, "john", None)
        assert out["context"]["member_path"] == "hinatazaka46/[REDACTED]"

    def test_member_path_backslashes_normalized(self):
        from backend.api.report import _redact_diagnostics

        diag = {"context": {"member_path": "sakurazaka46\\messages\\7"}}
        out = _redact_diagnostics(diag, "john", None)
        assert out["context"]["member_path"] == "sakurazaka46/[REDACTED]"

    def test_nested_string_paths_and_secrets_scrubbed(self):
        """Nested values (e.g. sync_state.last_error) get full path/secret scrubbing."""
        from backend.api.report import _redact_diagnostics

        diag = {
            "sync_state": {
                "last_error": r"write failed at C:\Users\john\AppData\Local\x.json"
            }
        }
        out = _redact_diagnostics(diag, "john", None)
        assert "john" not in out["sync_state"]["last_error"]

    def test_custom_output_dir_redacted(self):
        """A user-chosen output dir outside C:\\Users is redacted when known."""
        from backend.api.report import _redact_diagnostics

        diag = {
            "sync_state": {"last_error": r"boom at D:\SakaData\hinatazaka46\m.json"}
        }
        out = _redact_diagnostics(diag, "john", None, output_dir=r"D:\SakaData")
        assert "SakaData" not in out["sync_state"]["last_error"]
        assert "[REDACTED_DIR]" in out["sync_state"]["last_error"]

    def test_redacted_diag_yields_clean_github_url(self):
        """Regression: the member name must not survive into the issue URL body."""
        from backend.api.report import _redact_diagnostics, _build_github_url

        diag = {"context": {"member_path": "hinatazaka46/messages/34"}}
        safe = _redact_diagnostics(diag, "john", None)
        url = _build_github_url("playback", "watching", "froze", safe)
        assert "messages/34" not in url
        assert "messages%2F34" not in url  # url-encoded form

    def test_non_string_values_preserved(self):
        from backend.api.report import _redact_diagnostics

        diag = {"system": {"message_id": 34, "ok": True, "ratio": 1.5}}
        out = _redact_diagnostics(diag, "john", None)
        assert out["system"] == {"message_id": 34, "ok": True, "ratio": 1.5}


def test_report_settings_reads_keep_the_last_good_value(tmp_path, monkeypatch):
    """A settings read mid-swap (Windows) must not drop the redaction inputs."""
    import json
    from unittest.mock import patch

    from structlog.testing import capture_logs

    from backend.api import report
    from backend.services import settings_store

    settings_store._last_good_files.clear()
    path = tmp_path / "settings.json"
    path.write_text(
        json.dumps({"user_nickname": "ひな", "output_dir": str(tmp_path)}),
        encoding="utf-8",
    )
    with patch("backend.api.report.get_settings_path", return_value=path):
        assert report._get_nicknames() == ["ひな"]
        assert report._get_output_dir() == str(tmp_path)

        def held(p):
            raise PermissionError(13, "denied")

        monkeypatch.setattr(settings_store, "_open_json", held)
        assert report._get_nicknames() == ["ひな"]
        assert report._get_output_dir() == str(tmp_path)
        settings_store._last_good_files.clear()
        with capture_logs() as logs:
            assert report._get_nicknames() == []
        assert [e for e in logs if e["event"] == "report_nickname_read_failed"]
    settings_store._last_good_files.clear()


# --- every service nickname is redacted (user_nicknames dict + legacy key) -------------

NICKS = {"hinatazaka46": "ひなたの🌻", "sakurazaka46": "さくら推し"}
LEGACY = "ひなた"  # a substring of the hinatazaka46 nickname


def _settings(tmp_path, data):
    import json

    from backend.services import settings_store

    settings_store._last_good_files.clear()
    path = tmp_path / "settings.json"
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return path


def test_get_nicknames_reads_every_service_and_the_legacy_key(tmp_path):
    from unittest.mock import patch

    from backend.api import report

    path = _settings(
        tmp_path,
        {
            "user_nicknames": {**NICKS, "nogizaka46": "", "yodel": None, "x": 5},
            "user_nickname": LEGACY,
        },
    )
    with patch("backend.api.report.get_settings_path", return_value=path):
        got = report._get_nicknames()
    # longest first (ties by text), empty / non-string values skipped, no duplicates
    assert got == ["さくら推し", "ひなたの🌻", "ひなた"]
    assert [len(n) for n in got] == sorted((len(n) for n in got), reverse=True)


def test_get_nicknames_without_settings_or_nicknames(tmp_path):
    from unittest.mock import patch

    from backend.api import report

    with patch(
        "backend.api.report.get_settings_path", return_value=tmp_path / "none.json"
    ):
        assert report._get_nicknames() == []
    path = _settings(tmp_path, {"user_nicknames": ["not", "a", "map"]})
    with patch("backend.api.report.get_settings_path", return_value=path):
        assert report._get_nicknames() == []


def test_every_nickname_is_redacted_longest_first():
    from backend.api import report

    line = "reply to ひなたの🌻 and さくら推し; legacy ひなた; plain ひな"
    out = report._redact_nickname(line, ["ひなた", "さくら推し", "ひなたの🌻"])
    assert out == "reply to [REDACTED] and [REDACTED]; legacy [REDACTED]; plain ひな"
    assert "🌻" not in out  # no partial leak of the longer nickname
    # one pass: a nickname inside the placeholder is not re-redacted
    assert report._redact_nickname("RED x", ["RED"]) == "[REDACTED] x"
    assert report._redact_nickname("x", []) == "x"


def test_scrub_and_diagnostics_redact_every_nickname():
    from backend.api import report

    nicks = ["ひなたの🌻", "さくら推し", "ひなた"]
    line = report.scrub_log_line("hi ひなたの🌻 / さくら推し", "", nicks)
    assert "ひなた" not in line and "さくら推し" not in line
    payload = {
        "context": {"error_message": "さくら推し failed", "screen": ["ひなた"]},
        "logs": {"recent": ["ひなたの🌻 opened"]},
    }
    out = report._redact_diagnostics(payload, "", nicks)
    assert not any(n in repr(out) for n in nicks)


def test_report_endpoint_redacts_both_services_and_the_legacy_key(
    tmp_path, monkeypatch
):
    from unittest.mock import patch

    from fastapi.testclient import TestClient

    from backend.api import report
    from backend.main import app

    path = _settings(tmp_path, {"user_nicknames": NICKS, "user_nickname": LEGACY})
    log = tmp_path / "debug.log"
    log.write_text(
        "[error] sync failed for ひなたの🌻\n[warning] さくら推し timeout\n"
        "[info] legacy ひなた seen\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(report, "get_logs_dir", lambda: tmp_path)
    with patch("backend.api.report.get_settings_path", return_value=path):
        client = TestClient(app)
        body = client.post(
            "/api/report",
            json={"category": "other", "error_message": "さくら推し ひなた"},
        ).json()
        diag = client.get("/api/report/diagnostics").json()
    for blob in (repr(body), repr(diag)):
        assert "ひなた" not in blob and "さくら推し" not in blob and "🌻" not in blob
    assert "[REDACTED]" in repr(body["diagnostics"]["logs"])
