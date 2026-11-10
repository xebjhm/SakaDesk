"""``backend.services.low_priority``: background thread mode (Windows), a no-op elsewhere."""

from __future__ import annotations

import ctypes
from unittest.mock import patch

from structlog.testing import capture_logs

from backend.services import low_priority


class FakeKernel32:
    def __init__(self, result: int = 1, exc: Exception | None = None):
        self.result, self.exc = result, exc
        self.calls: list[tuple[object, int]] = []

    def GetCurrentThread(self):  # noqa: N802 (Win32 name)
        return -2  # the pseudo handle

    def SetThreadPriority(self, handle, priority):  # noqa: N802
        if self.exc:
            raise self.exc
        self.calls.append((handle, priority))
        return self.result


def test_windows_enters_background_mode():
    k = FakeKernel32()
    with patch.object(low_priority.sys, "platform", "win32"):
        assert low_priority.enter_background_mode(k) is True
    assert k.calls == [(-2, 0x00010000)]
    assert low_priority.THREAD_MODE_BACKGROUND_BEGIN == 0x00010000


def test_a_failed_call_is_false_with_a_breadcrumb():
    k = FakeKernel32(result=0)
    with patch.object(low_priority.sys, "platform", "win32"), capture_logs() as logs:
        assert low_priority.enter_background_mode(k) is False
    assert logs == [
        {
            "event": "low_priority_failed",
            "error_type": "set_thread_priority",
            "log_level": "debug",
        }
    ]


def test_an_exception_is_false_with_a_breadcrumb():
    k = FakeKernel32(exc=OSError("boom"))
    with patch.object(low_priority.sys, "platform", "win32"), capture_logs() as logs:
        assert low_priority.enter_background_mode(k) is False
    assert logs[0]["error_type"] == "OSError"


def test_the_loader_failing_is_false():
    with (
        patch.object(low_priority.sys, "platform", "win32"),
        patch.object(low_priority, "_load_kernel32", side_effect=OSError("x")),
    ):
        assert low_priority.enter_background_mode() is False


def test_the_loader_is_used_when_none_is_given():
    k = FakeKernel32()
    with (
        patch.object(low_priority.sys, "platform", "win32"),
        patch.object(low_priority, "_load_kernel32", return_value=k),
    ):
        assert low_priority.enter_background_mode() is True
    assert len(k.calls) == 1


def test_linux_does_nothing():
    k = FakeKernel32()
    with (
        patch.object(low_priority.sys, "platform", "linux"),
        patch.object(ctypes, "WinDLL", side_effect=AssertionError, create=True),
    ):
        assert low_priority.enter_background_mode(k) is False
        assert low_priority.enter_background_mode() is False
    assert k.calls == []
