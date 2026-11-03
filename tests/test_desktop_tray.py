"""desktop.py tray wiring: closing handler, open handler, --background, sync now."""

from __future__ import annotations

import asyncio
import sys
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
    ):
        self.calls: list[str] = []
        self.quitting, self.tray = quitting, tray
        self.settings = (
            {"close_to_tray": True, "tray_hint_shown": False}
            if settings is None
            else settings
        )
        self.settings_error, self.hide_error = settings_error, hide_error
        self.done: list = []  # on_done callbacks handed to notify_hint

    def _get_settings(self):
        if self.settings_error:
            raise self.settings_error
        return self.settings

    def _hide(self):
        self.calls.append("hide")
        if self.hide_error:
            raise self.hide_error

    def _notify(self, on_done):
        self.calls.append("hint")
        self.done.append(on_done)

    def handler(self):
        return desktop.make_closing_handler(
            is_quitting=lambda: self.quitting,
            tray_available=lambda: self.tray,
            get_settings=self._get_settings,
            hide_fn=self._hide,
            reset_ui_state=lambda: self.calls.append("reset"),
            notify_hint=self._notify,
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
    assert rec.calls == ["save", "hide", "reset", "hint"]
    assert event["action"] == "hidden" and event["hint"] == "queued"


def test_hint_already_shown_is_skipped():
    rec = Recorder(settings={"close_to_tray": True, "tray_hint_shown": True})
    result, event, _ = run(rec)
    assert result is False
    assert rec.calls == ["save", "hide", "reset"]
    assert event["hint"] == "skipped"


def test_the_hint_is_not_persisted_by_the_close_hook():
    # Persisting is the toast coroutine's job, after a real send.
    rec = Recorder()
    handler = rec.handler()
    assert handler() is False
    assert rec.calls == ["save", "hide", "reset", "hint"]


def test_two_rapid_closes_queue_one_hint():
    rec = Recorder()
    handler = rec.handler()
    with capture_logs() as logs:
        assert handler() is False
        assert handler() is False
    assert rec.calls.count("hint") == 1
    hints = [e["hint"] for e in logs if e["event"] == "window_close"]
    assert hints == ["queued", "pending"]


def test_a_later_close_retries_once_the_pending_hint_finished_unpersisted():
    # The toast failed: tray_hint_shown is still false, so the next close
    # (after on_done) queues it again.
    rec = Recorder()
    handler = rec.handler()
    handler()
    rec.done[0]()
    handler()
    assert rec.calls.count("hint") == 2


def test_a_hint_that_cannot_be_scheduled_does_not_stay_pending():
    attempts: list[str] = []

    def notify(on_done):
        attempts.append("try")
        if len(attempts) == 1:
            raise RuntimeError("no loop")

    handler = desktop.make_closing_handler(
        is_quitting=lambda: False,
        tray_available=lambda: True,
        get_settings=lambda: {"close_to_tray": True, "tray_hint_shown": False},
        hide_fn=lambda: None,
        reset_ui_state=lambda: None,
        notify_hint=notify,
        save_geometry=lambda: None,
    )
    assert handler() is False
    assert handler() is False
    assert attempts == ["try", "try"]


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
        notify_hint=lambda on_done: None,
        save_geometry=boom,
    )
    with capture_logs() as logs:
        assert handler() is False
    assert rec.calls == ["hide", "reset"]
    assert any(e["event"] == "window_close_save_failed" for e in logs)


