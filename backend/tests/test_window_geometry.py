"""Window geometry persistence — regression tests for the "window shrinks on
every restart at non-100% DPI" bug.

pywebview's WinForms backend round-trips geometry VERBATIM: the size handed to
``create_window(width, height, x, y)`` comes back unchanged from the live
``window.width/height/x/y`` properties (both are the same device-pixel space on
this backend). Verified in the field at 175% DPI: ``create_window(894)`` yields
``window.width == 893``. Geometry is therefore stored and restored as-is.

An earlier version divided the saved size by the monitor DPI scale on the
assumption that ``create_window`` took logical units and re-applied the scale.
The backend does NOT re-scale, so that division was uncompensated and the window
shrank by ``scale``x on every restart (e.g. 894 -> 894/1.75 = 510 -> ...). These
tests lock the verbatim round-trip so neither shrink nor growth can return.
"""

from backend.services import window_geometry as wg


def test_parse_uses_values_verbatim():
    data = {"width": 1600, "height": 1000, "x": 120, "y": 60}
    assert wg.parse_saved_geometry(data) == data


def test_save_load_round_trips_verbatim():
    geom = {"width": 1600, "height": 1000, "x": 120, "y": 60}
    assert wg.parse_saved_geometry(wg.to_saved_dict(geom)) == geom


def test_no_drift_over_many_restarts():
    """The core regression: repeated save->load cycles must not change the size —
    no shrink, no growth — because create_window reproduces exactly what
    window.width reported."""
    geom = {"width": 1600, "height": 1000, "x": 120, "y": 60}
    cur = dict(geom)
    for _ in range(10):
        cur = wg.parse_saved_geometry(wg.to_saved_dict(cur))
    assert cur == geom


def test_legacy_format_key_is_ignored():
    # Files from older builds carry format="logical"; it's inert now — load as-is.
    data = {"width": 1400, "height": 900, "format": "logical", "x": 10, "y": 20}
    assert wg.parse_saved_geometry(data) == {
        "width": 1400,
        "height": 900,
        "x": 10,
        "y": 20,
    }


def test_size_without_position_ok():
    assert wg.parse_saved_geometry({"width": 1200, "height": 800}) == {
        "width": 1200,
        "height": 800,
    }


def test_invalid_or_out_of_bounds_returns_defaults():
    assert wg.parse_saved_geometry(None) == wg.DEFAULTS
    assert wg.parse_saved_geometry({}) == wg.DEFAULTS
    # Too small / too large fall back to defaults (guards a corrupt file).
    assert wg.parse_saved_geometry({"width": 50, "height": 50}) == wg.DEFAULTS
    assert wg.parse_saved_geometry({"width": 99999, "height": 99999}) == wg.DEFAULTS


def test_non_integer_size_returns_defaults():
    assert wg.parse_saved_geometry({"width": "abc", "height": 800}) == wg.DEFAULTS


def test_bad_position_drops_position_keeps_size():
    data = {"width": 1200, "height": 800, "x": "bad", "y": 50}
    result = wg.parse_saved_geometry(data)
    assert result["width"] == 1200 and result["height"] == 800
    assert "x" not in result and "y" not in result


def test_to_saved_dict_shapes_size_and_position():
    assert wg.to_saved_dict({"width": 1200, "height": 800, "x": 5, "y": 6}) == {
        "width": 1200,
        "height": 800,
        "x": 5,
        "y": 6,
    }
    # Position omitted when absent.
    assert wg.to_saved_dict({"width": 1200, "height": 800}) == {
        "width": 1200,
        "height": 800,
    }


def test_defaults_are_sane():
    assert wg.DEFAULTS == {"width": 1200, "height": 800}
