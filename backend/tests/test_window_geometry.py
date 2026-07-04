"""DPI-aware window geometry — regression tests for the 'window grows on every
restart at non-100% DPI' bug (physical pixels were saved tagged as logical, so
create_window re-applied the scale each launch)."""

from backend.services import window_geometry as wg


def test_physical_to_logical_divides_by_scale():
    assert wg.physical_to_logical({"width": 1800, "height": 1200}, 1.5) == {
        "width": 1200,
        "height": 800,
    }


def test_physical_to_logical_is_noop_at_100_percent():
    geom = {"width": 1200, "height": 800, "x": 10, "y": 20}
    assert wg.physical_to_logical(geom, 1.0) == geom


def test_physical_to_logical_includes_position():
    assert wg.physical_to_logical(
        {"width": 1800, "height": 1200, "x": 300, "y": 150}, 1.5
    ) == {"width": 1200, "height": 800, "x": 200, "y": 100}


def test_save_load_round_trip_does_not_compound():
    """THE regression: save(physical) -> load must reproduce the SAME physical
    size after create_window re-applies the scale — not grow by `scale`x."""
    scale = 1.5
    physical = {"width": 1800, "height": 1200, "x": 300, "y": 150}

    logical = wg.physical_to_logical(physical, scale)  # save step
    saved = wg.to_saved_dict(logical)
    loaded = wg.parse_saved_geometry(saved, scale)  # load step (create_window input)

    # create_window multiplies logical by the scale internally -> physical again
    assert round(loaded["width"] * scale) == 1800
    assert round(loaded["height"] * scale) == 1200
    assert round(loaded["x"] * scale) == 300
    assert round(loaded["y"] * scale) == 150


def test_old_behaviour_would_compound_without_conversion():
    """Documents the shipped bug: storing physical values AS logical (no
    conversion) makes the next load feed physical-as-logical into create_window,
    which re-scales -> the window grows. This is what the fix prevents."""
    scale = 1.5
    physical = {"width": 1800, "height": 1200}

    buggy_saved = wg.to_saved_dict(physical)  # physical stored, tagged "logical"
    loaded = wg.parse_saved_geometry(buggy_saved, scale)  # no division (format=logical)

    grown = round(loaded["width"] * scale)  # create_window re-applies scale
    assert grown == 2700  # 1800 -> 2700, i.e. it grew; the observed 2781-ish drift


def test_legacy_physical_file_is_converted_to_logical():
    # Pre-'format' files stored physical pixels; loading divides by the scale.
    assert wg.parse_saved_geometry({"width": 1800, "height": 1200}, 1.5) == {
        "width": 1200,
        "height": 800,
    }


def test_logical_file_is_used_as_is():
    data = {"width": 1200, "height": 800, "format": "logical", "x": 100, "y": 50}
    assert wg.parse_saved_geometry(data, 1.5) == {
        "width": 1200,
        "height": 800,
        "x": 100,
        "y": 50,
    }


def test_invalid_or_out_of_bounds_returns_defaults():
    assert wg.parse_saved_geometry(None, 1.5) == wg.DEFAULTS
    assert wg.parse_saved_geometry({}, 1.5) == wg.DEFAULTS
    # Too small / too large fall back to defaults.
    assert (
        wg.parse_saved_geometry({"width": 50, "height": 50, "format": "logical"}, 1.5)
        == wg.DEFAULTS
    )
    assert (
        wg.parse_saved_geometry(
            {"width": 99999, "height": 99999, "format": "logical"}, 1.5
        )
        == wg.DEFAULTS
    )


def test_bad_position_drops_position_keeps_size():
    data = {"width": 1200, "height": 800, "format": "logical", "x": "bad", "y": 50}
    result = wg.parse_saved_geometry(data, 1.5)
    assert result["width"] == 1200 and result["height"] == 800
    assert "x" not in result and "y" not in result
