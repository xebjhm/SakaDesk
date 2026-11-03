"""autostart: HKCU Run value management behind a fake registry seam."""

import sys
from pathlib import Path

import pytest
from structlog.testing import capture_logs

from backend.services import autostart

EXE = Path("C:/Users/金村/AppData/Local/SakaDesk/SakaDesk.exe")
OTHER_EXE = Path("D:/Apps/SakaDesk/SakaDesk.exe")


class FakeReg:
    def __init__(self, value=None, *, fail_on=None):
        self.value = value
        self.fail_on = fail_on
        self.calls: list[str] = []

    def read(self):
        self.calls.append("read")
        if self.fail_on == "read":
            raise OSError("denied C:/secret")
        return self.value

    def write(self, data):
        self.calls.append("write")
        if self.fail_on == "write":
            raise PermissionError("denied C:/secret")
        self.value = data

    def delete(self):
        self.calls.append("delete")
        if self.fail_on == "delete":
            raise PermissionError("denied")
        self.value = None


def _events(logs):
    return [e for e in logs if e["event"] == "autostart"]


def test_command_quotes_exe_and_adds_background() -> None:
    assert autostart.build_command(EXE) == f'"{EXE}" --background'


def test_constants() -> None:
    assert autostart.RUN_KEY == r"Software\Microsoft\Windows\CurrentVersion\Run"
    assert autostart.VALUE_NAME == "SakaDesk"


@pytest.mark.parametrize("fn", [autostart.apply, autostart.reconcile])
def test_dev_run_is_skipped_and_touches_nothing(fn) -> None:
    reg = FakeReg()
    with capture_logs() as logs:
        assert fn(True, frozen=False, exe=EXE, reg=reg) == "skipped_dev"
    assert reg.calls == []
    assert _events(logs)[0]["action"] == "skipped_dev"


def test_apply_enabled_writes_the_command() -> None:
    reg = FakeReg()
    with capture_logs() as logs:
        assert autostart.apply(True, frozen=True, exe=EXE, reg=reg) == "enabled"
    assert reg.value == f'"{EXE}" --background'
    (e,) = _events(logs)
    assert e["action"] == "enabled"
    assert "金村" not in repr(logs) and "AppData" not in repr(logs)


def test_apply_disabled_deletes_the_value() -> None:
    reg = FakeReg(value="x")
    with capture_logs() as logs:
        assert autostart.apply(False, frozen=True, exe=EXE, reg=reg) == "disabled"
    assert reg.value is None
    assert _events(logs)[0]["action"] == "disabled"


@pytest.mark.parametrize("enabled,fail_on", [(True, "write"), (False, "delete")])
def test_apply_failure_is_logged_without_raising_or_paths(enabled, fail_on) -> None:
    reg = FakeReg(value="x", fail_on=fail_on)
    with capture_logs() as logs:
        assert autostart.apply(enabled, frozen=True, exe=EXE, reg=reg) == "failed"
    (e,) = _events(logs)
    assert e["action"] == "failed"
    assert e["error_type"] == "PermissionError"
    assert "secret" not in repr(logs) and "金村" not in repr(logs)


def test_reconcile_enabled_and_matching_is_ok() -> None:
    reg = FakeReg(value=autostart.build_command(EXE))
    with capture_logs() as logs:
        assert autostart.reconcile(True, frozen=True, exe=EXE, reg=reg) == "ok"
    assert "write" not in reg.calls
    assert _events(logs)[0]["action"] == "ok"


def test_reconcile_enabled_missing_value_is_repaired() -> None:
    reg = FakeReg(value=None)
    assert autostart.reconcile(True, frozen=True, exe=EXE, reg=reg) == "repaired"
    assert reg.value == autostart.build_command(EXE)


def test_reconcile_enabled_wrong_path_is_repaired() -> None:
    reg = FakeReg(value=autostart.build_command(OTHER_EXE))
    assert autostart.reconcile(True, frozen=True, exe=EXE, reg=reg) == "repaired"
    assert reg.value == autostart.build_command(EXE)


