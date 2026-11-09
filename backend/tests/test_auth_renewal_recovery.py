"""Marked-service retry, concurrent bounded status renewal, gate on login, refresh_if_needed alerts."""

import asyncio
import threading
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pysaka import RefreshFailedError, SessionExpiredError
from structlog.testing import capture_logs

from backend.services import auth_service as auth_mod
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
        patch.object(
            session_alert, "send_login_alert", AsyncMock(return_value=True)
        ) as toast,
        patch.object(session_alert.desktop_bridge, "set_tray_alert") as tray,
        patch.object(session_alert, "schedule_refresh") as tooltip,
    ):
        yield {"toast": toast, "tray": tray, "tooltip": tooltip}


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def _renewable_service(refresh):
    """An AuthService whose stored token is expired until a refresh is saved."""
    svc = AuthService()
    state = {"saved": False}
    svc._get_service_auth_status = lambda s: dict(  # type: ignore[method-assign]
        VALID if state["saved"] else EXPIRED
    )
    svc._load_token_for_renewal = lambda s: (  # type: ignore[method-assign]
        {"access_token": "t", "cookies": {"session": "c"}},
        not state["saved"],
    )

    def save(service, client):
        state["saved"] = True
        return 3600.0

    svc._save_refreshed = save  # type: ignore[method-assign]
    return svc, patch(
        "backend.services.auth_service.Client.refresh_access_token", refresh
    )


@pytest.mark.asyncio
async def test_offline_strikes_mark_then_slow_retry_clears_mark_and_tray(alert_io):
    refresh = AsyncMock(side_effect=RefreshFailedError("offline"))
    svc, patched = _renewable_service(refresh)
    clock = Clock()
    with (
        patched,
        patch("backend.services.session_alert.time.monotonic", clock),
        capture_logs() as logs,
    ):
        first = await svc.get_status(SVC)
        assert first.get("session_expired") is None  # first strike
        clock.now = session_alert.RENEW_RETRY_SECONDS + 1
        second = await svc.get_status(SVC)
        assert second["session_expired"] is True
        assert session_alert.mark_kind(SVC) == "refresh_failed"
        alert_io["tray"].assert_called_with(True)

        # Inside the slow retry wait: no refresh, still session_expired.
        clock.now += session_alert.MARKED_RETRY_SECONDS - 1
        assert (await svc.get_status(SVC))["session_expired"] is True
        assert refresh.await_count == 2

        # Back online after the wait: the retry renews and clears the mark.
        refresh.side_effect = None
        refresh.return_value = True
        clock.now += 2
        status = await svc.get_status(SVC)
    assert status == VALID
    assert refresh.await_count == 3
    assert not session_alert.needs_login(SVC)
    alert_io["tray"].assert_called_with(False)
    skipped = [e for e in logs if e.get("outcome") == "skipped"]
    assert not skipped  # the marked-and-waiting status read never called renew
    retry = [e for e in logs if e["event"] == "session_renew_retry"]
    assert retry and retry[0]["kind"] == "refresh_failed"
    assert any(e.get("action") == "cleared" for e in logs)


@pytest.mark.asyncio
async def test_failed_slow_retry_stays_marked(alert_io):
    refresh = AsyncMock(side_effect=RefreshFailedError("offline"))
    svc, patched = _renewable_service(refresh)
    clock = Clock()
    with patched, patch("backend.services.session_alert.time.monotonic", clock):
        await session_alert.report(SVC, "refresh_failed")
        await session_alert.report(SVC, "refresh_failed")
        clock.now = session_alert.MARKED_RETRY_SECONDS
        status = await svc.get_status(SVC)
        assert status["session_expired"] is True
        assert refresh.await_count == 1
        assert session_alert.renew_block_reason(SVC) == "marked_retry_wait"
    alert_io["toast"].assert_awaited_once()


@pytest.mark.asyncio
async def test_expired_mark_is_not_retried(alert_io):
    refresh = AsyncMock(return_value=True)
    svc, patched = _renewable_service(refresh)
    clock = Clock()
    with patched, patch("backend.services.session_alert.time.monotonic", clock):
        await session_alert.report(SVC, "expired")
        clock.now = 10 * session_alert.MARKED_RETRY_SECONDS
        status = await svc.get_status(SVC)
        assert await svc.renew_expired(SVC) == "skipped"
    assert status["session_expired"] is True and status["authenticated"] is False
    refresh.assert_not_awaited()
    assert session_alert.needs_login(SVC)


