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
    kw.setdefault("apply_transparency", lambda window: None)
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
    assert cpw.TRANSPARENCY_KEY == (3, 1, 2)
    # The form is born in the key colour: pywebview's red never exists.
    assert cpw.BACKGROUND_COLOR == "#030102"
    assert cpw.DWMWCP_DONOTROUND == 1
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
            # The app CSP refuses pywebview's injected <style>; the page's own
            # CSS keeps text unselectable.
            text_select=True,
            focus=False,
            on_top=True,
            hidden=True,
            shadow=False,
            # transparent=True would paint the form pure red first, and
            # WebView2 keeps that red under the card's corners for good.
            transparent=False,
            background_color="#030102",
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
    assert dwm.calls == [(0x1234, 33, 1, 4)]


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
    assert dwm.calls == [(0x1234, 33, 1, 4)]


def test_ensure_applies_the_transparency_key_before_show_when_hwnd_ready():
    seen = []
    win = FakeWindow()
    w, _, _ = make([win], apply_transparency=seen.append)
    assert w.ensure() is True
    assert seen == [win]
    assert win.shown == 0


def test_ensure_applies_the_transparency_key_in_before_show_without_hwnd():
    seen = []
    win = FakeWindow(hwnd=None)
    w, _, _ = make([win], apply_transparency=seen.append)
    assert w.ensure() is True
    assert seen == []
    win.native.Handle = 0x1234
    win.events.before_show.set()
    assert seen == [win]


class FakeWebView2:
    def __init__(self):
        self.DefaultBackgroundColor = None


class FakeForm:
    def __init__(self, invoke_required):
        self.InvokeRequired = invoke_required
        self.BackColor = self.TransparencyKey = None
        self.webview = FakeWebView2()
        self.invoked = 0

    def Invoke(self, action):
        self.invoked += 1
        action()


def install_fake_dotnet(monkeypatch):
    import sys
    import types

    system = types.ModuleType("System")
    system.Action = lambda fn: fn
    drawing = types.ModuleType("System.Drawing")

    class Color:
        Transparent = "transparent"

        @staticmethod
        def FromArgb(a, r, g, b):
            return (a, r, g, b)

    drawing.Color = Color
    system.Drawing = drawing
    monkeypatch.setitem(sys.modules, "System", system)
    monkeypatch.setitem(sys.modules, "System.Drawing", drawing)


def test_apply_transparency_key_sets_both_colours_via_invoke(monkeypatch):
    install_fake_dotnet(monkeypatch)
    form = FakeForm(invoke_required=True)
    win = FakeWindow()
    win.native = form
    with capture_logs() as logs:
        cpw._apply_transparency_key(win)
    assert form.invoked == 1
    assert form.BackColor == form.TransparencyKey == (255, 3, 1, 2)
    # The page's transparent pixels show the keyed form colour beneath.
    assert form.webview.DefaultBackgroundColor == "transparent"
    assert {
        "event": "call_popup_transparency",
        "applied": True,
        "log_level": "info",
    } in logs


def test_apply_transparency_key_runs_directly_on_the_gui_thread(monkeypatch):
    install_fake_dotnet(monkeypatch)
    form = FakeForm(invoke_required=False)
    win = FakeWindow()
    win.native = form
    cpw._apply_transparency_key(win)
    assert form.invoked == 0
    assert form.BackColor == form.TransparencyKey == (255, 3, 1, 2)
    assert form.webview.DefaultBackgroundColor == "transparent"


def test_the_window_never_gets_a_colour_other_than_the_key(monkeypatch):
    """Every layer under the page carries the key: nothing paints unkeyed."""
    install_fake_dotnet(monkeypatch)
    win = FakeWindow()
    win.native = FakeForm(invoke_required=False)
    win.native.Handle = 0x1234
    w, created, _ = make([win], apply_transparency=cpw._apply_transparency_key)
    assert w.ensure() is True
    key_hex = "#{:02X}{:02X}{:02X}".format(*cpw.TRANSPARENCY_KEY)
    assert created[0]["transparent"] is False
    assert created[0]["background_color"].upper() == key_hex
    form = win.native
    assert form.BackColor == form.TransparencyKey == (255, *cpw.TRANSPARENCY_KEY)
    assert form.webview.DefaultBackgroundColor == "transparent"


