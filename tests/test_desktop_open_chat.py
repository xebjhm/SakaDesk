"""Tests for the toast-click -> open-chat handler built in desktop.py."""

from __future__ import annotations

import json
import types

from structlog.testing import capture_logs

import desktop
from backend.services.notification_planner import ChatTarget

TARGET = ChatTarget(
    service="hinatazaka46",
    path="日向坂46/messages/12 ひなた/34 金村 美玖",
    name="金村 美玖",
    is_group_chat=False,
)
PREFIX = "window.__sakadeskOpenChat ? (window.__sakadeskOpenChat("
SUFFIX = "), true) : false"


class _FakeWindow:
    def __init__(
        self,
        fail_on: str | None = None,
        js_result: object = True,
        native: object = None,
    ) -> None:
        self.calls: list[tuple[str, tuple]] = []
        self._fail_on = fail_on
        self._js_result = js_result
        self.native = native

    def _record(self, name: str, *args) -> None:
        self.calls.append((name, args))
        if name == self._fail_on:
            raise RuntimeError("boom 金村 secret")

    def restore(self) -> None:  # must never be called: it un-maximizes
        self._record("restore")

    def show(self) -> None:
        self._record("show")

    def evaluate_js(self, script: str) -> object:
        self._record("evaluate_js", script)
        return self._js_result


def _payload(script: str) -> dict:
    assert script.startswith(PREFIX) and script.endswith(SUFFIX)
    return json.loads(script[len(PREFIX) : -len(SUFFIX)])


def test_handler_shows_focuses_then_evaluates_js_without_restore():
    window = _FakeWindow()
    focused: list[object] = []
    handler = desktop.make_open_chat_handler(window, focused.append)

    with capture_logs() as logs:
        handler(TARGET)

    # No window.restore(): pywebview forces WindowState=Normal (un-maximizes).
    assert [c[0] for c in window.calls] == ["show", "evaluate_js"]
    assert focused == [None]  # no native handle -> focus falls back to FindWindow
    script = window.calls[1][1][0]
    assert _payload(script) == {
        "service": "hinatazaka46",
        "path": TARGET.path,
        "name": TARGET.name,
        "is_group_chat": False,
    }
    # ensure_ascii=False: CJK is sent verbatim, not \u-escaped.
    assert "金村" in script and "\\u" not in script

    (event,) = [e for e in logs if e["event"] == "notify_open_chat"]
    assert event["service"] == "hinatazaka46"
    assert event["is_group_chat"] is False
    assert event["delivered"] is True
    assert event["has_target"] is False


def test_handler_sends_the_message_id_to_jump_to():
    window = _FakeWindow()
    with capture_logs() as logs:
        desktop.make_open_chat_handler(window, lambda _h: None)(TARGET, 4321)
    payload = _payload(window.calls[1][1][0])
    assert payload["message_id"] == 4321
    assert isinstance(payload["message_id"], int)
    assert {k: v for k, v in payload.items() if k != "message_id"} == {
        "service": "hinatazaka46",
        "path": TARGET.path,
        "name": TARGET.name,
        "is_group_chat": False,
    }
    (event,) = [e for e in logs if e["event"] == "notify_open_chat"]
    assert event["has_target"] is True


def test_handler_without_message_id_omits_the_key():
    window = _FakeWindow()
    desktop.make_open_chat_handler(window, lambda _h: None)(TARGET, None)
    assert "message_id" not in _payload(window.calls[1][1][0])


def test_handler_passes_the_native_window_handle():
    class IntPtr:
        def ToInt64(self) -> int:
            return 0x1234

    window = _FakeWindow(native=types.SimpleNamespace(Handle=IntPtr()))
    focused: list[object] = []
    desktop.make_open_chat_handler(window, focused.append)(TARGET)
    assert focused == [0x1234]


def test_native_hwnd_variants():
    assert desktop._native_hwnd(types.SimpleNamespace(native=None)) is None
    assert desktop._native_hwnd(object()) is None
    plain = types.SimpleNamespace(native=types.SimpleNamespace(Handle=77))
    assert desktop._native_hwnd(plain) == 77

    class Broken:
        @property
        def Handle(self):
            raise RuntimeError("cross-thread")

    with capture_logs() as logs:
        assert desktop._native_hwnd(types.SimpleNamespace(native=Broken())) is None
    (unavailable,) = [
        e for e in logs if e["event"] == "window_native_handle_unavailable"
    ]
    assert unavailable["error_type"] == "RuntimeError"
    assert "cross-thread" not in str(unavailable)


