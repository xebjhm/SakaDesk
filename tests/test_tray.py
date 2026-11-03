"""TrayController, driven through a fake ``pystray`` (the real one is Windows-only)."""

from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest
from structlog.testing import capture_logs

import tray as tray_module
from tray import TrayController

STRINGS = {
    "open": "打開 SakaDesk",
    "sync_now": "立即同步",
    "quit": "結束",
    "tooltip_idle": "SakaDesk",
}


class FakeMenuItem:
    def __init__(self, text, action, default=False):
        self.text, self.action, self.default = text, action, default


class FakeMenu:
    def __init__(self, *items):
        self.items = items


class FakeIcon:
    instances: list["FakeIcon"] = []
    fail_on_run = False
    fail_on_stop = False

    def __init__(self, name, icon, title, menu):
        self.menu_updates = 0
        self.fail_on_update_menu = False
        self.name, self.image, self._title, self.menu = name, icon, title, menu
        self.detached = False
        self.stopped = False
        self.fail_on_title = False
        FakeIcon.instances.append(self)

    @property
    def title(self):
        return self._title

    @title.setter
    def title(self, value):
        if self.fail_on_title:
            raise OSError("shell gone")
        self._title = value

    def run_detached(self):
        if FakeIcon.fail_on_run:
            raise RuntimeError("no shell")
        self.detached = True

    def update_menu(self):
        if self.fail_on_update_menu:
            raise RuntimeError("menu gone")
        self.menu_updates += 1

    def stop(self):
        if FakeIcon.fail_on_stop:
            raise RuntimeError("boom")
        self.stopped = True


@pytest.fixture
def fake_pystray(monkeypatch):
    FakeIcon.instances = []
    FakeIcon.fail_on_run = False
    FakeIcon.fail_on_stop = False
    module = types.ModuleType("pystray")
    module.Icon = FakeIcon
    module.Menu = FakeMenu
    module.MenuItem = FakeMenuItem
    monkeypatch.setitem(sys.modules, "pystray", module)
    monkeypatch.setattr(tray_module.platform, "system", lambda: "Windows")
    return module


def make(**overrides):
    calls: list[str] = []
    kwargs = dict(
        strings=STRINGS,
        on_open=lambda: calls.append("open"),
        on_sync_now=lambda: calls.append("sync_now"),
        on_quit=lambda: calls.append("quit"),
        icon_factory=lambda: "IMAGE",
    )
    kwargs.update(overrides)
    return TrayController(**kwargs), calls


def test_start_builds_a_localized_menu_with_open_as_default(fake_pystray):
    controller, _ = make()
    with capture_logs() as logs:
        controller.start()
    (icon,) = FakeIcon.instances
    assert icon.detached and icon.image == "IMAGE" and icon.title == "SakaDesk"
    labels = [item.text(item) for item in icon.menu.items]
    assert labels == ["打開 SakaDesk", "立即同步", "結束"]
    assert [item.default for item in icon.menu.items] == [True, False, False]
    assert controller.available
    assert {"event": "tray", "action": "started", "log_level": "info"} in logs


def test_menu_callbacks_run_log_the_click_and_ignore_pystray_args(fake_pystray):
    controller, calls = make()
    controller.start()
    (icon,) = FakeIcon.instances
    with capture_logs() as logs:
        for item in icon.menu.items:
            item.action(icon, item)  # pystray passes (icon, item)
    assert calls == ["open", "sync_now", "quit"]
    clicks = [e["item"] for e in logs if e["event"] == "tray_click"]
    assert clicks == ["open", "sync_now", "quit"]


def test_a_failing_callback_is_logged_and_never_raises(fake_pystray):
    def boom():
        raise ValueError("金村 secret")

    controller, _ = make(on_sync_now=boom)
    controller.start()
    (icon,) = FakeIcon.instances
    with capture_logs() as logs:
        icon.menu.items[1].action(icon, icon.menu.items[1])
    (failed,) = [e for e in logs if e["event"] == "tray_click_failed"]
    assert failed["item"] == "sync_now" and failed["error_type"] == "ValueError"
    assert "secret" not in str(logs)


def test_missing_strings_fall_back_to_the_key(fake_pystray):
    controller, _ = make(strings={})
    controller.start()
    (icon,) = FakeIcon.instances
    assert [i.text(i) for i in icon.menu.items] == ["open", "sync_now", "quit"]


