"""desktop.py call popup wiring: quit handler, preloader, packaging guard."""

from __future__ import annotations

import ast
import threading
from pathlib import Path

import pytest
from structlog.testing import capture_logs

import call_popup_window
import desktop

ROOT = Path(desktop.__file__).resolve().parent


# -- make_quit_handler


def test_quit_handler_runs_the_four_steps_in_order():
    calls: list[str] = []
    handler = desktop.make_quit_handler(
        mark_quitting=lambda: calls.append("mark"),
        stop_tray=lambda: calls.append("tray"),
        destroy_popup=lambda: calls.append("popup"),
        destroy_window=lambda: calls.append("window"),
    )
    handler()
    assert calls == ["mark", "tray", "popup", "window"]


@pytest.mark.parametrize("failing", ["mark", "tray", "popup"])
def test_quit_handler_still_destroys_the_window_when_a_step_raises(failing):
    calls: list[str] = []

    def step(name):
        def fn():
            calls.append(name)
            if name == failing:
                raise RuntimeError("金村 boom")

        return fn

    handler = desktop.make_quit_handler(
        mark_quitting=step("mark"),
        stop_tray=step("tray"),
        destroy_popup=step("popup"),
        destroy_window=step("window"),
    )
    with capture_logs() as logs:
        handler()
    assert calls == ["mark", "tray", "popup", "window"]
    (event,) = [e for e in logs if e["event"] == "quit_step_failed"]
    assert event["error_type"] == "RuntimeError"
    assert "金村" not in str(logs)


# -- make_popup_preloader


class Ensure:
    def __init__(self):
        self.calls = 0

    def __call__(self) -> bool:
        self.calls += 1
        return True


def run_preloader(settings, *args, times=1):
    ensure = Ensure()

    def read():
        if isinstance(settings, Exception):
            raise settings
        return settings

    handler = desktop.make_popup_preloader(ensure, read)
    with capture_logs() as logs:
        for _ in range(times):
            handler(*args)
    return ensure, logs


def window_logs(logs):
    return [e for e in logs if e["event"] == "call_popup_window"]


def test_preloader_ensures_once_when_enabled_even_if_loaded_fires_three_times():
    ensure, logs = run_preloader({"call_popup_enabled": True}, times=3)
    assert ensure.calls == 1
    assert window_logs(logs) == []


def test_preloader_missing_key_counts_as_on():
    ensure, _ = run_preloader({})
    assert ensure.calls == 1


def test_preloader_accepts_and_ignores_positional_args():
    ensure, _ = run_preloader({}, object(), "x")
    assert ensure.calls == 1


def test_preloader_disabled_never_ensures_and_logs_the_reason():
    ensure, logs = run_preloader({"call_popup_enabled": False}, times=3)
    assert ensure.calls == 0
    (event,) = window_logs(logs)
    assert event["action"] == "preload_skipped"
    assert event["reason"] == "disabled"


def test_preloader_unreadable_settings_never_ensures_and_logs_the_reason():
    ensure, logs = run_preloader(OSError("金村 locked"))
    assert ensure.calls == 0
    (event,) = window_logs(logs)
    assert event["action"] == "preload_skipped"
    assert event["reason"] == "settings_unreadable"
    assert event["error_type"] == "OSError"
    assert "金村" not in str(logs)


def test_preloader_runs_ensure_once_across_two_threads():
    release = threading.Event()
    entered = threading.Event()
    calls: list[int] = []

    def ensure() -> bool:
        calls.append(1)
        entered.set()
        release.wait(2)
        return True

    handler = desktop.make_popup_preloader(ensure, lambda: {})
    first = threading.Thread(target=handler)
    first.start()
    assert entered.wait(2)
    second = threading.Thread(target=handler)
    second.start()
    second.join(2)
    release.set()
    first.join(2)
    assert calls == [1]


# -- packaging guard / focus helper


def test_desktop_imports_call_popup_window_at_module_top_level():
    # PyInstaller only follows top-level imports, like tray.py.
    tree = ast.parse((ROOT / "desktop.py").read_text(encoding="utf-8"))
    modules = [n.module for n in tree.body if isinstance(n, ast.ImportFrom)]
    assert "call_popup_window" in modules
    assert "tray" in modules


def test_popup_title_is_not_what_the_focus_helper_looks_up():
    looked_up: list[str] = []

    class User32:
        def FindWindowW(self, cls, title):
            looked_up.append(title)
            return 0

    desktop._focus_window(None, user32=User32())
    assert looked_up == ["SakaDesk"]
    assert call_popup_window.TITLE != looked_up[0]