@pytest.mark.asyncio
async def test_two_expired_services_settle_concurrently():
    svc = AuthService()
    svc._get_service_auth_status = lambda s: dict(EXPIRED)  # type: ignore[method-assign]

    async def slow_renew(service):
        await asyncio.sleep(0.2)
        return "error"

    svc.renew_expired = slow_renew  # type: ignore[method-assign]
    with patch(
        "backend.services.auth_service.get_all_services",
        return_value=["sakurazaka46", "hinatazaka46"],
    ):
        t0 = time.monotonic()
        result = await svc.get_status()
        elapsed = time.monotonic() - t0
    assert elapsed < 0.35  # one renewal, not two in a row
    assert set(result["services"]) == {"sakurazaka46", "hinatazaka46"}
    assert all(s["token_expired"] for s in result["services"].values())


@pytest.mark.asyncio
async def test_slow_renewal_times_out_on_status_path_but_still_completes_and_saves():
    svc = AuthService()
    saved = []
    svc._get_service_auth_status = lambda s: dict(  # type: ignore[method-assign]
        VALID if saved else EXPIRED
    )
    svc._load_token_for_renewal = lambda s: (  # type: ignore[method-assign]
        {"access_token": "t", "cookies": {"session": "c"}},
        not saved,
    )

    def save(service, client):
        saved.append(service)
        return 3600.0

    svc._save_refreshed = save  # type: ignore[method-assign]
    release = asyncio.Event()
    cancelled = []

    async def slow_refresh(self, session):
        try:
            await release.wait()  # the server answers after the status call gave up
        except asyncio.CancelledError:
            cancelled.append(True)
            raise
        return True

    success = MagicMock(wraps=session_alert.report_success)
    with (
        patch.object(auth_mod, "STATUS_RENEW_TIMEOUT_SECONDS", 0.05),
        patch(
            "backend.services.auth_service.Client.refresh_access_token", slow_refresh
        ),
        patch.object(session_alert, "report_success", success),
        capture_logs() as logs,
    ):
        t0 = time.monotonic()
        status = await svc.get_status(SVC)
        elapsed = time.monotonic() - t0
        assert elapsed < 1.0
        assert status["token_expired"] is True
        assert status.get("session_expired") is None
        assert not session_alert.needs_login(SVC)
        assert refresh_gate._lock_for(SVC).locked()  # the renewal still runs
        ev = [e for e in logs if e["event"] == "session_renew"]
        assert ev and ev[-1]["outcome"] == "timeout"
        success.assert_not_called()

        release.set()
        for _ in range(100):
            if not refresh_gate._lock_for(SVC).locked():
                break
            await asyncio.sleep(0.01)
    assert not cancelled
    assert saved == [SVC]
    success.assert_called_with(SVC)  # clear() after the background renewal
    assert session_alert.may_renew(SVC)  # the timeout's cooldown was cleared
    assert not refresh_gate._lock_for(SVC).locked()
    ok = [e for e in logs if e["event"] == "session_renew" and e["outcome"] == "ok"]
    assert ok
    assert await svc.get_status(SVC) == VALID


@pytest.mark.asyncio
async def test_status_call_during_a_background_renewal_waits_at_the_gate():
    """Past the cooldown, a later status call waits for the running renewal."""
    svc = AuthService()
    saved = []
    svc._get_service_auth_status = lambda s: dict(  # type: ignore[method-assign]
        VALID if saved else EXPIRED
    )
    svc._load_token_for_renewal = lambda s: (  # type: ignore[method-assign]
        {"access_token": "t", "cookies": {"session": "c"}},
        not saved,
    )
    svc._save_refreshed = lambda s, c: saved.append(s) or 3600.0  # type: ignore[method-assign]
    release = asyncio.Event()
    calls = 0

    async def slow_refresh(self, session):
        nonlocal calls
        calls += 1
        await release.wait()
        return True

    with patch(
        "backend.services.auth_service.Client.refresh_access_token", slow_refresh
    ):
        with patch.object(auth_mod, "STATUS_RENEW_TIMEOUT_SECONDS", 0.05):
            await svc.get_status(SVC)  # times out, renewal continues
        session_alert._cooldown_until.pop(SVC, None)  # as if 60 s passed
        later = asyncio.ensure_future(svc.get_status(SVC))
        await asyncio.sleep(0.02)
        assert not later.done()  # waiting at the busy gate
        release.set()
        status = await asyncio.wait_for(later, 5)
    # The waiter re-read the token inside the gate: one refresh in total.
    assert calls == 1
    assert saved == [SVC]
    assert status == VALID


