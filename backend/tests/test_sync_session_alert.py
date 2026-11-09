"""Sync failures and successes feed session_alert (spec B1 §3, §5)."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pysaka import RefreshFailedError, SessionExpiredError
from structlog.testing import capture_logs

import backend.api.sync as sync_api
from backend.services import session_alert
from backend.services.auto_sync_scheduler import (
    REASON_NOT_AUTHENTICATED,
    REASON_SESSION_EXPIRED,
    AutoSyncScheduler,
)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exc,kind",
    [
        (SessionExpiredError("x"), "expired"),
        (RefreshFailedError("x"), "refresh_failed"),
    ],
)
async def test_sync_failure_reports(exc, kind):
    svc = MagicMock(start_sync=AsyncMock(side_effect=exc))
    with (
        patch.object(sync_api, "get_sync_service", return_value=svc),
        patch.object(sync_api, "schedule_refresh"),
        patch(
            "backend.api.sync.session_alert.report", AsyncMock(return_value=True)
        ) as report,
    ):
        await sync_api.run_sync_task("sakurazaka46", False, False)
    report.assert_awaited_once_with("sakurazaka46", kind)


@pytest.mark.asyncio
async def test_completed_sync_clears_session_alert():
    svc = MagicMock(start_sync=AsyncMock(return_value=True))
    with (
        patch.object(sync_api, "get_sync_service", return_value=svc),
        patch.object(sync_api, "schedule_refresh"),
        patch("backend.api.sync.session_alert.clear", AsyncMock()) as clear,
    ):
        await sync_api.run_sync_task("sakurazaka46", False, False)
    clear.assert_awaited_once_with("sakurazaka46")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "start",
    [
        AsyncMock(
            return_value=False
        ),  # already running / not configured / swallowed error
        AsyncMock(return_value=None),
        AsyncMock(side_effect=RuntimeError("boom")),
    ],
)
async def test_sync_that_did_not_complete_reports_no_success(start):
    svc = MagicMock(start_sync=start)
    with (
        patch.object(sync_api, "get_sync_service", return_value=svc),
        patch.object(sync_api, "schedule_refresh"),
        patch("backend.api.sync.session_alert.clear", AsyncMock()) as clear,
        patch("backend.api.sync.session_alert.report_success") as ok,
        capture_logs() as logs,
    ):
        await sync_api.run_sync_task("sakurazaka46", False, False)
    clear.assert_not_awaited()
    ok.assert_not_called()
    if start.side_effect is None:
        assert any(
            e["event"] == "sync_session_success_skipped"
            and e["reason"] == "not_completed"
            for e in logs
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exc,kind",
    [
        (SessionExpiredError("x"), "expired"),
        (RefreshFailedError("x"), "refresh_failed"),
    ],
)
async def test_verify_failure_reports(exc, kind):
    svc = MagicMock(verify_and_fix_media=AsyncMock(side_effect=exc))
    with (
        patch.object(sync_api, "get_sync_service", return_value=svc),
        patch(
            "backend.api.sync.session_alert.report", AsyncMock(return_value=True)
        ) as report,
    ):
        await sync_api.run_verify_task("sakurazaka46")
    report.assert_awaited_once_with("sakurazaka46", kind)


@pytest.mark.asyncio
async def test_authenticated_client_takes_the_gate():
    from backend.services.sync_service import SyncService

    svc = SyncService("yodel")
    entered: list[str] = []

    class Gate:
        def __init__(self, s):
            entered.append(s)

        async def __aenter__(self):
            return None

        async def __aexit__(self, *a):
            return False

    svc.load_config = AsyncMock(return_value={})  # no token: raises after the gate
    with patch("backend.services.sync_service.refresh_gate.hold", Gate):
        with pytest.raises(Exception, match="Not authenticated"):
            await svc._authenticated_client(MagicMock())
    assert entered == ["yodel"]


def _scheduler(authenticated: bool) -> AutoSyncScheduler:
    return AutoSyncScheduler(
        ["yodel"],
        sleep=AsyncMock(),
        load_settings=AsyncMock(return_value={}),
        is_authenticated=AsyncMock(return_value=authenticated),
        launch=AsyncMock(),
        previous_error_code=lambda s: None,
    )


@pytest.mark.asyncio
async def test_decide_session_expired_when_alert_needs_login():
    sched = _scheduler(False)
    settings = {"auto_sync_enabled": True, "is_configured": True}
    with patch.object(session_alert, "needs_login", return_value=True):
        with patch(
            "backend.services.auto_sync_scheduler.is_shutting_down", return_value=False
        ):
            reason = await sched._decide("yodel", settings)
    assert reason == REASON_SESSION_EXPIRED == "session_expired"


@pytest.mark.asyncio
async def test_decide_not_authenticated_without_alert():
    sched = _scheduler(False)
    settings = {"auto_sync_enabled": True, "is_configured": True}
    with patch.object(session_alert, "needs_login", return_value=False):
        with patch(
            "backend.services.auto_sync_scheduler.is_shutting_down", return_value=False
        ):
            reason = await sched._decide("yodel", settings)
    assert reason == REASON_NOT_AUTHENTICATED
