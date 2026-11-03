"""CallPopupWindow, driven through fakes for pywebview, user32 and dwmapi.

The real window is Windows-only; nothing here imports pywebview, ``ctypes.windll``
or pythonnet.
"""

from __future__ import annotations

import json
import threading

import pytest
from structlog.testing import capture_logs

import call_popup_window as cpw
from backend.services.desktop_bridge import HeardTarget


class FakeEvent:
    def __init__(self, auto: bool = False):
        self.handlers, self._e = [], threading.Event()
        if auto:
            self._e.set()

    def __iadd__(self, h):
        self.handlers.append(h)
        return self

    def set(self, *a):
        self._e.set()
        for h in list(self.handlers):
            h(*a)

    def is_set(self):
        return self._e.is_set()

    def wait(self, timeout=None):
        return self._e.wait(timeout)


class Events:
    def __init__(self, loads: bool):
        self.loaded, self.closed, self.before_show = (
            FakeEvent(auto=loads),
            FakeEvent(),
            FakeEvent(),
        )


class FakeWindow:
    def __init__(
        self, *, loads=True, js_result=True, hwnd=0x1234, close_on_destroy=True
    ):
        self.events, self.js, self.js_result = Events(loads), [], js_result
        self.hidden = self.shown = 0
        self.close_on_destroy = close_on_destroy
        self.destroyed = 0
        self.native = type("N", (), {"Handle": hwnd})()

    def evaluate_js(self, script):
        self.js.append(script)
        return self.js_result

    def hide(self):
        self.hidden += 1

    def show(self):
        self.shown += 1

    def destroy(self):
        self.destroyed += 1
        if self.close_on_destroy:
            self.events.closed.set()


class FakeUser32:
    def __init__(self):
        self.calls, self.exstyle = [], 0

    def GetWindowLongW(self, hwnd, idx):
        self.calls.append(("GetWindowLongW", hwnd, idx))
        return self.exstyle

    def SetWindowLongW(self, hwnd, idx, val):
        self.calls.append(("SetWindowLongW", hwnd, idx, val))
        return 0

    def ShowWindow(self, hwnd, cmd):
        self.calls.append(("ShowWindow", hwnd, cmd))
        return 1

    def SetWindowPos(self, *a):
        self.calls.append(("SetWindowPos", *a))
        return 1

    def IsWindowVisible(self, hwnd):
        return 1


class FakeDwm:
    def __init__(self, hr=0):
        self.calls, self.hr = [], hr

    def DwmSetWindowAttribute(self, hwnd, attr, ptr, size):
        self.calls.append((hwnd, attr, ptr._obj.value, size))
        return self.hr


def make(windows, **kw):
    created, exits = [], []
    it = iter(windows)

    def create_window(**kwargs):
        created.append(kwargs)
        return next(it)

    w = cpw.CallPopupWindow(
        main_window=kw.pop("main", FakeWindow()),
        url="http://127.0.0.1:1/?view=call-popup",
        is_quitting=kw.pop("quitting", lambda: False),
        create_window=create_window,
        user32=kw.pop("user32", FakeUser32()),
        dwmapi=kw.pop("dwm", FakeDwm()),
        work_area=lambda: cpw.Rect(0, 0, 1920, 1040),
        system_dpi=lambda: 96,
        app_exit=lambda: exits.append(1),
        load_timeout=0.05,
        destroy_timeout=0.05,
        **kw,
    )
    return w, created, exits


def actions(logs):
    return [e.get("action") for e in logs if e["event"] == "call_popup_window"]


# ---------------------------------------------------------------- popup_rect

AREAS = [
    cpw.Rect(0, 0, 1920, 1040),  # bottom taskbar
    cpw.Rect(0, 40, 1920, 1080),  # top taskbar
    cpw.Rect(60, 0, 1920, 1080),  # left taskbar
    cpw.Rect(0, 0, 1860, 1080),  # right taskbar
]


