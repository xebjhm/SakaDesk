"""desktop.py tray wiring: closing handler, open handler, --background, sync now."""

from __future__ import annotations

import asyncio
import types

import pytest
from structlog.testing import capture_logs

import desktop
from backend.services import desktop_bridge


class Recorder:
    """Builds make_closing_handler kwargs and records what they were asked to do."""

    def __init__(
        self,
        *,
        quitting=False,
        tray=True,
        settings=None,
        settings_error=None,
        hide_error=None,
        mark_result=True,
    ):
        self.calls: list[str] = []
        self.quitting, self.tray = quitting, tray
        self.settings = (
            {"close_to_tray": True, "tray_hint_shown": False}
            if settings is None
            else settings
        )
        self.settings_error, self.hide_error = settings_error, hide_error
        self.mark_result = mark_result

    def _get_settings(self):
        if self.settings_error:
            raise self.settings_error
        return self.settings

    def _hide(self):
        self.calls.append("hide")
        if self.hide_error:
            raise self.hide_error

    def _mark(self):
        self.calls.append("mark")
        return self.mark_result

    def handler(self):
        return desktop.make_closing_handler(
            is_quitting=lambda: self.quitting,
            tray_available=lambda: self.tray,
            get_settings=self._get_settings,
            hide_fn=self._hide,
            reset_ui_state=lambda: self.calls.append("reset"),
            mark_hint_shown=self._mark,
            notify_hint=lambda: self.calls.append("hint"),
            save_geometry=lambda: self.calls.append("save"),
        )


def run(rec: Recorder):
    with capture_logs() as logs:
        result = rec.handler()()
    (event,) = [e for e in logs if e["event"] == "window_close"]
    return result, event, logs


def test_quitting_lets_the_window_close():
    rec = Recorder(quitting=True)
    result, event, _ = run(rec)
    assert result is True
    assert rec.calls == ["save"]
    assert event["action"] == "quit" and event["reason"] == "quitting"


def test_close_to_tray_off_quits():
    rec = Recorder(settings={"close_to_tray": False, "tray_hint_shown": False})
    result, event, _ = run(rec)
    assert result is True and rec.calls == ["save"]
    assert event["action"] == "quit" and event["reason"] == "close_to_tray_off"


def test_no_tray_quits_even_with_close_to_tray_on():
    rec = Recorder(tray=False)
    result, event, _ = run(rec)
    assert result is True and rec.calls == ["save"]
    assert event["action"] == "quit" and event["reason"] == "no_tray"


def test_hide_saves_geometry_hides_resets_ui_state_and_shows_the_hint_once():
    rec = Recorder()
    result, event, _ = run(rec)
    assert result is False
    assert rec.calls == ["save", "hide", "reset", "mark", "hint"]
    assert event["action"] == "hidden" and event["hint"] == "shown"


def test_hint_already_shown_is_skipped():
    rec = Recorder(settings={"close_to_tray": True, "tray_hint_shown": True})
    result, event, _ = run(rec)
    assert result is False
    assert rec.calls == ["save", "hide", "reset"]
    assert event["hint"] == "skipped"


def test_hint_is_not_shown_when_it_cannot_be_persisted():
    rec = Recorder(mark_result=False)
    result, event, _ = run(rec)
    assert result is False
    assert "hint" not in rec.calls and event["hint"] == "skipped"


def test_missing_close_to_tray_key_defaults_to_hiding():
    rec = Recorder(settings={"tray_hint_shown": True})
    result, event, _ = run(rec)
    assert result is False and event["action"] == "hidden"


def test_unreadable_settings_quit():
    rec = Recorder(settings_error=ValueError("bad json 金村"))
    result, event, logs = run(rec)
    assert result is True and event["reason"] == "settings_unreadable"
    (failed,) = [e for e in logs if e["event"] == "window_close_settings_failed"]
    assert failed["error_type"] == "ValueError"
    assert "金村" not in str(logs)


def test_a_failing_hide_quits_instead_of_leaving_a_dead_close_button():
    rec = Recorder(hide_error=RuntimeError("native gone"))
    result, event, _ = run(rec)
    assert result is True and event["reason"] == "hide_failed"
    assert "reset" not in rec.calls and "hint" not in rec.calls


