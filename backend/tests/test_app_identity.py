"""Tests for the Start Menu shortcut / AUMID registration (fake ShellLinks)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from structlog.testing import capture_logs

from backend.services import app_identity
from backend.services.app_identity import (
    AUMID,
    SHORTCUT_NAME,
    ensure_start_menu_shortcut,
    set_process_aumid,
)

EXE = Path("C:/secret-dir/SakaDesk/SakaDesk.exe")


class FakeLinks:
    def __init__(self, existing: dict[Path, str | None] | None = None) -> None:
        self.files: dict[Path, str | None] = dict(existing or {})
        self.calls: list[tuple] = []
        self.fail_with: Exception | None = None

    def _maybe_fail(self) -> None:
        if self.fail_with is not None:
            raise self.fail_with

    def exists(self, path: Path) -> bool:
        self._maybe_fail()
        return path in self.files

    def read_aumid(self, path: Path) -> str | None:
        self.calls.append(("read_aumid", path))
        return self.files[path]

    def create(self, path: Path, target: Path, workdir: Path, aumid: str) -> None:
        self.calls.append(("create", path, target, workdir, aumid))
        self.files[path] = aumid

    def set_aumid(self, path: Path, aumid: str) -> None:
        self.calls.append(("set_aumid", path, aumid))
        self.files[path] = aumid


PROGRAMS = Path("C:/Users/x/AppData/Roaming/Microsoft/Windows/Start Menu/Programs")
LNK = PROGRAMS / SHORTCUT_NAME


def _ensure(links: FakeLinks, frozen: bool = True) -> tuple[str, list[dict]]:
    with capture_logs() as logs:
        result = ensure_start_menu_shortcut(
            frozen=frozen, exe=EXE, programs_dir=PROGRAMS, links=links
        )
    return result, [e for e in logs if e["event"] == "app_identity"]


def test_aumid_value() -> None:
    assert AUMID == "SakaDesk"
    from backend.services import notification_service

    assert notification_service.AUMID is AUMID


def test_dev_run_skips() -> None:
    links = FakeLinks()
    result, logs = _ensure(links, frozen=False)
    assert result == "skipped_dev"
    assert links.calls == []
    assert [e["action"] for e in logs] == ["skipped_dev"]


def test_missing_shortcut_is_created_with_target_and_aumid() -> None:
    links = FakeLinks()
    result, logs = _ensure(links)
    assert result == "created"
    assert links.calls == [("create", LNK, EXE, EXE.parent, AUMID)]
    assert [e["action"] for e in logs] == ["created"]


@pytest.mark.parametrize("current", [None, "Some.Other.Id"])
def test_existing_shortcut_without_our_aumid_only_sets_aumid(current) -> None:
    links = FakeLinks({LNK: current})
    result, logs = _ensure(links)
    assert result == "updated"
    assert ("set_aumid", LNK, AUMID) in links.calls
    assert not any(c[0] == "create" for c in links.calls)
    assert [e["action"] for e in logs] == ["updated"]


def test_existing_shortcut_with_aumid_is_ok() -> None:
    links = FakeLinks({LNK: AUMID})
    result, logs = _ensure(links)
    assert result == "ok"
    assert links.calls == [("read_aumid", LNK)]
    assert [e["action"] for e in logs] == ["ok"]


def test_failure_returns_failed_logs_type_and_never_raises() -> None:
    links = FakeLinks()
    links.fail_with = OSError("C:/secret-dir boom")
    result, logs = _ensure(links)
    assert result == "failed"
    assert len(logs) == 1
    assert logs[0]["action"] == "failed"
    assert logs[0]["error_type"] == "OSError"
    assert "secret" not in repr(logs)


def test_com_error_logs_hresult() -> None:
    class com_error(Exception):  # noqa: N801 - mimics pywintypes.com_error
        pass

    links = FakeLinks()
    links.fail_with = com_error(-2147467259, "Unspecified error", None, None)
    result, logs = _ensure(links)
    assert result == "failed"
    assert logs[0]["hresult"] == -2147467259
    assert logs[0]["error_type"] == "com_error"
    assert "Unspecified" not in repr(logs)


def test_non_com_failure_has_no_hresult() -> None:
    links = FakeLinks()
    links.fail_with = OSError(5, "denied")  # args[0] is an int but not a COM error
    _, logs = _ensure(links)
    assert "hresult" not in logs[0]


def test_logs_never_contain_paths() -> None:
    links = FakeLinks()
    _, logs = _ensure(links)
    assert "secret-dir" not in repr(logs)
    assert "Users" not in repr(logs)


def test_default_links_failure_does_not_raise(monkeypatch) -> None:
    def boom():
        raise ImportError("no pywin32")

    monkeypatch.setattr(app_identity, "PyWin32ShellLinks", boom)
    with capture_logs() as logs:
        result = ensure_start_menu_shortcut(frozen=True, exe=EXE, programs_dir=PROGRAMS)
    assert result == "failed"
    assert logs[-1]["error_type"] == "ImportError"


def test_set_process_aumid_noop_off_windows(monkeypatch) -> None:
    monkeypatch.setattr(sys, "platform", "linux")
    with capture_logs() as logs:
        set_process_aumid()
    assert logs == []


def test_set_process_aumid_calls_shell32_on_windows(monkeypatch) -> None:
    import types

    calls = []
    shell32 = types.SimpleNamespace(
        SetCurrentProcessExplicitAppUserModelID=lambda v: calls.append(v) or 0
    )
    fake_ctypes = types.SimpleNamespace(windll=types.SimpleNamespace(shell32=shell32))
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setattr(app_identity, "_ctypes", lambda: fake_ctypes)
    with capture_logs() as logs:
        set_process_aumid()
    assert calls == [AUMID]
    assert logs[-1]["event"] == "app_identity"
    assert logs[-1]["action"] == "process_aumid_set"


def test_set_process_aumid_failure_is_logged_not_raised(monkeypatch) -> None:
    def boom():
        raise AttributeError("no windll")

    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setattr(app_identity, "_ctypes", boom)
    with capture_logs() as logs:
        set_process_aumid()
    assert logs[-1]["action"] == "process_aumid_failed"
    assert logs[-1]["error_type"] == "AttributeError"


def test_set_process_aumid_nonzero_hresult_is_logged(monkeypatch) -> None:
    import types

    shell32 = types.SimpleNamespace(
        SetCurrentProcessExplicitAppUserModelID=lambda v: -2147024809
    )
    fake_ctypes = types.SimpleNamespace(windll=types.SimpleNamespace(shell32=shell32))
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setattr(app_identity, "_ctypes", lambda: fake_ctypes)
    with capture_logs() as logs:
        set_process_aumid()
    assert logs[-1]["action"] == "process_aumid_failed"
    assert logs[-1]["error_type"] == "HRESULT"
