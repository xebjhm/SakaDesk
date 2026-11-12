"""window_diagnostics: numeric size breadcrumbs that log and never act (N-R4-1/2)."""

from __future__ import annotations

from types import SimpleNamespace

from structlog.testing import capture_logs

import window_diagnostics as wd


class Event:
    def __init__(self) -> None:
        self.handlers: list = []

    def __iadd__(self, handler):
        self.handlers.append(handler)
        return self

    def fire(self) -> None:
        for h in self.handlers:
            h(None, None)


class FakeForm:
    def __init__(self, *, dpi=168, min_size=(1680, 1120), state=0):
        self.DeviceDpi = dpi
        self.MinimumSize = SimpleNamespace(Width=min_size[0], Height=min_size[1])
        self.MaximumSize = SimpleNamespace(Width=0, Height=0)
        self.Size = SimpleNamespace(Width=2100, Height=1400)
        self.RestoreBounds = SimpleNamespace(X=10, Y=20, Width=2100, Height=1400)
        self.WindowState = state
        self.Controls = [SimpleNamespace(Width=2084, Height=1336)]
        self.Shown, self.Resize, self.ResizeEnd, self.DpiChanged = (
            Event(),
            Event(),
            Event(),
            Event(),
        )


def diag(form, **kw):
    return wd.WindowDiagnostics(form, **kw)


def test_snapshot_logs_numbers_only():
    form = FakeForm()
    with capture_logs() as logs:
        diag(form).log("created")
    (e,) = logs
    assert e["event"] == "window_geometry" and e["phase"] == "created"
    assert (e["min_w"], e["min_h"], e["w"], e["h"]) == (1680, 1120, 2100, 1400)
    assert (e["restore_x"], e["restore_h"], e["dpi"], e["state"]) == (10, 1400, 168, 0)
    assert (e["webview_w"], e["webview_h"]) == (2084, 1336)
    assert all(v is None or isinstance(v, (int, str)) for v in e.values())


def test_attach_logs_state_dpi_and_throttled_resize_end_and_never_acts():
    # N-R4-2: the form reports DeviceDpi 96 on a 175 % screen; the correct
    # 1662 x 1072 minimum must never be touched.
    form = FakeForm(dpi=96, min_size=(1662, 1072))
    now = [100.0]
    d = diag(form, clock=lambda: now[0])
    with capture_logs() as logs:
        assert d.attach() is True
        form.Shown.fire()
        form.Resize.fire()  # same state: nothing
        form.WindowState = 2
        form.Resize.fire()  # maximized
        form.WindowState = 0
        form.Resize.fire()  # restored
        form.ResizeEnd.fire()
        now[0] += 0.5
        form.ResizeEnd.fire()  # throttled
        now[0] += 1.0
        form.ResizeEnd.fire()
        form.DpiChanged.fire()
    phases = [e["phase"] for e in logs if e["event"] == "window_geometry"]
    assert phases == [
        "created",
        "shown",
        "state_maximized",
        "state_normal",
        "resize_end",
        "resize_end",
        "dpi_changed",
    ]
    assert {e["event"] for e in logs} == {"window_geometry"}
    assert (form.MinimumSize.Width, form.MinimumSize.Height) == (1662, 1072)
    assert not hasattr(wd.WindowDiagnostics, "reapply_min")


def test_attach_without_events_logs_and_returns_false():
    form = SimpleNamespace(DeviceDpi=168, WindowState=0)
    with capture_logs() as logs:
        assert diag(form).attach() is False
    assert (
        logs[-1]["event"] == "window_geometry_failed" and logs[-1]["phase"] == "attach"
    )


def test_attach_window_diagnostics_without_native_and_with_a_form():
    with capture_logs() as logs:
        assert wd.attach_window_diagnostics(SimpleNamespace(native=None)) is False
        assert wd.attach_window_diagnostics(SimpleNamespace(native=FakeForm())) is True
    assert logs[0]["error_type"] == "no_native"
    assert logs[1]["event"] == "window_geometry" and logs[1]["phase"] == "created"
