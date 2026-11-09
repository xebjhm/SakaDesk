"""window_chrome: title bar colour decision logic, COLORREF packing, token parity."""

from __future__ import annotations

import ctypes
import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from structlog.testing import capture_logs

import window_chrome as wc

COLOR_TS = (
    Path(wc.__file__).resolve().parent
    / "frontend"
    / "src"
    / "design"
    / "tokens"
    / "color.ts"
)


class FakeDwm:
    def __init__(self, hr: int = 0, fail_at: int = 0, raise_at: int | None = None):
        self.hr = hr
        self.fail_at = fail_at
        self.raise_at = raise_at
        self.calls: list[tuple[int, int, int]] = []

    def DwmSetWindowAttribute(self, hwnd, attr, ref, size):  # noqa: N802
        if self.raise_at is not None and len(self.calls) == self.raise_at:
            raise OSError("dwm call failed")
        self.calls.append(
            (hwnd, attr, ctypes.cast(ref, ctypes.POINTER(ctypes.c_uint32))[0])
        )
        return self.hr if len(self.calls) > self.fail_at else 0


def _apply(hwnd=42, build=22631, dwm=None, is_windows=True):
    dwm = dwm or FakeDwm()
    ok = wc.apply_title_bar_colors(
        hwnd, is_windows=is_windows, get_build=lambda: build, load_dwmapi=lambda: dwm
    )
    return ok, dwm


def test_colorref_is_bgr():
    assert wc.colorref("#F0F2F5") == 0xF5F2F0
    assert wc.colorref("#1f2937") == 0x37291F
    with pytest.raises(ValueError):
        wc.colorref("#FFF")


def test_applies_caption_text_border_and_light_mode():
    ok, dwm = _apply()
    assert ok
    assert dwm.calls == [
        (42, wc.DWMWA_USE_IMMERSIVE_DARK_MODE, 0),
        (42, wc.DWMWA_CAPTION_COLOR, 0xF5F2F0),
        (42, wc.DWMWA_TEXT_COLOR, 0x37291F),
        (42, wc.DWMWA_BORDER_COLOR, 0xF5F2F0),
    ]
    assert (wc.DWMWA_BORDER_COLOR, wc.DWMWA_CAPTION_COLOR, wc.DWMWA_TEXT_COLOR) == (
        34,
        35,
        36,
    )


@pytest.mark.parametrize(
    "kwargs,reason",
    [
        ({"is_windows": False}, "not_windows"),
        ({"hwnd": None}, "no_hwnd"),
        ({"build": 19045}, "old_windows"),
    ],
)
def test_skips_with_a_structured_log(kwargs, reason):
    with capture_logs() as logs:
        ok, dwm = _apply(**kwargs)
    assert not ok and dwm.calls == []
    assert logs[0]["event"] == "title_bar_color_skipped"
    assert logs[0]["reason"] == reason


def test_boundary_build_22000_is_applied():
    assert _apply(build=22000)[0]


def test_dwm_failure_is_logged_and_not_raised():
    with capture_logs() as logs:
        ok, _ = _apply(dwm=FakeDwm(hr=-2147024809))
    assert not ok
    assert logs[0]["reason"] == "dwm_rejected"
    assert logs[0]["hresult"] == 0x80070057
    assert (logs[0]["applied"], logs[0]["total"]) == (0, 4)


def test_partial_dwm_failure_logs_how_many_applied():
    with capture_logs() as logs:
        ok, dwm = _apply(dwm=FakeDwm(hr=-2147024809, fail_at=2))
    assert not ok
    assert len(dwm.calls) == 3
    assert logs[0]["reason"] == "dwm_rejected"
    assert logs[0]["attribute"] == wc.DWMWA_TEXT_COLOR
    assert (logs[0]["applied"], logs[0]["total"]) == (2, 4)


def test_exception_mid_way_logs_how_many_applied():
    with capture_logs() as logs:
        ok, _ = _apply(dwm=FakeDwm(raise_at=1))
    assert not ok
    assert logs[0]["reason"] == "error"
    assert logs[0]["error_type"] == "OSError"
    assert (logs[0]["applied"], logs[0]["total"]) == (1, 4)


def test_loader_exception_is_swallowed():
    def boom():
        raise OSError("no dwm")

    with capture_logs() as logs:
        ok = wc.apply_title_bar_colors(
            1, is_windows=True, get_build=lambda: 22631, load_dwmapi=boom
        )
    assert not ok
    assert logs[0]["error_type"] == "OSError"


def _window(handle=42):
    return SimpleNamespace(native=SimpleNamespace(Handle=handle))


def test_handler_applies_once_after_success():
    seen: list[int | None] = []
    h = wc.make_title_bar_handler(_window(), lambda hwnd: seen.append(hwnd) or True)
    h()
    h("extra")
    assert seen == [42]


def test_handler_retries_after_failure_and_never_raises():
    results = iter([False, RuntimeError("x"), True])

    def apply(_hwnd):
        r = next(results)
        if isinstance(r, Exception):
            raise r
        return r

    h = wc.make_title_bar_handler(_window(), apply)
    h()
    h()
    h()
    h()
    assert next(results, None) is None


def test_hwnd_of_handles_missing_native():
    assert wc._hwnd_of(SimpleNamespace()) is None
    assert wc._hwnd_of(_window(None)) is None
    assert wc._hwnd_of(_window(SimpleNamespace(ToInt64=lambda: 7))) == 7


def test_colours_match_frontend_tokens():
    src = COLOR_TS.read_text(encoding="utf-8")
    window = re.search(r"window:\s*'(#[0-9A-Fa-f]{6})'", src)
    primary = re.search(r"primary:\s*'(#[0-9A-Fa-f]{6})'", src)
    assert window and primary
    assert window.group(1).upper() == wc.WINDOW_SURFACE.upper()
    assert primary.group(1).upper() == wc.PRIMARY_INK.upper()
