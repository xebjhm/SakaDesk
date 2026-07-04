"""DPI-aware persistence of the desktop window's size/position.

pywebview's WinForms backend takes ``create_window(width, height, x, y)`` as
LOGICAL (DPI-independent) coordinates and multiplies them by the monitor scale
factor internally, whereas the live ``window.width/height/x/y`` properties
report PHYSICAL (already-scaled) pixels. Geometry must therefore be STORED in
logical units: convert physical -> logical when saving, and hand logical values
straight to ``create_window`` when loading.

Storing physical values (as an earlier version did — reading the physical window
properties and writing them tagged ``format="logical"`` without converting) made
``create_window`` re-apply the scale, so the window GREW by ``scale`` x on every
restart (e.g. 1200 -> 1800 -> 2700 -> ... at 150% DPI). This module is kept free
of any ``webview`` import so the logic is unit-testable without the GUI backend.
"""

from __future__ import annotations

import ctypes
import platform
from typing import Any, Optional

DEFAULTS: dict[str, int] = {"width": 1200, "height": 800}

# Sanity bounds (applied to the stored value before any scale conversion), so a
# corrupt/absurd saved size falls back to defaults instead of an unusable window.
_MIN_W, _MIN_H, _MAX_W, _MAX_H = 400, 300, 7680, 4320


def dpi_scale() -> float:
    """Return the primary monitor's DPI scale factor (e.g. 1.5 for 150%).

    Returns 1.0 on non-Windows platforms (and on any failure), where no
    logical/physical mismatch exists.
    """
    if platform.system() != "Windows":
        return 1.0
    try:
        return ctypes.windll.shcore.GetScaleFactorForDevice(0) / 100.0  # type: ignore[attr-defined,no-any-return]
    except Exception:
        return 1.0


def physical_to_logical(geom: dict, scale: float) -> dict:
    """Convert physical (scaled) window properties into logical units for storage.

    ``geom`` is the live window's ``{width, height[, x, y]}`` in physical pixels.
    Dividing by ``scale`` yields the logical size ``create_window`` expects, so a
    subsequent load round-trips to the same physical size instead of compounding.
    """
    if scale <= 0:
        scale = 1.0
    out: dict[str, int] = {
        "width": round(geom["width"] / scale),
        "height": round(geom["height"] / scale),
    }
    if geom.get("x") is not None and geom.get("y") is not None:
        out["x"] = round(geom["x"] / scale)
        out["y"] = round(geom["y"] / scale)
    return out


def to_saved_dict(logical_geom: dict) -> dict:
    """Shape a logical-coordinate geometry dict for on-disk storage."""
    data: dict[str, Any] = {
        "width": int(logical_geom["width"]),
        "height": int(logical_geom["height"]),
        "format": "logical",
    }
    if "x" in logical_geom and "y" in logical_geom:
        data["x"] = int(logical_geom["x"])
        data["y"] = int(logical_geom["y"])
    return data


def parse_saved_geometry(data: Optional[dict], scale: float) -> dict:
    """Normalize a stored ``window`` dict into logical coords for create_window().

    - ``None``/invalid/out-of-bounds -> a copy of DEFAULTS.
    - ``format != "logical"`` (legacy physical files) -> divide by ``scale``.
    - ``format == "logical"`` -> already logical, used as-is.
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

    legacy = data.get("format") != "logical"
    if legacy and scale > 0:
        w = round(w / scale)
        h = round(h / scale)

    result: dict[str, int] = {"width": w, "height": h}
    try:
        if "x" in data and "y" in data:
            x = int(data["x"])
            y = int(data["y"])
            if legacy and scale > 0:
                x = round(x / scale)
                y = round(y / scale)
            result["x"] = x
            result["y"] = y
    except (ValueError, TypeError):
        pass  # keep the valid size, drop the bad position
    return result