@pytest.mark.parametrize("dpi", [96, 120, 144, 192])
@pytest.mark.parametrize("area", AREAS)
def test_popup_rect_bottom_right_at_9_16(area, dpi):
    r = cpw.popup_rect(area, dpi)
    margin = round(12 * dpi / 96)
    assert r.width == round(300 * dpi / 96)
    assert abs(r.height - r.width * 16 / 9) <= 0.5
    assert r.right == area.right - margin
    assert r.bottom == area.bottom - margin


def test_popup_rect_spot_values():
    assert cpw.popup_rect(cpw.Rect(0, 0, 1920, 1040), 96) == cpw.Rect(
        1608, 495, 1908, 1028
    )
    r = cpw.popup_rect(cpw.Rect(0, 0, 3840, 2100), 144)
    assert (r.width, r.height) == (450, 800)


def test_rect_width_height():
    r = cpw.Rect(10, 20, 110, 220)
    assert (r.width, r.height) == (100, 200)


def test_constants():
    assert cpw.TITLE == "SakaDesk Call"
    assert cpw.BACKGROUND_COLOR == "#0D0F14"
    assert (cpw.POPUP_WIDTH_DIP, cpw.POPUP_MARGIN_DIP) == (300, 12)
    assert cpw.POPUP_LOAD_TIMEOUT_S == 15.0
    assert cpw.DESTROY_TIMEOUT_S == 3.0
    assert cpw.MAX_CREATE_FAILURES == 2


# ---------------------------------------------------------------- ensure


def test_ensure_creates_once_with_exact_arguments_then_reuses():
    w, created, _ = make([FakeWindow()])
    with capture_logs() as logs:
        assert w.ensure() is True
        assert w.ensure() is True
    assert created == [
        dict(
            title="SakaDesk Call",
            url="http://127.0.0.1:1/?view=call-popup",
            width=300,
            height=533,
            resizable=False,
            frameless=True,
            easy_drag=False,
            focus=False,
            on_top=True,
            hidden=True,
            shadow=True,
            background_color="#0D0F14",
        )
    ]
    assert actions(logs) == ["created", "reused"]
    assert w.available() is True


def test_ensure_applies_toolwindow_and_corner_styles():
    user32, dwm = FakeUser32(), FakeDwm()
    user32.exstyle = 0x08000000
    w, _, _ = make([FakeWindow()], user32=user32, dwm=dwm)
    assert w.ensure() is True
    assert ("SetWindowLongW", 0x1234, -20, 0x08000000 | 0x80) in user32.calls
    assert dwm.calls == [(0x1234, 33, 2, 4)]


def test_ensure_ignores_a_failing_corner_preference():
    w, _, _ = make([FakeWindow()], dwm=FakeDwm(hr=-2147024809))
    with capture_logs() as logs:
        assert w.ensure() is True
    skipped = [e for e in logs if e["event"] == "call_popup_corner_skipped"]
    assert skipped and skipped[0]["log_level"] == "debug"


def test_ensure_ignores_a_raising_corner_preference():
    class RaisingDwm:
        def DwmSetWindowAttribute(self, *a):
            raise OSError("no dwm")

    w, _, _ = make([FakeWindow()], dwm=RaisingDwm())
    with capture_logs() as logs:
        assert w.ensure() is True
    skipped = [e for e in logs if e["event"] == "call_popup_corner_skipped"]
    assert skipped[0]["error_type"] == "OSError"


def test_ensure_styles_through_before_show_when_no_hwnd_yet():
    user32, dwm = FakeUser32(), FakeDwm()
    win = FakeWindow(hwnd=None)
    w, _, _ = make([win], user32=user32, dwm=dwm)
    assert w.ensure() is True
    assert user32.calls == [] and dwm.calls == []
    win.native.Handle = 0x1234
    win.events.before_show.set()
    assert ("SetWindowLongW", 0x1234, -20, 0x80) in user32.calls
    assert dwm.calls == [(0x1234, 33, 2, 4)]


