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
from typing import Any, Optional

# First-open window size in LOGICAL (DPI-independent) units. Scaled to device
# pixels for the actual monitor DPI (see default_geometry) so the window opens at
# the same apparent size for every user regardless of their display scaling.
BASE_LOGICAL: dict[str, int] = {"width": 1200, "height": 800}

# Sanity bounds (device pixels) so a corrupt/absurd saved size falls back to the
# default instead of an unusable window.
_MIN_W, _MIN_H, _MAX_W, _MAX_H = 400, 300, 7680, 4320

# Plausible Windows DPI scaling range (50%..400%); a reading outside it is bogus.
_MIN_SCALE, _MAX_SCALE = 0.5, 4.0


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


def default_geometry(scale: Optional[float] = None) -> dict:
    """First-open window size in DEVICE pixels: ``BASE_LOGICAL`` x the monitor DPI
    scale, so the window looks the same relative to the (DPI-scaled) UI at any
    scale (100% -> 1200x800, 175% -> 2100x1400, ...). ``scale`` defaults to the
    live primary-monitor scale."""
    if scale is None:
        scale = dpi_scale()
    return {
        "width": round(BASE_LOGICAL["width"] * scale),
        "height": round(BASE_LOGICAL["height"] * scale),
    }


def parse_saved_geometry(data: Optional[dict], default: Optional[dict] = None) -> dict:
    """Normalize a stored ``window`` dict into ``create_window()`` device-pixel
    coordinates, used verbatim (no scale conversion).

    ``None``/invalid/out-of-bounds -> ``default`` (a DPI-scaled first-open size
    when not supplied). A legacy ``format`` key from older builds is ignored, and
    a malformed position is dropped while a valid size is kept.
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

    result: dict[str, int] = {"width": w, "height": h}
    try:
        if data.get("x") is not None and data.get("y") is not None:
            result["x"] = int(data["x"])
            result["y"] = int(data["y"])
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