def test_a_failing_hint_never_breaks_the_hide():
    def boom(on_done):
        raise RuntimeError("no loop")

    handler = desktop.make_closing_handler(
        is_quitting=lambda: False,
        tray_available=lambda: True,
        get_settings=lambda: {"close_to_tray": True, "tray_hint_shown": False},
        hide_fn=lambda: None,
        reset_ui_state=lambda: None,
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
    import concurrent.futures

    seen: list = []
    future: concurrent.futures.Future = concurrent.futures.Future()

    def fake_run(coro):
        seen.append(coro.cr_code.co_name)
        coro.close()
        return future

    monkeypatch.setattr(desktop_bridge, "run_on_server_loop", fake_run)
    done: list = []
    desktop._notify_tray_hint(lambda: done.append(1))
    assert seen == ["_show_tray_hint"]
    assert done == []  # not waited on
    future.set_result(None)
    assert done == [1]


def test_notify_tray_hint_releases_at_once_without_a_server_loop(monkeypatch):
    def fake_run(coro):
        coro.close()
        return None

    monkeypatch.setattr(desktop_bridge, "run_on_server_loop", fake_run)
    done: list = []
    desktop._notify_tray_hint(lambda: done.append(1))
    assert done == [1]


def _patch_hint(monkeypatch, send):
    async def fake_config():
        return {"language": "ja"}

    monkeypatch.setattr("backend.services.notification_service.send_simple", send)
    monkeypatch.setattr("backend.services.settings_store.load_config", fake_config)
    monkeypatch.setattr(desktop, "resolve_ui_language", lambda cfg: cfg["language"])


@pytest.mark.asyncio
async def test_show_tray_hint_sends_the_localized_toast_then_persists(monkeypatch):
    sent: list = []
    order: list = []

    async def fake_send(title, body):
        order.append("send")
        sent.append((title, body))
        return True

    def mark():
        order.append("mark")
        return True

    _patch_hint(monkeypatch, fake_send)
    with capture_logs() as logs:
        await desktop._show_tray_hint(mark)
    # Strings from backend/i18n/ja/tray.json.
    assert sent == [
        (
            "SakaDesk は実行中です",
            "トレイで同期を続けます。終了するにはトレイアイコンを右クリックしてください。",
        )
    ]
    assert order == ["send", "mark"]
    (event,) = [e for e in logs if e["event"] == "tray_hint"]
    assert event["shown"] is True and event["persisted"] is True
    assert "実行中" not in str(logs)


@pytest.mark.asyncio
async def test_show_tray_hint_does_not_persist_when_the_send_failed(monkeypatch):
    marked: list = []

    async def fake_send(title, body):
        return False

    _patch_hint(monkeypatch, fake_send)
    with capture_logs() as logs:
        await desktop._show_tray_hint(lambda: marked.append(1) or True)
    assert marked == []
    (event,) = [e for e in logs if e["event"] == "tray_hint"]
    assert event["shown"] is False and "persisted" not in event


@pytest.mark.asyncio
async def test_show_tray_hint_reports_a_persist_failure(monkeypatch):
    async def fake_send(title, body):
        return True

    _patch_hint(monkeypatch, fake_send)
    with capture_logs() as logs:
        await desktop._show_tray_hint(lambda: False)
    (event,) = [e for e in logs if e["event"] == "tray_hint"]
    assert event["shown"] is True and event["persisted"] is False


@pytest.mark.asyncio
async def test_show_tray_hint_never_raises(monkeypatch):
    async def boom():
        raise OSError("disk")

    monkeypatch.setattr("backend.services.settings_store.load_config", boom)
    with capture_logs() as logs:
        await desktop._show_tray_hint(lambda: True)
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


# ------------------------------------------------------ session-end FormClosing


class FakeCloseReason:
    UserClosing = "UserClosing"
    WindowsShutDown = "WindowsShutDown"
    TaskManagerClosing = "TaskManagerClosing"
    ApplicationExitCall = "ApplicationExitCall"


def _reasons():
    return (FakeCloseReason.WindowsShutDown, FakeCloseReason.TaskManagerClosing)


def _guard(**overrides):
    calls: list[str] = []
    kwargs = dict(
        mark_quitting=lambda: calls.append("quitting"),
        stop_tray=lambda: calls.append("stop_tray"),
        load_reasons=_reasons,
    )
    kwargs.update(overrides)
    return desktop.make_session_end_guard(**kwargs), calls


@pytest.mark.parametrize(
    "reason, cancel_after",
    [
        (FakeCloseReason.UserClosing, True),
        (FakeCloseReason.ApplicationExitCall, True),
        (FakeCloseReason.WindowsShutDown, False),
        (FakeCloseReason.TaskManagerClosing, False),
    ],
)
def test_session_end_guard_only_uncancels_session_end_reasons(reason, cancel_after):
    guard, calls = _guard()
    args = types.SimpleNamespace(CloseReason=reason, Cancel=True)  # pywebview cancelled
    with capture_logs() as logs:
        guard(object(), args)
    assert args.Cancel is cancel_after
    closes = [e for e in logs if e["event"] == "window_close"]
    if cancel_after:
        assert calls == [] and closes == []
    else:
        assert calls == ["quitting", "stop_tray"]
        (event,) = closes
        assert event["action"] == "quit" and event["reason"] == "session_end"
        assert set(event) == {"event", "action", "reason", "log_level"}


def test_session_end_guard_never_raises_and_logs_the_error_type():
    def boom():
        raise RuntimeError("tray gone 金村")

    guard, _ = _guard(stop_tray=boom)
    args = types.SimpleNamespace(
        CloseReason=FakeCloseReason.WindowsShutDown, Cancel=True
    )
    with capture_logs() as logs:
        guard(object(), args)
    assert args.Cancel is False  # the shutdown still goes through
    (failed,) = [e for e in logs if e["event"] == "session_end_guard_failed"]
    assert failed["error_type"] == "RuntimeError"
    assert "金村" not in str(logs)


def test_session_end_guard_survives_an_unloadable_close_reason_enum():
    def no_dotnet():
        raise ImportError("no System.Windows.Forms")

    guard, calls = _guard(load_reasons=no_dotnet)
    args = types.SimpleNamespace(
        CloseReason=FakeCloseReason.WindowsShutDown, Cancel=True
    )
    with capture_logs() as logs:
        guard(object(), args)
    assert args.Cancel is True and calls == []
    (failed,) = [e for e in logs if e["event"] == "session_end_guard_failed"]
    assert failed["error_type"] == "ImportError"


def test_default_reason_loader_imports_lazily_and_only_on_windows(monkeypatch):
    forms = types.ModuleType("System.Windows.Forms")
    forms.CloseReason = FakeCloseReason  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "System", types.ModuleType("System"))
    monkeypatch.setitem(
        sys.modules, "System.Windows", types.ModuleType("System.Windows")
    )
    monkeypatch.setitem(sys.modules, "System.Windows.Forms", forms)
    assert desktop._load_session_end_reasons() == _reasons()


