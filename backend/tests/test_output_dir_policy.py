"""Which folders may become the archive root, and how a saved value is read
(security audit 2026-11-13, backend/api/settings.py:output-dir-unvalidated-archive-trust-root;
report-hardening: an empty output_dir became the process cwd for the sync writer).
"""

from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.main import app
from backend.services import output_dir_policy as policy
from backend.services import path_resolver

client = TestClient(app)


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    """A home, an app data folder and a Windows folder of our own; system variables cleared."""
    home = tmp_path / "home" / "user"
    app_dir = home / "AppData" / "Local" / "SakaDesk"
    windows = tmp_path / "Windows"
    for folder in (home, app_dir, windows):
        folder.mkdir(parents=True)
    monkeypatch.setattr(policy, "_home", lambda: home)
    monkeypatch.setattr(policy, "get_app_data_dir", lambda: app_dir)
    for name in policy._SYSTEM_DIR_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("SystemRoot", str(windows))
    return {"root": tmp_path, "home": home, "app": app_dir, "windows": windows}


@pytest.fixture(autouse=True)
def _fresh_notes():
    path_resolver.reset_output_dir_notes_for_tests()
    yield
    path_resolver.reset_output_dir_notes_for_tests()


@pytest.mark.parametrize(
    "raw,reason",
    [
        (None, "invalid"),
        (5, "invalid"),
        ("", "invalid"),
        ("x" * 1025, "invalid"),
        ("C:\\a\nb", "invalid"),
        ("/tmp/a\x00", "invalid"),
        ("\\\\?\\C:\\SakaDesk", "device"),
        ("//./pipe/x", "device"),
        ("\\\\attacker.invalid\\share", "network"),
        ("//host/share/x", "network"),
        ("C:\\", "root"),
        ("C:/", "root"),
        ("D:\\..", "root"),
        ("C:SakaDesk", "relative"),
        ("SakaDesk", "relative"),
        ("./out", "relative"),
    ],
)
def test_lexical_problems(raw, reason):
    assert policy.lexical_problem(raw) == reason


@pytest.mark.skipif(os.name == "nt", reason="a lone slash is not absolute on Windows")
@pytest.mark.parametrize("raw", ["/", "/tmp/.."])
def test_posix_roots(raw):
    # Windows has its own roots: the "C:\\" cases above.
    assert policy.lexical_problem(raw) == "root"


def test_an_absolute_folder_has_no_lexical_problem(tmp_path):
    assert policy.lexical_problem(str(tmp_path / "SakaDesk")) is None


def test_a_good_folder_is_created_and_normalised(sandbox):
    target = sandbox["home"] / "Documents" / "SakaDesk"
    raw = str(sandbox["home"] / "Documents" / "x" / ".." / "SakaDesk")
    assert policy.check_output_dir(raw) == str(target)
    assert target.is_dir()
    assert list(target.iterdir()) == []  # the probe file is gone


@pytest.mark.parametrize(
    "pick,reason",
    [
        (lambda s: s["home"], "profile"),
        (lambda s: s["home"].parent, "profile"),
        (lambda s: s["app"], "app_data"),
        (lambda s: s["app"] / "logs", "app_data"),
        (lambda s: s["app"].parent, "app_data"),
        (lambda s: s["app"].parent / "Programs" / "SakaDesk", "app_data"),
        (lambda s: s["app"].parent / "Programs", "app_data"),
        (lambda s: s["home"] / "AppData" / "Roaming" / "pysaka", "app_data"),
        (lambda s: s["home"] / "AppData" / "Roaming" / "pysaka" / "auth", "app_data"),
        (lambda s: s["windows"], "system"),
        (lambda s: s["windows"] / "Temp" / "x", "system"),
    ],
)
def test_protected_folders_are_refused(sandbox, pick, reason):
    with pytest.raises(policy.OutputDirRejected) as exc:
        policy.check_output_dir(str(pick(sandbox)))
    assert exc.value.reason == reason


def test_a_link_into_the_app_data_folder_is_refused(sandbox):
    link = sandbox["root"] / "innocent"
    try:
        link.symlink_to(sandbox["app"], target_is_directory=True)
    except OSError:
        pytest.skip("creating symlinks needs extra rights here")
    with pytest.raises(policy.OutputDirRejected) as exc:
        policy.check_output_dir(str(link / "archive"))
    assert exc.value.reason == "app_data"


def test_a_folder_that_cannot_be_written_is_refused(sandbox, monkeypatch):
    def deny(*_a, **_k):
        raise PermissionError("denied")

    monkeypatch.setattr(policy.tempfile, "mkstemp", deny)
    with pytest.raises(policy.OutputDirRejected) as exc:
        policy.check_output_dir(str(sandbox["root"] / "read-only"))
    assert exc.value.reason == "not_writable"