def test_hwnd_of_reads_intptr_and_survives_errors():
    class IntPtr:
        def ToInt64(self):
            return 0xABCDEF012345

    win = FakeWindow(hwnd=IntPtr())
    assert cpw._hwnd_of(win) == 0xABCDEF012345
    assert cpw._hwnd_of(None) is None

    class Broken:
        @property
        def native(self):
            raise RuntimeError("cross-thread")

    assert cpw._hwnd_of(Broken()) is None


def test_ensure_load_timeout_fails_and_destroys_half_made_window():
    win = FakeWindow(loads=False)
    w, _, _ = make([win])
    with capture_logs() as logs:
        assert w.ensure() is False
    failed = [e for e in logs if e.get("action") == "create_failed"]
    assert failed[0]["error_type"] == "load_timeout"
    assert win.destroyed == 1
    assert w.available() is True


def test_two_failures_in_a_row_disable_the_popup():
    w, created, _ = make(
        [FakeWindow(loads=False), FakeWindow(loads=False), FakeWindow()]
    )
    with capture_logs() as logs:
        assert w.ensure() is False
        assert w.ensure() is False
        assert w.ensure() is False
    assert actions(logs) == [
        "create_failed",
        "create_failed",
        "disabled_after_failures",
    ]
    assert w.available() is False
    assert len(created) == 2


def test_a_success_resets_the_failure_count():
    lost = FakeWindow()
    w, created, _ = make(
        [FakeWindow(loads=False), lost, FakeWindow(loads=False), FakeWindow()]
    )
    assert w.ensure() is False
    assert w.ensure() is True
    lost.events.closed.set()  # lost: the next ensure creates again
    assert w.ensure() is False
    assert w.available() is True
    assert w.ensure() is True
    assert len(created) == 4


def test_create_window_raising_is_create_failed_with_type():
    def boom(**_):
        raise RuntimeError("no gui")

    w = cpw.CallPopupWindow(
        main_window=FakeWindow(),
        url="http://127.0.0.1:1/?view=call-popup",
        is_quitting=lambda: False,
        create_window=boom,
        user32=FakeUser32(),
        dwmapi=FakeDwm(),
        work_area=lambda: cpw.Rect(0, 0, 1920, 1040),
        system_dpi=lambda: 96,
        app_exit=lambda: None,
        load_timeout=0.05,
    )
    with capture_logs() as logs:
        assert w.ensure() is False
    failed = [e for e in logs if e.get("action") == "create_failed"]
    assert failed[0]["error_type"] == "RuntimeError"


def test_ensure_refused_while_quitting():
    w, created, _ = make([FakeWindow()], quitting=lambda: True)
    assert w.ensure() is False
    assert created == []


def test_window_closed_during_load_is_a_failure():
    win = FakeWindow(loads=False)

    def create_window(**_):
        win.events.closed.set()
        win.events.loaded.set()
        return win

    w = cpw.CallPopupWindow(
        main_window=FakeWindow(),
        url="u",
        is_quitting=lambda: False,
        create_window=create_window,
        user32=FakeUser32(),
        dwmapi=FakeDwm(),
        work_area=lambda: cpw.Rect(0, 0, 1920, 1040),
        system_dpi=lambda: 96,
        app_exit=lambda: None,
        load_timeout=0.05,
    )
    with capture_logs() as logs:
        assert w.ensure() is False
    failed = [e for e in logs if e.get("action") == "create_failed"]
    assert failed[0]["error_type"] == "closed"


# ---------------------------------------------------------------- start


def test_start_runs_exact_script_and_requires_true():
    win = FakeWindow()
    w, _, _ = make([win])
    assert w.start(7) is True
    assert win.js == [
        "window.__sakadeskCallPopup ? (window.__sakadeskCallPopup.start(7), true) : false"
    ]
    for result in (False, None):
        win.js_result = result
        assert w.start(7) is False


def test_start_refused_while_quitting():
    w, created, _ = make([FakeWindow()], quitting=lambda: True)
    with capture_logs() as logs:
        assert w.start(7) is False
    assert created == []
    refused = [e for e in logs if e.get("action") == "start_refused"]
    assert refused[0]["reason"] == "quitting"
    assert refused[0]["call_id"] == 7


