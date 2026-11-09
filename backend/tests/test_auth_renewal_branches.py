"""Branch coverage for AuthService._settle / renew_expired / refresh_if_needed / logout."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from structlog.testing import capture_logs

from backend.services import refresh_gate, session_alert
from backend.services.auth_service import AuthService

SVC = "sakurazaka46"
EXPIRED = {"authenticated": False, "token_expired": True, "expires_at": 1}
VALID = {"authenticated": True, "expires_at": 9}


@pytest.fixture(autouse=True)
def _live_mode():
    with patch("backend.services.auth_service.is_test_mode", return_value=False):
        yield


@pytest.fixture
def alert_io():
    """Real session_alert with its outside-world side effects patched."""
    with (
        patch.object(
            session_alert,
            "_load_settings",
            AsyncMock(return_value={"notifications_enabled": True, "language": "en"}),
        ),
        patch.object(session_alert, "send_login_alert", AsyncMock(return_value=True)),
        patch.object(session_alert.desktop_bridge, "set_tray_alert"),
        patch.object(session_alert, "schedule_refresh"),
    ):
        yield


def _svc(statuses, outcome):
    svc = AuthService()
    seq = iter(statuses)
    svc._get_service_auth_status = lambda s: next(seq)  # type: ignore[method-assign]
    svc.renew_expired = AsyncMock(return_value=outcome)  # type: ignore[method-assign]
    return svc


@pytest.mark.asyncio
async def test_marked_service_short_circuits_without_renewing(alert_io):
    await session_alert.report(SVC, "expired")
    svc = _svc([EXPIRED], "ok")
    status = await svc.get_status(SVC)
    assert status["session_expired"] is True and status["authenticated"] is False
    svc.renew_expired.assert_not_awaited()


@pytest.mark.asyncio
async def test_refresh_failed_marks_only_on_second_strike(alert_io):
    svc = _svc([EXPIRED, EXPIRED], "refresh_failed")
    first = await svc.get_status(SVC)
    assert first.get("session_expired") is None
    assert not session_alert.needs_login(SVC)
    second = await svc.get_status(SVC)
    assert second["session_expired"] is True
    assert session_alert.needs_login(SVC)


@pytest.mark.asyncio
async def test_skipped_outcome_returns_old_status():
    svc = _svc([EXPIRED], "skipped")
    assert await svc.get_status(SVC) == EXPIRED


@pytest.mark.asyncio
async def test_all_services_path_settles_each_expired_service():
    svc = AuthService()
    svc._get_service_auth_status = lambda s: dict(  # type: ignore[method-assign]
        EXPIRED if s == "sakurazaka46" else VALID
    )
    svc.renew_expired = AsyncMock(return_value="error")  # type: ignore[method-assign]
    with patch(
        "backend.services.auth_service.get_all_services",
        return_value=["sakurazaka46", "hinatazaka46"],
    ):
        result = await svc.get_status()
    svc.renew_expired.assert_awaited_once_with("sakurazaka46")
    assert result["services"]["sakurazaka46"]["token_expired"] is True
    assert result["services"]["hinatazaka46"] == VALID


@pytest.mark.asyncio
async def test_still_expired_after_renewal_starts_cooldown():
    svc = _svc([EXPIRED, EXPIRED], "ok")
    with capture_logs() as logs:
        status = await svc.get_status(SVC)
    assert status["token_expired"] is True
    assert session_alert.may_renew(SVC) is False
    ev = [e for e in logs if e["event"] == "session_renew_still_expired"]
    assert ev and ev[0]["service"] == SVC


@pytest.mark.asyncio
async def test_false_refresh_return_is_refresh_failed():
    svc = AuthService()
    svc._load_token_for_renewal = lambda s: (  # type: ignore[method-assign]
        {"access_token": "t", "cookies": {"session": "c"}},
        True,
    )
    svc._save_refreshed = MagicMock()  # type: ignore[method-assign]
    with patch(
        "backend.services.auth_service.Client.refresh_access_token",
        AsyncMock(return_value=False),
    ):
        assert await svc.renew_expired(SVC) == "refresh_failed"
    svc._save_refreshed.assert_not_called()
    assert session_alert.may_renew(SVC) is False


@pytest.mark.asyncio
async def test_refresh_if_needed_runs_in_gate_and_reports_success():
    svc = AuthService()
    svc._reload_session_fresh = lambda g: {  # type: ignore[method-assign]
        "access_token": "t",
        "cookies": {"session": "c"},
    }
    svc._get_token_remaining_seconds = lambda t: 10.0  # type: ignore[method-assign]
    svc._save_refreshed = lambda s, c: 3600.0  # type: ignore[method-assign]
    session_alert.note_renew_failure(SVC)
    held = []
    real_hold = refresh_gate.hold

    def spy_hold(service):
        held.append(service)
        return real_hold(service)

    with (
        patch("backend.services.auth_service.refresh_gate.hold", spy_hold),
        patch(
            "backend.services.auth_service.Client.refresh_access_token",
            AsyncMock(return_value=True),
        ),
    ):
        result = await svc.refresh_if_needed(SVC)
    assert held == [SVC]
    assert result["status"] == "refreshed"
    assert session_alert.may_renew(SVC) is True  # report_success cleared cooldown


@pytest.mark.asyncio
async def test_logout_clears_needs_login_mark(alert_io):
    await session_alert.report(SVC, "expired")
    assert session_alert.needs_login(SVC)
    with patch("backend.services.auth_service.get_token_manager"):
        await AuthService().logout(SVC)
    assert not session_alert.needs_login(SVC)
