"""Tests for AuthService multi-service support."""

import asyncio

import pytest
from unittest.mock import AsyncMock, patch
from backend.services.auth_service import AuthService


@pytest.fixture
def auth_service():
    return AuthService()


def test_get_all_status_returns_all_services(auth_service):
    """get_status() with no args returns status for all services."""
    with patch("backend.services.auth_service.get_token_manager") as mock_tm:
        mock_tm.return_value.load_session.return_value = None

        result = asyncio.run(auth_service.get_status())

        assert "services" in result
        assert "hinatazaka46" in result["services"]
        assert "nogizaka46" in result["services"]
        assert "sakurazaka46" in result["services"]


def test_get_status_single_service(auth_service):
    """get_status(service) returns status for specific service only."""
    with patch("backend.services.auth_service.get_token_manager") as mock_tm:
        mock_tm.return_value.load_session.return_value = None

        result = asyncio.run(auth_service.get_status(service="hinatazaka46"))

        assert "authenticated" in result
        assert not result["authenticated"]


def test_get_status_invalid_service(auth_service):
    """get_status with invalid service raises ValueError."""
    with pytest.raises(ValueError):
        asyncio.run(auth_service.get_status(service="invalid"))


def test_login_with_browser_requires_service(auth_service):
    """login_with_browser requires a service parameter."""
    with pytest.raises(TypeError):
        asyncio.run(auth_service.login_with_browser())


def test_logout_requires_service(auth_service):
    """logout requires a service parameter."""
    with pytest.raises(TypeError):
        asyncio.run(auth_service.logout())


def test_get_config_requires_service(auth_service):
    """get_config requires a service parameter."""
    with pytest.raises(TypeError):
        auth_service.get_config()


def test_refresh_if_needed_requires_service(auth_service):
    """refresh_if_needed requires a service parameter."""
    with pytest.raises(TypeError):
        asyncio.run(auth_service.refresh_if_needed())


def test_get_status_authenticated_valid_token(auth_service):
    """get_status returns authenticated=True for valid token."""
    with patch("backend.services.auth_service.get_token_manager") as mock_tm:
        mock_tm.return_value.load_session.return_value = {
            "access_token": "test_token",
        }
        with patch.object(auth_service, "_is_token_expired", return_value=False):
            result = asyncio.run(auth_service.get_status(service="hinatazaka46"))
            assert result["authenticated"]


def test_get_status_expired_token(auth_service):
    """get_status returns token_expired=True for expired token."""
    with patch("backend.services.auth_service.get_token_manager") as mock_tm:
        mock_tm.return_value.load_session.return_value = {
            "access_token": "expired_token",
        }
        with (
            patch.object(auth_service, "_is_token_expired", return_value=True),
            # Renewal is covered in test_auth_renewal.py; "error" is the documented
            # "not renewed this time, will retry" outcome that keeps token_expired.
            patch.object(AuthService, "renew_expired", AsyncMock(return_value="error")),
        ):
            result = asyncio.run(auth_service.get_status(service="hinatazaka46"))
            assert not result["authenticated"]
            assert result.get("token_expired")


def test_logout_clears_credentials(auth_service):
    """logout calls TokenManager.delete_session with correct service."""
    with patch("backend.services.auth_service.get_token_manager") as mock_tm:
        asyncio.run(auth_service.logout(service="hinatazaka46"))
        mock_tm.return_value.delete_session.assert_called_once_with("hinatazaka46")


# ---------------------------------------------------------------------------
# cancel_login (loading UX L6): the login dialog's Cancel stops a browser login
# ---------------------------------------------------------------------------


def _hanging_login(started: asyncio.Event):
    """A fake ``BrowserAuth.login`` that waits forever (the user never signs in)."""

    async def fake_login(**_kwargs):
        started.set()
        await asyncio.Event().wait()

    return fake_login