def test_apply_transparency_key_logs_and_does_not_raise_on_error(monkeypatch):
    install_fake_dotnet(monkeypatch)

    class BrokenForm(FakeForm):
        def Invoke(self, action):
            raise RuntimeError("boom")

    win = FakeWindow()
    win.native = BrokenForm(invoke_required=True)
    with capture_logs() as logs:
        cpw._apply_transparency_key(win)
    failed = [e for e in logs if e["event"] == "call_popup_transparency_failed"]
    assert failed and failed[0]["error_type"] == "RuntimeError"
    assert not any(e["event"] == "call_popup_transparency" for e in logs)


def test_apply_transparency_key_without_dotnet_is_logged_not_raised():
    with capture_logs() as logs:
        cpw._apply_transparency_key(FakeWindow())
    assert any(e["event"] == "call_popup_transparency_failed" for e in logs)


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
        assert w.reveal(9) is True
    # Move first (no flash at the stale spot), then show, then topmost only.
    assert user32.calls == [
        ("SetWindowPos", 0x1234, 0, 1608, 495, 300, 533, 0x0004 | 0x0010),
        ("ShowWindow", 0x1234, 4),
        ("SetWindowPos", 0x1234, -1, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010),
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


@pytest.mark.parametrize("bad", [0, -96])
def test_reveal_rejects_a_bad_dpi_without_touching_the_window(bad):
    user32 = FakeUser32()
    w, _, _ = make([FakeWindow()], user32=user32)
    w._system_dpi = lambda: bad
    w.start(6)
    user32.calls.clear()
    with capture_logs() as logs:
        assert w.reveal(6) is False
    assert user32.calls == []
    ev = [e for e in logs if e["event"] == "call_popup_reveal_failed"]
    assert [(e["error_type"], e["dpi"], e["call_id"]) for e in ev] == [
        ("bad_dpi", bad, 6)
    ]
    assert not [e for e in logs if e["event"] == "call_popup_reveal"]


def test_reveal_without_window_or_hwnd_fails():
    w, _, _ = make([FakeWindow(hwnd=None)])
    w.start(1)
    with capture_logs() as logs:
        assert w.reveal(1) is False
    assert [
        e["error_type"] for e in logs if e["event"] == "call_popup_reveal_failed"
    ] == ["LookupError"]
    w._window = None
    with capture_logs() as logs:
        assert w.reveal(1) is False
    assert [e["event"] for e in logs] == ["call_popup_reveal_failed"]


def test_reveal_with_raising_showwindow_fails():
    class Raising(FakeUser32):
        def ShowWindow(self, hwnd, cmd):
            raise OSError("denied")

    w, _, _ = make([FakeWindow()], user32=Raising())
    w.start(4)
    with capture_logs() as logs:
        assert w.reveal(4) is False
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
    w.hide(7)
    assert created == []


def test_hide_hides_the_window():
    win = FakeWindow()
    w, _, _ = make([win])
    w.ensure()
    w.hide(1)
    assert win.hidden == 1 and win.shown == 0


def test_reveal_after_cancel_of_the_same_call_is_a_noop():
    user32 = FakeUser32()
    win = FakeWindow()
    w, _, _ = make([win], user32=user32)
    w.start(3)
    w.cancel(3)  # the cancel won the race with the reveal
    user32.calls.clear()
    with capture_logs() as logs:
        assert w.reveal(3) is False
    assert user32.calls == []  # never shown
    assert [(e["event"], e["reason"]) for e in logs] == [
        ("call_popup_reveal_skipped", "stale_call")
    ]


def test_reveal_for_a_call_that_was_never_started_is_a_noop():
    user32 = FakeUser32()
    w, _, _ = make([FakeWindow()], user32=user32)
    w.start(2)
    user32.calls.clear()
    assert w.reveal(1) is False and w.reveal(3) is False
    assert user32.calls == []


def test_reveal_after_hide_of_the_same_call_is_a_noop():
    user32 = FakeUser32()
    w, _, _ = make([FakeWindow()], user32=user32)
    w.start(5)
    w.hide(5)
    user32.calls.clear()
    assert w.reveal(5) is False
    assert user32.calls == []


def test_cancel_before_start_returns_refuses_that_start():
    win = FakeWindow()
    w, _, _ = make([win])
    w.ensure()
    w.cancel(4)  # the controller cancelled while start was still in ensure()
    win.js.clear()
    with capture_logs() as logs:
        assert w.start(4) is False
    assert win.js == []
    (ev,) = [e for e in logs if e.get("action") == "start_refused"]
    assert (ev["reason"], ev["call_id"]) == ("ended", 4)
    assert w.start(5) is True  # the next call starts normally


def test_late_hide_or_cancel_for_an_older_call_leaves_the_newer_one():
    win = FakeWindow()
    w, _, _ = make([win])
    w.start(1)
    w.start(2)
    win.js.clear()
    w.hide(1)
    w.cancel(1)
    assert win.hidden == 0 and win.js == []
    assert w.reveal(2) is True
    w.hide(2)
    assert win.hidden == 1


def test_reveal_and_cancel_are_serialized():
    """A cancel issued while a reveal is in its Win32 calls waits for it, then hides."""
    entered, release = threading.Event(), threading.Event()

    class Slow(FakeUser32):
        def ShowWindow(self, hwnd, cmd):
            entered.set()
            release.wait(5)
            return super().ShowWindow(hwnd, cmd)

    win = FakeWindow()
    w, _, _ = make([win], user32=Slow())
    w.start(8)
    revealer = threading.Thread(target=w.reveal, args=(8,))
    revealer.start()
    assert entered.wait(5)
    canceller = threading.Thread(target=w.cancel, args=(8,))
    canceller.start()
    canceller.join(0.05)
    assert canceller.is_alive() and win.hidden == 0  # blocked on the op lock
    release.set()
    revealer.join(5)
    canceller.join(5)
    assert win.hidden == 1  # the hide landed after the show


# ---------------------------------------------------------------- lost window


def test_lost_window_during_a_call_is_reported():
    reported: list[int] = []
    win = FakeWindow()
    w, _, _ = make([win], report_lost=reported.append)
    w.start(3)
    with capture_logs() as logs:
        win.events.closed.set()
    assert reported == [3]
    (ev,) = [e for e in logs if e["event"] == "call_popup_window"]
    assert (ev["action"], ev["call_id"]) == ("lost", 3)


@pytest.mark.parametrize("end", ["none", "hide", "cancel"])
def test_lost_window_without_a_live_call_is_not_reported(end):
    reported: list[int] = []
    win = FakeWindow()
    w, _, _ = make([win], report_lost=reported.append)
    if end == "none":
        w.ensure()
    else:
        w.start(3)
        getattr(w, end)(3)
    with capture_logs() as logs:
        win.events.closed.set()
    assert reported == []
    assert actions(logs) == ["lost"]


def test_a_failing_lost_report_is_logged_and_swallowed():
    def boom(_cid):
        raise RuntimeError("no loop")

    win = FakeWindow()
    w, _, _ = make([win], report_lost=boom)
    w.start(4)
    with capture_logs() as logs:
        win.events.closed.set()
    (ev,) = [e for e in logs if e["event"] == "call_popup_lost_report_failed"]
    assert (ev["call_id"], ev["error_type"]) == (4, "RuntimeError")


def test_default_lost_report_sends_window_lost_error_to_the_controller(monkeypatch):
    import asyncio

    from backend.services import call_popup, desktop_bridge

    scheduled = []
    monkeypatch.setattr(desktop_bridge, "run_on_server_loop", scheduled.append)
    call_popup._reset_controller_for_tests()
    try:
        cpw._default_report_lost(5)
        (coro,) = scheduled
        with capture_logs() as logs:
            # No call 5 in a fresh controller: the event is reported as stale.
            assert asyncio.run(coro) is False
    finally:
        call_popup._reset_controller_for_tests()
    (ev,) = [e for e in logs if e["event"] == "call_popup_event_stale"]
    assert (ev["call_id"], ev["call_event"]) == (5, "error")


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
    assert [e["event"] for e in logs] == ["call_popup_window"]
    assert logs[0]["action"] == "destroy_skipped"
    assert logs[0]["log_level"] == "debug"
    assert win.destroyed == 1


def test_destroy_is_idempotent_after_a_failed_destroy():
    win = FakeWindow(close_on_destroy=False)
    w, _, exits = make([win])
    w.ensure()
    w.destroy()
    assert exits == [1]
    with capture_logs() as logs:
        w.destroy()
        w.destroy_on_main_closed()
    assert actions(logs) == ["destroy_skipped", "destroy_skipped"]
    assert not [e for e in logs if e.get("action") == "destroy_failed"]
    assert exits == [1]
    assert win.destroyed == 1


def test_destroy_while_destroying_is_skipped():
    win = FakeWindow(close_on_destroy=False)
    w, _, exits = make([win])
    w.ensure()
    w._shut_down = False
    w._destroying = True  # a destroy is in flight on another thread
    with capture_logs() as logs:
        w.destroy()
    assert actions(logs) == ["destroy_skipped"]
    assert win.destroyed == 0 and exits == []


def test_destroy_timeout_falls_back_to_app_exit():
    w, _, exits = make([FakeWindow(close_on_destroy=False)])
    w.ensure()
    with capture_logs() as logs:
        w.destroy()
    failed = [e for e in logs if e.get("action") == "destroy_failed"]
    assert failed[0]["error_type"] == "timeout"
    assert exits == [1]


def test_destroy_with_a_hung_gui_thread_still_falls_back_within_timeout():
    release = threading.Event()
    entered = threading.Event()

    class Hung(FakeWindow):
        def destroy(self):
            self.destroyed += 1
            entered.set()
            release.wait(5)  # a GUI thread that never answers Invoke(Close)

    win = Hung()
    w, _, exits = make([win])
    w.ensure()
    try:
        with capture_logs() as logs:
            w.destroy()
        assert entered.wait(1)
        failed = [e for e in logs if e.get("action") == "destroy_failed"]
        assert [e["error_type"] for e in failed] == ["timeout"]
        assert exits == [1]
        assert w._window is None
    finally:
        release.set()


def test_destroy_runs_window_destroy_off_the_calling_thread():
    seen = []

    class Recording(FakeWindow):
        def destroy(self):
            seen.append(threading.current_thread())
            super().destroy()

    w, _, _ = make([Recording()])
    w.ensure()
    w.destroy()
    assert len(seen) == 1
    assert seen[0] is not threading.current_thread()
    assert seen[0].daemon is True


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
        w.reveal(1)
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


def test_ensure_does_not_reuse_a_window_that_closed_before_it_was_cached():
    first, second = FakeWindow(), FakeWindow()
    w, created, _ = make([first, second])
    assert w.ensure() is True
    # ``closed`` fired after ensure()'s check but before ``self._window`` was
    # set, so ``_on_closed`` ignored it (the window was not cached yet).
    first.events.closed._e.set()
    assert w._window is first
    with capture_logs() as logs:
        assert w.ensure() is True
    assert len(created) == 2
    assert w._window is second
    assert actions(logs) == ["lost", "created"]


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
    w.start(1)
    assert w.reveal(1) is True
    assert ("SetWindowPos", 0x1234, 0, 1608, 495, 300, 533, 0x14) in user32.calls


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
