"""The bottom-right incoming-call popup window (Windows only).

:class:`CallPopupWindow` implements ``backend.services.desktop_bridge.CallPopupHost``.
It owns one pywebview window titled ``"SakaDesk Call"`` (never ``"SakaDesk"``,
so the main window's title lookup cannot find it), created hidden once and
reused for every call:

- :meth:`CallPopupWindow.ensure` creates it with ``focus=False``, ``hidden=True``
  and ``on_top=True``, adds ``WS_EX_TOOLWINDOW`` (no taskbar button, not in
  Alt+Tab) and asks DWM for rounded corners, then waits for the page to load.
  Two failed creations in a row make the host unavailable for the process.
- :meth:`CallPopupWindow.reveal` places it with :func:`popup_rect` (the primary
  monitor's work area, ``POPUP_WIDTH_DIP`` wide at 9:16, ``POPUP_MARGIN_DIP``
  from the corner, in physical pixels at the system DPI), moving it before it
  is shown, then shows it with ``SW_SHOWNOACTIVATE`` / ``SWP_NOACTIVATE``.
  pywebview's ``window.show()`` is
  never called: it activates the form and would steal focus.
- :meth:`CallPopupWindow.destroy` closes it with the main window. The close runs
  on a daemon thread and is awaited with a timeout, falling back to
  ``System.Windows.Forms.Application.Exit()``, so a stuck popup (even a hung GUI
  thread) can never keep the process alive.

pywebview, ``ctypes.WinDLL``, ``ctypes.wintypes`` and pythonnet are imported
lazily inside the default seams, and every native seam (``create_window``,
``user32``, ``dwmapi``, ``work_area``, ``system_dpi``, ``app_exit``) is
injectable, so Linux CI imports this module without any of them.

Logs carry call ids, codes, the DPI and physical pixel sizes only: never the
page URL, a conversation path, a name or message text.
"""

from __future__ import annotations

import contextlib
import ctypes
import json
import threading
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass
from typing import Any

import structlog

from backend.services.desktop_bridge import HeardTarget

logger = structlog.get_logger(__name__)

TITLE = "SakaDesk Call"
BACKGROUND_COLOR = "#0D0F14"
POPUP_WIDTH_DIP = 300
POPUP_MARGIN_DIP = 12
POPUP_LOAD_TIMEOUT_S = 15.0
DESTROY_TIMEOUT_S = 3.0
MAX_CREATE_FAILURES = 2

# The CSS viewport the page always sees; the real geometry is set at reveal.
_PLACEHOLDER_WIDTH = 300
_PLACEHOLDER_HEIGHT = 533

GWL_EXSTYLE = -20
WS_EX_TOOLWINDOW = 0x00000080
SW_SHOWNOACTIVATE = 4
HWND_TOPMOST = -1
SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_NOZORDER = 0x0004
SWP_NOACTIVATE = 0x0010
SPI_GETWORKAREA = 0x0030
DWMWA_WINDOW_CORNER_PREFERENCE = 33
DWMWCP_ROUND = 2
LOGPIXELSX = 88

_START_JS = "window.__sakadeskCallPopup ? (window.__sakadeskCallPopup.start({call_id}), true) : false"
_CANCEL_JS = (
    "window.__sakadeskCallPopup && window.__sakadeskCallPopup.cancel({call_id})"
)
_HEARD_JS = "window.__sakadeskMarkVoiceHeard ? window.__sakadeskMarkVoiceHeard({payload}) : null"


@dataclass(frozen=True)
class Rect:
    """A rectangle in physical pixels (``right``/``bottom`` exclusive)."""

    left: int
    top: int
    right: int
    bottom: int

    @property
    def width(self) -> int:
        return self.right - self.left

    @property
    def height(self) -> int:
        return self.bottom - self.top


def popup_rect(work_area: Rect, dpi: int) -> Rect:
    """Bottom-right rect in physical pixels: 300 DIP wide, 9:16, 12 DIP margin."""
    scale = dpi / 96
    w = round(POPUP_WIDTH_DIP * scale)
    h = round(w * 16 / 9)
    margin = round(POPUP_MARGIN_DIP * scale)
    x = work_area.right - w - margin
    y = work_area.bottom - h - margin
    return Rect(x, y, x + w, y + h)


