"""Persistence of the desktop window's size/position across restarts.

pywebview's WinForms backend round-trips geometry VERBATIM: the size handed to
``create_window(width, height, x, y)`` comes back unchanged from the live
``window.width/height/x/y`` properties (both are the same device-pixel space on
this backend). Verified in the field at 175% DPI: ``create_window(894)`` yields
``window.width == 893``. Saved geometry is therefore stored and restored as-is,
with no DPI/scale conversion.

An earlier version divided the SAVED size by the monitor DPI scale on the
assumption that ``create_window`` took logical units and re-applied the scale.
The backend does NOT re-scale, so that division was uncompensated on load and the
window shrank by ``scale``x on every restart (e.g. 894 -> 510 -> ... at 175%).

The DPI scale IS still used, but only for the FIRST-OPEN default (no saved value
yet): a fixed logical base is scaled to device pixels so the initial window
presents the same apparent size at any monitor scale, instead of looking tiny on
high-DPI displays. This is a one-shot sizing, never part of the round-trip, so it
cannot compound. This module has no ``webview`` import so the logic stays
unit-testable without the GUI backend.
"""

from __future__ import annotations

import ctypes
import platform
from typing import Any, NamedTuple, Optional

# First-open window size in LOGICAL (DPI-independent) units. Scaled to device
# pixels for the actual monitor DPI (see default_geometry) so the window opens at
# the same apparent size for every user regardless of their display scaling.
BASE_LOGICAL: dict[str, int] = {"width": 1200, "height": 800}

# Smallest window in LOGICAL units. Handed to pywebview unscaled (WinForms
# applies the DPI itself, see min_window_size). 960 wide leaves
# the content sheet about 840 px beside the service and feature rails (64 + 48
# + 8): enough for a Memories member pane (12.5-15rem) plus a grid of at least
# two 9rem album tiles beside the polaroid, and for the chat's member list
# beside a readable bubble column. 640 tall keeps the page header, the filter
# row and about two tile rows (or a chat composer plus several bubbles) on
# screen. pywebview's own default (200 x 100) let the album collapse.
MIN_LOGICAL: dict[str, int] = {"width": 960, "height": 640}

# GetSystemMetrics: client area of a full-screen window on the primary monitor
# (the screen minus the taskbar and a caption), in device pixels.
_SM_CXFULLSCREEN, _SM_CYFULLSCREEN = 16, 17

# Sanity bounds (device pixels) so a corrupt/absurd saved size falls back to the
# default instead of an unusable window.
_MIN_W, _MIN_H, _MAX_W, _MAX_H = 400, 300, 7680, 4320

# Plausible Windows DPI scaling range (50%..400%); a reading outside it is bogus.
_MIN_SCALE, _MAX_SCALE = 0.5, 4.0

# GetSystemMetrics indices for the virtual-screen bounding rectangle (winuser.h).
_SM_XVIRTUALSCREEN, _SM_YVIRTUALSCREEN = 76, 77
_SM_CXVIRTUALSCREEN, _SM_CYVIRTUALSCREEN = 78, 79

# A minimized window reports Location = (-32000, -32000); persisting that value
# as a saved position would restore the window off-screen next launch (SD-AUX-04).
# We use a -30000 threshold (above the observed -32000) so any saved coordinate
# at or below it — the real sentinel and any near-sentinel value — is treated as
# iconic and dropped.
_ICONIC_SENTINEL = -30000


class VirtualScreen(NamedTuple):
    """Virtual-screen bounding rectangle in device pixels (spans all monitors).

    ``x``/``y`` are the top-left origin (negative when a monitor sits left of or
    above the primary); ``width``/``height`` are the total extent.
    """

    x: int
    y: int
    width: int
    height: int


def dpi_scale() -> float:
    """Primary-monitor DPI scale factor (1.0=100%, 1.5=150%, 1.75=175%, ...),
    clamped to a sane range; 1.0 on non-Windows.

    Used ONLY to size the first-open default window (logical -> device pixels),
    never for the save/load round-trip — that is verbatim, because create_window
    round-trips device pixels unchanged.
    """
    if platform.system() != "Windows":
        return 1.0
    try:
        raw = float(ctypes.windll.shcore.GetScaleFactorForDevice(0)) / 100.0  # type: ignore[attr-defined]
        if raw > 0:
            return max(_MIN_SCALE, min(_MAX_SCALE, raw))
    except Exception:
        pass
    return 1.0


