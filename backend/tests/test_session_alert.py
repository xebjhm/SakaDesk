"""session_alert: needs-login set, strikes, cooldown, toast once (spec B1 §3-4)."""

from unittest.mock import AsyncMock, patch

import pytest
from structlog.testing import capture_logs

from backend.services import session_alert


def _patches(enabled=True):
    return (
        patch.object(
            session_alert,
            "_load_settings",
            AsyncMock(
                return_value={"notifications_enabled": enabled, "language": "en"}
            ),
        ),
        patch.object(session_alert, "send_login_alert", AsyncMock(return_value=True)),
        patch.object(session_alert.desktop_bridge, "set_tray_alert"),
        patch.object(session_alert, "schedule_refresh"),
    )


@pytest.mark.asyncio
async def test_expired_marks_and_toasts_once():
    p1, p2, p3, p4 = _patches()
    with p1, p2 as toast, p3 as tray, p4, capture_logs() as logs:
        assert await session_alert.report("sakurazaka46", "expired") is True
        assert await session_alert.report("sakurazaka46", "expired") is True
    toast.assert_awaited_once()
    service, title, body = toast.await_args.args
    assert service == "sakurazaka46" and "櫻坂46" in title and body
    tray.assert_called_with(True)
    assert session_alert.needs_login("sakurazaka46")
    assert any(
        e["event"] == "session_alert_skipped" and e["reason"] == "already_alerted"
        for e in logs
    )
    assert "token" not in repr(logs).lower()


@pytest.mark.asyncio
async def test_refresh_failed_needs_two_strikes():
    p1, p2, p3, p4 = _patches()
    with p1, p2 as toast, p3, p4:
        assert await session_alert.report("yodel", "refresh_failed") is False
        assert not session_alert.needs_login("yodel")
        assert await session_alert.report("yodel", "refresh_failed") is True
    toast.assert_awaited_once()


@pytest.mark.asyncio
async def test_success_resets_strikes():
    p1, p2, p3, p4 = _patches()
    with p1, p2, p3, p4:
        await session_alert.report("yodel", "refresh_failed")
        session_alert.report_success("yodel")
        assert await session_alert.report("yodel", "refresh_failed") is False


@pytest.mark.asyncio
async def test_notifications_off_no_toast_but_tray_badge():
    p1, p2, p3, p4 = _patches(enabled=False)
    with p1, p2 as toast, p3 as tray, p4, capture_logs() as logs:
        await session_alert.report("nogizaka46", "expired")
    toast.assert_not_awaited()
    tray.assert_called_with(True)
    assert any(
        e["event"] == "session_alert_skipped" and e["reason"] == "notifications_off"
        for e in logs
    )


@pytest.mark.asyncio
async def test_clear_restores_tray_when_last():
    p1, p2, p3, p4 = _patches()
    with p1, p2, p3 as tray, p4:
        await session_alert.report("nogizaka46", "expired")
        await session_alert.report("yodel", "expired")
        await session_alert.clear("nogizaka46")
        tray.assert_called_with(True)
        await session_alert.clear("yodel")
        tray.assert_called_with(False)
    assert session_alert.needs_login_services() == []


def test_may_renew_cooldown_and_mark():
    assert session_alert.may_renew("hinatazaka46", now=0.0)
    session_alert.note_renew_failure("hinatazaka46", now=0.0)
    assert not session_alert.may_renew("hinatazaka46", now=30.0)
    assert session_alert.may_renew("hinatazaka46", now=61.0)


@pytest.mark.asyncio
async def test_may_renew_false_while_marked_and_services_sorted():
    p1, p2, p3, p4 = _patches()
    with p1, p2, p3, p4:
        await session_alert.report("yodel", "expired")
        await session_alert.report("hinatazaka46", "expired")
    assert not session_alert.may_renew("yodel", now=10_000.0)
    assert session_alert.needs_login_services() == ["hinatazaka46", "yodel"]


@pytest.mark.asyncio
async def test_toast_failure_is_contained_and_logged():
    p1, p2, p3, p4 = _patches()
    with p1, p2 as toast, p3, p4, capture_logs() as logs:
        toast.side_effect = RuntimeError("boom secret")
        assert await session_alert.report("yodel", "expired") is True
    assert any(e["event"] == "session_alert_toast_failed" for e in logs)
    assert "secret" not in repr(logs)


@pytest.mark.asyncio
async def test_clear_unmarked_is_quiet_and_resets_cooldown():
    p1, p2, p3, p4 = _patches()
    with p1, p2, p3 as tray, p4:
        session_alert.note_renew_failure("yodel", now=0.0)
        await session_alert.clear("yodel")
        tray.assert_not_called()
    assert session_alert.may_renew("yodel", now=1.0)