@pytest.mark.asyncio
async def test_cancelled_save_still_lands_before_cancellation_propagates():
    svc = AuthService()
    saved = []

    def slow_save(service, client):
        threading.Event().wait(0.1)  # a blocking keyring write in its thread
        saved.append(service)
        return 3600.0

    svc._save_refreshed = slow_save  # type: ignore[method-assign]
    task = asyncio.ensure_future(svc._save_refreshed_uncancellable(SVC, MagicMock()))
    await asyncio.sleep(0.02)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert saved == [SVC]


@pytest.mark.asyncio
async def test_login_saves_credentials_inside_the_gate():
    svc = AuthService()
    held_during_save = []

    def save(service, creds):
        held_during_save.append(refresh_gate._lock_for(service).locked())

    svc._save_credentials = save  # type: ignore[method-assign]
    with (
        patch(
            "backend.services.auth_service.BrowserAuth.login",
            AsyncMock(return_value={"access_token": "t"}),
        ),
        patch.object(session_alert, "clear", AsyncMock()),
    ):
        assert await svc.login_with_browser(SVC) is True
    assert held_during_save == [True]
    assert not refresh_gate._lock_for(SVC).locked()


def _refresh_svc():
    svc = AuthService()
    svc._reload_session_fresh = lambda g: {  # type: ignore[method-assign]
        "access_token": "t",
        "cookies": {"session": "c"},
    }
    svc._get_token_remaining_seconds = lambda t: 10.0  # type: ignore[method-assign]
    svc._save_refreshed = lambda s, c: 3600.0  # type: ignore[method-assign]
    return svc


@pytest.mark.asyncio
async def test_refresh_if_needed_skips_a_marked_service(alert_io):
    await session_alert.report(SVC, "expired")
    refresh = AsyncMock(return_value=True)
    with (
        patch("backend.services.auth_service.Client.refresh_access_token", refresh),
        capture_logs() as logs,
    ):
        result = await _refresh_svc().refresh_if_needed(SVC)
    assert result["status"] == "skipped" and result["refreshed"] is False
    refresh.assert_not_awaited()
    ev = [e for e in logs if e.get("outcome") == "skipped"]
    assert ev and ev[0]["reason"] == "marked_expired"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exc,kind,marked",
    [
        (SessionExpiredError("secret-ish detail"), "expired", True),
        (RefreshFailedError("secret-ish detail"), "refresh_failed", False),
        (OSError("secret-ish detail"), None, False),
    ],
)
async def test_refresh_if_needed_maps_failures_to_session_alert(
    alert_io, exc, kind, marked
):
    with (
        patch(
            "backend.services.auth_service.Client.refresh_access_token",
            AsyncMock(side_effect=exc),
        ),
        capture_logs() as logs,
    ):
        result = await _refresh_svc().refresh_if_needed(SVC)
    assert result == {"refreshed": False, "remaining_seconds": 0, "status": "error"}
    assert session_alert.needs_login(SVC) is marked
    if kind == "refresh_failed":
        assert session_alert._strikes.get(SVC) == 1
    if kind != "expired":
        assert session_alert.renew_block_reason(SVC) == "cooldown"
    err = [e for e in logs if e["event"] == "refresh_if_needed error"]
    assert err and err[0]["error_type"] == type(exc).__name__
    assert "secret-ish" not in repr(logs)


@pytest.mark.asyncio
async def test_refresh_if_needed_false_refresh_counts_a_strike(alert_io):
    with patch(
        "backend.services.auth_service.Client.refresh_access_token",
        AsyncMock(return_value=False),
    ):
        result = await _refresh_svc().refresh_if_needed(SVC)
    assert result["status"] == "refresh_failed"
    assert session_alert._strikes.get(SVC) == 1
    assert session_alert.renew_block_reason(SVC) == "cooldown"


@pytest.mark.asyncio
async def test_refresh_if_needed_success_clears_a_refresh_failed_mark(alert_io):
    await session_alert.report(SVC, "refresh_failed", now=-1e6)
    await session_alert.report(SVC, "refresh_failed", now=-1e6)
    assert session_alert.needs_login(SVC) and session_alert.may_renew(SVC)
    with patch(
        "backend.services.auth_service.Client.refresh_access_token",
        AsyncMock(return_value=True),
    ):
        result = await _refresh_svc().refresh_if_needed(SVC)
    assert result["status"] == "refreshed"
    assert not session_alert.needs_login(SVC)
    alert_io["tray"].assert_called_with(False)