def test_a_lexical_problem_is_raised_before_any_filesystem_call(monkeypatch):
    def boom(*_a, **_k):
        raise AssertionError("filesystem reached")

    monkeypatch.setattr(Path, "resolve", boom)
    with pytest.raises(policy.OutputDirRejected) as exc:
        policy.check_output_dir("\\\\attacker.invalid\\share")
    assert exc.value.reason == "network"


def test_same_dir_ignores_dots_and_trailing_separators():
    assert policy.same_dir("/a/b/", "/a/b")
    assert policy.same_dir("/a/x/../b", "/a/b")
    assert not policy.same_dir("/a/b", "/a/c")


@pytest.mark.parametrize("value", [None, "", 5, ["x"]])
def test_an_unset_output_dir_means_the_default(value, tmp_path):
    assert path_resolver.output_dir_value(value, tmp_path) == tmp_path


def test_a_saved_value_is_used_as_saved(tmp_path):
    with capture_logs() as logs:
        assert path_resolver.output_dir_value(str(tmp_path / "a"), Path("/d")) == (
            tmp_path / "a"
        )
    assert logs == []


def test_an_unusual_saved_value_is_kept_and_logged_once_without_the_value():
    legacy = "\\\\nas\\share\\SakaDesk"
    with capture_logs() as logs:
        for _ in range(3):
            assert path_resolver.output_dir_value(legacy, Path("/d")) == Path(legacy)
    events = [e for e in logs if e["event"] == "output_dir_saved_unusual"]
    assert [e["reason"] for e in events] == ["network"]
    assert "nas" not in str(logs)


@pytest.mark.parametrize("value", ["", "   ", "\t\n", 5, ["a"], {"x": 1}])
def test_an_empty_or_non_string_saved_value_is_the_default_and_logged_once(value):
    default = Path("/d")
    with capture_logs() as logs:
        for _ in range(3):
            assert path_resolver.output_dir_value(value, default) == default
    events = [e for e in logs if e["event"] == "output_dir_defaulted"]
    expected = "not_string" if not isinstance(value, str) else "empty"
    assert [e["reason"] for e in events] == [expected]
    assert str(value) not in str(logs) or str(value).strip() == ""


def test_a_missing_or_null_saved_value_is_the_default_without_a_note():
    with capture_logs() as logs:
        assert path_resolver.output_dir_value(None, Path("/d")) == Path("/d")
    assert not [e for e in logs if e["event"].startswith("output_dir_")]


def test_the_empty_and_the_non_string_notes_are_separate_once_only_entries():
    with capture_logs() as logs:
        path_resolver.output_dir_value("", Path("/d"))
        path_resolver.output_dir_value(5, Path("/d"))
        path_resolver.output_dir_value(" ", Path("/d"))
        path_resolver.output_dir_value(7, Path("/d"))
    assert [e["reason"] for e in logs if e["event"] == "output_dir_defaulted"] == [
        "empty",
        "not_string",
    ]


def test_a_settings_file_with_an_empty_output_dir_gives_the_default(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text('{"output_dir": ""}', encoding="utf-8")
    default = tmp_path / "default"
    assert path_resolver.output_dir_from_settings(settings, default) == default


def test_sync_uses_the_default_for_an_empty_output_dir(tmp_path, monkeypatch):
    from backend.services import sync_service

    monkeypatch.setattr(
        sync_service, "get_default_output_dir", lambda: tmp_path / "default"
    )
    svc = sync_service.SyncService("hinatazaka46")
    svc._resolve_service_paths({"output_dir": ""})
    assert svc.output_dir == tmp_path / "default"
    assert svc.service_data_dir == tmp_path / "default" / "日向坂46"


@pytest.mark.asyncio
async def test_sync_get_output_dir_uses_the_default_for_an_empty_value(
    tmp_path, monkeypatch
):
    from backend.services import sync_service

    monkeypatch.setattr(
        sync_service, "get_default_output_dir", lambda: tmp_path / "default"
    )
    svc = sync_service.SyncService("hinatazaka46")

    async def settings():
        return {"output_dir": ""}

    monkeypatch.setattr(svc, "load_app_settings", settings)
    assert await svc.get_output_dir() == tmp_path / "default"


def test_settings_and_fresh_check_report_the_default_for_an_empty_value(tmp_path):
    config = {
        "output_dir": "",
        "auto_sync_enabled": True,
        "sync_interval_minutes": 15,
        "adaptive_sync_enabled": True,
        "is_configured": True,
        "notifications_enabled": True,
        "blogs_full_backup": False,
        "auto_download_updates": False,
    }
    with (
        patch("backend.api.settings._store_load", AsyncMock(return_value=config)),
        patch("backend.api.settings.set_notifications_enabled"),
        patch(
            "backend.api.settings.get_default_output_dir", return_value=str(tmp_path)
        ),
    ):
        settings = client.get("/api/settings").json()
        fresh = client.get("/api/settings/fresh").json()
    assert settings["output_dir"] == str(tmp_path)
    assert fresh["output_dir"] == str(tmp_path)