class FakeEvent:
    """A .NET event: ``obj.FormClosing += handler`` subscribes."""

    def __init__(self):
        self.handlers: list = []

    def __iadd__(self, handler):
        self.handlers.append(handler)
        return self


def test_attach_subscribes_the_guard_to_the_native_form():
    native = types.SimpleNamespace(FormClosing=FakeEvent())
    window = types.SimpleNamespace(native=native)
    guard = object()
    with capture_logs() as logs:
        assert desktop.attach_session_end_guard(window, guard) is True
    assert native.FormClosing.handlers == [guard]
    (event,) = [e for e in logs if e["event"] == "session_end_guard"]
    assert event["attached"] is True


def test_attach_without_a_native_form_logs_and_does_not_crash():
    window = types.SimpleNamespace(native=None)
    with capture_logs() as logs:
        assert desktop.attach_session_end_guard(window, object()) is False
    (event,) = [e for e in logs if e["event"] == "session_end_guard"]
    assert event["attached"] is False and event["reason"] == "no_native"
    # A window object without the attribute at all behaves the same.
    assert desktop.attach_session_end_guard(object(), object()) is False


def test_attach_failure_is_logged_with_the_error_type():
    class Broken:
        @property
        def FormClosing(self):
            raise AttributeError("not a WinForms form")

        @FormClosing.setter
        def FormClosing(self, value):  # pragma: no cover
            raise AssertionError

    window = types.SimpleNamespace(native=Broken())
    with capture_logs() as logs:
        assert desktop.attach_session_end_guard(window, object()) is False
    (event,) = [e for e in logs if e["event"] == "session_end_guard"]
    assert event["attached"] is False and event["reason"] == "attach_failed"
    assert event["error_type"] == "AttributeError"
