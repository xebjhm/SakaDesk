"""Tests for backend.services.window_geometry (pure, GUI-backend-free).

Covers the save/load round-trip normalization and — for SD-AUX-04 — the
on-screen validation of a saved window position: a minimized-close sentinel
(-32000) or a rectangle that no longer intersects the virtual screen must drop
the position (keeping the size) so the window can never restore off-screen.
"""

from __future__ import annotations

from backend.services import window_geometry as wg


# A generous single-monitor virtual screen used by the position tests so they
# never depend on the machine actually running them.
_SCREEN = wg.VirtualScreen(x=0, y=0, width=1920, height=1080)


class TestSizeParsing:
    def test_none_returns_default(self):
        default = {"width": 1200, "height": 800}
        assert wg.parse_saved_geometry(None, default=default) == default

    def test_valid_size_kept(self):
        out = wg.parse_saved_geometry(
            {"width": 1000, "height": 700}, default={"width": 1, "height": 1}
        )
        assert out["width"] == 1000 and out["height"] == 700

    def test_out_of_bounds_size_falls_back(self):
        default = {"width": 1200, "height": 800}
        assert (
            wg.parse_saved_geometry({"width": 10, "height": 10}, default=default)
            == default
        )


class TestPositionOnScreen:
    """SD-AUX-04: saved x/y must be validated against the virtual screen."""

    def test_on_screen_position_kept(self):
        out = wg.parse_saved_geometry(
            {"width": 1000, "height": 700, "x": 100, "y": 50},
            default={"width": 1, "height": 1},
            screen=_SCREEN,
        )
        assert out["x"] == 100 and out["y"] == 50

    def test_minimized_sentinel_position_dropped(self):
        # A minimized WinForms window reports Location = (-32000, -32000);
        # persisting that must not restore the window off-screen next launch.
        out = wg.parse_saved_geometry(
            {"width": 1000, "height": 700, "x": -32000, "y": -32000},
            default={"width": 1, "height": 1},
            screen=_SCREEN,
        )
        assert "x" not in out and "y" not in out
        assert out["width"] == 1000 and out["height"] == 700

    def test_fully_offscreen_position_dropped(self):
        # Saved on a secondary monitor that is now unplugged: the rectangle no
        # longer intersects the virtual screen at all -> drop the position.
        out = wg.parse_saved_geometry(
            {"width": 1000, "height": 700, "x": 5000, "y": 5000},
            default={"width": 1, "height": 1},
            screen=_SCREEN,
        )
        assert "x" not in out and "y" not in out

    def test_partially_offscreen_position_kept(self):
        # A window whose title bar is still reachable (rectangle intersects the
        # screen) is fine — do not fight the user's chosen placement.
        out = wg.parse_saved_geometry(
            {"width": 1000, "height": 700, "x": -50, "y": 20},
            default={"width": 1, "height": 1},
            screen=_SCREEN,
        )
        assert out["x"] == -50 and out["y"] == 20

    def test_negative_multimonitor_position_kept(self):
        # A monitor left of the primary has negative virtual coords; a window
        # fully inside it must be preserved.
        screen = wg.VirtualScreen(x=-1920, y=0, width=3840, height=1080)
        out = wg.parse_saved_geometry(
            {"width": 800, "height": 600, "x": -1800, "y": 100},
            default={"width": 1, "height": 1},
            screen=screen,
        )
        assert out["x"] == -1800 and out["y"] == 100
