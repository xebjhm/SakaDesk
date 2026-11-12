"""window_diagnostics: numeric size breadcrumbs and the MinimumSize guard (N-R4-1)."""

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


def size(w, h):
    return SimpleNamespace(Width=w, Height=h)


def diag(form, **kw):
    # 960 x 640 logical, no screen cap: the intended device minimum is x scale
    return wd.WindowDiagnostics(
        form, make_size=size, min_logical=lambda scale: (960, 640), **kw
    )


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


def test_intended_minimum_is_logical_times_dpi():
    assert diag(FakeForm(dpi=168)).intended_min() == (1680, 1120)
    assert diag(FakeForm(dpi=96)).intended_min() == (960, 640)
    assert diag(FakeForm(dpi=0)).intended_min() is None


def test_inflated_minimum_height_is_reapplied():
    form = FakeForm(min_size=(1680, 2188))
    with capture_logs() as logs:
        assert diag(form).reapply_min("state_normal") is True
    assert (form.MinimumSize.Width, form.MinimumSize.Height) == (1680, 1120)
    (e,) = [x for x in logs if x["event"] == "window_min_size_reapplied"]
    assert (e["old_w"], e["old_h"], e["new_w"], e["new_h"]) == (1680, 2188, 1680, 1120)
    assert e["phase"] == "state_normal" and e["dpi"] == 168


def test_a_correct_minimum_is_left_alone():
    form = FakeForm(min_size=(1681, 1119))  # within the tolerance
    with capture_logs() as logs:
        assert diag(form).reapply_min("shown") is False
    assert not logs and form.MinimumSize.Height == 1119


def test_reapply_failure_logs_and_never_raises():
    form = FakeForm(min_size=(1680, 2188))

    def broken(w, h):
        raise RuntimeError("cross-thread")

    d = wd.WindowDiagnostics(form, make_size=broken, min_logical=lambda s: (960, 640))
    with capture_logs() as logs:
        assert d.reapply_min("dpi_changed") is False
    assert logs[-1] == {
        "event": "window_geometry_failed",
        "log_level": "warning",
        "phase": "reapply_dpi_changed",
        "error_type": "RuntimeError",
    }


def test_attach_logs_and_reacts_to_state_dpi_and_throttled_resize_end():
    form = FakeForm()
    now = [100.0]
    d = diag(form, clock=lambda: now[0])
    with capture_logs() as logs:
        assert d.attach() is True
        form.Shown.fire()
        form.Resize.fire()  # same state: nothing
        form.WindowState = 2
        form.Resize.fire()  # maximized
        form.WindowState = 0
        form.MinimumSize = size(1680, 2188)  # inflated on the transition
        form.Resize.fire()  # restored: logged and repaired
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
    fixed = [e for e in logs if e["event"] == "window_min_size_reapplied"]
    assert [e["phase"] for e in fixed] == ["state_normal"]
    assert form.MinimumSize.Height == 1120


def test_attach_without_events_logs_and_returns_false():
    form = SimpleNamespace(DeviceDpi=168, WindowState=0)
    with capture_logs() as logs:
        assert diag(form).attach() is False
    assert (
        logs[-1]["event"] == "window_geometry_failed" and logs[-1]["phase"] == "attach"
    )


def test_attach_window_diagnostics_without_native_or_dotnet():
    with capture_logs() as logs:
        assert wd.attach_window_diagnostics(SimpleNamespace(native=None)) is False
        assert wd.attach_window_diagnostics(SimpleNamespace(native=FakeForm())) is False
    assert [e["error_type"] for e in logs] == ["no_native", "ModuleNotFoundError"]