def test_set_tooltip_updates_and_truncates(fake_pystray):
    controller, _ = make()
    controller.start()
    (icon,) = FakeIcon.instances
    controller.set_tooltip("SakaDesk — 3 則未讀")
    assert icon.title == "SakaDesk — 3 則未讀"
    controller.set_tooltip("x" * 500)
    assert len(icon.title) == tray_module.MAX_TOOLTIP_LENGTH


def test_set_tooltip_never_raises_and_logs_only_the_error_type(fake_pystray):
    controller, _ = make()
    controller.start()
    FakeIcon.instances[0].fail_on_title = True
    with capture_logs() as logs:
        controller.set_tooltip("SakaDesk — 3 unread")
    (failed,) = [e for e in logs if e["event"] == "tray_title_failed"]
    assert failed["error_type"] == "OSError"
    assert "unread" not in str(logs)


def _switchable_strings():
    """A strings callable whose language the test can flip, like the UI setting."""
    state = {"strings": dict(STRINGS)}
    return state, (lambda: state["strings"])


EN = {"open": "Open SakaDesk", "sync_now": "Sync now", "quit": "Quit"}


def test_tooltip_updates_do_not_rebuild_an_unchanged_menu(fake_pystray):
    controller, _ = make()
    controller.start()
    (icon,) = FakeIcon.instances
    with capture_logs() as logs:
        controller.set_tooltip("SakaDesk")
        controller.set_tooltip("SakaDesk — 3 則未讀")
        controller.refresh_menu()
    assert icon.menu_updates == 0
    assert not [e for e in logs if e.get("action") == "menu_refreshed"]
    assert [e["reason"] for e in logs if e["event"] == "tray_menu_refresh_skipped"] == [
        "unchanged"
    ] * 3


def test_a_language_change_rebuilds_the_menu_once(fake_pystray):
    state, strings = _switchable_strings()
    controller, _ = make(strings=strings)
    controller.start()
    (icon,) = FakeIcon.instances
    state["strings"] = {**STRINGS, **EN}
    with capture_logs() as logs:
        controller.set_tooltip("SakaDesk")
        controller.set_tooltip("SakaDesk — 1 unread")
    assert icon.menu_updates == 1
    assert [e for e in logs if e.get("action") == "menu_refreshed"] == [
        {"event": "tray", "action": "menu_refreshed", "log_level": "info"}
    ]
    assert [i.text(i) for i in icon.menu.items] == [
        "Open SakaDesk",
        "Sync now",
        "Quit",
    ]


def test_a_change_only_in_the_tooltip_string_does_not_rebuild(fake_pystray):
    state, strings = _switchable_strings()
    controller, _ = make(strings=strings)
    controller.start()
    (icon,) = FakeIcon.instances
    state["strings"] = {**STRINGS, "tooltip_idle": "other"}
    controller.refresh_menu()
    assert icon.menu_updates == 0


def test_refresh_menu_failure_is_logged_with_the_error_type_only(fake_pystray):
    state, strings = _switchable_strings()
    controller, _ = make(strings=strings)
    controller.start()
    (icon,) = FakeIcon.instances
    state["strings"] = {**STRINGS, **EN}
    icon.fail_on_update_menu = True
    with capture_logs() as logs:
        controller.refresh_menu()
    (failed,) = [e for e in logs if e["event"] == "tray_menu_refresh_failed"]
    assert failed["error_type"] == "RuntimeError"
    assert "menu gone" not in str(logs)
    assert not [e for e in logs if e.get("action") == "menu_refreshed"]
    # The failed rebuild is not recorded, so the next refresh retries.
    icon.fail_on_update_menu = False
    controller.refresh_menu()
    assert icon.menu_updates == 1


def test_refresh_menu_before_start_is_skipped(fake_pystray):
    controller, _ = make()
    with capture_logs() as logs:
        controller.refresh_menu()
    assert [e["reason"] for e in logs if e["event"] == "tray_menu_refresh_skipped"] == [
        "no_icon"
    ]


def test_set_tooltip_before_start_is_skipped(fake_pystray):
    controller, _ = make()
    with capture_logs() as logs:
        controller.set_tooltip("anything")
    assert [e["reason"] for e in logs if e["event"] == "tray_tooltip_skipped"] == [
        "no_icon"
    ]


