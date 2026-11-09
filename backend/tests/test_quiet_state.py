import pytest
from structlog.testing import capture_logs

from backend.services.quiet_state import (
    UNKNOWN,
    WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED,
    QuietState,
    query_quiet_state,
)


class FakeShell32:
    def __init__(self, value: int = 5, hr: int = 0, exc: Exception | None = None):
        self.value, self.hr, self.exc = value, hr, exc

    def SHQueryUserNotificationState(self, out):  # noqa: N802 (Win32 name)
        if self.exc:
            raise self.exc
        out._obj.value = self.value
        return self.hr


class FakeNtdll:
    def __init__(self, profile: int = 0, status: int = 0, exc: Exception | None = None):
        self.profile, self.status, self.exc = profile, status, exc
        self.name = None

    def NtQueryWnfStateData(self, name, type_id, scope, stamp, buf, size):  # noqa: N802
        if self.exc:
            raise self.exc
        self.name = name._obj.value
        assert type_id is None and scope is None
        buf._obj.value = self.profile
        return self.status


def q(shell=None, nt=None):
    return query_quiet_state(
        shell32=shell or FakeShell32(), ntdll=nt or FakeNtdll(), platform="win32"
    )


@pytest.mark.parametrize(
    "value, code",
    [
        (1, "not_present"),
        (2, "fullscreen"),
        (3, "d3d_fullscreen"),
        (4, "presentation"),
        (6, "quiet_time"),
        (7, "app_fullscreen"),
    ],
)
def test_quns_quiet_values(value, code):
    assert q(FakeShell32(value)) == QuietState(code, True, value, -1)


@pytest.mark.parametrize(
    "profile, expected",
    [
        (0, QuietState("accepts", False, 5, 0)),
        (1, QuietState("focus_assist_priority", True, 5, 1)),
        (2, QuietState("focus_assist_alarms", True, 5, 2)),
    ],
)
def test_accepts_then_focus_assist(profile, expected):
    nt = FakeNtdll(profile)
    assert q(FakeShell32(5), nt) == expected
    assert nt.name == WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED


def test_unknown_quns_value_goes_to_focus_assist():
    assert q(FakeShell32(0), FakeNtdll(0)) == QuietState("accepts", False, 0, 0)


@pytest.mark.parametrize(
    "nt", [FakeNtdll(3), FakeNtdll(0, status=0xC0000034), FakeNtdll(exc=OSError())]
)
def test_wnf_failure_is_unknown_and_not_quiet(nt):
    with capture_logs() as logs:
        state = q(FakeShell32(5), nt)
    assert state == QuietState("unknown", False, 5, -1)
    assert any(e["event"] == "quiet_state_failed" and e["api"] == "wnf" for e in logs)


@pytest.mark.parametrize("shell", [FakeShell32(hr=1), FakeShell32(exc=OSError())])
def test_quns_failure_falls_through_with_minus_one(shell):
    with capture_logs() as logs:
        state = q(shell, FakeNtdll(2))
    assert state == QuietState("focus_assist_alarms", True, -1, 2)
    assert any(e["event"] == "quiet_state_failed" and e["api"] == "quns" for e in logs)


def test_non_windows_is_unknown():
    assert query_quiet_state(platform="linux") == UNKNOWN


def test_every_query_logs_codes_at_debug():
    with capture_logs() as logs:
        q(FakeShell32(2))
    (e,) = [e for e in logs if e["event"] == "quiet_state"]
    assert e == {
        "event": "quiet_state",
        "log_level": "debug",
        "quns": 2,
        "focus_assist": -1,
        "result": "fullscreen",
    }