def virtual_screen_bounds() -> Optional[VirtualScreen]:
    """The virtual-screen rectangle (all monitors) in device pixels, or ``None``
    on non-Windows / on failure.

    Mirrors ``dpi_scale()``'s defensive ctypes pattern. Used by
    ``parse_saved_geometry`` to reject a saved position that no longer lands on
    any monitor (e.g. a display that was unplugged). ``None`` means "can't
    tell" — callers then keep the saved position rather than fight it.
    """
    if platform.system() != "Windows":
        return None
    try:
        gsm = ctypes.windll.user32.GetSystemMetrics  # type: ignore[attr-defined]
        x = int(gsm(_SM_XVIRTUALSCREEN))
        y = int(gsm(_SM_YVIRTUALSCREEN))
        w = int(gsm(_SM_CXVIRTUALSCREEN))
        h = int(gsm(_SM_CYVIRTUALSCREEN))
        if w > 0 and h > 0:
            return VirtualScreen(x=x, y=y, width=w, height=h)
    except Exception:
        pass
    return None


def _position_is_usable(
    x: int, y: int, w: int, h: int, screen: Optional[VirtualScreen]
) -> bool:
    """Whether a saved window rectangle (SD-AUX-04) should be restored as-is.

    Rejects the minimized ``-32000`` iconic sentinel outright, and — when the
    virtual-screen bounds are known — any rectangle that does not intersect the
    screen at all (dropped in favor of the OS default-placing the window).
    A partially off-screen window (title bar still reachable) is kept.
    """
    if x <= _ICONIC_SENTINEL or y <= _ICONIC_SENTINEL:
        return False
    if screen is None:
        return True  # bounds unknown -> trust the saved position
    # Axis-aligned rectangle intersection with the virtual screen.
    return (
        x < screen.x + screen.width
        and x + w > screen.x
        and y < screen.y + screen.height
        and y + h > screen.y
    )


_SCREEN_UNSET_MIN: Any = object()


