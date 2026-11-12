"""Main-window size diagnostics and the minimum-size guard (N-R4-1).

On Windows at 175 % the restored main window's height was found stuck at
2,188 device px (the screen's max-track height) while its width resized fine,
as if the form's ``MinimumSize`` height had been inflated after creation. The
cause is not proven; this module records the evidence and applies a guarded fix.

Breadcrumbs (numbers only, never titles, paths or text):

- ``window_geometry`` with ``phase`` = ``created`` (when attached), ``shown``,
  ``state_normal`` / ``state_minimized`` / ``state_maximized`` (every
  ``WindowState`` change, seen on ``Resize``), ``dpi_changed`` and
  ``resize_end`` (throttled to one per :data:`RESIZE_END_THROTTLE_S`). Fields:
  ``min_w``/``min_h``, ``max_w``/``max_h``, ``w``/``h``, ``restore_x``/
  ``restore_y``/``restore_w``/``restore_h``, ``dpi`` (``DeviceDpi``), ``state``
  (``WindowState`` as an int) and ``webview_w``/``webview_h`` (the first child
  control, pywebview's WebView2 host). A value that cannot be read is ``None``.
- ``window_min_size_reapplied`` (``phase``, ``old_w``/``old_h``,
  ``new_w``/``new_h``, ``dpi``): ``MinimumSize`` differed from the intended
  minimum (``window_geometry.min_window_size`` at the current DPI, in device px)
  by more than :data:`MIN_SIZE_TOLERANCE_PX` and was set back. Checked on
  ``Shown``, on ``DpiChanged`` and on every ``WindowState`` change.
- ``window_geometry_failed`` (``phase``, ``error_type``): any failure. Nothing
  here ever raises into the GUI thread.

Pure Python on duck-typed objects: no pythonnet or pywebview import, so Linux CI
tests it with fakes. ``make_size`` builds a ``System.Drawing.Size`` on Windows.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

import structlog

from backend.services import window_geometry

logger = structlog.get_logger(__name__)

RESIZE_END_THROTTLE_S = 1.0
MIN_SIZE_TOLERANCE_PX = 2
_STATE_NAMES = {0: "normal", 1: "minimized", 2: "maximized"}


def _num(value: Any) -> int | None:
    try:
        return int(value)
    except Exception:
        return None


def _wh(obj: Any) -> tuple[int | None, int | None]:
    if obj is None:
        return None, None
    return _num(getattr(obj, "Width", None)), _num(getattr(obj, "Height", None))


class WindowDiagnostics:
    """Logs the main form's size state and keeps its ``MinimumSize`` honest."""

    def __init__(
        self,
        form: Any,
        *,
        make_size: Callable[[int, int], Any],
        min_logical: Callable[[float], tuple[int, int]] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._form = form
        self._make_size = make_size
        self._min_logical = min_logical or (
            lambda scale: window_geometry.min_window_size(scale=scale)
        )
        self._clock = clock
        self._last_state: int | None = None
        self._last_resize_end: float | None = None

    # --- reading ------------------------------------------------------------------

    def _dpi(self) -> int | None:
        return _num(getattr(self._form, "DeviceDpi", None))

    def snapshot(self) -> dict[str, int | None]:
        f = self._form
        min_w, min_h = _wh(getattr(f, "MinimumSize", None))
        max_w, max_h = _wh(getattr(f, "MaximumSize", None))
        w, h = _wh(getattr(f, "Size", None))
        rb = getattr(f, "RestoreBounds", None)
        webview_w = webview_h = None
        try:
            controls = getattr(f, "Controls", None)
            if controls is not None:
                count = getattr(controls, "Count", None)
                if _num(count if count is not None else len(controls)):
                    webview_w, webview_h = _wh(controls[0])
        except Exception:
            pass
        return {
            "min_w": min_w,
            "min_h": min_h,
            "max_w": max_w,
            "max_h": max_h,
            "w": w,
            "h": h,
            "restore_x": _num(getattr(rb, "X", None)) if rb is not None else None,
            "restore_y": _num(getattr(rb, "Y", None)) if rb is not None else None,
            "restore_w": _num(getattr(rb, "Width", None)) if rb is not None else None,
            "restore_h": _num(getattr(rb, "Height", None)) if rb is not None else None,
            "dpi": self._dpi(),
            "state": _num(getattr(f, "WindowState", None)),
            "webview_w": webview_w,
            "webview_h": webview_h,
        }

    def log(self, phase: str) -> None:
        try:
            logger.info("window_geometry", phase=phase, **self.snapshot())
        except Exception as e:
            logger.warning(
                "window_geometry_failed", phase=phase, error_type=type(e).__name__
            )

    # --- the guard ------------------------------------------------------------------

    def intended_min(self) -> tuple[int, int] | None:
        """The intended ``MinimumSize`` in device px at the current DPI, or None."""
        dpi = self._dpi()
        if not dpi or dpi <= 0:
            return None
        scale = dpi / 96.0
        lw, lh = self._min_logical(scale)
        return round(lw * scale), round(lh * scale)

    def reapply_min(self, phase: str) -> bool:
        """Set ``MinimumSize`` back when it drifted from :meth:`intended_min`."""
        try:
            want = self.intended_min()
            old_w, old_h = _wh(getattr(self._form, "MinimumSize", None))
            if want is None or old_w is None or old_h is None:
                return False
            if (
                abs(old_w - want[0]) <= MIN_SIZE_TOLERANCE_PX
                and abs(old_h - want[1]) <= MIN_SIZE_TOLERANCE_PX
            ):
                return False
            self._form.MinimumSize = self._make_size(want[0], want[1])
            logger.info(
                "window_min_size_reapplied",
                phase=phase,
                old_w=old_w,
                old_h=old_h,
                new_w=want[0],
                new_h=want[1],
                dpi=self._dpi(),
            )
            return True
        except Exception as e:
            logger.warning(
                "window_geometry_failed",
                phase=f"reapply_{phase}",
                error_type=type(e).__name__,
            )
            return False

    # --- event handlers (GUI thread) ------------------------------------------------

    def on_shown(self, *_args: Any) -> None:
        self.log("shown")
        self.reapply_min("shown")

    def on_resize(self, *_args: Any) -> None:
        """``Resize`` fires on every size step: act only on a ``WindowState`` change."""
        try:
            state = _num(getattr(self._form, "WindowState", None))
            if state is None or state == self._last_state:
                return
            self._last_state = state
            phase = f"state_{_STATE_NAMES.get(state, state)}"
            self.log(phase)
            self.reapply_min(phase)
        except Exception as e:
            logger.warning(
                "window_geometry_failed", phase="resize", error_type=type(e).__name__
            )

    def on_resize_end(self, *_args: Any) -> None:
        try:
            now = self._clock()
            if (
                self._last_resize_end is not None
                and now - self._last_resize_end < RESIZE_END_THROTTLE_S
            ):
                return
            self._last_resize_end = now
            self.log("resize_end")
        except Exception as e:
            logger.warning(
                "window_geometry_failed",
                phase="resize_end",
                error_type=type(e).__name__,
            )

    def on_dpi_changed(self, *_args: Any) -> None:
        self.log("dpi_changed")
        self.reapply_min("dpi_changed")

    def attach(self) -> bool:
        """Log ``created`` and subscribe the handlers; never raises."""
        self.log("created")
        try:
            self._last_state = _num(getattr(self._form, "WindowState", None))
            self._form.Shown += self.on_shown
            self._form.Resize += self.on_resize
            self._form.ResizeEnd += self.on_resize_end
            self._form.DpiChanged += self.on_dpi_changed
        except Exception as e:
            logger.warning(
                "window_geometry_failed", phase="attach", error_type=type(e).__name__
            )
            return False
        return True


def attach_window_diagnostics(window: Any) -> bool:
    """Attach :class:`WindowDiagnostics` to a pywebview window's WinForms form.

    Call from ``window.events.before_show`` (the form exists by then). Imports
    ``System.Drawing`` lazily (Windows only); never raises.
    """
    form = getattr(window, "native", None)
    if form is None:
        logger.warning("window_geometry_failed", phase="attach", error_type="no_native")
        return False
    try:
        from System.Drawing import Size  # type: ignore[import-not-found]
    except Exception as e:
        logger.warning(
            "window_geometry_failed", phase="attach", error_type=type(e).__name__
        )
        return False
    return WindowDiagnostics(form, make_size=lambda w, h: Size(w, h)).attach()


__all__ = [
    "MIN_SIZE_TOLERANCE_PX",
    "RESIZE_END_THROTTLE_S",
    "WindowDiagnostics",
    "attach_window_diagnostics",
]
