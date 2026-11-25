"""Escaped Windows paths never reach a bug report (security audit 2026-11-13).

backend/api/report.py:scrub_log_line:repr-escaped-windows-path-bypass: structlog's
ConsoleRenderer writes a value with a space through repr(), doubling every
backslash, and str(OSError) doubles them again; the scrubber matched only a
single backslash, so the profile name and the archive folder went out as is.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import structlog
from fastapi.testclient import TestClient

from backend.api import report
from backend.api.report import _redact_path, scrub_log_line
from backend.main import app

HOME = r"C:\Users\Real Name"
OUT = r"D:\Saka Data\SakaDesk"


def _rendered(**fields) -> str:
    renderer = structlog.dev.ConsoleRenderer(colors=False)
    return renderer(
        None, "warning", {"event": "media_failed", "timestamp": "t", **fields}
    )


def test_the_renderer_really_escapes_windows_paths():
    assert "\\\\" in _rendered(path=HOME + r"\Documents\a b")


@pytest.mark.parametrize(
    "fields",
    [
        {"path": HOME + r"\Documents\SakaDesk\日向坂46\messages\34 金村 美玖"},
        {"error": str(OSError(2, "No such file or directory", HOME + r"\x y.jpg"))},
        {"path": OUT + r"\日向坂46\messages\34 a b"},
        {"error": str(OSError(13, "Permission denied", OUT + r"\x y.jpg"))},
    ],
)
def test_escaped_paths_are_redacted(fields):
    out = scrub_log_line(_rendered(**fields), "realname", [], OUT, home=HOME)
    assert "Real Name" not in out
    assert "Saka Data" not in out


def test_json_escaped_paths_are_redacted():
    line = json.dumps({"path": HOME + r"\x", "dir": OUT + r"\y"})
    out = scrub_log_line(line, "realname", [], OUT, home=HOME)
    assert "Real Name" not in out and "Saka Data" not in out


def test_a_profile_on_another_drive_is_redacted_by_login_name():
    assert _redact_path(r"E:\Users\me\AppData", "me", home="") == "/[REDACTED]\\AppData"


def test_a_name_never_cuts_into_a_longer_name():
    assert _redact_path("/home/hinata/x", "hina", home="") == "/home/hinata/x"
    assert (
        report._redact_output_dir(r"D:\SakaDataOld\x", r"D:\SakaData")
        == r"D:\SakaDataOld\x"
    )


@pytest.mark.parametrize("end", [".", "!", "?", "|", "。", "、", "！", "…", "`"])
def test_a_path_followed_by_punctuation_is_still_redacted(end):
    """A sentence or list may end right after a path; nothing of it may leak."""
    home = rf"Permission denied: C:\Users\alice{end} next"
    assert "alice" not in _redact_path(home, "alice", home="")
    out = report._redact_output_dir(rf"cannot open D:\SakaData{end}", r"D:\SakaData")
    assert "SakaData" not in out


@pytest.mark.parametrize("cont", ["nata", "_x", "-old", "2", "日本"])
def test_a_name_character_after_a_path_keeps_it_one_name(cont):
    assert _redact_path(f"/home/hina{cont}/x", "hina", home="") == (
        f"/home/hina{cont}/x"
    )
    assert (
        report._redact_output_dir(rf"D:\SakaData{cont}\x", r"D:\SakaData")
        == rf"D:\SakaData{cont}\x"
    )


@pytest.mark.parametrize("root", ["C:\\", "/", "", "C:"])
def test_a_bare_root_is_never_a_pattern(root):
    assert report._path_regex(root) is None
    assert report._redact_output_dir(r"C:\x and /y", root) == r"C:\x and /y"


@pytest.mark.parametrize(
    "secret",
    ["AIza" + "A1b2C3d4E5" * 3 + "F6g7h", "sk-" + "a1B2" * 6, "sk-proj-" + "Zz9_" * 6],
)
def test_provider_keys_are_scrubbed(secret):
    assert secret not in scrub_log_line(f"key={secret} done", "", [], None, home="")


def test_diagnostics_scrub_the_system_paths(monkeypatch):
    base = Path("C:/Users/Real Name/AppData/Local/SakaDesk")
    monkeypatch.setattr("backend.api.diagnostics.get_app_data_dir", lambda: base)
    monkeypatch.setattr(
        "backend.api.diagnostics.get_settings_path", lambda: base / "settings.json"
    )
    monkeypatch.setattr("backend.api.diagnostics.get_logs_dir", lambda: base / "logs")
    monkeypatch.setattr(report, "_home_text", lambda: HOME)
    body = TestClient(app).get("/api/diagnostics").json()
    assert "Real Name" not in json.dumps(body, ensure_ascii=False)
    assert body["system"]["logs_dir"].startswith("/[REDACTED]")


def test_long_backslash_runs_scrub_in_linear_time():
    """A separator run is bounded, so a line of backslashes cannot stall a report."""
    import time

    from backend.api.report import scrub_log_line

    line = "C:" + "\\" * 100_000 + "Users" + "\\" * 100_000 + "Alic"
    start = time.monotonic()
    scrub_log_line(line, "Alice", {}, None, home="C:\\Users\\Alice")
    assert time.monotonic() - start < 1.0


def test_json_escaped_osError_paths_are_still_redacted():
    """str(OSError) doubles backslashes and JSON doubles them again: up to 8 in a row."""
    from backend.api.report import scrub_log_line

    line = (
        '{"err": "C:\\\\\\\\\\\\\\\\Users\\\\\\\\\\\\\\\\Alice\\\\\\\\\\\\\\\\x.txt"}'
    )
    out = scrub_log_line(line, "Alice", {}, None, home="C:\\Users\\Alice")
    assert "Alice" not in out