def test_stop_stops_the_icon_once(fake_pystray):
    controller, _ = make()
    controller.start()
    (icon,) = FakeIcon.instances
    controller.stop()
    controller.stop()
    assert icon.stopped and not controller.available


def test_stop_never_raises(fake_pystray):
    controller, _ = make()
    controller.start()
    FakeIcon.fail_on_stop = True
    with capture_logs() as logs:
        controller.stop()
    (failed,) = [e for e in logs if e.get("action") == "stop_failed"]
    assert failed["error_type"] == "RuntimeError"


def test_start_twice_creates_one_icon(fake_pystray):
    controller, _ = make()
    controller.start()
    controller.start()
    assert len(FakeIcon.instances) == 1


def test_unavailable_off_windows(monkeypatch):
    monkeypatch.setattr(tray_module.platform, "system", lambda: "Linux")
    controller, _ = make()
    with capture_logs() as logs:
        controller.start()
    assert not controller.available
    (event,) = [e for e in logs if e["event"] == "tray"]
    assert event["action"] == "unavailable" and event["reason"] == "not_windows"


def test_unavailable_when_pystray_cannot_be_imported(monkeypatch):
    monkeypatch.setattr(tray_module.platform, "system", lambda: "Windows")
    monkeypatch.setitem(sys.modules, "pystray", None)  # import raises ImportError
    controller, _ = make()
    with capture_logs() as logs:
        controller.start()
    assert not controller.available
    (event,) = [e for e in logs if e["event"] == "tray"]
    assert event["action"] == "unavailable" and event["reason"] == "import_failed"
    assert event["error_type"] in {"ImportError", "ModuleNotFoundError"}


def test_start_failure_is_logged_and_leaves_the_tray_unavailable(fake_pystray):
    FakeIcon.fail_on_run = True
    controller, _ = make()
    with capture_logs() as logs:
        controller.start()
    assert not controller.available
    (event,) = [e for e in logs if e["event"] == "tray"]
    assert event["action"] == "failed" and event["error_type"] == "RuntimeError"


def test_icon_factory_failure_is_a_start_failure(fake_pystray):
    def bad():
        raise FileNotFoundError("C:/Users/someone/SakaDesk.ico")

    controller, _ = make(icon_factory=bad)
    with capture_logs() as logs:
        controller.start()
    assert not controller.available
    assert "someone" not in str(logs)


def test_icon_path_is_the_repo_copy_in_dev_and_the_bundle_when_frozen(monkeypatch):
    dev = tray_module.icon_path()
    assert dev.name == "SakaDesk.ico" and dev.exists()
    monkeypatch.setattr(tray_module.sys, "frozen", True, raising=False)
    monkeypatch.setattr(tray_module.sys, "_MEIPASS", "/bundle", raising=False)
    assert tray_module.icon_path() == Path("/bundle/assets/SakaDesk.ico")


def test_default_icon_factory_loads_the_icon_with_pillow():
    pytest.importorskip("PIL")
    image = tray_module._load_icon_image()
    assert image.size[0] > 0


def test_menu_labels_follow_a_language_change(fake_pystray):
    current = {"strings": STRINGS}
    controller, _ = make(strings=lambda: current["strings"])
    controller.start()
    (icon,) = FakeIcon.instances
    assert [i.text(i) for i in icon.menu.items] == ["打開 SakaDesk", "立即同步", "結束"]
    current["strings"] = {"open": "Open", "sync_now": "Sync now", "quit": "Quit"}
    assert [i.text(i) for i in icon.menu.items] == ["Open", "Sync now", "Quit"]


def test_a_failing_strings_provider_falls_back_to_the_key(fake_pystray):
    def boom():
        raise OSError("settings 金村")

    controller, _ = make(strings=boom)
    with capture_logs() as logs:
        controller.start()
        (icon,) = FakeIcon.instances
        assert [i.text(i) for i in icon.menu.items] == ["open", "sync_now", "quit"]
    assert controller.available
    failed = [e for e in logs if e["event"] == "tray_label_failed"]
    assert failed and failed[0]["error_type"] == "OSError"
    assert "金村" not in str(logs)
