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