def default_geometry(
    scale: Optional[float] = None, work: Any = _SCREEN_UNSET_MIN
) -> dict:
    """First-open window size in DEVICE pixels: ``BASE_LOGICAL`` x the monitor DPI
    scale, so the window looks the same relative to the (DPI-scaled) UI at any
    scale (100% -> 1200x800, 175% -> 2100x1400, ...). ``scale`` defaults to the
    live primary-monitor scale.

    N-R4-4: when the primary monitor's usable area is known (``work``, device
    px; default the live ``primary_work_size()``, ``None`` = unknown), the size
    is capped to it and the window is centred on it with an explicit ``x``/``y``.
    Without a position pywebview starts the form centre-screen, and on that path
    WinForms grew the 2100 x 1400 request to 3657 x 2402 at 175 % (taller than
    the 2160 px screen); with a position it takes the same path as restored
    geometry, which round-trips verbatim.
    """
    if scale is None:
        scale = dpi_scale()
    w = round(BASE_LOGICAL["width"] * scale)
    h = round(BASE_LOGICAL["height"] * scale)
    if work is _SCREEN_UNSET_MIN:
        work = primary_work_size()
    if work is None:
        return {"width": w, "height": h}
    w, h = min(w, work[0]), min(h, work[1])
    return {"width": w, "height": h, "x": (work[0] - w) // 2, "y": (work[1] - h) // 2}


def primary_work_size() -> Optional[tuple[int, int]]:
    """The primary monitor's usable size in device pixels, or ``None`` when
    unknown (non-Windows / failure)."""
    if platform.system() != "Windows":
        return None
    try:
        gsm = ctypes.windll.user32.GetSystemMetrics  # type: ignore[attr-defined]
        w, h = int(gsm(_SM_CXFULLSCREEN)), int(gsm(_SM_CYFULLSCREEN))
        if w > 0 and h > 0:
            return w, h
    except Exception:
        pass
    return None


def min_window_size(
    scale: Optional[float] = None,
    work: Any = _SCREEN_UNSET_MIN,
) -> tuple[int, int]:
    """pywebview ``min_size`` in LOGICAL (96-DPI) pixels.

    Unlike ``create_window``'s size, pywebview's WinForms backend hands
    ``min_size`` to ``Form.MinimumSize`` BEFORE switching the form to
    ``AutoScaleMode.Dpi`` (pywebview 5.3.2, ``BrowserForm.__init__``), so
    WinForms multiplies it by the DPI scale once more. A device-pixel value was
    therefore scaled twice (N1: 1680 x 1120 at 175% became 2922 x 1912 device
    px). This returns the logical size, so the EFFECTIVE minimum is
    ``MIN_LOGICAL`` (960 x 640 CSS px) at any DPI.

    The cap and the sanity floor are applied in device pixels, where the screen
    is measured: the minimum is capped to the primary monitor's usable area so a
    small or heavily scaled screen (e.g. 1920x1080 at 175%) can still hold the
    window, then divided back by ``scale``. ``scale`` and ``work`` default to
    the live values; ``work=None`` means "unknown" (no cap).
    """
    if scale is None:
        scale = dpi_scale()
    if work is _SCREEN_UNSET_MIN:
        work = primary_work_size()
    w = round(MIN_LOGICAL["width"] * scale)
    h = round(MIN_LOGICAL["height"] * scale)
    if work is not None:
        w, h = min(w, work[0]), min(h, work[1])
    w, h = max(w, _MIN_W), max(h, _MIN_H)
    # Floor, not round: WinForms re-applies ``scale``, and rounding up could
    # push a capped minimum one pixel past the usable area.
    return int(w / scale), int(h / scale)


# Sentinel distinguishing "caller passed no screen" from an explicit ``None``
# (which means "bounds are known to be unavailable, keep the saved position").
_SCREEN_UNSET: Any = object()


def parse_saved_geometry(
    data: Optional[dict],
    default: Optional[dict] = None,
    *,
    screen: Any = _SCREEN_UNSET,
    work: Any = _SCREEN_UNSET_MIN,
) -> dict:
    """Normalize a stored ``window`` dict into ``create_window()`` device-pixel
    coordinates, used verbatim (no scale conversion).

    ``None``/invalid/out-of-bounds -> ``default`` (a DPI-scaled first-open size
    when not supplied). A legacy ``format`` key from older builds is ignored, and
    a malformed position is dropped while a valid size is kept.

    SD-AUX-04: a saved position is also dropped (size kept) when it is the
    minimized ``-32000`` iconic sentinel or does not intersect the current
    virtual screen (e.g. a monitor that was unplugged) — otherwise the window
    would restore fully off-screen and appear not to launch. ``screen`` defaults
    to the live ``virtual_screen_bounds()``; tests may inject a ``VirtualScreen``
    or ``None`` (``None`` = bounds unknown, keep the position).

    N-R4-1: the size is capped to the primary monitor's usable area (``work``,
    device px; default the live ``primary_work_size()``, ``None`` = unknown, no
    cap). ``window.width/height`` read at close are the MAXIMIZED bounds when the
    window closes maximized (e.g. 3868 x 2188 on a 3840 x 2160 screen at 175 %),
    and restoring that as a normal window put its bottom edge off the screen.
    """
    fallback = default if default is not None else default_geometry()
    if not data:
        return dict(fallback)
    try:
        w = int(data.get("width", 0))
        h = int(data.get("height", 0))
    except (ValueError, TypeError):
        return dict(fallback)

    if not (_MIN_W <= w <= _MAX_W and _MIN_H <= h <= _MAX_H):
        return dict(fallback)

    if work is _SCREEN_UNSET_MIN:
        work = primary_work_size()
    if work is not None:
        w, h = min(w, work[0]), min(h, work[1])

    result: dict[str, int] = {"width": w, "height": h}
    if screen is _SCREEN_UNSET:
        screen = virtual_screen_bounds()
    try:
        if data.get("x") is not None and data.get("y") is not None:
            x = int(data["x"])
            y = int(data["y"])
            if _position_is_usable(x, y, w, h, screen):
                result["x"] = x
                result["y"] = y
    except (ValueError, TypeError):
        pass  # keep the valid size, drop the bad position
    return result


def to_saved_dict(geom: dict) -> dict:
    """Shape a window geometry dict (``{width, height[, x, y]}``) for storage."""
    data: dict[str, Any] = {
        "width": int(geom["width"]),
        "height": int(geom["height"]),
    }
    if geom.get("x") is not None and geom.get("y") is not None:
        data["x"] = int(geom["x"])
        data["y"] = int(geom["y"])
    return data