def test_start_refused_when_unavailable():
    w, created, _ = make([FakeWindow(loads=False), FakeWindow(loads=False)])
    w.ensure()
    w.ensure()
    with capture_logs() as logs:
        assert w.start(7) is False
    refused = [e for e in logs if e.get("action") == "start_refused"]
    assert refused[0]["reason"] == "unavailable"
    assert len(created) == 2


def test_start_fails_when_the_window_cannot_be_created():
    w, _, _ = make([FakeWindow(loads=False)])
    assert w.start(7) is False


def test_lost_window_is_recreated_by_next_start():
    first, second = FakeWindow(), FakeWindow()
    w, created, _ = make([first, second])
    assert w.ensure() is True
    with capture_logs() as logs:
        first.events.closed.set()
    assert actions(logs) == ["lost"]
    assert w.start(3) is True
    assert len(created) == 2
    assert second.js and not first.js


def test_stale_close_of_an_old_window_is_ignored():
    first, second = FakeWindow(), FakeWindow()
    w, _, _ = make([first, second])
    w.ensure()
    first.events.closed.set()
    w.ensure()
    with capture_logs() as logs:
        first.events.closed.set()
    assert actions(logs) == []
    assert w.start(1) is True
    assert second.js


def test_close_while_quitting_is_not_lost():
    quitting = {"v": False}
    win = FakeWindow()
    w, _, _ = make([win], quitting=lambda: quitting["v"])
    w.ensure()
    quitting["v"] = True
    with capture_logs() as logs:
        win.events.closed.set()
    assert actions(logs) == []


# ---------------------------------------------------------------- reveal


def test_reveal_shows_no_activate_at_popup_rect():
    user32 = FakeUser32()
    win = FakeWindow()
    w, _, _ = make([win], user32=user32)
    w.start(9)
    user32.calls.clear()
    with capture_logs() as logs:
        assert w.reveal() is True
    assert user32.calls == [
        ("ShowWindow", 0x1234, 4),
        ("SetWindowPos", 0x1234, -1, 1608, 495, 300, 533, 0x0010 | 0x0040),
    ]
    assert win.shown == 0
    ev = [e for e in logs if e["event"] == "call_popup_reveal"][0]
    assert (ev["call_id"], ev["dpi"], ev["width"], ev["height"], ev["visible"]) == (
        9,
        96,
        300,
        533,
        True,
    )


def test_reveal_without_window_or_hwnd_fails():
    w, _, _ = make([FakeWindow(hwnd=None)])
    with capture_logs() as logs:
        assert w.reveal() is False
    assert [
        e["error_type"] for e in logs if e["event"] == "call_popup_reveal_failed"
    ] == ["LookupError"]
    w.ensure()
    with capture_logs() as logs:
        assert w.reveal() is False
    assert [e["event"] for e in logs] == ["call_popup_reveal_failed"]


def test_reveal_with_raising_showwindow_fails():
    class Raising(FakeUser32):
        def ShowWindow(self, hwnd, cmd):
            raise OSError("denied")

    w, _, _ = make([FakeWindow()], user32=Raising())
    w.start(4)
    with capture_logs() as logs:
        assert w.reveal() is False
    ev = [e for e in logs if e["event"] == "call_popup_reveal_failed"][0]
    assert (ev["call_id"], ev["error_type"]) == (4, "OSError")


# ---------------------------------------------------------------- cancel / hide


def test_cancel_runs_script_then_hides():
    win = FakeWindow()
    w, _, _ = make([win])
    w.ensure()
    w.cancel(7)
    assert win.js == [
        "window.__sakadeskCallPopup && window.__sakadeskCallPopup.cancel(7)"
    ]
    assert win.hidden == 1


def test_cancel_hides_even_when_script_raises():
    class Raising(FakeWindow):
        def evaluate_js(self, script):
            raise RuntimeError("js")

    win = Raising()
    w, _, _ = make([win])
    w.ensure()
    with pytest.raises(RuntimeError):
        w.cancel(7)
    assert win.hidden == 1


