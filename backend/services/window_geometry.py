"""Persistence of the desktop window's size/position across restarts.

pywebview's WinForms backend round-trips geometry VERBATIM: the size handed to
``create_window(width, height, x, y)`` comes back unchanged from the live
``window.width/height/x/y`` properties (both are the same device-pixel space on
this backend). Verified in the field at 175% DPI: ``create_window(894)`` yields
``window.width == 893``. Geometry is therefore stored and restored as-is, with
no DPI/scale conversion.

An earlier version divided the saved size by the monitor DPI scale on the
assumption that ``create_window`` took logical units and re-applied the scale.
The backend does NOT re-scale, so that division was uncompensated on load and the
window shrank by ``scale``x on every restart (e.g. 894 -> 510 -> ... at 175%).
This module has no ``webview`` import so the logic stays unit-testable without
the GUI backend.
"""

from __future__ import annotations

from typing import Any, Optional

DEFAULTS: dict[str, int] = {"width": 1200, "height": 800}

# Sanity bounds so a corrupt/absurd saved size falls back to defaults instead of
# an unusable window.
_MIN_W, _MIN_H, _MAX_W, _MAX_H = 400, 300, 7680, 4320


def parse_saved_geometry(data: Optional[dict]) -> dict:
    """Normalize a stored ``window`` dict into ``create_window()`` coordinates.

    Values are used verbatim (no scale conversion). ``None``/invalid/out-of-bounds
    -> a copy of DEFAULTS. A legacy ``format`` key (from older builds) is ignored.
    A malformed position is dropped while a valid size is kept.
    """
    if not data:
        return dict(DEFAULTS)
    try:
        w = int(data.get("width", 0))
        h = int(data.get("height", 0))
    except (ValueError, TypeError):
        return dict(DEFAULTS)

    if not (_MIN_W <= w <= _MAX_W and _MIN_H <= h <= _MAX_H):
        return dict(DEFAULTS)

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