def test_cancel_login_cancels_the_active_login(auth_service):
    """Cancel during a login cancels it, frees the browser lock, saves nothing
    and logs ``login_cancel`` with ids and codes only."""
    import contextlib

    from structlog.testing import capture_logs

    async def run():
        started = asyncio.Event()
        with patch("backend.services.auth_service.BrowserAuth") as mock_auth:
            mock_auth.login = AsyncMock(side_effect=_hanging_login(started))
            with patch.object(auth_service, "_save_credentials") as save:
                task = asyncio.create_task(
                    auth_service.login_with_browser("hinatazaka46")
                )
                await asyncio.wait_for(started.wait(), timeout=2)
                with capture_logs() as logs:
                    cancelled = await auth_service.cancel_login("hinatazaka46")
                with contextlib.suppress(asyncio.CancelledError):
                    await task
        assert cancelled is True
        assert task.cancelled()
        assert not auth_service._browser_lock.locked()
        assert auth_service._active_login_task is None
        save.assert_not_called()
        (entry,) = [e for e in logs if e["event"] == "login_cancel"]
        assert entry == {
            "event": "login_cancel",
            "service": "hinatazaka46",
            "outcome": "cancelled",
            "log_level": "info",
        }
        # The marker only lives while the cancelled login unwinds.
        assert auth_service.consume_login_cancel("hinatazaka46") is False

    asyncio.run(run())


def test_cancel_login_without_a_login_returns_false(auth_service):
    from structlog.testing import capture_logs

    async def run():
        with capture_logs() as logs:
            assert await auth_service.cancel_login("hinatazaka46") is False
        (entry,) = [e for e in logs if e["event"] == "login_cancel"]
        assert entry["outcome"] == "none"
        assert set(entry) == {"event", "service", "outcome", "log_level"}

    asyncio.run(run())


def test_cancel_login_for_another_service_leaves_the_login_running(auth_service):
    """A cancel for service B never stops service A's login."""
    import contextlib

    async def run():
        started = asyncio.Event()
        with patch("backend.services.auth_service.BrowserAuth") as mock_auth:
            mock_auth.login = AsyncMock(side_effect=_hanging_login(started))
            task = asyncio.create_task(auth_service.login_with_browser("hinatazaka46"))
            await asyncio.wait_for(started.wait(), timeout=2)
            assert await auth_service.cancel_login("sakurazaka46") is False
            assert not task.done()
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    asyncio.run(run())


def test_cancel_login_requires_a_known_service(auth_service):
    with pytest.raises(ValueError):
        asyncio.run(auth_service.cancel_login("fake_service"))


def test_login_cancel_marker_is_consumed_once(auth_service):
    """The route reads the marker once: a later, unrelated cancellation of the
    same service (a shutdown) is never mistaken for the user's Cancel."""
    import contextlib

    async def run():
        started = asyncio.Event()
        seen = []

        async def login_like_the_route():
            try:
                await auth_service.login_with_browser("hinatazaka46")
            except asyncio.CancelledError:
                seen.append(auth_service.consume_login_cancel("hinatazaka46"))
                seen.append(auth_service.consume_login_cancel("hinatazaka46"))
                raise

        with patch("backend.services.auth_service.BrowserAuth") as mock_auth:
            mock_auth.login = AsyncMock(side_effect=_hanging_login(started))
            task = asyncio.create_task(login_like_the_route())
            await asyncio.wait_for(started.wait(), timeout=2)
            assert await auth_service.cancel_login("hinatazaka46") is True
            with contextlib.suppress(asyncio.CancelledError):
                await task
        assert seen == [True, False]

    asyncio.run(run())


# ---------------------------------------------------------------------------
# L6 fix round 1: early cancel, timeout, finished attempts, no path in logs
# ---------------------------------------------------------------------------


