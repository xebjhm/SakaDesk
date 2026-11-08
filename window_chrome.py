"""Windows 11 native title bar colours for the main window.

The main window keeps its native frame (snap layouts, resize borders); on
Windows 11 (build >= 22000) DWM is asked to paint the caption and border in the
app's window surface colour with primary-ink caption text. Older Windows keeps
the system title bar and logs ``title_bar_color_skipped``.

The two colours duplicate ``color.surface.window`` and ``color.text.primary`` in
``frontend/src/design/tokens/color.ts``; ``tests/test_window_chrome.py``
cross-checks them. ``ctypes.WinDLL``, ``sys.getwindowsversion`` and pywebview are
never touched at import: the DWM library and the build number are injectable
seams, so Linux CI imports and tests this module.
"""

from __future__ import annotations

import ctypes
import sys
import threading
from collections.abc import Callable
from typing import Any

import structlog

logger = structlog.get_logger(__name__)

WINDOW_SURFACE = "#F0F2F5"
PRIMARY_INK = "#1F2937"

MIN_BUILD = 22000

DWMWA_USE_IMMERSIVE_DARK_MODE = 20
DWMWA_BORDER_COLOR = 34
DWMWA_CAPTION_COLOR = 35
DWMWA_TEXT_COLOR = 36


def colorref(hex_color: str) -> int:
    """``#RRGGBB`` packed as a Win32 COLORREF (``0x00BBGGRR``)."""
    value = hex_color.lstrip("#")
    if len(value) != 6:
        raise ValueError("expected #RRGGBB")
    r, g, b = int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)
    return (b << 16) | (g << 8) | r


def _windows_build() -> int:
    return int(sys.getwindowsversion().build)  # type: ignore[attr-defined]


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


def _hwnd_of(window: Any) -> int | None:
    """The pywebview window's HWND (``window.native.Handle``), or None; never raises."""
    try:
        handle = window.native.Handle
        if handle is None:
            return None
        to_int = getattr(handle, "ToInt64", None)
        return int(to_int()) if to_int is not None else int(handle)
    except Exception:
        return None


def apply_title_bar_colors(
    hwnd: int | None,
    *,
    is_windows: bool | None = None,
    get_build: Callable[[], int] = _windows_build,
    load_dwmapi: Callable[[], Any] = _load_dwmapi,
) -> bool:
    """Colour ``hwnd``'s caption, caption text and border. True when applied.

    Skips (logging ``title_bar_color_skipped`` with a ``reason``: ``not_windows``,
    ``no_hwnd``, ``old_windows`` with ``build``, ``dwm_rejected`` with
    ``attribute``/``hresult``) and never raises.
    """
    if is_windows is None:
        is_windows = sys.platform == "win32"
    if not is_windows:
        logger.info("title_bar_color_skipped", reason="not_windows")
        return False
    if not hwnd:
        logger.info("title_bar_color_skipped", reason="no_hwnd")
        return False
    try:
        build = get_build()
        if build < MIN_BUILD:
            logger.info("title_bar_color_skipped", reason="old_windows", build=build)
            return False
        dwmapi = load_dwmapi()
        for attribute, value in (
            (DWMWA_USE_IMMERSIVE_DARK_MODE, 0),
            (DWMWA_CAPTION_COLOR, colorref(WINDOW_SURFACE)),
            (DWMWA_TEXT_COLOR, colorref(PRIMARY_INK)),
            (DWMWA_BORDER_COLOR, colorref(WINDOW_SURFACE)),
        ):
            data = ctypes.c_uint32(value)
            hr = dwmapi.DwmSetWindowAttribute(
                hwnd, attribute, ctypes.byref(data), ctypes.sizeof(data)
            )
            if hr != 0:
                logger.warning(
                    "title_bar_color_skipped",
                    reason="dwm_rejected",
                    attribute=attribute,
                    hresult=int(hr) & 0xFFFFFFFF,
                )
                return False
    except Exception as e:
        logger.warning(
            "title_bar_color_skipped", reason="error", error_type=type(e).__name__
        )
        return False
    logger.info("title_bar_color_applied", build=build)
    return True


def make_title_bar_handler(
    window: Any, apply: Callable[[int | None], bool] = apply_title_bar_colors
) -> Callable[..., None]:
    """A pywebview event handler (``before_show``/``shown``) colouring the title bar.

    Retries on the next event until one application succeeds, then ignores later
    events. Never raises, so a failure cannot break startup.
    """
    lock = threading.Lock()
    done = False

    def handler(*_args: Any) -> None:
        nonlocal done
        with lock:
            if done:
                return
            try:
                done = bool(apply(_hwnd_of(window)))
            except Exception as e:
                logger.warning(
                    "title_bar_color_skipped",
                    reason="error",
                    error_type=type(e).__name__,
                )

    return handler