def test_reconcile_disabled_removes_a_stale_value() -> None:
    reg = FakeReg(value=autostart.build_command(EXE))
    assert autostart.reconcile(False, frozen=True, exe=EXE, reg=reg) == "disabled"
    assert reg.value is None


def test_reconcile_disabled_without_value_is_ok() -> None:
    reg = FakeReg(value=None)
    assert autostart.reconcile(False, frozen=True, exe=EXE, reg=reg) == "ok"
    assert "delete" not in reg.calls


@pytest.mark.parametrize("fail_on", ["read", "write"])
def test_reconcile_failure_never_raises(fail_on) -> None:
    reg = FakeReg(value=None, fail_on=fail_on)
    with capture_logs() as logs:
        assert autostart.reconcile(True, frozen=True, exe=EXE, reg=reg) == "failed"
    e = _events(logs)[-1]
    assert e["action"] == "failed"
    assert e["error_type"] in ("OSError", "PermissionError")
    assert "secret" not in repr(logs)


def test_default_registry_failure_off_windows_is_failed_not_raised() -> None:
    """Without an injected seam, the lazy winreg import fails on Linux."""
    if sys.platform == "win32":
        pytest.skip("winreg is available on Windows")
    with capture_logs() as logs:
        assert autostart.apply(True, frozen=True, exe=EXE) == "failed"
    assert _events(logs)[0]["error_type"] == "ModuleNotFoundError"


def test_winreg_registry_uses_hkcu_run_key(monkeypatch) -> None:
    """The real seam talks to winreg with the Run key and value name."""
    import types

    calls: list = []

    class Key:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    fake = types.SimpleNamespace(
        HKEY_CURRENT_USER="HKCU",
        KEY_READ=1,
        KEY_SET_VALUE=2,
        REG_SZ=3,
    )
    fake.OpenKey = lambda root, sub, res, access: (
        calls.append(("open", root, sub, access)) or Key()
    )
    fake.QueryValueEx = lambda key, name: (calls.append(("q", name)) or ("v", 3))
    fake.SetValueEx = lambda key, name, r, t, data: calls.append(("set", name, t, data))
    fake.DeleteValue = lambda key, name: calls.append(("del", name))
    monkeypatch.setitem(sys.modules, "winreg", fake)

    reg = autostart.WinregRegistry()
    assert reg.read() == "v"
    reg.write("cmd")
    reg.delete()
    assert ("open", "HKCU", autostart.RUN_KEY, 1) in calls
    assert ("open", "HKCU", autostart.RUN_KEY, 2) in calls
    assert ("set", "SakaDesk", 3, "cmd") in calls
    assert ("del", "SakaDesk") in calls


def test_winreg_registry_read_missing_value_is_none(monkeypatch) -> None:
    import types

    class Key:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def missing(key, name):
        raise FileNotFoundError

    fake = types.SimpleNamespace(
        HKEY_CURRENT_USER="HKCU", KEY_READ=1, KEY_SET_VALUE=2, REG_SZ=3
    )
    fake.OpenKey = lambda *a: Key()
    fake.QueryValueEx = missing
    monkeypatch.setitem(sys.modules, "winreg", fake)
    assert autostart.WinregRegistry().read() is None


def test_winreg_registry_delete_missing_value_is_not_an_error(monkeypatch) -> None:
    import types

    class Key:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def missing(key, name):
        raise FileNotFoundError

    fake = types.SimpleNamespace(
        HKEY_CURRENT_USER="HKCU", KEY_READ=1, KEY_SET_VALUE=2, REG_SZ=3
    )
    fake.OpenKey = lambda *a: Key()
    fake.DeleteValue = missing
    monkeypatch.setitem(sys.modules, "winreg", fake)
    autostart.WinregRegistry().delete()