def test_cancel_before_the_login_registers_stops_it_before_a_browser_opens(
    auth_service,
):
    """A cancel for an attempt that has not reached the backend yet is kept;
    that login then refuses to start and never opens a browser."""
    from structlog.testing import capture_logs

    from backend.services.auth_service import LoginCancelledError

    async def run():
        with capture_logs() as logs:
            assert await auth_service.cancel_login("hinatazaka46", "a1") is True
        (entry,) = [e for e in logs if e["event"] == "login_cancel"]
        assert entry["outcome"] == "pending"
        with patch("backend.services.auth_service.BrowserAuth") as mock_auth:
            mock_auth.login = AsyncMock(return_value={"access_token": "x"})
            with pytest.raises(LoginCancelledError):
                await auth_service.login_with_browser("hinatazaka46", "a1")
            mock_auth.login.assert_not_called()
        assert not auth_service._browser_lock.locked()
        # Honoured once: the same attempt id is now finished.
        assert await auth_service.cancel_login("hinatazaka46", "a1") is False

    asyncio.run(run())


def test_cancel_while_the_login_waits_for_the_lock_is_honoured(auth_service):
    """The window between the entry check and registration (waiting for the
    lock or an older login's supersede) cannot lose a cancel."""
    import contextlib

    from backend.services.auth_service import LoginCancelledError

    async def run():
        with patch("backend.services.auth_service.BrowserAuth") as mock_auth:
            mock_auth.login = AsyncMock(return_value={"access_token": "x"})
            await auth_service._browser_lock.acquire()
            task = asyncio.create_task(
                auth_service.login_with_browser("hinatazaka46", "b2")
            )
            await asyncio.sleep(0)
            assert await auth_service.cancel_login("hinatazaka46", "b2") is True
            auth_service._browser_lock.release()
            with contextlib.suppress(LoginCancelledError):
                await task
            assert isinstance(task.exception(), LoginCancelledError)
            mock_auth.login.assert_not_called()

    asyncio.run(run())


def test_cancel_after_a_finished_attempt_returns_false(auth_service):
    async def run():
        with patch("backend.services.auth_service.BrowserAuth") as mock_auth:
            mock_auth.login = AsyncMock(return_value={"access_token": "x"})
            with patch.object(auth_service, "_save_credentials"):
                assert (
                    await auth_service.login_with_browser("hinatazaka46", "c3") is True
                )
        assert await auth_service.cancel_login("hinatazaka46", "c3") is False
        assert ("hinatazaka46", "c3") not in auth_service._pending_cancels

    asyncio.run(run())


def test_cancel_login_wait_is_bounded(auth_service):
    """A login that does not unwind in time: the cancel answers True after the
    bounded wait, logs login_cancel_timeout, and the marker stays until the
    login is done."""
    from structlog.testing import capture_logs

    async def run():
        started = asyncio.Event()
        release = asyncio.Event()

        async def stubborn_login(**_kwargs):
            started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                await release.wait()  # the browser takes long to close
                raise

        with patch("backend.services.auth_service.LOGIN_CANCEL_WAIT_SECONDS", 0.05):
            with patch("backend.services.auth_service.BrowserAuth") as mock_auth:
                mock_auth.login = AsyncMock(side_effect=stubborn_login)
                task = asyncio.create_task(
                    auth_service.login_with_browser("hinatazaka46")
                )
                await asyncio.wait_for(started.wait(), timeout=2)
                with capture_logs() as logs:
                    assert await auth_service.cancel_login("hinatazaka46") is True
                (timeout_entry,) = [
                    e for e in logs if e["event"] == "login_cancel_timeout"
                ]
                assert set(timeout_entry) == {"event", "service", "wait_s", "log_level"}
                assert "hinatazaka46" in auth_service._cancelled
                release.set()
                with pytest.raises(asyncio.CancelledError):
                    await task
                await asyncio.sleep(0)
                assert "hinatazaka46" not in auth_service._cancelled

    asyncio.run(run())


def test_starting_browser_login_log_carries_no_path(auth_service):
    from structlog.testing import capture_logs

    async def run():
        with patch("backend.services.auth_service.BrowserAuth") as mock_auth:
            mock_auth.login = AsyncMock(return_value=None)
            with capture_logs() as logs:
                await auth_service.login_with_browser("hinatazaka46")
        (entry,) = [e for e in logs if e["event"] == "Starting browser login"]
        assert "session_dir" not in entry
        assert isinstance(entry["has_session_dir"], bool)

    asyncio.run(run())