def _hwnd_of(window: Any) -> int | None:
    """The pywebview window's HWND (WinForms ``window.native.Handle``), or None.

    Mirrors ``desktop._native_hwnd`` (``ToInt64()`` for a pythonnet ``IntPtr``)
    without importing ``desktop``. Never raises: no window, no native form yet
    or an access error all return None.
    """
    if window is None:
        return None
    try:
        handle = window.native.Handle
        if handle is None:
            return None
        to_int = getattr(handle, "ToInt64", None)
        return int(to_int()) if to_int is not None else int(handle)
    except Exception:
        return None


# ---------------------------------------------------------------- default seams
# Reached only on Windows, when the caller did not inject a seam.


def _default_create_window(**kwargs: Any) -> Any:
    import webview

    return webview.create_window(**kwargs)


def _load_user32() -> Any:
    """A private ``user32`` with 64-bit-safe HWND signatures declared."""
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)  # type: ignore[attr-defined]
    user32.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.GetWindowLongW.restype = wintypes.LONG
    user32.SetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int, wintypes.LONG]
    user32.SetWindowLongW.restype = wintypes.LONG
    user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.ShowWindow.restype = wintypes.BOOL
    user32.SetWindowPos.argtypes = [
        wintypes.HWND,
        wintypes.HWND,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        wintypes.UINT,
    ]
    user32.SetWindowPos.restype = wintypes.BOOL
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.IsWindowVisible.restype = wintypes.BOOL
    user32.SystemParametersInfoW.argtypes = [
        wintypes.UINT,
        wintypes.UINT,
        ctypes.c_void_p,
        wintypes.UINT,
    ]
    user32.SystemParametersInfoW.restype = wintypes.BOOL
    user32.GetDC.argtypes = [wintypes.HWND]
    user32.GetDC.restype = wintypes.HDC
    user32.ReleaseDC.argtypes = [wintypes.HWND, wintypes.HDC]
    user32.ReleaseDC.restype = ctypes.c_int
    with contextlib.suppress(AttributeError):  # Windows 10 1607+
        user32.GetDpiForSystem.argtypes = []
        user32.GetDpiForSystem.restype = wintypes.UINT
    return user32


def _load_dwmapi() -> Any:
    from ctypes import wintypes

    dwmapi = ctypes.WinDLL("dwmapi")  # type: ignore[attr-defined]
    dwmapi.DwmSetWindowAttribute.argtypes = [
        wintypes.HWND,
        wintypes.DWORD,
        ctypes.c_void_p,
        wintypes.DWORD,
    ]
    dwmapi.DwmSetWindowAttribute.restype = ctypes.c_long
    return dwmapi


def _default_work_area(user32: Any) -> Rect:
    """The primary monitor's work area (desktop minus taskbar), physical px."""
    from ctypes import wintypes

    rect = wintypes.RECT()
    if not user32.SystemParametersInfoW(SPI_GETWORKAREA, 0, ctypes.byref(rect), 0):
        raise OSError("SystemParametersInfoW(SPI_GETWORKAREA) failed")
    return Rect(rect.left, rect.top, rect.right, rect.bottom)


def _default_system_dpi(user32: Any) -> int:
    """``GetDpiForSystem()``, else ``GetDeviceCaps(GetDC(0), LOGPIXELSX)``."""
    get_dpi = getattr(user32, "GetDpiForSystem", None)
    if get_dpi is not None:
        return int(get_dpi())
    from ctypes import wintypes

    gdi32 = ctypes.WinDLL("gdi32")  # type: ignore[attr-defined]
    gdi32.GetDeviceCaps.argtypes = [wintypes.HDC, ctypes.c_int]
    gdi32.GetDeviceCaps.restype = ctypes.c_int
    hdc = user32.GetDC(None)
    try:
        return int(gdi32.GetDeviceCaps(hdc, LOGPIXELSX))
    finally:
        user32.ReleaseDC(None, hdc)


def _default_app_exit() -> None:
    import clr  # type: ignore[import-not-found]

    clr.AddReference("System.Windows.Forms")
    from System.Windows.Forms import Application  # type: ignore[import-not-found]

    Application.Exit()