def test_cancel_and_hide_without_window_are_noops():
    w, created, _ = make([FakeWindow()])
    w.cancel(7)
    w.hide()
    assert created == []


def test_hide_hides_the_window():
    win = FakeWindow()
    w, _, _ = make([win])
    w.ensure()
    w.hide()
    assert win.hidden == 1 and win.shown == 0


# ---------------------------------------------------------------- deliver_heard


def test_deliver_heard_runs_on_main_window_with_cjk_json():
    main = FakeWindow()
    w, created, _ = make([FakeWindow()], main=main)
    target = HeardTarget(
        service="hinatazaka46", path="hinatazaka46/1/34/佐々木", message_id=55
    )
    assert w.deliver_heard(target) == "delivered"
    payload = json.dumps(
        {
            "service": "hinatazaka46",
            "path": "hinatazaka46/1/34/佐々木",
            "message_id": 55,
        },
        ensure_ascii=False,
    )
    assert main.js == [
        "window.__sakadeskMarkVoiceHeard ? window.__sakadeskMarkVoiceHeard("
        + payload
        + ") : null"
    ]
    assert "佐々木" in main.js[0]
    assert created == []
    main.js_result = None
    assert w.deliver_heard(target) == "not_ready"


# ---------------------------------------------------------------- destroy


def test_destroy_success():
    win = FakeWindow()
    w, _, exits = make([win])
    w.ensure()
    with capture_logs() as logs:
        w.destroy()
    assert actions(logs) == ["destroyed"]
    assert exits == []
    assert w.available() is False
    with capture_logs() as logs:
        w.destroy()
    assert logs == []


def test_destroy_timeout_falls_back_to_app_exit():
    w, _, exits = make([FakeWindow(close_on_destroy=False)])
    w.ensure()
    with capture_logs() as logs:
        w.destroy()
    failed = [e for e in logs if e.get("action") == "destroy_failed"]
    assert failed[0]["error_type"] == "timeout"
    assert exits == [1]


def test_destroy_raising_falls_back_to_app_exit():
    class Raising(FakeWindow):
        def destroy(self):
            raise RuntimeError("gone")

    w, _, exits = make([Raising()])
    w.ensure()
    with capture_logs() as logs:
        w.destroy()
    failed = [e for e in logs if e.get("action") == "destroy_failed"]
    assert failed[0]["error_type"] == "RuntimeError"
    assert exits == [1]


def test_destroy_app_exit_raising_is_logged():
    def bad_exit():
        raise RuntimeError("no forms")

    w = cpw.CallPopupWindow(
        main_window=FakeWindow(),
        url="u",
        is_quitting=lambda: False,
        create_window=lambda **_: FakeWindow(close_on_destroy=False),
        user32=FakeUser32(),
        dwmapi=FakeDwm(),
        work_area=lambda: cpw.Rect(0, 0, 1920, 1040),
        system_dpi=lambda: 96,
        app_exit=bad_exit,
        load_timeout=0.05,
        destroy_timeout=0.05,
    )
    w.ensure()
    with capture_logs() as logs:
        w.destroy()
    assert [
        e["error_type"] for e in logs if e["event"] == "call_popup_app_exit_failed"
    ] == ["RuntimeError"]


def test_destroy_without_window_is_noop():
    w, _, exits = make([FakeWindow()])
    with capture_logs() as logs:
        w.destroy()
    assert logs == [] and exits == []


def test_destroy_on_main_closed_delegates_and_blocks_recreation():
    win = FakeWindow()
    w, created, _ = make([win, FakeWindow()])
    w.ensure()
    with capture_logs() as logs:
        w.destroy_on_main_closed("ignored", 1)
    assert actions(logs) == ["destroyed"]
    assert win.destroyed == 1
    assert w.ensure() is False
    assert w.start(1) is False
    assert len(created) == 1


# ---------------------------------------------------------------- privacy