def test_native_hwnd_none_handle_is_not_an_error():
    with capture_logs() as logs:
        assert desktop._native_hwnd(types.SimpleNamespace(native=None)) is None
    # no native form yet: the AttributeError on None.Handle is logged ...
    assert [e["event"] for e in logs] == ["window_native_handle_unavailable"]
    with capture_logs() as logs:
        none_handle = types.SimpleNamespace(native=types.SimpleNamespace(Handle=None))
        assert desktop._native_hwnd(none_handle) is None
    assert logs == []  # ... a None handle is not


def test_frontend_not_mounted_is_logged_as_not_ready():
    for result in (False, None):
        window = _FakeWindow(js_result=result)
        with capture_logs() as logs:
            desktop.make_open_chat_handler(window, lambda _h: None)(TARGET)
        assert not [e for e in logs if e["event"] == "notify_open_chat"]
        (failed,) = [e for e in logs if e["event"] == "notify_open_chat_failed"]
        assert failed["reason"] == "not_ready"
        assert failed["service"] == "hinatazaka46"


def test_handler_escapes_quotes_safely():
    window = _FakeWindow()
    tricky = ChatTarget("s", 'a"b</script>\\', "n'\n", True)
    desktop.make_open_chat_handler(window, lambda _h: None)(tricky)
    assert _payload(window.calls[1][1][0])["path"] == tricky.path


def test_handler_never_raises_and_logs_error_type_only():
    for fail_on in ("show", "evaluate_js"):
        window = _FakeWindow(fail_on=fail_on)
        handler = desktop.make_open_chat_handler(window, lambda _h: None)
        with capture_logs() as logs:
            handler(TARGET)  # must not raise
        failed = [e for e in logs if e["event"] == "notify_open_chat_failed"]
        assert len(failed) == 1
        assert failed[0]["error_type"] == "RuntimeError"
        assert "金村" not in repr(failed[0]) and "secret" not in repr(failed[0])
        assert not [e for e in logs if e["event"] == "notify_open_chat"]


def test_focus_failure_is_also_contained():
    window = _FakeWindow()

    def bad_focus(_hwnd) -> None:
        raise OSError("nope")

    with capture_logs() as logs:
        desktop.make_open_chat_handler(window, bad_focus)(TARGET)
    failed = [e for e in logs if e["event"] == "notify_open_chat_failed"]
    assert failed and failed[0]["error_type"] == "OSError"


# ------------------------------------------------------------- _focus_window


class _FakeUser32:
    def __init__(self, iconic: bool, found: int = 0, visible: bool = True) -> None:
        self.iconic = iconic
        self.found = found
        self.visible = visible
        self.calls: list[tuple] = []

    def FindWindowW(self, cls, title):
        self.calls.append(("FindWindowW", cls, title))
        return self.found

    def IsWindowVisible(self, hwnd):
        self.calls.append(("IsWindowVisible", hwnd))
        return 1 if self.visible else 0

    def IsIconic(self, hwnd):
        self.calls.append(("IsIconic", hwnd))
        return 1 if self.iconic else 0

    def ShowWindow(self, hwnd, cmd):
        self.calls.append(("ShowWindow", hwnd, cmd))
        return 1

    def SetForegroundWindow(self, hwnd):
        self.calls.append(("SetForegroundWindow", hwnd))
        return 1


def test_focus_logs_the_foreground_result():
    class Refused(_FakeUser32):
        def SetForegroundWindow(self, hwnd):
            return 0

    for user32, expected in (
        (_FakeUser32(iconic=False), True),
        (Refused(False), False),
    ):
        with capture_logs() as logs:
            desktop._focus_window(42, user32=user32)
        (focus,) = [e for e in logs if e["event"] == "window_focus"]
        assert focus["foreground"] is expected
        assert focus["source"] == "native" and focus["minimized"] is False


def test_configure_user32_declares_hwnd_and_bool_signatures():
    from ctypes import wintypes

    def fn():
        return types.SimpleNamespace(argtypes=None, restype=None)

    user32 = types.SimpleNamespace(
        IsIconic=fn(),
        IsWindowVisible=fn(),
        ShowWindow=fn(),
        SetForegroundWindow=fn(),
    )
    desktop._configure_user32(user32)
    assert user32.IsIconic.argtypes == [wintypes.HWND]
    assert user32.IsIconic.restype is wintypes.BOOL
    assert user32.IsWindowVisible.argtypes == [wintypes.HWND]
    assert user32.IsWindowVisible.restype is wintypes.BOOL
    assert user32.ShowWindow.argtypes[0] is wintypes.HWND
    assert user32.ShowWindow.restype is wintypes.BOOL
    assert user32.SetForegroundWindow.argtypes == [wintypes.HWND]
    assert user32.SetForegroundWindow.restype is wintypes.BOOL