def test_a_geometry_save_failure_does_not_block_the_close_decision():
    rec = Recorder()

    def boom():
        raise OSError("disk")

    handler = desktop.make_closing_handler(
        is_quitting=lambda: False,
        tray_available=lambda: True,
        get_settings=lambda: {"close_to_tray": True, "tray_hint_shown": True},
        hide_fn=lambda: rec.calls.append("hide"),
        reset_ui_state=lambda: rec.calls.append("reset"),
        mark_hint_shown=lambda: True,
        notify_hint=lambda: None,
        save_geometry=boom,
    )
    with capture_logs() as logs:
        assert handler() is False
    assert rec.calls == ["hide", "reset"]
    assert any(e["event"] == "window_close_save_failed" for e in logs)


def test_a_failing_hint_never_breaks_the_hide():
    def boom():
        raise RuntimeError("no loop")

    handler = desktop.make_closing_handler(
        is_quitting=lambda: False,
        tray_available=lambda: True,
        get_settings=lambda: {"close_to_tray": True, "tray_hint_shown": False},
        hide_fn=lambda: None,
        reset_ui_state=lambda: None,
        mark_hint_shown=lambda: True,
        notify_hint=boom,
        save_geometry=lambda: None,
    )
    with capture_logs() as logs:
        assert handler() is False
    (event,) = [e for e in logs if e["event"] == "window_close"]
    assert event["action"] == "hidden" and event["hint"] == "skipped"
    assert any(e["event"] == "window_close_hint_failed" for e in logs)


# ------------------------------------------------------------------ background


@pytest.mark.parametrize(
    "argv, expected",
    [
        (["desktop.py"], False),
        (["desktop.py", "--background"], True),
        (["SakaDesk.exe", "--other", "--background"], True),
        (["--background"], False),  # argv[0] is the program, never an option
        (["desktop.py", "--backgrounds"], False),
    ],
)
def test_parse_background(argv, expected):
    assert desktop.parse_background(argv) is expected


# ----------------------------------------------------------------- open window


def test_open_window_handler_shows_then_focuses_with_the_native_handle():
    calls: list = []

    class Window:
        native = types.SimpleNamespace(Handle=77)

        def show(self):
            calls.append("show")

    handler = desktop.make_open_window_handler(Window(), lambda h: calls.append(h))
    handler()
    assert calls == ["show", 77]


def test_open_window_handler_propagates_errors_to_the_bridge():
    class Window:
        native = None

        def show(self):
            raise RuntimeError("closed")

    handler = desktop.make_open_window_handler(Window(), lambda h: None)
    desktop_bridge.set_open_window_handler(handler)
    try:
        with capture_logs() as logs:
            desktop_bridge.open_window()  # must not raise
        (failed,) = [e for e in logs if e["event"] == "window_open_failed"]
        assert failed["error_type"] == "RuntimeError"
    finally:
        desktop_bridge.set_open_window_handler(None)


# -------------------------------------------------------------------- sync now


@pytest.mark.asyncio
async def test_sync_all_authenticated_launches_only_authenticated_services():
    launched: list[tuple] = []

    async def is_auth(service):
        return service != "b"

    async def launch(service, **kw):
        launched.append((service, kw))
        return "already_running" if service == "c" else "started"

    with capture_logs() as logs:
        await desktop.sync_all_authenticated(["a", "b", "c"], is_auth, launch)
    assert [s for s, _ in launched] == ["a", "c"]
    assert all(kw["origin"] == "tray" for _, kw in launched)
    (event,) = [e for e in logs if e["event"] == "tray_sync_now"]
    assert event["services"] == 2 and event["started"] == 1


@pytest.mark.asyncio
async def test_sync_all_authenticated_isolates_failures():
    async def is_auth(service):
        if service == "a":
            raise RuntimeError("keyring")
        return True

    async def launch(service, **kw):
        return "started"

    with capture_logs() as logs:
        await desktop.sync_all_authenticated(["a", "b"], is_auth, launch)
    (failed,) = [e for e in logs if e["event"] == "tray_sync_now_failed"]
    assert failed["service"] == "a" and failed["error_type"] == "RuntimeError"
    (event,) = [e for e in logs if e["event"] == "tray_sync_now"]
    assert event["services"] == 1 and event["started"] == 1


def test_request_tray_sync_schedules_on_the_server_loop(monkeypatch):
    seen: list = []

    def fake_run(coro):
        seen.append(coro.cr_code.co_name)
        coro.close()

    monkeypatch.setattr(desktop_bridge, "run_on_server_loop", fake_run)
    desktop._request_tray_sync()
    assert seen == ["_tray_sync_now"]