def test_no_log_carries_url_path_or_name():
    main = FakeWindow()
    first = FakeWindow()
    w, _, _ = make([FakeWindow(loads=False), first, FakeWindow()], main=main)
    with capture_logs() as logs:
        w.ensure()
        w.start(1)
        w.reveal()
        w.cancel(1)
        first.events.closed.set()
        w.start(2)
        w.deliver_heard(HeardTarget("sakurazaka46", "sakurazaka46/2/9/山下", 3))
        w.destroy()
    text = repr(logs)
    for secret in (
        "127.0.0.1",
        "view=call-popup",
        "sakurazaka46/2/9",
        "山下",
        "SakaDesk Call",
    ):
        assert secret not in text


def test_destroy_during_load_closes_the_new_window():
    win = FakeWindow()
    holder = {}

    def create_window(**_):
        holder["w"].destroy()  # quit arrives while the window is being created
        return win

    w = cpw.CallPopupWindow(
        main_window=FakeWindow(),
        url="u",
        is_quitting=lambda: False,
        create_window=create_window,
        user32=FakeUser32(),
        dwmapi=FakeDwm(),
        work_area=lambda: cpw.Rect(0, 0, 1920, 1040),
        system_dpi=lambda: 96,
        app_exit=lambda: None,
        load_timeout=0.05,
        destroy_timeout=0.05,
    )
    holder["w"] = w
    with capture_logs() as logs:
        assert w.ensure() is False
    assert actions(logs) == ["created", "destroyed"]
    assert win.destroyed == 1
    assert w.available() is False


def test_start_after_window_vanished_post_ensure_fails(monkeypatch):
    w, _, _ = make([FakeWindow()])
    monkeypatch.setattr(w, "ensure", lambda: True)
    assert w.start(1) is False


def test_apply_styles_without_hwnd_is_noop():
    user32 = FakeUser32()
    w, _, _ = make([], user32=user32)
    w._apply_styles(None)
    assert user32.calls == []


# ---------------------------------------------------------------- default seams


class FakeFn:
    def __init__(self, result=0, side=None):
        self.result, self.side, self.calls = result, side, []
        self.argtypes = self.restype = None

    def __call__(self, *a):
        self.calls.append(a)
        if self.side:
            self.side(*a)
        return self.result


class FakeDll:
    def __init__(self, names):
        for n in names:
            setattr(self, n, FakeFn())

    def __getattr__(self, name):
        raise AttributeError(name)


USER32_FNS = (
    "GetWindowLongW",
    "SetWindowLongW",
    "ShowWindow",
    "SetWindowPos",
    "IsWindowVisible",
    "SystemParametersInfoW",
    "GetDC",
    "ReleaseDC",
    "GetDpiForSystem",
)


def test_load_user32_declares_hwnd_signatures(monkeypatch):
    from ctypes import wintypes

    dll = FakeDll(USER32_FNS)
    monkeypatch.setattr(cpw.ctypes, "WinDLL", lambda name, **_: dll, raising=False)
    assert cpw._load_user32() is dll
    assert dll.SetWindowPos.argtypes[0] is wintypes.HWND
    assert dll.SetWindowPos.argtypes[1] is wintypes.HWND
    assert dll.GetDpiForSystem.restype is wintypes.UINT


def test_load_user32_without_get_dpi_for_system(monkeypatch):
    dll = FakeDll(USER32_FNS[:-1])
    monkeypatch.setattr(cpw.ctypes, "WinDLL", lambda name, **_: dll, raising=False)
    assert cpw._load_user32() is dll


def test_load_dwmapi(monkeypatch):
    dll = FakeDll(("DwmSetWindowAttribute",))
    monkeypatch.setattr(cpw.ctypes, "WinDLL", lambda name, **_: dll, raising=False)
    assert cpw._load_dwmapi() is dll
    assert dll.DwmSetWindowAttribute.restype is cpw.ctypes.c_long


