"""Tests for the toast-click -> open-chat handler built in desktop.py."""

from __future__ import annotations

import json

from structlog.testing import capture_logs

import desktop
from backend.services.notification_planner import ChatTarget

TARGET = ChatTarget(
    service="hinatazaka46",
    path="日向坂46/messages/12 ひなた/34 金村 美玖",
    name="金村 美玖",
    is_group_chat=False,
)


class _FakeWindow:
    def __init__(self, fail_on: str | None = None) -> None:
        self.calls: list[tuple[str, tuple]] = []
        self._fail_on = fail_on

    def _record(self, name: str, *args) -> None:
        self.calls.append((name, args))
        if name == self._fail_on:
            raise RuntimeError("boom 金村 secret")

    def restore(self) -> None:
        self._record("restore")

    def show(self) -> None:
        self._record("show")

    def evaluate_js(self, script: str) -> None:
        self._record("evaluate_js", script)


def test_handler_restores_shows_focuses_then_evaluates_js():
    window = _FakeWindow()
    order: list[str] = []
    handler = desktop.make_open_chat_handler(window, lambda: order.append("focus"))

    with capture_logs() as logs:
        handler(TARGET)

    assert [c[0] for c in window.calls] == ["restore", "show", "evaluate_js"]
    assert order == ["focus"]
    script = window.calls[2][1][0]
    prefix = "window.__sakadeskOpenChat && window.__sakadeskOpenChat("
    assert script.startswith(prefix) and script.endswith(")")
    payload = json.loads(script[len(prefix) : -1])
    assert payload == {
        "service": "hinatazaka46",
        "path": TARGET.path,
        "name": TARGET.name,
        "is_group_chat": False,
    }
    # ensure_ascii=False: CJK is sent verbatim, not \u-escaped.
    assert "金村" in script and "\\u" not in script

    events = [e for e in logs if e["event"] == "notify_open_chat"]
    assert len(events) == 1
    assert events[0]["service"] == "hinatazaka46"
    assert events[0]["is_group_chat"] is False


def test_handler_escapes_quotes_safely():
    window = _FakeWindow()
    tricky = ChatTarget("s", 'a"b</script>\\', "n'\n", True)
    desktop.make_open_chat_handler(window, lambda: None)(tricky)
    script = window.calls[2][1][0]
    prefix = "window.__sakadeskOpenChat && window.__sakadeskOpenChat("
    assert json.loads(script[len(prefix) : -1])["path"] == tricky.path


def test_handler_never_raises_and_logs_error_type_only():
    for fail_on in ("restore", "show", "evaluate_js"):
        window = _FakeWindow(fail_on=fail_on)
        handler = desktop.make_open_chat_handler(window, lambda: None)
        with capture_logs() as logs:
            handler(TARGET)  # must not raise
        failed = [e for e in logs if e["event"] == "notify_open_chat_failed"]
        assert len(failed) == 1
        assert failed[0]["error_type"] == "RuntimeError"
        assert "金村" not in repr(failed[0]) and "secret" not in repr(failed[0])
        assert not [e for e in logs if e["event"] == "notify_open_chat"]


def test_focus_failure_is_also_contained():
    window = _FakeWindow()

    def bad_focus() -> None:
        raise OSError("nope")

    with capture_logs() as logs:
        desktop.make_open_chat_handler(window, bad_focus)(TARGET)
    failed = [e for e in logs if e["event"] == "notify_open_chat_failed"]
    assert failed and failed[0]["error_type"] == "OSError"