def test_notify_tray_hint_does_not_wait_and_goes_through_the_loop(monkeypatch):
    seen: list = []

    def fake_run(coro):
        seen.append(coro.cr_code.co_name)
        coro.close()

    monkeypatch.setattr(desktop_bridge, "run_on_server_loop", fake_run)
    desktop._notify_tray_hint()
    assert seen == ["_show_tray_hint"]


@pytest.mark.asyncio
async def test_show_tray_hint_sends_the_localized_toast(monkeypatch):
    sent: list = []

    async def fake_send(title, body):
        sent.append((title, body))
        return True

    async def fake_config():
        return {"language": "ja"}

    monkeypatch.setattr("backend.services.notification_service.send_simple", fake_send)
    monkeypatch.setattr("backend.services.settings_store.load_config", fake_config)
    monkeypatch.setattr(desktop, "resolve_ui_language", lambda cfg: cfg["language"])
    with capture_logs() as logs:
        await desktop._show_tray_hint()
    assert sent == [("SakaDesk は実行中です", sent[0][1])]
    (event,) = [e for e in logs if e["event"] == "tray_hint"]
    assert event["shown"] is True
    assert "実行中" not in str(logs)


@pytest.mark.asyncio
async def test_show_tray_hint_never_raises(monkeypatch):
    async def boom():
        raise OSError("disk")

    monkeypatch.setattr("backend.services.settings_store.load_config", boom)
    with capture_logs() as logs:
        await desktop._show_tray_hint()
    (failed,) = [e for e in logs if e["event"] == "tray_hint_failed"]
    assert failed["error_type"] == "OSError"


# ------------------------------------------------------------- initial tooltip


def test_request_initial_tooltip_queues_one_refresh():
    queued: list = []

    def run(coro):
        queued.append(coro)
        coro.close()
        return object()

    async def refresh():
        pass

    with capture_logs() as logs:
        assert desktop.request_initial_tooltip(run, refresh) is True
    assert len(queued) == 1
    (event,) = [e for e in logs if e["event"] == "tray_tooltip_initial"]
    assert event["scheduled"] is True


def test_request_initial_tooltip_reports_a_missing_loop():
    desktop_bridge.set_server_loop(None)

    with capture_logs() as logs:
        assert desktop.request_initial_tooltip() is False
    (event,) = [e for e in logs if e["event"] == "tray_tooltip_initial"]
    assert event["scheduled"] is False


@pytest.mark.asyncio
async def test_request_initial_tooltip_runs_the_refresh_on_the_loop(monkeypatch):
    loop = asyncio.get_running_loop()
    ran = asyncio.Event()

    async def refresh():
        ran.set()

    desktop_bridge.set_server_loop(loop)
    try:
        assert await asyncio.to_thread(desktop.request_initial_tooltip, None, refresh)
        await asyncio.wait_for(ran.wait(), 2)
    finally:
        desktop_bridge.set_server_loop(None)


# ------------------------------------------------------------ startup helpers


def test_reconcile_autostart_passes_the_setting_and_never_raises(monkeypatch):
    calls: list = []
    monkeypatch.setattr(
        desktop.settings_store, "read_config_sync", lambda: {"autostart": True}
    )
    monkeypatch.setattr(
        desktop.autostart,
        "reconcile",
        lambda enabled, **kw: calls.append((enabled, kw)),
    )
    desktop._reconcile_autostart()
    ((enabled, kw),) = calls
    assert enabled is True and kw["frozen"] is False

    def boom():
        raise ValueError("bad")

    monkeypatch.setattr(desktop.settings_store, "read_config_sync", boom)
    with capture_logs() as logs:
        desktop._reconcile_autostart()
    (failed,) = [e for e in logs if e["event"] == "autostart"]
    assert failed["action"] == "failed" and failed["error_type"] == "ValueError"


def test_tray_strings_use_the_ui_language_and_fall_back_to_english(monkeypatch):
    monkeypatch.setattr(desktop.settings_store, "read_config_sync", lambda: {})
    monkeypatch.setattr(desktop, "resolve_ui_language", lambda cfg: "ja")
    assert desktop._tray_strings()["quit"] == "終了"

    def boom():
        raise OSError("x")

    monkeypatch.setattr(desktop.settings_store, "read_config_sync", boom)
    with capture_logs() as logs:
        strings = desktop._tray_strings()
    assert strings["quit"] == "Quit"
    assert any(e["event"] == "tray_language_failed" for e in logs)


def test_desktop_quitting_flag_starts_false():
    assert desktop._quitting is False