# ---------------------------------------------------------------- the host


class CallPopupWindow:
    """The desktop popup window host (``desktop_bridge.CallPopupHost``).

    ``available()`` is a plain flag read. Every other method may block on the
    GUI thread (``create_window``, ``evaluate_js``, ``Invoke``) and is run by
    the bridge on a worker thread with a timeout. After :meth:`destroy` the
    host is unavailable and never creates a window again.
    """

    def __init__(
        self,
        *,
        main_window: Any,
        url: str,
        is_quitting: Callable[[], bool],
        create_window: Callable[..., Any] | None = None,
        user32: Any = None,
        dwmapi: Any = None,
        work_area: Callable[[], Rect] | None = None,
        system_dpi: Callable[[], int] | None = None,
        app_exit: Callable[[], None] | None = None,
        load_timeout: float = POPUP_LOAD_TIMEOUT_S,
        destroy_timeout: float = DESTROY_TIMEOUT_S,
    ) -> None:
        self._main_window = main_window
        self._url = url
        self._is_quitting = is_quitting
        self._create_window = create_window or _default_create_window
        self._user32_obj = user32
        self._dwmapi_obj = dwmapi
        self._work_area = work_area or (lambda: _default_work_area(self._user32))
        self._system_dpi = system_dpi or (lambda: _default_system_dpi(self._user32))
        self._app_exit = app_exit or _default_app_exit
        self._load_timeout = load_timeout
        self._destroy_timeout = destroy_timeout
        self._lock = threading.Lock()
        self._window: Any = None
        self._available = True
        self._shut_down = False
        self._destroying = False
        self._failures = 0
        self._call_id: int | None = None

    # -- lazy native handles

    @property
    def _user32(self) -> Any:
        if self._user32_obj is None:
            self._user32_obj = _load_user32()
        return self._user32_obj

    @property
    def _dwmapi(self) -> Any:
        if self._dwmapi_obj is None:
            self._dwmapi_obj = _load_dwmapi()
        return self._dwmapi_obj

    # -- CallPopupHost

    def available(self) -> bool:
        """True until creation failed twice in a row or the host was destroyed.

        A flag read only: no window or Win32 call (the gate calls it on the
        server loop).
        """
        return self._available and not self._shut_down

    def ensure(self) -> bool:
        """Create the hidden popup window if absent and wait for its page.

        Returns True when a loaded window exists. False while quitting, after
        :meth:`destroy`, when unavailable, or when creation fails (logged as
        ``call_popup_window action=create_failed`` with ``error_type``
        ``load_timeout``, ``closed`` or the exception type; the half-made
        window is destroyed). ``MAX_CREATE_FAILURES`` failures in a row log
        ``action=disabled_after_failures`` and make the host unavailable.
        """
        with self._lock:
            if not self.available() or self._is_quitting():
                return False
            cached = self._window
            if cached is not None:
                if cached.events.loaded.is_set() and not cached.events.closed.is_set():
                    logger.info("call_popup_window", action="reused")
                    return True
                # Closed behind our back (``closed`` fired before it was cached,
                # or before ``_on_closed`` could clear it): never reuse it.
                self._window = None
                logger.info("call_popup_window", action="lost")
            window = None
            try:
                window = self._create_window(
                    title=TITLE,
                    url=self._url,
                    width=_PLACEHOLDER_WIDTH,
                    height=_PLACEHOLDER_HEIGHT,
                    resizable=False,
                    frameless=True,
                    easy_drag=False,
                    focus=False,
                    on_top=True,
                    hidden=True,
                    shadow=True,
                    background_color=BACKGROUND_COLOR,
                )
                created = window
                window.events.closed += lambda *_: self._on_closed(created)
                hwnd = _hwnd_of(window)
                if hwnd:
                    # pywebview 5.3.2 creates the form synchronously after
                    # start(): it exists and is still hidden here.
                    self._apply_styles(hwnd)
                else:
                    window.events.before_show += lambda *_: self._apply_styles(
                        _hwnd_of(created)
                    )
                if not window.events.loaded.wait(self._load_timeout):
                    raise TimeoutError
                if window.events.closed.is_set():
                    raise ConnectionAbortedError
            except Exception as e:
                if isinstance(e, TimeoutError):
                    error_type = "load_timeout"
                elif isinstance(e, ConnectionAbortedError):
                    error_type = "closed"
                else:
                    error_type = type(e).__name__
                logger.warning(
                    "call_popup_window", action="create_failed", error_type=error_type
                )
                if window is not None:
                    with contextlib.suppress(Exception):
                        window.destroy()
                self._window = None
                self._failures += 1
                if self._failures >= MAX_CREATE_FAILURES:
                    self._available = False
                    logger.warning(
                        "call_popup_window",
                        action="disabled_after_failures",
                        failures=self._failures,
                    )
                return False
            self._window, self._failures = window, 0
            logger.info("call_popup_window", action="created")
        if self._shut_down:
            # destroy() ran while this window was loading: close it too.
            self._close_window(self._destroy_timeout)
            return False
        return True

    def start(self, call_id: int) -> bool:
        """Start ``call_id`` in the popup page, creating the window if needed.

        True only when the page's ``__sakadeskCallPopup.start`` ran (the script
        returned ``true``). Refused while quitting or when unavailable
        (``call_popup_window action=start_refused`` with ``reason``).
        """
        if self._is_quitting():
            logger.info(
                "call_popup_window",
                action="start_refused",
                reason="quitting",
                call_id=call_id,
            )
            return False
        if not self.available():
            logger.info(
                "call_popup_window",
                action="start_refused",
                reason="unavailable",
                call_id=call_id,
            )
            return False
        if not self.ensure():
            return False
        window = self._window
        if window is None:
            return False
        self._call_id = call_id
        return window.evaluate_js(_START_JS.format(call_id=int(call_id))) is True

    def reveal(self) -> bool:
        """Place the popup bottom-right and show it without activating it.

        In order: ``SetWindowPos`` to :func:`popup_rect` of the current work
        area and system DPI (``SWP_NOZORDER | SWP_NOACTIVATE``, so the first
        paint is already at the right spot), ``ShowWindow(SW_SHOWNOACTIVATE)``
        (its ``WM_SHOWWINDOW`` keeps WinForms ``Visible`` in sync for
        ``Form.Hide``), then ``SetWindowPos(HWND_TOPMOST, …, SWP_NOMOVE |
        SWP_NOSIZE | SWP_NOACTIVATE)``. Returns ``IsWindowVisible`` afterwards and
        logs ``call_popup_reveal``; on any failure logs ``call_popup_reveal_failed``
        (``error_type``; ``bad_dpi`` when the system DPI reads as 0 or less) and
        returns False.
        """
        try:
            hwnd = _hwnd_of(self._window)
            if not hwnd:
                raise LookupError("no_hwnd")
            dpi = int(self._system_dpi())
            if dpi <= 0:
                logger.warning(
                    "call_popup_reveal_failed",
                    call_id=self._call_id,
                    error_type="bad_dpi",
                    dpi=dpi,
                )
                return False
            rect = popup_rect(self._work_area(), dpi)
            self._user32.SetWindowPos(
                hwnd,
                0,
                rect.left,
                rect.top,
                rect.width,
                rect.height,
                SWP_NOZORDER | SWP_NOACTIVATE,
            )
            self._user32.ShowWindow(hwnd, SW_SHOWNOACTIVATE)
            self._user32.SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            )
            visible = bool(self._user32.IsWindowVisible(hwnd))
            logger.info(
                "call_popup_reveal",
                call_id=self._call_id,
                dpi=dpi,
                width=rect.width,
                height=rect.height,
                visible=visible,
            )
            return visible
        except Exception as e:
            logger.warning(
                "call_popup_reveal_failed",
                call_id=self._call_id,
                error_type=type(e).__name__,
            )
            return False

    def hide(self) -> None:
        """Hide the popup (pywebview ``Form.Hide``, which activates nothing)."""
        window = self._window
        if window is not None:
            window.hide()

    def cancel(self, call_id: int) -> None:
        """Cancel ``call_id`` in the page, then hide (even if the script raised)."""
        window = self._window
        if window is None:
            return
        try:
            window.evaluate_js(_CANCEL_JS.format(call_id=int(call_id)))
        finally:
            window.hide()

    def deliver_heard(self, target: HeardTarget) -> str:
        """Ask the **main** window to mark ``target`` heard.

        ``"delivered"`` when its bridge returned ``true``; ``"not_ready"``
        otherwise (``null``: the bridge is not installed yet, or the main
        window's conversation cache has not loaded). A JS error raises, and the
        bridge reports it as ``"error"``.
        """
        payload = json.dumps(asdict(target), ensure_ascii=False)
        result = self._main_window.evaluate_js(_HEARD_JS.format(payload=payload))
        return "delivered" if result is True else "not_ready"

    # -- lifecycle

    def destroy(self, timeout: float | None = None) -> None:
        """Close the popup and wait up to ``timeout`` (default ``destroy_timeout``).

        Makes the host unavailable for good. Idempotent: a call while a destroy
        is running or after one ran returns at once (debug ``call_popup_window
        action=destroy_skipped``) without touching the window or the app.
        ``window.destroy()`` runs on a daemon thread, because it blocks on the
        GUI thread; this method never waits longer than ``timeout``. Logs
        ``call_popup_window action=destroyed`` when the popup's ``closed`` fired
        in time; otherwise ``action=destroy_failed`` (``error_type`` ``timeout``
        or the exception type) and calls ``Application.Exit()`` so the popup
        cannot keep the process alive. No window: a no-op.
        """
        if self._destroying or self._shut_down:
            logger.debug("call_popup_window", action="destroy_skipped")
            return
        self._shut_down = True
        self._close_window(self._destroy_timeout if timeout is None else timeout)

    def destroy_on_main_closed(self, *_args: Any) -> None:
        """Main window ``closed`` handler: destroy the popup with it."""
        self.destroy()

    # -- internals

    def _close_window(self, wait_s: float) -> None:
        """Close the current window within ``wait_s`` seconds, else exit the app."""
        window = self._window
        if window is None:
            return
        self._destroying = True
        errors: list[Exception] = []

        def run() -> None:
            try:
                window.destroy()
            except Exception as e:
                errors.append(e)

        thread = threading.Thread(target=run, name="call-popup-destroy", daemon=True)
        deadline = time.monotonic() + wait_s
        try:
            thread.start()
            thread.join(wait_s)
            if errors:
                raise errors[0]
            if not window.events.closed.wait(max(0.0, deadline - time.monotonic())):
                raise TimeoutError
        except Exception as e:
            error_type = "timeout" if isinstance(e, TimeoutError) else type(e).__name__
            logger.warning(
                "call_popup_window", action="destroy_failed", error_type=error_type
            )
            self._exit_app()
        else:
            logger.info("call_popup_window", action="destroyed")
        finally:
            if self._window is window:
                self._window = None

    def _exit_app(self) -> None:
        try:
            self._app_exit()
        except Exception as e:
            logger.warning("call_popup_app_exit_failed", error_type=type(e).__name__)

    def _apply_styles(self, hwnd: int | None) -> None:
        """``WS_EX_TOOLWINDOW`` and DWM rounded corners on ``hwnd``.

        Uses the style bit, never ``Form.ShowInTaskbar`` (which recreates the
        handle under WebView2). A failing corner preference (Windows 10 has
        none) is logged at debug as ``call_popup_corner_skipped`` and ignored.
        """
        if not hwnd:
            return
        style = self._user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
        self._user32.SetWindowLongW(hwnd, GWL_EXSTYLE, style | WS_EX_TOOLWINDOW)
        try:
            pref = ctypes.c_int(DWMWCP_ROUND)
            hr = self._dwmapi.DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                ctypes.byref(pref),
                ctypes.sizeof(pref),
            )
            if hr != 0:
                logger.debug("call_popup_corner_skipped", hresult=int(hr) & 0xFFFFFFFF)
        except Exception as e:
            logger.debug("call_popup_corner_skipped", error_type=type(e).__name__)

    def _on_closed(self, window: Any) -> None:
        """The popup's ``closed``: a close not caused by us or a quit is ``lost``."""
        if window is not self._window or self._destroying or self._is_quitting():
            return
        self._window = None
        logger.info("call_popup_window", action="lost")