def test_focus_minimized_window_is_restored():
    u = _FakeUser32(iconic=True)
    desktop._focus_window(42, user32=u)
    assert u.calls == [
        ("IsWindowVisible", 42),
        ("IsIconic", 42),
        ("ShowWindow", 42, desktop._SW_RESTORE),
        ("SetForegroundWindow", 42),
    ]


def test_focus_maximized_or_normal_window_keeps_its_state():
    u = _FakeUser32(iconic=False)
    desktop._focus_window(42, user32=u)
    assert u.calls == [
        ("IsWindowVisible", 42),
        ("IsIconic", 42),
        ("ShowWindow", 42, desktop._SW_SHOW),  # never SW_RESTORE: keeps maximized
        ("SetForegroundWindow", 42),
    ]
    assert desktop._SW_SHOW == 5 and desktop._SW_RESTORE == 9


def test_focus_hidden_window_is_shown():
    u = _FakeUser32(iconic=False, visible=False)
    with capture_logs() as logs:
        desktop._focus_window(42, user32=u)
    assert ("ShowWindow", 42, desktop._SW_SHOW) in u.calls
    (focus,) = [e for e in logs if e["event"] == "window_focus"]
    assert focus["visible"] is False and focus["minimized"] is False


def test_focus_hidden_and_minimized_window_is_restored():
    u = _FakeUser32(iconic=True, visible=False)
    desktop._focus_window(42, user32=u)
    assert ("ShowWindow", 42, desktop._SW_RESTORE) in u.calls


def test_focus_without_handle_finds_the_window_by_title():
    u = _FakeUser32(iconic=False, found=7)
    desktop._focus_window(None, user32=u)
    assert u.calls[0] == ("FindWindowW", None, "SakaDesk")
    assert u.calls[-1] == ("SetForegroundWindow", 7)


def test_focus_with_no_window_does_nothing_and_logs():
    u = _FakeUser32(iconic=False, found=0)
    with capture_logs() as logs:
        desktop._focus_window(None, user32=u)
    assert u.calls == [("FindWindowW", None, "SakaDesk")]
    (skip,) = [e for e in logs if e["event"] == "window_focus_skipped"]
    assert skip["reason"] == "no_window"


def test_focus_never_raises():
    class Boom(_FakeUser32):
        def IsIconic(self, hwnd):
            raise OSError("access denied")

    with capture_logs() as logs:
        desktop._focus_window(42, user32=Boom(iconic=False))
    (failed,) = [e for e in logs if e["event"] == "window_focus_failed"]
    assert failed["error_type"] == "OSError"


def test_focus_is_a_noop_off_windows(monkeypatch):
    monkeypatch.setattr(desktop.platform, "system", lambda: "Linux")
    desktop._focus_window(42)  # no ctypes.windll on Linux: must simply return
    desktop._focus_existing_window()


LOGIN_SCRIPT = 'window.__sakadeskOpenLogin ? window.__sakadeskOpenLogin("sakurazaka46") === true : false'


def test_login_handler_shows_focuses_and_asks_the_frontend():
    window = _FakeWindow()
    focused: list[object] = []
    handler = desktop.make_open_login_handler(window, focused.append)
    with capture_logs() as logs:
        handler("sakurazaka46")
    assert [c[0] for c in window.calls] == ["show", "evaluate_js"]
    assert window.calls[1][1] == (LOGIN_SCRIPT,)
    assert len(focused) == 1
    assert {
        "event": "notify_open_login",
        "service": "sakurazaka46",
        "delivered": True,
        "log_level": "info",
    } in logs


def test_login_handler_logs_not_ready_when_the_frontend_returns_false():
    handler = desktop.make_open_login_handler(
        _FakeWindow(js_result=False), lambda _h: None
    )
    with capture_logs() as logs:
        handler("sakurazaka46")
    assert any(
        e["event"] == "notify_open_login_failed"
        and e["reason"] == "not_ready"
        and e["service"] == "sakurazaka46"
        for e in logs
    )


def test_login_handler_never_raises_and_logs_only_the_error_type():
    handler = desktop.make_open_login_handler(
        _FakeWindow(fail_on="show"), lambda _h: None
    )
    with capture_logs() as logs:
        handler("sakurazaka46")
    failed = [e for e in logs if e["event"] == "notify_open_login_failed"]
    assert failed and failed[0]["error_type"] == "RuntimeError"
    assert "secret" not in str(logs)


def test_login_handler_quotes_a_hostile_service_id_safely():
    window = _FakeWindow()
    desktop.make_open_login_handler(window, lambda _h: None)('x");alert(1);("')
    assert json.dumps('x");alert(1);("') in window.calls[1][1][0]