def test_lazy_handles_load_once(monkeypatch):
    loads = []
    monkeypatch.setattr(cpw, "_load_user32", lambda: loads.append("u") or FakeUser32())
    monkeypatch.setattr(cpw, "_load_dwmapi", lambda: loads.append("d") or FakeDwm())
    w = cpw.CallPopupWindow(
        main_window=FakeWindow(), url="u", is_quitting=lambda: False
    )
    assert w._user32 is w._user32
    assert w._dwmapi is w._dwmapi
    assert loads == ["u", "d"]


def test_default_work_area_reads_spi_rect():
    def fill(action, param, ptr, flags):
        rect = ptr._obj
        rect.left, rect.top, rect.right, rect.bottom = 0, 0, 2560, 1400

    user32 = FakeDll(())
    user32.SystemParametersInfoW = FakeFn(result=1, side=fill)
    assert cpw._default_work_area(user32) == cpw.Rect(0, 0, 2560, 1400)
    assert user32.SystemParametersInfoW.calls[0][0] == 0x0030


def test_default_work_area_raises_on_failure():
    user32 = FakeDll(())
    user32.SystemParametersInfoW = FakeFn(result=0)
    with pytest.raises(OSError):
        cpw._default_work_area(user32)


def test_default_seams_used_by_the_host(monkeypatch):
    def fill(action, param, ptr, flags):
        rect = ptr._obj
        rect.left, rect.top, rect.right, rect.bottom = 0, 0, 1920, 1040

    user32 = FakeUser32()
    user32.SystemParametersInfoW = FakeFn(result=1, side=fill)
    user32.GetDpiForSystem = FakeFn(result=96)
    w = cpw.CallPopupWindow(
        main_window=FakeWindow(),
        url="u",
        is_quitting=lambda: False,
        create_window=lambda **_: FakeWindow(),
        user32=user32,
        dwmapi=FakeDwm(),
    )
    w.ensure()
    assert w.reveal() is True
    assert ("SetWindowPos", 0x1234, -1, 1608, 495, 300, 533, 0x50) in user32.calls


def test_default_system_dpi_prefers_get_dpi_for_system():
    user32 = FakeDll(())
    user32.GetDpiForSystem = FakeFn(result=144)
    assert cpw._default_system_dpi(user32) == 144


def test_default_system_dpi_falls_back_to_device_caps(monkeypatch):
    user32 = FakeDll(())
    user32.GetDC = FakeFn(result=0xDC)
    user32.ReleaseDC = FakeFn(result=1)
    gdi32 = FakeDll(())
    gdi32.GetDeviceCaps = FakeFn(result=120)
    monkeypatch.setattr(cpw.ctypes, "WinDLL", lambda name, **_: gdi32, raising=False)
    assert cpw._default_system_dpi(user32) == 120
    assert gdi32.GetDeviceCaps.calls == [(0xDC, 88)]
    assert user32.ReleaseDC.calls == [(None, 0xDC)]


def test_default_create_window_uses_webview(monkeypatch):
    import sys
    import types

    calls = []
    fake = types.ModuleType("webview")
    fake.create_window = lambda **kw: calls.append(kw) or "win"
    monkeypatch.setitem(sys.modules, "webview", fake)
    assert cpw._default_create_window(title="t") == "win"
    assert calls == [{"title": "t"}]


def test_default_app_exit_uses_winforms(monkeypatch):
    import sys
    import types

    refs, exits = [], []
    clr = types.ModuleType("clr")
    clr.AddReference = refs.append
    system = types.ModuleType("System")
    forms = types.ModuleType("System.Windows.Forms")
    forms.Application = types.SimpleNamespace(Exit=lambda: exits.append(1))
    windows = types.ModuleType("System.Windows")
    monkeypatch.setitem(sys.modules, "clr", clr)
    monkeypatch.setitem(sys.modules, "System", system)
    monkeypatch.setitem(sys.modules, "System.Windows", windows)
    monkeypatch.setitem(sys.modules, "System.Windows.Forms", forms)
    cpw._default_app_exit()
    assert refs == ["System.Windows.Forms"] and exits == [1]
